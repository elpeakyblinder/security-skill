# Real-World Case Study: Comprehensive Hardening of Authentication, Session Lifecycle, and Role Access Control

> **Practical AI-assisted production validation**  
> **Author:** Guijosa Dev  
> **Environment:** Python 3.10+ / PyQt6 / SQLite (Local-First) & MySQL / Bcrypt  
> **Application type:** Desktop / Point of Sale (POS) Terminal  
> **Tool:** Google Antigravity (Extended reasoning model)  
> **Skill applied:** [`security-regression-guard`](../security-regression-guard/SKILL.md)

---

## 1. Executive Summary

This case study documents the end-to-end security audit and hardening of the authentication workflow, session lifecycle, and navigation perimeter in a desktop Point of Sale (POS) system built in Python and PyQt6 with dual persistence (local-first SQLite and remote MySQL).

At first glance, the login and credential verification module complied with industry-standard security guidelines: it relied on the cryptographic library `bcrypt` for password hashing and verification, and all SQL queries across SQLite and MySQL used parameterized placeholders (`%s` / `?`), preventing SQL injection. As a result, static linters and preliminary code reviews marked the implementation as secure.

However, upon executing the **`security-regression-guard`** skill across the entry gateway (Login) and the runtime execution perimeter (Main Menu and child windows), systematic inspection of authorization boundaries exposed seven security flaws across two critical phases:

### Phase 1: Entry Gateway and Cryptography (Login)
1. **Bypassing deactivated account status:** Suspended or terminated employees (`Status = 'Inactive'`) could continue logging into the system and retain administrative access if they knew their credentials, because the login routine ignored account status.
2. **Timing attack on legacy password migration:** Plaintext passwords transitioning to `bcrypt` were validated using Python's standard equality operator `!=`, vulnerable to byte-by-byte short-circuit timing analysis.
3. **Information leakage and username enumeration:** Dissonant error dialogs disclosing the existence of default accounts, combined with measurable CPU latency differences between existing and non-existent usernames during `bcrypt` evaluation.
4. **Denial of Service (DoS) via unbounded inputs:** Lack of an upper-bound length check on passwords prior to CPU-intensive `bcrypt` hashing rounds, allowing an attacker to freeze the PyQt6 GUI main thread.

### Phase 2: Navigation Perimeter and Runtime Session Lifecycle (Menu and Child Windows)
5. **Lack of reactive session revocation in cashier modules:** An employee account marked as `Inactive` while keeping the desktop menu open could continue launching the POS Terminal and performing Cash Drawer Closures indefinitely.
6. **Absence of defense in depth in sensitive child windows:** High-privilege administrative windows (`MainGestion`, where users and passwords are created and modified) omitted role checks in their constructor, relying exclusively on parent menu gatekeeping.
7. **Risk of orphaned windows and dialogs on logout:** Non-modal secondary dialogs could remain open in memory after user session termination.

Guided by the skill's methodology, the query layer, login widget, main menu, and subwindows were refactored and backed by **10 automated anti-regression tests** using synthetic data and an isolated SQLite test database, achieving clean test passage without impacting any of the 96 pre-existing system tests.

---

## 2. Initial Scenario: Functionality vs. Security Boundaries

### Application Context
The application is a desktop POS terminal engineered for offline-first reliability (SQLite) and optional multi-terminal centralized operation (MySQL). Administrative modules (inventory management, cash drawer balancing, employee administration, and financial metrics) require the `Administrativo` role, whereas cashier operations are restricted to the `Empleado` role.

### The Illusion of Security
The initial codebase implemented:
- In `Auth/login.py`: Native `bcrypt.checkpw()` calls for `$2b$` hashes, parameterized SQL statements, and client lockout after 3 failed attempts.
- In `Screens/Menu.py`: Real-time double validation for administrative modules (`_is_admin()`), hiding cards and shortcuts for cashier roles.

Despite these safeguards, the nominal code path failed to enforce business authorization invariants across the full session lifecycle. LLMs and syntax-driven tools frequently assume that using `bcrypt` and hiding UI buttons resolves security, overlooking reactive runtime revocation and defense in depth in child layers.

---

## 3. The `security-regression-guard` Intervention

The audit was executed by instructing the agent to apply the skill's methodology across authentication and navigation modules:

```text
/security-regression-guard Audita y refuerza el login y el menú principal
```

Following the skill's guidelines, the agent structured the audit around explicit security boundaries:

1. **End-to-End Tracing:** Trace `User Input -> Input Validation -> Identity Retrieval -> Cryptographic Verification -> Account State Check -> Menu Session -> Module Execution -> Session Logout`.
2. **Runtime Lifecycle Validation:** Verify that inactive, revoked, or deleted accounts cannot execute actions at any point during desktop process execution.
3. **Constant-Time Verification:** Ensure constant-time secret comparison without early conditional exits.
4. **Anti-Enumeration Protections:** Guarantee uniform error messages and matching CPU execution times between existing and non-existent accounts.
5. **Defense in Depth:** Prevent internal controllers and secondary windows from blindly delegating authorization to calling views.
6. **Resource and Window Containment:** Enforce input length caps and guarantee exhaustive closure of UI objects upon logout.

---

## 4. Specific Findings and Applied Mitigations

### Phase 1: Entry Gateway and Cryptography (Login)

#### Finding 1: Account Status Bypass (`Status = 'Inactive'`)
- **Problem:** In `DB/queries/auth.py`, `authenticate_user(username)` retrieved all columns from `users` (including `Status`), but `LoginWidget.check_credentials()` in `Auth/login.py` only evaluated password validity. An employee flagged as `Inactive` could log in without restriction. Furthermore, `get_user_role(username)` returned the assigned role without filtering by status, allowing active UI checks such as `_is_admin()` to authorize deactivated users.
- **Mitigation:** Active account status was enforced both at login and during role resolution:
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

#### Finding 2: Timing Attack in Legacy Password Migration
- **Problem:** To allow smooth upgrades from older versions without forcing password resets, legacy plaintext passwords were verified and transparently upgraded to `bcrypt` on first successful login. However, comparison was performed with `!=`:
  ```python
  if password != stored_password:
      self._register_failed_attempt()
      return
  ```
  Python's string equality short-circuits on the first mismatching byte, exposing micro-timing variations.
- **Mitigation:** Replaced with constant-time comparison via `hmac.compare_digest()`:
  ```python
  import hmac

  if not hmac.compare_digest(password, stored_password):
      self._register_failed_attempt()
      return
  new_hash = bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode("utf-8")
  db.update_user_password(username, new_hash)
  ```

#### Finding 3: Information Disclosure and Account Enumeration
- **Problem:** Two separate enumeration vectors were identified:
  1. `_register_failed_attempt()` checked whether a solitary `admin` user existed and appended a hint: `(Usuario inicial por defecto: admin / contraseña: admin)`.
  2. A non-existent username returned in ~1 ms, whereas an existing username triggered `bcrypt.checkpw()`, taking ~150 ms. This difference allowed remote or local timing attacks to map existing accounts.
- **Mitigation:**
  - Removed all account discovery hints, standardizing responses to a generic invalid credentials message.
  - Introduced a constant-time dummy hash check (`_DUMMY_BCRYPT_HASH`). When a user does not exist or is inactive, `bcrypt.checkpw()` executes against the dummy hash to balance CPU execution times:
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

#### Finding 4: Denial of Service (DoS) via Unbounded Input
- **Problem:** PyQt6 executes widget interactions on the main GUI thread unless dispatched to worker threads. A password payload with tens of kilobytes of data forced `bcrypt` to spend excessive CPU cycles, freezing the desktop interface.
- **Mitigation:** Implemented an early guard capping password input to 128 characters prior to hashing:
  ```python
  if len(password) > 128:
      self._register_failed_attempt()
      return
  ```

---

### Phase 2: Navigation Perimeter and Runtime Session Lifecycle (Menu and Child Windows)

#### Finding 5: Lack of Reactive Session Revocation in Cashier Modules
- **Problem:** If a user was revoked or flagged as `Inactive` in the database while keeping the main menu window open, the POS module (`show_punto_de_venta`) and Cash Drawer Closure (`show_corte`) did not verify account validity. The deactivated user could continue operating transactions and closing shifts indefinitely.
- **Mitigation:** Implemented reactive guards `_is_session_active()` and `_require_active_session()` in `Screens/Menu.py`. Opening any module revalidates active account status against the database in real time. If the account is deactivated, it aborts execution, displays a session expired notification, and immediately forces menu closure:
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

#### Finding 6: Absence of Defense in Depth in Sensitive Child Windows
- **Problem:** `MainGestion` (which manages user accounts, passwords, and roles) omitted permission checks in its `__init__()` constructor, relying entirely on the parent menu's `_require_admin()` guard. If instantiated through an alternative path, administrative protection vanished.
- **Mitigation:** Embedded internal role validation in `MainGestion.__init__()` querying the database and raising `PermissionError` immediately if the active user lacks the `Administrativo` role:
  ```python
  # Screens/Gestion.py
  if self.username and hasattr(self.db, 'get_user_role'):
      role = self.db.get_user_role(self.username)
      if role != "Administrativo":
          raise PermissionError(
              f"Acceso no autorizado: el usuario '{self.username}' no tiene permisos de Administrador para este módulo."
          )
  ```

#### Finding 7: Risk of Orphaned Windows and Dialogs on Logout
- **Problem:** On logout (`closeEvent`), `_close_all_subwindows()` iterated over a static attribute list. Non-modal secondary dialogs could remain lingering on the desktop after returning to the login widget.
- **Mitigation:** Enhanced cleanup to traverse and close all active child window widgets in memory:
  ```python
  for child in self.findChildren(QtWidgets.QWidget):
      if child.isWindow() and child is not self and child is not self.login_widget:
          if child.isVisible():
              child.close()
  ```

---

## 5. Evidence Matrix and Anti-Regression Tests

To substantiate all reinforced boundaries, unit tests were created in `tests/test_auth_security.py` using isolated `SQLiteRepository` test fixtures in temporary directories:

| Test Case | Security Invariant Verified | Expected Outcome |
| :--- | :--- | :--- |
| `test_active_user_authentication_success` | Valid credentials for active user with `bcrypt` hash | Successful login, opens menu, resets failed attempts |
| `test_inactive_user_authentication_blocked` | Valid password for user flagged as `Inactive` | Access denied, menu not opened, increments failed counter |
| `test_get_user_role_blocks_inactive_users` | Role lookup for inactive account | Returns `None`, blocking protected module access |
| `test_dos_long_password_rejected_immediately` | Password payload exceeding 128 characters | Rejected before database queries or `bcrypt` hashing |
| `test_legacy_plaintext_password_migrates_to_bcrypt` | Legacy plaintext credential validation | Constant-time validation and atomic database upgrade to `bcrypt` |
| `test_wrong_password_rejected` | Invalid password for existing user | Rejection without leaking credential or system specifics |
| `test_nonexistent_user_rejected_without_enumeration` | Login attempt with unknown username | Uniform error dialog without user discovery leakage |
| `test_rate_limiting_lockout_after_max_attempts` | Three consecutive failed authentication attempts | Strict 30-second lockout enforced on the interface |
| `test_menu_session_revocation_blocks_pos_and_corte` | Runtime deactivation of user with menu open | Reactive lockout on POS, Corte, and Inventory with session expired alert |
| `test_gestion_defense_in_depth_raises_permission_error_for_non_admin` | Instantiation of `MainGestion` with non-administrative user | Mandatory `PermissionError` raised in constructor |

### Test Execution
```text
Ran 10 tests in 8.932s

OK

Ran 96 tests in 9.856s

OK
```
All 10 security regression tests and all 96 pre-existing project tests passed with zero regressions.

---

## 6. Conclusions and Key Takeaways

1. **The illusion of secure-looking code:** An application can adhere to best-in-class cryptographic primitives (`bcrypt`) and maintain zero SQL injection vulnerabilities while remaining vulnerable to critical authorization bypasses and side-channels.
2. **Security is a continuous lifecycle:** Authorization checks must not stop at login. For desktop applications running over extended shifts, reactive runtime revalidation is vital to enforce immediate account suspensions.
3. **Defense in depth across UI components:** Hiding buttons or unbinding shortcuts in a main navigation window is not a substitute for internal self-validation in sensitive child windows (`MainGestion`).
4. **Cross-environment versatility:** This case study confirms that the skill is equally effective in native desktop applications (Python/PyQt6 local-first) as it is in traditional web backends (multi-tenant PHP/Laravel).
