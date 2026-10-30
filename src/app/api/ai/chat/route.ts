// AI assistant chat — grounded on real, database-computed context only.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, handleApiError } from "@/lib/surya/auth";
import { aiComplete } from "@/lib/surya/ai";

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const orgId = ctx.organizationId!;
    const { messages } = await req.json() as { messages: { role: "user" | "assistant"; content: string }[] };
    if (!Array.isArray(messages) || !messages.length) return NextResponse.json({ ok: false, error: "No messages" });

    // ground the model in verified numbers
    const [openRequests, activeJobs, overdue, awaiting, expiringAmc, techs] = await Promise.all([
      db.serviceRequest.count({ where: { organizationId: orgId, status: { in: ["NEW", "UNDER_REVIEW", "APPROVED"] } } }),
      db.serviceJob.count({ where: { organizationId: orgId, status: { in: ["ASSIGNED", "IN_PROGRESS"] } } }),
      db.maintenanceOccurrence.count({ where: { organizationId: orgId, status: "OVERDUE" } }),
      db.serviceJob.count({ where: { organizationId: orgId, status: "AWAITING_CUSTOMER" } }),
      db.amcContract.count({ where: { organizationId: orgId, status: { in: ["EXPIRING_SOON", "RENEWAL_PENDING"] } } }),
      db.organizationMember.count({ where: { organizationId: orgId, role: "TECHNICIAN", isActive: true } }),
    ]);
    const context = `Verified live statistics (use only these numbers): open requests ${openRequests}, active jobs ${activeJobs}, overdue maintenance visits ${overdue}, jobs awaiting customer OTP ${awaiting}, AMC contracts expiring soon ${expiringAmc}, active technicians ${techs}. Today is ${new Date().toLocaleDateString("en-IN")}.`;

    try {
      const transcript = messages.slice(-8).map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
      const res = await aiComplete(
        `You are SuryaDesk's operations assistant for a solar after-sales service company. Be concise and practical. Ground every number you cite in the verified statistics provided; if a number is not in the statistics, say it should be checked in the dashboard instead of guessing. Never diagnose electrical faults or give hazardous repair instructions — advise booking a technician instead. ${context}`,
        transcript
      );
      await db.aiGeneration.create({
        data: { organizationId: orgId, userId: ctx.userId, task: "CHAT", provider: "zai", model: res.model, inputSummary: messages[messages.length - 1]?.content?.slice(0, 120) ?? "", status: "OK" },
      });
      return NextResponse.json({ ok: true, reply: res.content.trim() });
    } catch {
      return NextResponse.json({ ok: false, error: "The assistant is unavailable right now. Please try again in a moment." });
    }
  } catch (e) {
    return handleApiError(e);
  }
}
