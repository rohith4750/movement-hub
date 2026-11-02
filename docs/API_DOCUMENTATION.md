# Movement Hub – API Documentation

REST API built into the Next.js web app (`apps/web/src/server`, served from `/api/v1`; TypeScript + Prisma).

- **Base URL:** `/api/v1`
- **Format:** JSON
- **Auth:** `Authorization: Bearer <accessToken>`
- **Validation:** Zod schemas from `packages/validation`
- **Dates:** ISO 8601 (UTC)

---

## 1. Conventions

### Response envelope

```json
// success
{ "success": true, "data": { ... }, "meta": { "page": 1, "limit": 20, "total": 134 } }

// error
{ "success": false, "error": { "code": "SLOT_UNAVAILABLE", "message": "Slot already booked", "details": [] } }
```

### Pagination, sorting, filtering

`?page=1&limit=20&sort=createdAt:desc&search=ravi&status=ACTIVE&from=2026-11-01&to=2026-11-30`

### Status codes

| Code | Meaning |
|---|---|
| 200 / 201 | OK / Created |
| 204 | No content |
| 400 | Validation error (`VALIDATION_ERROR`) |
| 401 | Not authenticated |
| 403 | Role not allowed |
| 404 | Not found |
| 409 | Conflict (`SLOT_UNAVAILABLE`, `PACKAGE_EXHAUSTED`, `ALREADY_EXISTS`) |
| 422 | Business rule violation |
| 429 | Rate limited |
| 500 | Server error |

### Role abbreviations

`SA` Super Admin · `AD` Admin · `RC` Receptionist · `PT` Physiotherapist · `AC` Accountant · `PA` Patient (own records only) · `ALL` any authenticated user

---

## 2. Authentication – `/auth`

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| POST | `/auth/login` | public | Staff login with email/phone + password |
| POST | `/auth/otp/request` | public | Send OTP to patient phone |
| POST | `/auth/otp/verify` | public | Verify OTP, returns tokens (creates patient account if new) |
| POST | `/auth/refresh` | public | Rotate refresh token, get new access token |
| POST | `/auth/logout` | ALL | Revoke refresh token |
| GET | `/auth/me` | ALL | Current user with role and profile |
| POST | `/auth/change-password` | staff | Change password |
| POST | `/auth/forgot-password` | public | Send reset link/OTP |
| POST | `/auth/reset-password` | public | Reset password with token |

```json
// POST /auth/login
{ "identifier": "reception@movementhub.in", "password": "••••••••" }

// 200
{ "success": true, "data": {
  "accessToken": "eyJ...", "refreshToken": "eyJ...",
  "user": { "id": "uuid", "name": "Anita", "role": "RECEPTIONIST", "branchId": "uuid" }
} }
```

---

## 3. Users – `/users`

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/users` | SA, AD | List staff users |
| POST | `/users` | SA, AD | Create staff user |
| GET | `/users/:id` | SA, AD | User details |
| PATCH | `/users/:id` | SA, AD | Update user / role |
| PATCH | `/users/:id/status` | SA, AD | Activate / deactivate |

---

## 4. Patients – `/patients`

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/patients` | SA, AD, RC, PT, AC | Search/list patients |
| POST | `/patients` | SA, AD, RC | Register patient |
| GET | `/patients/:id` | staff, PA | Patient profile |
| PATCH | `/patients/:id` | SA, AD, RC, PA | Update profile |
| DELETE | `/patients/:id` | SA | Soft delete |
| GET | `/patients/:id/addresses` | staff, PA | List addresses |
| POST | `/patients/:id/addresses` | RC, PA | Add address |
| PATCH | `/patients/:id/addresses/:addressId` | RC, PA | Update address |
| GET | `/patients/:id/medical-history` | PT, AD, PA | Medical history |
| POST | `/patients/:id/medical-history` | PT, RC | Add condition |
| PATCH | `/patients/:id/medical-history/:historyId` | PT | Update condition |
| GET | `/patients/:id/appointments` | staff, PA | Appointment history |
| GET | `/patients/:id/consultations` | PT, AD, PA | Consultations |
| GET | `/patients/:id/treatment-plans` | PT, AD, RC, PA | Treatment plans |
| GET | `/patients/:id/packages` | staff, PA | Packages and balances |
| GET | `/patients/:id/sessions` | PT, AD, PA | Therapy sessions |
| GET | `/patients/:id/invoices` | AC, AD, RC, PA | Invoices |
| GET | `/patients/:id/progress` | PT, AD, PA | Pain/ROM progress over time |
| POST | `/patients/:id/consent` | RC, PA | Record consent |

```json
// POST /patients
{
  "firstName": "Ravi", "lastName": "Kumar", "gender": "MALE",
  "dateOfBirth": "1988-04-12", "phone": "+919876543210",
  "email": "ravi@example.com", "referredBy": "Self",
  "address": { "line1": "12 MG Road", "city": "Hyderabad", "state": "Telangana", "pincode": "500001" },
  "consentGiven": true
}
```

---

## 5. Therapists – `/therapists`

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/therapists` | ALL | List therapists (filter by specialization, homeVisit) |
| POST | `/therapists` | SA, AD | Create therapist (+ user account) |
| GET | `/therapists/:id` | ALL | Therapist profile |
| PATCH | `/therapists/:id` | SA, AD | Update therapist |
| PATCH | `/therapists/:id/status` | SA, AD | Activate / deactivate |
| GET | `/specializations` | ALL | List specializations |
| POST | `/specializations` | SA, AD | Create specialization |

---

## 6. Scheduling

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/therapists/:id/schedule` | ALL staff | Weekly working template |
| PUT | `/therapists/:id/schedule` | SA, AD | Replace weekly template |
| GET | `/therapists/:id/leaves` | AD, PT | List leaves |
| POST | `/therapists/:id/leaves` | AD, PT | Apply for leave |
| PATCH | `/therapists/:id/leaves/:leaveId` | SA, AD | Approve / reject leave |
| GET | `/therapists/:id/slots?from&to` | ALL | Slots with status |
| POST | `/therapists/:id/slots/generate` | SA, AD | Generate slots for date range |
| PATCH | `/slots/:slotId` | SA, AD, RC | Block / unblock a slot |
| GET | `/availability?date&therapistId&type&specializationId` | ALL | Available slots across therapists |
| GET | `/calendar?view=day\|week\|month&date` | staff | Calendar data for all therapists |

```json
// PUT /therapists/:id/schedule
{ "days": [
  { "dayOfWeek": "MON", "startTime": "09:00", "endTime": "17:00", "breakStart": "13:00", "breakEnd": "14:00", "slotMinutes": 30 },
  { "dayOfWeek": "TUE", "startTime": "09:00", "endTime": "17:00", "breakStart": "13:00", "breakEnd": "14:00", "slotMinutes": 30 }
] }

// GET /availability?date=2026-11-03
{ "success": true, "data": [
  { "therapistId": "uuid", "therapistName": "Dr. Priya", "slots": [
    { "slotId": "uuid", "startAt": "2026-11-03T03:30:00Z", "endAt": "2026-11-03T04:00:00Z" }
  ] }
] }
```

---

## 7. Appointments – `/appointments`

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/appointments` | staff | List (filters: date, therapistId, patientId, status, type) |
| GET | `/appointments/today` | staff | Today's appointments |
| POST | `/appointments` | RC, AD, PA | Book appointment (transactional) |
| POST | `/appointments/recurring` | RC, AD | Book a recurring series for a treatment plan |
| GET | `/appointments/:id` | staff, PA | Appointment details with history |
| PATCH | `/appointments/:id/confirm` | RC, AD | Confirm |
| PATCH | `/appointments/:id/check-in` | RC | Patient arrived |
| PATCH | `/appointments/:id/start` | PT | Start appointment |
| PATCH | `/appointments/:id/complete` | PT | Complete appointment |
| PATCH | `/appointments/:id/no-show` | RC, PT | Mark no-show |
| POST | `/appointments/:id/reschedule` | RC, AD, PA | Move to a new slot |
| POST | `/appointments/:id/cancel` | RC, AD, PA | Cancel and release slot |
| GET | `/waitlist` | RC, AD | Waitlist entries |
| POST | `/waitlist` | RC, PA | Add to waitlist |
| DELETE | `/waitlist/:id` | RC, PA | Remove from waitlist |

```json
// POST /appointments
{
  "patientId": "uuid",
  "slotId": "uuid",
  "type": "THERAPY_SESSION",
  "treatmentPlanId": "uuid",
  "patientPackageId": "uuid",
  "notes": "Prefers female therapist"
}

// 409
{ "success": false, "error": { "code": "SLOT_UNAVAILABLE", "message": "This slot was just booked. Please choose another." } }
```

---

## 8. Consultations – `/consultations`

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/consultations` | PT, AD | List consultations |
| POST | `/consultations` | PT | Create consultation for an appointment |
| GET | `/consultations/:id` | PT, AD, PA | Consultation with assessment |
| PATCH | `/consultations/:id` | PT | Update consultation |
| PUT | `/consultations/:id/assessment` | PT | Create/update clinical assessment |

```json
// POST /consultations
{
  "appointmentId": "uuid",
  "chiefComplaint": "Lower back pain for 3 weeks",
  "symptoms": "Pain radiating to left leg",
  "clinicalImpression": "L4-L5 disc bulge suspected",
  "recommendations": "12 sessions, core strengthening, IFT",
  "assessment": {
    "painScore": 7, "painLocation": "Lumbar", "painType": "radiating",
    "rangeOfMotion": { "lumbar_flexion": 40 },
    "specialTests": [{ "name": "SLR", "result": "positive at 45°" }],
    "mobilityStatus": "Independent with pain"
  }
}
```

---

## 9. Treatment Plans – `/treatment-plans`

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/treatment-plans` | PT, AD, RC | List plans (filter: status, patientId) |
| POST | `/treatment-plans` | PT | Create plan with items |
| GET | `/treatment-plans/:id` | PT, AD, RC, PA | Plan details with progress |
| PATCH | `/treatment-plans/:id` | PT | Update plan |
| POST | `/treatment-plans/:id/activate` | PT | Activate plan |
| POST | `/treatment-plans/:id/complete` | PT | Complete plan |
| POST | `/treatment-plans/:id/cancel` | PT, AD | Cancel plan |
| POST | `/treatment-plans/:id/items` | PT | Add item |
| PATCH | `/treatment-plans/:id/items/:itemId` | PT | Update item |
| DELETE | `/treatment-plans/:id/items/:itemId` | PT | Remove item |

---

## 10. Packages

### Catalogue – `/packages`

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/packages` | ALL | List active packages |
| POST | `/packages` | SA, AD | Create package |
| GET | `/packages/:id` | ALL | Package details |
| PATCH | `/packages/:id` | SA, AD | Update package |
| PATCH | `/packages/:id/status` | SA, AD | Activate / deactivate |

### Patient packages – `/patient-packages`

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/patient-packages` | staff | List (filter: patientId, status, expiringBefore) |
| POST | `/patient-packages` | RC, AC, PA | Purchase package (creates invoice) |
| GET | `/patient-packages/:id` | staff, PA | Balance and details |
| GET | `/patient-packages/:id/transactions` | staff, PA | Session ledger |
| POST | `/patient-packages/:id/adjust` | SA, AD | Manual adjustment (audited) |
| POST | `/patient-packages/:id/extend` | SA, AD | Extend validity |

---

## 11. Therapy Sessions – `/therapy-sessions`

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/therapy-sessions` | PT, AD | List (filter: date, therapistId, status) |
| GET | `/therapy-sessions/today` | PT | My sessions today |
| GET | `/therapy-sessions/:id` | PT, AD, PA | Session details |
| POST | `/therapy-sessions/:id/start` | PT | Start session, record pain before |
| PATCH | `/therapy-sessions/:id` | PT | Update notes, ROM, exercises |
| POST | `/therapy-sessions/:id/complete` | PT | Complete (deducts package session) |
| POST | `/therapy-sessions/:id/exercises` | PT | Add exercise |
| DELETE | `/therapy-sessions/:id/exercises/:exerciseId` | PT | Remove exercise |

```json
// POST /therapy-sessions/:id/complete
{
  "painBefore": 6, "painAfter": 4, "progressRating": 4,
  "notes": "Improved lumbar flexion, reduced radiating pain",
  "homeAdvice": "Cat-camel 2x10 daily",
  "exercises": [
    { "name": "Bird dog", "sets": 3, "reps": 10 },
    { "name": "Pelvic bridge", "sets": 3, "reps": 12 }
  ]
}
// 200 → { "session": {...}, "package": { "remainingSessions": 7 } }
```

---

## 12. Home Visits – `/home-visits`

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/home-visits` | RC, AD, PT | List visits |
| POST | `/home-visits` | RC, PA | Book home visit (appointment + visit) |
| GET | `/home-visits/:id` | RC, AD, PT, PA | Visit details |
| PATCH | `/home-visits/:id` | RC, AD | Update / reassign therapist |
| POST | `/home-visits/:id/en-route` | PT | Therapist on the way |
| POST | `/home-visits/:id/check-in` | PT | Check in with GPS location |
| POST | `/home-visits/:id/check-out` | PT | Check out and complete |

---

## 13. Billing – `/invoices`

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/invoices` | AC, AD, RC | List (filter: status, patientId, from, to) |
| POST | `/invoices` | AC, RC | Create invoice with items |
| GET | `/invoices/:id` | AC, AD, RC, PA | Invoice details |
| PATCH | `/invoices/:id` | AC | Update draft invoice |
| POST | `/invoices/:id/issue` | AC, RC | Issue (locks invoice) |
| POST | `/invoices/:id/cancel` | AC, AD | Cancel unpaid invoice |
| GET | `/invoices/:id/pdf` | AC, AD, RC, PA | Download invoice PDF |

```json
// POST /invoices
{
  "patientId": "uuid",
  "items": [
    { "type": "PACKAGE", "description": "Standard Package – 12 sessions", "quantity": 1, "unitPrice": 9000, "patientPackageId": "uuid" },
    { "type": "CONSULTATION", "description": "Initial consultation", "quantity": 1, "unitPrice": 500, "appointmentId": "uuid" }
  ],
  "discountAmount": 500,
  "discountReason": "First visit offer"
}
```

---

## 14. Payments – `/payments`

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/payments` | AC, AD | Payment history |
| POST | `/payments` | AC, RC | Record offline payment (cash/card/UPI) |
| POST | `/payments/razorpay/order` | RC, PA | Create Razorpay order for an invoice |
| POST | `/payments/razorpay/verify` | RC, PA | Verify checkout signature |
| POST | `/payments/razorpay/webhook` | public (signed) | Razorpay webhook |
| GET | `/payments/:id` | AC, AD, PA | Payment details |
| GET | `/payments/:id/receipt` | AC, RC, PA | Download receipt PDF |
| POST | `/payments/:id/refunds` | AC, AD | Issue refund |
| GET | `/refunds` | AC, AD | Refund list |

---

## 15. Notifications – `/notifications`

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/notifications` | SA, AD | Delivery log |
| GET | `/notifications/me` | ALL | My notifications |
| POST | `/notifications/send` | SA, AD, RC | Send manual message to patient |
| GET | `/notifications/preferences` | ALL | My preferences |
| PUT | `/notifications/preferences` | ALL | Update preferences |
| POST | `/notifications/whatsapp/webhook` | public (signed) | WhatsApp delivery status |

Automatic jobs (BullMQ): appointment reminder (24h and 2h before), package expiry (7 days before), follow-up reminder, daily slot generation, nightly package expiry.

---

## 16. Documents – `/documents`

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| POST | `/documents/upload-url` | staff, PA | Get signed S3 upload URL |
| POST | `/documents` | staff, PA | Save document metadata after upload |
| GET | `/patients/:id/documents` | PT, AD, RC, PA | List patient documents |
| GET | `/documents/:id/download` | PT, AD, RC, PA | Signed download URL |
| DELETE | `/documents/:id` | SA, AD | Soft delete |

---

## 17. Dashboard and Reports – `/reports`

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/reports/dashboard` | SA, AD, RC, AC | KPI summary for today/month |
| GET | `/reports/revenue?from&to&groupBy=day\|month` | SA, AD, AC | Revenue report |
| GET | `/reports/appointments?from&to` | SA, AD | Appointment counts by status/type |
| GET | `/reports/therapist-utilization?from&to` | SA, AD | Booked vs available slots per therapist |
| GET | `/reports/packages?from&to` | SA, AD, AC | Package sales and usage |
| GET | `/reports/outstanding` | SA, AD, AC | Unpaid invoices |
| GET | `/reports/patient-progress/:patientId` | PT, AD | Pain and ROM trends |
| GET | `/reports/export?type&from&to&format=csv\|xlsx` | SA, AD, AC | Export report |

```json
// GET /reports/dashboard
{ "success": true, "data": {
  "totalPatients": 1240, "todayAppointments": 38, "availableTherapists": 4,
  "completedSessionsToday": 21, "pendingAppointments": 9,
  "revenueToday": 28500, "revenueMonth": 642000,
  "therapistUtilization": [{ "therapistId": "uuid", "name": "Dr. Priya", "percent": 86 }]
} }
```

---

## 18. Settings – `/settings`

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/settings` | SA, AD | Hospital settings |
| PATCH | `/settings` | SA | Update fees, GST, slot duration, hours |
| GET | `/branches` | SA | List branches |
| POST | `/branches` | SA | Create branch |
| PATCH | `/branches/:id` | SA | Update branch |
| GET | `/audit-logs` | SA | Audit trail (filter: entity, userId, date) |

---

## 19. Health

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/health` | public | API, database and Redis status |
