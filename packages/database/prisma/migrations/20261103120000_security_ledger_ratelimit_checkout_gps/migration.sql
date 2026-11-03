-- AlterTable
ALTER TABLE "HomeVisit" ADD COLUMN     "checkOutLat" DECIMAL(9,6),
ADD COLUMN     "checkOutLng" DECIMAL(9,6);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "RateLimit_resetAt_idx" ON "RateLimit"("resetAt");

-- Stop with a clear message if a therapy session was already charged to a package twice
-- (the race this migration closes). Fix those rows by hand, then deploy again.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "PackageTransaction"
    WHERE "therapySessionId" IS NOT NULL
    GROUP BY "therapySessionId", "type" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate package ledger rows for the same therapy session exist. Resolve them before applying this migration.';
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "PackageTransaction_therapySessionId_type_key" ON "PackageTransaction"("therapySessionId", "type");

