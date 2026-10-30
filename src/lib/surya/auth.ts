// SuryaDesk authentication: bcrypt passwords + opaque session tokens
// stored server-side (sha256), delivered via httpOnly cookie.
import { db } from "@/lib/db";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";

export const SESSION_COOKIE = "sd_session";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}
export function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export async function createSession(userId: string, userAgent?: string | null) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({ data: { id: sha256(token), userId, expiresAt, userAgent: userAgent ?? null } });
  return { token, expiresAt };
}

export async function destroySession(token: string) {
  await db.session.deleteMany({ where: { id: sha256(token) } });
}

export interface AuthCtx {
  userId: string;
  email: string;
  name: string;
  baseRole: string;
  organizationId: string | null;
  orgRole: "OWNER" | "MANAGER" | "TECHNICIAN" | "CUSTOMER" | null;
  title: string | null;
  customerId: string | null; // linked Customer row (CUSTOMER role)
  isDemoOrg: boolean;
  organizationName: string | null;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function handleApiError(e: unknown) {
  if (e instanceof ApiError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[api]", e);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

export async function getAuth(req: NextRequest): Promise<AuthCtx | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { id: sha256(token) },
    include: { user: { include: { memberships: true, customer: true } } },
  });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;

  const user = session.user;
  if (user.baseRole === "CUSTOMER") {
    const customer = user.customer;
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      baseRole: "CUSTOMER",
      organizationId: customer?.organizationId ?? null,
      orgRole: "CUSTOMER",
      title: null,
      customerId: customer?.id ?? null,
      isDemoOrg: true,
      organizationName: customer ? (await db.organization.findUnique({ where: { id: customer.organizationId } }))?.name ?? null : null,
    };
  }
  const member = user.memberships.find((m) => m.isActive) ?? null;
  let orgName: string | null = null;
  let isDemo = false;
  if (member) {
    const org = await db.organization.findUnique({ where: { id: member.organizationId } });
    orgName = org?.name ?? null;
    isDemo = org?.isDemo ?? false;
  }
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    baseRole: user.baseRole,
    organizationId: member?.organizationId ?? null,
    orgRole: (member?.role as "OWNER" | "MANAGER" | "TECHNICIAN") ?? null,
    title: member?.title ?? null,
    customerId: null,
    isDemoOrg: isDemo,
    organizationName: orgName,
  };
}

export async function requireAuth(req: NextRequest, roles?: string[]): Promise<AuthCtx> {
  const ctx = await getAuth(req);
  if (!ctx) throw new ApiError(401, "Not signed in");
  if (roles && roles.length && (!ctx.orgRole || !roles.includes(ctx.orgRole))) {
    throw new ApiError(403, "You do not have permission to perform this action");
  }
  if (!ctx.organizationId) throw new ApiError(403, "No organization membership found for this account");
  return ctx;
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false, // sandbox runs behind a proxy without https termination on localhost
    path: "/",
    expires: expiresAt,
  };
}
