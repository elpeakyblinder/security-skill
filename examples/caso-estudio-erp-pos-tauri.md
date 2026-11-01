# Caso de Estudio Real: Blindaje de un ERP y Punto de Venta (POS) Híbrido de Escritorio con Soporte Offline

> **Validación práctica asistida por IA**  
> **Autor:** Guijosa Dev  
> **Entorno:** Tauri v2 (Rust) / React 19 / TypeScript / Cloudflare Workers / Hono / Drizzle ORM / Neon PostgreSQL  
> **Tipo de aplicación:** ERP y Punto de Venta (POS) de escritorio con arquitectura híbrida Local-First y API en la nube  
> **Herramienta:** Google Antigravity (Modelo con razonamiento extendido)  
> **Skill aplicada:** [`security-regression-guard`](../security-regression-guard/SKILL.md)

---

## 1. Resumen Ejecutivo

Este caso de estudio documenta la auditoría y remediación de extremo a extremo de un sistema ERP y terminal de Punto de Venta (POS) para el sector automotriz/llantero, construido como aplicación nativa de escritorio con **Tauri v2 + React 19** y respaldado por una API serverless en **Cloudflare Workers + Hono + Drizzle ORM + Neon PostgreSQL**, además de un motor de contingencia offline (`localStorage` + Web Crypto API) para seguir operando cuando cae la conexión a internet en sucursal.

En su estado funcional inicial, el proyecto contaba con autenticación mediante tokens JWT firmados (`HS256`), contraseñas derivadas con `PBKDF2-SHA256` (100 000 iteraciones) y comparación en tiempo constante en el servidor, validación de esquemas con Zod, ocultamiento de menús por rol en el cliente (`admin`, `rh_admin` y `empleado`) y un panel visual para configurar permisos por módulo y acción.

Al aplicar **`security-regression-guard`** trazando cada operación desde la interfaz nativa hasta las consultas SQL y el fallback local, se identificaron y corrigieron **ocho vulnerabilidades de arquitectura y lógica de negocio** divididas en tres fases:

### Fase 1: Perímetro de API, Matriz Dinámica de Permisos y Escalada de Privilegios
1. **Rutas de negocio sin middleware de autenticación y endpoints públicos de diagnóstico:** Mientras `/api/auth/me` exigía token Bearer, los routers de inventario (`/api/products`, `/api/categories`, `/api/brands`), ventas (`/api/sales`) y gastos (`/api/expenses`), así como las rutas de diagnóstico `/api/test-db` y `/api/env-check`, habían quedado accesibles sin autenticación tras las pruebas de integración iniciales. Además, `GET /api/expenses/categories` ejecutaba un `INSERT` automático de categorías por defecto en cada lectura.
2. **Desconexión entre la matriz visual de permisos (`UsersPage`) y la autorización del servidor:** El editor de permisos por módulo y acción modificaba únicamente el estado local de React, sin persistencia ni aplicación en el backend. Tampoco existía validación de delegación: un supervisor (`rh_admin`) con acceso al módulo de usuarios podía crear cuentas `admin` o desactivar al administrador principal.
3. **Fuga de costos unitarios (`costPrice`) y márgenes de utilidad hacia el rol operativo (`empleado`):** El endpoint `GET /api/products` devolvía la columna `costPrice` a cualquier usuario que consultara el catálogo desde la terminal POS, exponiendo los costos de compra y márgenes comerciales de toda la mercancía.

### Fase 2: Invariantes Transaccionales en POS, Precios de Catálogo y Concurrencia (TOCTOU)
4. **Manipulación de precios unitarios y descuentos por el cajero en `POST /api/sales`:** El backend calculaba el subtotal y total de la venta confiando en los campos `unitPrice` y `discount` enviados en el JSON del cliente, permitiendo que un cajero (`empleado`) vendiera llantas por debajo del precio oficial de catálogo o aplicara descuentos sin el permiso `sales.discount`.
5. **Evasión de stock por líneas duplicadas y condiciones de carrera (TOCTOU) en ventas, cancelaciones y Kardex:**
   - Enviar dos líneas con el mismo `productId` en una misma venta (`3 + 3 = 6` unidades) superaba la validación individual cuando el stock disponible era `5`.
   - El descuento de inventario leía el stock con `SELECT` y luego ejecutaba `UPDATE` sin condición de saldo mínimo, permitiendo inventario negativo ante ventas simultáneas.
   - `POST /api/sales/:id/cancel` verificaba en memoria si la venta estaba cancelada antes de restaurar el stock, permitiendo que dos peticiones concurrentes devolvieran el stock por duplicado.

### Fase 3: Ciclo de Sesión, Trampa del Fallback Offline y Contenedor Tauri
6. **Evasión de autorización por Fallback Offline indiscriminado (`try/catch` en el cliente HTTP):** El servicio `api.ts` del cliente envolvía las llamadas `fetch` en un bloque `try/catch` pensado para activar la base de datos local cuando no hubiera internet. Sin embargo, al lanzar `new Error(...)` cuando el servidor respondía con `401`, `403`, `409` o `422`, el propio bloque `catch` capturaba el rechazo del servidor y ejecutaba la operación prohibida en la base de datos local.
7. **Sesión `admin` preautenticada al arrancar, contraseñas offline en texto plano y colisión de `jti` en revocación de JWT:** El store de autenticación iniciaba con una sesión `admin` activa por defecto (`token: "demo-jwt-token-active"`), la tabla de usuarios y el almacenamiento local guardaban contraseñas en texto claro, y los tokens JWT emitidos en el mismo segundo carecían de `jti` único.
8. **Política `csp: null` en `tauri.conf.json` y orígenes nativos ausentes en CORS:** El contenedor Tauri tenía deshabilitada la Content Security Policy (`csp: null`) y el middleware CORS del backend no contemplaba los orígenes de producción del WebView nativo (`http://tauri.localhost`, `https://tauri.localhost`, `tauri://localhost`).

---

## 2. Escenario inicial: funcionalidad frente a fronteras de seguridad

### Contexto de la aplicación
El sistema opera con tres roles de negocio confirmados con el propietario del producto:
- **`admin` (Administrador):** Acceso total protegido y gobierno exclusivo de la matriz de permisos (`settings.roles`).
- **`rh_admin` (Supervisor / RRHH):** Supervisión comercial, alta y ajuste de inventario (Kardex), aplicación de descuentos, anulación de ventas (`sales.cancel`) y de gastos (`expenses.cancel`), y administración de cuentas operativas sin poder escalar ni modificar cuentas `admin`.
- **`empleado` (Ventas / Mostrador):** Operación estricta de terminal POS y consulta de existencias. Solo puede vender al precio oficial de catálogo (`salePrice`), no puede aplicar descuentos ni ver costos de compra (`costPrice`) ni el corte financiero de caja.

---

## 3. Hallazgos Concretos y Mitigaciones Aplicadas

### Hallazgo 1: Matriz Dinámica de Permisos con Dependencia `Módulo -> Acción` y Frontera de Delegación
- **Problema:** Los permisos se comprobaban en el cliente contra una lista estática, mientras que el modal de configuración de roles en `UsersPage.tsx` solo alteraba un `useState` local.
- **Mitigación:** Se construyó el motor de permisos en `api/src/utils/permissions.ts` y los endpoints `GET /api/users/roles` y `PUT /api/users/roles/:roleId`:
  - **Dependencia de módulo en servidor:** Si un módulo tiene `enabled: false`, `hasRolePermission(role, permission)` rechaza todas las acciones de ese módulo aunque sus banderas individuales sigan en `true`.
  - **Piso de gobierno inmutable:** `updateRoleModules` impide desactivar los permisos críticos (`users.manage`, `settings.roles`, `settings.manage`) del rol `admin`, evitando que un administrador bloquee accidentalmente la administración del sistema.
  - **Frontera de delegación (`canDelegateRole`):** En `POST /api/users` y `PATCH /api/users/:id/status`, `rh_admin` tiene prohibido crear cuentas `admin` o desactivar administradores existentes.

### Hallazgo 2: Invariante de Precios de Catálogo en POS, Ocultamiento de `costPrice` y Consolidación de Duplicados
- **Problema:** En `POST /api/sales`, el backend aceptaba el `unitPrice` enviado por el cliente y validaba `prod.stock < item.quantity` iterando elemento por elemento sin agrupar por `productId`. Además, `GET /api/products` devolvía `costPrice` a todos los roles.
- **Mitigación:**
  1. En `GET /api/products` y `GET /api/products/:id`, `canViewCostPrice(role)` verifica si el rol cuenta con `inventory.edit` o `reports.profits`; de lo contrario, omite `costPrice` antes de serializar la respuesta.
  2. En `POST /api/sales`, se consolidan primero las líneas con el mismo `productId`, se exige `sales.discount` cuando `discount > 0`, y se rechaza con `403` cualquier `unitPrice` que difiera del `salePrice` oficial en base de datos:
  ```typescript
  const catalogSalePrice = Number(prod.salePrice);
  if (Math.abs(item.unitPrice - catalogSalePrice) > 0.009) {
    return c.json(
      {
        success: false,
        error: `Precio unitario no autorizado para '${prod.name}'. El precio oficial de catálogo es $${catalogSalePrice.toFixed(2)}.`,
      },
      403
    );
  }
  ```

### Hallazgo 3: Descuento y Cancelación Atómica de Inventario (Anti-TOCTOU)
- **Problema:** Dos ventas simultáneas por 4 unidades cada una sobre un producto con `stock = 5` leían `stock = 5` en el `SELECT` inicial y dejaban el inventario en `-3`. De igual forma, dos llamadas concurrentes a `POST /api/sales/:id/cancel` restauraban el stock dos veces.
- **Mitigación:**
  - En `POST /api/sales` y `POST /api/products/:id/adjust`, la actualización de existencias incluye un predicado atómico sobre la columna `stock`, con compensación automática si alguna línea posterior falla:
  ```typescript
  const [updatedProd] = await db
    .update(products)
    .set({
      stock: sql`${products.stock} - ${item.quantity}`,
      updatedAt: now,
    })
    .where(and(eq(products.id, item.productId), gte(products.stock, item.quantity)))
    .returning({ id: products.id, stock: products.stock });
  ```
  - En `POST /api/sales/:id/cancel`, la transición de estado exige `WHERE id = :saleId AND status = 'completed'` en la misma sentencia `UPDATE ... RETURNING`, garantizando que solo una petición realice la devolución a Kardex.

### Hallazgo 4: Eliminación del Bypass por Fallback Offline (`ApiHttpError`)
- **Problema:** En `app/src/services/api.ts`, métodos como `createSale`, `adjustStock` o `deleteExpense` hacían:
  ```typescript
  // Código vulnerable: cualquier error HTTP cae al catch y ejecuta la mutación en local
  try {
    const res = await fetch(`${API_URL}/sales`, ...);
    if (!res.ok) throw new Error(json.error);
    return json.data;
  } catch {
    return db.createSale(payload); // Evasión de 403/409 del servidor
  }
  ```
- **Mitigación:** Se creó la clase `ApiHttpError` para distinguir rechazos explícitos del servidor (`res.status` `4xx`/`5xx`) de fallos reales de red (`TypeError`). Cuando `err instanceof ApiHttpError`, el error se propaga inmediatamente a la interfaz sin tocar la base de datos local, y además se aplicó `assertPermission(...)` antes de cualquier operación local u online.

### Hallazgo 5: Ciclo de Sesión, Revocación Inmediata con `jti` y Hashing `PBKDF2` en Modo Offline
- **Problema:** Al cerrar sesión o desactivar un usuario (`isActive = false`), los tokens JWT emitidos previamente seguían siendo válidos hasta su expiración de 24 horas. Además, si un usuario iniciaba sesión, cerraba sesión y volvía a iniciar sesión dentro del mismo segundo (`iat` idéntico), el nuevo JWT colisionaba con el token revocado. En el cliente, las cuentas locales de respaldo guardaban la contraseña en claro en `localStorage` y mostraban una columna `"Clave Demo"` en la tabla de usuarios.
- **Mitigación:**
  - Se añadió `jti: crypto.randomUUID()` al firmar cada JWT en `POST /api/auth/login`, registro de tokens revocados en `POST /api/auth/logout` y verificación en tiempo real de `dbUser.isActive` y rol vigente en `authMiddleware`.
  - Se implementó `evaluateLoginRateLimit` en dos niveles (`ip` antes que `ip:hash(email)`) con preservación de bloqueos activos ante desalojo LRU.
  - En el cliente (`app/src/services/db.ts`), se reemplazó el almacenamiento en claro por hashes `PBKDF2-SHA256` mediante Web Crypto API (`crypto.subtle`), se purgó la clave legada `erp_llantera_local_users`, se eliminó la sesión `admin` por defecto al iniciar, se ocultaron los botones demo fuera de `import.meta.env.DEV`, se limpió el caché de React Query (`queryClient.clear()`) al cerrar sesión y se configuró una `csp` explícita en `tauri.conf.json`.

---

## 4. Matriz de Evidencia y Pruebas Automatizadas de Regresión

Se implementó la suite de comportamiento `api/tests/security-regression.test.ts` ejecutada con `node:test` sobre la instancia real de Hono (`app.request`) y un adaptador en memoria aislado:

| Suite / Caso de Prueba | Frontera Evaluada | Resultado Verificado |
| :--- | :--- | :--- |
| `1. Endpoints sensibles rechazan acceso anónimo (401)` | Autenticación obligatoria y cierre de rutas de diagnóstico | `401` en `/api/products`, `/api/categories`, `/api/brands`, `/api/sales`, `/api/expenses`, `/api/users`; `404` en `/api/test-db` y `/api/env-check` |
| `2. Frontera RBAC y precios POS para empleado` | Ocultamiento de `costPrice`, invariante de precio oficial y bloqueo de descuentos/ajustes | `costPrice` ausente en catálogo; `403` al ajustar stock, consultar gastos, alterar `unitPrice`, enviar `discount > 0` o cancelar ventas; `201` al vender a precio oficial |
| `3. Sistema dinámico de permisos y fronteras de delegación` | Revocación en caliente de permisos por módulo/acción y prevención de escalada | `rh_admin` cancela venta por defecto (`200`), doble cancelación rechazada (`400` sin duplicar stock), `403` al intentar escalar a `admin`, y `403` inmediato tras revocar `sales.cancel` |
| `4. Ciclo de vida de sesión: logout y baja de cuenta` | Invalidación inmediata de tokens activos | `POST /api/auth/logout` y `PATCH /api/users/:id/status` (`isActive: false`) provocan `401` inmediato en la siguiente petición con el token previo |
| `5. Integridad transaccional y anti-TOCTOU en inventario` | Consolidación de duplicados y ventas concurrentes sobre stock limitado | Rechazo `400` al enviar `3 + 3` unidades del mismo `productId` con `stock = 5`; en dos ventas concurrentes de `4` unidades solo una se completa (`201`) y el stock queda en `1` |
| `6. Rate limiting de login en dos niveles` | Resistencia a cabeceras `X-Forwarded-For` falsificadas | Bloqueo `429` con cabecera `Retry-After` al 6.º intento aunque el atacante rote `X-Forwarded-For` en cada petición |
