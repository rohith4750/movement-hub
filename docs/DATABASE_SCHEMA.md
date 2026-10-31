# Movement Hub – Database Schema

PostgreSQL + Prisma ORM. This is the complete production schema.

File location: `packages/database/prisma/schema.prisma`

## Conventions

- Primary keys are UUIDs (`String @id @default(uuid())`).
- All tables have `createdAt` / `updatedAt`.
- Clinical and financial tables use soft delete (`deletedAt`) and are never hard-deleted.
- Money is stored as `Decimal(10,2)` in INR.
- Dates use `DateTime` (UTC). Slot times are stored as full timestamps.

## Entity Relationships (summary)

```text
Branch 1──* User, Therapist, Patient, Appointment, Invoice
User 1──1 Therapist | Patient          (login account)
Patient 1──* PatientAddress, MedicalHistory, PatientDocument
Patient 1──* Appointment, Consultation, TreatmentPlan, PatientPackage, Invoice
Therapist *──* Specialization          (via TherapistSpecialization)
Therapist 1──* TherapistSchedule, TherapistLeave, TherapistSlot
TherapistSlot 1──0..1 Appointment      (one active booking per slot)
Appointment 1──0..1 Consultation | TherapySession | HomeVisit
Appointment 1──* AppointmentHistory
Consultation 1──1 ClinicalAssessment
Consultation 1──0..1 TreatmentPlan
TreatmentPlan 1──* TreatmentPlanItem, TherapySession
TreatmentPackage 1──* PatientPackage
PatientPackage 1──* PackageTransaction, TherapySession
TherapySession 1──* SessionExercise
Invoice 1──* InvoiceItem, Payment
Payment 1──* Refund
```

## Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─────────────────────────────── ENUMS ───────────────────────────────

enum Role {
  SUPER_ADMIN
  ADMIN
  RECEPTIONIST
  PHYSIOTHERAPIST
  ACCOUNTANT
  PATIENT
}

enum Gender {
  MALE
  FEMALE
  OTHER
}

enum DayOfWeek {
  MON
  TUE
  WED
  THU
  FRI
  SAT
  SUN
}

enum LeaveStatus {
  PENDING
  APPROVED
  REJECTED
}

enum SlotStatus {
  AVAILABLE
  BOOKED
  BLOCKED
}

enum AppointmentType {
  INITIAL_CONSULTATION
  FOLLOW_UP_CONSULTATION
  THERAPY_SESSION
  HOME_VISIT
}

enum AppointmentStatus {
  SCHEDULED
  CONFIRMED
  CHECKED_IN
  IN_PROGRESS
  COMPLETED
  CANCELLED
  NO_SHOW
  RESCHEDULED
}

enum TreatmentPlanStatus {
  DRAFT
  ACTIVE
  COMPLETED
  CANCELLED
}

enum PackageTier {
  BASIC
  STANDARD
  PREMIUM
  CUSTOM
}

enum PatientPackageStatus {
  ACTIVE
  EXHAUSTED
  EXPIRED
  CANCELLED
}

enum PackageTransactionType {
  PURCHASE
  SESSION_USED
  SESSION_RESTORED
  ADJUSTMENT
  EXPIRED
}

enum SessionStatus {
  SCHEDULED
  IN_PROGRESS
  COMPLETED
  CANCELLED
  MISSED
}

enum HomeVisitStatus {
  SCHEDULED
  EN_ROUTE
  CHECKED_IN
  COMPLETED
  CANCELLED
}

enum InvoiceStatus {
  DRAFT
  ISSUED
  PARTIALLY_PAID
  PAID
  CANCELLED
  REFUNDED
}

enum InvoiceItemType {
  CONSULTATION
  THERAPY_SESSION
  PACKAGE
  HOME_VISIT
  TRAVEL_CHARGE
  OTHER
}

enum PaymentMethod {
  CASH
  CARD
  UPI
  NET_BANKING
  RAZORPAY
}

enum PaymentStatus {
  PENDING
  SUCCESS
  FAILED
  REFUNDED
  PARTIALLY_REFUNDED
}

enum RefundStatus {
  PENDING
  PROCESSED
  FAILED
}

enum NotificationChannel {
  WHATSAPP
  SMS
  EMAIL
  PUSH
}

enum NotificationType {
  APPOINTMENT_CONFIRMATION
  APPOINTMENT_REMINDER
  APPOINTMENT_RESCHEDULED
  APPOINTMENT_CANCELLED
  PAYMENT_CONFIRMATION
  PACKAGE_EXPIRY
  FOLLOW_UP_REMINDER
}

enum NotificationStatus {
  QUEUED
  SENT
  DELIVERED
  FAILED
}

enum AuditAction {
  CREATE
  UPDATE
  DELETE
  LOGIN
  LOGOUT
}

// ─────────────────────────── HOSPITAL ───────────────────────────

model Branch {
  id        String   @id @default(uuid())
  name      String
  code      String   @unique
  phone     String?
  email     String?
  address   String
  city      String
  state     String
  pincode   String
  gstin     String?
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  settings     HospitalSetting?
  users        User[]
  therapists   Therapist[]
  patients     Patient[]
  appointments Appointment[]
  invoices     Invoice[]
}

model HospitalSetting {
  id                    String   @id @default(uuid())
  branchId              String   @unique
  defaultSlotMinutes    Int      @default(30)
  openingTime           String   @default("08:00") // HH:mm
  closingTime           String   @default("20:00")
  gstPercent            Decimal  @default(18) @db.Decimal(5, 2)
  consultationFee       Decimal  @db.Decimal(10, 2)
  therapySessionFee     Decimal  @db.Decimal(10, 2)
  homeVisitFee          Decimal  @db.Decimal(10, 2)
  travelChargePerKm     Decimal  @default(0) @db.Decimal(10, 2)
  cancellationHours     Int      @default(4)
  reminderHoursBefore   Int      @default(24)
  invoicePrefix         String   @default("MH")
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  branch Branch @relation(fields: [branchId], references: [id])
}

// ─────────────────────────── AUTH ───────────────────────────

model User {
  id           String    @id @default(uuid())
  branchId     String?
  role         Role
  name         String
  email        String?   @unique
  phone        String    @unique
  passwordHash String?   // null for OTP-only patient accounts
  isActive     Boolean   @default(true)
  lastLoginAt  DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  deletedAt    DateTime?

  branch        Branch?        @relation(fields: [branchId], references: [id])
  therapist     Therapist?
  patient       Patient?
  refreshTokens RefreshToken[]
  auditLogs     AuditLog[]
  notificationPreference NotificationPreference?

  @@index([role])
}

model RefreshToken {
  id        String    @id @default(uuid())
  userId    String
  tokenHash String    @unique
  userAgent String?
  ipAddress String?
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model OtpCode {
  id        String    @id @default(uuid())
  phone     String
  codeHash  String
  attempts  Int       @default(0)
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([phone, createdAt])
}

// ─────────────────────────── PATIENTS ───────────────────────────

model Patient {
  id               String    @id @default(uuid())
  userId           String?   @unique
  branchId         String
  patientCode      String    @unique // e.g. MH-P-000123
  firstName        String
  lastName         String?
  gender           Gender
  dateOfBirth      DateTime? @db.Date
  phone            String
  email            String?
  emergencyName    String?
  emergencyPhone   String?
  occupation       String?
  referredBy       String?
  consentGiven     Boolean   @default(false)
  consentAt        DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  deletedAt        DateTime?

  user            User?            @relation(fields: [userId], references: [id])
  branch          Branch           @relation(fields: [branchId], references: [id])
  addresses       PatientAddress[]
  medicalHistory  MedicalHistory[]
  documents       PatientDocument[]
  appointments    Appointment[]
  consultations   Consultation[]
  treatmentPlans  TreatmentPlan[]
  packages        PatientPackage[]
  therapySessions TherapySession[]
  homeVisits      HomeVisit[]
  invoices        Invoice[]
  waitlist        Waitlist[]

  @@index([phone])
  @@index([branchId])
}

model PatientAddress {
  id        String   @id @default(uuid())
  patientId String
  label     String   @default("Home")
  line1     String
  line2     String?
  landmark  String?
  city      String
  state     String
  pincode   String
  latitude  Decimal? @db.Decimal(9, 6)
  longitude Decimal? @db.Decimal(9, 6)
  isDefault Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  patient    Patient     @relation(fields: [patientId], references: [id])
  homeVisits HomeVisit[]
}

model MedicalHistory {
  id          String    @id @default(uuid())
  patientId   String
  condition   String
  details     String?
  diagnosedOn DateTime? @db.Date
  medications String?
  surgeries   String?
  allergies   String?
  isOngoing   Boolean   @default(true)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?

  patient Patient @relation(fields: [patientId], references: [id])
}

model PatientDocument {
  id           String    @id @default(uuid())
  patientId    String
  uploadedById String
  title        String
  category     String    // X_RAY, MRI, PRESCRIPTION, REPORT, OTHER
  fileKey      String    // S3 object key
  mimeType     String
  sizeBytes    Int
  createdAt    DateTime  @default(now())
  deletedAt    DateTime?

  patient Patient @relation(fields: [patientId], references: [id])
}

// ─────────────────────────── THERAPISTS ───────────────────────────

model Therapist {
  id              String   @id @default(uuid())
  userId          String   @unique
  branchId        String
  registrationNo  String?  @unique
  qualification   String
  experienceYears Int      @default(0)
  bio             String?
  colorTag        String?  // calendar colour
  isAvailableForHomeVisit Boolean @default(false)
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user             User                      @relation(fields: [userId], references: [id])
  branch           Branch                    @relation(fields: [branchId], references: [id])
  specializations  TherapistSpecialization[]
  schedules        TherapistSchedule[]
  leaves           TherapistLeave[]
  slots            TherapistSlot[]
  appointments     Appointment[]
  consultations    Consultation[]
  treatmentPlans   TreatmentPlan[]
  therapySessions  TherapySession[]
  homeVisits       HomeVisit[]
  waitlist         Waitlist[]
}

model Specialization {
  id          String  @id @default(uuid())
  name        String  @unique // Orthopaedic, Neuro, Sports, Paediatric, Geriatric...
  description String?

  therapists TherapistSpecialization[]
}

model TherapistSpecialization {
  therapistId      String
  specializationId String

  therapist      Therapist      @relation(fields: [therapistId], references: [id], onDelete: Cascade)
  specialization Specialization @relation(fields: [specializationId], references: [id])

  @@id([therapistId, specializationId])
}

// ─────────────────────────── SCHEDULING ───────────────────────────

/// Weekly working template. One row per working day per therapist.
model TherapistSchedule {
  id          String    @id @default(uuid())
  therapistId String
  dayOfWeek   DayOfWeek
  startTime   String    // HH:mm
  endTime     String    // HH:mm
  breakStart  String?
  breakEnd    String?
  slotMinutes Int       @default(30)
  isActive    Boolean   @default(true)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  therapist Therapist @relation(fields: [therapistId], references: [id], onDelete: Cascade)

  @@unique([therapistId, dayOfWeek])
}

model TherapistLeave {
  id           String      @id @default(uuid())
  therapistId  String
  startDate    DateTime
  endDate      DateTime
  reason       String?
  status       LeaveStatus @default(PENDING)
  approvedById String?
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  therapist Therapist @relation(fields: [therapistId], references: [id], onDelete: Cascade)

  @@index([therapistId, startDate, endDate])
}

/// Concrete bookable slots, generated from TherapistSchedule by a background job.
model TherapistSlot {
  id          String     @id @default(uuid())
  therapistId String
  startAt     DateTime
  endAt       DateTime
  status      SlotStatus @default(AVAILABLE)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  therapist   Therapist    @relation(fields: [therapistId], references: [id], onDelete: Cascade)
  appointment Appointment?

  @@unique([therapistId, startAt]) // no duplicate / overlapping slot starts
  @@index([therapistId, status, startAt])
}

// ─────────────────────────── APPOINTMENTS ───────────────────────────

model Appointment {
  id              String            @id @default(uuid())
  appointmentNo   String            @unique // MH-A-000123
  branchId        String
  patientId       String
  therapistId     String
  slotId          String?           @unique // one active appointment per slot
  type            AppointmentType
  status          AppointmentStatus @default(SCHEDULED)
  startAt         DateTime
  endAt           DateTime
  treatmentPlanId String?
  notes           String?
  cancelReason    String?
  bookedById      String
  rescheduledFromId String?         @unique
  checkedInAt     DateTime?
  completedAt     DateTime?
  cancelledAt     DateTime?
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  branch          Branch         @relation(fields: [branchId], references: [id])
  patient         Patient        @relation(fields: [patientId], references: [id])
  therapist       Therapist      @relation(fields: [therapistId], references: [id])
  slot            TherapistSlot? @relation(fields: [slotId], references: [id])
  treatmentPlan   TreatmentPlan? @relation(fields: [treatmentPlanId], references: [id])
  rescheduledFrom Appointment?   @relation("Reschedule", fields: [rescheduledFromId], references: [id])
  rescheduledTo   Appointment?   @relation("Reschedule")
  history         AppointmentHistory[]
  consultation    Consultation?
  therapySession  TherapySession?
  homeVisit       HomeVisit?
  invoiceItems    InvoiceItem[]

  @@index([therapistId, startAt])
  @@index([patientId, startAt])
  @@index([status, startAt])
}

model AppointmentHistory {
  id            String             @id @default(uuid())
  appointmentId String
  fromStatus    AppointmentStatus?
  toStatus      AppointmentStatus
  changedById   String
  note          String?
  createdAt     DateTime           @default(now())

  appointment Appointment @relation(fields: [appointmentId], references: [id], onDelete: Cascade)

  @@index([appointmentId])
}

model Waitlist {
  id            String          @id @default(uuid())
  patientId     String
  therapistId   String?
  type          AppointmentType
  preferredDate DateTime        @db.Date
  preferredFrom String?         // HH:mm
  preferredTo   String?
  isFulfilled   Boolean         @default(false)
  createdAt     DateTime        @default(now())

  patient   Patient    @relation(fields: [patientId], references: [id])
  therapist Therapist? @relation(fields: [therapistId], references: [id])

  @@index([preferredDate, isFulfilled])
}

// ─────────────────────────── CONSULTATIONS ───────────────────────────

model Consultation {
  id               String    @id @default(uuid())
  appointmentId    String    @unique
  patientId        String
  therapistId      String
  isFollowUp       Boolean   @default(false)
  chiefComplaint   String
  symptoms         String?
  historyOfIllness String?
  clinicalImpression String?
  recommendations  String?
  followUpDate     DateTime? @db.Date
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  deletedAt        DateTime?

  appointment   Appointment         @relation(fields: [appointmentId], references: [id])
  patient       Patient             @relation(fields: [patientId], references: [id])
  therapist     Therapist           @relation(fields: [therapistId], references: [id])
  assessment    ClinicalAssessment?
  treatmentPlan TreatmentPlan?
}

model ClinicalAssessment {
  id                 String   @id @default(uuid())
  consultationId     String   @unique
  painScore          Int      // 0–10 (VAS)
  painLocation       String?
  painType           String?  // sharp, dull, burning, radiating...
  aggravatingFactors String?
  relievingFactors   String?
  posture            String?
  rangeOfMotion      Json?    // { "shoulder_flexion": { "left": 120, "right": 170 } }
  muscleStrength     Json?    // MMT grades per muscle group
  specialTests       Json?    // [{ "name": "Lachman", "result": "positive" }]
  mobilityStatus     String?
  gait               String?
  observations       String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  consultation Consultation @relation(fields: [consultationId], references: [id], onDelete: Cascade)
}

// ─────────────────────────── TREATMENT PLANS ───────────────────────────

model TreatmentPlan {
  id                 String              @id @default(uuid())
  planNo             String              @unique
  patientId          String
  therapistId        String
  consultationId     String?             @unique
  title              String
  diagnosis          String?
  goals              String?
  prescribedSessions Int
  frequencyPerWeek   Int
  sessionMinutes     Int                 @default(30)
  instructions       String?
  status             TreatmentPlanStatus @default(DRAFT)
  startDate          DateTime?           @db.Date
  endDate            DateTime?           @db.Date
  activatedAt        DateTime?
  completedAt        DateTime?
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt
  deletedAt          DateTime?

  patient         Patient             @relation(fields: [patientId], references: [id])
  therapist       Therapist           @relation(fields: [therapistId], references: [id])
  consultation    Consultation?       @relation(fields: [consultationId], references: [id])
  items           TreatmentPlanItem[]
  appointments    Appointment[]
  therapySessions TherapySession[]
  patientPackages PatientPackage[]

  @@index([patientId, status])
}

model TreatmentPlanItem {
  id              String  @id @default(uuid())
  treatmentPlanId String
  category        String  // Manual Therapy, Electrotherapy, Exercise Therapy, Taping...
  name            String  // e.g. IFT, Ultrasound, Strengthening
  description     String?
  sets            Int?
  reps            Int?
  durationMinutes Int?
  sortOrder       Int     @default(0)

  treatmentPlan TreatmentPlan @relation(fields: [treatmentPlanId], references: [id], onDelete: Cascade)
}

// ─────────────────────────── PACKAGES ───────────────────────────

model TreatmentPackage {
  id           String      @id @default(uuid())
  name         String
  tier         PackageTier
  description  String?
  sessionCount Int
  validityDays Int
  price        Decimal     @db.Decimal(10, 2)
  includesHomeVisit Boolean @default(false)
  isActive     Boolean     @default(true)
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  patientPackages PatientPackage[]
}

model PatientPackage {
  id                String               @id @default(uuid())
  patientId         String
  packageId         String
  treatmentPlanId   String?
  totalSessions     Int
  usedSessions      Int                  @default(0)
  remainingSessions Int
  pricePaid         Decimal              @db.Decimal(10, 2)
  startDate         DateTime             @db.Date
  expiryDate        DateTime             @db.Date
  status            PatientPackageStatus @default(ACTIVE)
  createdAt         DateTime             @default(now())
  updatedAt         DateTime             @updatedAt

  patient         Patient              @relation(fields: [patientId], references: [id])
  package         TreatmentPackage     @relation(fields: [packageId], references: [id])
  treatmentPlan   TreatmentPlan?       @relation(fields: [treatmentPlanId], references: [id])
  transactions    PackageTransaction[]
  therapySessions TherapySession[]
  invoiceItems    InvoiceItem[]

  @@index([patientId, status])
}

/// Ledger: every change in package balance is recorded here.
model PackageTransaction {
  id               String                 @id @default(uuid())
  patientPackageId String
  type             PackageTransactionType
  sessionsDelta    Int                    // +10 purchase, -1 session used, +1 restored
  balanceAfter     Int
  therapySessionId String?
  performedById    String
  note             String?
  createdAt        DateTime               @default(now())

  patientPackage PatientPackage  @relation(fields: [patientPackageId], references: [id])
  therapySession TherapySession? @relation(fields: [therapySessionId], references: [id])

  @@index([patientPackageId, createdAt])
}

// ─────────────────────────── THERAPY ───────────────────────────

model TherapySession {
  id               String        @id @default(uuid())
  appointmentId    String        @unique
  patientId        String
  therapistId      String
  treatmentPlanId  String?
  patientPackageId String?
  sessionNumber    Int?          // e.g. 4 of 12
  status           SessionStatus @default(SCHEDULED)
  painBefore       Int?          // 0–10
  painAfter        Int?          // 0–10
  rangeOfMotion    Json?
  notes            String?
  homeAdvice       String?
  progressRating   Int?          // 1–5
  startedAt        DateTime?
  completedAt      DateTime?
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt
  deletedAt        DateTime?

  appointment         Appointment          @relation(fields: [appointmentId], references: [id])
  patient             Patient              @relation(fields: [patientId], references: [id])
  therapist           Therapist            @relation(fields: [therapistId], references: [id])
  treatmentPlan       TreatmentPlan?       @relation(fields: [treatmentPlanId], references: [id])
  patientPackage      PatientPackage?      @relation(fields: [patientPackageId], references: [id])
  exercises           SessionExercise[]
  packageTransactions PackageTransaction[]

  @@index([therapistId, status])
  @@index([patientId, completedAt])
}

model SessionExercise {
  id               String  @id @default(uuid())
  therapySessionId String
  name             String
  sets             Int?
  reps             Int?
  durationMinutes  Int?
  resistance       String?
  notes            String?

  therapySession TherapySession @relation(fields: [therapySessionId], references: [id], onDelete: Cascade)
}

// ─────────────────────────── HOME VISITS ───────────────────────────

model HomeVisit {
  id            String          @id @default(uuid())
  appointmentId String          @unique
  patientId     String
  therapistId   String
  addressId     String
  distanceKm    Decimal?        @db.Decimal(6, 2)
  travelCharge  Decimal         @default(0) @db.Decimal(10, 2)
  status        HomeVisitStatus @default(SCHEDULED)
  checkInAt     DateTime?
  checkInLat    Decimal?        @db.Decimal(9, 6)
  checkInLng    Decimal?        @db.Decimal(9, 6)
  checkOutAt    DateTime?
  notes         String?
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  appointment Appointment    @relation(fields: [appointmentId], references: [id])
  patient     Patient        @relation(fields: [patientId], references: [id])
  therapist   Therapist      @relation(fields: [therapistId], references: [id])
  address     PatientAddress @relation(fields: [addressId], references: [id])
}

// ─────────────────────────── BILLING ───────────────────────────

model Invoice {
  id             String        @id @default(uuid())
  invoiceNo      String        @unique // MH-INV-2026-000123
  branchId       String
  patientId      String
  status         InvoiceStatus @default(DRAFT)
  subtotal       Decimal       @db.Decimal(10, 2)
  discountAmount Decimal       @default(0) @db.Decimal(10, 2)
  discountReason String?
  taxableAmount  Decimal       @db.Decimal(10, 2)
  gstPercent     Decimal       @db.Decimal(5, 2)
  cgstAmount     Decimal       @default(0) @db.Decimal(10, 2)
  sgstAmount     Decimal       @default(0) @db.Decimal(10, 2)
  igstAmount     Decimal       @default(0) @db.Decimal(10, 2)
  totalAmount    Decimal       @db.Decimal(10, 2)
  paidAmount     Decimal       @default(0) @db.Decimal(10, 2)
  dueAmount      Decimal       @db.Decimal(10, 2)
  issuedAt       DateTime?
  dueDate        DateTime?     @db.Date
  createdById    String
  notes          String?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  deletedAt      DateTime?

  branch   Branch        @relation(fields: [branchId], references: [id])
  patient  Patient       @relation(fields: [patientId], references: [id])
  items    InvoiceItem[]
  payments Payment[]

  @@index([patientId, status])
  @@index([issuedAt])
}

model InvoiceItem {
  id               String          @id @default(uuid())
  invoiceId        String
  type             InvoiceItemType
  description      String
  quantity         Int             @default(1)
  unitPrice        Decimal         @db.Decimal(10, 2)
  discount         Decimal         @default(0) @db.Decimal(10, 2)
  amount           Decimal         @db.Decimal(10, 2)
  appointmentId    String?
  patientPackageId String?

  invoice        Invoice         @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  appointment    Appointment?    @relation(fields: [appointmentId], references: [id])
  patientPackage PatientPackage? @relation(fields: [patientPackageId], references: [id])
}

model Payment {
  id                String        @id @default(uuid())
  receiptNo         String        @unique
  invoiceId         String
  method            PaymentMethod
  status            PaymentStatus @default(PENDING)
  amount            Decimal       @db.Decimal(10, 2)
  razorpayOrderId   String?       @unique
  razorpayPaymentId String?       @unique
  razorpaySignature String?
  referenceNo       String?       // UPI ref / card last 4 / cheque no
  receivedById      String?
  paidAt            DateTime?
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt

  invoice Invoice  @relation(fields: [invoiceId], references: [id])
  refunds Refund[]

  @@index([invoiceId])
}

model Refund {
  id               String       @id @default(uuid())
  paymentId        String
  amount           Decimal      @db.Decimal(10, 2)
  reason           String
  status           RefundStatus @default(PENDING)
  razorpayRefundId String?      @unique
  processedById    String
  processedAt      DateTime?
  createdAt        DateTime     @default(now())

  payment Payment @relation(fields: [paymentId], references: [id])
}

// ─────────────────────────── NOTIFICATIONS ───────────────────────────

model Notification {
  id          String              @id @default(uuid())
  userId      String?
  phone       String?
  email       String?
  channel     NotificationChannel
  type        NotificationType
  templateKey String
  payload     Json
  status      NotificationStatus  @default(QUEUED)
  providerMessageId String?
  error       String?
  scheduledAt DateTime            @default(now())
  sentAt      DateTime?
  createdAt   DateTime            @default(now())

  @@index([status, scheduledAt])
  @@index([userId])
}

model NotificationPreference {
  id        String  @id @default(uuid())
  userId    String  @unique
  whatsapp  Boolean @default(true)
  sms       Boolean @default(true)
  email     Boolean @default(false)
  push      Boolean @default(true)
  reminders Boolean @default(true)
  marketing Boolean @default(false)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// ─────────────────────────── SECURITY ───────────────────────────

model AuditLog {
  id         String      @id @default(uuid())
  userId     String?
  action     AuditAction
  entity     String      // "Appointment", "Invoice", ...
  entityId   String?
  before     Json?
  after      Json?
  ipAddress  String?
  userAgent  String?
  createdAt  DateTime    @default(now())

  user User? @relation(fields: [userId], references: [id])

  @@index([entity, entityId])
  @@index([userId, createdAt])
}
```

## Transactional Rules

**Booking an appointment**

```text
BEGIN
  SELECT slot FOR UPDATE WHERE id = :slotId AND status = 'AVAILABLE'
  -- fail with 409 SLOT_UNAVAILABLE if not found
  INSERT Appointment (slotId = :slotId)        -- unique(slotId) guards double booking
  UPDATE TherapistSlot SET status = 'BOOKED'
  INSERT AppointmentHistory (toStatus = 'SCHEDULED')
COMMIT
→ enqueue APPOINTMENT_CONFIRMATION notification
```

**Completing a therapy session with a package**

```text
BEGIN
  SELECT PatientPackage FOR UPDATE
  -- reject if status != ACTIVE, expiryDate < today, or remainingSessions = 0
  UPDATE TherapySession SET status = 'COMPLETED'
  UPDATE PatientPackage SET usedSessions + 1, remainingSessions - 1,
         status = EXHAUSTED if remainingSessions = 0
  INSERT PackageTransaction (SESSION_USED, -1, balanceAfter)
  UPDATE Appointment SET status = 'COMPLETED'
COMMIT
```

**Cancelling an appointment**

```text
BEGIN
  UPDATE Appointment SET status = 'CANCELLED', slotId = NULL
  UPDATE TherapistSlot SET status = 'AVAILABLE'
  INSERT AppointmentHistory
COMMIT
→ notify waitlist + send APPOINTMENT_CANCELLED
```

## Seed Data

`npm run db:seed` creates:

- 1 branch with hospital settings.
- 1 Super Admin, 1 Admin, 1 Receptionist, 1 Accountant.
- 4 physiotherapists with specializations and weekly schedules.
- Basic / Standard / Premium treatment packages.
- 20 synthetic patients with appointments, consultations, plans, sessions and invoices.
