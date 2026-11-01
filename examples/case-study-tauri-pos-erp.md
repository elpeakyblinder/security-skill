# Real-World Case Study: End-to-End Hardening of a Hybrid Desktop ERP and Point-of-Sale (POS) with Offline Fallback

> **Practical AI-assisted validation**  
> **Author:** Guijosa Dev  
> **Environment:** Tauri v2 (Rust) / React 19 / TypeScript / Cloudflare Workers / Hono / Drizzle ORM / Neon PostgreSQL  
> **Application type:** Desktop ERP and Point-of-Sale (POS) with a Local-First hybrid architecture and cloud API  
> **Tool:** Google Antigravity (Extended reasoning model)  
> **Skill applied:** [`security-regression-guard`](../security-regression-guard/SKILL.md)

---

## 1. Executive Summary

This case study documents the end-to-end security audit and remediation of an automotive/tire shop ERP and Point-of-Sale (POS) system built as a native desktop application with **Tauri v2 + React 19** backed by a serverless API running on **Cloudflare Workers + Hono + Drizzle ORM + Neon PostgreSQL**, alongside an offline contingency engine (`localStorage` + Web Crypto API) designed to keep store terminals operating during internet outages.

In its initial functional state, the project already featured signed JWT authentication (`HS256`), server-side `PBKDF2-SHA256` password hashing (100,000 iterations) with constant-time verification, Zod schema validation, role-based navigation hiding (`admin`, `rh_admin`, and `empleado`), and a visual role-permission matrix editor.

By applying **`security-regression-guard`** and tracing every operation from the native WebView down to SQL queries and the offline fallback layer, **eight architectural and business-logic vulnerabilities** were identified and fixed across three phases:

### Phase 1: API Perimeter, Dynamic Permission Matrix, and Privilege Delegation
1. **Unauthenticated business routes and public diagnostic endpoints:** While `/api/auth/me` enforced Bearer tokens, the inventory (`/api/products`, `/api/categories`, `/api/brands`), sales (`/api/sales`), and expenses (`/api/expenses`) routers—along with `/api/test-db` and `/api/env-check`—had been left publicly accessible after initial integration testing. Additionally, `GET /api/expenses/categories` executed an automatic `INSERT` seeding loop on every read request.
2. **Disconnect between the UI permission matrix (`UsersPage`) and backend enforcement:** The module-and-action permission modal only mutated local React state without server persistence or enforcement. Delegation boundaries were also missing: an HR/supervisor account (`rh_admin`) with user management access could create `admin` accounts or deactivate the primary administrator.
3. **Unit cost (`costPrice`) and profit margin leakage to cashier accounts (`empleado`):** `GET /api/products` returned the `costPrice` column to any authenticated user querying the catalog from the POS terminal, exposing wholesale purchase costs across the entire inventory.

### Phase 2: POS Transactional Invariants, Catalog Pricing, and Concurrency (TOCTOU)
4. **Client-side unit price and discount tampering in `POST /api/sales`:** The backend computed sale subtotals and totals using the `unitPrice` and `discount` values submitted in the client JSON payload, allowing a cashier (`empleado`) to sell tires below the official catalog price or apply discounts without the `sales.discount` permission.
5. **Stock bypass via duplicate line items and TOCTOU race conditions in sales, cancellations, and Kardex adjustments:**
   - Submitting two line items with the same `productId` in a single sale (`3 + 3 = 6` units) bypassed per-line stock validation when available stock was `5`.
   - Inventory deduction checked stock with a `SELECT` and then executed an unguarded `UPDATE`, allowing negative stock under concurrent sales.
   - `POST /api/sales/:id/cancel` checked sale status in memory before restoring stock, allowing concurrent requests to restore inventory twice.

### Phase 3: Session Lifecycle, the Offline-Fallback Trap, and Tauri Container Hardening
6. **Authorization bypass via indiscriminate Offline Fallback (`try/catch` in the HTTP client):** The client service `api.ts` wrapped `fetch` calls in a generic `try/catch` intended to fall back to the local database during network outages. However, because HTTP `401`, `403`, `409`, and `422` responses threw a generic `Error`, the `catch` block intercepted explicit server rejections and silently executed the forbidden mutation against the local database.
7. **Pre-authenticated `admin` startup session, plaintext offline passwords, and JWT `jti` collision on revocation:** The auth store booted with a pre-authenticated `admin` session (`token: "demo-jwt-token-active"`), local fallback accounts stored plaintext passwords in `localStorage` and rendered a `"Demo Password"` column in the UI, and JWT tokens issued within the same second lacked a unique `jti` claim.
8. **`csp: null` in `tauri.conf.json` and missing native WebView origins in CORS:** The Tauri configuration disabled Content Security Policy (`csp: null`), and the backend CORS allowlist omitted Tauri's native WebView origins (`http://tauri.localhost`, `https://tauri.localhost`, `tauri://localhost`).

---

## 2. Initial Scenario: Functionality vs. Security Boundaries

### Application Context
The application enforces three business roles confirmed with the product owner:
- **`admin` (Administrator):** Full system access and exclusive governance over role permission matrices (`settings.roles`).
- **`rh_admin` (Supervisor / HR):** Commercial supervision, inventory creation and Kardex stock adjustments, POS discounts, sale cancellations (`sales.cancel`), expense cancellations (`expenses.cancel`), and operational user management without the ability to create or modify `admin` accounts.
- **`empleado` (Cashier / Counter Sales):** Strict POS terminal operation and catalog lookup. Can only sell at the official catalog `salePrice`, cannot apply discounts, and cannot view wholesale `costPrice` or cash-drawer profit breakdowns.

---

## 3. Specific Findings and Applied Mitigations

### Finding 1: Dynamic `Module -> Action` Permission Engine and Delegation Boundaries
- **Problem:** Permissions were checked on the client against a static list while the role configuration modal in `UsersPage.tsx` only updated a local `useState` object.
- **Mitigation:** Implemented the authoritative permission engine in `api/src/utils/permissions.ts` and exposed `GET /api/users/roles` and `PUT /api/users/roles/:roleId`:
  - **Server-side module dependency:** When a module has `enabled: false`, `hasRolePermission(role, permission)` denies all actions within that module even if individual action flags remain `true`.
  - **Immutable governance floor:** `updateRoleModules` prevents disabling critical governance permissions (`users.manage`, `settings.roles`, `settings.manage`) on the `admin` role, preventing accidental self-lockout.
  - **Delegation boundary (`canDelegateRole`):** In `POST /api/users` and `PATCH /api/users/:id/status`, `rh_admin` is blocked from creating `admin` accounts or deactivating existing administrators.

### Finding 2: Strict Catalog Pricing in POS, `costPrice` Stripping, and Duplicate Line Consolidation
- **Problem:** In `POST /api/sales`, the backend trusted client-supplied `unitPrice` values and validated `prod.stock < item.quantity` line by line without grouping by `productId`. Furthermore, `GET /api/products` exposed `costPrice` to all roles.
- **Mitigation:**
  1. In `GET /api/products` and `GET /api/products/:id`, `canViewCostPrice(role)` checks whether the actor holds `inventory.edit` or `reports.profits`; otherwise, `costPrice` is stripped before serialization.
  2. In `POST /api/sales`, duplicate `productId` lines are consolidated first, `sales.discount` is required whenever `discount > 0`, and any `unitPrice` diverging from the database `salePrice` is rejected with `403`:
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

### Finding 3: Atomic Conditional Stock Deduction and Sale Cancellation (Anti-TOCTOU)
- **Problem:** Two concurrent sales of 4 units each against a product with `stock = 5` both read `stock = 5` during the initial `SELECT` and drove inventory to `-3`. Similarly, two concurrent calls to `POST /api/sales/:id/cancel` restored stock twice.
- **Mitigation:**
  - In `POST /api/sales` and `POST /api/products/:id/adjust`, stock updates enforce an atomic predicate on the `stock` column with automatic rollback compensation if a subsequent item fails:
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
  - In `POST /api/sales/:id/cancel`, the state transition requires `WHERE id = :saleId AND status = 'completed'` inside the `UPDATE ... RETURNING` statement, guaranteeing that stock is restored at most once.

### Finding 4: Eliminating the Offline-Fallback Authorization Bypass (`ApiHttpError`)
- **Problem:** In `app/src/services/api.ts`, mutation methods such as `createSale`, `adjustStock`, and `deleteExpense` used a catch-all fallback:
  ```typescript
  // Vulnerable: any HTTP 4xx/5xx error falls into catch and mutates the local DB
  try {
    const res = await fetch(`${API_URL}/sales`, ...);
    if (!res.ok) throw new Error(json.error);
    return json.data;
  } catch {
    return db.createSale(payload); // Bypasses server 403/409 rejection
  }
  ```
- **Mitigation:** Introduced `ApiHttpError` to separate explicit HTTP rejections (`4xx`/`5xx`) from genuine network failures (`TypeError`). Whenever `err instanceof ApiHttpError`, the error is rethrown immediately without touching the local store, and `assertPermission(...)` is enforced prior to both online and offline execution.

### Finding 5: Session Lifecycle, Immediate Revocation with Unique `jti`, and Offline `PBKDF2` Hashing
- **Problem:** Logging out or deactivating a user (`isActive = false`) left previously issued JWTs valid for up to 24 hours. Moreover, if a user logged in, logged out, and logged in again within the same second (identical `iat`), the newly issued JWT collided with the revoked token hash. On the client, offline fallback accounts stored plaintext passwords in `localStorage` and displayed a `"Clave Demo"` column in the user table.
- **Mitigation:**
  - Added `jti: crypto.randomUUID()` to every JWT signed in `POST /api/auth/login`, recorded revoked tokens on `POST /api/auth/logout`, and verified live `dbUser.isActive` and canonical role on every request in `authMiddleware`.
  - Implemented two-tier login rate limiting (`ip` evaluated before `ip:hash(email)`) with active-lockout preservation during LRU eviction.
  - Replaced plaintext offline password storage in `app/src/services/db.ts` with Web Crypto API `PBKDF2-SHA256` hashes, scrubbed the legacy `erp_llantera_local_users` key, removed the default pre-authenticated `admin` session, gated quick-login demo buttons behind `import.meta.env.DEV`, cleared the React Query cache (`queryClient.clear()`) on logout, and configured an explicit `csp` policy in `tauri.conf.json`.

---

## 4. Evidence Matrix and Automated Regression Tests

A behavioral test suite was implemented in `api/tests/security-regression.test.ts` using `node:test` against the real Hono application (`app.request`) and an isolated in-memory database adapter:

| Test Suite / Case | Boundary Evaluated | Verified Behavior |
| :--- | :--- | :--- |
| `1. Sensitive endpoints reject anonymous access (401)` | Mandatory authentication and diagnostic route removal | `401` across `/api/products`, `/api/categories`, `/api/brands`, `/api/sales`, `/api/expenses`, `/api/users`; `404` on `/api/test-db` and `/api/env-check` |
| `2. RBAC boundary and POS catalog pricing for empleado` | `costPrice` stripping, strict catalog pricing, and discount/adjustment blocking | `costPrice` omitted from catalog; `403` on stock adjustments, expenses, tampered `unitPrice`, `discount > 0`, or sale cancellation; `201` on valid catalog sale |
| `3. Dynamic permission matrix and delegation boundaries` | Live module/action revocation and privilege escalation prevention | `rh_admin` cancels sale by default (`200`), double cancel rejected (`400` without double stock restore), `403` when attempting to create an `admin`, and immediate `403` after `admin` revokes `sales.cancel` |
| `4. Session lifecycle: logout and account deactivation` | Immediate revocation of active tokens | `POST /api/auth/logout` and `PATCH /api/users/:id/status` (`isActive: false`) immediately cause the next request with the prior token to fail with `401` |
| `5. Transactional integrity and anti-TOCTOU in inventory` | Duplicate item consolidation and concurrent sales against limited stock | `400` when submitting `3 + 3` units of the same `productId` with `stock = 5`; under two concurrent sales of `4` units, only one succeeds (`201`) and remaining stock is `1` |
| `6. Two-tier login rate limiting` | Resilience against spoofed `X-Forwarded-For` headers | `429` lockout with `Retry-After` header on the 6th attempt even when rotating fake `X-Forwarded-For` values on every request |
