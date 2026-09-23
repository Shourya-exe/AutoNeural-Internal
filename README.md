# AutoNeural Team CRM & API

A private unified workspace. `info@autoneural.in` (AutoNeural Admin) and `shourya@autoneural.in` (Shourya Kumar, Technical Lead) are administrators with full system management privileges.

## Run locally

Requires Node.js 22.13+ and installed dependencies.

```sh
# Start both Next.js Frontend (port 3000) and NestJS Backend (port 3001) concurrently:
npm run dev

# Or run frontend / backend separately if needed:
npm run dev:frontend
npm run dev:backend
```

Open http://localhost:3000. All employee login and logout events are recorded in SQLite audit logs. Admins can monitor live access events, search records, and export CSV in the **Access Logs** tab. Initial passwords are in `output/CRM-INITIAL-LOGINS.txt`.

## What works

- Admin creates tasks with title, description, employee, due date, priority, and optional project/client label.
- Admin edits task details and reassigns tasks. Employees can only access and update the status of their own assignments.
- Statuses: To do, In progress, In review, Completed. Both admin and assigned employee can mark work complete or reopen it. Completion time and changes are recorded.
- List and board views; search, status, employee and overdue filters; completion statistics; team workload; recent activity.
- Task comments shared between admin and assigned employee. A reassigned task retains its history for the new assignee; the former assignee loses access.
- Admin generates temporary employee passwords and revokes existing sessions. Users can change their own passwords.
- SQLite persistence, password hashing, expiring revocable sessions, login throttling, same-origin mutations, size-limited requests, and optimistic concurrency checks.
- Responsive mobile navigation and keyboard-accessible native modal dialogs.

The workspace begins empty. No fictional client work is inserted into the real database. Browser verification uses a separate temporary database; `output/crm-preview` screenshots contain test examples only. There is no email sending, mailbox integration, attachment storage, or automatic notification service. Employees see updates in their workspace, which refreshes every 30 seconds while visible.

## Data and deployment

The active database is `data/autoneural-crm.sqlite`. Override with `CRM_DATABASE_PATH`. This is deliberately separate from the old Business OS databases. The archived source, workflows, voice agent, configuration, and prior build are preserved in `archives/business-os-20260914`; old databases remain in `data/`.

For a public server, set `CRM_APP_URL` to its exact HTTPS origin (e.g. `https://crm.example.com`) and `CRM_DATABASE_PATH` to an absolute persistent path, then run `npm run build` and `npm start`. Set the same environment variables when running setup. HTTPS makes session cookies Secure. Use one server with durable local storage; ephemeral/serverless hosting is unsupported. Database backups should use SQLite's backup mechanism or be taken while the application is stopped, including WAL state where appropriate.

The old `.env.local` and `.env.production` were preserved and use unrelated settings. The new app reads only the `CRM_` environment variables above. No old WhatsApp/voice automation is invoked. Do not reuse old deployment scripts blindly; they are archived. This rebuild has not been deployed over the prior live website.

## Verify

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium  # first browser test only
npm run test:e2e
```

The browser test starts an isolated production server on port 3219 and removes its temporary database afterward. Tests cover admin/employee boundaries, account setup, password changes, sessions and logout, login throttling, CSRF rejection, create/assign/comment/complete flow, persisted updates, cross-employee access denial, board/team navigation, and mobile overflow.
