<p align="center">
  <img src="public/brand/movement-hub-logo.jpg" alt="Movement Hub – Physiotherapy & Rehab" width="220" />
</p>

<h1 align="center">Movement Hub – Physiotherapy & Rehab</h1>

<p align="center">
  <strong>Physiotherapy Hospital Management System</strong><br/>
  Full-stack web platform · REST APIs · PostgreSQL · Patient mobile app
</p>

---

A modern, scalable and modular Physiotherapy Hospital Management Platform that manages patient consultations, therapist scheduling, treatment plans, therapy sessions, packages, billing, home visits and patient progress.

Movement Hub is built as a **complete production application**: the web portal, backend REST APIs, PostgreSQL database, authentication, role-based access, payments and notifications are all part of a single build.

---

## 1. Project Overview

Movement Hub is a physiotherapist-led hospital management platform.

The application supports two primary patient journeys:

**New Patient Workflow**

1. Patient registration.
2. Initial consultation booking.
3. Physiotherapist consultation.
4. Clinical assessment.
5. Treatment plan creation.
6. Package selection and payment.
7. Therapy session booking.
8. Treatment progress tracking.

**Existing Patient Workflow**

1. Patient login (OTP).
2. View active treatment plan.
3. Select prescribed treatment.
4. View available physiotherapist slots.
5. Book a therapy session.
6. Attend the treatment session.
7. View updated progress.

**Important:** The system has no separate doctor module. Physiotherapists handle initial consultations, clinical assessments, treatment plans and therapy sessions.

---

## 2. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Web | Next.js + React + TypeScript | Hospital web portal |
| UI | Tailwind CSS, shadcn/ui, Lucide React | Styling, components, icons |
| Client state | Zustand | UI state, filters, selections |
| Server state | TanStack Query | API data, caching, mutations |
| Forms | React Hook Form + Zod | Form state and validation |
| Mobile | React Native + Expo | Patient mobile application |
| API | Next.js API route (Node.js runtime) + TypeScript | REST API built into the web app, no separate server |
| Validation | Zod | Request/response validation |
| Database | PostgreSQL | Relational data store |
| ORM | Prisma | Schema, migrations, data access |
| Auth | JWT (access + refresh), bcrypt, OTP | Staff and patient authentication |
| Jobs | Vercel Cron → `/api/v1/cron/:job` (in-process timers when self-hosted) | Reminders, notifications, slot generation, package expiry |
| Payments | Razorpay | Online payments and webhooks |
| Messaging | WhatsApp Business API | Appointment and payment notifications |
| Storage | S3-compatible storage | Medical documents and reports |

---

## 3. User Roles and Permissions

| Role | Access |
|---|---|
| Super Admin | Complete system management, branches, settings, users |
| Admin | Hospital operations, therapists, packages, reports |
| Receptionist | Patient registration, appointment booking, check-in |
| Physiotherapist | Consultations, assessments, treatment plans, therapy sessions |
| Accountant | Invoices, payments, refunds, financial reports |
| Patient | Own appointments, packages, payments and progress |

Every API route is protected by authentication and a role/permission check. Patients can only access their own records.

---

## 4. Application Modules

### 4.1 Dashboard
Total patients, today's appointments, available physiotherapists, completed sessions, pending appointments, daily and monthly revenue, upcoming appointments, therapist utilization.

### 4.2 Patient Management
Registration, profile, personal information, addresses, medical history, consultations, treatment history, package history, payment history, documents.

### 4.3 Therapist Management
Add/update physiotherapists, qualifications, experience, specializations, working days, shift and break timings, leave management, availability.

### 4.4 Appointment Management
Initial consultation, follow-up consultation, therapy session and home visit booking; cancellation, rescheduling and full status history.

### 4.5 Therapist Scheduling
- Independent calendar per physiotherapist.
- Default slot: 30 minutes, one patient per therapist per slot.
- Weekly schedule templates, breaks and leave.
- Automatic slot generation (background job).
- Daily, weekly and monthly calendar views.
- Recurring appointments and waitlist.
- Conflict prevention through database constraints and transactional booking.

### 4.6 Consultation and Clinical Assessment
Symptoms, chief complaints, medical history, clinical examination, pain score (0–10), mobility assessment, observations, clinical impression, recommendations.

### 4.7 Treatment Plans
Plan creation, treatment categories, prescribed sessions, frequency, session duration, instructions, activation and completion.

### 4.8 Treatment Packages
Basic, Standard, Premium and Custom packages; session count, validity, remaining sessions, purchase history and a transactional session ledger.

### 4.9 Therapy Sessions
Today's sessions, assigned therapist, status, exercises, pain assessment, notes, progress tracking and completion (automatically deducts a package session).

### 4.10 Billing and Payments
Consultation, therapy, package and home-visit billing; discounts, GST, invoices, receipts, Razorpay payments, refunds and payment history.

### 4.11 Home Physiotherapy
Patient address and location, therapist assignment, scheduling, travel charges, check-in/check-out and completion.

### 4.12 Notifications
Confirmations, reminders, rescheduling, cancellations, payment confirmations, package expiry and follow-up reminders through WhatsApp, SMS and push.

### 4.13 Reports
Revenue, appointments, therapist utilization, package sales, patient progress and outstanding payments.

---

## 5. System Architecture

Modular monolith in a monorepo. The web portal and mobile app share one REST API and one set of TypeScript contracts.

```text
movement-hub/
│
├── apps/
│   ├── web/                      # Next.js hospital portal
│   │   ├── app/
│   │   │   ├── (auth)/login/
│   │   │   ├── dashboard/
│   │   │   ├── patients/
│   │   │   ├── therapists/
│   │   │   ├── appointments/
│   │   │   ├── schedule/
│   │   │   ├── consultations/
│   │   │   ├── treatment-plans/
│   │   │   ├── packages/
│   │   │   ├── therapy-sessions/
│   │   │   ├── home-visits/
│   │   │   ├── billing/
│   │   │   ├── reports/
│   │   │   └── settings/
│   │   └── src/
│   │       ├── features/
│   │       ├── components/
│   │       ├── hooks/
│   │       └── stores/
│   │
│   │   └── src/
│   │       ├── pages/api/v1/[[...all]].ts   # single entry point for the whole REST API
│   │       ├── instrumentation.ts           # starts job timers on a long-running server
│   │       └── server/                      # backend, built into the Next.js app
│   │           ├── app.ts                   # /api/v1 route tree
│   │           ├── router.ts                # lightweight router, CORS, security headers, rate limit
│   │           ├── modules/                 # auth, users, patients, therapists, scheduling,
│   │           │                            # appointments, consultations, treatment-plans, packages,
│   │           │                            # therapy-sessions, home-visits, billing, payments,
│   │           │                            # notifications, documents, reports, settings
│   │           ├── middleware/              # auth + roles, validation, error handler
│   │           ├── jobs/                    # slots, reminders, package expiry
│   │           ├── lib/
│   │           └── config/
│   │
│   └── mobile/                   # React Native + Expo staff app (same /api/v1)
│       └── src/
│
├── packages/
│   │   │   ├── therapy-sessions/
│   │   │   ├── home-visits/
│   │   │   ├── billing/
│   │   │   ├── reports/
│   │   │   └── settings/
│   │   └── src/
│   │       ├── features/
│   │       ├── components/
│   │       ├── hooks/
│   │       └── stores/
│   │
│   ├── mobile/                   # React Native + Expo patient app
│   │   ├── app/
│   │   └── src/
│   │
│   └── api/                      # Node.js REST API
│       └── src/
│           ├── modules/
│           │   ├── auth/
│           │   ├── users/
│           │   ├── patients/
│           │   ├── therapists/
│           │   ├── scheduling/
│           │   ├── appointments/
│           │   ├── consultations/
│           │   ├── treatment-plans/
│           │   ├── packages/
│           │   ├── therapy-sessions/
│           │   ├── home-visits/
│           │   ├── billing/
│           │   ├── payments/
│           │   ├── notifications/
│           │   ├── documents/
│           │   ├── reports/
│           │   └── settings/
│           │       # each module: routes · controller · service · repository · schema (zod)
│           ├── middleware/       # auth, rbac, validation, error handler, rate limit
│           ├── jobs/             # BullMQ workers (slots, reminders, expiry)
│           ├── config/
│           └── infrastructure/   # prisma client, redis, s3, razorpay, whatsapp
│
├── packages/
│   ├── database/                 # prisma/schema.prisma, migrations, seed
│   ├── types/                    # shared TypeScript models
│   ├── validation/               # shared Zod schemas
│   ├── api-client/               # typed client used by web and mobile
│   └── ui/                       # shared web UI components
│
├── public/brand/movement-hub-logo.jpg
├── docs/
├── docker-compose.yml            # postgres + redis for local development
└── package.json
```

**Principles:** business logic lives in API services, never in pages or UI components; controllers stay thin; every write that touches slots, packages or money runs inside a database transaction.

---

## 6. Database

PostgreSQL with Prisma ORM.

| Module | Tables |
|---|---|
| Authentication | User, RefreshToken, OtpCode |
| Hospital | Branch, HospitalSetting |
| Patients | Patient, PatientAddress, MedicalHistory, PatientDocument |
| Therapists | Therapist, Specialization, TherapistSpecialization |
| Scheduling | TherapistSchedule, TherapistLeave, TherapistSlot |
| Appointments | Appointment, AppointmentHistory, Waitlist |
| Consultations | Consultation, ClinicalAssessment |
| Treatment Plans | TreatmentPlan, TreatmentPlanItem |
| Packages | TreatmentPackage, PatientPackage, PackageTransaction |
| Therapy | TherapySession, SessionExercise |
| Home Visits | HomeVisit |
| Billing | Invoice, InvoiceItem, Payment, Refund |
| Notifications | Notification, NotificationPreference |
| Security | AuditLog |

Full Prisma schema, relationships and constraints: **[docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md)**

---

## 7. REST API

Base URL: `/api/v1`. JSON request/response, JWT bearer authentication, Zod validation and a consistent response envelope.

| Module | Base Endpoint |
|---|---|
| Authentication | `/auth` |
| Users | `/users` |
| Patients | `/patients` |
| Therapists | `/therapists` |
| Scheduling | `/therapists/:id/schedule`, `/availability` |
| Appointments | `/appointments` |
| Consultations | `/consultations` |
| Treatment Plans | `/treatment-plans` |
| Packages | `/packages`, `/patient-packages` |
| Therapy Sessions | `/therapy-sessions` |
| Home Visits | `/home-visits` |
| Invoices | `/invoices` |
| Payments | `/payments` |
| Notifications | `/notifications` |
| Documents | `/documents` |
| Reports | `/reports` |
| Settings | `/settings` |

Every endpoint with method, roles, request and response: **[docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md)**

---

## 8. Key Business Rules

1. A therapist slot can hold only one active appointment (unique constraint + transaction).
2. Appointments cannot be booked on therapist leave, break time or outside shift hours.
3. Completing a therapy session linked to a package deducts one session through a `PackageTransaction`.
4. A package cannot be used after its expiry date or once remaining sessions reach zero.
5. Cancelling an appointment releases its slot; cancelling a completed session is not allowed.
6. Invoices are immutable once issued; corrections are made through refunds or credit notes.
7. Clinical and financial records are never hard-deleted (soft delete + audit log).
8. Razorpay payments are confirmed only after webhook signature verification.

---

## 9. Security and Compliance

- Role-based access control on every route.
- bcrypt password hashing; short-lived access tokens with rotating refresh tokens.
- OTP login for patients with rate limiting.
- Patients can only read their own data.
- Medical documents stored in private S3 buckets, served through signed URLs.
- Audit log for every create/update/delete on clinical and financial records.
- HTTPS everywhere, helmet, CORS allow-list, request rate limits.
- Daily database backups.
- Patient consent capture.
- Compliance with applicable Indian data protection (DPDP Act) and healthcare requirements.

---

## 10. Installation and Setup

### Requirements

- Node.js 20+
- npm
- PostgreSQL 14+ (local install, or `docker compose up -d`)
- Git

### Steps

```bash
git clone <repository-url>
cd movement-hub

npm install

# environment files (edit DATABASE_URL and secrets as needed)
cp packages/database/.env.example packages/database/.env
cp apps/web/.env.example apps/web/.env.local

# optional: PostgreSQL + Redis via Docker
docker compose up -d

# create database tables and load synthetic sample data
npm run db:migrate
npm run db:seed

# run the app: web portal + API on one server (port 3000)
npm run dev
```

- Web portal: `http://localhost:3000`
- API: `http://localhost:3000/api/v1` (health check: `/api/v1/health`)

### Sample logins (seed data)

All staff accounts use the password `Movement@123`. Change them before going live.

| Role | Login |
|---|---|
| Super Admin | `superadmin@movementhub.example` |
| Admin | `admin@movementhub.example` |
| Receptionist | `reception@movementhub.example` |
| Accountant | `accounts@movementhub.example` |
| Physiotherapists | `therapist1@movementhub.example` … `therapist4@movementhub.example` |
| Patient | "Patient" tab → mobile number → OTP (shown on screen in development) |

Therapist slots for the next 30 days are generated automatically when the server starts and topped up every hour. On Vercel, the same jobs run through Vercel Cron (`apps/web/vercel.json`).

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Web portal + API in watch mode (port 3000) |
| `npm run build` | Production build of all packages |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Load synthetic sample data |
| `npm run db:studio` | Browse the database in Prisma Studio |
| `npm run typecheck` | Type-check every workspace |

---

## 11. Environment Configuration

`apps/web/.env.local` — one file configures both the web portal and its built-in API (see `apps/web/.env.example`).

```env
NEXT_PUBLIC_APP_NAME=Movement Hub
NEXT_PUBLIC_API_URL=            # leave empty: the portal calls its own /api/v1
NEXT_PUBLIC_RAZORPAY_KEY_ID=

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/movement_hub
DATABASE_URL_POOLED=            # optional pooled URL for serverless

JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_DAYS=7

CRON_SECRET=                    # Vercel Cron sends this as a Bearer token

RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=

STORAGE_ENDPOINT=
STORAGE_BUCKET=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=

CORS_ORIGINS=http://localhost:3000
```

Never put secrets in `NEXT_PUBLIC_` variables.

---

## 12. Project Documentation

```text
docs/
├── DATABASE_SCHEMA.md        # full Prisma schema
├── API_DOCUMENTATION.md      # all REST endpoints
├── SYSTEM_ARCHITECTURE.md
├── APPOINTMENT_WORKFLOW.md
├── THERAPIST_SCHEDULING.md
├── AUTHENTICATION.md
├── SECURITY.md
├── MOBILE_APP_ARCHITECTURE.md
└── DEPLOYMENT.md
```

---

## 13. Architecture Principles

1. Feature-based frontend, module-based backend.
2. Modular monolith — no microservices.
3. Strict TypeScript end to end.
4. Shared types and Zod schemas for web, mobile and API.
5. Separation of client state (Zustand) and server state (TanStack Query).
6. Independent scheduling per therapist.
7. Transaction-safe booking and package deduction.
8. Clinical records separated from financial records.
9. Soft delete and full audit history.

---

## 14. Project Vision

Movement Hub aims to be a complete physiotherapy hospital management platform that simplifies hospital operations, therapist scheduling, patient consultations, treatment management and financial tracking — ready to expand to multiple branches.

---

- **Project:** Movement Hub – Physiotherapy & Rehab
- **Category:** Healthcare / Physiotherapy Management
- **Scope:** Full-stack web portal, REST API, PostgreSQL database, patient mobile app
