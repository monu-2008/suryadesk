import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, ApiError, handleApiError } from "@/lib/surya/auth";

export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json();
    if (!token || !password) throw new ApiError(400, "Reset token and new password are required");
    if (String(password).length < 8) throw new ApiError(400, "Password must be at least 8 characters");
    const user = await db.user.findFirst({ where: { resetToken: token } });
    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      throw new ApiError(400, "This reset link is invalid or has expired. Please request a new one.");
    }
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password), resetToken: null, resetTokenExpiry: null },
    });
    // invalidate existing sessions (password rotation)
    await db.session.deleteMany({ where: { userId: user.id } });
    return NextResponse.json({ ok: true, message: "Password updated. You can sign in with your new password." });
  } catch (e) {
    return handleApiError(e);
  }
}
