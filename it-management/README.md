# Nexus IT Workspace — organizations and admin signup

The existing green-and-white dashboard and responsive layouts are preserved. Nexus uses a **Node.js 24 server and SQLite** for login, isolated organizations, server-enforced role access, shared records, ticket conversations, notifications, and history. Administrators can now sign up in the browser to create their own organization. There are no npm dependencies.

## First run

Run these commands in a terminal from the workspace root:

```sh
cd it-management
node server.cjs
```

Visit **http://127.0.0.1:4173** and choose **Sign up as an admin**. Enter your organization name, your full name, a work email, and a password/passphrase of 12–128 characters with confirmation. Choose **Create organization** to create an empty organization and sign in as its first administrator. No terminal initialization is needed for browser signup, and no default password is installed.

Use the exact server host unless you configure another origin. Opening [the HTML entry point](index.html) directly shows setup guidance, not a client-only login/signup fallback. An operator may still use `node server.cjs init` for the first organization if browser registration is disabled; the terminal command refuses to overwrite an existing administrator.

### If Create organization appears unresponsive

Use the **live server page**, not a file/static preview. The current local demo is at **http://127.0.0.1:4174/#signup**; a new default server uses port 4173. File previews now show an **Open organization signup** link instead of an editable form with a disabled submit button. The link's origin comes from the `nexus-local-server` meta setting in [index.html](index.html); it is a navigation link only and never forwards passwords or changes API origins.

On the live signup page, validation displays errors beside the fields and focuses the first problem. Passwords must contain 12–128 characters and match. Submitting shows **Creating organization…**. Network/server errors keep your entries and re-enable retry. Requests time out after 15 seconds; if signup times out, try signing in first in case the account was created before the response was lost. Duplicate emails, disabled registration, and rate limits are shown as explicit errors. Existing authentication, server validation, and organization isolation remain enforced.

Node 24 or later is required for built-in SQLite. In the current Designer environment the executable is `/usr/local/bin/node`; use that full path if `node` is not on your terminal PATH. Alternatively, the [package scripts](package.json) provide `npm run init`, `npm start`, `npm test`, and `npm run test:browser`.

## Organization signup and isolation

- Signup creates a **new organization**, never access to an existing one. The server assigns an organization UUID and the founder's admin role; caller-selected organization IDs/roles are rejected.
- A new organization contains only its administrator employee profile. It has no sample people, tickets, inventory, or history. Add employees and provision their accounts using **Employees** and **Access management**.
- All roles, including administrators, are limited to their own organization. Requests derive organization context from the authenticated account, not query parameters or headers. Users, settings, tickets, materials, comments, history, notifications, search, and exports are isolated. Local record IDs may repeat in different organizations without sharing records.
- One login email can belong to one organization on this server. Email comparisons are case-insensitive. Duplicate signup is rejected without creating an orphan organization or changing the existing account. Multi-organization membership and organization switching are not implemented.
- Organization names are display labels, not verified legal identities or domain ownership claims; duplicate display names do not join or grant access to another organization. Email verification, CAPTCHA, and identity-provider onboarding are **not** implemented. Add those controls before unrestricted public deployment.
- Public signup is enabled by default for this requested workflow. Operators can set `NEXUS_ALLOW_SIGNUP=false` to hide the link and reject registration while keeping existing logins working. Signup requires same-origin JSON requests, validates all fields, and is limited to 5 attempts per socket IP per hour and 3 per email per hour. Reverse-proxy deployments share a socket IP unless gateway controls are configured.
- New founder accounts use their chosen password immediately. Employee accounts provisioned by administrators still require changing their temporary password on first login.

### Existing authenticated server upgrade

Stop the old server and restart it with this source. The first startup automatically backs up a populated v2 database to a private `before-organizations-*.sqlite` file in its data directory, then atomically migrates it to schema version 3. The existing organization is retained as `legacy`; employee IDs, records, password hashes, sessions, history, and notifications are preserved. Subsequent restarts do not duplicate or remigrate data. Do not run old server code against the migrated database, and do not run old and new processes against the same database at once. Keep the private backup for rollback (with the old code) if needed.

### Optional sample records

To initialize with the previous fictional employees, tickets, and inventory:

```sh
node server.cjs init --demo
```

This imports 24 fictional employees, 48 tickets, and 32 assets, but creates **only your chosen administrator login**. Other employees cannot log in until an administrator creates their accounts. Ticket assignments start unassigned until verified technician accounts exist. Sample equipment specifications and values are illustrative, not vendor facts.

### Preserve existing local workspace data

The old version stored records in the browser under `nexus-it-workspace-v1`. This version does **not** automatically trust, upload, overwrite, or delete that local data. If you previously downloaded a workspace JSON snapshot, initialize an empty server from it:

```sh
node server.cjs init --legacy /absolute/path/to/your-workspace-snapshot.json
```

Use this **instead of** normal initialization, browser signup, or `--demo`, before creating an administrator. The validated import preserves employee IDs, ticket IDs/content, inventory, and asset assignments. It uses an existing employee with the administrator email when possible, otherwise adds the administrator as a new employee. Ticket assignees are cleared pending account verification; previous assignee/status information is recorded as legacy provenance. In-progress requests return to Open. Authenticated history begins at import; old browser activity is not presented as verified audit evidence.

If you only have the old browser storage and no JSON snapshot, keep that browser profile and site/file URL intact. Retrieve that key's JSON using the browser's developer storage tools and save it privately before initialization. Do not put personnel-data snapshots in the public project files or source control. The import is deliberately operator-controlled, not a public upload endpoint. Migration into an already initialized server is not implemented.

## Roles and visibility

| Role | Tickets | People and accounts | Materials / inventory |
| --- | --- | --- | --- |
| **Administrator** | All tickets; assign, edit, resolve, reopen via status, archive, comment, read history | All employees; create accounts, choose roles, disable/reset accounts | Full inventory management |
| **Manager** | Their department's tickets plus their own requests; assign technicians and update department tickets; public/team comments | Read department employees; no account or role changes | Department-assigned materials plus available inventory; manage within that scope |
| **Technician** | Assigned tickets and their own requests; accept assignments, update assigned ticket status, public/team comments | Own profile and minimal names needed for visible tickets; no account administration | Read-only inventory |
| **Employee** | Own tickets only; create requests, public comments, view public history, reopen completed requests | Own profile; no employee directory, access management, or reports | **Only materials currently assigned to them. No inventory availability, other people's materials, prices, or purchasing metadata** |

All rows in this role matrix apply **within the account's organization only**. The server applies these rules to lists, individual IDs, related names, history, notifications, search data, and exports. The employee API never returns the broader inventory and relies on an explicit safe-field projection, not CSS hiding. Managers cannot assign equipment to people outside their department. Tickets can only be assigned to active administrator or technician accounts in the same organization.

Administrative employee editing remains available. Deactivate employees instead of deleting their identity/history. Setting an employee Inactive disables their login and revokes sessions; equipment remains assigned until IT confirms its return. Account disabling or changing a technician to a non-technical access role also clears their outstanding ticket assignments with history. Existing completed tickets retain assignment attribution.

## Account administration

1. Sign in as administrator.
2. Add an employee in **Employees** if needed.
3. Open **Access management → Create account**.
4. Select the employee, access role, and a strong temporary password.
5. Share the temporary password through your organization's approved secure channel, not a ticket comment.
6. The user must change it before any workspace data is accessible.

Account management supports role changes, disabling/re-enabling, and temporary-password resets. Changes revoke all sessions for the affected account. The current administrator cannot disable/demote themselves or reset their own password through the account-management endpoint. Use **Settings → Account security** for your own password. Password changes revoke all sessions and require sign-in again.

Public registration is limited to founding a new organization. Joining an existing organization still requires its administrator to provision an account; there is no role picker at login. Password recovery is administrator-mediated; email reset links are not implemented. Keep a second trusted administrator in each organization and secure database backups for operational recovery.

## Ticket collaboration

- **Assignment states:** Unassigned → Assigned → Accepted. Reassignment resets acceptance. Only the assigned technician or administrator can accept.
- **Ticket states:** Open, In progress, Waiting on employee, Resolved, Closed. Starting In progress requires an assignee. Completion sets a server timestamp; reopening clears it.
- **Conversation:** public comments are visible to the requester and authorized IT users. Team-only notes are omitted from employee API responses and notifications. All comments are attributed by the server to the signed-in user.
- **History:** creation/import, assignment/reassignment, acceptance, edits, status changes, comments, reopening, and archival are stored with server times and actor names. The database rejects history UPDATE/DELETE, and the API exposes no rewrite endpoint. This is append-only application history, not an independently certified/tamper-proof audit ledger; a database administrator still controls the database files.
- **Archiving:** administrators archive tickets instead of erasing their conversations and history. Archived detail/history remains available to administrators through its API ID. An archive-browser UI is not included yet.
- **Notifications:** affected requesters, assignees, administrators, and department managers receive in-app notifications subject to current access. Read/unread state persists per user. The bell refreshes every 20 seconds while visible; click Refresh workspace to fetch updated lists. Email, push notifications, and live streaming are not enabled.
- **Concurrent edits:** record versions reject stale saves with HTTP 409, rather than silently overwriting another user's work. Refresh and reopen an edited record after a conflict.

Existing search, category/status filters, sorting, pagination, charts, CSV exports, responsive navigation, and keyboard-accessible dialogs remain. Ticket lists also filter assignment state. CSV exports contain only the currently authorized, matching records. Employee material exports omit availability and purchase values. Public/team notes are separate from the basic ticket CSV.

Dashboard pending counts include Open, In progress, and Waiting on employee. Resolution metrics use server-stored completed tickets within the viewer's scope. Reports are available to administrators and managers only.

## Security implementation

- Passwords: random per-password salt, scrypt with N=32768/r=8/p=1, 64-byte derived keys, constant-time comparison, 12–128-character password policy. Expensive hash work is concurrency-limited.
- Sessions: cryptographically random opaque tokens; only SHA-256 token digests stored in SQLite. Cookies are HttpOnly, SameSite=Strict, and Secure when configured with an HTTPS origin. No credentials, workspace records, or auth tokens are written to localStorage.
- Lifetime: 30-minute server-side idle limit and 8-hour absolute limit. Notification/session polling does not refresh idle time. Logout, password changes/resets, and access changes revoke sessions.
- Request validation: exact configured Host, same Origin on writes, session-bound CSRF headers, JSON-only writes, bounded bodies, per-field allowlists, role and object-level checks, and prepared SQL statements.
- Login defense: generic failed-login responses; persistent per-account and socket-IP throttling. Limits are 8 account attempts and 50 IP attempts per 15 minutes. Password-change attempts are also limited. Forwarded IP headers are not trusted; behind a proxy the socket-IP limit is shared, so deploy appropriate gateway-level rate controls for your user population.
- Browser protection: no-store responses, nosniff, frame denial, restrictive self-only script CSP, no third-party requests, escaped user content, and formula-safe CSV serialization. Inline numeric styles remain allowed to preserve the existing chart design.
- Storage: a private SQLite/WAL directory with restrictive filesystem modes. The server serves only an explicit allowlist of frontend assets; database files, server source, seed data, tests, README, and screenshots cannot be downloaded through it.

## Deployment and backups

**Local testing:** default bind is `127.0.0.1`, port `4173`, HTTP. Loopback HTTP is not a substitute for TLS on a shared network.

**Shared/production deployment:** run behind a trusted HTTPS reverse proxy with the original Host preserved, set the exact public origin, keep the app port unreachable except by the proxy, and run under a dedicated low-privilege OS user. For example:

```sh
NEXUS_ORIGIN=https://it.example.com PORT=4173 node server.cjs
```

`NEXUS_HOST` changes the bind address. Non-loopback binds require an HTTPS `NEXUS_ORIGIN`; the server itself still speaks HTTP to the reverse proxy. `NEXUS_ORIGIN` must be an exact origin without a path or trailing slash. HTTPS configuration adds Secure cookies and HSTS; this workspace does not provision certificates or deploy the proxy for you.

`NEXUS_DATA_DIR` chooses the private data directory. Its default is `.private/` beside the server. Store it outside any independently served static folder. Never host the entire source folder through a generic static server. The [local ignore rules](.gitignore) exclude the default database directory, SQLite sidecars, logs, and environment files.

For a consistent filesystem backup, stop Nexus, copy the entire private directory securely, then restart. Restore only while the server is stopped. Backups contain personnel records and credential hashes; protect them with restricted access and encryption. The server does not implement encrypted storage, automated backups, MFA/SSO, security-alert delivery, compliance certification, or large-scale/multi-instance operation. Arrange deployment-specific security review, monitoring, TLS, backup/recovery testing, and an identity-provider/MFA strategy before storing sensitive organizational data.

## Implementation and tests

- [server.cjs](server.cjs): HTTP API, SQLite, authentication, organization signup/isolation, scoped authorization, events, and migration.
- [app.js](app.js): the existing UI integrated with authenticated APIs.
- [styles.css](styles.css): original design system.
- [auth.css](auth.css): matching login, access-management, and collaboration components.
- [client-data.js](client-data.js): presentation helpers only; no seeded data or persistence.
- [data.js](data.js): server-only legacy validation and optional fictional sample data.
- [security tests](tests/security.test.cjs): direct API authorization, CSRF, account/session lifecycle, history, persistence, HTTPS cookie policy, and legacy migration.
- [organization tests](tests/organizations.test.cjs): registration validation, duplicate protection, tenant isolation with overlapping IDs, closed registration, and v2 database migration.
- [browser tests](tests/browser.test.cjs): complete multi-role browser workflows in a disposable profile.
- [legacy data tests](tests/data.test.cjs): compatibility checks for the preserved legacy model/import helpers.

From the workspace root:

```sh
node --test it-management/tests/data.test.cjs it-management/tests/security.test.cjs it-management/tests/organizations.test.cjs
node it-management/tests/browser.test.cjs
```

The browser suite requires Chrome/Chromium; set `CHROME_PATH` if necessary. Tests create temporary databases and profiles, never default/private production accounts. Test credentials exist only in unserved test fixtures. Screenshots are saved under `artifacts/screenshots/` with a `v2-` prefix.

Verification: **95 data/API tests and 81 authenticated browser checks passed**, including organization signup and isolation, overlapping record IDs, duplicate-email protection, v2 database migration, employee-only material visibility, direct-ID access attacks, CSRF/origin checks, assignment/acceptance, public/internal comments, notifications, session lifecycle, cross-tab account changes, and responsive views at 320–1440 px. Signup regression tests use actual pointer clicks and typed input, and cover file/static previews, short-password feedback, pending submission, offline errors, rate-limit responses, non-JSON errors, and timeout recovery. These automated checks are not an independent penetration test or deployment security certification.
