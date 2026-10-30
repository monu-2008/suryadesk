// Owner registration: creates account + organization + membership.
// Email verification is queued (SMTP not configured here — status is honest).
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { hashPassword, ApiError, handleApiError } from "@/lib/surya/auth";
import { queueEmail, audit } from "@/lib/surya/notify";

export async function POST(req: NextRequest) {
  try {
    const { name, email, password, organizationName, city } = await req.json();
    if (!name || !email || !password || !organizationName) {
      throw new ApiError(400, "Name, email, password and organization name are required");
    }
    if (String(password).length < 8) throw new ApiError(400, "Password must be at least 8 characters");
    const emailNorm = String(email).toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNorm)) throw new ApiError(400, "Enter a valid email address");
    const existing = await db.user.findUnique({ where: { email: emailNorm } });
    if (existing) throw new ApiError(409, "An account with this email already exists");

    const verificationToken = crypto.randomBytes(24).toString("hex");
    const user = await db.user.create({
      data: { email: emailNorm, name, passwordHash: await hashPassword(password), baseRole: "OWNER", phone: null, emailVerified: false, verificationTok: verificationToken },
    });
    const slugBase = String(organizationName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "org";
    let slug = slugBase;
    let n = 1;
    while (await db.organization.findUnique({ where: { slug } })) slug = `${slugBase}-${++n}`;
    const org = await db.organization.create({
      data: { name: organizationName, slug, city: city || null, email: emailNorm, isDemo: false },
    });
    await db.organizationMember.create({
      data: { organizationId: org.id, userId: user.id, role: "OWNER", title: "Founder" },
    });
    await audit({ organizationId: org.id, actorUserId: user.id, action: "ORG_REGISTERED", entityType: "ORGANIZATION", entityId: org.id, detail: "Owner registration" });
    // Verification email — queued because SMTP is not configured in this environment.
    const mail = await queueEmail({
      organizationId: org.id,
      userId: user.id,
      toEmail: emailNorm,
      title: "Confirm your SuryaDesk email",
      body: "Welcome to SuryaDesk. Confirm your email address to activate your workspace.",
    });
    return NextResponse.json({
      ok: true,
      organizationId: org.id,
      emailQueued: mail.status === "EMAIL_QUEUED",
      smtpConfigured: mail.smtpConfigured,
      message: mail.smtpConfigured
        ? "Verification email sent. Please confirm your email, then sign in."
        : "Account created. SMTP is not configured in this environment, so the verification email was queued — use the demo verification button on the sign-in screen (demo mode only).",
    });
  } catch (e) {
    return handleApiError(e);
  }
}
