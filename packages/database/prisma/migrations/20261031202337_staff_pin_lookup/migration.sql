-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pinLookup" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_pinLookup_key" ON "User"("pinLookup");

