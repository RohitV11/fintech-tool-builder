# Build vs buy — evaluation against Power Apps

Observed results come from this prototype (see WORKLOG.md and the test suites). **Estimates** are labelled and need real inputs before they inform a recommendation.

| Dimension | This prototype (observed) | Power Apps | Notes / inputs needed |
|---|---|---|---|
| Authoring | Drag/resize grid with 4 approved blocks, registered datasets and actions; no formulas | Broad visual development, formulas, many connectors | Prototype covers one page, one dataset and record-decision tools only |
| Build cost | About 1.4 h wall-clock Devin time for phases 1–6, the follow-up and UI polish; human time: plan writing plus brief answers | Licence plus maker time | **Input:** Devin usage (ACUs) from the usage dashboard; human review hours |
| Maintenance | Code changes via reviewed PRs; schema-versioned definitions; follow-up added a block option without breaking existing apps | Vendor-maintained platform | **Estimate:** engineer-hours/month to own it; dependency upgrades |
| Security | Server-enforced roles, transactional audit, idempotency, optimistic concurrency, same-origin checks, all tested | Entra ID SSO, DLP policies, environment governance | Prototype lacks SSO, record-level policy, independent review, hardened audit retention |
| Opportunity cost | Requires an owning team | Platform team handles the platform | **Input:** available engineering capacity |
| Economics | n/a (not deployed) | Per-user/per-app licences | **Input:** current licence spend, user count; migration and parallel-run cost; hosting |

## Recommendation (fill in after the inputs)
- **Build** is favoured if most planned tools fit the catalog (tables, details, decisions, history), a team will own the builder and its infrastructure, and the licence savings exceed ownership costs.
- **Buy (stay on Power Apps)** is favoured if business users need broad self-service flexibility, or if platform ownership would consume the expected savings.

A successful demo does not show long-term reliability or production security.
