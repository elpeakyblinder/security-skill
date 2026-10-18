# Caso de Estudio Real: Blindaje Integral de un Módulo Corporativo de Nómina y Comisiones

> **Validación práctica asistida por IA**  
> **Autor:** Guijosa Dev  
> **Entorno:** Deno 2 / Oak / TypeScript / MongoDB / React 18 / Node.js / Cloudflare Tunnel  
> **Tipo de aplicación:** Sistema financiero interno (SPA + API REST) con base de datos propia y lectura de ERP principal  
> **Herramienta:** Google Antigravity (Modelo con razonamiento extendido)  
> **Skill aplicada:** [`security-regression-guard`](../security-regression-guard/SKILL.md)

---

## 1. Resumen Ejecutivo

Este caso de estudio documenta la auditoría y el blindaje de un módulo web corporativo encargado de calcular nóminas semanales, comisiones de venta y cobranza, préstamos, financiamientos, recibos de pago y reportes ejecutivos. La arquitectura consta de una SPA en React servida detrás de un túnel inverso (Cloudflare Tunnel) que encamina las peticiones `/api/*` hacia un backend en Deno + Oak conectado a su propia base documental en MongoDB y, en modo de estricta solo lectura, a la base de datos del ERP central de la organización.

El módulo ya contaba con varias defensas implementadas: cookies `HttpOnly` con `SameSite=Lax`, sesiones persistidas en MongoDB mediante tokens opacos hasheados con `SHA-256`, derivación de contraseñas con `PBKDF2-SHA256` (210 000 iteraciones) y comparación en tiempo constante, un limitador de intentos de login en memoria y un sistema de tres niveles de acceso (`direccion`, `nomina` y `consulta`) validado en cada petición contra la base de datos.

Al auditar el proyecto con la metodología de **`security-regression-guard`**, trazando extremo a extremo el ciclo de sesión, los permisos por nivel, la inmutabilidad de los periodos contables cerrados y el artefacto real expuesto por el túnel, se identificaron y corrigieron **diez vulnerabilidades técnicas**:

### Fase 1: Perímetro, Sesión y Limitador de Intentos
1. **Evasión del limitador de login por desalojo FIFO en memoria (`Map`) y cabeceras de IP falsificables:** El limitador aceptaba `cf-connecting-ip` / `x-forwarded-for` sin verificar si la conexión provenía del proxy local, comprobaba la llave `usuario:ip` antes que la llave `ip` y desalojaba la entrada más antigua del `Map` (`MAX_BUCKETS = 5 000`) sin preservar bloqueos activos. Un atacante desde una misma IP podía enviar 5 001 usuarios ficticios para expulsar su propio registro de bloqueo y reiniciar su contador indefinidamente.
2. **Cookies de sesión sin expiración explícita (`Max-Age`) ni bandera `Secure` tras túnel HTTPS, y escrituras sin validación de `Origin`:** La cookie dependía del cierre del navegador, carecía de `Secure` automático bajo HTTPS y las rutas de mutación (`POST`, `PUT`, `PATCH`, `DELETE`) no exigían un `Origin` permitido ni cabeceras defensivas (`X-Frame-Options`, `X-Content-Type-Options`).
3. **Hashes heredados `bcrypt` sin migración transparente y contraseña fija de respaldo en scripts de migración:** Las cuentas migradas conservaban indefinidamente hashes `$2b$` de menor costo relativo y el script CLI de migración contenía una contraseña predecible en texto claro como valor por defecto.

### Fase 2: Autorización de Reportes, Inmutabilidad Contable y Validación NoSQL
4. **Fuga de acumulados salariales en reporte individual (`nomina_por_colaborador`):** Mientras los reportes globales por periodo y mes estaban restringidos al nivel `direccion`, el reporte acumulado por colaborador había quedado accesible para los niveles `nomina` y `consulta`, permitiendo reconstruir percepciones anuales y bonos de toda la plantilla.
5. **Mutación transversal de periodos contables cerrados (`approved` / `paid`) y escrituras colaterales en peticiones `GET`:** Renombrar una cuenta en el expediente de un empleado ejecutaba un `updateMany` sobre todos los renglones históricos de nómina sin filtrar por `status: 'draft'`, alterando periodos ya aprobados o pagados. Además, `GET /api/payroll/periods` disparaba una captura automática en base de datos incluso cuando quien consultaba tenía nivel de solo lectura (`consulta`).
6. **Inyección de expresiones regulares (`$regex`) y cuerpos JSON sin límite de tamaño:** El buscador de colaboradores concatenaba la cadena del usuario directamente en una consulta `$regex` de MongoDB sin escapar metacaracteres (vector de ReDoS), y los endpoints JSON carecían de un tope de lectura por flujo antes del parseo.
7. **Asignación sin lista blanca en reglas de corte/cálculo y exposición de errores internos (`500`):** Los servicios de reglas pasaban objetos del cuerpo directamente a `$set` en MongoDB, y el manejador global de excepciones devolvía `error.message` crudo al cliente en fallos `500`.

### Fase 3: Aislamiento del Bundle, Impresión Segura y Servidor de Producción
8. **Exposición de catálogos salariales reales en el bundle del frontend y permisos excesivos de lectura en Deno:** Dos catálogos estáticos de migración con sueldos, comisiones y préstamos reales residían dentro de `frontend/src/.../data/` y el backend tenía `--allow-read=../frontend`, exponiendo datos sensibles al empaquetador del cliente.
9. **Inyección HTML (DOM XSS) en ventana de impresión de recibos:** La utilidad que abría `window.open` e inyectaba el documento con `document.write` interpolaba el título y la escala CSS sin escapar caracteres HTML ni validar que el factor de escala fuera numérico.
10. **Servidor de desarrollo (`WebpackDevServer`) expuesto detrás del túnel público:** El script de arranque levantaba el frontend con el servidor de desarrollo no optimizado, exponiendo código fuente sin minificar y mapas `.map` a través del túnel. Se reemplazó por un servidor ligero de producción en Node.js que sirve el build compilado, bloquea archivos `.map`, inyecta cabeceras de seguridad en el HTML y hace proxy hacia la API local.

---

## 2. Escenario inicial: protecciones presentes frente a fronteras reales

### Contexto de la aplicación
El módulo opera con dos conexiones a MongoDB:
1. **Base de datos propia del módulo (lectura y escritura):** Almacena sesiones, usuarios del módulo, reglas de cálculo, expedientes de cuentas/préstamos y periodos de nómina (`draft`, `approved`, `paid`).
2. **Base de datos del ERP principal (solo lectura estricta):** Se consulta puntualmente para importar ventas, cobranza y catálogos de personal. Por regla de negocio y arquitectura, el módulo tiene estrictamente prohibido modificar cualquier colección del ERP central.

### La apariencia de seguridad
Una revisión superficial del repositorio mostraba controles modernos:
- Contraseñas nuevas derivadas con `PBKDF2-SHA256` y comparadas con `timingSafeEqual`.
- Middleware global `blockConsultaWrites` para impedir que el nivel `consulta` ejecutara métodos `POST`, `PUT`, `PATCH` o `DELETE`.
- Un limitador `LoginRateLimiter` con ventana de 15 minutos, bloqueo de 15 minutos tras 5 fallos y tope de `MAX_BUCKETS = 5_000`.

Sin embargo, al evaluar cómo interactuaban estas piezas ante entradas maliciosas o flujos cruzados, surgieron brechas entre la intención del código y su comportamiento efectivo.

---

## 3. La Intervención con `security-regression-guard`

Siguiendo el mapa de fronteras de la skill, la auditoría se dividió en cinco ejes sin tocar ni alterar la base de datos del ERP principal:

1. **Trazabilidad de efectos por método y estado:** Verificar que ninguna ruta `GET` escribiera en la base de datos para usuarios de consulta y que ninguna actualización de catálogo alterara periodos contables cerrados (`approved` o `paid`).
2. **Resiliencia del limitador de intentos bajo inundación:** Analizar qué ocurre cuando un atacante desde una misma IP envía miles de nombres de usuario distintos contra un `Map` acotado en memoria.
3. **Matriz de visibilidad en reportes y tableros:** Contrastar cada reporte del catálogo contra la política de niveles (`direccion` vs. `nomina` / `consulta`).
4. **Higiene de entradas y consultas documentales:** Acotar el tamaño de lectura del stream HTTP antes de `JSON.parse`, escapar metacaracteres en `$regex` y aplicar listas blancas en actualizaciones de MongoDB.
5. **Frontera entre servidor de desarrollo y artefacto publicado:** Retirar datos reales del árbol `frontend/src`, restringir `--allow-read` del proceso Deno y servir un build estático de producción con cabeceras de seguridad en el origen HTML.

---

## 4. Hallazgos Concretos y Mitigaciones Aplicadas

### Hallazgo 1: Evasión del Limitador de Login por Desalojo FIFO (`Map`) y Cabeceras de IP
- **Problema:** En `login-rate-limiter.ts`, `check(username, ip)` evaluaba primero `user:ip` y luego `ip`, y `recordFailure(username, ip)` insertaba ambas llaves en un `Map` cuyo límite (`MAX_BUCKETS = 5_000`) desalojaba siempre `this.buckets.keys().next().value` (orden FIFO de inserción):
  ```typescript
  // Código vulnerable: desaloja el primer elemento insertado, aunque esté bloqueado
  if (this.buckets.size > MAX_BUCKETS) {
    const oldestKey = this.buckets.keys().next().value;
    if (oldestKey) this.buckets.delete(oldestKey);
  }
  ```
  Si una IP quedaba bloqueada (`ip:203.0.113.5`), bastaba con enviar 5 000 peticiones con usuarios aleatorios (`u1`..`u5000`) para llenar el mapa y expulsar la entrada `ip:203.0.113.5`, levantando el bloqueo de inmediato. Además, la ruta de login leía `x-forwarded-for` directamente sin comprobar si la petición venía del proxy local.
- **Mitigación:**
  1. Se creó `resolveClientIp(context)` para aceptar `cf-connecting-ip` / `x-forwarded-for` **únicamente** cuando la conexión TCP directa proviene de loopback (`127.0.0.1` o `::1`, donde reside el demon local de Cloudflare Tunnel).
  2. En `LoginRateLimiter`, se evalúa primero el cubo de la IP (`ip:<addr>`), se refresca el orden de acceso (LRU) mediante `touchBucket()` y, al desalojar, se preserva cualquier cubo con bloqueo vigente (`blockedUntil > now`):
  ```typescript
  private evictOldestUnlocked(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.blockedUntil <= now) {
        this.buckets.delete(key);
        return;
      }
    }
    const oldestKey = this.buckets.keys().next().value;
    if (oldestKey) this.buckets.delete(oldestKey);
  }
  ```

### Hallazgo 2: Endurecimiento de Cookies de Sesión, Validación de `Origin` y Cabeceras HTTP
- **Problema:** La cookie de sesión no enviaba `Max-Age` y dependía de una bandera manual `AUTH_COOKIE_SECURE` que solía quedar en `false`. Las peticiones de escritura tampoco verificaban el encabezado `Origin`.
- **Mitigación:**
  - La configuración detecta automáticamente si los orígenes permitidos incluyen `https://` o si la petición llega con `x-forwarded-proto: https` para añadir `Secure` y `Max-Age=43200` (alineado con las 12 horas de vigencia en base de datos), manteniendo compatibilidad con pruebas en `http://localhost:3010`.
  - El middleware global aplica `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` y `Referrer-Policy: same-origin`, y rechaza con `403` cualquier petición de escritura (`POST`, `PUT`, `PATCH`, `DELETE`) cuyo `Origin` no pertenezca a la lista de confianza.

### Hallazgo 3: Migración Transparente de Hashes `bcrypt` y Eliminación de Contraseña Fija
- **Problema:** Las cuentas importadas en etapas iniciales tenían hashes `$2a$`/`$2b$` y permanecían en ese formato indefinidamente. Además, el script de migración por lotes usaba una contraseña fija por defecto si no recibía variable de entorno.
- **Mitigación:** Tras un login válido contra un hash `bcrypt` heredado, `auth.routes.ts` re-hashea la contraseña en memoria con `PBKDF2-SHA256` (210 000 iteraciones y sal aleatoria de 16 bytes) y actualiza `passwordHash` en la colección local de usuarios del módulo. En el script de migración se reemplazó la clave fija por un valor aleatorio criptográfico (`crypto.randomUUID()`) cuando no se especifica contraseña temporal.

### Hallazgo 4: Restricción del Reporte `nomina_por_colaborador` a Nivel Dirección
- **Problema:** El catálogo de reportes restringía `nomina_por_periodo`, `nomina_por_mes` y `top_colaboradores` a `direccion`, pero omitía `nomina_por_colaborador`, exponiendo la percepción acumulada e historial de pagos de cualquier empleado a usuarios con nivel `nomina` o `consulta`.
- **Mitigación:** Se incluyó `'nomina_por_colaborador'` dentro de `DIRECTION_ONLY_REPORTS` tanto en el validador del servidor (`access-level.ts`) como en el catálogo del cliente (`access.js`), respondiendo `403` ante llamadas directas.

### Hallazgo 5: Inmutabilidad de Periodos Aprobados/Pagados y Guardia en `GET`
- **Problema:**
  1. En `payroll.repository.ts`, cuando RRHH cambiaba el nombre de una cuenta en el expediente de un colaborador, `updateCollaboratorAccount` ejecutaba un `updateMany` sobre `payroll_items` filtrando solo por `area` y `collaboratorKey`, modificando recibos de periodos históricos ya `approved` o `paid`.
  2. En `payroll.routes.ts`, `GET /api/payroll/periods` invocaba `captureCurrentWeekStartCards()` sin verificar si el usuario tenía permiso de escritura (`canModify`), permitiendo que un usuario de `consulta` provocara escrituras en base de datos al abrir el listado.
- **Mitigación:**
  - En `payroll.repository.ts`, se consultan primero los IDs de periodos con `status: 'draft'` y el `updateMany` sobre `payroll_items` se restringe estrictamente a `{ periodId: { $in: draftPeriodIds } }`.
  - En `GET /api/payroll/periods`, la captura inicial solo se ejecuta si `canModify(user.accessLevel)` es verdadero (`direccion` o `nomina`).

### Hallazgo 6: Sanitización de `$regex` en MongoDB y Límite de Cuerpo JSON por Stream
- **Problema:** El buscador de colaboradores inyectaba `search.trim()` directamente en `{ $regex: search.trim(), $options: 'i' }`. Además, `context.request.body.json()` leía cuerpos de tamaño ilimitado en memoria.
- **Mitigación:**
  - Se añadió `escapeRegex(value)` (`value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`) y se acotó la búsqueda a 120 caracteres antes de consultar MongoDB.
  - Se implementó `readBoundedJsonBody(context, maxBytes)` leyendo el `ReadableStream` por fragmentos y abortando con `413 Payload Too Large` si supera **64 KB** en rutas ordinarias (o **22 MB** únicamente en las dos rutas de importación de libros Excel en Base64).

### Hallazgo 7: Lista Blanca en Reglas de Cálculo y Ocultamiento de Errores `500`
- **Problema:** `saveCutRule` y `validateRule` persistían propiedades adicionales enviadas en el payload JSON, y los bloques `catch` devolvían `error.message` crudo cuando el código de estado era `500`.
- **Mitigación:** Se construyeron objetos explícitos campo por campo (validando días de semana `0..6`, horas `HH:MM` y montos numéricos finitos) y se enmascararon los mensajes de estado `500` con un mensaje genérico seguro en la respuesta HTTP, conservando el detalle en el log del servidor.

### Hallazgo 8: Retiro de Catálogos Salariales del Frontend y Permisos Mínimos en Deno
- **Problema:** Dos archivos con datos reales de nómina de septiembre se encontraban en `frontend/src/features/payroll/data/` y el `deno.json` del backend incluía `--allow-read=./,../frontend`.
- **Mitigación:** Se movieron ambos catálogos a `backend/features/payroll/data/`, se eliminó el índice sin uso en el frontend y se restringió `backend/deno.json` exclusivamente a `--allow-read=./`.

### Hallazgo 9: Escapado HTML en Impresión de Recibos
- **Problema:** `printReceiptSheets` en `print-receipt-sheets.js` interpolaba `${title}` y `${scale}` dentro de una plantilla HTML pasada a `printWindow.document.write(...)`.
- **Mitigación:** Se añadió `escapeHtml(title)` para neutralizar `&`, `<`, `>`, `"` y `'`, y se validó que `scale` sea un número finito dentro del rango `[0.25, 2]`.

### Hallazgo 10: Servidor de Producción Estático con Proxy Local y Bloqueo de `.map`
- **Problema:** Levantar el proyecto con `WebpackDevServer` (`pnpm start`) en el servidor mostraba avisos de compilación no optimizada y exponía el código fuente original a través del túnel.
- **Mitigación:** Se configuró `GENERATE_SOURCEMAP=false`, se creó `frontend/server-prod.js` en Node.js (sin dependencias externas) para servir `frontend/build` en el puerto `3010`, bloquear cualquier ruta terminada en `.map` (`404`), inyectar cabeceras de seguridad en el HTML/activos estáticos y reenviar `/api/*` a `http://127.0.0.1:8036`. El script de arranque (`.bat` / `.ps1`) se actualizó para compilar automáticamente el build de producción cuando detecta cambios y levantar el servidor productivo.

---

## 5. Matriz de Evidencia y Pruebas Anti-Regresión

Se ejecutó la suite automatizada de Deno (`deno test`) junto con verificaciones de compilación y cabeceras sobre el servidor productivo:

| Prueba / Verificación | Vector Evaluado | Resultado Observado |
| :--- | :--- | :--- |
| `access-level.test.ts`: niveles `direccion`, `nomina`, `consulta`, `ninguno` | Permisos de lectura, escritura (`canModify`) y acceso a reportes financieros | `ok` — `nomina` y `consulta` bloqueados en `nomina_por_colaborador`; solo `direccion` y `nomina` pueden modificar |
| `LoginRateLimiter` anti-desalojo por inundación | Bloquear una IP con 5 fallos y enviar 6 000 intentos con usuarios distintos (`fake_0`..`fake_5999`) | `ok` — el cubo bloqueado de la IP no es desalojado del `Map` y `check('real_user', attackerIp)` sigue bloqueado (`allowed: false`) |
| Verificación estática de tipos (`deno task check`) | Integridad de tipos en rutas, repositorios, servicios y modelos tras restringir `--allow-read=./` | `ok` — 0 errores de compilación TypeScript |
| Suite completa del backend (`deno test`) | 44 pruebas unitarias y de dominio (reglas de cálculo, historial de cuentas, referencias de almacén, reportes, permisos y rate-limiter) | `ok` — 44 passed, 0 failed |
| Build de producción (`pnpm run build`) + `server-prod.js` | Cero archivos `.map` generados, respuesta `200 OK` en `/login` y cabeceras `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` en el documento HTML | `ok` — verificado en `http://localhost:3010/login` |

---

## 6. Conclusiones y Lecciones Aprendidas

1. **Acotar el tamaño de un `Map` en memoria no basta si el desalojo es FIFO:** Un limitador de intentos que comparte estructura entre llaves `ip` y `usuario:ip` y desaloja el elemento más antiguo permite a un atacante vaciar su propio castigo inundando llaves secundarias. Evaluar primero la IP, usar orden LRU y proteger los cubos con `blockedUntil > now` cierra esa vía.
2. **La inmutabilidad contable debe protegerse también de efectos laterales:** Aunque el endpoint directo para editar un periodo verifique que esté en `draft`, una actualización masiva (`updateMany`) disparada al editar un catálogo maestro puede sobrescribir periodos históricos cerrados si no incluye el predicado de estado.
3. **Las rutas `GET` con inicialización perezosa rompen el modelo de solo lectura:** Si una consulta crea registros faltantes o instantáneas semanales al vuelo, debe comprobar primero si el usuario tiene capacidad de escritura o limitarse a leer cuando actúa un perfil de consulta.
4. **No usar servidores de desarrollo como servidores de publicación detrás de túneles:** Reemplazar `WebpackDevServer` por un servidor estático ligero con proxy interno elimina la exposición de código fuente y sourcemaps sin cambiar los puertos ni la configuración del túnel externo.
