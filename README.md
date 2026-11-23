# Fintech Tool Builder

A standalone, localhost-only prototype for visually assembling internal tools
from registered blocks, datasets, and business actions. The demo includes a
refund approval queue, a KYC review queue, and a staging feature-flag panel.
All records and actions are simulated; this application does not connect to
payment, identity-verification, or live feature-flag systems.

## Setup

Use Node.js 22, as pinned by `.nvmrc`. With `nvm` installed, run from the
repository root:

```sh
nvm install
nvm use
npm ci
npm run db:init
npm run dev
```

Open <http://127.0.0.1:5173>. `npm run db:init` creates the schema and adds any
missing synthetic demo data without deleting existing records. The server
refuses to start if the database schema is missing.

To run the built app instead of the Vite development server:

```sh
npm run build
npm start
```

The built server listens on <http://127.0.0.1:3000> by default. To explicitly
discard and recreate the selected demo database, run `npm run db:reset`; it
deletes that database before seeding it. `DB_PATH` can select a different
database file.

## Demo-only credentials

These fixed accounts and the shared password are **for local demonstration
only**. Do not use them for real accounts or expose this app to a network.

| Username | Role | Password |
| --- | --- | --- |
| `builder` | Builder | `demo-password` |
| `reviewer` | Reviewer | `demo-password` |
| `viewer` | Viewer | `demo-password` |

## Walkthrough

1. Sign in as `builder`. The directory lists the published Refund approvals,
   KYC review, and Staging feature flags apps. Choose **New app** to select a
   dataset, or **Duplicate** on an app card to start an independent draft.
2. In the builder, use the block palette and inspector to assemble or adjust
   the app. **Save** the draft, use **Preview** to inspect it, and choose
   **Publish** to create a runtime revision.
3. Sign out and sign in as `reviewer`. Open Refund approvals, select a pending
   record, choose an action, and enter a reason. The record status and audit
   history update after the simulated decision.
4. Sign in as `viewer` and open the same published app. Action buttons are
   disabled for this role; the server also rejects an unauthorized execute
   request with HTTP 403. Client-side disabled controls are not the security
   boundary.
5. Return as `reviewer`, select the record, and inspect its audit history for
   the action, timestamp, reason, and actor.
6. Sign in as `builder` and duplicate an app from the directory. The copy has
   its own draft. Draft changes appear in Preview, but do not affect the
   published runtime until you save and publish them.

## Simulated notices

Every runtime displays the dataset's simulated notice:

- Refunds: `Simulated: approving records a decision only; no refund is executed.`
- KYC: `Simulated: no documents, identity verification, or account activation.`
- Staging flags: `Simulated staging flags: changes demo records only; no live product is controlled.`

Approvals, rejections, and flag changes only update synthetic rows in the local
SQLite database. No documents are reviewed, accounts activated, refunds
issued, or live product features controlled.

## Architecture

- The React/Vite client renders definitions using a four-type block registry:
  record table, record details, action button, and audit history. The registry
  provides each block's schema, defaults, inspector, renderer, and default
  size; the builder and runtime use the same registered block implementations.
- The server's dataset registry supplies the safe catalog of datasets, fields,
  statuses, actions, and simulated notices. Dataset adapters own record
  queries and state transitions.
- App definitions are validated JSON. The current definition is stored as a
  versioned draft; each publish stores a new immutable revision and updates
  the published-revision pointer. The runtime renders the published revision,
  not unsaved draft state.
- The server enforces role permissions, definition/reference compatibility,
  dataset/action compatibility, record versions, required reasons, and
  idempotency. It performs the action, audit insert, and idempotency write in a
  transaction. Hiding or disabling a client control does not replace these
  server checks.
- SQLite holds the demo data, drafts, revisions, sessions, idempotency keys,
  and audit events. The application is standalone; it does not depend on
  Power Apps or invoke an AI agent when employees create or use tools.

## How to add a block

1. In `src/shared/schema.ts`, define the block's strict config schema, inferred
   config type, and block schema. Add it to the `BlockSchema` discriminated
   union so saved definitions are parsed on both client and server.
2. Implement the block's inspector and renderer in
   `src/client/blocks/<block-name>.tsx`, using `InspectorProps` and
   `RendererProps` from `src/client/blocks/types.ts`. Renderers should honor
   the supplied mode (`design`, `preview`, or `runtime`) and use the shared
   renderer context for selection and refresh behavior.
3. Add its registry entry to `src/client/blocks/registry.ts`: type, label,
   config schema, dataset-based defaults, default size, inspector, and
   renderer.
4. Add its ID and label to the block list returned by `safeCatalog()` in
   `src/server/datasets/registry.ts`, which supplies the builder palette.
   Extend `validateDefinition()` in `src/shared/validate.ts` when the block
   introduces reference or compatibility rules beyond schema parsing.
5. Add validation and rendering coverage in
   `tests/server/validate.test.ts` and the relevant Playwright spec under
   `tests/e2e/`. Update seeded definitions if an existing demo app should use
   the new block.

## How to add a dataset or action adapter

1. Implement `DatasetAdapter` in `src/server/datasets/<dataset>.ts`. Define
   its catalog fields, status metadata, search/sort behavior, record query and
   lookup methods, simulated notice, and any actions. An action's `apply`
   method must enforce the allowed current-state transition and persist the
   new record; actions require a reason and use the `actions.execute`
   permission.
2. Register the adapter by importing its module in
   `src/server/routes/api.ts`, alongside the existing adapter imports. If it
   is a new dataset ID, extend the `DatasetAdapter` ID union in
   `src/server/datasets/registry.ts`.
3. If the dataset needs its own storage, add its table to the schema in
   `src/server/db.ts` and seed synthetic rows in `src/server/seed.ts`.
   `scripts/init-db.ts` and `scripts/reset-demo.ts` both call the demo seeder.
4. If it needs a published demo app, assemble and publish it through the
   builder, export its definition to `src/server/seed-apps/`, and add an
   idempotent seed function. Wire that function into both
   `scripts/init-db.ts` and `scripts/reset-demo.ts`; keep the JSON definition
   export script in `scripts/`.
5. Add server tests under `tests/server/` for valid and invalid transitions,
   reasons, idempotent retries, and cross-dataset isolation. Update
   `tests/e2e/assemble-apps.spec.ts` if the builder should assemble the new
   app through the UI. Runtime action rendering remains generic; do not add a
   workflow-specific client component.

## Checks

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

`npm run check` runs type checking, server tests, and the production build.
Playwright uses a separate `data/e2e.db` and resets it when its web server
starts. On GitHub Actions, Chromium is installed with its Linux dependencies
by the CI workflow.

## Limitations

- No SSO or production identity integration.
- No record-level assignment or multi-tenant isolation.
- Audit events are not tamper-proof against database administrators.
- Data is synthetic; all business actions are simulated.
- The server binds to `127.0.0.1` by default and is intended for localhost
  only, not public or shared-network deployment.
