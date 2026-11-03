import { prisma, type AppointmentStatus, type AppointmentType, type Prisma } from "@movement-hub/database";
import { nextCode, type Tx } from "../../lib/codes";
import { badRequest, conflict, notFound, unprocessable } from "../../lib/http-error";
import { localDateString } from "../../lib/time";
import { notifyPatient } from "../notifications/notification.service";

export interface BookInput {
  patientId: string;
  slotId: string;
  type: AppointmentType;
  treatmentPlanId?: string;
  patientPackageId?: string;
  notes?: string;
  rescheduledFromId?: string;
  /** WALK_IN: the patient is at the clinic now. They may take the slot that is already running and are checked in straight away. */
  source?: "SCHEDULED" | "WALK_IN";
}

/** Allowed status transitions. */
const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: ["CONFIRMED", "CHECKED_IN", "CANCELLED", "NO_SHOW", "RESCHEDULED"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW", "RESCHEDULED"],
  CHECKED_IN: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
  RESCHEDULED: [],
};

/** Lock the slot row so two concurrent bookings cannot both see it as AVAILABLE. */
async function lockSlot(tx: Prisma.TransactionClient, slotId: string, walkIn = false) {
  const rows = await tx.$queryRaw<{ id: string; status: string; therapistId: string; startAt: Date; endAt: Date }[]>`
    SELECT "id", "status", "therapistId", "startAt", "endAt" FROM "TherapistSlot" WHERE "id" = ${slotId} FOR UPDATE`;
  const slot = rows[0];
  if (!slot) throw notFound("Slot");
  if (slot.status !== "AVAILABLE") throw conflict("SLOT_UNAVAILABLE", "This slot was just booked. Please choose another.");
  const now = new Date();
  // A walk-in can take the slot that is running right now; anything else must start in the future.
  if (slot.endAt <= now || (!walkIn && slot.startAt <= now)) throw unprocessable("SLOT_IN_PAST", "Cannot book a slot in the past");
  return slot;
}

async function assertPackageUsable(tx: Tx, patientPackageId: string, patientId: string, on: Date) {
  const pkg = await tx.patientPackage.findUnique({ where: { id: patientPackageId } });
  if (!pkg || pkg.patientId !== patientId) throw notFound("Patient package");
  if (pkg.status !== "ACTIVE") throw unprocessable("PACKAGE_INACTIVE", `Package is ${pkg.status.toLowerCase()}`);
  if (localDateString(on) > pkg.expiryDate.toISOString().slice(0, 10)) throw unprocessable("PACKAGE_EXPIRED", "Appointment date is after package expiry");
  const reserved = await tx.therapySession.count({ where: { patientPackageId, status: { in: ["SCHEDULED", "IN_PROGRESS"] } } });
  if (pkg.remainingSessions - reserved <= 0) throw conflict("PACKAGE_EXHAUSTED", "No remaining sessions in this package");
  return pkg;
}

/** Core booking. Must run inside a transaction. */
export async function bookInTx(tx: Prisma.TransactionClient, input: BookInput, bookedById: string) {
  const walkIn = input.source === "WALK_IN";
  const slot = await lockSlot(tx, input.slotId, walkIn);
  if (walkIn && localDateString(slot.startAt) !== localDateString(new Date())) throw badRequest("A walk-in must be booked for today", "WALK_IN_NOT_TODAY");
  const patient = await tx.patient.findFirst({ where: { id: input.patientId, deletedAt: null } });
  if (!patient) throw notFound("Patient");

  // Patient cannot be in two places at once.
  const clash = await tx.appointment.findFirst({
    where: { patientId: patient.id, status: { in: ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"] }, startAt: { lt: slot.endAt }, endAt: { gt: slot.startAt } },
  });
  if (clash) throw conflict("PATIENT_DOUBLE_BOOKED", `Patient already has appointment ${clash.appointmentNo} at this time`);

  if (input.type === "THERAPY_SESSION" && !input.treatmentPlanId) throw badRequest("treatmentPlanId is required for therapy sessions");
  let plan = null;
  if (input.treatmentPlanId) {
    plan = await tx.treatmentPlan.findUnique({ where: { id: input.treatmentPlanId } });
    if (!plan || plan.patientId !== patient.id) throw notFound("Treatment plan");
    if (plan.status !== "ACTIVE") throw unprocessable("PLAN_NOT_ACTIVE", "Treatment plan is not active");
  }
  if (input.patientPackageId) await assertPackageUsable(tx, input.patientPackageId, patient.id, slot.startAt);

  const appointment = await tx.appointment.create({
    data: {
      appointmentNo: await nextCode(tx, "appointment"),
      branchId: patient.branchId,
      patientId: patient.id,
      therapistId: slot.therapistId,
      slotId: slot.id,
      type: input.type,
      source: walkIn ? "WALK_IN" : "SCHEDULED",
      // A walk-in is already at the clinic, so they are checked in as they are booked.
      status: walkIn ? "CHECKED_IN" : "SCHEDULED",
      checkedInAt: walkIn ? new Date() : undefined,
      startAt: slot.startAt,
      endAt: slot.endAt,
      treatmentPlanId: input.treatmentPlanId,
      notes: input.notes,
      bookedById,
      rescheduledFromId: input.rescheduledFromId,
      history: {
        create: walkIn
          ? [
              { toStatus: "SCHEDULED", changedById: bookedById, note: "Walk-in booked" },
              { fromStatus: "SCHEDULED", toStatus: "CHECKED_IN", changedById: bookedById, note: "Walk-in: patient at the clinic" },
            ]
          : [{ toStatus: "SCHEDULED", changedById: bookedById, note: input.rescheduledFromId ? "Rescheduled" : "Booked" }],
      },
    },
  });
  await tx.therapistSlot.update({ where: { id: slot.id }, data: { status: "BOOKED" } });

  if (input.type === "THERAPY_SESSION") {
    const done = await tx.therapySession.count({ where: { treatmentPlanId: input.treatmentPlanId, status: { not: "CANCELLED" } } });
    await tx.therapySession.create({
      data: {
        appointmentId: appointment.id,
        patientId: patient.id,
        therapistId: slot.therapistId,
        treatmentPlanId: input.treatmentPlanId,
        patientPackageId: input.patientPackageId,
        sessionNumber: done + 1,
      },
    });
  }
  return appointment;
}

export async function book(input: BookInput, bookedById: string) {
  const appointment = await prisma.$transaction((tx) => bookInTx(tx, input, bookedById));
  await afterBooked(appointment.id);
  return appointment;
}

export async function afterBooked(appointmentId: string) {
  const a = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: { therapist: { include: { user: true } } } });
  const when = a.startAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  await notifyPatient(a.patientId, "APPOINTMENT_CONFIRMATION", "appointment_confirmation", { appointmentNo: a.appointmentNo, when, therapist: a.therapist.user.name });
  const settings = await prisma.hospitalSetting.findUnique({ where: { branchId: a.branchId } });
  const reminderAt = new Date(a.startAt.getTime() - (settings?.reminderHoursBefore ?? 24) * 3_600_000);
  if (reminderAt > new Date()) {
    await notifyPatient(a.patientId, "APPOINTMENT_REMINDER", "appointment_reminder", { appointmentNo: a.appointmentNo, when }, reminderAt);
  }
}

/**
 * Move an appointment's status with history, enforcing the transition table.
 * The row is locked first, so two concurrent requests (double tap, network retry) can't both
 * pass the status check: the second waits, then sees the new status and is refused.
 */
export async function transition(tx: Tx, appointmentId: string, to: AppointmentStatus, userId: string, note?: string, extra: Prisma.AppointmentUpdateInput = {}) {
  await tx.$queryRaw`SELECT "id" FROM "Appointment" WHERE "id" = ${appointmentId} FOR UPDATE`;
  const a = await tx.appointment.findUnique({ where: { id: appointmentId } });
  if (!a) throw notFound("Appointment");
  if (!TRANSITIONS[a.status].includes(to)) throw unprocessable("INVALID_STATUS", `Cannot change appointment from ${a.status} to ${to}`);
  return tx.appointment.update({
    where: { id: a.id },
    data: { ...extra, status: to, history: { create: { fromStatus: a.status, toStatus: to, changedById: userId, note } } },
  });
}

/** Cancel and release the slot. */
export async function cancel(appointmentId: string, userId: string, reason: string, opts: { enforceWindow: boolean }) {
  const updated = await prisma.$transaction(async (tx) => {
    const a = await tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    if (opts.enforceWindow) {
      const settings = await tx.hospitalSetting.findUnique({ where: { branchId: a.branchId } });
      const hours = settings?.cancellationHours ?? 4;
      if (a.startAt.getTime() - Date.now() < hours * 3_600_000) {
        throw unprocessable("CANCELLATION_WINDOW", `Appointments can only be cancelled online ${hours}+ hours in advance. Please call the clinic.`);
      }
    }
    const res = await transition(tx, a.id, "CANCELLED", userId, reason, { cancelReason: reason, cancelledAt: new Date(), slot: { disconnect: true } });
    if (a.slotId) await tx.therapistSlot.update({ where: { id: a.slotId }, data: { status: "AVAILABLE" } });
    await tx.therapySession.updateMany({ where: { appointmentId: a.id }, data: { status: "CANCELLED" } });
    await tx.homeVisit.updateMany({ where: { appointmentId: a.id }, data: { status: "CANCELLED" } });
    return res;
  });
  await prisma.notification.updateMany({
    where: { status: "QUEUED", type: "APPOINTMENT_REMINDER", payload: { path: ["appointmentNo"], equals: updated.appointmentNo } },
    data: { status: "FAILED", error: "Appointment cancelled" },
  });
  await notifyPatient(updated.patientId, "APPOINTMENT_CANCELLED", "appointment_cancelled", { appointmentNo: updated.appointmentNo });
  await offerToWaitlist(updated.therapistId, updated.startAt, updated.type);
  return updated;
}

/** Book the new slot and mark the old appointment RESCHEDULED, atomically. */
export async function reschedule(appointmentId: string, newSlotId: string, userId: string, reason?: string) {
  const fresh = await prisma.$transaction(async (tx) => {
    const old = await tx.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: { therapySession: true } });
    if (!["SCHEDULED", "CONFIRMED"].includes(old.status)) throw unprocessable("INVALID_STATUS", `Cannot reschedule a ${old.status} appointment`);
    await transition(tx, old.id, "RESCHEDULED", userId, reason, { slot: { disconnect: true } });
    if (old.slotId) await tx.therapistSlot.update({ where: { id: old.slotId }, data: { status: "AVAILABLE" } });
    await tx.therapySession.updateMany({ where: { appointmentId: old.id }, data: { status: "CANCELLED" } });
    const created = await bookInTx(
      tx,
      {
        patientId: old.patientId,
        slotId: newSlotId,
        type: old.type,
        treatmentPlanId: old.treatmentPlanId ?? undefined,
        patientPackageId: old.therapySession?.patientPackageId ?? undefined,
        notes: old.notes ?? undefined,
        rescheduledFromId: old.id,
      },
      userId,
    );
    const visit = await tx.homeVisit.findUnique({ where: { appointmentId: old.id } });
    if (visit) {
      await tx.homeVisit.update({ where: { id: visit.id }, data: { appointmentId: created.id, therapistId: created.therapistId } });
    }
    return created;
  });
  await notifyPatient(fresh.patientId, "APPOINTMENT_RESCHEDULED", "appointment_rescheduled", {
    appointmentNo: fresh.appointmentNo,
    when: fresh.startAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }),
  });
  return fresh;
}

/**
 * Permanently delete an appointment that holds no clinical or billing data
 * (e.g. booked by mistake, duplicate, cancelled, no-show). Frees the slot.
 * Completed visits, consultations, started sessions and billed appointments are medical/financial
 * records and are refused — cancel those instead.
 *
 * `record` receives a full snapshot (consultation + assessment, session + exercises, home visit,
 * status history) and runs inside the same transaction, so the audit copy is guaranteed to exist
 * if, and only if, the delete happens.
 */
export async function deleteAppointment(
  appointmentId: string,
  opts: { force: boolean; userId: string; record: (snapshot: unknown, tx: Tx) => Promise<void> },
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Appointment" WHERE "id" = ${appointmentId} FOR UPDATE`;
    const a = await tx.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        consultation: { include: { assessment: true } },
        therapySession: { include: { exercises: true } },
        homeVisit: true,
        history: { orderBy: { createdAt: "asc" } },
        invoiceItems: { select: { id: true } },
        rescheduledTo: { select: { id: true } },
      },
    });
    if (!a) throw notFound("Appointment");
    // Billing is never silently changed — the invoice must be cancelled first.
    if (a.invoiceItems.length) throw unprocessable("APPOINTMENT_BILLED", "This appointment is on an invoice. Cancel the invoice first.");

    if (!opts.force) {
      // Receptionists may only delete bookings that hold no clinical data.
      if (["COMPLETED", "IN_PROGRESS", "CHECKED_IN"].includes(a.status)) {
        throw unprocessable("APPOINTMENT_HAS_RECORDS", `A ${a.status.toLowerCase().replace("_", " ")} appointment holds clinical records. Ask an Admin to delete it.`);
      }
      if (a.consultation) throw unprocessable("APPOINTMENT_HAS_RECORDS", "This appointment has consultation notes. Ask an Admin to delete it.");
      if (a.therapySession && ["IN_PROGRESS", "COMPLETED"].includes(a.therapySession.status)) {
        throw unprocessable("APPOINTMENT_HAS_RECORDS", "This therapy session has treatment notes. Ask an Admin to delete it.");
      }
      if (a.homeVisit && ["CHECKED_IN", "COMPLETED"].includes(a.homeVisit.status)) {
        throw unprocessable("APPOINTMENT_HAS_RECORDS", "This home visit was already carried out. Ask an Admin to delete it.");
      }
    }

    // Unlink anything that points at this appointment, then remove it.
    if (a.rescheduledTo) await tx.appointment.update({ where: { id: a.rescheduledTo.id }, data: { rescheduledFromId: null } });
    if (a.consultation) {
      // Keep any treatment plan written from it; just detach. Assessment rows cascade.
      await tx.treatmentPlan.updateMany({ where: { consultationId: a.consultation.id }, data: { consultationId: null } });
      await tx.consultation.delete({ where: { id: a.consultation.id } });
    }
    if (a.therapySession) {
      // A completed session that used a package gets its session given back.
      const used = await tx.packageTransaction.findFirst({ where: { therapySessionId: a.therapySession.id, type: "SESSION_USED" } });
      if (used) {
        const pkg = await tx.patientPackage.findUniqueOrThrow({ where: { id: used.patientPackageId } });
        const remaining = pkg.remainingSessions + 1;
        await tx.patientPackage.update({
          where: { id: pkg.id },
          data: { remainingSessions: remaining, usedSessions: { decrement: 1 }, status: pkg.status === "EXHAUSTED" ? "ACTIVE" : pkg.status },
        });
        await tx.packageTransaction.create({
          data: { patientPackageId: pkg.id, type: "SESSION_RESTORED", sessionsDelta: 1, balanceAfter: remaining, performedById: opts.userId, note: `Appointment ${a.appointmentNo} deleted` },
        });
      }
      await tx.packageTransaction.updateMany({ where: { therapySessionId: a.therapySession.id }, data: { therapySessionId: null } });
      await tx.therapySession.delete({ where: { id: a.therapySession.id } });
    }
    if (a.homeVisit) await tx.homeVisit.delete({ where: { id: a.homeVisit.id } });
    await tx.appointment.delete({ where: { id: a.id } }); // history rows cascade
    // Free the slot only if it's still in the future
    if (a.slotId && a.startAt > new Date()) await tx.therapistSlot.update({ where: { id: a.slotId }, data: { status: "AVAILABLE" } });
    await tx.notification.updateMany({
      where: { status: "QUEUED", payload: { path: ["appointmentNo"], equals: a.appointmentNo } },
      data: { status: "FAILED", error: "Appointment deleted" },
    });
    await opts.record(a, tx);
    return { appointmentNo: a.appointmentNo, patientId: a.patientId, therapistId: a.therapistId, type: a.type, status: a.status, startAt: a.startAt };
  });
}

export interface AppointmentEdit {
  notes?: string | null;
  type?: AppointmentType;
  treatmentPlanId?: string | null;
}

/**
 * Edit appointment details. Notes can always be edited.
 * Type and treatment plan can only change before the visit starts (SCHEDULED / CONFIRMED).
 * Date, time and physiotherapist are changed with Reschedule.
 */
export async function editAppointment(appointmentId: string, edit: AppointmentEdit, userId: string) {
  return prisma.$transaction(async (tx) => {
    const a = await tx.appointment.findUnique({ where: { id: appointmentId }, include: { therapySession: true, homeVisit: true, consultation: true } });
    if (!a) throw notFound("Appointment");
    const open = a.status === "SCHEDULED" || a.status === "CONFIRMED";
    const type = edit.type ?? a.type;
    const planId = edit.treatmentPlanId === undefined ? a.treatmentPlanId : edit.treatmentPlanId;
    const changesBooking = type !== a.type || planId !== a.treatmentPlanId;

    if (changesBooking) {
      if (!open) throw unprocessable("APPOINTMENT_STARTED", "Type and treatment plan can only be changed before the visit starts.");
      if ((type === "HOME_VISIT") !== (a.type === "HOME_VISIT")) throw unprocessable("TYPE_CHANGE", "Home visits can't be switched to clinic visits (or back). Delete and book again.");
      if (a.consultation) throw unprocessable("TYPE_CHANGE", "This appointment already has consultation notes.");
      if (type === "THERAPY_SESSION" && !planId) throw badRequest("A therapy session needs a treatment plan");
      if (planId) {
        const plan = await tx.treatmentPlan.findUnique({ where: { id: planId } });
        if (!plan || plan.patientId !== a.patientId) throw notFound("Treatment plan");
        if (plan.status !== "ACTIVE") throw unprocessable("PLAN_NOT_ACTIVE", "Treatment plan is not active");
      }

      // Keep the linked therapy-session record in step with the type
      if (type === "THERAPY_SESSION" && !a.therapySession) {
        const done = await tx.therapySession.count({ where: { treatmentPlanId: planId, status: { not: "CANCELLED" } } });
        await tx.therapySession.create({ data: { appointmentId: a.id, patientId: a.patientId, therapistId: a.therapistId, treatmentPlanId: planId, sessionNumber: done + 1 } });
      } else if (type === "THERAPY_SESSION" && a.therapySession && planId !== a.therapySession.treatmentPlanId) {
        await tx.therapySession.update({ where: { id: a.therapySession.id }, data: { treatmentPlanId: planId } });
      } else if (type !== "THERAPY_SESSION" && a.therapySession && a.type === "THERAPY_SESSION") {
        await tx.therapySession.delete({ where: { id: a.therapySession.id } });
      }
    }

    return tx.appointment.update({
      where: { id: a.id },
      data: {
        notes: edit.notes === undefined ? undefined : edit.notes || null,
        type,
        treatmentPlanId: planId,
        ...(changesBooking
          ? { history: { create: { fromStatus: a.status, toStatus: a.status, changedById: userId, note: `Edited: ${type !== a.type ? `type ${a.type} → ${type}` : "treatment plan changed"}` } } }
          : {}),
      },
    });
  });
}

async function offerToWaitlist(therapistId: string, startAt: Date, type: AppointmentType) {
  const date = new Date(`${localDateString(startAt)}T00:00:00Z`);
  const entries = await prisma.waitlist.findMany({
    where: { isFulfilled: false, preferredDate: date, type, OR: [{ therapistId }, { therapistId: null }] },
    orderBy: { createdAt: "asc" },
    take: 3,
  });
  for (const w of entries) {
    await notifyPatient(w.patientId, "APPOINTMENT_RESCHEDULED", "waitlist_slot_open", {
      when: startAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }),
    });
  }
}
