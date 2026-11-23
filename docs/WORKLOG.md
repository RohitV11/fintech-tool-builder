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
