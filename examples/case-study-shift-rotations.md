# Real-World Case Study: Hardening and Security Audit of a Shift Rotations Module

> **Practical AI-assisted production validation**  
> **Author:** Guijosa Dev  
> **Environment:** Laravel 10 / PHP 8.2+ / TypeScript / MySQL  
> **Tool:** Google Antigravity (Extended reasoning model / 3.8 Flash High)  
> **Skill applied:** [`security-regression-guard`](../security-regression-guard/SKILL.md)

---

## 1. Executive Summary

This case study documents a real development cycle where an artificial intelligence agent was tasked with implementing a complex enterprise module (**Shift Rotations**) in a multi-tenant time & attendance SaaS system.

The agent initially delivered a full implementation that passed functional tests for expected inputs. However, once the **`security-regression-guard`** skill was invoked, the agent identified four security omissions across authorization and input boundaries:

1. **Missing read authorization:** Access to a JSON timeline preview route (`preview`) without verifying the required permission.
2. **Cross-tenant information disclosure (IDOR):** Returning `403` instead of `404` for records belonging to other tenants, enabling identification of existing foreign IDs.
3. **Unbounded consumption (DoS):** Lack of upper bounds on input arrays (`steps`).
4. **Out-of-range parameter:** Lack of validation for initial step order against configured rotation steps.

Guided by the skill's directives, the agent refactored controllers and FormRequests and authored **11 automated anti-regression and behavior tests** that verified explicit rejection of unauthorized and malformed requests.

---

## 2. Initial Scenario: Functionality vs. Security Boundaries

### The User Prompt
The agent was asked to build a shift rotation feature for employees:
- Weekly or day-based cyclic patterns (e.g. alternating morning, afternoon, and night shifts).
- Staggered crew support with temporal offsets.
- Chronological timeline projection and preview.
- Bulk assignment across organizational scopes (departments, job titles, sites, employment types, or individuals).

### Generated Implementation
The agent implemented:
- Database schema migrations (`schedule_rotations`, `schedule_rotation_steps`).
- Eloquent models with typed relationships.
- A chronological sequence resolver (`ScheduleRotationResolver`).
- Integration with `ScheduleAssignmentManager` to apply rotations to employees.
- REST controller (`ScheduleRotationsController`) with `store`, `update`, `preview`, `assign`, and `archive`.
- Blade templates and interactive TypeScript components.

Functionally, the code executed the expected flows and passed positive test cases. However, the model prioritized visible functionality and omitted defensive checks across authorization and validation boundaries.

---

## 3. The `security-regression-guard` Intervention

The developer invoked the skill directly:

```text
/security-regression-guard Bien, usa esta skill para el modulo nuevo de rotaciones de turno porfa
```

Upon reading the skill's instructions, the agent shifted its behavior from feature builder to security auditor:

1. **End-to-End Tracing:** Trace `Route -> Middleware -> Validation -> Authorization -> Service -> DB -> Response`.
2. **Endpoint Permission Verification:** Ensure every individual endpoint checks its specific capability (`schedules-add`, `schedules-edit`, `schedules-archive`, `schedules`).
3. **Multi-Tenant Isolation (Anti-IDOR):** Ensure unauthorized tenants cannot infer or modify another organization's records.
4. **Relational Integrity:** Verify nested foreign keys (schedules in rotation steps) belong to the caller's organization.
5. **Consumption Boundaries & DoS Prevention:** Restrict array sizes and numerical values.
6. **Explicit Rejection Tests:** Write tests confirming appropriate error codes (`403`, `404`, `422`) with zero side effects.

---

## 4. Specific Vulnerabilities Identified and Mitigated

### Finding 1: Missing Permission Check on Query Route (`preview`)
- **Issue:** `ScheduleRotationsController::preview()` computed timeline projections but omitted checking `permission::permitted('schedules')`. Any authenticated user without scheduling privileges could extract company rotation timelines.
- **Mitigation:** Enforced explicit capability check:
  ```php
  if (permission::permitted('schedules') === 'fail') {
      abort(403, 'Acción no autorizada.');
  }
  ```

### Finding 2: Multi-Tenant ID Enumeration (Anti-IDOR: 403 vs 404)
- **Issue:** Across `update`, `preview`, `archive`, and `assign`, if the requested rotation belonged to another organization, the controller returned `403 Forbidden`.
- **Security Impact:** Returning `403` for existing foreign resources and `404` for non-existent IDs enables attackers to **sequentially enumerate valid IDs** belonging to other organizations.
- **Mitigation:** Applied uniform tenant assertion returning `404 Not Found`:
  ```php
  private function assertOrganization(ScheduleRotation $rotation, int|string $organizationId): void
  {
      abort_unless((int) $rotation->organization_id === (int) $organizationId, 404);
  }
  ```
  Foreign resources now appear non-existent to other tenants.

### Finding 3: Denial of Service (DoS) via Unbounded Steps Array
- **Issue:** `StoreScheduleRotationRequest` validated `'steps' => ['required', 'array', 'min:2']` with no upper bound. A malicious payload with thousands of items would trigger excessive DB operations inside a locking transaction.
- **Mitigation:** Capped the payload strictly:
  ```php
  'steps' => ['required', 'array', 'min:2', 'max:20'],
  'steps.*.step_order' => ['required', 'integer', 'min:1', 'max:20'],
  'steps.*.duration_value' => ['nullable', 'integer', 'min:1', 'max:52'],
  ```

### Finding 4: Out-of-Bounds Initial Rotation Step
- **Issue:** When assigning a rotation, `rotation_initial_step` accepted any integer `>= 1`. Supplying step 10 for a 2-step rotation disrupted chronological schedule resolution.
- **Mitigation:** Dynamically bounded the rule against the active step count:
  ```php
  $maxSteps = max(1, $scheduleRotation->steps()->count());
  $validated = $request->validate([
      ...
      'rotation_initial_step' => ['nullable', 'integer', 'min:1', 'max:'.$maxSteps],
  ]);
  ```

---

## 5. Automated Anti-Regression Test Suite

Adhering to the skill's philosophy of **"Policy, code, and evidence"**, the agent wrote integration tests covering defensive boundaries:

| Test Case | Vector Verified | Expected Result |
| :--- | :--- | :--- |
| `test_unauthorized_user_cannot_preview_rotation` | Preview request without `schedules` permission | `403 Forbidden` |
| `test_unauthorized_user_cannot_archive_rotation` | Archive request without `schedules-archive` permission | `403 Forbidden` |
| `test_cross_tenant_rotation_access_returns_404` | Accessing `preview`, `update`, `archive`, `assign` with foreign org ID | `404 Not Found` (Anti-IDOR) on all routes |
| `test_cannot_create_rotation_with_foreign_organization_schedule` | Referencing foreign schedule ID in rotation steps | `422 Unprocessable` on `steps.*.work_schedule_id` |
| `test_cannot_create_rotation_exceeding_max_steps` | Submitting 21 steps (DoS payload) | `422 Unprocessable` on `steps` |
| `test_cannot_assign_initial_step_greater_than_total_steps` | Specifying initial step beyond total rotation steps | `422 Unprocessable` on `rotation_initial_step` |

### Test Run Output
```text
PASS Tests\Feature\Admin\ScheduleRotationsControllerTest
  ✓ store creates rotation with steps                                    0.32s
  ✓ update modifies rotation and replaces steps                          0.05s
  ✓ preview returns timeline json                                        0.05s
  ✓ assign creates assignment with initial step                          0.06s
  ✓ archive updates status to archived                                   0.04s
  ✓ unauthorized user cannot preview rotation                            0.05s
  ✓ unauthorized user cannot archive rotation                            0.10s
  ✓ cross tenant rotation access returns 404                             0.09s
  ✓ cannot create rotation with foreign organization schedule            0.05s
  ✓ cannot create rotation exceeding max steps                           0.06s
  ✓ cannot assign initial step greater than total steps                  0.06s

Tests: 11 passed (42 assertions)
Domain Suite: 67 passed (408 assertions, 0 regressions)
```

---

## 6. Observations and Takeaways

1. **Nominal path prioritization in generative models:** AI models tend to optimize responses for immediate functional requirements. Without explicit directives, they assume benign inputs and omit defensive authorization checks.
2. **Deterministic methodology vs. generic prompts:** Asking a model to "make the code secure" typically produces superficial edits. A structured skill imposes systematic inspection of routes, tenant boundaries, resource limits, and rejection tests.
3. **Early regression prevention:** Catching and remediating these four gaps within the same session prevented deploying authorization flaws and enumeration vectors to shared environments.
