# Caso de Estudio Real: Migración de Autenticación a Rust y Cierre de Huecos Heredados en un Buscador de Empleo

> **Validación práctica asistida por IA**  
> **Autor:** Guijosa Dev  
> **Entorno:** Astro 7 / React 19 / TypeScript / Rust (Axum, sqlx) / Neon PostgreSQL / Vercel  
> **Tipo de aplicación:** Buscador de vacantes con cuentas de usuario, perfil profesional y búsqueda en vivo en seis portales de empleo  
> **Herramienta:** Claude Code (modelo Opus 5.5)  
> **Skill aplicada:** [`security-regression-guard`](../security-regression-guard/SKILL.md)

---

## 1. Resumen Ejecutivo

Este caso de estudio documenta la auditoría de seguridad y la migración de la autenticación de una aplicación que busca vacantes de empleo según el perfil de cada usuario. El proyecto había nacido de la plantilla de otro sistema y tenía dos backends: rutas de servidor en TypeScript (Astro) para cuentas y sesiones, y un servicio en Rust para la búsqueda en portales externos.

A primera vista la aplicación tenía las protecciones habituales: contraseñas con Argon2id, cookie `HttpOnly` y `SameSite=Strict` firmada con HMAC, límite de intentos de login, un token anti-CSRF y un token interno entre servicios. Al invocar **`security-regression-guard`**, la traza de cada operación mostró que varias de esas piezas no protegían lo que parecían proteger:

1. **Protección de origen del framework apagada:** La comprobación de `Origin` de Astro estaba desactivada desde la configuración inicial. Una página ajena podía iniciar sesión, cerrarla o crear cuentas en nombre del visitante.
2. **Clave de firma con respaldo inseguro:** Si faltaba el secreto de sesión, la firma usaba la cadena de conexión de la base, y aceptaba el valor de ejemplo de `.env.example`.
3. **Sesión sin revocación:** La cookie firmada y sin estado seguía siendo válida doce horas después del logout, y no existía forma de bloquear una cuenta al instante.
4. **Registro que enumeraba cuentas:** Los mensajes y códigos de estado revelaban si un correo o usuario ya existía.
5. **Búsqueda sin límite por cuenta y memoria sin tope:** Cada búsqueda consultaba seis portales externos; el limitador de intentos y la caché de búsquedas crecían sin límite.
6. **Protección decorativa:** Cada página emitía un token anti-CSRF que ninguna ruta verificaba.
7. **Entradas que se saltaban el servicio y código heredado:** Un script de mantenimiento creaba cuentas directo en la base, y el repositorio arrastraba módulos, tablas y un CV personal del proyecto de origen.

Las correcciones incluyeron mover registro, login, sesiones, perfil, búsqueda y límites al servicio en Rust, con sesiones guardadas en la base y límites compartidos por todas las instancias. Se verificaron con 13 pruebas unitarias en Rust y una prueba de extremo a extremo con una cuenta sintética que se borró al terminar.

---

## 2. Escenario inicial: protecciones presentes frente a protecciones comprobadas

### Contexto de la aplicación

El usuario se registra con su CV, que se lee en el navegador y nunca se sube. El servidor guarda solo el perfil profesional (puesto, nivel de inglés, experiencia y habilidades). Con ese perfil, el servicio en Rust consulta en paralelo seis bolsas de empleo y devuelve las vacantes publicadas en el rango de días elegido.

### La apariencia de seguridad

La configuración del framework y la cookie de sesión parecían correctas:

```javascript
// astro.config.mjs (estado inicial)
export default defineConfig({
  output: 'server',
  security: {
    checkOrigin: false,
  },
});
```

```typescript
// Clave de firma de sesiones (estado inicial)
const raw =
  process.env.API_SECRET ||
  process.env.DATABASE_URL ||   // respaldo: la conexión a la base firmaba sesiones
  '';
if (raw.trim().length >= 16) return deriveKey(raw);
```

La cookie era `SameSite=Strict`, así que parecía inmune a peticiones de otros sitios. Lo que ninguna prueba ejercitaba era la respuesta a un POST de otro sitio: el navegador no envía la cookie, pero sí guarda o borra la que fija la respuesta.

---

## 3. La Intervención con `security-regression-guard`

El desarrollador invocó la skill sobre los cambios recientes de autenticación y después pidió migrar la autenticación al servicio en Rust:

```text
/security-regression-guard
```

El análisis se organizó a partir de las directivas de la skill:

1. **Reproducir antes de corregir:** Se envió un POST con `Origin: https://evil.example` a login y registro. El servidor lo procesó (`303` y `400` de validación), lo que confirmó el fallo antes de tocar código.
2. **Consultar el código vigente antes de afirmar que una protección existe:** El token anti-CSRF se generaba en cada página, pero la búsqueda de su verificación no encontró ninguna ruta que lo comprobara.
3. **Ciclo de sesión:** La directiva *"borrar la copia del cliente no revoca la del servidor"* llevó a cambiar la cookie firmada por sesiones guardadas en la base.
4. **Producción cerrada por defecto:** La regla sobre configuración ausente señaló el respaldo de la clave de firma en otro secreto.
5. **Costo y límites:** La búsqueda se trató como un amplificador hacia servicios externos y se limitó por cuenta antes de llamarlos.
6. **No inventar política ni tocar infraestructura sin autorización:** Aplicar la migración de base y crear la cuenta de prueba se hizo solo con autorización explícita del propietario.

---

## 4. Hallazgos Concretos y Mitigaciones Aplicadas

### Hallazgo 1: Login, logout y registro aceptaban peticiones de otro sitio

- **Problema:** Con `checkOrigin: false`, un formulario en otro sitio podía enviar credenciales del atacante al login (*login CSRF*: la víctima queda dentro de la cuenta del atacante) o cerrar la sesión de la víctima. El registro interpretaba el cuerpo como JSON sin exigir `Content-Type: application/json`, así que un envío `text/plain` evitaba el preflight de CORS.
- **Mitigación:** Se activó la comprobación de origen del framework, que cubre formularios y `text/plain`.
  ```javascript
  security: {
    // Rechaza POST de formularios (y text/plain) que vienen de otro sitio.
    checkOrigin: true,
  },
  ```
- **Evidencia:** Antes, `Origin: https://evil.example` → `303` (login procesado). Después → `403` en login, logout y registro; el mismo envío desde el origen propio sigue en `303`.

### Hallazgo 2: Clave de firma con respaldo en otro secreto y valor de ejemplo aceptado

- **Problema:** Quien conociera la cadena de conexión de la base, o el valor de `.env.example` si llegaba a producción, podía fabricar una sesión para cualquier usuario.
- **Mitigación:** Se eliminó el respaldo, se exigió un largo mínimo de 32 caracteres y se rechazó el valor de plantilla. Sin una clave válida, las rutas protegidas responden `503`. Tras la migración a Rust, el backend se niega a arrancar si el secreto no cumple.
  ```rust
  match cfg.api_secret.as_deref() {
      Some(s) if s.len() >= MIN_SECRET_LEN => {}
      _ => bail!("API_SECRET falta o tiene menos de {MIN_SECRET_LEN} caracteres"),
  }
  ```

### Hallazgo 3: La sesión no se podía revocar ni bloquear

- **Problema:** La cookie era un token firmado sin estado en el servidor. El logout solo la borraba del navegador; una copia seguía funcionando hasta doce horas. Tampoco existía forma de cerrar las sesiones de una cuenta ni de bloquearla al instante.
- **Mitigación:** Las sesiones pasaron a una tabla en la base. La cookie lleva un token aleatorio de 256 bits y la base guarda solo su SHA-256. Cada petición protegida se valida contra la base, junto con el estado de la cuenta.
  ```rust
  let row: Option<(i64, String)> = sqlx::query_as(
      "SELECT u.id, u.username::text
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
         AND u.disabled_at IS NULL",
  )
  .bind(token_hash(&token))
  .fetch_optional(pool)
  .await?;
  ```
  Se añadieron cierre de todas las sesiones de una cuenta y bloqueo con `users.disabled_at`. Una cuenta bloqueada responde en el login igual que una contraseña incorrecta.

### Hallazgo 4: El registro revelaba qué cuentas existían

- **Problema:** El alta respondía `409` con "Ese correo ya tiene una cuenta" o "Ese nombre de usuario ya está en uso", y `500` ante otros fallos.
- **Mitigación:** Cualquier fallo de alta devuelve el mismo mensaje y el mismo estado. En el log solo queda el tipo de fallo, sin correo ni usuario. Cuenta, perfil y sesión se crean en una sola transacción; antes, si fallaba el perfil, se borraba la cuenta con una segunda consulta.
- **Límite declarado:** Probar combinaciones de usuario nuevo y correo conocido sigue siendo posible; solo verificar el correo antes de activar la cuenta lo cierra del todo. Se dejó como pendiente.

### Hallazgo 5: Búsqueda sin límite por cuenta y memoria sin tope

- **Problema:** Cada búsqueda llamaba a seis portales externos. Sin límite por cuenta, una sola sesión podía saturarlos y provocar que bloquearan la IP del servidor. El mapa de intentos fallidos y la caché de búsquedas solo borraban entradas vencidas, así que una ráfaga de claves distintas los hacía crecer sin límite.
- **Mitigación:** Los límites viven en una tabla de la base, con claves SHA-256 que no guardan IP ni correo en claro, y se actualizan con una sola sentencia atómica. Así los comparten todas las instancias.

  | Qué | Límite |
  | :--- | :--- |
  | Intentos de login por IP | 20 cada 15 min |
  | Contraseña incorrecta por correo | 10 cada 15 min |
  | Altas por IP | 5 por hora |
  | Búsquedas por cuenta | 10 por minuto |

  La caché de búsquedas purga lo vencido al insertar y tiene un máximo de 500 entradas. El servicio en Rust limita el cuerpo a 32 KB, la concurrencia a 64 peticiones y el tiempo a 45 s.

### Hallazgo 6: Un token anti-CSRF que nadie verificaba

- **Problema:** Cada página emitía un token y una cookie anti-CSRF, y el componente lo recibía como propiedad. Ninguna ruta lo comprobaba. Daba la apariencia de una defensa que no existía.
- **Mitigación:** Se eliminó. La protección real quedó en la comprobación de origen y las cookies `SameSite=Strict`, ambas verificadas con peticiones.

### Hallazgo 7: Entradas que se saltaban el servicio y código heredado

- **Problema:** Un script de mantenimiento insertaba cuentas directo en la base, sin validaciones ni límites. Además, el repositorio conservaba módulos de notificaciones, generación de CV con un modelo de IA y un CV personal incrustado, todos del proyecto de origen, más una tabla y un colector periódico que nadie leía.
- **Mitigación:** Se retiró el script y se eliminaron los módulos y la tabla sin uso, previa copia de seguridad de sus filas. Se comprobó que el CV incrustado no contenía datos de contacto y que el repositorio era privado.

### Refuerzo adicional

El token interno entre Astro y Rust se comparaba con `==`. Se sustituyó por una comparación en tiempo constante con largo mínimo. El servicio en Rust ya no expone CORS, porque ningún navegador lo llama, y Astro quedó como capa delgada que solo pone la cookie y reenvía.

### Riesgos expuestos sin corregir

| Riesgo | Motivo para no corregirlo en la sesión |
| :--- | :--- |
| El servicio en Rust escucha en `0.0.0.0` | Depende de la red real del despliegue; debe quedar en red privada |
| Ataques de denegación de servicio a gran escala | Los límites de la app no sustituyen el firewall de la plataforma |
| Enumeración residual en el registro | Requiere verificar el correo, un flujo nuevo que no se pidió |
| El primer límite por IP en Astro vive en memoria por instancia | Es una barrera previa; los límites que importan ya están en la base |
| La clasificación de vacantes sigue en TypeScript | Migración pendiente, sin impacto de seguridad directo |

---

## 5. La Matriz de Evidencia y Pruebas Anti-Regresión

### Pruebas unitarias en Rust

| Prueba Implementada | Vector Verificado | Resultado Esperado |
| :--- | :--- | :--- |
| `verifica_hash_de_node_rs_y_rechaza_incorrecta` | Hash real generado por la biblioteca anterior de TypeScript | Se verifica en Rust; una contraseña incorrecta y un hash gigante se rechazan |
| `tokens_aleatorios_y_con_formato` | Dos tokens de sesión | Distintos, con formato válido y hash de 32 bytes |
| `valida_cuenta`, `rechaza_perfil_invalido` | Usuario, correo, contraseña y perfil fuera de reglas | Rechazo |
| `la_clave_no_guarda_el_dato_en_claro` | Clave de límite para un correo | Hash de 64 caracteres sin el correo |
| `token_solo_coincide_completo` | Token interno parcial o vacío | No coincide |
| `normalize_acota_terminos_y_ubicacion` | Términos de 5 000 caracteres y días fuera de rango | Recortados a los máximos |

```text
test result: ok. 13 passed; 0 failed; 0 ignored
```

### Verificación de extremo a extremo con una cuenta sintética

| Paso | Resultado |
| :--- | :--- |
| Registro desde la app | `201` con cookie de sesión |
| Página principal con esa sesión | `200` |
| Registro repetido con el mismo correo | `400` con el mensaje genérico |
| Logout y reutilizar la cookie anterior | `401` en el servicio y redirección al login |
| Dos sesiones abiertas y "cerrar todas" | `closed: 2`; ambas `401` |
| Bloquear la cuenta con `disabled_at` | Sesión abierta `401` al instante; login responde como contraseña incorrecta |
| 12 contraseñas incorrectas al mismo correo | 10 × `401`, luego `429` |
| 22 intentos desde la misma IP | 20 × `401`, luego `429` |
| Cuerpo de 64 KB | `413` |
| Token interno ausente o falso | `401` |

La base guardaba solo el hash de 32 bytes de cada token. Al terminar se borró la cuenta y se comprobó que no quedaron sesiones ni perfiles huérfanos.

### Lo que no se verificó

No se comprobaron la configuración real de Vercel, TLS, las cabeceras en el dominio ni la red del servicio en Rust desplegado. La migración de base la aplicó el propietario; el agente no tenía permiso para ejecutarla.

---

## 6. Conclusiones y observaciones

1. **Una cookie `SameSite=Strict` no sustituye la comprobación de origen:** Evita que el navegador envíe la cookie, pero no que una respuesta la fije o la borre.
2. **El respaldo de una clave es otra clave:** Si la firma cae a otro secreto, quien lea ese secreto firma sesiones.
3. **Lo que se emite y no se verifica es decoración:** Un token anti-CSRF sin verificación da una sensación de seguridad que ninguna prueba de comportamiento confirmaría.
4. **Las plantillas traen más que código:** Módulos, tablas y datos personales del proyecto de origen son superficie de ataque mientras sigan en el repositorio.
5. **Migrar la autenticación exige compatibilidad comprobada:** Probar con un hash real de la implementación anterior evitó dejar fuera a las cuentas existentes.
6. **Los límites deben vivir donde viven las instancias:** Mover los contadores a la base convirtió un límite por proceso en uno global.
