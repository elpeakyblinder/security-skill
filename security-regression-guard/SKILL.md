---
name: security-regression-guard
license: CC-BY-NC-4.0
metadata:
  version: "0.1.0"
description: Revisa y refuerza autorización, aislamiento de datos, sesiones, archivos y límites de consumo en aplicaciones web y APIs, incluyendo sus clientes móviles. Úsala al auditar seguridad o cambiar estas fronteras. Incluye pruebas de peticiones directas, rutas alternativas y fallos parciales; no convierte un cambio visual ordinario en una auditoría completa.
---

# Seguridad comprobable de aplicaciones web

Convierte la política de acceso del producto en comprobaciones del servidor y pruebas de comportamiento. No des por segura una operación porque su botón esté oculto, porque use una clase de validación o porque la suite anterior pase.

Esta skill generaliza errores reales para prevenirlos en otros proyectos. No depende de archivos, servicios, framework ni conversaciones del proyecto de origen. Los ejemplos ilustran fronteras de seguridad; sus permisos concretos no son políticas universales.

## Alcance y forma de trabajar

1. Lee las instrucciones locales y el estado del repositorio. Identifica lenguaje, framework, autenticación, modelo de permisos, almacenamiento, caché y pruebas. Conserva cambios ajenos y usa el gestor de paquetes y los comandos del proyecto.
2. Identifica qué frontera cambia: autenticación, autorización de una acción, acceso a un objeto, delegación de privilegios, archivo o despliegue. Revisa sus entradas alternativas; no amplíes automáticamente el trabajo a toda la aplicación.
3. Consulta el código vigente antes de afirmar que una protección existe. Un documento o una prueba antigua orienta la búsqueda, pero no demuestra el comportamiento actual.
4. Ejecuta las correcciones y pruebas autorizadas en entornos aislados. Una auditoría no autoriza migrar bases reales, cambiar roles de personas, rotar claves, desplegar ni enviar mensajes externos. No pidas de nuevo permiso para cambios reversibles ya autorizados.
5. Si falta una decisión de negocio, busca la política existente. Expón la ambigüedad concreta si sigue sin resolverse; no inventes privilegios amplios para hacer pasar una prueba.

## 1. Traza la operación completa antes de corregirla

Construye una tabla breve para las operaciones del alcance:

| Operación real | Entradas HTTP y alternativas | Actor habilitado | Permiso | Objeto/empresa | Confirmación adicional | Prueba |
| --- | --- | --- | --- | --- | --- | --- |
| Bloquear una cuenta | Acción de estado y formulario general de edición | Cuenta y rol activos | Permiso de bloquear | Cuenta administrable de la empresa | Según política | Consulta y edición básica no pueden bloquear |
| Iniciar importación | Iniciar, reintentar, rutas antiguas | Administrador protegido, si así se define | Facultad de importar | Fuente y empresa autorizadas | Contraseña actual, si se exige | Rechazo sin crear operación ni escribir datos |

Busca con `rg` los nombres de ruta, métodos, llamadas al servicio y nombres de campos, no solo el texto del botón. Recorre:

`ruta -> middleware -> autorización/validación -> servicio -> consulta/escritura -> respuesta`

Incluye API, formularios AJAX, exportaciones, descargas, acciones masivas, rutas antiguas y trabajos en segundo plano que ejecuten la misma operación. Un nombre como `admin`, `update`, `validate` o `authorize` no demuestra qué comprueba su implementación.

No clasifiques una operación por su nombre o método HTTP: `calculate`, `preview`, `refresh` o `recalculate` pueden guardar resultados, crear revisiones o reemplazar relaciones. Separa el cálculo público de la persistencia protegida cuando tengan permisos diferentes. Comprueba también los efectos que ocurren después de construir la respuesta.

Antes de cada efecto sensible deben quedar comprobados actor, capacidad y alcance. Si hay varios controladores que realizan el mismo cambio, comparte la regla en una política, guard o servicio adecuado; no confíes en que todos recuerden repetirla.

## 2. Permisos: consulta, acciones y delegación

### No confundir fronteras

- Estar autenticado no equivale a tener permiso. Pertenecer al portal administrativo tampoco implica ser administrador del sistema.
- No identifiques privilegios por el nombre visible del rol, por un ID supuesto ni por campos enviados por el cliente. Usa la identidad autenticada y el atributo protegido definido por el servidor.
- Distingue consultar de crear, editar, eliminar, archivar, restaurar, aprobar, rechazar, importar y cambiar estados. Varias acciones pueden compartir un permiso si esa es la política explícita; la matriz debe explicar qué concede.
- No uses un permiso de consulta para escribir. Revisa especialmente importaciones y aprobaciones, que suelen heredar el control del listado.
- Comprueba cambios sensibles dentro de formularios generales: un usuario autorizado a editar una descripción no obtiene por ello autorización para cambiar estado, rol o propietario.
- Rechaza permisos desconocidos y evita conceder acceso como recuperación automática ante tablas o configuraciones ausentes. Si falla la resolución, impide la operación protegida y reporta el problema sin revelar secretos.

### Herencia y excepciones

Expresa primero las reglas del producto. Cuando existan las tres opciones:

- **Heredar:** no crear una concesión individual; seguir los cambios posteriores del rol.
- **Permitir:** crear una excepción individual explícita.
- **Denegar:** bloquear ese permiso aunque el rol lo conceda.

No conviertas todos los permisos marcados de una pantalla en filas `grant`: eso congela permisos heredados y puede neutralizar revocaciones futuras. No interpretes una fila `deny` como una concesión por limitarte a leer su ID.

Las actualizaciones parciales deben conservar las excepciones no enviadas. Distingue campo ausente, lista vacía y orden explícita de borrar. Valida el formulario completo antes de reemplazar filas; usa una transacción. Si la base admite duplicados contradictorios, resuélvelos de forma determinista según la política y revisa una restricción de unicidad antes de aplicarla a datos existentes.

Si el producto exige permiso del módulo para sus acciones, aplica esa dependencia en el servidor además de la interfaz. Activar consulta no debe seleccionar automáticamente todas las acciones. Denegar el módulo debe bloquear también sus acciones concedidas. No introduzcas esta dependencia en otro producto que permita acciones independientes sin revisar su política.

### Administrar a otros usuarios es una capacidad distinta

Cuando la delegación esté limitada a los privilegios del actor:

1. Compara los permisos efectivos del actor con los del destinatario y con el rol solicitado.
2. Comprueba tanto añadir como quitar privilegios. Vaciar un rol superior puede permitir después restablecer la contraseña de sus cuentas.
3. Considera los permisos individuales y las concesiones latentes: quitar una denegación, restaurar la herencia o cambiar de portal puede reactivar permisos que hoy no son efectivos.
4. Protege la bandera del administrador del sistema frente a asignación masiva. No la aceptes desde formularios de creación o edición ordinarios.
5. No borres un rol con cuentas si deja referencias huérfanas. Aplica la política de reasignación y elimina filas relacionadas de forma consistente. Considera claves foráneas y concurrencia si pueden competir asignaciones y borrados.
6. Evita que una edición accidental deshabilite el acceso administrativo necesario. Comprueba el rol de la sesión y la política sobre el último administrador; no inventes una prohibición global de cambiar roles propios si el producto permite hacerlo de forma segura.

La caché de permisos debe tener un alcance conocido. Invalídala al modificar la política y prueba la siguiente solicitud de una sesión existente. Una caché de proceso, como la de un worker persistente, no equivale a una caché por petición. Verifica también cuentas y roles deshabilitados o eliminados.

Adapta estas comprobaciones al modelo existente: roles (RBAC), atributos/contexto (ABAC), listas de acceso por objeto (ACL) o una combinación. Conceder acceso a un rol no elimina condiciones de propiedad, organización, estado o vigencia. No sustituyas una política contextual por una comparación simple de listas de permisos.

## 3. Alcance de los datos y vías de lectura

- Resuelve empresa, pertenencia y persona desde la sesión y las relaciones autorizadas. Un `organization_id`, `reference`, `user_id` o `employee_number` recibido no acredita acceso.
- Aplica el alcance a consultas y escrituras: listado, detalle, edición, evidencia, exportación, descarga, AJAX, métricas y tareas de fondo. Busca el objeto dentro del conjunto autorizado en lugar de cargarlo sin restricciones y olvidar la comprobación posterior.
- Usa la identidad canónica. Números de empleado, nombres o datos heredados pueden repetirse entre empresas. Un filtro por un número visible no sustituye la referencia de persona y empresa.
- Examina reportes, cumpleaños, gráficas y contadores: un tablero puede revelar información de un módulo que el actor no puede consultar. Si un permiso de reportes concede esas lecturas independientemente, documenta ese alcance y pruébalo; no lo cambies silenciosamente.
- Distingue instalación con una sola empresa activa de un producto multitenant. No supongas que elegir una empresa del cliente es válido ni que un administrador global deba saltarse todo aislamiento.
- No filtres información después de serializar una respuesta, descargar un archivo o calcular datos que acabarán en HTML oculto. La comprobación debe proteger la fuente que produce la respuesta.

### Relaciones e integridad al escribir

- Que dos IDs existan no demuestra que puedan relacionarse. En una ruta de recurso y comentario, verifica que el comentario pertenece a ese recurso; aplica lo mismo a respuestas, reacciones, revisiones y adjuntos.
- Deriva la propiedad desde la identidad del servidor. Si falta autor en registros heredados, no asignes al solicitante ni permitas escribir por defecto; usa la política de recuperación o moderación existente.
- Respalda invariantes relevantes con claves foráneas, unicidad y restricciones de dominio cuando el motor lo permita. Una clave foránea simple no asegura que padre e hijo pertenezcan al mismo recurso; puede requerirse una relación compuesta.
- Usa consultas parametrizadas. Valida además tipos, rangos, unidades, longitud y campos editables: parametrizar no evita una asignación masiva ni un valor que desborde el cálculo o la columna.
- Agrupa escrituras dependientes en una transacción real del driver: cuenta/perfil/sesión, recurso/revisión/detalles o reemplazo de un plan. Varias llamadas consecutivas o un lote no garantizan atomicidad. Inyecta un fallo intermedio y comprueba que no queda estado parcial.
- Antes de añadir restricciones a una base existente, identifica duplicados y referencias incompatibles con consultas de diagnóstico. Prueba la cadena de migraciones desde cero y la actualización de un esquema anterior con datos sintéticos; incluye extensiones requeridas. No reescribas migraciones ya aplicadas como única reparación.

## 4. Operaciones sensibles y automatización

Cuando la política requiera rol privilegiado más contraseña actual:

- Verifica ambas condiciones en el servidor antes de conectar, importar, cambiar una fuente o publicar una regla. Usa la contraseña actual del propio actor y el guard de autenticación correcto.
- Rechaza contraseña ausente, de otra cuenta, antigua tras rotación, arrays y valores de tamaño no permitido. Una bandera `confirmed=true` del cliente no acredita confirmación.
- No sustituyas esa política por una confirmación de sesión antigua. En otros productos con reautenticación temporal explícita, respeta su duración y alcance documentados.
- Limita los intentos de confirmación usando el almacenamiento y las claves apropiadas. No reveles contraseñas o PIN en logs, errores, datos recordados del formulario ni respuestas de depuración.
- Deriva autor, empresa, jurisdicción y revisión desde fuentes autorizadas. Acepta únicamente los campos editables; conserva el historial que exija el dominio.

Separa **iniciar** una operación de **continuar** una ya autorizada. Un sondeo o worker puede continuar sin pedir contraseña en cada lote si comprueba operación persistida, actor/capacidad aplicable, empresa, estado y fuente permitidos. No permitas iniciar trabajo nuevo con parámetros arbitrarios. Revisa qué ocurre si se revoca el acceso mientras una operación está en cola y aplica la política elegida.

En un reloj compartido, decidir para quién se registra asistencia es una frontera propia: empleado para sí mismo; registro por otra persona solo con el permiso y la prueba de identidad definidos. Prueba colisiones de números de empleado, PIN incorrecto y respuestas que revelen identidad.

## 5. Archivos, HTML y autenticación: revisar cuando estén en el alcance

### Archivos y datos importados

- Una ruta antigua que escribe archivos sigue siendo una entrada, aunque la interfaz moderna ya no la utilice. Retírala o dirígela al flujo seguro sin conservar la escritura insegura.
- Valida tamaño, contenido y tipos admitidos. Evita guardar con el nombre o la ruta controlados por el cliente; genera nombres y usa almacenamiento que no ejecute archivos subidos.
- Los CSV de importación pueden leerse desde el temporal validado. Aplica límites de filas y columnas antes de procesarlos masivamente. No realices importaciones reales como prueba de autorización.
- Genera exportaciones por solicitud o en almacenamiento privado con acceso autorizado. No uses un archivo público compartido que otra cuenta pueda descargar.
- Usa un escritor CSV correcto y neutraliza fórmulas según el formato de destino. Prueba separadores, comillas, saltos de línea y valores que una hoja de cálculo interpretaría como fórmula.
- Trata texto importado como no confiable. Usa escape del contexto o APIs de texto al renderizar HTML; una base de datos no convierte los datos en contenido seguro.

### Imágenes y almacenamiento de objetos

- Comprueba firma, estructura y tipo real; extensión y MIME declarados son pistas. Una firma correcta no demuestra que el archivo se decodifique. Prefiere un procesador mantenido si necesitas decodificar, transformar o sanear; no improvises un parser binario como solución predeterminada.
- Limita bytes antes de cargar todo en memoria y dimensiones/píxeles antes de procesar. Según el formato, considera cuadros de animación y trabajo descomprimido. Elige los límites según el producto y el runtime, sin copiar cifras de otro proyecto.
- Al publicar fotos personales, revisa metadatos de ubicación, dispositivo y autoría. Si deben retirarse, persiste los bytes saneados; probar una función aislada no demuestra qué llegó al bucket. Conserva orientación y apariencia, y prueba imágenes reales válidas junto con truncadas o malformadas.
- Distingue lectura pública de permiso para subir, reemplazar o borrar. Genera claves no controlables por el cliente y comprueba propiedad antes de eliminar; un prefijo de carpeta por sí solo no acredita quién es el actor.
- Base de datos y bucket no comparten normalmente transacción. Si falla la escritura de la referencia, limpia el objeto recién creado; elimina el anterior solo cuando el reemplazo esté confirmado. Revisa concurrencia y reintentos para no borrar el archivo vigente de otra operación. Define cómo detectar objetos huérfanos.
- Sirve con tipo seguro y protección contra interpretación de contenido, y revisa el acceso/cache según sea público o privado. Valida URLs por componentes y política de origen. HTTPS cifra la conexión, pero no demuestra que un destino sea confiable; si el servidor descarga URLs aportadas por usuarios, revisa además SSRF y redirecciones.

### Contraseñas y ciclo de sesión

- Usa primitivas o bibliotecas mantenidas para derivación de contraseñas, sal aleatoria y comparación segura. Conserva algoritmo y parámetros versionados; consulta recomendaciones actuales y mide el costo en el runtime objetivo. No copies un número de iteraciones como regla eterna ni lo reduzcas para ocultar una mala latencia.
- Migra hashes heredados después de una verificación válida, sin bloquear el login por reglas nuevas de creación de contraseña. Acota tamaños y parámetros de hashes antes de ejecutar trabajo costoso; no trunques contraseñas silenciosamente.
- Revisa enumeración por mensaje, estado HTTP y diferencias de trabajo entre cuenta inexistente, inactiva, hash inválido o heredado. Una comparación constante aislada no iguala toda la solicitud; no intentes demostrar ausencia de filtraciones con una aserción frágil de milisegundos.
- Si la aplicación implementa y persiste sus propios tokens opacos de acceso, genéralos con aleatoriedad criptográfica y guarda su hash para verificarlos sin conservar el secreto en claro. Si usa sesiones gestionadas por un framework o cookies firmadas/cifradas, revisa las garantías de ese mecanismo antes de proponer sustituirlo. Valida formato, expiración, revocación aplicable y estado de cuenta antes de autorizar; no concedas un rol privilegiado cuando falta el campo.
- Comprueba logout, sesiones caducadas y acumulación de sesiones según la política del producto. Borrar la copia del cliente no revoca la del servidor. Prueba también reinicio del cliente y fallos al borrar o escribir credenciales, para evitar restaurar una sesión vieja.
- En clientes nativos, usa el almacén protegido de la plataforma cuando persistas credenciales; elimina copias heredadas en preferencias y revisa backups. Si falla, no vuelvas silenciosamente al texto plano. En web, un almacenamiento accesible a JavaScript, aunque se anuncie como cifrado, no protege frente a XSS; evalúa cookies HttpOnly/Secure/SameSite y CSRF conforme a la arquitectura, sin cambiar el contrato de autenticación por reflejo.

### Login, recuperación y CAPTCHA

- Conserva límites de intentos, respuestas de recuperación que no enumeren cuentas y protección CSRF cuando corresponda a la autenticación utilizada. No habilites registro público como efecto secundario de un refactor.
- Si se solicita Turnstile, valida el token en el backend con Siteverify y comprueba el contexto esperado, caducidad y reutilización. El widget por sí solo no protege una petición directa.
- Prueba token ausente, inválido, repetido, contexto incorrecto y fallo de red. Configura claves de prueba únicamente en pruebas/local; no introduzcas un modo permisivo implícito en producción.
- CAPTCHA reduce automatización; no concede roles ni sustituye autorización o MFA. No añadas CAPTCHA/MFA automáticamente si el usuario solo pidió corregir un permiso.
- Consulta documentación oficial vigente antes de implementar integraciones: [Turnstile: validación del servidor](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

### Consumo, transporte y configuración de la API

- Acota el cuerpo real antes del parseo, incluidos streams sin `Content-Length`; no confíes solo en el tamaño declarado. Define límites apropiados para JSON y multipart, cantidad de elementos, paginación y resultados. Limita también el costo de cálculos públicos que consultan la base.
- Aplica límites de intentos antes del trabajo caro, por IP y por cuenta cuando corresponda; tras autenticar, considera límites por usuario para escrituras y subidas. Evita almacenar identificadores personales en claro en las claves cuando no sea necesario. Evalúa abuso del bloqueo de cuentas y usuarios que comparten IP.
- Obtén la IP desde el proxy/plataforma de confianza, no desde cualquier encabezado reenviado. Comprueba si los contadores son por proceso, región o globales: un limitador local no impone una cuota global estricta.
- Si falta o falla una dependencia de protección requerida en producción, impide la operación protegida y devuelve un error controlado. Un modo local sin esa dependencia debe ser explícito; configuración ausente o desconocida no debe activar excepciones de desarrollo.
- Configura CORS por orígenes completos y métodos/cabeceras necesarios. Compara esquema, host y puerto correctamente; `localhost.ejemplo.com` no es loopback. CORS regula al navegador, no autentica ni impide llamadas directas.
- Exige transporte seguro para credenciales y datos sensibles; limita excepciones locales a hosts concretos. Revisa URLs de API y recursos en el cliente, cookies si existen y configuración efectiva del artefacto de publicación.
- Evita cachear respuestas de autenticación o contenido privado en cachés compartidas. Revisa cabeceras según el tipo de respuesta; no copies una CSP de HTML a una API como sustituto de autorización.
- Devuelve errores útiles sin SQL, trazas, tokens o secretos. Acota y sanea IDs de correlación recibidos y evita registrar cuerpos o cabeceras sensibles. Conserva evidencia operativa del fallo sin exponerla al cliente.
- En serverless, revisa bindings y límites del runtime. Desarrollo y pruebas no deben apuntar accidentalmente a buckets o bases remotas; la generación de tipos y el build deben poder usar configuración de ejemplo sin incorporar secretos.

## 6. Pruebas que detectan el fallo, no solo la presencia del código

Para cada frontera modificada, reproduce una operación real con datos sintéticos. Elige los casos pertinentes:

| Caso | Evidencia necesaria |
| --- | --- |
| Actor autorizado + objeto permitido + entrada válida | La operación funciona y cambia solo lo esperado |
| Actor de consulta + misma petición válida | Rechazo; sin cambios, archivos, jobs ni llamadas externas |
| Acción concedida pero módulo ausente/denegado | Rechazo, si esa dependencia pertenece a la política |
| Mismo rol, objeto existente de otra empresa/persona | Rechazo sin exponer contenido ni modificar el objeto |
| Modificación desde una ruta alternativa o campo general | Mismo límite que en la acción específica |
| Delegado que añade permisos superiores o vacía un rol superior | Rechazo y privilegios intactos |
| Denegación individual retirada o vuelta a herencia | Solo restaura facultades que el actor puede conceder |
| Permiso heredado revocado después de guardar excepciones | Se pierde el acceso; no quedó copiado como `grant` |
| Cuenta/rol deshabilitado o permiso revocado con sesión abierta | La siguiente petición respeta la revocación |
| Formato inválido o fallo durante un reemplazo de permisos | No borra la configuración anterior |
| Operación sensible sin contraseña/CSRF/token exigidos | Rechazo antes de efectos; probar también el caso válido |
| Cálculo público frente a recálculo persistido | Lectura permitida según política; escritura rechazada sin capacidad sobre el objeto, con caso permitido de autor/moderación si corresponde |
| IDs válidos de recursos distintos en comentario/reacción/adjunto | Rechazo y relaciones intactas |
| Fallo intermedio en base o bucket | Sin estado parcial; referencia y archivo anterior recuperables según el flujo |
| Cuerpo excesivo, colección enorme o archivo truncado con firma válida | Rechazo antes del trabajo caro o almacenamiento |
| Foto válida con metadatos sensibles | Objeto realmente almacenado sin esos metadatos y todavía decodificable |
| Dependencia de protección ausente en producción | Error controlado; no ejecuta la operación protegida |
| Token revocado o fallo de almacenamiento seguido de reinicio | No restaura acceso con credenciales antiguas |
| Origen con prefijo parecido al permitido y cliente sin Origin | CORS no concede el origen falso; autorización sigue protegiendo la llamada directa |

Reglas para evitar falsos positivos:

- Las pruebas HTTP de autorización deben ejecutar el middleware relevante. `withoutMiddleware()` no demuestra protección de una ruta.
- Usa un objeto que exista. Un 404 por model binding de un ID inexistente no demuestra aislamiento ni falta de permiso.
- Para probar falta de autorización, envía por defecto un cuerpo válido. Un 422 por un campo ausente no demuestra que el actor esté bloqueado.
- Verifica estado y efectos además del código HTTP. En rutas antiguas puede existir una redirección de denegación: comprueba su destino y que no hubo mutaciones. No cambies el contrato solo para obtener un 403 si no es necesario.
- Algunos frameworks omiten CSRF durante tests. Para una prueba específica, activa la comprobación y demuestra que pasa con token válido y falla sin él. Determina primero si el mecanismo de autenticación de la ruta necesita esa protección.
- Limpia estado global de pruebas: hosts/proxies de confianza, reloj, caché, autenticación y configuración. Usa `finally` si cambias estado estático; no dejes que contamine otros casos.
- Usa base aislada y archivos temporales. Simula servicios externos; verifica que una solicitud rechazada no los invoca. Cuando existan dependencias de concurrencia o del motor de base de datos, no extrapoles una prueba SQLite como demostración de ese comportamiento en producción.
- No escribas una prueba que solo busque la palabra `authorize` en el archivo. Comprueba la decisión y su efecto observable.

Empieza por una regresión que reproduzca el fallo cuando sea viable; añade el caso permitido para evitar arreglos que bloqueen todo. Ejecuta las pruebas específicas y, para cambios en resolución compartida de permisos o middleware, la suite relevante más amplia. Repite solo si hay cambios nuevos, fallos o una incertidumbre concreta. Comprueba tipos/compilación y la interacción real cuando modifiques la interfaz.

## 7. Despliegue: no confundir código local con producción verificada

Revisa configuración y dependencias locales si forman parte del alcance, aunque no vayas a publicar. Las comprobaciones sobre infraestructura real requieren que esa revisión esté autorizada:

- Audita los lockfiles y usa fuentes oficiales para avisos actuales. Registra cuándo y qué se comprobó; cero avisos hoy no garantiza cero vulnerabilidades.
- Comprueba dominio real, TLS, cookies, hosts/proxies confiables y acceso directo al origen. No confíes indiscriminadamente en encabezados reenviados por el cliente.
- Sirve solo el directorio público; evita exponer `.env`, Git, dumps y archivos privados. Impide ejecutar subidas como scripts.
- Con varias instancias, revisa coherencia de sesiones, límites de intentos, caché, archivos y bloqueos de jobs. No supongas que dos bases se sincronizan solas.
- No cambies una clave de cifrado existente para satisfacer un checklist: puede inutilizar sesiones, datos o credenciales cifradas. Separa reparación, rotación y despliegue según el alcance autorizado.
- Al cambiar dependencias de seguridad, comprueba compatibilidad y compilación del destino real. Un paquete más reciente no garantiza que el SDK o runtime del proyecto lo soporte. Evita actualizaciones forzadas que rompan el producto; documenta incompatibilidades verificadas.
- En clientes móviles, inspecciona el manifiesto/configuración fusionados y la firma del artefacto release cuando estén en el alcance. Cambiar el archivo fuente no demuestra que se bloquearon tráfico en claro o backups; compilar un APK tampoco demuestra que tiene firma de distribución.
- Automatiza regresiones y comprobaciones relevantes en CI con permisos mínimos, dependencias reproducibles y configuración sintética. Un dry-run valida el empaquetado, no el acceso efectivo a servicios desplegados.
- Reporta por separado lo probado localmente y lo aún pendiente del servidor. Una prueba de configuración no demuestra firewall, TLS real, backups restaurables ni privilegios efectivos de la base.

## Patrones de regresión para cualquier proyecto

Usa los antecedentes como casos de prueba y adapta el dominio:

| Fallo observado | Corrección que debe conservarse |
| --- | --- |
| Importar catálogos exigía solo consulta | Permiso de crear/importar comprobado antes de procesar |
| Consultar asistencias permitía decidir tiempo extra | Capacidad de decisión separada de consulta |
| Cambiar estado de cuenta carecía de control específico | Comprobación tanto en acción de estado como en edición general |
| Marcar permisos heredados los copiaba como excepciones | Heredar/permitir/denegar explícitos y persistencia diferenciada |
| Un editor podía vaciar un rol superior | Límite de delegación también sobre eliminación/reducción de privilegios |
| El tablero equiparaba portal administrativo con acceso amplio | Datos de cada widget sujetos a la política de consulta |
| Faltaban tablas de permisos y existía una concesión de respaldo | Resolución cerrada ante ausencia de la política |
| Rutas antiguas, reportes y reloj usaban referencias incompletas | Entrada segura compartida y alcance canónico de persona/empresa |
| Un recálculo accesible sin sesión persistía resultados | Clasificar por efectos y comprobar autor/capacidad antes de escribir |
| Un comentario o reacción aceptaba IDs de otro recurso | Validar pertenencia conjunta y respaldar la relación en la base |
| Token persistido en preferencias ordinarias del cliente | Almacén adecuado por plataforma, migración y pruebas de fallo/reinicio |
| Registro o reemplazo de datos dejaba escrituras parciales | Transacción real y compensación para almacenamiento externo |
| Configuración ausente activaba reglas permisivas de desarrollo | Producción cerrada por defecto y excepciones locales explícitas |
| Subidas confiaban en tipo declarado y conservaban metadatos | Validación acotada y comprobación del objeto publicado |
| Lecturas/cálculos/subidas carecían de límites adecuados | Presupuestos de tamaño, cantidad y frecuencia según costo |
| Una migración dependía de una extensión no declarada | Probar instalación limpia y actualización con el motor real |

Por ejemplo, “aprobar tiempo extra” puede ser aprobar un pago, publicar contenido o autorizar una compra. “Empresa” puede ser un cliente, organización o espacio de trabajo. Conserva la frontera de seguridad, no los nombres ni identificadores del ejemplo.

## Criterio de cierre y entrega

Termina cuando las rutas del alcance tengan una política coherente, las regresiones y los casos permitidos pasen, y la interfaz describa lo que el servidor permite. Indica:

- Qué fallo concreto se corrigió y qué acción ahora queda limitada.
- Qué pruebas se ejecutaron y su resultado real.
- Qué datos/configuración real cambiaron, si cambió algo.
- Qué incertidumbre o verificación externa queda pendiente, si existe.

No declares “imposible de burlar”, “100 % seguro” o “listo para producción” basándote únicamente en una suite local. La skill reduce omisiones al hacer explícitas decisiones y pruebas; no sustituye su ejecución ni la revisión de evidencia.

## Autoría, licencia y aviso

© 2026 Guijosa Dev. Texto bajo [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed.es): atribución, uso no comercial e indicación de cambios según sus términos. Permisos comerciales por separado: [devcharlying@gmail.com](mailto:devcharlying@gmail.com). Consulta el [texto jurídico oficial](https://creativecommons.org/licenses/by-nc/4.0/legalcode.es).

Creada a partir de experiencia personal; lee y evalúa las instrucciones antes de usarlas. Se proporciona tal cual, sin garantías de seguridad, exactitud o idoneidad. Los agentes pueden equivocarse: revisa sus acciones y resultados. En la máxima medida permitida por la ley aplicable, el autor y los colaboradores excluyen responsabilidad por daños derivados del uso del material. Esta exclusión no elimina derechos o responsabilidades que legalmente no puedan excluirse, ni modifica los términos de la licencia. No constituye asesoría profesional ni una garantía de inmunidad jurídica.

Quien utiliza la skill es responsable, dentro de su ámbito de actuación y control, de evaluar sus recomendaciones, configurar y supervisar al agente, validar los resultados y decidir qué optimizaciones, cambios o acciones autoriza y aplica. Delegar tareas a una IA no sustituye esa evaluación. Esta declaración no excluye responsabilidades que la ley no permita excluir ni modifica la licencia.
