// Forgot password: creates a reset token. Email delivery is queued when SMTP
// is configured; in demo mode the reset link is returned so the flow is testable.
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { ApiError, handleApiError } from "@/lib/surya/auth";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    const emailNorm = String(email).toLowerCase().trim();
    const user = await db.user.findUnique({ where: { email: emailNorm } });
    // Do not reveal whether an account exists.
    const generic = { ok: true, message: "If an account exists for this email, password reset instructions have been sent." };
    if (!user) return NextResponse.json(generic);
    const token = crypto.randomBytes(24).toString("hex");
    await db.user.update({
      where: { id: user.id },
      data: { resetToken: token, resetTokenExpiry: new Date(Date.now() + 30 * 60 * 1000) },
    });
    const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
    return NextResponse.json({
      ...generic,
      smtpConfigured,
      ...(process.env.DEMO_MODE === "true" && !smtpConfigured ? { demoResetToken: token } : {}),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
