import express, { Router } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { prisma } from "@movement-hub/database";
import { env } from "./config/env.js";
import { authenticate } from "./middleware/auth.js";
import { errorHandler, notFoundRoute } from "./middleware/error.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { userRouter } from "./modules/users/user.routes.js";
import { patientRouter } from "./modules/patients/patient.routes.js";
import { slotRouter, specializationRouter, therapistRouter } from "./modules/therapists/therapist.routes.js";
import { availabilityRouter, calendarRouter } from "./modules/scheduling/scheduling.routes.js";
import { appointmentRouter, waitlistRouter } from "./modules/appointments/appointment.routes.js";
import { consultationRouter } from "./modules/consultations/consultation.routes.js";
import { treatmentPlanRouter } from "./modules/treatment-plans/treatment-plan.routes.js";
import { packageRouter, patientPackageRouter } from "./modules/packages/package.routes.js";
import { therapySessionRouter } from "./modules/therapy-sessions/therapy-session.routes.js";
import { homeVisitRouter } from "./modules/home-visits/home-visit.routes.js";
import { invoiceRouter } from "./modules/billing/invoice.routes.js";
import { paymentRouter, razorpayWebhookRouter, refundRouter } from "./modules/payments/payment.routes.js";
import { notificationRouter, whatsappWebhookRouter } from "./modules/notifications/notification.routes.js";
import { documentRouter } from "./modules/documents/document.routes.js";
import { reportRouter } from "./modules/reports/report.routes.js";
import { auditRouter, branchRouter, settingsRouter } from "./modules/settings/settings.routes.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);

  const allowedOrigins = env.CORS_ORIGINS.split(",").map((o) => o.trim());
  const corsMiddleware = cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return callback(null, true);
      try {
        const parsed = new URL(origin);
        if (parsed.hostname.endsWith(".vercel.app") || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
          return callback(null, true);
        }
      } catch {}
      return callback(null, false);
    },
    credentials: true,
  });

  app.use(corsMiddleware);
  app.options("*", corsMiddleware);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  // Webhooks need the raw body for signature verification — mount before JSON parser.
  app.use("/api/v1/payments/razorpay/webhook", razorpayWebhookRouter);

  app.use(express.json({ limit: "1mb" }));
  app.use("/api/", rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));

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
  v1.use("/settings", settingsRouter);
  v1.use("/branches", branchRouter);
  v1.use("/audit-logs", auditRouter);

  app.use("/api/v1", v1);
  app.use(notFoundRoute);
  app.use(errorHandler);
  return app;
}
