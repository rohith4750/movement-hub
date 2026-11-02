-- CreateEnum
CREATE TYPE "ProgressStatus" AS ENUM ('IMPROVED', 'SAME', 'WORSE');

-- AlterTable
ALTER TABLE "ClinicalAssessment" ADD COLUMN     "diagnosis" TEXT;

-- AlterTable
ALTER TABLE "Consultation" ALTER COLUMN "chiefComplaint" DROP NOT NULL;

-- CreateTable
CREATE TABLE "TreatmentProgress" (
    "id" TEXT NOT NULL,
    "treatmentPlanId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "painScore" INTEGER,
    "status" "ProgressStatus",
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreatmentProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TreatmentProgress_treatmentPlanId_date_key" ON "TreatmentProgress"("treatmentPlanId", "date");

-- AddForeignKey
ALTER TABLE "TreatmentProgress" ADD CONSTRAINT "TreatmentProgress_treatmentPlanId_fkey" FOREIGN KEY ("treatmentPlanId") REFERENCES "TreatmentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

