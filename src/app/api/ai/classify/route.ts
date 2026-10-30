// AI complaint classification — suggests category/priority/summary as
// structured JSON. Human approval is always required before applying.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";
import { aiComplete, extractJson } from "@/lib/surya/ai";

const VALID_CATEGORIES = ["MAINTENANCE", "INVERTER", "CLEANING", "MONITORING", "INSPECTION", "OTHER"];
const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const { requestId } = await req.json();
    if (!requestId) throw new ApiError(400, "Request is required");
    const request = await db.serviceRequest.findFirst({
      where: { id: requestId, organizationId: ctx.organizationId! },
      include: { customer: { select: { name: true, city: true } }, installation: { select: { assetCode: true, capacityKw: true, inverterMake: true, inverterModel: true } } },
    });
    if (!request) throw new ApiError(404, "Request not found");

    let output: { category: string; priority: string; summary: string } | null = null;
    let failed = false;
    try {
      const res = await aiComplete(
        "You are a solar after-sales service triage assistant. Classify the customer complaint and respond with STRICT JSON only: {\"category\": string, \"priority\": string, \"summary\": string}. category must be one of MAINTENANCE, INVERTER, CLEANING, MONITORING, INSPECTION, OTHER. priority must be one of LOW, MEDIUM, HIGH, URGENT. summary: one professional sentence (max 25 words). Do not diagnose electrical faults and do not include repair instructions.",
        `Customer: ${request.customer.name} (${request.customer.city}). Installation: ${request.installation?.assetCode ?? "unspecified"}, ${request.installation?.capacityKw ?? "?"} kW, inverter ${request.installation?.inverterMake ?? "?"} ${request.installation?.inverterModel ?? ""}. Complaint: "${request.description}"`
      );
      output = extractJson<{ category: string; priority: string; summary: string }>(res.content);
      if (output && (!VALID_CATEGORIES.includes(output.category) || !VALID_PRIORITIES.includes(output.priority) || typeof output.summary !== "string")) {
        output = null;
      }
      if (output) {
        await db.aiGeneration.create({
          data: {
            organizationId: ctx.organizationId!,
            userId: ctx.userId,
            task: "CLASSIFY",
            provider: "zai",
            model: res.model,
            inputSummary: `Request ${request.code}`,
            outputJson: JSON.stringify(output),
            status: "OK",
          },
        });
      }
    } catch {
      failed = true;
    }
    if (!output) {
      if (failed) {
        await db.aiGeneration.create({
          data: { organizationId: ctx.organizationId!, userId: ctx.userId, task: "CLASSIFY", provider: "zai", model: "glm-4.5-air", inputSummary: `Request ${request.code}`, status: "FAILED" },
        });
      }
      return NextResponse.json({ ok: false, error: "The AI service could not process this complaint right now. You can classify it manually — nothing else is affected." }, { status: 200 });
    }
    return NextResponse.json({ ok: true, suggestion: output, note: "Review before applying — AI suggestions never change records automatically." });
  } catch (e) {
    return handleApiError(e);
  }
}

// Apply a (human-reviewed) suggestion to the request
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const { requestId, category, priority, summary } = await req.json();
    const request = await db.serviceRequest.findFirst({ where: { id: requestId, organizationId: ctx.organizationId! } });
    if (!request) throw new ApiError(404, "Request not found");
    if (category && !VALID_CATEGORIES.includes(category)) throw new ApiError(400, "Invalid category");
    if (priority && !VALID_PRIORITIES.includes(priority)) throw new ApiError(400, "Invalid priority");
    await db.serviceRequest.update({
      where: { id: requestId },
      data: {
        ...(category ? { category } : {}),
        ...(priority ? { priority } : {}),
        ...(summary ? { aiSummary: summary } : {}),
        aiCategory: category ?? request.aiCategory,
        aiPriority: priority ?? request.aiPriority,
      },
    });
    await db.aiGeneration.updateMany({ where: { organizationId: ctx.organizationId!, task: "CLASSIFY", outputJson: { not: null } }, data: { approved: true } });
    return NextResponse.json({ ok: true, message: "Suggestion applied" });
  } catch (e) {
    return handleApiError(e);
  }
}
