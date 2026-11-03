# Company Transport Management System

Super Administrator setup, email verification, authentication, and administration dashboard for React/Vite, Express, and MongoDB.

## Workspace scope

The supplied `Backend` and `Frontend` directories were empty. This implementation creates the requested foundation; there was no existing employee request, manager approval, operator booking, registration, or Google Maps code to integrate or regression-test. The dashboard counts employees and managers from the real User collection and departments from the Department collection. Transport request, pending approval, and completed booking totals are now backed by the TransportRequest collection. Unconnected statistics are `null` and displayed as “Not connected yet” until their models exist. Department Management supports creating, editing, and deleting departments with unique names and optional descriptions. Department totals are counted from MongoDB. Other sidebar destinations currently display module empty states.

## Local development on Windows

Prerequisites: Node.js 24 LTS, npm, a MongoDB replica set (or Atlas), and an SMTP account with TLS. MongoDB transactions require a replica set or sharded cluster; standalone MongoDB is intentionally rejected on startup.

1. Configure MongoDB as a replica set. For a **new local development database**, start `mongod --dbpath C:\ctms-data --replSet rs0 --bind_ip 127.0.0.1` after creating the data directory. In `mongosh`, run `rs.initiate()` once. Use your existing deployment procedure for a production replica set.
2. In `Backend`, run `npm ci`, then copy `.env.example` to `.env`.
3. Populate the environment variables below. Generate a JWT secret using `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` and store it in `.env`.
4. In `Backend`, run `npm run dev`.
5. In a second terminal, in `Frontend`, run `npm ci` and `npm run dev`.
6. Open **http://localhost:5173**. The app checks `/api/setup/status` and opens `/super-admin/setup` when setup is required.

In development, `localhost`, `127.0.0.1`, and `::1` are accepted as equivalent loopback hosts for `APP_ORIGIN`, with the same scheme and port. Vite uses port 5173 and stops if that port is occupied. If you change the frontend port, update both Vite's port and `APP_ORIGIN`, then restart both servers. Production requires an exact origin match.

Do not commit `.env` or place credentials in frontend configuration. `.gitignore` excludes credentials, dependencies, test database downloads, and build output.

## SMTP and environment configuration

Configure `Backend/.env`:

| Variable                 | Value                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`            | Replica-set MongoDB connection string, e.g. `mongodb://127.0.0.1:27017/ctms?replicaSet=rs0`         |
| `JWT_SECRET`             | Random secret of at least 32 characters                                                             |
| `JWT_EXPIRES_IN`         | `8h` by default; a number followed by `s`, `m`, `h`, or `d`                                         |
| `SMTP_HOST`              | Your SMTP provider or internal relay hostname                                                       |
| `SMTP_PORT`              | `587` for STARTTLS, or `465` for implicit TLS                                                       |
| `SMTP_SECURE`            | `false` for port 587; `true` for port 465                                                           |
| `SMTP_USER`, `SMTP_PASS` | SMTP account credentials; both may be omitted for a trusted relay that permits unauthenticated SMTP |
| `SMTP_FROM_NAME`         | `Company Transport Management System`                                                               |
| `SMTP_FROM_EMAIL`        | Sender address authorized by your mail server                                                       |
| `OTP_EXPIRES_MINUTES`    | `5`; accepted range 1–5                                                                             |
| `OTP_RESEND_SECONDS`     | `60`; minimum 60                                                                                    |
| `APP_ORIGIN`             | Exact browser origin, e.g. `http://localhost:5173`; use your HTTPS origin in production             |
| `NODE_ENV`               | `development` locally, `production` for deployment                                                  |
| `PORT`                   | Backend port, default `5000`                                                                        |

The SMTP connection is checked at startup. Port 587 requires STARTTLS; certificate verification remains enabled. Configure an organization CA through Node's normal trust mechanism (`NODE_EXTRA_CA_CERTS`) if your internal relay uses a private CA. A send failure returns a generic error without exposing SMTP details or creating an account.

## First Super Admin setup

1. Enter full name, a unique username (3–40 letters, digits, dots, underscores, or hyphens), email, password, and confirmation. Passwords must contain at least 12 characters and at most 72 UTF-8 bytes to avoid bcrypt truncation.
2. Submit to receive the six-digit email code. No User record exists yet. Only a bcrypt password hash and HMAC-protected OTP are stored in the temporary setup record.
3. Enter the code within five minutes. A resend is available after 60 seconds, invalidates the previous code, and preserves the failed-attempt count. Five incorrect attempts lock that challenge. Expired challenges are removed by MongoDB TTL cleanup; if an expired or locked record still reserves the account details, wait for cleanup (normally within about a minute after expiry), then restart setup.
4. Verification creates the active, verified `SUPER_ADMIN`, closes setup permanently, deletes pending challenges, issues an HTTP-only JWT cookie, and opens `/super-admin/dashboard`.
5. Sign out and return through `/super-admin/login`, using either username or email.

The browser stores only pending challenge metadata in `sessionStorage`, which is cleared after successful verification. Authentication tokens are never returned in JSON or placed in browser storage.

**Initial setup cannot be repeated through the application after success, even if the account is later deleted.** A permanent `SetupState` marker is committed in the same transaction as account creation. A partial unique index independently permits only one `SUPER_ADMIN` User. Concurrent verification attempts cannot create multiple accounts. Preserve the setup-state collection in database backups; deleting database records manually is outside application guarantees. There is no public registration API and no public role assignment.

## API

| Method | Path                               | Body / result                                                                                          |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| GET    | `/api/setup/status`                | `{ setupRequired }`                                                                                    |
| POST   | `/api/setup/super-admin`           | `{ fullName, username, email, password, confirmPassword }`; returns `{ setupId, expiresAt, resendAt }` |
| POST   | `/api/setup/verify-otp`            | `{ setupId, otp }`; creates account, sets cookie, returns safe user details                            |
| POST   | `/api/setup/resend-otp`            | `{ setupId }`; returns updated expiry and cooldown                                                     |
| POST   | `/api/super-admin/auth/login`      | `{ identifier, password }`; sets cookie, returns safe user details                                     |
| GET    | `/api/super-admin/auth/me`         | Authenticated Super Admin details                                                                      |
| POST   | `/api/super-admin/auth/logout`     | Clears session cookie                                                                                  |
| GET    | `/api/super-admin/dashboard/stats` | Protected real employee/manager counts and unavailable-module `null` values                            |

All Super Admin APIs other than login require a valid signed JWT and a current active, email-verified `SUPER_ADMIN` database record. A token for EMPLOYEE, MANAGER, OPERATOR, or ADMIN is rejected. Login errors do not distinguish nonexistent accounts, wrong passwords, or inactive accounts. AuditLog records setup requests, resends, rejected codes, account creation, login results, and logout, without passwords, codes, or tokens.

Limits: ten initial/resend requests per IP per 15 minutes (shared), 30 verification requests per IP per 15 minutes, ten login requests per IP per 15 minutes, plus a general 300 API requests per IP per 15 minutes. Five wrong OTP attempts are enforced transactionally in MongoDB per challenge. HTTP rate limit stores are process-local: deploy one API process, or add a shared store before horizontal scaling. With the default untrusted-proxy configuration, a reverse proxy's clients share the proxy's limit. Configure narrowly scoped trusted proxies and a shared rate-limit store when deploying behind a load balancer; never trust arbitrary forwarded IP headers.

## Verification

From `Backend`:

```powershell
$env:MONGOMS_DOWNLOAD_DIR = 'C:\dev\pickmeReq\.mongodb-binaries'
npm test
npx playwright install chromium
npm run test:e2e
```

From `Frontend`:

```powershell
npm run build
```

Integration tests use an isolated temporary MongoDB 8.0 replica set. The first run downloads the MongoDB binary; no configured deployment database is touched. Tests cover complete setup/login/logout, concurrent creation, concurrent guesses, expiry without TTL, cooldown, resend failure, five-attempt lockout, role restrictions, inactive accounts, unique indexes, validation, secret-safe responses, origin checks, rate limits, and permanent closure after account deletion.

The browser test runs the real React app and API with an isolated database and an in-process mail capture. It covers desktop/mobile layout, password visibility, OTP verification, automatic login, logout, email login, protected routes, and setup redirection after completion. Screenshots are written to `Backend/artifacts/`. No OTP is exposed by a test-only HTTP endpoint. Mail delivery to a real mailbox requires your SMTP credentials and must be checked in your environment.

## Internal Windows Server deployment

Build `Frontend` and serve its `dist` directory through IIS or your existing HTTPS web server. Configure SPA fallback to `index.html` for frontend routes, and proxy `/api/*` to the Express process without rewriting the `/api` prefix. Serve the UI and API from the same origin. Set `APP_ORIGIN` to that exact HTTPS origin and `NODE_ENV=production`; production cookies use `Secure`, `HttpOnly`, and `SameSite=Strict`. Do not use Vite's development server as the production web server. Run `npm start` in `Backend` under your existing Windows service manager. Keep the API port restricted to the reverse proxy, restrict MongoDB access, and retain the setup marker and audit collection with normal database backups.

## Created and modified files

There were no existing source files. The implementation adds:

- `.gitignore`, `README.md`
- `Backend/package.json`, `Backend/package-lock.json`, `Backend/.env.example`
- `Backend/src/config.js`, `Backend/src/models.js`, `Backend/src/mail.js`, `Backend/src/app.js`, `Backend/src/server.js`
- `Backend/test/setup.test.js`, `Backend/e2e/workflow.test.js`
- `Frontend/package.json`, `Frontend/package-lock.json`, `Frontend/index.html`, `Frontend/vite.config.js`
- `Frontend/src/api.js`, `Frontend/src/main.jsx`, `Frontend/src/styles.css`

Build output, installed dependencies, downloaded test binaries, and browser screenshots are generated artifacts.
#   p i c k m e s y s t e m  
 #   p i c k m e s y s t e m  
 #   p i c k m e s y s t e m  
 
## Department Management

Open Department Management from the dashboard navigation. Enter a name (2?100 characters) and an optional description (up to 500 characters). Names are unique regardless of case or repeated spaces. Edit updates an existing department; Delete requires confirmation. Data persists in MongoDB and changes update the dashboard count.

All department APIs require the verified, active Super Admin session:

| Method | Endpoint | Action |
| --- | --- | --- |
| GET | /api/super-admin/departments | List departments |
| POST | /api/super-admin/departments | Create with name and optional description |
| PUT | /api/super-admin/departments/:id | Update name and description |
| DELETE | /api/super-admin/departments/:id | Delete department |

Users can be assigned to departments through User Management. Departments with assigned users cannot be deleted until those users are reassigned or unassigned.

## User Management

Super Administrators can create, edit, and delete Admin, Employee, Manager, and Operator accounts through User Management. Each managed user has a name, unique username, contact number, role, active/inactive status, and optional department. Email is not required by User Management. Search supports names, contact numbers, roles, and departments. The Super Administrator account is excluded and cannot be changed or deleted through these APIs.

User Management passwords require at least 6 characters and at most 72 UTF-8 bytes. Initial Super Administrator setup requires at least 12 characters. Passwords are hashed using bcrypt and never returned. An empty password field while editing preserves the current password. Created accounts are not marked email verified. Staff sign-in is available at /login for the SOP transport workflow. Business authority comes from the administrator-configured transport profile.

| Method | Endpoint | Action |
| --- | --- | --- |
| GET | /api/super-admin/users | List users with department names |
| POST | /api/super-admin/users | Create user |
| PUT | /api/super-admin/users/:id | Update user and department assignment |
| DELETE | /api/super-admin/users/:id | Delete user |

Create accepts fullName, username, contact, password, role, status, and departmentId (an existing department ID or null). Update accepts the same fields with password optional. All routes require an active, email-verified Super Administrator session. Department assignments and deletion use transactions to prevent dangling references.

## Custom roles

User Management has separate Users and Roles sections. In Roles, enter a unique role name and optional description. Created roles immediately appear in the user creation/editing Role selector and are stored in MongoDB. Existing built-in role values remain unchanged. Custom roles can be assigned to new or existing users and searched by display name.

GET /api/super-admin/roles lists built-in and custom roles. POST /api/super-admin/roles accepts name (2-100 characters) and optional description (up to 500 characters). Both require the verified Super Administrator session. Duplicate names and built-in/reserved names are rejected. Custom role values use CUSTOM_ followed by the role document ID; user writes reject nonexistent roles.

Custom roles identify responsibilities; they do not grant Super Administrator privileges. Transport actions depend on the configured designation and location. This section supports creating and listing roles.

User Management requires a contact number with 7 to 15 digits; an optional leading + and spaces, parentheses, dots, and hyphens are accepted. Existing user emails are retained. Initial Super Administrator setup and email verification still require an email address. On startup the old unique email index is replaced with a partial unique index, allowing multiple managed users without email while retaining uniqueness for existing email values.

## SOP transport workflow

Based on the four-page PickMe SOP Simplified document supplied by the user (labelled For management approval). See docs/pickme-sop-mapping.md for the source requirements and integration boundaries.

1. Super Admin: create staff in User Management with basic details, contact and department. Then choose Edit on the user to configure designation, location type, work location and employee category under Transport profile (SOP). The SOP section is only shown while editing. Use the actual Annexure A titles; a custom role name alone does not grant workflow access.
2. Staff: open /login and use the assigned username/password. Read and acknowledge the SOP. HR must still explain it to recruits and retain the acknowledgement in their personal file; the stored acknowledgement date supplements that process.
3. Authorized requester: create their own Ride/Flash request, enter Annexure C details, prepare/copy the WhatsApp text and manually share it before confirming submission. The server records the attestation time. The pickup must be at least 30 minutes away.
4. Assigned authorized approver: inspect need, justification and vehicle eligibility, share approval in WhatsApp and confirm approval in the system at least 30 minutes before pickup. Requests may be rejected or returned with a reason.
5. Administrative Assistant: check completeness and approval, book in PickMe manually, then record the real booking reference and optional driver/tracking details. No external booking is made by this application.
6. Requester: coordinate with the driver and report delays/issues; verify pickup, route, destination and completion message before marking complete. Changes and cancellations to a booked trip require the Administrative Assistant to resolve the external booking. Changed trips must be corrected and reapproved before rebooking.

Super Admin can monitor Transport Requests, Approval Management and Booking Management. Workflow actions require the responsible staff account. Dashboards show real transport counts. Each request retains requester/approver snapshots, a dated actor/action history and prior booking references in the history. Concurrent/stale actions are rejected using a version counter.

Staff authentication uses a separate HttpOnly cookie limited to /api/transport, with role/status checked against the current database record. Existing Super Admin authentication is preserved. Staff permissions follow Annexure A, not the editable role display name. Showroom requesting is not enabled because Annexure A does not list authorized showroom requesters.

Main endpoints: POST /api/transport/auth/login, POST /api/transport/auth/logout, GET /api/transport/me, POST /api/transport/acknowledge, GET /api/transport/approvers, GET/POST /api/transport/requests, PUT /api/transport/requests/:id, POST /api/transport/requests/:id/action, GET /api/transport/requests/:id/message. Super Admin monitoring uses /api/super-admin/transport. All write routes retain the origin checks and API rate limits.

WhatsApp delivery, actual PickMe reservations, driver GPS tracking and external cancellation/amendment are manual operations; no service integration credentials were provided. Reports and general Audit Logs sidebar modules are still separate future modules; transport history is available on each request.

User Management now uses a full-width directory table with one row per user, search, role/department/status filters, and ten-row pagination. Add user opens the creation dialog; row actions open editing or deletion confirmation. SOP transport profile fields remain edit-only. On small screens, the table scrolls horizontally within its own region.
