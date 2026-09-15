# AutoNeural Backend API

Production-ready enterprise task management backend built with **Node.js 22+**, **NestJS 10/11**, **TypeScript**, **PostgreSQL**, and **Prisma ORM**.

---

## 1. Architecture Overview

- **Framework:** NestJS (Modular architecture with Dependency Injection)
- **Database:** PostgreSQL (Normalized multi-tenant schema on port 5433)
- **ORM:** Prisma Client with automated migrations and seeders
- **Authentication:** JWT Access Tokens (15 min expiry) + Database-backed hashed Refresh Tokens (7-day rotation with unique JTI)
- **Security & Authorization:**
  - Password hashing with `bcrypt` (12 salt rounds)
  - Role-Based Access Control (`ADMIN`, `EMPLOYEE`) via `@Roles()` decorator & `RolesGuard`
  - **Dual-Admin Employee Removal:** Strict multi-party authorization requiring request initiation by one admin and independent approval by a second admin before deactivation.
  - Role & Designation administration: Admins can update designations and roles for any employee.
  - Strict tenant isolation (`organizationId`)
  - Ownership / IDOR validation at the service level (Employees can only view and update tasks assigned to them)
  - Rate limiting via `@nestjs/throttler`
  - HTTP security headers via `helmet`
  - Strict input validation & sanitization via `class-validator` and `ValidationPipe`
- **Documentation:** Interactive OpenAPI / Swagger UI at `http://localhost:3001/api/docs`
- **Testing:** Jest unit test suite (28 tests passing across Auth, Tasks, and Employees)

---

## 2. Directory Layout

```
backend/
├── prisma/
│   ├── schema.prisma             # Complete normalized PostgreSQL schema
│   ├── migrations/               # SQL migration files
│   └── seed.ts                   # Database seeder (Admin + Employees + Tasks)
├── src/
│   ├── common/
│   │   ├── decorators/           # @CurrentUser(), @Roles()
│   │   ├── dto/                  # PaginationQueryDto, PaginatedResult
│   │   ├── filters/              # Global HttpExceptionFilter
│   │   ├── guards/               # JwtAuthGuard, RolesGuard
│   │   └── interceptors/         # LoggingInterceptor
│   ├── modules/
│   │   ├── prisma/               # Global PrismaService & PrismaModule
│   │   ├── auth/                 # AuthController, AuthService, JWT, Refresh Tokens
│   │   ├── users/                # UsersService
│   │   ├── employees/            # EmployeesController, EmployeesService (CRUD & Dual-Admin Workflow)
│   │   ├── tasks/                # TasksController, TasksService (Task lifecycle)
│   │   ├── activities/           # ActivitiesService (Audit logging)
│   │   ├── comments/             # CommentsController, CommentsService (Task comments)
│   │   └── notifications/        # NotificationsController, NotificationsService (In-app notifications)
│   ├── app.module.ts             # Root AppModule
│   └── main.ts                   # Application bootstrap with Swagger, Helmet, CORS
├── test/                         # Test configs & integration tests
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 3. Database Setup & Migrations

### Local PostgreSQL Instance
The backend connects to PostgreSQL via the connection string in `backend/.env`:
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/autoneural_crm?schema=public"
```

To initialize or push the Prisma schema:
```bash
cd backend
npx prisma db push
```

To run the database seed script (creates the AutoNeural organization, admin, employees, sample tasks, activities, and notifications):
```bash
npm run prisma:seed
```

---

## 4. Default Seed Accounts

All accounts are seeded with the default password: **`Password123!`**

| Role | Name | Email | Department / Designation |
|---|---|---|---|
| **Admin** | AutoNeural Admin | `info@autoneural.in` | Management / System Administrator |
| **Admin** | Shourya | `shourya@autoneural.in` | Engineering / **Technical Lead** |
| **Employee** | Manyu | `manyu@autoneural.in` | Engineering / Backend Engineer |
| **Employee** | Rajashi | `rajashi@autoneural.in` | Product Design / UI/UX Designer |
| **Employee** | Warrior Biswas | `warriorbiswas@autoneural.in` | Operations / Operations Lead |

---

## 5. Running the Backend

From the repository root:
```bash
# Start backend in development mode (with watch)
npm run backend:dev

# Build the backend bundle
npm run backend:build

# Start production server
npm run backend:start

# Run unit tests
npm run backend:test
```

Or directly from `backend/`:
```bash
cd backend
npm run start:dev
```

Once started:
- **API Base URL:** `http://localhost:3001/api/v1`
- **Swagger Documentation:** `http://localhost:3001/api/docs`

---

## 6. REST API Reference

### Authentication (`/api/v1/auth`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/auth/login` | Public | Authenticate with email & password; returns `{ accessToken, refreshToken, user }` |
| `POST` | `/auth/refresh` | Public | Exchange valid refresh token for a new token pair |
| `POST` | `/auth/logout` | Authenticated | Revoke refresh token session |
| `POST` | `/auth/change-password` | Authenticated | Change user password (requires current password) |
| `POST` | `/auth/forgot-password` | Public | Generate password reset token |
| `POST` | `/auth/reset-password` | Public | Reset password using token |
| `POST` | `/auth/register` | Public | Register a new organization and admin user |
| `GET` | `/auth/me` | Authenticated | Fetch authenticated user profile |

### Employees & Dual-Admin Removal Workflow (`/api/v1/employees`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/employees` | Admin Only | Create employee with manually entered domain email (`...@autoneural.in`), designation (`jobTitle`), department, and role |
| `GET` | `/employees` | Admin Only | List all employees (paginated, searchable, filtered by status/role) |
| `GET` | `/employees/:id` | Admin Only | Get employee details with assignment metrics and task history |
| `PATCH` | `/employees/:id` | Admin Only | Update employee details (name, email, role `ADMIN/EMPLOYEE`, department, designation `jobTitle`) |
| `POST` | `/employees/:id/removal-request` | Admin Only | Initiate employee removal request (notifies all other admins) |
| `GET` | `/employees/removal-requests/list` | Admin Only | List removal requests with filter by status (`PENDING`, `APPROVED`, `REJECTED`) |
| `POST` | `/employees/removal-requests/:requestId/approve` | Admin Only | **Approve removal (Dual-Admin Enforcement):** Cannot be approved by the requesting admin. Deactivates account and revokes active sessions. |
| `POST` | `/employees/removal-requests/:requestId/reject` | Admin Only | Reject removal request with optional note |
| `PATCH` | `/employees/:id/deactivate` | Admin Only | Direct deactivation (cannot self-deactivate) |
| `PATCH` | `/employees/:id/reactivate` | Admin Only | Reactivate account |

### Tasks (`/api/v1/tasks`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/tasks` | Admin Only | Create task with title, description, priority, due date, and assignees |
| `GET` | `/tasks` | Authenticated | List tasks. **Admins** see all tasks; **Employees** see only assigned tasks. Supports pagination, search, status, priority, and overdue filters |
| `GET` | `/tasks/:id` | Admin or Assignee | Get full task detail, assignees, comment count, and activity stats |
| `PATCH` | `/tasks/:id` | Admin Only | Update task fields (title, description, priority, dueDate, project) |
| `DELETE` | `/tasks/:id` | Admin Only | Delete task |
| `POST` | `/tasks/:id/assign` | Admin Only | Assign or reassign employee(s) to a task |
| `PATCH` | `/tasks/:id/status` | Admin or Assignee | Update status (`TODO`, `IN_PROGRESS`, `BLOCKED`, `COMPLETED`, `CANCELLED`) |
| `PATCH` | `/tasks/:id/progress` | Admin or Assignee | Update progress percentage (0 - 100). Auto-completes at 100% |

### Task Activities (`/api/v1/tasks/:taskId/activities`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/tasks/:taskId/activities` | Authenticated | Retrieve chronological audit trail of all task mutations |

### Comments (`/api/v1/tasks/:taskId/comments` & `/api/v1/comments/:id`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/tasks/:taskId/comments` | Admin or Assignee | Post a comment on a task (dispatches notification) |
| `GET` | `/tasks/:taskId/comments` | Admin or Assignee | List all comments on a task |
| `PATCH` | `/comments/:id` | Author or Admin | Edit comment |
| `DELETE` | `/comments/:id` | Author or Admin | Delete comment |

### Notifications (`/api/v1/notifications`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/notifications` | Authenticated | Get in-app notifications (supports `unreadOnly=true` filter) |
| `PATCH` | `/notifications/:id/read` | Authenticated | Mark single notification as read |
| `PATCH` | `/notifications/read-all` | Authenticated | Mark all notifications for current user as read |

---

## 7. Automated Testing

Run the test suite:
```bash
cd backend
npm test
```

Test coverage includes:
- **Auth Service Unit Tests:** Valid login, invalid credentials, inactive account rejection, password change checks, password hash verification.
- **Tasks Service Unit Tests:** Task creation, auto-completion at 100% progress, inactive employee assignment rejection, employee unauthorized access prevention, activity logging & notifications.
- **Employees Service Unit Tests:**
  - Employee creation with manually entered domain email and designation.
  - Admin role and designation updates, preventing demotion of the last active administrator.
  - Dual-admin removal workflow:
    - Initiating removal request (`PENDING`) and notifying co-admins.
    - Blocking self-approval by the requesting admin (`403 Forbidden`).
    - Multi-party approval by a second admin (`APPROVED`), account deactivation, and session revocation.
    - Rejection of removal requests.
