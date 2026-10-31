/* Seeds synthetic data only — never real patients. */
import { PrismaClient, DayOfWeek, Gender, PackageTier, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const DEFAULT_PASSWORD = "Movement@123";

const DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

async function main() {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  const branch = await prisma.branch.upsert({
    where: { code: "MH-HYD" },
    update: {},
    create: {
      name: "Movement Hub – Main Branch",
      code: "MH-HYD",
      phone: "+910000000000",
      email: "hello@movementhub.example",
      address: "Main Road",
      city: "Hyderabad",
      state: "Telangana",
      pincode: "500001",
      settings: {
        create: {
          consultationFee: 500,
          therapySessionFee: 800,
          homeVisitFee: 1200,
          travelChargePerKm: 15,
        },
      },
    },
  });

  // Current phase: two roles only — Super Admin and Physiotherapist (created below).
  const staff: { role: Role; name: string; email: string; phone: string }[] = [
    { role: "SUPER_ADMIN", name: "Super Admin", email: "superadmin@movementhub.example", phone: "+919000000001" },
  ];
  for (const s of staff) {
    await prisma.user.upsert({
      where: { email: s.email },
      update: {},
      create: { ...s, branchId: branch.id, passwordHash },
    });
  }

  const specNames = ["Orthopaedic", "Neurological", "Sports", "Paediatric", "Geriatric"];
  const specs = await Promise.all(
    specNames.map((name) => prisma.specialization.upsert({ where: { name }, update: {}, create: { name } })),
  );

  const therapists = [
    { name: "Dr. Priya Sharma", spec: [0, 2], color: "#1e3a8a", home: true },
    { name: "Dr. Arjun Reddy", spec: [0, 4], color: "#b45309", home: false },
    { name: "Dr. Neha Iyer", spec: [1, 3], color: "#047857", home: true },
    { name: "Dr. Karan Mehta", spec: [2], color: "#7c3aed", home: false },
  ];
  for (const [i, t] of therapists.entries()) {
    const email = `therapist${i + 1}@movementhub.example`;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) continue;
    await prisma.user.create({
      data: {
        role: "PHYSIOTHERAPIST",
        name: t.name,
        email,
        phone: `+91900000010${i}`,
        passwordHash,
        branchId: branch.id,
        therapist: {
          create: {
            branchId: branch.id,
            qualification: "BPT, MPT",
            experienceYears: 4 + i * 2,
            colorTag: t.color,
            isAvailableForHomeVisit: t.home,
            specializations: { create: t.spec.map((s) => ({ specializationId: specs[s].id })) },
            schedules: {
              create: DAYS.map((dayOfWeek) => ({
                dayOfWeek,
                startTime: "09:00",
                endTime: "18:00",
                breakStart: "13:00",
                breakEnd: "14:00",
                slotMinutes: 30,
              })),
            },
          },
        },
      },
    });
  }

  const packages: { name: string; tier: PackageTier; sessionCount: number; validityDays: number; price: number }[] = [
    { name: "Basic Package", tier: "BASIC", sessionCount: 6, validityDays: 30, price: 4500 },
    { name: "Standard Package", tier: "STANDARD", sessionCount: 12, validityDays: 60, price: 8400 },
    { name: "Premium Package", tier: "PREMIUM", sessionCount: 24, validityDays: 120, price: 15600 },
  ];
  if ((await prisma.treatmentPackage.count()) === 0) {
    await prisma.treatmentPackage.createMany({ data: packages });
  }

  const firstNames = ["Ravi", "Anjali", "Suresh", "Meera", "Vikram", "Kavya", "Rahul", "Divya", "Arun", "Pooja",
    "Sanjay", "Lakshmi", "Manoj", "Sneha", "Kiran", "Asha", "Naveen", "Ritu", "Deepak", "Swathi"];
  const existingPatients = await prisma.patient.count();
  for (let i = existingPatients; i < firstNames.length; i++) {
    await prisma.patient.create({
      data: {
        branchId: branch.id,
        patientCode: `MH-P-${String(i + 1).padStart(6, "0")}`,
        firstName: firstNames[i],
        lastName: "Test",
        gender: (i % 2 === 0 ? "MALE" : "FEMALE") as Gender,
        dateOfBirth: new Date(1970 + (i % 35), i % 12, 1 + i),
        phone: `+9180000${String(10000 + i)}`,
        consentGiven: true,
        consentAt: new Date(),
        addresses: {
          create: { line1: `${10 + i} Sample Street`, city: "Hyderabad", state: "Telangana", pincode: "500001", isDefault: true },
        },
      },
    });
  }

  console.log("Seed complete.");
  console.log(`Staff logins use password: ${DEFAULT_PASSWORD} (web). Set each person's mobile-app PIN from the Staff / Therapists page.`);
  console.log("Generate therapist slots: POST /api/v1/therapists/:id/slots/generate");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
