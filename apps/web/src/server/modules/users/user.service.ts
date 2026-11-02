import { prisma } from "@movement-hub/database";
import { forbidden, notFound, unprocessable } from "../../lib/http-error";

/**
 * Delete a staff member (including physiotherapists).
 *
 * Soft delete: the user disappears from the app and can no longer log in, but the row stays
 * so past appointments, consultations, invoices and audit history remain intact.
 * Email/phone are released so the same details can be used for a new account later.
 */
export async function deleteStaffUser(userId: string, actingUserId: string) {
  if (userId === actingUserId) throw forbidden("You cannot delete your own account");

  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, include: { therapist: true } });
  if (!user) throw notFound("User");
  if (user.role === "PATIENT") throw forbidden("Patients are managed from the Patients page");

  if (user.role === "SUPER_ADMIN") {
    const others = await prisma.user.count({ where: { role: "SUPER_ADMIN", deletedAt: null, id: { not: user.id } } });
    if (others === 0) throw unprocessable("LAST_SUPER_ADMIN", "Cannot delete the only Super Admin");
  }

  if (user.therapist) {
    const upcoming = await prisma.appointment.count({
      where: { therapistId: user.therapist.id, startAt: { gt: new Date() }, status: { in: ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"] } },
    });
    if (upcoming > 0) {
      throw unprocessable("HAS_UPCOMING_APPOINTMENTS", `This physiotherapist has ${upcoming} upcoming appointment(s). Reschedule or cancel them first.`);
    }
  }

  const stamp = Date.now();
  await prisma.$transaction(async (tx) => {
    if (user.therapist) {
      await tx.therapist.update({ where: { id: user.therapist.id }, data: { isActive: false, registrationNo: null } });
      // Remove future free slots so they never show as bookable
      await tx.therapistSlot.deleteMany({ where: { therapistId: user.therapist.id, startAt: { gt: new Date() }, appointment: null } });
      await tx.therapistSchedule.updateMany({ where: { therapistId: user.therapist.id }, data: { isActive: false } });
    }
    await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.user.update({
      where: { id: user.id },
      data: {
        isActive: false,
        deletedAt: new Date(),
        pinHash: null,
        pinLookup: null, // frees the PIN for someone else
        email: user.email ? `deleted-${stamp}-${user.email}` : null,
        phone: `deleted-${stamp}-${user.phone}`,
      },
    });
  });
  return { deleted: true, name: user.name, role: user.role };
}
