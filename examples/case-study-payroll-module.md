# Real-World Case Study: End-to-End Hardening of a Corporate Payroll and Commissions Module

> **Practical AI-assisted validation**  
> **Author:** Guijosa Dev  
> **Environment:** Deno 2 / Oak / TypeScript / MongoDB / React 18 / Node.js / Cloudflare Tunnel  
> **Application type:** Internal financial web system (SPA + REST API) with dedicated MongoDB storage and read-only ERP integration  
> **Tool:** Google Antigravity (Extended reasoning model)  
> **Skill applied:** [`security-regression-guard`](../security-regression-guard/SKILL.md)

---

## 1. Executive Summary

This case study documents the security audit and hardening of an internal corporate web module used to calculate weekly payroll, sales and collection commissions, employee loans, financing balances, payment receipts, and executive reports. The architecture consists of a React 18 SPA served behind a reverse tunnel (Cloudflare Tunnel) that forwards `/api/*` requests to a Deno + Oak backend connected to its own MongoDB database and, in strict read-only mode, to the organization's core ERP database.

The module already featured several security mechanisms: `HttpOnly` cookies with `SameSite=Lax`, MongoDB-persisted sessions using `SHA-256` hashed opaque tokens, `PBKDF2-SHA256` password derivation (210,000 iterations) with constant-time comparison, an in-memory login rate limiter, and a three-tier access control model (`direccion`, `nomina`, and `consulta`) evaluated on every request against the database.

By applying **`security-regression-guard`** and tracing session lifecycles, role boundaries, closed-period accounting immutability, and the actual artifact served through the tunnel, **ten technical vulnerabilities** were identified and fixed across three phases:

### Phase 1: Perimeter, Session Lifecycle, and Rate Limiting
1. **Login rate-limiter bypass via FIFO `Map` eviction and spoofable IP headers:** The rate limiter trusted `cf-connecting-ip` / `x-forwarded-for` without checking whether the TCP peer was loopback, checked the composite `username:ip` key before the coarse `ip` key, and evicted the oldest `Map` entry (`MAX_BUCKETS = 5,000`) without preserving active lockouts. An attacker from a single IP could send 5,001 requests with random usernames to evict their own IP lockout record and reset their counter indefinitely.
2. **Session cookies missing explicit `Max-Age` and automatic `Secure` flag behind HTTPS tunnels, plus missing `Origin` checks on mutations:** Session cookies relied on browser session termination, lacked automatic `Secure` enforcement when accessed over HTTPS, and state-changing routes (`POST`, `PUT`, `PATCH`, `DELETE`) did not enforce an allowed `Origin` header or defensive response headers (`X-Frame-Options`, `X-Content-Type-Options`).
3. **Legacy `bcrypt` hashes never upgraded on login and hardcoded fallback password in migration CLI:** Migrated accounts remained on legacy `$2b$` hashes indefinitely, and the batch migration CLI script fell back to a predictable hardcoded password when no environment variable was provided.

### Phase 2: Report Authorization, Accounting Immutability, and NoSQL Validation
4. **Salary accumulation leakage in individual collaborator report (`nomina_por_colaborador`):** While global period and monthly payroll reports were restricted to the `direccion` tier, the per-employee accumulated payroll report remained accessible to `nomina` and `consulta` users, allowing reconstruction of company-wide compensation.
5. **Cross-collection mutation of closed accounting periods (`approved` / `paid`) and write side-effects inside `GET` routes:** Renaming an account label in an employee's master file executed an `updateMany` across `payroll_items` without filtering by `status: 'draft'`, mutating historical `approved` and `paid` payroll periods. Additionally, `GET /api/payroll/periods` triggered an automatic database snapshot write even when invoked by a read-only (`consulta`) user.
6. **Unescaped `$regex` injection in MongoDB search and unbounded JSON request bodies:** The collaborator search endpoint passed raw user strings directly into a MongoDB `$regex` filter without escaping regex metacharacters (ReDoS vector), and JSON endpoints parsed request streams without a byte limit.
7. **Unfiltered field assignment in cut/calculation rules and raw `500` error leakage:** Rule services passed request payload fields directly into MongoDB `$set` operations, and the global error handler returned raw `error.message` strings on `500` failures.

### Phase 3: Bundle Isolation, Safe Receipt Printing, and Production Server
8. **Real salary seed catalogs bundled into the frontend and overly broad Deno `--allow-read` permissions:** Two static migration catalogs containing real September employee salaries, commissions, and loan balances lived inside `frontend/src/.../data/`, and the backend runtime granted `--allow-read=../frontend`, exposing sensitive compensation data to the client bundler.
9. **HTML injection (DOM XSS) in receipt printing popup window:** The client helper that opened `window.open` and wrote the printable receipt sheet via `document.write` interpolated the document title and CSS scale factor without HTML escaping or numeric bounds validation.
10. **Development server (`WebpackDevServer`) exposed behind the public tunnel:** The startup script launched the frontend using `pnpm start` (`WebpackDevServer`), exposing unminified source code and sourcemaps through the tunnel. It was replaced with a zero-dependency Node.js production server (`server-prod.js`) that serves the compiled build, blocks `.map` files, sets security headers on HTML responses, and proxies `/api/*` to the local backend.

---

## 2. Initial Scenario: Present Safeguards vs. Real Boundaries

### Application Context
The module operates with two MongoDB connections:
1. **Dedicated module database (read/write):** Stores sessions, module users, calculation rules, employee account/loan files, and weekly payroll periods (`draft`, `approved`, `paid`).
2. **Core ERP database (strict read-only):** Queried on demand to read sales, collections, and personnel catalogs. Modifying any collection in the core ERP database is strictly prohibited.

### The Illusion of Security
A surface-level code review showed modern defenses:
- Passwords hashed with `PBKDF2-SHA256` and verified via constant-time `timingSafeEqual`.
- Global `blockConsultaWrites` middleware blocking `POST`, `PUT`, `PATCH`, and `DELETE` requests for `consulta` users.
- A `LoginRateLimiter` enforcing a 15-minute lockout after 5 failed attempts within 15 minutes and capping memory at `MAX_BUCKETS = 5_000`.

However, tracing how these defenses behaved under adversarial inputs and cross-module side effects revealed critical gaps.

---

## 3. The `security-regression-guard` Intervention

Following the skill's boundary map, the audit focused on five areas while preserving strict non-modification of the core ERP database:

1. **Side-effect tracing across HTTP methods and accounting states:** Ensure `GET` routes never mutate state for read-only users and master catalog edits never alter `approved` or `paid` payroll periods.
2. **Rate-limiter resilience under key flooding:** Analyze what happens when a single IP floods thousands of distinct usernames against a bounded in-memory `Map`.
3. **Report and dashboard visibility matrix:** Verify every report key against the access-level policy (`direccion` vs. `nomina` / `consulta`).
4. **Input and NoSQL query hygiene:** Cap HTTP stream byte size before `JSON.parse`, escape metacharacters in `$regex` queries, and whitelist fields on MongoDB updates.
5. **Development vs. production artifact separation:** Move real seed data out of `frontend/src`, tighten Deno `--allow-read` flags, and serve a compiled production build with HTML security headers.

---

## 4. Specific Findings and Applied Mitigations

### Finding 1: Login Rate-Limiter Bypass via FIFO `Map` Eviction and Spoofable IP Headers
- **Problem:** In `login-rate-limiter.ts`, `check(username, ip)` evaluated `user:ip` before `ip`, and `recordFailure(username, ip)` inserted both keys into a `Map` whose cap (`MAX_BUCKETS = 5_000`) always evicted `this.buckets.keys().next().value` (FIFO insertion order):
  ```typescript
  // Vulnerable: evicts the earliest inserted key even if it holds an active IP lockout
  if (this.buckets.size > MAX_BUCKETS) {
    const oldestKey = this.buckets.keys().next().value;
    if (oldestKey) this.buckets.delete(oldestKey);
  }
  ```
  Once an IP was locked (`ip:203.0.113.5`), sending 5,000 login attempts with random usernames (`u1`..`u5000`) filled the `Map` and evicted `ip:203.0.113.5`, immediately clearing the IP lockout. Furthermore, the login route read `x-forwarded-for` directly without checking whether the TCP connection originated from the local tunnel daemon.
- **Mitigation:**
  1. Created `resolveClientIp(context)` to accept `cf-connecting-ip` / `x-forwarded-for` **only** when the direct TCP peer is loopback (`127.0.0.1` or `::1`).
  2. Updated `LoginRateLimiter` to check the coarse IP bucket (`ip:<addr>`) first, refresh access order (LRU) via `touchBucket()`, and never evict actively locked buckets (`blockedUntil > now`) before unlocked ones:
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

### Finding 2: Session Cookie Hardening, `Origin` Validation, and Security Headers
- **Problem:** Session cookies omitted `Max-Age` and relied on a manual `AUTH_COOKIE_SECURE` flag that defaulted to `false`. State-changing requests also lacked `Origin` verification.
- **Mitigation:**
  - The configuration now auto-enables `Secure` when configured `CORS_ORIGINS` include `https://` or when requests arrive with `x-forwarded-proto: https`, and sets `Max-Age=43200` (matching the 12-hour server-side TTL) while preserving local HTTP testing on `http://localhost:3010`.
  - The global middleware sets `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: same-origin`, and rejects any write request (`POST`, `PUT`, `PATCH`, `DELETE`) whose `Origin` is not in the trusted allowlist with `403`.

### Finding 3: Transparent `bcrypt` Hash Upgrade and Removal of Hardcoded Migration Password
- **Problem:** Accounts imported during initial setup used `$2a$`/`$2b$` hashes and remained on legacy parameters indefinitely. Additionally, the CLI user migration script contained a hardcoded default fallback password.
- **Mitigation:** Upon successful login against a legacy `bcrypt` hash, `auth.routes.ts` transparently re-hashes the verified password with `PBKDF2-SHA256` (210,000 iterations, 16-byte random salt) and updates `passwordHash` in `payroll_users`. The migration CLI fallback was replaced with a random `crypto.randomUUID()` secret when no temporary password is supplied.

### Finding 4: Restricting `nomina_por_colaborador` Report to Executive Level (`direccion`)
- **Problem:** The report catalog restricted `nomina_por_periodo`, `nomina_por_mes`, and `top_colaboradores` to `direccion`, but left `nomina_por_colaborador` open to `nomina` and `consulta` users, exposing individual accumulated compensation across periods.
- **Mitigation:** Added `'nomina_por_colaborador'` to `DIRECTION_ONLY_REPORTS` in both backend (`access-level.ts`) and frontend (`access.js`), enforcing a server-side `403` on direct API calls.

### Finding 5: Immutability of Approved/Paid Periods and Guarding `GET` Side Effects
- **Problem:**
  1. In `payroll.repository.ts`, renaming an account label in an employee's master file ran `updateMany` across `payroll_items` filtered only by `area` and `collaboratorKey`, overwriting line items inside historical `approved` and `paid` periods.
  2. In `payroll.routes.ts`, `GET /api/payroll/periods` executed `captureCurrentWeekStartCards()` without checking write permissions (`canModify`), allowing `consulta` users to trigger database writes via a `GET` request.
- **Mitigation:**
  - Restricted the `payroll_items` label propagation in `payroll.repository.ts` to period IDs currently in `status: 'draft'`.
  - Guarded `captureCurrentWeekStartCards()` in `GET /api/payroll/periods` behind `canModify(user.accessLevel)`.

### Finding 6: MongoDB `$regex` Sanitization and Stream-Bounded JSON Parsing
- **Problem:** Collaborator search interpolated `search.trim()` directly into `{ $regex: search.trim(), $options: 'i' }`. Furthermore, `context.request.body.json()` buffered arbitrarily large payloads in memory.
- **Mitigation:**
  - Added `escapeRegex(value)` (`value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`) and capped search length to 120 characters.
  - Implemented `readBoundedJsonBody(context, maxBytes)` reading the request stream chunk by chunk and aborting with `413 Payload Too Large` above **64 KB** on standard routes (or **22 MB** exclusively on the two Base64 Excel workbook import endpoints).

### Finding 7: Field Whitelisting in Rules and Masking `500` Internal Errors
- **Problem:** `saveCutRule` and `validateRule` persisted unvalidated properties from the request payload, and `catch` blocks returned raw `error.message` strings when responding with status `500`.
- **Mitigation:** Enforced strict field whitelisting and domain validation (weekday integers `0..6`, `HH:MM` time strings, finite non-negative numbers) and replaced `500` client error messages with a generic safe message while logging details server-side.

### Finding 8: Moving Real Compensation Seeds Out of Frontend and Tightening Deno Permissions
- **Problem:** Two static seed files with real September compensation data were stored under `frontend/src/features/payroll/data/` and `backend/deno.json` granted `--allow-read=./,../frontend`.
- **Mitigation:** Moved both seed files to `backend/features/payroll/data/`, deleted the unused frontend directory index, and restricted `backend/deno.json` to `--allow-read=./`.

### Finding 9: HTML Escaping in Receipt Print Window
- **Problem:** `printReceiptSheets` in `print-receipt-sheets.js` interpolated `${title}` and `${scale}` into an HTML template written via `printWindow.document.write(...)`.
- **Mitigation:** Added `escapeHtml(title)` to escape `&`, `<`, `>`, `"`, and `'`, and validated `scale` as a finite number clamped to `[0.25, 2]`.

### Finding 10: Zero-Dependency Production Server and Sourcemap Blocking
- **Problem:** Running the application via `WebpackDevServer` (`pnpm start`) behind the public tunnel displayed unoptimized development warnings and exposed original source files and sourcemaps.
- **Mitigation:** Set `GENERATE_SOURCEMAP=false`, created `frontend/server-prod.js` in Node.js to serve `frontend/build` on port `3010`, block any `.map` request (`404`), attach security headers to HTML responses, and proxy `/api/*` to `http://127.0.0.1:8036`. Updated the startup script (`.bat` / `.ps1`) to automatically build `frontend/build` when source files change and launch the production server.

---

## 5. Evidence Matrix and Anti-Regression Tests

The automated Deno test suite (`deno test`) and production server checks were executed to verify every boundary:

| Test / Verification | Evaluated Vector | Observed Outcome |
| :--- | :--- | :--- |
| `access-level.test.ts`: `direccion`, `nomina`, `consulta`, `ninguno` tiers | Read/write permissions (`canModify`) and restricted financial reports | `ok` — `nomina` and `consulta` blocked from `nomina_por_colaborador`; only `direccion` and `nomina` can modify |
| `LoginRateLimiter` flood anti-eviction test | Lock an IP with 5 failures, then flood 6,000 attempts with distinct usernames (`fake_0`..`fake_5999`) | `ok` — active IP lockout is preserved in the `Map` and `check('real_user', attackerIp)` remains blocked (`allowed: false`) |
| Static type check (`deno task check`) | Type safety across routes, repositories, services, and models with `--allow-read=./` | `ok` — 0 TypeScript errors |
| Full backend test suite (`deno test`) | 44 unit and domain tests (calculation rules, account history, warehouse references, reports, permissions, and rate limiter) | `ok` — 44 passed, 0 failed |
| Production build (`pnpm run build`) + `server-prod.js` | Zero `.map` files generated, `200 OK` on `/login`, and `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` present on HTML responses | `ok` — verified on `http://localhost:3010/login` |

---

## 6. Conclusions and Key Takeaways

1. **Bounding an in-memory `Map` is ineffective if eviction is FIFO:** When a rate limiter stores both `ip` and `username:ip` keys in a single FIFO-evicted `Map`, an attacker can flush their own IP lockout by flooding fake usernames. Evaluating the IP key first, refreshing LRU order, and protecting locked buckets (`blockedUntil > now`) closes the bypass.
2. **Accounting immutability must be enforced against indirect catalog updates:** Even if direct period endpoints reject edits to `approved` or `paid` periods, a cascading `updateMany` triggered by renaming a master account will silently rewrite closed historical periods unless explicitly filtered to `status: 'draft'`.
3. **`GET` endpoints with lazy initialization violate read-only roles:** Any listing route that initializes missing records on the fly must check `canModify(user)` before writing.
4. **Never expose development bundlers behind public tunnels:** Replacing `WebpackDevServer` with a lightweight static + proxy production server eliminates source code exposure without altering local ports or tunnel routing.
