-- CreateTable
CREATE TABLE "TreatmentPrice" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreatmentPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TreatmentPrice_category_key" ON "TreatmentPrice"("category");

-- Starting prices (editable by an admin in Settings). Categories match TreatmentPlanItem.category.
INSERT INTO "TreatmentPrice" ("id", "category", "price", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid()::text, 'Exercise Therapy',        800.00,  1, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Electrotherapy',          800.00,  2, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Dry Needling',            800.00,  3, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Taping',                  800.00,  4, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Traction',                800.00,  5, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Myofascial Release',     2000.00,  6, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Mobility',               1500.00,  7, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Strength & Conditioning',1500.00,  8, CURRENT_TIMESTAMP);
