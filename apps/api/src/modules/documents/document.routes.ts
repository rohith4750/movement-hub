import { Router } from "express";
import crypto from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import { prisma } from "@movement-hub/database";
import { env } from "../../config/env.js";
import { created, handler, idParam, ok } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import { unprocessable } from "../../lib/http-error.js";
import { assertPatientAccess, authorize } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";

export const documentRouter = Router();

const s3 = env.STORAGE_BUCKET
  ? new S3Client({
      region: env.STORAGE_REGION,
      endpoint: env.STORAGE_ENDPOINT || undefined,
      forcePathStyle: Boolean(env.STORAGE_ENDPOINT),
      credentials: { accessKeyId: env.STORAGE_ACCESS_KEY, secretAccessKey: env.STORAGE_SECRET_KEY },
    })
  : null;

function storage() {
  if (!s3) throw unprocessable("STORAGE_DISABLED", "Document storage is not configured");
  return s3;
}

const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp", "application/dicom"];
const MAX_BYTES = 25 * 1024 * 1024;
const category = z.enum(["X_RAY", "MRI", "CT", "PRESCRIPTION", "REPORT", "CONSENT", "OTHER"]);
const roles = ["PHYSIOTHERAPIST", "ADMIN", "RECEPTIONIST", "PATIENT"] as const;

/** Step 1: get a short-lived signed URL; the browser uploads straight to the private bucket. */
documentRouter.post(
  "/upload-url",
  authorize(...roles),
  validate({ body: z.object({ patientId: z.string().uuid(), fileName: z.string().min(1).max(200), mimeType: z.string(), sizeBytes: z.number().int().positive() }) }),
  handler(async (req, res) => {
    assertPatientAccess(req, req.body.patientId);
    if (!ALLOWED.includes(req.body.mimeType)) throw unprocessable("FILE_TYPE", "Only PDF, JPEG, PNG, WEBP and DICOM files are allowed");
    if (req.body.sizeBytes > MAX_BYTES) throw unprocessable("FILE_TOO_LARGE", "Maximum file size is 25 MB");
    const ext = req.body.fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "bin";
    const fileKey = `patients/${req.body.patientId}/${crypto.randomUUID()}.${ext}`;
    const uploadUrl = await getSignedUrl(
      storage(),
      new PutObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: fileKey, ContentType: req.body.mimeType, ContentLength: req.body.sizeBytes }),
      { expiresIn: 300 },
    );
    ok(res, { uploadUrl, fileKey, expiresInSeconds: 300 });
  }),
);

/** Step 2: save metadata once upload finishes. */
documentRouter.post(
  "/",
  authorize(...roles),
  validate({
    body: z.object({
      patientId: z.string().uuid(),
      title: z.string().min(2),
      category,
      fileKey: z.string().startsWith("patients/"),
      mimeType: z.string(),
      sizeBytes: z.number().int().positive(),
    }),
  }),
  handler(async (req, res) => {
    assertPatientAccess(req, req.body.patientId);
    if (!req.body.fileKey.startsWith(`patients/${req.body.patientId}/`)) throw unprocessable("INVALID_KEY", "File key does not belong to this patient");
    const doc = await prisma.patientDocument.create({ data: { ...req.body, uploadedById: req.user!.id } });
    await audit(req, "CREATE", "PatientDocument", doc.id, null, doc);
    created(res, doc);
  }),
);

documentRouter.get(
  "/:id/download",
  authorize(...roles),
  validate({ params: idParam }),
  handler(async (req, res) => {
    const doc = await prisma.patientDocument.findFirstOrThrow({ where: { id: req.params.id, deletedAt: null } });
    assertPatientAccess(req, doc.patientId);
    const url = await getSignedUrl(storage(), new GetObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: doc.fileKey }), { expiresIn: 120 });
    await audit(req, "UPDATE", "PatientDocument", doc.id, null, { action: "download" });
    ok(res, { url, expiresInSeconds: 120 });
  }),
);

documentRouter.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: idParam }),
  handler(async (req, res) => {
    const doc = await prisma.patientDocument.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    await audit(req, "DELETE", "PatientDocument", doc.id);
    ok(res, { deleted: true });
  }),
);
