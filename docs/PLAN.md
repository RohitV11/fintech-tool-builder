# Devin-built visual internal-tool builder

## 1. Goal, scope, and assumptions

Build a standalone web application that lets an app creator visually assemble internal tools from approved components, datasets, and business actions. Demonstrate it with a refunds approval queue, KYC review queue, and staging feature-flag panel.

**Devin Cloud builds and maintains the software. It is not invoked when employees create layouts or use published tools.** Power Apps is not a dependency.

The workspace is empty. This is a new project.

Decisions confirmed:

- Build a **mini visual builder**, rather than only finished internal apps.
- Use a **drag-and-drop grid** with resizing, rather than unrestricted pixel positioning.
- Offer an **approved catalog** of datasets and actions. New capabilities require code changes through Devin.
- Run locally with seeded demo accounts and synthetic data.

## 2. Product experience and supported behavior

### App creation and publishing

Provide three main screens:

- **App directory:** List published apps for all authenticated users. Builders also see drafts and controls to create or duplicate an app.
- **Builder:** Component palette on the left, grid canvas in the center, configuration inspector on the right.
- **Runtime:** Display a published app without editing controls.

Each app has one page and one primary dataset. This limits complexity while demonstrating meaningful configuration.

The builder supports:

- Naming an app and selecting its dataset.
- Dragging blocks from the palette onto a 12-column grid.
- Moving, resizing, configuring, duplicating, and removing blocks.
- Selecting allowed columns, fields, filters, and business actions.
- Explicit draft saving, read-only preview, and publishing.
- A saved/unsaved indicator and warning before abandoning unsaved changes.
- Numeric layout controls as an alternative to dragging.

Use a desktop editor. On narrow screens, published apps stack blocks vertically; editing requires a desktop-sized viewport.

### Four reusable block types

| Block | Builder settings | Runtime behavior |
|---|---|---|
| Record table | Title, permitted columns, default status filter | Search, filter, paginate, and select a record |
| Record details | Title, visible fields, source table | Display the selected record; show an empty state before selection |
| Action button | Label, approved action, source table | Open a confirmation dialog, collect a reason, and submit the action |
| Audit history | Title, source table | Display authorized history for the selected record |

Bindings use stable block IDs. A detail panel, action, or audit block references a table block from the same app.

The builder cannot configure arbitrary executable behavior or override authorization. Removing a referenced table produces a validation error that must be fixed before publishing.

Preview renders the same components as runtime, but disables business mutations.

### Three example workflows

**Refund approvals**

- Synthetic records contain customer reference, amount in integer cents, currency, status, and record version.
- Pending requests can become approved or rejected; both require a reason.
- Terminal decisions cannot be repeated or reversed in this prototype.
- Approval records a decision only. It does not execute a refund.

**KYC review**

- Synthetic records contain customer reference, masked contact information, a short review summary, status, and version.
- Pending cases can become approved or rejected, with a required reason.
- No uploaded documents, automated identity verification, or account activation.

**Staging feature flags**

- Synthetic records contain key, description, enabled state, environment, and version.
- Reviewers can enable or disable a flag, with a required reason.
- Only a seeded staging environment exists.
- This changes demonstration records; it does not control a live product.

Build the refund app first. Assemble KYC and feature-flag apps through the builder using the same block implementations. No workflow-specific screen components.

### Demo identities

Seed three password-authenticated accounts:

| Role | Allowed behavior |
|---|---|
| Builder | Create, edit, preview, and publish apps; read demo data; cannot execute business actions |
| Reviewer | Use published apps, read records and history, execute approved actions; cannot edit apps |
| Viewer | Use published apps and read records/history; cannot edit or execute actions |

All accounts belong to one synthetic organization. Record-level assignment and multi-tenant isolation are explicitly unimplemented.

Account switching requires signing out and signing in. Never accept a role supplied through a request header, query parameter, or client-side dropdown.

## 3. Technical architecture and interfaces

### Stack and execution

Use one TypeScript repository:

- React and Vite for the frontend.
- React Grid Layout for dragging and resizing.
- Express for the backend.
- SQLite through `better-sqlite3` for persistent local storage.
- Zod for shared configuration and request validation.
- Vitest, Supertest, and Playwright for verification.
- npm with a committed lockfile and a pinned supported Node LTS version.

Use standard CSS and reusable application components; avoid introducing a separate design-system project.

Provide scripts for installation, database initialization, explicit demo reset, development, production build, local production serving, and tests. Resetting data must be an explicit command, never an automatic startup behavior.

### Component and dataset catalogs

Define a component registry containing each block’s:

- Stable type identifier.
- Configuration schema and defaults.
- Inspector controls.
- Runtime renderer.

Define a backend dataset registry containing:

- Allowed readable fields, filters, and sorting keys.
- Record lookup and paginated query handlers.
- Compatible business actions.
- Authorization requirements.

The browser receives safe catalog metadata. Database queries, permissions, and action implementations remain server-side.

This separates two kinds of extension:

- **App creator:** Changes layouts, fields, bindings, and approved actions without code.
- **Engineer using Devin:** Adds a component, dataset adapter, or business action through reviewed code.

### Saved definitions and publication

An app definition contains a schema version, app name, dataset ID, and a list of blocks. Each block has a stable ID, type, grid position/size, and validated configuration.

Persist:

- Users and sessions.
- Apps and editable drafts.
- Immutable published app revisions.
- Three sets of synthetic business records.
- Audit events.
- Idempotency records for business actions.

Draft edits do not affect the live app. Publishing validates the entire definition and creates a new revision atomically.

Runtime requests identify the published revision. If publication changes while someone is using an older version, reject mutations from the stale revision and require a reload.

Use optimistic version checks for draft saves and business-record updates so concurrent edits cannot silently overwrite one another.

### API surface

| Interface | Purpose |
|---|---|
| `/api/auth/login`, `/logout`, `/me` | Establish and inspect server-managed sessions |
| `GET /api/catalog` | Return permitted component, dataset, and action metadata |
| `/api/apps` | List apps and create a draft |
| `/api/apps/:id/draft` | Read and save a versioned draft |
| `POST /api/apps/:id/publish` | Validate and publish the saved draft |
| `GET /api/apps/:id/runtime` | Read the published definition |
| `/api/apps/:id/blocks/:blockId/records` | Query authorized data for a configured table |
| `/api/apps/:id/blocks/:blockId/records/:recordId` | Read an authorized record |
| `/api/apps/:id/blocks/:blockId/audit` | Read history associated with the configured dataset |
| `POST /api/apps/:id/blocks/:blockId/execute` | Execute the action configured for that published block |

Action requests carry record ID, expected record version, reason, published revision, and an idempotency key. The server derives the action and dataset from the saved block; the caller cannot substitute either.

Use consistent responses: `401` unauthenticated, `403` unauthorized, `404` missing resource, `409` stale/conflicting state, and `422` invalid configuration or input.

### Security and consistency

- Store password hashes using Node’s `scrypt`; document that seeded credentials are demo-only.
- Use opaque server-side sessions, HttpOnly SameSite cookies, logout invalidation, login throttling, and same-origin checks for mutations.
- Serve frontend and API from the same origin in the local production configuration.
- Validate all inputs and catalog identifiers; use parameterized SQL and plain-text rendering.
- Bind the server to localhost by default. Keep database files and secrets out of Git.
- Enforce authorization on every backend operation, independently of hidden or disabled buttons.
- Validate current business state and expected version inside the transaction.
- Commit record changes, audit events, and idempotency results together.
- Replaying the same idempotency key and payload returns the original result; reusing it with different input fails.
- A new request against an already decided or stale record fails without creating another business event.

Audit events record actor, action, record, timestamp, reason, before/after state, and originating app revision. Publish events record the builder and revision.

Describe audit history accurately: persistent and protected by application permissions, but not tamper-proof against database administrators.

## 4. Devin execution sequence and acceptance tests

### Development sequence

Use Devin Cloud as the primary implementation environment, connected to a dedicated GitHub repository named `fintech-tool-builder`.

1. **Bootstrap:** Create the application skeleton, commands, seeded database, authentication, and role enforcement.
2. **Working vertical slice:** Implement one fixed refund page with real persistence and tested backend actions. Establish correctness before introducing the editor.
3. **Reusable runtime:** Extract the four block types and render the refund page from a saved definition.
4. **Visual builder:** Add drag-and-drop, resizing, inspector controls, draft persistence, validation, preview, and publishing.
5. **Reuse demonstration:** Add KYC and staging-flag adapters/actions, then assemble their apps through the builder.
6. **Verification and packaging:** Complete tests, inspect the UI, verify setup from a fresh checkout, and document results and gaps.

Give Devin the acceptance criteria at the start. Request incremental commits and reviewable checkpoints. Keep an actual work log covering elapsed time, active human effort, Devin usage, corrections, failed attempts, and remaining work.

No deployment or embedded Devin API integration is required. Repository creation and Devin access are execution prerequisites; this chat currently has no connected Devin tool.

### Acceptance tests

**Builder and runtime**

- Assemble, save, publish, and reopen a refund app without editing its configuration in code.
- Drag, resize, and configure blocks; preserve changes after a server restart.
- Bind selection to details, actions, and audit history.
- Reject broken references, unknown fields, incompatible actions, and invalid layout definitions.
- Ensure draft changes remain invisible to runtime until published.
- Prevent preview mode from performing mutations.
- Render empty, loading, error, and no-selection states clearly.

**Authorization**

- Reject unauthenticated API access.
- Reject viewer mutations and reviewer attempts to edit or publish.
- Reject builder business actions.
- Reject forged block IDs, dataset substitutions, and unpublished action calls.
- Verify logout invalidates the session.

**Business correctness**

- Valid approval/rejection updates one record and creates one audit event.
- Missing reasons and invalid transitions fail.
- Retried requests do not duplicate effects.
- Concurrent decisions produce one success and one conflict.
- Audit-write failure rolls back the business update.
- Stale app revisions require reload before mutation.

**Reuse and reproducibility**

- All three apps use the same runtime blocks.
- Duplicating and reconfiguring an app requires no code changes.
- Complete one follow-up change through Devin: add an optional status badge display to the shared table and verify existing apps still function.
- A fresh checkout can install, initialize, build, run, and pass the documented checks.
- GitHub CI runs type checking, backend tests, production build, and core browser tests.

## 5. Evaluation and submission deliverables

### Evaluation

Compare the result with Power Apps across:

- **Authoring:** Visual configuration within an approved catalog versus broader visual development and formulas.
- **Build cost:** Actual Devin consumption plus requirements, review, debugging, and testing time.
- **Maintenance:** Component changes, configuration compatibility, dependencies, integrations, and incident ownership.
- **Security:** Verified backend controls versus missing SSO, access governance, record-level policy, independent review, and hardened audit retention.
- **Opportunity cost:** Engineering capacity required to own this builder and its apps.
- **Economics:** Avoidable license spend versus migration, parallel operation, infrastructure, maintenance, and development costs.

Separate observed results from estimates. Do not infer long-term reliability or production security from a successful demonstration.

The recommendation must depend on the evidence. Building is more attractive if a limited catalog covers most planned tools and the company has an owner and operational infrastructure. Buying is more attractive if broad business-user flexibility or platform ownership would consume the expected savings.

### GitHub repository

Include:

- Working source, lockfile, initialization scripts, synthetic seed data, and CI.
- README with exact setup commands, demo credentials, usage walkthrough, architecture, and limitations.
- Instructions for adding one new block or dataset/action adapter.
- Actual time/usage log and verification results.
- Clear labels for simulated refunds, KYC decisions, and staging flags.

### Loom: target 4 minutes 40 seconds

- **0:00–0:35:** Client problem and the Power Apps capabilities selected.
- **0:35–2:15:** Assemble/configure an app, publish it, and execute a permitted action.
- **2:15–2:55:** Show an unauthorized attempt, audit history, and reuse in another app.
- **2:55–3:40:** Explain Devin’s contribution, measured effort, and remaining responsibilities.
- **3:40–4:40:** Present the build-versus-buy recommendation and next steps.

Use observed results only. Disclose actual build time if it exceeds the assignment limit.

### Key Decisions one-pager

Keep to one page covering:

- Why a constrained visual builder was selected.
- Why approved data/actions and structured layouts bound the scope.
- How saved definitions, shared runtime blocks, and backend controls fit together.
- What Devin actually delivered and what needed intervention.
- Principal tradeoffs, verified behavior, and production gaps.

Completion means the prototype passes the acceptance criteria, the repository is reproducible and accessible to reviewers, the video is under five minutes, and the one-pager reflects the actual implementation.
