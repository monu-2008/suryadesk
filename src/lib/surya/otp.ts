// SuryaDesk Proof-of-Service OTP.
// 6-digit code, SHA-256 hashed at rest, 5-minute expiry, 5 attempts,
// 30-second resend cooldown, single-use (replay-safe).
import { db } from "@/lib/db";
import crypto from "crypto";
import { ApiError } from "./auth";

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export interface OtpIssueResult {
  challengeId: string;
  expiresAt: Date;
  attemptsLeft: number;
  sms: { delivered: boolean; mode: "TEST" | "LIVE" };
  /** Returned ONLY because this environment has no SMS provider configured
   *  (explicit demo/test mode per spec §6.3). Null when SMS is really sent. */
  demoCode: string | null;
}

export async function issueOtp(organizationId: string, jobId: string, customerPhone: string, sendSmsFn: (phone: string, msg: string) => Promise<{ delivered: boolean; mode: "TEST" | "LIVE" }>): Promise<OtpIssueResult> {
  const job = await db.serviceJob.findFirst({ where: { id: jobId, organizationId } });
  if (!job) throw new ApiError(404, "Job not found");
  if (!["WORK_SUBMITTED", "AWAITING_CUSTOMER"].includes(job.status)) {
    throw new ApiError(400, "OTP acknowledgement is available after the service report is submitted");
  }
  const latest = await db.proofOtpChallenge.findFirst({
    where: { organizationId, jobId, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (latest && latest.createdAt.getTime() + OTP_RESEND_COOLDOWN_MS > Date.now()) {
    const wait = Math.ceil((latest.createdAt.getTime() + OTP_RESEND_COOLDOWN_MS - Date.now()) / 1000);
    throw new ApiError(429, `Please wait ${wait}s before requesting a new code`);
  }
  // invalidate previous unconsumed challenges
  if (latest) {
    await db.proofOtpChallenge.update({ where: { id: latest.id }, data: { attemptsLeft: 0, consumedAt: new Date() } });
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const challenge = await db.proofOtpChallenge.create({
    data: {
      organizationId,
      jobId,
      codeHash: sha256(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      attemptsLeft: OTP_MAX_ATTEMPTS,
      lastSentAt: new Date(),
    },
  });
  const sms = await sendSmsFn(customerPhone, `SuryaDesk: Your service confirmation code is ${code}. Valid for 5 minutes. Share it with the technician only after you are satisfied with the service.`);
  return {
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt,
    attemptsLeft: OTP_MAX_ATTEMPTS,
    sms,
    demoCode: sms.delivered ? null : code,
  };
}

export async function verifyOtp(organizationId: string, jobId: string, code: string) {
  const challenge = await db.proofOtpChallenge.findFirst({
    where: { organizationId, jobId, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) throw new ApiError(400, "No active OTP request for this job. Ask the technician to request a new code.");
  if (challenge.expiresAt < new Date()) throw new ApiError(400, "This code has expired. Please request a new one.");
  if (challenge.attemptsLeft <= 0) throw new ApiError(429, "Too many incorrect attempts. Request a new code.");
  if (sha256(code.trim()) !== challenge.codeHash) {
    await db.proofOtpChallenge.update({ where: { id: challenge.id }, data: { attemptsLeft: challenge.attemptsLeft - 1 } });
    throw new ApiError(400, `Incorrect code. ${challenge.attemptsLeft - 1} attempt(s) left.`);
  }
  // consume — replay-safe
  await db.proofOtpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date(), attemptsLeft: 0 } });
  return { ok: true as const, challengeId: challenge.id };
}
