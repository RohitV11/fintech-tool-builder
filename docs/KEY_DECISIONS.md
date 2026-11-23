# Key Decisions: Fintech Tool Builder

## System overview
- **What it is:** a local web app where builders visually assemble internal ops tools (refund approvals, KYC review, staging feature flags) from an approved catalog, then publish them for reviewers to use.
- **Three surfaces:** an app directory; a builder (12-column drag/resize grid, inspector, live validation, preview, publish); and the runtime for published apps.
- **Building blocks:** four shared blocks (record table, record details, action button, audit history), linked by stable block IDs.
- **Roles:** builder (edit and publish apps), reviewer (run actions), viewer (read only). Roles are enforced on the server.
- **Stack:** one TypeScript repo. React/Vite with react-grid-layout, Express, SQLite (better-sqlite3), and Zod shared by client and server. Tested with Vitest/Supertest (55 tests) and Playwright (5 end-to-end tests).

## Major decisions and why

**1. A constrained builder, not a general low-code tool.**
Builders get only four blocks plus datasets and actions registered in code. There are no formulas or custom code. New capabilities are reviewed code changes, which is where Devin fits.
*Why:* in fintech, a small catalog can be secured, tested and audited. *Gave up:* Power Apps' breadth.

**2. Apps are data (JSON definitions), not generated code.**
A definition holds a schema version, one dataset, and blocks with an ID, a grid layout and a config. Shared block components render it in the builder, preview and runtime.
*Why:* creating or editing an app needs no build or deploy. Every app can be validated, diffed and versioned, and one Zod schema validates it in both browser and server. KYC and flags needed zero new UI code. *Gave up:* anything the blocks don't already support.

**3. Fintech controls are built into the platform, so app builders can't omit them.**
- **Separation of duties (maker-checker):** builders design and publish but can't execute actions; reviewers execute but can't edit or publish.
- **Every decision is recorded with a reason:** actions require a reason (3–500 characters). Actor, before/after state and app revision are written to the audit log in the same transaction as the record change, so either both are saved or neither is.
- **No double execution:** idempotency keys stop a retry or double-click from approving a refund twice. Record versions make two reviewers acting at once produce one success and one 409.
- **Transition rules live on the server:** e.g. only a pending refund can be approved; invalid transitions get 409, whatever the UI shows.

*Why:* in a financial setting the most likely real failures are a duplicate payout, a missing audit trail, or one person both configuring and approving. Putting these controls in each app would let a builder forget one.

**4. The server is the only source of truth for authority.**
An action request names only a block, record, version, reason, revision and idempotency key. The server looks up the action and dataset from the *published* block; requests naming them directly are rejected (422). Roles come only from the server session, and disabled buttons are just UX.
*Why:* anything the browser sends can be forged. *Gave up:* a flexible "run any action" API.

**5. Versioned drafts and immutable published revisions.**
Saves use optimistic locking. Publish creates an immutable revision and writes a publish audit event in one transaction. Preview has no execute endpoint, and calls from a stale revision get 409.
*Why:* live users never see half-finished edits, and there's a history of which configuration made each decision. *Gave up:* autosave and instant edits.

**6. Scope: one page, one dataset, local SQLite, synthetic data.**
*Why:* this was the smallest scope that still proves the build-vs-buy question. It's reproducible with `npm ci` and needs no infrastructure. *Gave up:* multi-step or cross-dataset tools, scale and high availability, and real payment or KYC integrations.

## Known gaps
- No SSO or MFA, and no record-level assignment or multi-tenancy.
- The audit log isn't tamper-proof against database administrators, and there's no retention policy.
- No deployment or operations setup, and CI hasn't run on GitHub.
- Visual review caught three UI bugs that the tests had passed. All are fixed and now have regression tests.
