# Nexus IT Management

A responsive IT department workspace with isolated organizations, administrator signup, secure cookie sessions, and server-enforced role-based access.

## Features

- Dashboard, employee management, tickets, and asset inventory
- Admin, manager, technician, and employee roles
- Employees see only their own tickets and assigned materials
- Assignment acceptance, public/team comments, notifications, and ticket history
- Search, filters, CSV exports, and responsive desktop/mobile layouts

## Run locally

Requires Node.js 24 or newer. No npm packages are required.

```sh
cd it-management
node server.cjs
```

Visit http://127.0.0.1:4173 and select **Sign up as an admin**. Use the live server, not a static HTML preview. Signup creates a new organization with no default password or sample records.

See the [setup and security guide](it-management/README.md) for roles, optional sample data, tests, database migration, and deployment requirements.

## Tests

```sh
cd it-management
npm test
npm run test:browser
```

Browser tests require Chrome/Chromium. Test fixtures use fictional credentials and isolated temporary databases.

## Security and deployment

HTTPS and a deployment-specific security review are required before using sensitive data. Email/domain verification, MFA, and SSO are not implemented. Never publish private databases, environment files, logs, or real credentials. This repository contains application source and tests only.
