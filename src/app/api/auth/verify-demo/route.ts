// Demo-only email verification. Available exclusively when DEMO_MODE=true
// because SMTP is not configured in this sandbox. Clearly labeled in the UI.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError, handleApiError } from "@/lib/surya/auth";
import { audit } from "@/lib/surya/notify";

export async function POST(req: NextRequest) {
  try {
    if (process.env.DEMO_MODE !== "true") {
      throw new ApiError(403, "Demo verification is disabled. Configure SMTP for real verification emails.");
    }
    const { email } = await req.json();
    const user = await db.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
    if (!user) throw new ApiError(404, "No account found with this email");
    if (!user.emailVerified) {
      await db.user.update({ where: { id: user.id }, data: { emailVerified: true, verificationTok: null } });
      const member = await db.organizationMember.findFirst({ where: { userId: user.id } });
      const cust = await db.customer.findFirst({ where: { userId: user.id } });
      const orgId = member?.organizationId ?? cust?.organizationId;
      if (orgId) await audit({ organizationId: orgId, actorUserId: user.id, action: "EMAIL_VERIFIED_DEMO", entityType: "USER", entityId: user.id, detail: "Demo-mode email verification (SMTP not configured)" });
    }
    return NextResponse.json({ ok: true, message: "Email verified (demo mode). You can sign in now." });
  } catch (e) {
    return handleApiError(e);
  }
}
