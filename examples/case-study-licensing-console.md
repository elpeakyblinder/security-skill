# Real-World Case Study: Hardening Session, Login, and Perimeter in a Licensing Admin Console

> **Practical AI-assisted validation**  
> **Author:** Guijosa Dev  
> **Environment:** Hono / Node.js / TypeScript / React 19 / Neon Postgres / Vercel Serverless / Cloudflare Workers  
> **Application type:** Internal admin panel (SPA + API) with customer-scoped operators  
> **Tool:** Claude Code (Opus 5.5 model)  
> **Skill applied:** [`security-regression-guard`](../security-regression-guard/SKILL.md)

---

## 1. Executive Summary

This case study documents the audit and hardening of an admin console that manages customers, contracts, catalog, and licenses for a commercial product. The API runs on Hono, is deployed as a serverless function, and sits behind a Worker that serves the SPA and forwards `/api/*` calls.

Unlike the previous cases, the starting point was not careless code. The application already had an `HttpOnly`, `SameSite=Strict` cookie, an HMAC-signed token, a login attempt limit, `Origin` checks on writes, per-action permissions, customer isolation in every query, parameterized SQL, and body limits. A review that only looked for the presence of those pieces would have concluded there was nothing to fix.

Invoking **`security-regression-guard`** with the instruction to harden the web app made the analysis follow each operation end to end. It found five flaws in protections that existed but did not hold against a direct request:

1. **Evadable login limit:** The limiter key came from headers the client itself could send. Every attempt could open a fresh bucket.
2. **Logout without revocation:** Signing out cleared the browser cookie, but the token stayed valid on the server for eight hours.
3. **Password rotation with no effect on open sessions:** Changing the access password did not invalidate tokens already issued.
4. **Public probe doing expensive work:** The unauthenticated readiness endpoint opened a database transaction on every call.
5. **Static pages without protection headers:** The API sent CSP and `X-Frame-Options`, but the Worker served the SPA with none of them.

All five fixes were applied in the same session, backed by five new regression tests and a check against the running API. The audit also confirmed, with no findings, the access control of all 27 routes, and left five risks flagged as decisions for the owner instead of resolving them on its own.

---

## 2. Initial Scenario: Protections Present vs. Protections Proven

### Application context

The console exposes paginated listings and write operations over customers, catalog, contracts, licenses, activations, support, and audit. Each operator has a role, a list of permissions, and optionally an assigned customer that restricts everything they can read or modify. Access uses a local password and a session cookie.

### The appearance of security

Login already included a limiter of five attempts every fifteen minutes:

```typescript
const clientIp =
  c.req.header("cf-connecting-ip") ||
  c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
  "127.0.0.1";

if (!checkLoginRateLimit(clientIp)) {
  return c.json({ error: { code: "RATE_LIMITED" } }, 429);
}
```

And sign-out responded correctly and cleared the cookie:

```typescript
authRoutes.post("/logout", async (c) => {
  if (!originAllowed(c.req.header("origin"))) {
    return c.json({ error: { code: "INVALID_ORIGIN" } }, 403);
  }
  c.header("Set-Cookie", clearCookie(config.cookieSecure));
  return c.json({ status: "ok" });
});
```

Both snippets passed their tests. The repository even had a case verifying the `429` on the sixth attempt. What no test exercised was the attacker who changes the header between attempts, or the copied token reused after logout.

---

## 3. The Intervention with `security-regression-guard`

The developer invoked the skill with an open instruction:

```text
/security-regression-guard use this skill to harden the web app
```

The analysis was organized around the skill's directives:

1. **Trace the full operation:** All 27 routes were listed with their chain `route -> middleware -> permission -> customer scope -> query/write`. The trace confirmed that every route requires a permission, that writes add `Origin` and write-mode checks, and that the customer scope derives from the authenticated operator and not from an identifier sent in the request.
2. **IP from the trusted hop:** The directive *"obtain the IP from the trusted proxy/platform, not from any forwarded header"* pointed at the login limiter. The API is reachable by two paths, through the Worker and directly, and only on the first one is the address header reliable.
3. **Session lifecycle:** The directive *"deleting the client's copy does not revoke the server's"* led to testing the token after logout. The password rule about *"old after rotation"* extended the same question to password changes.
4. **Cost of public reads:** The rule *"also limit the cost of public computations that query the database"* highlighted the readiness probe, the only sessionless route reaching the database.
5. **Effective configuration of the published artifact:** Checking what each origin actually returns showed that the protection headers lived in the API and not in the Worker delivering the HTML.
6. **Do not invent policy:** For five points that depended on a business decision or on real infrastructure, the skill called for exposing the ambiguity instead of fixing by assumption.

---

## 4. Concrete Findings and Applied Mitigations

### Finding 1: Login limit evadable with a client-chosen header

- **Problem:** The limiter was keyed by `cf-connecting-ip` or `x-forwarded-for`. Through the Worker those values are reliable, but on a direct call to the serverless function the requester writes them. A script could rotate the header on every attempt and try passwords without limit against a system with a single shared password. The bucket map also grew without a cap.
- **Mitigation:** The address is only accepted from the hop the platform guarantees. With a validated gateway key, the header set by the Worker is used; on the serverless platform, the one set by the platform itself; in any other case all attempts share one bucket.
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
  The Worker removes any `x-client-ip` arriving from the browser before setting its own, and the bucket map was capped at 10,000 entries with cleanup of expired windows.

### Finding 2: Logout that did not revoke the session on the server

- **Problem:** The token is self-contained (expiry, random value, and signature) and the server kept no state. Logout cleared the cookie, but a copy of the token kept authenticating for the remaining eight hours.
- **Mitigation:** The server records the signature of each closed session until the moment it would have expired, and verification rejects it. Only tokens that pass verification are recorded, so the registry cannot be inflated with arbitrary values.
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
  The limitation was documented in the code itself and in the report: the registry lives in process memory, and multiple serverless instances do not share it.

### Finding 3: Rotating the password did not close open sessions

- **Problem:** The signature depended only on the session secret. If the password was changed after a suspected leak, anyone already holding a token kept access.
- **Mitigation:** The signing key is derived from the secret and the current password. Changing the password immediately invalidates all earlier tokens, with no extra storage.
  ```typescript
  // The signing key depends on the password, so rotating the password ends every open session.
  function sessionSecret(): string | null {
    const secret = config.sessionSecret;
    const password = config.localAdminPassword;
    if (!secret || Buffer.byteLength(secret) < 32 || !password) return null;
    return createHmac("sha256", secret).update("session-key:" + password).digest("base64url");
  }
  ```
  The change has an operational effect that was communicated before any deployment: once published, every operator must sign in one more time.

### Finding 4: Public readiness probe doing expensive work per call

- **Problem:** `GET /health/ready` requires no session and, on every call, opened a connection, verified the database target and role, and closed the transaction. Any visitor could multiply connections against the database with no limit.
- **Mitigation:** The result is shared for five seconds across all calls, including concurrent ones, which wait on the same in-flight check.
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

### Finding 5: SPA served without protection headers

- **Problem:** The API set `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, and `Referrer-Policy` on its JSON responses. The panel's HTML, which is what the browser actually renders, left the Worker with none of them. The policy existed where it protected the least.
- **Mitigation:** The Worker adds the same headers, plus HSTS, to every static asset. To make `script-src 'self'` viable, the inline script that applied the theme before first paint was moved to its own file.
  ```typescript
  const asset = await env.ASSETS.fetch(request);
  const response = new Response(asset.body, asset);
  for (const [name, value] of Object.entries(ASSET_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
  ```

### Additional hardening

The key shared between the Worker and the API was compared with `!==`. It was replaced by a constant-time comparison over fixed-length digests.

### Risks exposed without fixing

Following the directive not to invent policy or touch real infrastructure, these points were delivered as pending decisions:

| Risk | Reason it was not fixed in the session |
| :--- | :--- |
| Logout revocation is not global across serverless instances | The full solution needs a sessions table and an unauthorized migration |
| The API may be directly reachable if the gateway key is not configured in the deployment | Depends on real configuration that could not be verified from the repository |
| With missing configuration, the database mode and expected branch fall back to permissive values | A deliberate, recent decision by the owner; the mismatch with the configuration example is flagged |
| Single shared password, no second factor; the limit is per address | Changes the product's authentication contract |
| An operator restricted to one customer can suspend or close that same customer | Business policy with no explicit definition |

---

## 5. Evidence Matrix and Anti-Regression Tests

The new tests run the real application with its middleware and check the observable response code. For the session cases, the false positive described by the skill was avoided: a valid token must first pass authentication (any response other than `401`) before showing that the same token stops working.

| Implemented Test | Vector Verified | Expected Result |
| :--- | :--- | :--- |
| `does not let a client-chosen address header open a fresh login bucket` | Six attempts, each with a different `cf-connecting-ip`, `x-forwarded-for`, and `x-client-ip` | The sixth receives `429` |
| `limits each address the gateway reports on its own` | Valid gateway key and two addresses reported by the Worker | The first is blocked on the sixth attempt; the second stays available |
| `rejects a session cookie after logout` | Valid token before and after `POST /logout` | Authenticated before; `401` after |
| `ends open sessions when the password changes` | Token issued with the previous password | `401` after rotating the password |
| `rejects a forged or missing session cookie` | Tampered signature and request without a cookie | `401` in both cases |

### Test Execution
```text
 ✓ session and login hardening > does not let a client-chosen address header open a fresh login bucket 24ms
 ✓ session and login hardening > limits each address the gateway reports on its own 3ms
 ✓ session and login hardening > rejects a session cookie after logout 2ms
 ✓ session and login hardening > ends open sessions when the password changes 1ms
 ✓ session and login hardening > rejects a forged or missing session cookie 1ms

 Test Files  1 passed (1)
      Tests  22 passed (22)
```

The 17 pre-existing tests kept passing. Type checking passed in the API and the frontend, and the production dependency audit reported no advisories.

### Check against the running API

Beyond the suite, the full flow was repeated against the local server connected to the test database:

| Step | Result |
| :--- | :--- |
| Login with the current password | `200` |
| Session query and protected listing | `200` and `200` |
| Logout | `200` |
| The same cookie against session and listing | `401` and `401` |
| Six simultaneous calls to the readiness probe | Six `200` in 144 ms total |

### What was not verified

The report explicitly separated what was tested locally from what remains pending: the modified Worker was compiled but not run, and TLS, cookies, and headers on the real domain were not checked, nor was the behavior of the deployed serverless function. No deployment and no change to real data or configuration took place.

---

## 6. Conclusions and Observations

1. **A protection that is present is not a protection that is proven:** The login limiter existed and had its test. The test always sent the same header, which is exactly what an attacker does not do. The skill forced the question of who controls each piece of data the defense depends on.
2. **Alternative routes also exist at the network level:** The same API had two entry paths, through the Worker and straight to the function. A header that was reliable on one was arbitrary input on the other.
3. **The session lifecycle ends on the server:** Logout and password rotation are promises to the user. If the server does not enforce them, the interface describes a security that does not exist.
4. **Auditing also yields useful negative results:** Confirming the access control of 27 routes with no findings has value of its own and avoided rewriting code that was already correct.
5. **Separate what was fixed from what must be decided:** Five risks were left as questions for the owner. Resolving them by assumption would have meant migrations, contract changes, or invented policies.
6. **Honesty about the reach of the evidence:** A partial mitigation, such as in-memory revocation, was delivered with its limit written next to the code, and what was not verified in production was stated as such.
