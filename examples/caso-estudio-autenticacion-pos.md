# Caso de Estudio Real: Blindaje Integral de Autenticación, Ciclo de Sesión y Control de Acceso

> **Validación práctica en producción asistida por IA**  
> **Autor:** Guijosa Dev  
> **Entorno:** Python 3.10+ / PyQt6 / SQLite (Local-First) y MySQL / Bcrypt  
> **Tipo de aplicación:** Escritorio / Terminal Punto de Venta (POS)  
> **Herramienta:** Google Antigravity (Modelo con razonamiento extendido)  
> **Skill aplicada:** [`security-regression-guard`](../security-regression-guard/SKILL.md)

---

## 1. Resumen Ejecutivo

Este caso de estudio documenta la auditoría y blindaje de extremo a extremo del flujo de autenticación, ciclo de vida de sesión y perímetro de navegación en un sistema de Punto de Venta (POS) de escritorio desarrollado en Python y PyQt6 con persistencia dual (SQLite local-first y MySQL remoto).

A simple vista, el módulo de login y verificación de credenciales cumplía con las directivas estándar de seguridad: utilizaba la biblioteca criptográfica `bcrypt` para el almacenamiento y comparación de contraseñas, y todas las consultas hacia SQLite y MySQL estaban parametrizadas con marcadores de posición (`%s` / `?`), descartando inyecciones SQL. Por ende, revisiones preliminares o escaneos automáticos de código daban el módulo por seguro.

Sin embargo, al ejecutar la skill **`security-regression-guard`** sobre la puerta de entrada (Login) y el perímetro de ejecución (Menú principal y subventanas), el análisis sistemático de fronteras de acceso expuso siete fallas de seguridad distribuidas en dos fases críticas:

### Fase 1: Puerta de Entrada y Criptografía (Login)
1. **Evasión de estado de cuenta deshabilitada:** Empleados dados de baja o suspendidos (`Status = 'Inactive'`) podían seguir iniciando sesión y conservaban privilegios si conocían la contraseña, dado que el login ignoraba el campo de estado.
2. **Ataque de temporización (Timing Attack) en contraseñas legadas:** Las contraseñas en migración desde texto plano se comparaban mediante el operador estándar `!=`, vulnerable a análisis de tiempos de interrupción por byte.
3. **Fuga de información y vector de enumeración de usuarios:** Respuestas de error disonantes que revelaban la existencia de usuarios por defecto, y discrepancias de latencia medibles entre cuentas existentes e inexistentes frente a `bcrypt`.
4. **Denegación de servicio (DoS) por entradas no acotadas:** Ausencia de un límite superior de longitud en la contraseña antes de delegar el procesamiento a las costosas rondas de hashing de `bcrypt`, permitiendo degradar el hilo principal de la interfaz gráfica.

### Fase 2: Perímetro de Navegación y Sesión en Caliente (Menú y Subventanas)
5. **Falta de revocación en caliente en módulos operativos:** Un empleado cuya cuenta era marcada como `Inactive` mientras mantenía la aplicación abierta podía continuar operando el Punto de Venta y realizando Cortes de Caja indefinidamente.
6. **Ausencia de defensa en profundidad en subventanas sensibles:** Ventanas administrativas de alto impacto (`MainGestion`, donde se administran usuarios y claves) no comprobaban el rol en su constructor, dependiendo exclusivamente de la contención del menú.
7. **Riesgo de ventanas y diálogos huérfanos tras cierre de sesión:** Diálogos secundarios no modales podían permanecer abiertos en memoria tras ejecutar el logout.

Guiado por la metodología de la skill, se corrigió la lógica en la capa de consultas, el widget de autenticación, el menú principal y las subventanas, implementando **10 pruebas automatizadas de regresión** con datos sintéticos y una base de datos SQLite aislada, logrando la aprobación total sin alterar los 96 casos de prueba globales del sistema.

---

## 2. Escenario inicial: funcionalidad frente a fronteras de seguridad

### Contexto de la aplicación
El sistema es una aplicación de terminal punto de venta con arquitectura cliente/escritorio diseñada para soportar modo desconectado local (SQLite) y conexión centralizada (MySQL). El acceso a áreas críticas del negocio (gestión de inventario, cortes de caja, administración de personal y métricas financieras) se reserva para usuarios con rol `Administrativo`, mientras que los cajeros operan bajo rol `Empleado`.

### La apariencia de seguridad
El código previo presentaba la siguiente estructura:
- En `Auth/login.py`: Uso de `bcrypt.checkpw()` para validar hashes `$2b$`, consultas SQL parametrizadas y bloqueo local tras 3 intentos fallidos consecutivos.
- En `Screens/Menu.py`: Doble validación en tiempo real para módulos administrativos (`_is_admin()`), ocultando tarjetas y atajos para empleados.

A pesar de contar con estos componentes defensivos, el flujo nominal no garantizaba que las invariantes de autorización de la empresa se cumplieran de forma integral durante todo el ciclo de vida de la sesión. Los modelos generativos e inspectores sintácticos con frecuencia asumen que la presencia de `bcrypt` y el ocultamiento visual de botones bastan, omitiendo la revocación reactiva en caliente y la defensa en profundidad en las capas internas.

---

## 3. La Intervención con `security-regression-guard`

La auditoría se ejecutó aplicando la metodología de la skill sobre los módulos de autenticación y navegación:

```text
/security-regression-guard Audita y refuerza el login y el menú principal
```

Siguiendo las directrices de la skill, el agente estructuró la revisión alrededor de las fronteras de seguridad:

1. **Trazabilidad de la operación:** Mapear `Entrada de usuario -> Validación de formato -> Consulta de identidad -> Verificación criptográfica -> Comprobación de estado -> Sesión en menú -> Ejecución de módulos -> Cierre de sesión`.
2. **Ciclo de vida y vigencia en caliente:** Comprobar si cuentas inactivas, suspendidas o eliminadas pueden ejecutar acciones en cualquier punto de la vida del proceso de escritorio.
3. **Tiempo constante en comparaciones:** Identificar cualquier bifurcación o atajo de evaluación condicional en secretos.
4. **Mitigación de enumeración:** Garantizar respuestas uniformes en mensajes y en consumo de CPU entre cuentas existentes y no existentes.
5. **Defensa en profundidad:** Evitar que los controladores internos o ventanas secundarias deleguen ciegamente su autorización en la pantalla anterior.
6. **Contención de recursos e interfaz:** Acotar payloads de entrada y asegurar el cierre exhaustivo de objetos de interfaz al destruir la sesión.

---

## 4. Hallazgos Concretos y Mitigaciones Aplicadas

### Fase 1: Puerta de Entrada y Criptografía (Login)

#### Hallazgo 1: Evasión de Estado de Cuenta (`Status = 'Inactive'`)
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

#### Hallazgo 2: Ataque de Temporización en Migración de Contraseñas Legadas
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

#### Hallazgo 3: Fuga de Información y Enumeración de Cuentas
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

#### Hallazgo 4: Denegación de Servicio (DoS) por Entradas Desmedidas
- **Problema:** En PyQt6, las operaciones de interfaz corren en el hilo principal a menos que se deleguen a hilos de trabajo. Si un atacante o script ingresaba cadenas de texto extremadamente largas (decenas o cientos de kilobytes) en el campo de contraseña, el algoritmo `bcrypt` consumía ciclos masivos de CPU para procesar el payload, congelando la interfaz gráfica y degradando el servicio local.
- **Mitigación:** Se introdujo una guarda de longitud previa a cualquier cálculo criptográfico:
  ```python
  if len(password) > 128:
      self._register_failed_attempt()
      return
  ```

---

### Fase 2: Perímetro de Navegación y Sesión en Caliente (Menú y Subventanas)

#### Hallazgo 5: Falta de Revocación en Caliente en Módulos de Cajero
- **Problema:** Si un usuario era dado de baja o marcado como `Inactive` en la base de datos mientras mantenía abierta la ventana del menú principal, los módulos de Punto de Venta (`show_punto_de_venta`) y Corte de Caja (`show_corte`) no validaban la vigencia de la cuenta. El usuario despedido podía continuar registrando ventas y cortes hasta que cerrara manualmente la aplicación.
- **Mitigación:** Se implementaron las guardas reactivas `_is_session_active()` y `_require_active_session()` en `Screens/Menu.py`. Cada apertura de cualquier módulo comprueba en tiempo real que la cuenta continúe con `Status = 'Active'`. Si fue desactivada, bloquea la acción, emite una alerta de sesión expirada y cierra la sesión de inmediato:
  ```python
  def _require_active_session(self):
      if not self._is_session_active():
          MessageBoxStyle.mostrar_mensaje(
              "Sesión Expirada",
              "Tu cuenta ha sido desactivada o tu sesión ha expirado. Comunícate con un administrador.",
              "critical",
          )
          self.close()
          return False
      return True
  ```

#### Hallazgo 6: Ausencia de Defensa en Profundidad en Subventanas Sensibles
- **Problema:** La ventana `MainGestion` (donde reside el control de usuarios, creación de credenciales y roles) no validaba el rol del usuario en su constructor `__init__()`. Confiaba 100% en que el menú anterior hubiera invocado `_require_admin()`. Si en un refactor futuro se instanciaba la pantalla desde otra vía, la protección perimetral desaparecía.
- **Mitigación:** Se incorporó una validación interna en `MainGestion.__init__()` que consulta la base de datos y lanza de inmediato `PermissionError` si el usuario no tiene rol `Administrativo` activo:
  ```python
  # Screens/Gestion.py
  if self.username and hasattr(self.db, 'get_user_role'):
      role = self.db.get_user_role(self.username)
      if role != "Administrativo":
          raise PermissionError(
              f"Acceso no autorizado: el usuario '{self.username}' no tiene permisos de Administrador para este módulo."
          )
  ```

#### Hallazgo 7: Riesgo de Ventanas y Diálogos Huérfanos tras Cierre de Sesión
- **Problema:** Al cerrar sesión (`closeEvent`), el método `_close_all_subwindows()` únicamente iteraba sobre una lista estática de formularios principales. Si alguna subventana había dejado abiertos diálogos secundarios no modales o cuadros de confirmación, estos podían quedar visibles en el escritorio tras volver a la pantalla de login.
- **Mitigación:** Se amplió la rutina de cierre para inspeccionar y terminar de forma exhaustiva cualquier widget hijo que opere como ventana independiente en memoria:
  ```python
  for child in self.findChildren(QtWidgets.QWidget):
      if child.isWindow() and child is not self and child is not self.login_widget:
          if child.isVisible():
              child.close()
  ```

---

## 5. La Matriz de Evidencia y Pruebas Anti-Regresión

Para certificar todas las fronteras corregidas, se implementó una suite automatizada con `unittest` en `tests/test_auth_security.py` utilizando instancias aisladas de `SQLiteRepository` en directorios temporales:

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
| `test_menu_session_revocation_blocks_pos_and_corte` | Baja en caliente de usuario con menú abierto | Bloqueo reactivo inmediato en POS, Corte e Inventario con alerta de sesión expirada |
| `test_gestion_defense_in_depth_raises_permission_error_for_non_admin` | Inicialización de `MainGestion` con rol no administrativo | Lanzamiento obligatorio de `PermissionError` en constructor |

### Ejecución de Pruebas
```text
Ran 10 tests in 8.932s

OK

Ran 96 tests in 9.856s

OK
```
La totalidad de las pruebas de seguridad y las 96 pruebas preexistentes del sistema pasaron exitosamente, confirmando cero regresiones en ventas, inventario, reportes, cortes y utilidades.

---

## 6. Conclusiones y observaciones

1. **La trampa del código aparentemente seguro:** Un sistema puede utilizar los mejores estándares criptográficos del mercado (`bcrypt`) y estar completamente libre de inyecciones SQL, y aún así contener fallas críticas de autorización en sus estados de negocio.
2. **La seguridad es un ciclo de vida continuo:** La verificación de permisos no concluye en el login. En aplicaciones de escritorio que permanecen abiertas durante turnos prolongados, la revalidación reactiva en caliente es imprescindible para reflejar suspensiones o revocaciones de credenciales.
3. **Defensa en profundidad en interfaces de usuario:** Ocultar botones o desactivar atajos de teclado en una ventana principal no sustituye la obligación de que cada formulario sensible (`MainGestion`) valide su propia autorización interna.
4. **Portabilidad entre entornos:** Este caso de estudio valida que la skill opera con igual rigor tanto en entornos web cliente-servidor (SaaS multi-tenant en PHP/Laravel) como en aplicaciones de escritorio nativas (Python/PyQt6 con SQLite local-first).
