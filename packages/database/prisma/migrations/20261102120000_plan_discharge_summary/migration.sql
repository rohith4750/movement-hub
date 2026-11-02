-- CreateEnum
CREATE TYPE "TreatmentOutcome" AS ENUM ('GOALS_MET', 'PARTIALLY_MET', 'NOT_MET', 'DISCONTINUED');

-- AlterTable
ALTER TABLE "TreatmentPlan" ADD COLUMN     "dischargeSummary" TEXT,
ADD COLUMN     "finalPainScore" INTEGER,
ADD COLUMN     "homeProgram" TEXT,
ADD COLUMN     "outcome" "TreatmentOutcome";
