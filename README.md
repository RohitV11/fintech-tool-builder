# Fintech Tool Builder

A local-only prototype of an internal-tool builder. This bootstrap provides
session-based demo authentication, SQLite persistence, and synthetic refund,
KYC, and feature-flag records. Published workflows and the visual builder are
added in later phases.

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
isolation. It has no published tools or visual builder yet.
