import { Router } from "../../router";
import { z } from "zod";
import { prisma, type HomeVisitStatus, type Prisma } from "@movement-hub/database";
import { created, handler, idParam, meta, ok, paginationQuery, paging, q } from "../../lib/http";
import { audit } from "../../lib/audit";
import { badRequest, forbidden, unprocessable } from "../../lib/http-error";
import { dayRange } from "../../lib/time";
import { assertPatientAccess, authorize, scopePatient } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { afterBooked, bookInTx, transition } from "../appointments/appointment.service";

export const homeVisitRouter = Router();

const include = {
  patient: { select: { id: true, patientCode: true, firstName: true, lastName: true, phone: true } },
  therapist: { select: { id: true, user: { select: { name: true, phone: true } } } },
  address: true,
  appointment: { select: { id: true, appointmentNo: true, startAt: true, endAt: true, status: true } },
} satisfies Prisma.HomeVisitInclude;

const listQuery = paginationQuery.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  therapistId: z.string().uuid().optional(),
  status: z.enum(["SCHEDULED", "EN_ROUTE", "CHECKED_IN", "COMPLETED", "CANCELLED"]).optional(),
});

homeVisitRouter.get(
  "/",
  authorize("RECEPTIONIST", "ADMIN", "PHYSIOTHERAPIST"),
  validate({ query: listQuery }),
  handler(async (req, res) => {
    const query = q<z.infer<typeof listQuery>>(req);
    // Physios also run the front desk, so they see every visit (filter with ?therapistId=… for "mine").
    const therapistId = query.therapistId;
    const where: Prisma.HomeVisitWhereInput = {
      therapistId,
      status: query.status,
      ...(query.date ? { appointment: { startAt: dayRange(query.date) } } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.homeVisit.findMany({ where, include, ...paging(query), orderBy: { appointment: { startAt: "asc" } } }),
      prisma.homeVisit.count({ where }),
    ]);
    ok(res, data, meta(query, total));
  }),
);

homeVisitRouter.post(
  "/",
  authorize("RECEPTIONIST", "ADMIN", "PATIENT"),
  validate({
    body: z.object({
      patientId: z.string().uuid().optional(),
      slotId: z.string().uuid(),
      addressId: z.string().uuid(),
      treatmentPlanId: z.string().uuid().optional(),
      patientPackageId: z.string().uuid().optional(),
      distanceKm: z.number().nonnegative().optional(),
      notes: z.string().optional(),
    }),
  }),
  handler(async (req, res) => {
    const patientId = scopePatient(req, req.body.patientId);
    if (!patientId) throw badRequest("patientId is required");
    const visit = await prisma.$transaction(async (tx) => {
      const address = await tx.patientAddress.findUniqueOrThrow({ where: { id: req.body.addressId } });
      if (address.patientId !== patientId) throw badRequest("Address belongs to another patient");
      const slot = await tx.therapistSlot.findUniqueOrThrow({ where: { id: req.body.slotId }, include: { therapist: true } });
      if (!slot.therapist.isAvailableForHomeVisit) throw unprocessable("NO_HOME_VISITS", "This physiotherapist does not do home visits");
      const appt = await bookInTx(
        tx,
        { patientId, slotId: req.body.slotId, type: "HOME_VISIT", treatmentPlanId: req.body.treatmentPlanId, patientPackageId: req.body.patientPackageId, notes: req.body.notes },
        req.user!.id,
      );
      const settings = await tx.hospitalSetting.findUnique({ where: { branchId: appt.branchId } });
      const travelCharge = req.body.distanceKm && settings ? settings.travelChargePerKm.mul(req.body.distanceKm).toDecimalPlaces(2) : 0;
      if (req.body.treatmentPlanId) {
        await tx.therapySession.create({
          data: { appointmentId: appt.id, patientId, therapistId: appt.therapistId, treatmentPlanId: req.body.treatmentPlanId, patientPackageId: req.body.patientPackageId },
        });
      }
      return tx.homeVisit.create({
        data: { appointmentId: appt.id, patientId, therapistId: appt.therapistId, addressId: address.id, distanceKm: req.body.distanceKm, travelCharge, notes: req.body.notes },
        include,
      });
    });
    await afterBooked(visit.appointmentId);
    await audit(req, "CREATE", "HomeVisit", visit.id, null, visit);
    created(res, visit);
  }),
);

homeVisitRouter.get(
  "/:id",
  validate({ params: idParam }),
  handler(async (req, res) => {
    const v = await prisma.homeVisit.findUniqueOrThrow({ where: { id: req.params.id }, include });
    assertPatientAccess(req, v.patientId);
    ok(res, v);
  }),
);

homeVisitRouter.patch(
  "/:id",
  authorize("RECEPTIONIST", "ADMIN"),
  validate({ params: idParam, body: z.object({ distanceKm: z.number().nonnegative().optional(), travelCharge: z.number().nonnegative().optional(), notes: z.string().optional() }) }),
  handler(async (req, res) => {
    const v = await prisma.homeVisit.update({ where: { id: req.params.id }, data: req.body, include });
    await audit(req, "UPDATE", "HomeVisit", v.id, null, req.body);
    ok(res, v);
  }),
);

const NEXT: Record<string, { from: HomeVisitStatus[]; to: HomeVisitStatus }> = {
  "en-route": { from: ["SCHEDULED"], to: "EN_ROUTE" },
  "check-in": { from: ["SCHEDULED", "EN_ROUTE"], to: "CHECKED_IN" },
  "check-out": { from: ["CHECKED_IN"], to: "COMPLETED" },
};

for (const [path, rule] of Object.entries(NEXT)) {
  homeVisitRouter.post(
    `/:id/${path}`,
    authorize("PHYSIOTHERAPIST"),
    validate({ params: idParam, body: z.object({ latitude: z.number().optional(), longitude: z.number().optional(), notes: z.string().optional() }).default({}) }),
    handler(async (req, res) => {
      const v = await prisma.homeVisit.findUniqueOrThrow({ where: { id: req.params.id } });
      if (req.user!.therapistId !== v.therapistId) throw forbidden("This visit is assigned to another physiotherapist");
      if (!rule.from.includes(v.status)) throw unprocessable("INVALID_STATUS", `Visit is ${v.status}`);
      const updated = await prisma.$transaction(async (tx) => {
        const appt = await tx.appointment.findUniqueOrThrow({ where: { id: v.appointmentId } });
        if (rule.to === "CHECKED_IN" && ["SCHEDULED", "CONFIRMED"].includes(appt.status)) {
          await transition(tx, appt.id, "CHECKED_IN", req.user!.id, "Therapist checked in at patient home", { checkedInAt: new Date() });
        }
        if (rule.to === "COMPLETED") {
          if (appt.status === "CHECKED_IN") await transition(tx, appt.id, "IN_PROGRESS", req.user!.id);
          await transition(tx, appt.id, "COMPLETED", req.user!.id, "Home visit completed", { completedAt: new Date() });
        }
        return tx.homeVisit.update({
          where: { id: v.id },
          data: {
            status: rule.to,
            notes: req.body.notes ?? undefined,
            ...(rule.to === "CHECKED_IN" ? { checkInAt: new Date(), checkInLat: req.body.latitude, checkInLng: req.body.longitude } : {}),
            ...(rule.to === "COMPLETED" ? { checkOutAt: new Date() } : {}),
          },
          include,
        });
      });
      ok(res, updated);
    }),
  );
}
