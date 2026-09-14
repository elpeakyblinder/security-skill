# Caso de Estudio Real: Blindaje y Auditoría de Seguridad en Autenticación y Control de Roles

> **Validación práctica en producción asistida por IA**  
> **Autor:** Guijosa Dev  
> **Entorno:** Python 3.10+ / PyQt6 / SQLite (Local-First) y MySQL / Bcrypt  
> **Tipo de aplicación:** Escritorio / Terminal Punto de Venta (POS)  
> **Herramienta:** Google Antigravity (Modelo con razonamiento extendido)  
> **Skill aplicada:** [`security-regression-guard`](../security-regression-guard/SKILL.md)

---

## 1. Resumen Ejecutivo

Este caso de estudio documenta la auditoría y blindaje del módulo central de autenticación y autorización en un sistema de Punto de Venta (POS) de escritorio desarrollado en Python y PyQt6 con persistencia dual (SQLite local-first y MySQL remoto).

A simple vista, el módulo de login y verificación de credenciales cumplía con las directivas estándar de seguridad: utilizaba la biblioteca criptográfica `bcrypt` para el almacenamiento y comparación de contraseñas, y todas las consultas hacia SQLite y MySQL estaban parametrizadas con marcadores de posición (`%s` / `?`), descartando inyecciones SQL. Por ende, revisiones preliminares o escaneos automáticos de código daban el módulo por seguro.

Sin embargo, al ejecutar la skill **`security-regression-guard`**, el análisis sistemático de fronteras de acceso, estados de cuenta y canales laterales expuso cuatro fallas de seguridad:

1. **Evasión de estado de cuenta deshabilitada:** Empleados dados de baja o suspendidos (`Status = 'Inactive'`) podían seguir iniciando sesión y conservaban privilegios si conocían la contraseña, dado que el login ignoraba el campo de estado.
2. **Ataque de temporización (Timing Attack) en contraseñas legadas:** Las contraseñas en migración desde texto plano se comparaban mediante el operador estándar `!=`, vulnerable a análisis de tiempos de interrupción por byte.
3. **Fuga de información y vector de enumeración de usuarios:** Respuestas de error disonantes que revelaban la existencia de usuarios por defecto, y discrepancias de latencia medibles entre cuentas existentes e inexistentes frente a `bcrypt`.
4. **Denegación de servicio (DoS) por entradas no acotadas:** Ausencia de un límite superior de longitud en la contraseña antes de delegar el procesamiento a las costosas rondas de hashing de `bcrypt`, permitiendo degradar el hilo principal de la interfaz gráfica.

Guiado por la metodología de la skill, se corrigió la lógica en la capa de consultas y en el widget de autenticación, implementando **8 pruebas automatizadas de regresión** con datos sintéticos y una base de datos SQLite aislada, logrando la aprobación total sin alterar los 94 casos de prueba globales del sistema.

---

## 2. Escenario inicial: funcionalidad frente a fronteras de seguridad

### Contexto de la aplicación
El sistema es una aplicación de terminal punto de venta con arquitectura cliente/escritorio diseñada para soportar modo desconectado local (SQLite) y conexión centralizada (MySQL). El acceso a áreas críticas del negocio (gestión de inventario, cortes de caja, administración de personal y métricas financieras) se reserva para usuarios con rol `Administrativo`, mientras que los cajeros operan bajo rol `Empleado`.

### La apariencia de seguridad
El código previo presentaba la siguiente estructura en `Auth/login.py` y `DB/queries/auth.py`:
- Uso de `bcrypt.checkpw()` para validar hashes `$2b$`.
- Consultas SQL parametrizadas para mitigar inyecciones.
- Mecanismo de bloqueo local tras 3 intentos fallidos consecutivos.

A pesar de contar con estos componentes defensivos, el flujo nominal no garantizaba que las invariantes de autorización de la empresa se cumplieran estrictamente. Los modelos generativos e inspectores sintácticos con frecuencia asumen que la presencia de `bcrypt` basta para considerar cerrado el problema de autenticación, omitiendo las fronteras del ciclo de vida de los datos y los efectos de canal lateral.

---

## 3. La Intervención con `security-regression-guard`

La auditoría se inició solicitando al agente aplicar la metodología de la skill sobre el módulo de login:

```text
/security-regression-guard Audita y refuerza el login
```

Siguiendo las directrices de la skill, el agente estructuró la revisión alrededor de las fronteras de seguridad:

1. **Trazabilidad de la operación:** Mapear `Entrada de usuario -> Validación de formato -> Consulta de identidad -> Verificación criptográfica -> Comprobación de estado -> Sesión en menú`.
2. **Ciclo de vida y vigencia:** Comprobar si cuentas inactivas, suspendidas o eliminadas pueden ejecutar acciones o resolver roles.
3. **Tiempo constante en comparaciones:** Identificar cualquier bifurcación o atajo de evaluación condicional en secretos.
4. **Mitigación de enumeración:** Garantizar respuestas uniformes en mensajes y en consumo de CPU entre cuentas existentes y no existentes.
5. **Límites de costo computacional:** Acotar payloads antes de operaciones intensivas de CPU.
6. **Pruebas de comportamiento comprobable:** Escribir pruebas unitarias que reproduzcan el intento de evasión y certifiquen su bloqueo.

---

## 4. Hallazgos Concretos y Mitigaciones Aplicadas

### Hallazgo 1: Evasión de Estado de Cuenta (`Status = 'Inactive'`)
- **Problema:** En `DB/queries/auth.py`, el método `authenticate_user(username)` recuperaba la fila de la tabla `users` (incluyendo la columna `Status`), pero `LoginWidget.check_credentials()` en `Auth/login.py` únicamente verificaba la contraseña. Un empleado despedido cuya cuenta había sido marcada como `Inactive` en el panel administrativo podía iniciar sesión normalmente. Asimismo, `get_user_role(username)` retornaba el rol sin filtrar por estado, permitiendo que comprobaciones dinámicas como `_is_admin()` siguieran autorizando al usuario.
- **Mitigación:** Se forzó la validación del estado activo tanto en el login como en la consulta de roles:
  ```python
  # DB/queries/auth.py
  def get_user_role(self, username):
      query = "SELECT Rol FROM users WHERE UsuarioNombre = %s AND Status = 'Active'"
      result = self.fetch_one(query, (username,))
      return result["Rol"] if result else None
  ```
  ```python
  # Auth/login.py
  user = db.authenticate_user(username)
  if not user or user.get("Status") != "Active":
      self._register_failed_attempt()
      return
  ```

### Hallazgo 2: Ataque de Temporización en Migración de Contraseñas Legadas
- **Problema:** Para facilitar la transición desde versiones anteriores del software sin forzar reinicios masivos de contraseñas, el sistema admitía verificar contraseñas legadas en texto plano y migrarlas a `bcrypt` en el primer login exitoso. No obstante, la verificación utilizaba el operador `!=`:
  ```python
  if password != stored_password:
      self._register_failed_attempt()
      return
  ```
  El operador de igualdad de cadenas en Python interrumpe la comparación en el primer byte desigual, introduciendo micro-variaciones de latencia correlacionadas con el número de caracteres correctos.
- **Mitigación:** Se sustituyó por comparación en tiempo constante utilizando `hmac.compare_digest()`:
  ```python
  import hmac

  if not hmac.compare_digest(password, stored_password):
      self._register_failed_attempt()
      return
  new_hash = bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode("utf-8")
  db.update_user_password(username, new_hash)
  ```

### Hallazgo 3: Fuga de Información y Enumeración de Cuentas
- **Problema:** Existían dos vectores de enumeración:
  1. En `_register_failed_attempt()`, si la consulta no encontraba al usuario, se realizaba una búsqueda auxiliar y se agregaba una pista al diálogo: `(Usuario inicial por defecto: admin / contraseña: admin)`, delatando la existencia de la cuenta inicial.
  2. Si el usuario ingresado no existía en la base de datos, el método retornaba en ~1 ms. Si el usuario existía, se ejecutaba `bcrypt.checkpw()`, tomando ~150 ms de CPU. Esta brecha permitía a un atacante enumerar nombres de usuario válidos mediante análisis temporal.
- **Mitigación:**
  - Se eliminó toda fuga de texto descriptivo en los mensajes de error, unificando la respuesta a `Credenciales incorrectas`.
  - Se implementó un hash sintético `_DUMMY_BCRYPT_HASH`. Cuando el usuario no existe o está inactivo, el proceso ejecuta de forma transparente una llamada a `bcrypt.checkpw()` con la contraseña enviada, nivelando el tiempo de respuesta independientemente de si la cuenta existe o no:
  ```python
  _DUMMY_BCRYPT_HASH = "$2b$12$QuQbPRz8cMD8WfD2ULoIR.d6LT1WVd1A/GpO8nImfJ8yrOrE6rXVi"

  if not user or user.get("Status") != "Active":
      try:
          bcrypt.checkpw(password_bytes, self._DUMMY_BCRYPT_HASH.encode("utf-8"))
      except Exception:
          pass
      self._register_failed_attempt()
      return
  ```

### Hallazgo 4: Denegación de Servicio (DoS) por Entradas Desmedidas
- **Problema:** En PyQt6, las operaciones de interfaz corren en el hilo principal a menos que se deleguen a hilos de trabajo. Si un atacante o script ingresaba cadenas de texto extremadamente largas (decenas o cientos de kilobytes) en el campo de contraseña, el algoritmo `bcrypt` consumía ciclos masivos de CPU para procesar el payload, congelando la interfaz gráfica y degradando el servicio local.
- **Mitigación:** Se introdujo una guarda de longitud previa a cualquier cálculo criptográfico:
  ```python
  if len(password) > 128:
      self._register_failed_attempt()
      return
  ```

---

## 5. La Matriz de Evidencia y Pruebas Anti-Regresión

Para garantizar que las correcciones no fueran cosméticas, se implementó una batería de pruebas automatizadas con `unittest` en `tests/test_auth_security.py` utilizando instancias aisladas de `SQLiteRepository` en directorios temporales:

| Prueba Implementada | Vector de Seguridad Evaluado | Comportamiento Verificado |
| :--- | :--- | :--- |
| `test_active_user_authentication_success` | Credenciales válidas de usuario activo con hash `bcrypt` | Autenticación correcta, apertura del menú y reinicio de intentos |
| `test_inactive_user_authentication_blocked` | Credenciales válidas pero cuenta en estado `Inactive` | Acceso denegado, menú bloqueado e incremento de reintentos |
| `test_get_user_role_blocks_inactive_users` | Consulta de rol para usuario inactivo | Retorna `None`, bloqueando el acceso a módulos protegidos |
| `test_dos_long_password_rejected_immediately` | Contraseña que supera los 128 caracteres | Rechazo antes de consultar la base de datos o invocar `bcrypt` |
| `test_legacy_plaintext_password_migrates_to_bcrypt` | Autenticación de contraseña legada | Verificación constante y actualización atómica a `bcrypt` en BD |
| `test_wrong_password_rejected` | Contraseña inválida para usuario existente | Rechazo homogéneo sin filtrar detalles internos |
| `test_nonexistent_user_rejected_without_enumeration` | Intento de login con usuario inexistente | Mensaje homogéneo idéntico y sin revelación de cuentas |
| `test_rate_limiting_lockout_after_max_attempts` | Tres intentos fallidos consecutivos | Bloqueo temporal estricto de la interfaz por 30 segundos |

### Ejecución de Pruebas
```text
Ran 8 tests in 8.343s

OK

Ran 94 tests in 9.313s

OK
```
La totalidad de las pruebas de seguridad y las 94 pruebas preexistentes del sistema pasaron exitosamente, confirmando cero regresiones en ventas, inventario, reportes y utilidades.

---

## 6. Conclusiones y observaciones

1. **La trampa del código aparentemente seguro:** Un sistema puede utilizar los mejores estándares criptográficos del mercado (`bcrypt`) y estar completamente libre de inyecciones SQL, y aún así contener fallas críticas de autorización en sus estados de negocio.
2. **Efectividad del análisis por fronteras:** La metodología de `security-regression-guard` fuerza al modelo a verificar no solo la sintaxis, sino el ciclo de vida de la entidad (`Active`/`Inactive`), los canales laterales de temporización y la contención de recursos (DoS).
3. **Portabilidad entre entornos:** Este caso de estudio valida que la skill opera con igual rigor tanto en entornos web cliente-servidor (SaaS multi-tenant en PHP/Laravel) como en aplicaciones de escritorio nativas (Python/PyQt6 con SQLite local-first).
