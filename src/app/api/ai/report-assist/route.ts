// AI service report assistant — turns technician notes into a customer-friendly
// draft. Original notes are always preserved; the draft is a suggestion.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";
import { aiComplete } from "@/lib/surya/ai";

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["TECHNICIAN", "MANAGER", "OWNER"]);
    const { jobId, notes } = await req.json();
    if (!notes || String(notes).trim().length < 10) throw new ApiError(400, "Write your raw notes first (at least 10 characters)");
    const job = jobId
      ? await db.serviceJob.findFirst({
          where: { id: jobId, organizationId: ctx.organizationId! },
          include: { customer: { select: { name: true } }, installation: { select: { assetCode: true, capacityKw: true } } },
        })
      : null;
    if (jobId && !job) throw new ApiError(404, "Job not found");
    const checklist = jobId
      ? (await db.jobChecklistResult.findMany({ where: { organizationId: ctx.organizationId!, jobId } })).map((r) => `${r.itemLabel}: ${r.itemKind === "BOOLEAN" ? (r.value === "true" ? "done" : "not done") : r.value}`).join("; ")
      : "";
    try {
      const res = await aiComplete(
        "You are a solar service report writer. Convert technician notes into a short customer-friendly service summary (3-5 sentences, warm professional tone, simple words). Mention what was done, the outcome, and any follow-up advice. Never include electrical repair instructions, never invent observations that are not in the notes, never mention internal codes.",
        `Customer: ${job?.customer.name ?? "customer"}. Asset: ${job?.installation?.assetCode ?? ""} (${job?.installation?.capacityKw ?? ""} kW). Checklist results: ${checklist || "none recorded"}. Technician notes: "${notes}"`
      );
      const summary = res.content.trim().slice(0, 900);
      await db.aiGeneration.create({
        data: { organizationId: ctx.organizationId!, userId: ctx.userId, task: "REPORT_ASSIST", provider: "zai", model: res.model, inputSummary: `Job ${job?.code ?? "draft"}`, outputJson: JSON.stringify({ summary }), status: "OK" },
      });
      return NextResponse.json({ ok: true, summary, note: "Draft only — your original notes are preserved and you can edit before submitting." });
    } catch {
      await db.aiGeneration.create({
        data: { organizationId: ctx.organizationId!, userId: ctx.userId, task: "REPORT_ASSIST", provider: "zai", model: "glm-4.5-air", inputSummary: `Job ${job?.code ?? "draft"}`, status: "FAILED" },
      });
      return NextResponse.json({ ok: false, error: "AI drafting is unavailable right now. You can still write the summary manually." });
    }
  } catch (e) {
    return handleApiError(e);
  }
}
