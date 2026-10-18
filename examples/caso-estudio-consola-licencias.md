# Caso de Estudio Real: Blindaje de Sesión, Login y Perímetro en una Consola Administrativa de Licencias

> **Validación práctica asistida por IA**  
> **Autor:** Guijosa Dev  
> **Entorno:** Hono / Node.js / TypeScript / React 19 / Neon Postgres / Vercel Serverless / Cloudflare Workers  
> **Tipo de aplicación:** Panel administrativo interno (SPA + API) con operadores por alcance de cliente  
> **Herramienta:** Claude Code (modelo Opus 5.5)  
> **Skill aplicada:** [`security-regression-guard`](../security-regression-guard/SKILL.md)

---

## 1. Resumen Ejecutivo

Este caso de estudio documenta la auditoría y el refuerzo de una consola administrativa que gestiona clientes, contratos, catálogo y licencias de un producto comercial. La API corre sobre Hono, se despliega como función serverless y queda detrás de un Worker que sirve la SPA y reenvía las llamadas `/api/*`.

A diferencia de los casos anteriores, el punto de partida no era código descuidado. La aplicación ya contaba con cookie `HttpOnly` y `SameSite=Strict`, token firmado con HMAC, límite de intentos de login, comprobación de `Origin` en escrituras, permisos por acción, aislamiento por cliente en cada consulta, SQL parametrizado y límites de cuerpo. Una revisión que se limitara a buscar la presencia de esas piezas habría concluido que no había nada que corregir.

Al invocar **`security-regression-guard`** con la instrucción de reforzar la web, el análisis siguió cada operación de extremo a extremo y encontró cinco fallos en protecciones que existían pero no resistían una petición directa:

1. **Límite de login evadible:** La clave del limitador se tomaba de cabeceras que el propio cliente podía enviar. Cada intento podía estrenar un cubo nuevo.
2. **Logout sin revocación:** Cerrar sesión borraba la cookie del navegador, pero el token seguía siendo válido en el servidor durante ocho horas.
3. **Rotación de contraseña sin efecto sobre sesiones abiertas:** Cambiar la contraseña de acceso no invalidaba los tokens ya emitidos.
4. **Sonda pública con trabajo caro:** El endpoint de disponibilidad, sin autenticación, abría una transacción en la base de datos por cada llamada.
5. **Páginas estáticas sin cabeceras de protección:** La API enviaba CSP y `X-Frame-Options`, pero el Worker servía la SPA sin ninguna de ellas.

Las cinco correcciones se aplicaron en la misma sesión, respaldadas por cinco pruebas de regresión nuevas y una verificación contra la API en ejecución. La auditoría también confirmó sin hallazgos el control de acceso de las 27 rutas, y dejó cinco riesgos señalados como decisiones pendientes del propietario en lugar de resolverlos por cuenta propia.

---

## 2. Escenario inicial: protecciones presentes frente a protecciones comprobadas

### Contexto de la aplicación

La consola expone listados paginados y operaciones de escritura sobre clientes, catálogo, contratos, licencias, activaciones, soporte y auditoría. Cada operador tiene un rol, una lista de permisos y, opcionalmente, un cliente asignado que restringe todo lo que puede leer o modificar. El acceso se realiza con una contraseña local y una cookie de sesión.

### La apariencia de seguridad

El login ya incluía un limitador de cinco intentos cada quince minutos:

```typescript
const clientIp =
  c.req.header("cf-connecting-ip") ||
  c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
  "127.0.0.1";

if (!checkLoginRateLimit(clientIp)) {
  return c.json({ error: { code: "RATE_LIMITED" } }, 429);
}
```

Y el cierre de sesión respondía correctamente y limpiaba la cookie:

```typescript
authRoutes.post("/logout", async (c) => {
  if (!originAllowed(c.req.header("origin"))) {
    return c.json({ error: { code: "INVALID_ORIGIN" } }, 403);
  }
  c.header("Set-Cookie", clearCookie(config.cookieSecure));
  return c.json({ status: "ok" });
});
```

Ambos fragmentos superaban sus pruebas. El repositorio incluso tenía un caso que verificaba el `429` al sexto intento. Lo que ninguna prueba ejercitaba era al atacante que cambia la cabecera entre intentos, ni al token copiado que se reutiliza después del logout.

---

## 3. La Intervención con `security-regression-guard`

El desarrollador invocó la skill con una instrucción abierta:

```text
/security-regression-guard usa esta skill para reforzar la web
```

El análisis se organizó a partir de las directivas de la skill:

1. **Traza de la operación completa:** Se enumeraron las 27 rutas con su cadena `ruta -> middleware -> permiso -> alcance de cliente -> consulta/escritura`. La traza confirmó que cada ruta exige un permiso, que las escrituras añaden comprobación de `Origin` y de modo de escritura, y que el alcance de cliente se deriva del operador autenticado y no de un identificador enviado en la petición.
2. **IP desde el salto de confianza:** La directiva *"obtén la IP desde el proxy/plataforma de confianza, no desde cualquier encabezado reenviado"* señaló el limitador de login. La API es alcanzable por dos caminos, a través del Worker y de forma directa, y solo en el primero la cabecera de dirección es fiable.
3. **Ciclo de sesión:** La directiva *"borrar la copia del cliente no revoca la del servidor"* llevó a probar el token después del logout. La regla sobre contraseñas *"antigua tras rotación"* extendió la misma pregunta al cambio de contraseña.
4. **Costo de las lecturas públicas:** La regla *"limita también el costo de cálculos públicos que consultan la base"* destacó la sonda de disponibilidad, la única ruta sin sesión que llegaba a la base de datos.
5. **Configuración efectiva del artefacto publicado:** Revisar qué responde realmente cada origen mostró que las cabeceras de protección vivían en la API y no en el Worker que entrega el HTML.
6. **No inventar política:** Ante cinco puntos que dependían de una decisión de negocio o de infraestructura real, la skill indicó exponer la ambigüedad en lugar de corregir por suposición.

---

## 4. Hallazgos Concretos y Mitigaciones Aplicadas

### Hallazgo 1: Límite de login evadible con una cabecera elegida por el cliente

- **Problema:** El limitador indexaba por `cf-connecting-ip` o `x-forwarded-for`. A través del Worker esos valores son fiables, pero en una llamada directa a la función serverless los escribe quien hace la petición. Un script podía rotar la cabecera en cada intento y probar contraseñas sin límite contra un sistema con una única contraseña compartida. El mapa de cubos, además, crecía sin tope.
- **Mitigación:** La dirección solo se acepta del salto que la plataforma garantiza. Con llave de gateway validada se usa la cabecera que fija el Worker; en la plataforma serverless, la que fija la propia plataforma; en cualquier otro caso todos los intentos comparten un cubo.
  ```typescript
  // Only an address set by the trusted hop counts: a client-chosen header would give every attempt a fresh bucket.
  function loginClientKey(c: Context<AppEnv>): string {
    let address: string | undefined;
    if (config.internalGatewayKey) {
      // The gateway secret was already checked, so these headers come from the Worker.
      address = c.req.header("x-client-ip") || c.req.header("x-forwarded-for")?.split(",")[0];
    } else if (process.env.VERCEL === "1") {
      address = c.req.header("x-real-ip");
    }
    return address?.trim().slice(0, 64) || "direct";
  }
  ```
  El Worker elimina cualquier `x-client-ip` que llegue del navegador antes de fijar el suyo, y el mapa de cubos quedó acotado a 10 000 entradas con limpieza de ventanas vencidas.

### Hallazgo 2: Logout que no revocaba la sesión en el servidor

- **Problema:** El token es autocontenido (expiración, valor aleatorio y firma) y el servidor no guardaba estado. El logout borraba la cookie, pero una copia del token seguía autenticando durante las ocho horas restantes.
- **Mitigación:** El servidor registra la firma de cada sesión cerrada hasta el momento en que habría expirado, y la verificación la rechaza. Solo se registran tokens que superan la verificación, de modo que el registro no puede inflarse con valores arbitrarios.
  ```typescript
  function revokeToken(token: string | null, secret: string): void {
    if (!token || !verifyToken(token, secret)) return;
    const now = Math.floor(Date.now() / 1000);
    for (const [signature, expiresAt] of revokedSessions) {
      if (expiresAt <= now) revokedSessions.delete(signature);
    }
    const parts = token.split(".");
    revokedSessions.set(parts[2]!, Number(parts[0]));
  }
  ```
  La limitación se documentó en el propio código y en el informe: el registro vive en la memoria del proceso y varias instancias serverless no lo comparten.

### Hallazgo 3: Rotar la contraseña no cerraba las sesiones abiertas

- **Problema:** La firma dependía únicamente del secreto de sesión. Si la contraseña se cambiaba tras una sospecha de filtración, quien ya tuviera un token conservaba el acceso.
- **Mitigación:** La llave de firma se deriva del secreto y de la contraseña vigente. Cambiar la contraseña invalida de inmediato todos los tokens anteriores, sin almacenamiento adicional.
  ```typescript
  // The signing key depends on the password, so rotating the password ends every open session.
  function sessionSecret(): string | null {
    const secret = config.sessionSecret;
    const password = config.localAdminPassword;
    if (!secret || Buffer.byteLength(secret) < 32 || !password) return null;
    return createHmac("sha256", secret).update("session-key:" + password).digest("base64url");
  }
  ```
  El cambio tiene un efecto operativo que se comunicó antes de cualquier despliegue: al publicarlo, todos los operadores deben iniciar sesión una vez más.

### Hallazgo 4: Sonda pública de disponibilidad con trabajo caro por llamada

- **Problema:** `GET /health/ready` no requiere sesión y, en cada llamada, abría una conexión, verificaba el destino y el rol de la base de datos y cerraba la transacción. Cualquier visitante podía multiplicar conexiones contra la base sin ningún límite.
- **Mitigación:** El resultado se comparte durante cinco segundos entre todas las llamadas, incluidas las concurrentes, que esperan la misma comprobación en curso.
  ```typescript
  // The readiness probe is public and opens a database transaction, so its answer is shared for a few seconds.
  const READINESS_CACHE_MS = 5_000;
  let readiness: { at: number; result: ReturnType<typeof checkDatabaseTarget> } | null = null;

  function databaseReadiness(): ReturnType<typeof checkDatabaseTarget> {
    const now = Date.now();
    if (!readiness || now - readiness.at > READINESS_CACHE_MS) {
      readiness = { at: now, result: checkDatabaseTarget() };
    }
    return readiness.result;
  }
  ```

### Hallazgo 5: SPA servida sin cabeceras de protección

- **Problema:** La API fijaba `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options` y `Referrer-Policy` en sus respuestas JSON. El HTML del panel, que es lo que el navegador realmente renderiza, salía del Worker sin ninguna. La política existía donde menos protegía.
- **Mitigación:** El Worker añade las mismas cabeceras, más HSTS, a cada recurso estático. Para que `script-src 'self'` fuera viable, el script en línea que aplicaba el tema antes del primer pintado se movió a un archivo propio.
  ```typescript
  const asset = await env.ASSETS.fetch(request);
  const response = new Response(asset.body, asset);
  for (const [name, value] of Object.entries(ASSET_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
  ```

### Refuerzo adicional

La llave compartida entre el Worker y la API se comparaba con `!==`. Se sustituyó por una comparación en tiempo constante sobre resúmenes de longitud fija.

### Riesgos expuestos sin corregir

Siguiendo la directiva de no inventar política ni tocar infraestructura real, estos puntos se entregaron como decisiones pendientes:

| Riesgo | Motivo para no corregirlo en la sesión |
| :--- | :--- |
| La revocación de logout no es global entre instancias serverless | La solución completa requiere una tabla de sesiones y una migración no autorizada |
| La API puede ser alcanzable directamente si la llave de gateway no está configurada en el despliegue | Depende de configuración real que no era verificable desde el repositorio |
| Con configuración ausente, el modo de base de datos y la rama esperada toman valores de respaldo permisivos | Decisión deliberada y reciente del propietario; se señala la discrepancia con el ejemplo de configuración |
| Contraseña única compartida, sin segundo factor; el límite es por dirección | Cambia el contrato de autenticación del producto |
| Un operador restringido a un cliente puede suspender o cerrar ese mismo cliente | Política de negocio sin definición explícita |

---

## 5. La Matriz de Evidencia y Pruebas Anti-Regresión

Las pruebas nuevas ejecutan la aplicación real con su middleware y comprueban el código de respuesta observable. Para los casos de sesión se evitó el falso positivo descrito por la skill: un token válido debe superar la autenticación (cualquier respuesta distinta de `401`) antes de demostrar que el mismo token deja de servir.

| Prueba Implementada | Vector Verificado | Resultado Esperado |
| :--- | :--- | :--- |
| `does not let a client-chosen address header open a fresh login bucket` | Seis intentos, cada uno con `cf-connecting-ip`, `x-forwarded-for` y `x-client-ip` distintos | El sexto recibe `429` |
| `limits each address the gateway reports on its own` | Llave de gateway válida y dos direcciones informadas por el Worker | La primera se bloquea al sexto intento; la segunda sigue disponible |
| `rejects a session cookie after logout` | Token válido antes y después de `POST /logout` | Autenticado antes; `401` después |
| `ends open sessions when the password changes` | Token emitido con la contraseña anterior | `401` tras rotar la contraseña |
| `rejects a forged or missing session cookie` | Firma alterada y petición sin cookie | `401` en ambos casos |

### Ejecución de Pruebas
```text
 ✓ session and login hardening > does not let a client-chosen address header open a fresh login bucket 24ms
 ✓ session and login hardening > limits each address the gateway reports on its own 3ms
 ✓ session and login hardening > rejects a session cookie after logout 2ms
 ✓ session and login hardening > ends open sessions when the password changes 1ms
 ✓ session and login hardening > rejects a forged or missing session cookie 1ms

 Test Files  1 passed (1)
      Tests  22 passed (22)
```

Las 17 pruebas preexistentes siguieron pasando. La comprobación de tipos pasó en la API y en el frontend, y la auditoría de dependencias de producción no reportó avisos.

### Verificación contra la API en ejecución

Además de la suite, se repitió el flujo completo contra el servidor local conectado a la base de pruebas:

| Paso | Resultado |
| :--- | :--- |
| Login con la contraseña vigente | `200` |
| Consulta de sesión y listado protegido | `200` y `200` |
| Logout | `200` |
| La misma cookie contra sesión y listado | `401` y `401` |
| Seis llamadas simultáneas a la sonda de disponibilidad | Seis `200` en 144 ms en total |

### Lo que no se verificó

El informe separó de forma explícita lo probado en local de lo pendiente: el Worker modificado se compiló pero no se ejecutó, y no se comprobaron TLS, cookies ni cabeceras en el dominio real, ni el comportamiento de la función serverless desplegada. No se realizó ningún despliegue ni cambio en datos o configuración reales.

---

## 6. Conclusiones y observaciones

1. **Una protección presente no es una protección comprobada:** El limitador de login existía y tenía su prueba. La prueba enviaba siempre la misma cabecera, que es justo lo que un atacante no hace. La skill obligó a preguntar quién controla cada dato del que depende la defensa.
2. **Las rutas alternativas también son de red:** La misma API tenía dos caminos de entrada, a través del Worker y directo a la función. Una cabecera fiable en uno era entrada arbitraria en el otro.
3. **El ciclo de sesión termina en el servidor:** Logout y rotación de contraseña son promesas al usuario. Si el servidor no las hace cumplir, la interfaz describe una seguridad que no existe.
4. **Auditar también produce resultados negativos útiles:** Confirmar sin hallazgos el control de acceso de 27 rutas tiene valor propio y evitó reescribir código que ya era correcto.
5. **Separar lo corregido de lo decidido:** Cinco riesgos quedaron como preguntas al propietario. Resolverlos por suposición habría implicado migraciones, cambios de contrato o políticas inventadas.
6. **Honestidad sobre el alcance de la evidencia:** Una mitigación parcial, como la revocación en memoria, se entregó con su límite escrito junto al código, y lo no verificado en producción se declaró como tal.
