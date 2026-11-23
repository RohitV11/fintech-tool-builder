# Work Log

All timestamps are UTC.

## Phase 1 — bootstrap, database, and authentication

- **Start:** 2026-11-23 04:15 UTC (start time supplied in the handoff).
- **End:** 2026-11-23 04:27 UTC (the Phase 1-only authentication suite passed).
- Added the Node 22/npm project setup, Vite/React shell, Express `createApp`,
  complete SQLite schema, idempotent initialization and explicit reset
  scripts, synthetic users and records for refunds, KYC, and feature flags,
  session authentication, role permissions, and the login/workspace pages.
- The first typecheck found Express 5 path parameters typed as
  `string | string[]`; Phase 2 added a narrow `pathParam` normalizer for route
  parameters.
- `npx vitest run tests/server/auth.test.ts` — passed, 1 file and 7 tests.

## Phase 2 — refunds approval slice

- **Start:** 2026-11-23 04:18 UTC (first Phase 2 source file creation).
- **End:** 2026-11-23 04:26 UTC (final checks and the curl smoke test completed).
- Added the refund dataset adapter, strict shared definition validation,
  published seeded app, catalog/runtime/record/audit/execute endpoints,
  transaction-backed audit and idempotency handling, and the fixed refund
  review page. KYC and feature-flag records remain seeded but have no workflows
  in this phase.
- The initial `npm audit fix` could not resolve the Vitest advisories without
  a major-version upgrade. Vitest was upgraded to 5.1.1; npm then reported
  zero vulnerabilities.
- The first smoke-test retry used a noninteractive shell without loading
  nvm and failed with `node: command not found`; sourcing
  `$HOME/.nvm/nvm.sh` fixed the environment for npm and curl verification.
- `npm run typecheck` — passed.
- `npm test` — passed, 3 files and 29 tests.
- `npm run build` — passed; the TypeScript server build and Vite production
  build completed.
- `npm run db:init` was run twice against a fresh temporary database. Both
  initializations succeeded and left 3 users, 25 refunds, 15 KYC cases, 8
  feature flags, 1 app, 1 published revision, and 1 draft.
- `npm run db:reset && npm start` followed by curl login as `reviewer` and
  approval of `rf_001` — passed. The refund changed from `pending` version 1
  to `approved` version 2, and the audit endpoint returned exactly one event
  with the submitted decision reason.
- The server was stopped after the smoke test; port 3000 had no listener.

## Phase 3 — reusable runtime blocks

- **Start:** 2026-11-23 04:30 UTC (the idempotency-ordering fix was the first
  commit on `phase-3-runtime-blocks`).
- **End:** 2026-11-23 04:34 UTC (runtime-block implementation committed and
  merged to local `main`).
- Moved the table, details, action, and audit renderers into the block
  registry; replaced the fixed refund page with a definition-driven runtime
  and added the app directory.
- The first regression test left the published pointer on the newer revision,
  which affected later tests; the test now restores the pointer. The initial
  typecheck also found references to a nonexistent catalog `statusField`;
  renderers now derive the status field from catalog field metadata.
- `npm test` — passed, 3 files and 30 tests.
- `npm run typecheck` and `npm run build` — passed.
- Commits `6a8d40e` and `329f8e6` were merged to local `main` by merge commit
  `17c7d04`; no remote was created.

## Phase 4 — draft builder and preview

- **Start:** 2026-11-23 04:34 UTC (immediately after the Phase 3 merge;
  exact first-edit time was not captured).
- **Verification completed:** 2026-11-23 04:43 UTC.
- Added builder-only app creation/duplication, optimistic draft saving,
  validation-error persistence, transactional publish/revision/audit updates,
  draft record/detail/audit reads, and builder app-list draft metadata.
- Added the React Grid Layout editor, inspector and validation list, dirty
  navigation protection, draft preview, directory create/duplicate controls,
  and the Playwright refund-runtime smoke test. Chromium was installed with
  Playwright.
- Corrections during implementation: the first API patch did not match the
  existing import context and was reapplied against the current file; the
  builder stylesheet patch used the wrong runtime CSS path and was corrected.
  Typecheck caught missing `x`/`y` on the grid's dropping item and a nullable
  preview user; both were fixed. The first two e2e attempts assumed `rf_001`
  was on the first page and then used an ambiguous status locator. The test
  now selects the first visible pending row and scopes the status assertion to
  the details definition.
- `npm run typecheck` — passed.
- `npm test` — passed, 4 files and 37 tests.
- `npm run build` — passed. Rollup reported existing Zod annotation warnings
  and a bundle-size advisory (>500 kB); neither prevented the build.
- `npm run test:e2e` — passed, 1 test. The reviewer logged in, approved a
  pending refund with a reason, and saw the updated status and audit entry.
- The builder currently offers registered datasets only; KYC and feature-flag
  workflows remain for Phase 5, which was not started.

## Builder canvas review correction

- **Start:** Exact first-edit time was not captured; work began after Phase 4
  verification at 2026-11-23 04:43 UTC.
- **Browser verification:** 2026-11-23 05:02 UTC.
- Reproduced the empty canvas in Chromium. `EditPage` returned its loading view
  before rendering the element with `containerRef`; `useContainerWidth`'s
  initial effect saw a null ref and returned without observing the container.
  Moved the hook and grid into `BuilderGrid`, which mounts only after the
  loaded draft is available.
- Added `tests/e2e/builder.spec.ts` for dirty navigation and beforeunload,
  palette drops of all four blocks, inspector and geometry edits, drag and
  resize, save/reload persistence, preview-disabled actions, publish and
  republish visibility, and approval in a fresh reviewer context. Playwright
  uses one worker to serialize state-mutating tests against the shared e2e DB.
- Corrections during verification: reading `DataTransfer.getData()` during
  `dragover` returned an empty value, so `onDropDragOver` now recognizes a
  per-block MIME type from `dataTransfer.types` and reads the selected block
  value on `drop`. Early test drops overlapped existing blocks and were moved
  to empty canvas positions. The resize test now hovers the handle before
  dragging it. The reviewer assertion initially lacked a configured status
  field, so the test enables Status in the details inspector. A redundant
  action-selector step was removed because the new action block already
  defaults to the dataset's approve action.
- `npm run typecheck` — passed.
- `npm run test:e2e -- tests/e2e/builder.spec.ts` — passed, 1 test.
- Chromium visual check confirmed the grid and four blocks render; manual
  block drag, numeric X/Y/Width/Height edits, and resize changed their visible
  positions and dimensions. Screenshots:
  `/home/ubuntu/screenshots/ss_2dcc45d7.png`,
  `/home/ubuntu/screenshots/ss_8625eda3.png`,
  `/home/ubuntu/screenshots/ss_2ceb8a48.png`, and
  `/home/ubuntu/screenshots/ss_c323c794.png`.

## Phase 5 — reusable KYC and staging flags apps

- **Start:** 2026-11-23 05:12 UTC.
- Registered KYC approvals and staging-only flag actions through the dataset
  registry, with required reasons, current-state transition checks, derived
  flag status, and the exact simulated notices. Added the two published
  definitions exported from the builder UI and wired them into both database
  initialization and reset.
- Added server coverage for KYC and flag transitions, reason enforcement,
  idempotent replays, cross-dataset record isolation, derived staging state,
  and the three seeded apps' registered block types. The existing builder API
  test continues to cover publishing a refund definition with a KYC action.
- Early assembly E2E attempts timed out on accessible-name and block-count
  assertions. Switched to role-based comboboxes, waited for inspector
  selection changes, configured geometry before checking the final block
  count, and used the app's initial table while palette-dropping the remaining
  blocks. The separate builder regression E2E covers dropping all four block
  types. The full E2E run then exposed missing grid children after palette
  additions despite the inspector selection; keying React Grid Layout to the
  block ID list makes its internal layout resynchronize on block-set changes.
- `npm run test:e2e -- tests/e2e/assemble-apps.spec.ts` — passed, 1 test.
- `npm run typecheck` — passed.
- `npm test` — passed, 5 files and 52 tests.
- `npm run test:e2e` — passed, 3 tests (builder regression, both app
  assemblies, and refund runtime).
- The E2E web server ran `npm run build` and `npm run db:reset`; both
  succeeded. Two subsequent `DB_PATH=./data/e2e.db npm run db:init` calls
  also succeeded, verifying idempotent initialization with all three apps.
- **Verification complete:** 2026-11-23 05:15 UTC.
- The E2E build emitted the existing non-blocking Zod annotation and
  >500 kB bundle-size warnings.

## Phase 6 — CI workflow and project guide

- **Start:** 2026-11-23 05:17 UTC.
- Added GitHub Actions checks using the Node version in `.nvmrc`, the requested
  typecheck, unit test, build, Chromium dependency installation, and Playwright
  E2E sequence. The workflow itself is authored but not run in this task.
- Replaced the bootstrap/refunds-only README with the current setup and
  demo-only credentials, directory-to-publish/review/audit/reuse walkthrough,
  architecture, extension instructions, simulated notices, and limitations.
- Corrected walkthrough copy after checking the audit renderer: the UI shows
  action, timestamp, reason, and actor; before/after snapshots are stored by
  the server but are not displayed by this renderer.
- Fresh-checkout verification: cloned branch `phase-6-verification` to
  `/tmp/fintech-tool-builder-phase6` and ran
  `npm ci && npm run db:init && npm run build && npm run check && npm run test:e2e`
  — passed. `npm run check` passed typecheck, 5 test files / 52 tests, and
  build; Playwright passed all 3 E2E tests.
- The fresh-checkout builds emitted the existing non-blocking Zod annotation
  and >500 kB bundle-size warnings. The CI workflow itself was not executed.
- **Verification complete:** 2026-11-23 05:20 UTC.

## Follow-up change — record-table status badge

- **Start:** 2026-11-23 05:22 UTC.
- Added a default-off `showStatusBadge` config and inspector checkbox. Status
  cells render plain text by default and use the existing colored status-pill
  styles when enabled; the refunds seed enables the option.
- Preserved the KYC and flags seed JSON shape without the new key so the
  legacy-config validation and runtime rendering tests exercise definitions
  that predate the option.
- An initial multi-file patch did not match the table renderer context; after
  inspecting the current file, the renderer, server default, seed, and tests
  were applied in focused patches.
- **Branch verification:** 2026-11-23 05:24 UTC. `npm run check` passed:
  typecheck, 5 Vitest files / 54 tests, and production build. Build output
  retained the existing non-blocking Zod annotation and bundle-size warnings.
- The first full Playwright run passed 3 tests and failed the new runtime test
  because a non-exact KYC heading locator matched the page and two block
  headings. Exact heading selectors fixed the test; the focused rerun
  `npm run test:e2e -- tests/e2e/reuse-runtime.spec.ts` passed (1 test). The
  final full E2E suite is scheduled on `main`.
