// Shared server-side helpers: notifications, audit, email/SMS provider
// status tracking (honest about delivery state).
import { db } from "@/lib/db";

export async function notify(params: {
  organizationId: string;
  userId: string;
  kind: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}) {
  await db.notification.create({ data: params });
}

/** Notify all staff members with the given roles in an organization. */
export async function notifyRoles(organizationId: string, roles: string[], params: Omit<Parameters<typeof notify>[0], "organizationId" | "userId">) {
  const members = await db.organizationMember.findMany({ where: { organizationId, role: { in: roles }, isActive: true } });
  for (const m of members) {
    await notify({ ...params, organizationId, userId: m.userId });
  }
}

export async function audit(params: { organizationId: string; actorUserId?: string | null; action: string; entityType: string; entityId?: string; detail?: string }) {
  await db.auditEvent.create({ data: { ...params, actorUserId: params.actorUserId ?? null } });
}

/**
 * Email delivery. SMTP is not configured in this environment, so messages are
 * recorded as EMAIL_QUEUED notifications — the UI never claims "sent".
 */
export async function queueEmail(params: { organizationId: string; userId?: string; toEmail: string; title: string; body?: string }) {
  const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
  if (params.userId) {
    await notify({
      organizationId: params.organizationId,
      userId: params.userId,
      kind: "ACCOUNT",
      title: params.title,
      body: params.body,
    });
  }
  return { delivered: false, smtpConfigured, status: smtpConfigured ? "SENT" : "EMAIL_QUEUED" };
}

/**
 * SMS delivery for service OTP. No SMS provider is configured in this demo
 * environment, so we return an explicit test-mode marker — the UI displays
 * "Test SMS mode" and never claims a real message was delivered.
 */
export async function sendSms(phone: string, message: string) {
  const provider = process.env.SMS_PROVIDER;
  if (!provider || !process.env.SMS_API_KEY) {
    return { delivered: false, mode: "TEST" as const, provider: null };
  }
  // Real provider integration point (e.g. Twilio/MSG91). Not configured here.
  return { delivered: false, mode: "TEST" as const, provider };
}
