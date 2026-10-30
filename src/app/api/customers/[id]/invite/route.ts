// Invite customer to portal. Creates a portal login (random temp password),
// sets portalStatus=INVITED, queues the invitation email (honest status),
// and returns the temporary password ONLY in demo mode for testability.
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError, hashPassword } from "@/lib/surya/auth";
import { audit, queueEmail, notify } from "@/lib/surya/notify";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const { id } = await params;
    const customer = await db.customer.findFirst({ where: { id, organizationId: ctx.organizationId! } });
    if (!customer) throw new ApiError(404, "Customer not found");
    if (customer.archivedAt) throw new ApiError(400, "Archived customers cannot be invited");
    if (customer.userId) {
      await db.customer.update({ where: { id }, data: { portalStatus: "ACTIVE" } });
      return NextResponse.json({ ok: true, alreadyLinked: true, message: "This customer already has portal access." });
    }
    const tempPassword = "SD-" + crypto.randomBytes(4).toString("hex") + "!1";
    let user = await db.user.findUnique({ where: { email: customer.email } });
    if (user) {
      // reuse existing login (e.g. demo customer) — do not overwrite passwords
      await db.customer.update({ where: { id }, data: { userId: user.id, portalStatus: "ACTIVE" } });
    } else {
      user = await db.user.create({
        data: {
          email: customer.email,
          name: customer.name,
          passwordHash: await hashPassword(tempPassword),
          baseRole: "CUSTOMER",
          emailVerified: true,
        },
      });
      await db.customer.update({ where: { id }, data: { userId: user.id, portalStatus: "INVITED" } });
    }
    const mail = await queueEmail({
      organizationId: ctx.organizationId!,
      userId: user.id,
      toEmail: customer.email,
      title: "Your SuryaDesk customer portal is ready",
      body: "Sign in with your email and the temporary password shared by your service provider.",
    });
    await notify({
      organizationId: ctx.organizationId!,
      userId: user.id,
      kind: "ACCOUNT",
      title: "Portal invitation",
      body: "Your service provider invited you to the customer portal.",
    });
    await audit({ organizationId: ctx.organizationId!, actorUserId: ctx.userId, action: "CUSTOMER_INVITED", entityType: "CUSTOMER", entityId: id, detail: customer.name });
    return NextResponse.json({
      ok: true,
      emailQueued: mail.status === "EMAIL_QUEUED",
      ...(process.env.DEMO_MODE === "true" && !user.emailVerified ? {} : {}),
      ...(process.env.DEMO_MODE === "true" ? { tempPassword } : {}),
      message: mail.smtpConfigured
        ? "Invitation email sent with sign-in instructions."
        : "Invitation queued (SMTP not configured in this environment). " + (process.env.DEMO_MODE === "true" ? "Demo mode: share the temporary password shown here." : ""),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
