-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "therapistId" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_therapistId_status_idx" ON "Invoice"("therapistId", "status");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "Therapist"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Link existing invoices to a physiotherapist, most specific source first:
-- 1. the physio who did the visit billed on the invoice (latest visit if several)
UPDATE "Invoice" i SET "therapistId" = s."therapistId"
FROM (
  SELECT DISTINCT ON (ii."invoiceId") ii."invoiceId", a."therapistId"
  FROM "InvoiceItem" ii JOIN "Appointment" a ON a."id" = ii."appointmentId"
  ORDER BY ii."invoiceId", a."startAt" DESC
) s
WHERE i."id" = s."invoiceId" AND i."therapistId" IS NULL;

-- 2. the physio of the treatment plan a billed package belongs to
UPDATE "Invoice" i SET "therapistId" = s."therapistId"
FROM (
  SELECT DISTINCT ON (ii."invoiceId") ii."invoiceId", tp."therapistId"
  FROM "InvoiceItem" ii
  JOIN "PatientPackage" pp ON pp."id" = ii."patientPackageId"
  JOIN "TreatmentPlan" tp ON tp."id" = pp."treatmentPlanId"
  ORDER BY ii."invoiceId", tp."createdAt" DESC
) s
WHERE i."id" = s."invoiceId" AND i."therapistId" IS NULL;

-- 3. the physio who created it, if they are a physio
UPDATE "Invoice" i SET "therapistId" = t."id"
FROM "Therapist" t
WHERE t."userId" = i."createdById" AND i."therapistId" IS NULL;

-- 4. the patient's regular physio
UPDATE "Invoice" i SET "therapistId" = p."primaryTherapistId"
FROM "Patient" p
WHERE p."id" = i."patientId" AND p."primaryTherapistId" IS NOT NULL AND i."therapistId" IS NULL;
