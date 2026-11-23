# Key Decisions — Fintech Tool Builder (prototype)

**Problem.** Internal operations teams need small review tools (refund approvals, KYC review, flag toggles) and currently build them in Power Apps. We tested whether a constrained, Devin-built builder can cover these tools with stronger engineering controls.

**Why a constrained visual builder.** App creators get drag-and-drop layout (12-column grid, resize, numeric controls) and per-block configuration, but only from an **approved catalog** of four blocks (record table, record details, action button, audit history) plus registered datasets and actions. There are no formulas and no arbitrary code. Anything new (a block, dataset adapter or business action) is a reviewed code change, which is where Devin fits. This trades away Power Apps' breadth for predictable security and testability.

**How it fits together.**
- **Saved definitions:** an app is a JSON definition (schema version, name, one dataset, blocks with stable IDs, layout and config), validated by one shared Zod schema plus reference checks.
- **Drafts and revisions:** drafts are versioned (optimistic locking). Publishing atomically creates an immutable revision and a publish audit event.
- **Shared runtime blocks:** the runtime, preview and builder all render the same block registry. Refunds, KYC and flags use identical block code; KYC and flags were assembled in the builder UI, not coded.
- **Backend controls:** the server derives the dataset and action from the *published* block, never from the request. Every call checks the session role (builder / reviewer / viewer). Record update, audit event and idempotency result commit in one SQLite transaction. Stale record versions, stale app revisions and invalid transitions return 409.

**What Devin delivered (observed).** From one written plan, Devin produced all six phases plus a follow-up change (an optional status badge, added to a shared block without breaking existing apps) in about 1.4 hours of wall-clock time (04:15–05:40 UTC, see WORKLOG.md), including a visual-review polish pass. The result has 55 server tests, 5 Playwright end-to-end tests, a CI workflow, README and seed data. Human input: the plan, three short answers, and no code.

**What needed intervention.** Visual review caught defects that automated checks had passed:
1. The builder canvas rendered no blocks (a width-measurement hook mounted before the grid existed).
2. Runtime blocks clipped their content: hidden rows, pagination and fields.
3. Action buttons were enabled for transitions the server would reject.

Each was fixed and gained a regression test. Lesson: green tests do not prove the UI is right; a human or agent still has to look at the screens.

**Principal tradeoffs.**
| Chose | Gave up |
|---|---|
| Fixed catalog of blocks and actions | Business-user freedom (formulas, custom screens) |
| One page and one dataset per app | Multi-step or cross-dataset tools |
| SQLite, single process, localhost | Scale, high availability, real deployment |
| Server-derived actions and role checks | Fine-grained or record-level policy |

**Verified behavior.** Unauthenticated access gets 401. Viewer and builder actions, and reviewer edits or publishes, get 403. Forged block IDs and unpublished actions get 404. Substituting a dataset or action in the request body gets 422. A missing reason is rejected; an invalid transition gets 409. Replaying a request with the same key returns the original result without a duplicate event. Of two concurrent decisions, one succeeds and one gets 409. A forced audit-insert failure rolls back the record update. Calls from a stale revision get 409 and the UI asks the user to reload. Draft edits stay invisible until published. Preview cannot perform actions. Data persists across restarts. A fresh checkout passes all checks.

**Production gaps (not addressed).** No SSO or MFA, and no access reviews. No record-level assignment or multi-tenancy. The audit log is not tamper-proof against database administrators, and there is no retention policy. No independent security review. No deployment, backups, monitoring or on-call. Seeded demo credentials only. The CI workflow is written but has not been run on GitHub.
