-- AlterTable
ALTER TABLE "HospitalSetting" ADD COLUMN "tvStaffKey" TEXT DEFAULT 'staff-wall-access';
ALTER TABLE "HospitalSetting" ADD COLUMN "tvQrUrl" TEXT DEFAULT 'https://g.page/r/movement-hub/review';
ALTER TABLE "HospitalSetting" ADD COLUMN "tvQrLabel" TEXT DEFAULT 'Google Review';
ALTER TABLE "HospitalSetting" ADD COLUMN "tvSlides" JSONB;

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "roomOrBay" TEXT;

