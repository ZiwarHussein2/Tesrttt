# Branch System Integration Contract

Merna Control Center is the head-office system. Branch systems (reception software, attendance
devices, lab/radiology workstations) will connect to it rather than the other way round. This
document defines the contract those integrations must follow. The endpoints below are the
**planned** surface for the integration release; the internal server actions already implement
the same validation and audit paths, so the API layer is a thin authenticated wrapper.

## Principles

1. **Authenticated machine clients.** Each branch system gets a client credential scoped to its
   branch (same one-branch isolation as a Branch Admin account). Requests outside that branch
   are rejected.
2. **Same validation, same audit.** API writes go through the identical state machines and
   `logAudit()` calls as the panel. There is no privileged side door.
3. **Idempotency.** Every push carries a client-generated `externalRef`; replays are no-ops.
4. **Read-minimal.** Branch systems read only what they need (their own queue, price list,
   discount decisions); aggregate and cross-branch data stays in the head office.

## Planned endpoints (v1)

| Area | Endpoint | Payload highlights |
|---|---|---|
| Attendance | `POST /api/v1/attendance/check-in` / `check-out` | employeeCode, timestamp, deviceId, networkClass, locationClass (`INSIDE_ZONE`/`OUTSIDE_ZONE`/`UNAVAILABLE` — never raw coordinates) |
| Visits | `POST /api/v1/visits` | patientRef *or* new patient fields, serviceCode, priority, referralDoctorId |
| Payments | `POST /api/v1/visits/{visitNumber}/payments` | amount, method, discountCode? |
| Queue | `POST /api/v1/visits/{visitNumber}/transitions` | one of `call, start, complete-scan, complete-printing, complete-visit, cancel, reschedule` + reason where required |
| Reports | `POST /api/v1/visits/{visitNumber}/report` | reportDoctorId or reportText (Sonar) |
| Inventory | `POST /api/v1/inventory/movements` | itemId, type, quantity, reason, verifiedBy |
| Price list | `GET /api/v1/services?department=` | services with current pricing-window-adjusted prices |
| Discounts | `GET /api/v1/discounts/decisions?since=` | approved/rejected requests for the branch |

## Event flow examples

**Attendance device** → posts check-ins/outs as they happen; the head office derives late
minutes, overtime and exceptions exactly as the panel does. Corrections still happen only in
the panel, with reasons, so evidence stays centralized.

**Reception system** → registers the visit, takes payment (income entry is created centrally),
drives queue transitions; price changes and discounts remain head-office approvals — reception
can only *request* a discount.

## Security requirements for the integration release

- TLS-only; per-client keys with rotation; request signing (HMAC) with timestamp tolerance.
- Rate limits per client; payload schema validation (zod) before any state change.
- Full audit of every API call under the client's identity (`role: BRANCH_SYSTEM`).
- No patient contact data, report text or salary data ever flows *to* branch clients beyond
  what that branch entered itself.
