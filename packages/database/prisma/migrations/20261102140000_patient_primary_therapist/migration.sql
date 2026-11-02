-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "primaryTherapistId" TEXT;

-- CreateIndex
CREATE INDEX "Patient_primaryTherapistId_idx" ON "Patient"("primaryTherapistId");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_primaryTherapistId_fkey" FOREIGN KEY ("primaryTherapistId") REFERENCES "Therapist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
