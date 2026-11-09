# Real-World Case Study: Migrating Authentication to Rust and Closing Inherited Gaps in a Job Search App

> **AI-assisted practical validation**  
> **Author:** Guijosa Dev  
> **Environment:** Astro 7 / React 19 / TypeScript / Rust (Axum, sqlx) / Neon PostgreSQL / Vercel  
> **Application type:** Job search app with user accounts, professional profiles and live search across six job boards  
> **Tool:** Claude Code (Opus 5.5 model)  
> **Applied skill:** [`security-regression-guard`](../security-regression-guard/SKILL.md)

---

## 1. Executive Summary

This case study documents the security audit and authentication migration of an application that searches job postings based on each user's profile. The project started from another system's template and had two backends: TypeScript server routes (Astro) for accounts and sessions, and a Rust service for searching external job boards.

At first glance the application had the usual protections: Argon2id passwords, an `HttpOnly`, `SameSite=Strict` cookie signed with HMAC, a login attempt limit, an anti-CSRF token and an internal service-to-service token. Invoking **`security-regression-guard`** and tracing each operation showed that several of those pieces did not protect what they appeared to protect:

1. **Framework origin protection turned off:** Astro's `Origin` check had been disabled since the initial configuration. A third-party page could sign in, sign out or create accounts on the visitor's behalf.
2. **Signing key with an unsafe fallback:** If the session secret was missing, signing used the database connection string, and it accepted the `.env.example` value.
3. **Sessions that could not be revoked:** The stateless signed cookie stayed valid for twelve hours after logout, and there was no way to block an account immediately.
4. **Sign-up that enumerated accounts:** Messages and status codes revealed whether an email or username already existed.
5. **Search without a per-account limit and unbounded memory:** Each search queried six external job boards; the attempt limiter and the search cache grew without bound.
6. **Decorative protection:** Every page issued an anti-CSRF token that no route verified.
7. **Entry points that bypassed the service, and inherited code:** A maintenance script created accounts directly in the database, and the repository carried modules, tables and a personal résumé from the original project.

The fixes moved sign-up, login, sessions, profile, search and limits into the Rust service, with sessions stored in the database and limits shared by every instance. They were verified with 13 Rust unit tests and an end-to-end run using a synthetic account that was deleted afterwards.

---

## 2. Starting Point: Protections Present Versus Protections Verified

### Application context

Users sign up with their résumé, which is read in the browser and never uploaded. The server stores only the professional profile (job title, English level, experience and skills). With that profile, the Rust service queries six job boards in parallel and returns postings published within the chosen number of days.

### The appearance of security

The framework configuration and the session cookie looked correct:

```javascript
// astro.config.mjs (initial state)
export default defineConfig({
  output: 'server',
  security: {
    checkOrigin: false,
  },
});
```

```typescript
// Session signing key (initial state)
const raw =
  process.env.API_SECRET ||
  process.env.DATABASE_URL ||   // fallback: the database connection signed sessions
  '';
if (raw.trim().length >= 16) return deriveKey(raw);
```

The cookie was `SameSite=Strict`, so it seemed immune to cross-site requests. What no test exercised was the response to a cross-site POST: the browser does not send the cookie, but it does store or delete the one the response sets.

---

## 3. The `security-regression-guard` Intervention

The developer invoked the skill on the recent authentication changes and then asked to migrate authentication to the Rust service:

```text
/security-regression-guard
```

The analysis followed the skill's directives:

1. **Reproduce before fixing:** A POST with `Origin: https://evil.example` was sent to login and sign-up. The server processed it (`303` and a validation `400`), confirming the flaw before any code changed.
2. **Check current code before claiming a protection exists:** The anti-CSRF token was generated on every page, but searching for where it was verified found no route that checked it.
3. **Session lifecycle:** The directive *"deleting the client copy does not revoke the server one"* led to replacing the signed cookie with database-backed sessions.
4. **Production closed by default:** The rule about missing configuration flagged the signing key falling back to another secret.
5. **Cost and limits:** Search was treated as an amplifier toward external services and limited per account before calling them.
6. **Do not invent policy or touch infrastructure without authorization:** The database migration and the test account were done only with the owner's explicit authorization.

---

## 4. Concrete Findings and Applied Mitigations

### Finding 1: Login, logout and sign-up accepted cross-site requests

- **Problem:** With `checkOrigin: false`, a form on another site could submit the attacker's credentials to login (*login CSRF*: the victim ends up inside the attacker's account) or sign the victim out. Sign-up parsed the body as JSON without requiring `Content-Type: application/json`, so a `text/plain` submission skipped the CORS preflight.
- **Mitigation:** The framework's origin check was enabled; it covers forms and `text/plain`.
  ```javascript
  security: {
    // Reject form (and text/plain) POSTs coming from another site.
    checkOrigin: true,
  },
  ```
- **Evidence:** Before, `Origin: https://evil.example` → `303` (login processed). After → `403` on login, logout and sign-up; the same request from the app's own origin still returns `303`.

### Finding 2: Signing key falling back to another secret and accepting the example value

- **Problem:** Anyone who knew the database connection string, or the `.env.example` value if it reached production, could forge a session for any user.
- **Mitigation:** The fallback was removed, a minimum length of 32 characters was required and the template value was rejected. Without a valid key, protected routes return `503`. After the migration to Rust, the backend refuses to start if the secret does not qualify.
  ```rust
  match cfg.api_secret.as_deref() {
      Some(s) if s.len() >= MIN_SECRET_LEN => {}
      _ => bail!("API_SECRET falta o tiene menos de {MIN_SECRET_LEN} caracteres"),
  }
  ```

### Finding 3: Sessions could not be revoked or blocked

- **Problem:** The cookie was a signed token with no server-side state. Logout only removed it from the browser; a copy kept working for up to twelve hours. There was also no way to close an account's sessions or block it immediately.
- **Mitigation:** Sessions moved to a database table. The cookie carries a random 256-bit token and the database stores only its SHA-256. Every protected request is checked against the database, together with the account status.
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
  "Sign out everywhere" and blocking via `users.disabled_at` were added. A blocked account gets the same login response as a wrong password.

### Finding 4: Sign-up revealed which accounts existed

- **Problem:** Sign-up returned `409` with "That email already has an account" or "That username is taken", and `500` for other failures.
- **Mitigation:** Every sign-up failure returns the same message and status. Logs record only the failure type, without email or username. Account, profile and session are created in a single transaction; previously, if the profile failed, the account was deleted with a second query.
- **Stated limit:** Trying combinations of a new username with a known email is still possible; only verifying the email before activating the account closes it completely. This was left as pending.

### Finding 5: Search without a per-account limit and unbounded memory

- **Problem:** Each search called six external job boards. Without a per-account limit, a single session could flood them and get the server's IP blocked. The failed-attempt map and the search cache only removed expired entries, so a burst of distinct keys made them grow without bound.
- **Mitigation:** Limits live in a database table, with SHA-256 keys that store neither IP nor email in clear text, and are updated with a single atomic statement. Every instance shares them.

  | What | Limit |
  | :--- | :--- |
  | Login attempts per IP | 20 every 15 min |
  | Wrong password per email | 10 every 15 min |
  | Sign-ups per IP | 5 per hour |
  | Searches per account | 10 per minute |

  The search cache purges expired entries on insert and is capped at 500 entries. The Rust service caps the body at 32 KB, concurrency at 64 requests and time at 45 s.

### Finding 6: An anti-CSRF token nobody verified

- **Problem:** Every page issued an anti-CSRF token and cookie, and the component received it as a prop. No route checked it. It looked like a defense that did not exist.
- **Mitigation:** It was removed. Real protection now comes from the origin check and `SameSite=Strict` cookies, both verified with requests.

### Finding 7: Entry points that bypassed the service, and inherited code

- **Problem:** A maintenance script inserted accounts directly into the database, with no validation or limits. The repository also kept notification modules, AI résumé generation and an embedded personal résumé, all from the original project, plus a table and a periodic collector that nothing read.
- **Mitigation:** The script was removed and the unused modules and table were deleted, after backing up the table's rows. The embedded résumé was checked for contact data and the repository was confirmed private.

### Additional hardening

The internal token between Astro and Rust was compared with `==`. It was replaced by a constant-time comparison with a minimum length. The Rust service no longer exposes CORS, since no browser calls it, and Astro became a thin layer that only sets the cookie and forwards requests.

### Risks reported without fixing

| Risk | Reason it was not fixed during the session |
| :--- | :--- |
| The Rust service listens on `0.0.0.0` | Depends on the real deployment network; it should sit on a private network |
| Large-scale denial-of-service attacks | App limits do not replace the platform firewall |
| Residual sign-up enumeration | Requires email verification, a new flow that was not requested |
| Astro's first per-IP limit lives in memory per instance | It is a front barrier; the limits that matter are already in the database |
| Job classification is still in TypeScript | Pending migration, with no direct security impact |

---

## 5. Evidence Matrix and Anti-Regression Tests

### Rust unit tests

| Implemented Test | Verified Vector | Expected Result |
| :--- | :--- | :--- |
| `verifica_hash_de_node_rs_y_rechaza_incorrecta` | Real hash produced by the previous TypeScript library | Verifies in Rust; a wrong password and an oversized hash are rejected |
| `tokens_aleatorios_y_con_formato` | Two session tokens | Different, well-formed, with a 32-byte hash |
| `valida_cuenta`, `rechaza_perfil_invalido` | Username, email, password and profile outside the rules | Rejected |
| `la_clave_no_guarda_el_dato_en_claro` | Limit key for an email | 64-character hash without the email |
| `token_solo_coincide_completo` | Partial or empty internal token | No match |
| `normalize_acota_terminos_y_ubicacion` | 5,000-character terms and out-of-range days | Trimmed to the maximums |

```text
test result: ok. 13 passed; 0 failed; 0 ignored
```

### End-to-end verification with a synthetic account

| Step | Result |
| :--- | :--- |
| Sign-up from the app | `201` with a session cookie |
| Home page with that session | `200` |
| Repeated sign-up with the same email | `400` with the generic message |
| Logout and reuse of the previous cookie | `401` in the service and redirect to login |
| Two open sessions and "sign out everywhere" | `closed: 2`; both `401` |
| Block the account with `disabled_at` | Open session `401` immediately; login responds as a wrong password |
| 12 wrong passwords for the same email | 10 × `401`, then `429` |
| 22 attempts from the same IP | 20 × `401`, then `429` |
| 64 KB body | `413` |
| Missing or fake internal token | `401` |

The database stored only the 32-byte hash of each token. Afterwards the account was deleted and no orphaned sessions or profiles remained.

### What was not verified

The real Vercel configuration, TLS, headers on the domain and the network of the deployed Rust service were not checked. The database migration was applied by the owner; the agent was not permitted to run it.

---

## 6. Conclusions and Observations

1. **A `SameSite=Strict` cookie does not replace an origin check:** It stops the browser from sending the cookie, not a response from setting or deleting it.
2. **A key's fallback is another key:** If signing falls back to another secret, whoever reads that secret can sign sessions.
3. **What is issued but never verified is decoration:** An unverified anti-CSRF token creates a sense of security that no behavior test would confirm.
4. **Templates bring more than code:** Modules, tables and personal data from the original project are attack surface for as long as they stay in the repository.
5. **Migrating authentication requires proven compatibility:** Testing with a real hash from the previous implementation avoided locking out existing accounts.
6. **Limits must live where the instances live:** Moving the counters to the database turned a per-process limit into a global one.
