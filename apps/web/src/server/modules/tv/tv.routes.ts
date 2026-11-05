import { Router } from "../../router";
import { prisma } from "@movement-hub/database";
import { dayRange, localTimeString, todayLocal } from "../../lib/time";
import { notFound, unauthorized } from "../../lib/http-error";
import { generateSlots } from "../scheduling/scheduling.service";

export const tvRouter = Router();

function formatPrivacyName(firstName: string, lastName?: string | null): string {
  const f = firstName.trim();
  const l = lastName?.trim();
  if (!l) return f;
  return `${f} ${l[0].toUpperCase()}.`;
}

/**
 * 1. Public Waiting-Room Board API
 * Strictly privacy-safe. Returns:
 * - How many physiotherapists are on duty & who is currently free
 * - Free bookable/walk-in slots for each physiotherapist today
 * - Now in Session & Next Up queue (for clinics displaying patient flow)
 * - Rotating clinic announcement slides & QR code
 */
tvRouter.get("/board", async (req, res, next) => {
  try {
    const branchId = req.query.branchId as string | undefined;
    const branch = branchId
      ? await prisma.branch.findUnique({ where: { id: branchId }, include: { settings: true } })
      : await prisma.branch.findFirst({ where: { isActive: true }, include: { settings: true } });

    if (!branch) throw notFound("Branch not found");

    const today = todayLocal();
    const range = dayRange(today);
    const now = new Date();

    // 1. Fetch active therapists with specializations, leave, and slots
    const therapists = await prisma.therapist.findMany({
      where: { branchId: branch.id, isActive: true },
      include: {
        user: { select: { name: true } },
        specializations: { include: { specialization: { select: { name: true } } } },
        leaves: {
          where: {
            status: "APPROVED",
            startDate: { lte: range.lt },
            endDate: { gte: range.gte },
          },
        },
        slots: {
          where: {
            startAt: { gte: range.gte, lt: range.lt },
            status: "AVAILABLE",
          },
          orderBy: { startAt: "asc" },
        },
      },
    });

    // Auto-generate today's slots if none exist yet for these therapists
    const totalExistingSlots = await prisma.therapistSlot.count({
      where: { startAt: range, therapistId: { in: therapists.map((t) => t.id) } },
    });
    if (totalExistingSlots === 0 && therapists.length > 0) {
      await Promise.all(therapists.map((t) => generateSlots(t.id, today, today).catch(() => null)));
      const refreshedSlots = await prisma.therapistSlot.findMany({
        where: {
          startAt: { gte: range.gte, lt: range.lt },
          status: "AVAILABLE",
          therapistId: { in: therapists.map((t) => t.id) },
        },
        orderBy: { startAt: "asc" },
      });
      for (const t of therapists) {
        t.slots = refreshedSlots.filter((s) => s.therapistId === t.id);
      }
    }

    // 2. Fetch today's live & upcoming appointments
    const appointments = await prisma.appointment.findMany({
      where: {
        branchId: branch.id,
        startAt: { gte: range.gte, lt: range.lt },
        status: { in: ["IN_PROGRESS", "CHECKED_IN", "CONFIRMED", "SCHEDULED"] },
      },
      orderBy: { startAt: "asc" },
      include: {
        patient: { select: { firstName: true, lastName: true, patientCode: true } },
        therapist: { select: { id: true, colorTag: true, user: { select: { name: true } } } },
        therapySession: { select: { sessionNumber: true } },
      },
    });

    // ── NOW IN SESSION (IN_PROGRESS) ──
    const inProgress = appointments.filter((a) => a.status === "IN_PROGRESS");
    const nowInSession = inProgress.map((a) => ({
      id: a.id,
      appointmentNo: a.appointmentNo,
      patientName: formatPrivacyName(a.patient.firstName, a.patient.lastName),
      therapistId: a.therapist.id,
      therapistName: a.therapist.user.name,
      colorTag: a.therapist.colorTag ?? "#1e3a8a",
      time: localTimeString(a.startAt),
      type: a.type,
      roomOrBay: a.roomOrBay ?? (a.type === "INITIAL_CONSULTATION" ? "Cabin" : "Bay"),
      sessionNumber: a.therapySession?.sessionNumber ?? null,
    }));

    // ── THERAPIST AVAILABILITY & FREE SLOTS ──
    const physioStatusList = therapists.map((t) => {
      const isOnLeave = t.leaves.length > 0;
      const currentAppt = inProgress.find((a) => a.therapist.id === t.id);
      const isFreeNow = !isOnLeave && !currentAppt;

      // Free slots for today that are still in the future or ongoing
      const upcomingFreeSlots = t.slots
        .filter((s) => s.endAt > now)
        .map((s) => ({
          id: s.id,
          time: localTimeString(s.startAt),
          startAt: s.startAt.toISOString(),
        }));

      // Next scheduled appointment
      const nextAppt = appointments.find(
        (a) => a.therapist.id === t.id && a.status !== "IN_PROGRESS" && a.startAt > now
      );

      const specs = t.specializations.map((s) => s.specialization.name);

      return {
        id: t.id,
        name: t.user.name,
        qualification: t.qualification,
        experienceYears: t.experienceYears,
        specializations: specs,
        colorTag: t.colorTag ?? "#059669",
        isOnLeave,
        isFreeNow,
        statusText: isOnLeave ? "ON LEAVE" : isFreeNow ? "FREE NOW" : "IN SESSION",
        currentSession: currentAppt
          ? {
              roomOrBay: currentAppt.roomOrBay ?? (currentAppt.type === "INITIAL_CONSULTATION" ? "Cabin" : "Bay"),
              endsAt: localTimeString(currentAppt.endAt),
            }
          : null,
        nextAppointmentTime: nextAppt ? localTimeString(nextAppt.startAt) : null,
        freeSlotsCount: upcomingFreeSlots.length,
        freeSlots: upcomingFreeSlots.map((s) => s.time),
      };
    });

    const summary = {
      totalPhysios: physioStatusList.length,
      freeNowCount: physioStatusList.filter((p) => p.isFreeNow).length,
      inSessionCount: physioStatusList.filter((p) => !p.isFreeNow && !p.isOnLeave).length,
      onLeaveCount: physioStatusList.filter((p) => p.isOnLeave).length,
      totalFreeSlots: physioStatusList.reduce((acc, p) => acc + p.freeSlotsCount, 0),
    };

    // ── NEXT UP (CHECKED_IN first, then SCHEDULED/CONFIRMED) ──
    const waiting = appointments.filter((a) => a.status !== "IN_PROGRESS");
    waiting.sort((x, y) => {
      if (x.status === "CHECKED_IN" && y.status !== "CHECKED_IN") return -1;
      if (y.status === "CHECKED_IN" && x.status !== "CHECKED_IN") return 1;
      return x.startAt.getTime() - y.startAt.getTime();
    });

    const nextUp = waiting.slice(0, 10).map((a, idx) => ({
      id: a.id,
      appointmentNo: a.appointmentNo,
      patientName: formatPrivacyName(a.patient.firstName, a.patient.lastName),
      therapistName: a.therapist.user.name,
      colorTag: a.therapist.colorTag ?? "#1e3a8a",
      time: localTimeString(a.startAt),
      status: a.status,
      type: a.type,
      queueNo: idx + 1,
    }));

    const settings = branch.settings;
    const defaultSlides = [
      {
        id: "timings",
        tag: "CLINIC SCHEDULE",
        title: `${branch.name}`,
        body: `Monday – Saturday: ${settings?.openingTime ?? "08:00"} – ${settings?.closingTime ?? "20:00"}\nSunday: By prior booking`,
        subtitle: `Helpline: ${branch.phone ?? "+91 98765 43210"}`,
      },
      {
        id: "tip-neck",
        tag: "EXERCISE & ERGONOMICS",
        title: "Posture Tip: Screen Level",
        body: "Position displays directly at eye level. Every 45 minutes, perform 5 gentle chin tucks and scapular retractions to reduce neck strain.",
        subtitle: "Movement Hub Clinical Advice",
      },
      {
        id: "packages",
        tag: "REHAB PACKAGES",
        title: "Save on Long-Term Recovery",
        body: "Ask reception about 6 & 12 session rehab plans. Includes guided manual therapy, modalities (IFT / Traction), and supervised exercise.",
        subtitle: "Inquire at the front desk",
      },
      {
        id: "qr",
        tag: "PATIENT FEEDBACK",
        title: "Share Your Experience",
        body: "We strive to give you the highest standard of physical care. Scan to leave a quick Google review or message our desk on WhatsApp.",
        qrUrl: settings?.tvQrUrl ?? "https://g.page/r/movement-hub/review",
        qrLabel: settings?.tvQrLabel ?? "Scan for Google Review",
      },
    ];

    const slides = (settings?.tvSlides as unknown as typeof defaultSlides) || defaultSlides;

    res.json({
      success: true,
      data: {
        clinic: {
          id: branch.id,
          name: branch.name,
          code: branch.code,
          phone: branch.phone,
          openingTime: settings?.openingTime ?? "08:00",
          closingTime: settings?.closingTime ?? "20:00",
        },
        summary,
        therapists: physioStatusList,
        nowInSession,
        nextUp,
        slides,
        serverTime: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. Staff Wall for Back Office
 * Internal operational overview: all physios, timeline, walk-in stats, and physio loads.
 */
tvRouter.get("/staff", async (req, res, next) => {
  try {
    const branchId = req.query.branchId as string | undefined;
    const key = req.query.key as string | undefined;

    const branch = branchId
      ? await prisma.branch.findUnique({ where: { id: branchId }, include: { settings: true } })
      : await prisma.branch.findFirst({ where: { isActive: true }, include: { settings: true } });

    if (!branch) throw notFound("Branch not found");

    const staffKey = branch.settings?.tvStaffKey ?? "staff-wall-access";
    const authHeader = req.get("authorization");
    if (!authHeader && key !== staffKey) {
      throw unauthorized("Access denied. Provide ?key=... or sign in with staff account.");
    }

    const today = todayLocal();
    const range = dayRange(today);

    const therapists = await prisma.therapist.findMany({
      where: { branchId: branch.id, isActive: true },
      include: {
        user: { select: { name: true } },
        appointments: {
          where: { startAt: { gte: range.gte, lt: range.lt } },
          orderBy: { startAt: "asc" },
          include: {
            patient: { select: { firstName: true, lastName: true, patientCode: true } },
            treatmentPlan: { select: { title: true } },
          },
        },
      },
    });

    const allToday = therapists.flatMap((t) => t.appointments);
    const checkedInCount = allToday.filter((a) => a.status === "CHECKED_IN").length;
    const inProgressCount = allToday.filter((a) => a.status === "IN_PROGRESS").length;
    const completedCount = allToday.filter((a) => a.status === "COMPLETED").length;
    const walkInCount = allToday.filter((a) => a.source === "WALK_IN").length;
    const totalCount = allToday.length;

    const columns = therapists.map((t) => ({
      id: t.id,
      name: t.user.name,
      colorTag: t.colorTag ?? "#1e3a8a",
      appointmentCount: t.appointments.length,
      appointments: t.appointments.map((a) => ({
        id: a.id,
        appointmentNo: a.appointmentNo,
        patientName: `${a.patient.firstName} ${a.patient.lastName ?? ""}`.trim(),
        patientCode: a.patient.patientCode,
        status: a.status,
        source: a.source,
        type: a.type,
        time: localTimeString(a.startAt),
        planTitle: a.treatmentPlan?.title ?? null,
      })),
    }));

    res.json({
      success: true,
      data: {
        clinic: { name: branch.name, code: branch.code },
        stats: {
          total: totalCount,
          checkedIn: checkedInCount,
          inProgress: inProgressCount,
          completed: completedCount,
          walkIns: walkInCount,
        },
        columns,
        serverTime: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 3. Quick Call Trigger (Staff Action)
 * Used by a physio or receptionist to flash-call a patient to their bay/cabin.
 */
tvRouter.post("/call", async (req, res, next) => {
  try {
    const { appointmentId, roomOrBay } = req.body;
    if (!appointmentId) throw notFound("appointmentId required");

    const appt = await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: "IN_PROGRESS",
        roomOrBay: roomOrBay || undefined,
        updatedAt: new Date(),
      },
      include: {
        patient: { select: { firstName: true, lastName: true } },
        therapist: { select: { user: { select: { name: true } } } },
      },
    });

    res.json({
      success: true,
      data: {
        called: true,
        patientName: formatPrivacyName(appt.patient.firstName, appt.patient.lastName),
        therapistName: appt.therapist.user.name,
        roomOrBay: appt.roomOrBay,
      },
    });
  } catch (err) {
    next(err);
  }
});

