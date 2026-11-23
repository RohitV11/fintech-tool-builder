# Fintech Tool Builder

A local-only prototype of an internal-tool builder. The bootstrap includes
session-based demo authentication, and the first vertical slice is a published
refund-review app backed by SQLite. The visual builder and reusable runtime
editor are planned for later phases.

## Requirements and setup

Use Node.js 22 (`.nvmrc` pins the major version):

```sh
nvm install
npm run setup
npm run dev
```

The development UI is at <http://127.0.0.1:5173>. To run the local production
server instead:

```sh
npm run build
npm start
```

The server listens on `127.0.0.1:3000` by default. `npm run db:init` creates the
schema and fills missing synthetic demo rows without deleting data. `npm run
db:reset` explicitly deletes and recreates the selected demo database. Startup
never initializes or resets the database automatically.

## Demo accounts

| Username | Role | Password |
|---|---|---|
| `builder` | Builder | `demo-password` |
| `reviewer` | Reviewer | `demo-password` |
| `viewer` | Viewer | `demo-password` |

These fixed credentials are for local demonstration only and must not be used
for real accounts or exposed on a network.

## Refund review slice

Sign in as `reviewer` to search, filter, and paginate synthetic refund requests.
Selecting a row loads its details and audit history. Reviewer decisions require
a reason and are guarded by optimistic versions and idempotency keys. Approval
records a decision only; no refund is executed. The builder and viewer accounts
can read the published app but cannot submit a decision.

The database also contains synthetic KYC and staging-flag records for later
phases; the current published workflow is refunds only.

## Verification

```sh
npm run typecheck
npm test
npm run build
```

`npm run test:e2e` runs the Playwright suite when browser dependencies are
installed. `npm run check` runs type checking, unit/API tests, and the
production build.

## Limitations

The database contains synthetic data only. This prototype has one synthetic
organization and does not implement SSO, record assignment, or multi-tenant
isolation. It has no visual builder yet. Audit events are persistent and
protected by application permissions, but are not tamper-proof against
database administrators.
