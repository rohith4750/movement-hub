-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('SCHEDULED', 'WALK_IN');

-- CreateEnum
CREATE TYPE "ConsultationStatus" AS ENUM ('DRAFT', 'FINAL');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "source" "AppointmentSource" NOT NULL DEFAULT 'SCHEDULED';

-- AlterTable
ALTER TABLE "Consultation" ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ConsultationStatus" NOT NULL DEFAULT 'FINAL';


-- Existing consultations were all finished notes: date them from when they were written.
UPDATE "Consultation" SET "finalizedAt" = "createdAt" WHERE "status" = 'FINAL' AND "finalizedAt" IS NULL;
