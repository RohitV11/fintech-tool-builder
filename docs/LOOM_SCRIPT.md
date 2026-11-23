# Loom script (target 4:40)

Before recording: run `npm run db:reset && npm start`, open http://127.0.0.1:3000, and keep three browser profiles ready (builder / reviewer / viewer, password `demo-password`).

**0:00–0:35 — Problem.** The ops team runs refund, KYC and flag review tools in Power Apps. The Power Apps capabilities we chose to replicate: visual layout, data-bound tables and forms, approval buttons and history. Formulas and arbitrary connectors are deliberately left out.

**0:35–2:15 — Build and publish (builder profile).**
1. Directory → **Duplicate** "Refund approvals" (or **New app** → Refund requests).
2. Builder: drag Record details / Action button / Audit history from the palette, resize one block, then change table columns and the default status filter in the inspector.
3. Point out the unsaved indicator and the live validation (remove the table to show the broken-reference error, then undo it).
4. **Save** → **Preview** (actions disabled) → **Publish** (revision number increments).
5. Reviewer profile: open the app, select a pending refund, **Approve**, enter a reason, **Confirm**. The status updates and Decision history shows the event.

**2:15–2:55 — Controls and reuse.**
- Viewer profile: the action button is disabled with "Reviewer role required". Mention the server returns 403 regardless (covered by tests).
- Retry the same refund as reviewer: the button is unavailable, and the server returns 409.
- Open "KYC review" and "Staging feature flags": same four blocks, assembled in the builder, no workflow-specific code.

**2:55–3:40 — Devin's contribution.** Devin built six phases plus a follow-up from one plan, in about 1.4 hours of wall-clock time (WORKLOG.md). That includes 55 server tests, 5 end-to-end tests, CI and docs. Mention the three defects caught only by visual review. Remaining human responsibilities: requirements, reviewing, security sign-off, operating it.

**3:40–4:40 — Recommendation.** Use observed facts only (see the "Recommendation" section of EVALUATION.md once the cost inputs are filled in).
