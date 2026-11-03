import { prisma } from "@movement-hub/database";
import { env } from "./config/env";
import { authenticate } from "./middleware/auth";
import { errorHandler, notFoundRoute } from "./middleware/error";
import { Router, createHandler, rateLimit } from "./router";
import { jobs, type JobName } from "./jobs/scheduler";
import { authRouter } from "./modules/auth/auth.routes";
import { userRouter } from "./modules/users/user.routes";
import { patientRouter } from "./modules/patients/patient.routes";
import { slotRouter, specializationRouter, therapistRouter } from "./modules/therapists/therapist.routes";
import { availabilityRouter, calendarRouter } from "./modules/scheduling/scheduling.routes";
import { appointmentRouter, waitlistRouter } from "./modules/appointments/appointment.routes";
import { consultationRouter } from "./modules/consultations/consultation.routes";
import { treatmentPlanRouter } from "./modules/treatment-plans/treatment-plan.routes";
import { packageRouter, patientPackageRouter } from "./modules/packages/package.routes";
import { therapySessionRouter } from "./modules/therapy-sessions/therapy-session.routes";
import { homeVisitRouter } from "./modules/home-visits/home-visit.routes";
import { invoiceRouter } from "./modules/billing/invoice.routes";
import { paymentRouter, razorpayWebhookRouter, refundRouter } from "./modules/payments/payment.routes";
import { notificationRouter, whatsappWebhookRouter } from "./modules/notifications/notification.routes";
import { documentRouter } from "./modules/documents/document.routes";
import { reportRouter } from "./modules/reports/report.routes";
import { plannerRouter } from "./modules/planner/planner.routes";
import { auditRouter, branchRouter, settingsRouter } from "./modules/settings/settings.routes";
import { unauthorized, notFound } from "./lib/http-error";

/** Builds the /api/v1 route tree and returns a Node (req, res) handler for the Next.js API route. */
export function createApiHandler() {
  const root = Router();

  // Webhooks verify signatures against the raw body — registered before the rate limiter.
  root.use("/api/v1/payments/razorpay/webhook", razorpayWebhookRouter);
  root.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true }));

  const v1 = Router();

  // Public
  v1.get("/health", async (_req, res) => {
    let db = "up";
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      db = "down";
    }
    res.status(db === "up" ? 200 : 503).json({ success: db === "up", data: { api: "up", database: db, time: new Date().toISOString() } });
  });

  // Background jobs, triggered by Vercel Cron (sends "Authorization: Bearer $CRON_SECRET").
  v1.get("/cron/:job", async (req, res, next) => {
    try {
      if (!env.CRON_SECRET || req.get("authorization") !== `Bearer ${env.CRON_SECRET}`) throw unauthorized("Invalid cron secret");
      const job = jobs[req.params.job as JobName];
      if (!job) throw notFound("Job");
      const started = Date.now();
      await job();
      res.json({ success: true, data: { job: req.params.job, ms: Date.now() - started } });
    } catch (e) {
      next(e);
    }
  });

  v1.use("/auth", authRouter);
  v1.use("/notifications/whatsapp/webhook", whatsappWebhookRouter);

  // Authenticated
  v1.use(authenticate);
  v1.use("/users", userRouter);
  v1.use("/patients", patientRouter);
  v1.use("/therapists", therapistRouter);
  v1.use("/specializations", specializationRouter);
  v1.use("/slots", slotRouter);
  v1.use("/availability", availabilityRouter);
  v1.use("/calendar", calendarRouter);
  v1.use("/appointments", appointmentRouter);
  v1.use("/waitlist", waitlistRouter);
  v1.use("/consultations", consultationRouter);
  v1.use("/treatment-plans", treatmentPlanRouter);
  v1.use("/packages", packageRouter);
  v1.use("/patient-packages", patientPackageRouter);
  v1.use("/therapy-sessions", therapySessionRouter);
  v1.use("/home-visits", homeVisitRouter);
  v1.use("/invoices", invoiceRouter);
  v1.use("/payments", paymentRouter);
  v1.use("/refunds", refundRouter);
  v1.use("/notifications", notificationRouter);
  v1.use("/documents", documentRouter);
  v1.use("/reports", reportRouter);
  v1.use("/planner", plannerRouter);
  v1.use("/settings", settingsRouter);
  v1.use("/branches", branchRouter);
  v1.use("/audit-logs", auditRouter);

  root.use("/api/v1", v1);

  return createHandler(root, {
    corsOrigins: env.CORS_ORIGINS.split(",").map((o) => o.trim()),
    onError: errorHandler,
    notFound: notFoundRoute,
  });
}
