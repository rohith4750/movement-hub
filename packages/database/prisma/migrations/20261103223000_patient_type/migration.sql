-- CreateEnum
CREATE TYPE "PatientType" AS ENUM ('REGULAR', 'WALK_IN');

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN "patientType" "PatientType" NOT NULL DEFAULT 'REGULAR';

