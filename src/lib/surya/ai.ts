// SuryaDesk AI engine — provider-neutral wrapper around z-ai-web-dev-sdk.
// Server-side only. All credentials stay here.
import ZAI from "z-ai-web-dev-sdk";

export interface AiResult {
  content: string;
  model: string;
}

export async function aiComplete(systemPrompt: string, userPrompt: string): Promise<AiResult> {
  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
    messages: [
      { role: "assistant", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    thinking: { type: "disabled" },
  });
  const content = completion.choices[0]?.message?.content ?? "";
  if (!content.trim()) throw new Error("Empty AI response");
  return { content, model: "glm-4.5-air" };
}

/** Robust JSON extraction — AI output is schema-validated before use. */
export function extractJson<T>(raw: string): T | null {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
