# Implementation design (authoritative decisions on top of PLAN.md)

PLAN.md is the product spec. This file settles interfaces so implementation needs no guesses.

## Repo layout (single package, no workspaces)
```
.nvmrc                      # 22
package.json                # "engines": {"node": ">=22 <23"}
src/shared/                 # imported by both client and server
  schema.ts                 # Zod: AppDefinition, Block, per-block config schemas, request bodies
  catalog-types.ts          # SafeCatalog types (what /api/catalog returns)
  validate.ts               # validateDefinition(def, catalog) -> {ok} | {errors: ValidationError[]}
src/server/
  index.ts                  # starts app; HOST default 127.0.0.1, PORT default 3000
  app.ts                    # createApp({db, ...}) -> express app (Supertest uses this)
  db.ts                     # open db (DB_PATH default ./data/app.db), migrations
  seed.ts                   # seedDemo(db): users, records, demo apps
  auth.ts                   # scrypt, sessions, middleware, throttling, origin check
  datasets/registry.ts      # DatasetAdapter interface + registry
  datasets/refunds.ts, kyc.ts, flags.ts
  routes/*.ts
src/client/                 # React + Vite
  main.tsx, api.ts, routes (react-router-dom)
  blocks/registry.tsx       # component registry
  blocks/RecordTable.tsx, RecordDetails.tsx, ActionButton.tsx, AuditHistory.tsx
  pages/Login.tsx, Directory.tsx, Builder.tsx, Runtime.tsx
  styles.css
scripts/                    # init-db.ts, reset-demo.ts (tsx)
tests/server/*.test.ts      # Vitest + Supertest, in-memory or temp-file DB
tests/e2e/*.spec.ts         # Playwright
```
Run TS with `tsx` in dev/scripts; production: `vite build` for client, `tsc -p tsconfig.server.json` (or tsup) for server; `npm start` serves `dist/client` statically + API from one Express process.

### npm scripts
`setup` (npm ci + db:init), `db:init` (create schema + seed only if empty; idempotent), `db:reset` (drop + recreate + seed; explicit only), `dev` (concurrently: tsx watch server + vite with /api proxy), `build`, `start`, `typecheck`, `test` (vitest), `test:e2e` (playwright; uses its own DB file and freshly reset data), `check` (typecheck + test + build).

Startup NEVER seeds or resets automatically, except: if DB has no schema, server exits with message "run npm run db:init".

## Data model (SQLite, better-sqlite3, WAL, foreign_keys=ON)
```
users(id TEXT PK, username UNIQUE, display_name, role CHECK in('builder','reviewer','viewer'), password_hash, org_id)
sessions(id TEXT PK /*sha256 of token*/, user_id, created_at, expires_at)
login_attempts(username, ip, at)             -- throttle: >5 failures / 15 min per username+ip -> 429
apps(id TEXT PK, name, created_by, created_at, published_revision_id NULL)
app_drafts(app_id PK, definition_json, version INTEGER, updated_by, updated_at)
app_revisions(id TEXT PK, app_id, revision_number INTEGER, definition_json, published_by, published_at, UNIQUE(app_id, revision_number))
refund_requests(id, customer_ref, amount_cents INTEGER, currency, reason_submitted, status in(pending,approved,rejected), version, created_at, updated_at)
kyc_cases(id, customer_ref, masked_email, masked_phone, summary, status in(pending,approved,rejected), version, created_at, updated_at)
feature_flags(id, key UNIQUE, description, enabled INTEGER, environment CHECK='staging', version, updated_at)
audit_events(id, at, actor_user_id, event_type /*'action'|'publish'*/, app_id, app_revision_id, dataset_id NULL, record_id NULL, action_id NULL, reason NULL, before_json NULL, after_json NULL)
idempotency_keys(user_id, key, request_hash, response_status, response_json, created_at, PRIMARY KEY(user_id, key))
```
IDs: `crypto.randomUUID()` for apps/revisions/events; records use readable prefixed ids (`rf_001`, `kyc_001`, `ff_001`). Seed ~25 refunds, ~15 KYC, ~8 flags, mixed statuses. All visibly labelled synthetic (e.g. customer_ref `SYN-CUST-0001`).

## Auth
- Passwords: `crypto.scrypt` (N=16384,r=8,p=1, 16-byte salt), stored `scrypt$salt$hash` hex; `timingSafeEqual`.
- Demo accounts: `builder` / `reviewer` / `viewer`, password `demo-password` (README says demo-only).
- Session: 32 random bytes base64url token in cookie `sid` (HttpOnly, SameSite=Lax, Secure only when NODE_ENV=production && COOKIE_SECURE=1, Path=/), DB stores sha256(token). 8h expiry. Logout deletes row.
- Mutating requests (POST/PUT/PATCH/DELETE): require `Origin` header (or `Referer` fallback) whose origin equals the server's own origin (configurable ALLOWED_ORIGINS, includes Vite dev origin in dev). Missing/mismatch -> 403. Also require `Content-Type: application/json`.
- Role comes only from the session's user row. Never read role from body/query/header.
- Permissions (single function `can(user, perm)`):
  - `apps.read_published`: all
  - `apps.read_drafts`, `apps.edit`, `apps.publish`: builder
  - `records.read`, `audit.read`: all
  - `actions.execute`: reviewer only

## Shared definition schema (src/shared/schema.ts)
```ts
SCHEMA_VERSION = 1
Layout = { x: int 0..11, y: int >=0, w: int 1..12, h: int 1..40 } with x+w<=12
BlockBase = { id: string /^[a-z0-9_-]{1,40}$/, type, layout: Layout }
RecordTableConfig  = { title: string 1..80, columns: string[] min1, defaultStatusFilter: string|null, pageSize: 5|10|25 (default 10) }
RecordDetailsConfig= { title, fields: string[] min1, sourceTableId: string }
ActionButtonConfig = { label: string 1..40, actionId: string, sourceTableId: string }
AuditHistoryConfig = { title, sourceTableId: string }
Block = discriminatedUnion('type', [record_table, record_details, action_button, audit_history]) each {..., config}
AppDefinition = { schemaVersion: 1, name: string 1..80, datasetId: string, blocks: Block[] max 30 }
```
Zod objects are `.strict()` (unknown keys -> 422).

`validateDefinition(def, catalog)` (shared; server runs it on save AND publish, client runs it live in builder):
- Schema parse errors.
- datasetId exists in catalog.
- Block ids unique.
- columns/fields subset of dataset readable fields; defaultStatusFilter in dataset's status filter values (or null).
- sourceTableId references an existing `record_table` block in the same definition.
- actionId is in dataset's compatible actions.
- Layout: within grid, no overlapping rectangles.
Errors: `{ path: string, blockId?: string, message: string }[]`.
Save draft: schema parse must pass (422 otherwise) but *reference* errors are allowed in drafts (stored, returned as `validationErrors`); publish requires zero errors (422 with errors).

## Dataset registry (server)
```ts
interface DatasetAdapter {
  id: 'refunds'|'kyc'|'flags'; label: string; simulatedNotice: string;
  fields: { key: string; label: string; type: 'text'|'money'|'status'|'boolean'|'datetime'|'int' }[];
  searchableFields: string[]; statusField: string; statusValues: string[];
  sortKeys: string[]; defaultSort: { key: string; dir: 'asc'|'desc' };
  query(db, { search?, status?, sort?, dir?, page, pageSize }): { rows: Record<string,unknown>[]; total: number };
  get(db, id): Record<string,unknown> | undefined;
  actions: ActionDef[];
}
interface ActionDef {
  id: string;              // globally unique: refunds.approve, refunds.reject, kyc.approve, kyc.reject, flags.enable, flags.disable
  label: string; requiresReason: true; permission: 'actions.execute';
  // called inside the transaction with the current row; throws InvalidTransition if not allowed
  apply(db, row): { after: Record<string,unknown> };
}
```
Transitions: refunds/kyc approve|reject only from `pending`; flags.enable only when disabled, flags.disable only when enabled. Status filter for flags: `enabled`/`disabled` derived field `state`.
Query: whitelist sort keys/fields; search = LIKE on searchableFields with escaped `%`/`_`; pageSize max 50; all SQL parameterized; returned rows include ONLY readable fields + `id` + `version`.
Record endpoints return only the columns/fields configured on the block (plus id, version, status field) — not every readable field.

`GET /api/catalog` returns SafeCatalog: blocks (type ids + labels), datasets (id, label, simulatedNotice, fields, statusValues, actions[{id,label}]). No SQL, no handlers.

## API (all JSON; errors `{ error: { code, message, details? } }`)
- `POST /api/auth/login {username,password}` -> 200 {user}; 401 bad creds; 429 throttled.
- `POST /api/auth/logout` -> 204. `GET /api/auth/me` -> 200 {user} | 401.
- `GET /api/catalog`.
- `GET /api/apps` -> published apps for all; builder also sees drafts-only apps + `hasUnpublishedChanges`.
- `POST /api/apps {name, datasetId, duplicateFromAppId?}` (builder) -> 201 {app, draft}. Duplicate copies the source's draft definition (new name).
- `GET /api/apps/:id/draft` (builder) -> {definition, version, validationErrors}.
- `PUT /api/apps/:id/draft {definition, expectedVersion}` (builder) -> 200 {version, validationErrors}; 409 if version mismatch.
- `POST /api/apps/:id/publish {expectedDraftVersion}` (builder) -> 201 {revisionId, revisionNumber}; 409 stale draft; 422 validation errors. Atomic: insert revision, update apps.published_revision_id, insert publish audit event.
- `GET /api/apps/:id/runtime` -> {app, revisionId, revisionNumber, definition}; 404 if never published.
- `GET /api/apps/:id/blocks/:blockId/records?revisionId&search&status&sort&dir&page` -> block must be a record_table in the CURRENT published revision. `revisionId` optional for reads.
- `GET /api/apps/:id/blocks/:blockId/records/:recordId` -> block must be record_details in published revision (dataset from app definition).
- `GET /api/apps/:id/blocks/:blockId/audit?recordId=` -> block must be audit_history; returns action events for that dataset+record, newest first.
- `POST /api/apps/:id/blocks/:blockId/execute {recordId, expectedVersion, reason (trim, 3..500), revisionId, idempotencyKey (uuid)}` (reviewer):
  order: auth 401 -> perm 403 -> app/published 404 -> block exists & is action_button in published revision else 404 -> revisionId != current published -> 409 code `STALE_REVISION` -> body validation 422 -> idempotency lookup (same user+key: same request_hash => replay stored response; different hash => 422 code `IDEMPOTENCY_KEY_REUSED`) -> transaction { load row (404), version mismatch -> 409 `VERSION_CONFLICT`, apply (invalid -> 409 `INVALID_TRANSITION`), update row version+1, insert audit, insert idempotency row with the 200 response } -> 200 {record, auditEventId}.
  request_hash = sha256 of canonical JSON {appId, blockId, recordId, expectedVersion, reason, revisionId}.
  Store idempotency for success only (failures are not cached; retry of a failed request re-evaluates).
  Any unknown body keys -> 422 (no `actionId`/`datasetId` accepted).
- Test hook for audit failure: `createApp({ hooks: { beforeAuditInsert?: () => void } })` — only injectable programmatically in tests, never via HTTP/env.

Status codes exactly per PLAN: 401/403/404/409/422 (+429 throttle).

## Client
- react-router-dom: `/login`, `/` directory, `/apps/:id` runtime, `/apps/:id/edit` builder, `/apps/:id/preview` preview (renders current draft with mutations disabled; builder only).
- Block registry entry: `{ type, label, configSchema, defaults(datasetCatalog) , defaultSize {w,h}, Inspector: React.FC<{config, onChange, dataset, definition}>, Renderer: React.FC<RendererProps> }`.
- RendererProps: `{ block, ctx }` where ctx = `{ appId, revisionId|null, mode: 'runtime'|'preview'|'design', dataset (catalog), selection: Record<tableBlockId, recordId|null>, select(tableId, recordId), user, refreshKey, bumpRefresh() }`.
- Preview mode: renders the draft; data reads in preview go through a builder-only endpoint `GET /api/apps/:id/draft/blocks/:blockId/records[...]` and `/records/:recordId` and `/audit` (same handlers, resolved against the saved draft instead of the published revision). Action buttons in preview are disabled with tooltip "Disabled in preview". No execute endpoint exists for drafts.
- Runtime: after successful action, bumpRefresh (tables/details/audit refetch). On 409 STALE_REVISION show banner "This app was republished — reload to continue" with Reload button. On VERSION_CONFLICT/INVALID_TRANSITION show message in dialog and refresh.
- Action dialog: shows record summary, required reason textarea, Confirm/Cancel; generates idempotencyKey once per dialog open (crypto.randomUUID) and reuses it on retry.
- Action button visible to all but disabled with explanation for builder/viewer ("Reviewer role required"); server enforces anyway. Disabled until a record is selected.
- Builder: react-grid-layout (`cols=12`, `rowHeight=30`, `compactType={null}`, `preventCollision`), drag from palette via RGL `isDroppable` + `onDrop`. Selecting a block opens inspector: config controls + numeric x/y/w/h inputs. Toolbar: name, dataset select (changing dataset when blocks exist asks confirmation and resets field configs), Save (explicit), Preview, Publish, saved/unsaved indicator, validation error list (click focuses block). `beforeunload` + router blocker when dirty. Duplicate/remove buttons on the selected block. Viewport < 1024px: show "Editing requires a desktop-sized window".
- Runtime layout: CSS grid 12 cols using block layout on >=900px; below, blocks stack in (y, x) order.
- Render all data as text (no dangerouslySetInnerHTML). Money formatted from integer cents via Intl.NumberFormat. Every app shows dataset's simulatedNotice banner ("Simulated: approving records a decision only; no refund is executed.").
- States: loading skeleton/text, error with retry, empty ("No records match"), no-selection ("Select a record in <table title>").

## Seed apps
- `db:init`/`db:reset` seed: users, records, AND the refund app (published rev 1) — Phase 2/3 builds this.
- KYC + flags apps: Phase 5 assembles them via the builder UI (Playwright script `tests/e2e/assemble-apps.spec.ts` drives the real builder), then their exported definitions are committed in `src/server/seed-apps/*.json` and seeded by db:reset.

## Testing
- Server tests use a fresh temp DB per test file via `createApp`.
- Concurrency test: two execute calls with same expectedVersion, different idempotency keys -> exactly one 200, one 409, one audit event.
- Playwright: webServer runs `npm run build && npm start` against `DB_PATH=./data/e2e.db` after `db:reset`.

## Git
Local repo only (no remote). Branch per phase, merged to `main` with `--no-ff` at end of phase:
`phase-1-bootstrap`, `phase-2-refund-slice`, `phase-3-runtime-blocks`, `phase-4-builder`, `phase-5-reuse`, `phase-6-verification`, later `followup-status-badge`.
Small, descriptive commits. `.gitignore`: node_modules, dist, data/*.db*, .env, playwright-report, test-results.

## Work log
`docs/WORKLOG.md`: per phase — start/end UTC timestamp, what was built, corrections/failed attempts, verification commands + results.
