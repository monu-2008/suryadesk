"use client";
// SuryaDesk AI workspace — owner/manager intelligence view.
// Three tools: grounded chat, operations briefing, and complaint triage with
// human approval. AI never changes records automatically.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles, MessageSquare, Wand2, Bot, Send, Loader2, AlertTriangle, Info,
  Wrench, HardHat, Clock, CalendarDays, FileText, CheckCircle2,
} from "lucide-react";
import { api, useApi, qs } from "@/lib/surya/client";
import { REQUEST_CATEGORY_LABELS, fmtDateTime } from "@/lib/surya/types";
import {
  PageHeader, StatusPill, PriorityPill, KpiCard, EmptyState, SkeletonRows,
} from "@/components/suryadesk/shared/bits";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── response types ──────────────────────────────────────────────
interface ChatMsg { role: "user" | "assistant"; content: string; error?: boolean }
interface ChatResponse { ok: boolean; reply?: string; error?: string }

interface OpsStats {
  openRequests: number;
  newRequests: number;
  unresolvedByCategory: Record<string, number>;
  jobsInProgress: number;
  jobsAwaitingCustomer: number;
  overdueMaintenance: number;
  amcExpiringSoon: number;
  technicianWorkload: { name: string; activeJobs: number }[];
}
interface OpsResponse { ok: boolean; summary?: string; stats?: OpsStats; error?: string }

interface ClassifySuggestion { category: string; priority: string; summary: string }
interface ClassifyResponse { ok: boolean; suggestion?: ClassifySuggestion; note?: string; error?: string }

interface TriageRequest {
  id: string; code: string; description: string; category: string; priority: string;
  status: string; createdAt: string; customer: { name: string; city?: string };
}
interface RequestsListResponse {
  total: number; page: number; pageSize: number; counts?: Record<string, number>;
  requests: TriageRequest[];
}

function excerpt(s: string, n: number): string {
  const t = (s ?? "").trim().replace(/\s+/g, " ");
  return t.length <= n ? t : t.slice(0, Math.max(1, n - 1)) + "…";
}

export default function AiAssistantView() {
  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="AI Assistant"
        subtitle="Grounded intelligence for your service operations. Every number is computed live from your database — the AI never invents statistics, and it never changes records without your approval."
      />
      <Tabs defaultValue="chat" className="gap-4">
        <TabsList className="h-auto rounded-2xl border border-sd-line bg-sd-surface p-1">
          <TabsTrigger value="chat" className="rounded-xl px-3.5 py-2 text-sm gap-2">
            <MessageSquare className="w-4 h-4" /> Ask SuryaDesk AI
          </TabsTrigger>
          <TabsTrigger value="briefing" className="rounded-xl px-3.5 py-2 text-sm gap-2">
            <Sparkles className="w-4 h-4" /> Operations briefing
          </TabsTrigger>
          <TabsTrigger value="triage" className="rounded-xl px-3.5 py-2 text-sm gap-2">
            <Wand2 className="w-4 h-4" /> Complaint triage
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat">
          <ChatPane />
        </TabsContent>
        <TabsContent value="briefing">
          <BriefingPane />
        </TabsContent>
        <TabsContent value="triage">
          <TriagePane />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── 1. Chat ─────────────────────────────────────────────────────
function ChatPane() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const next: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const payload = next
        .filter((m) => !m.error)
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content }));
      const res = await api<ChatResponse>("/api/ai/chat", { method: "POST", json: { messages: payload } });
      const reply = res.reply;
      if (res.ok && reply) {
        setMessages((m) => [...m, { role: "assistant", content: reply }]);
      } else {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: res.error ?? "The assistant is unavailable right now.", error: true },
        ]);
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Couldn't reach the assistant",
        description: e instanceof Error ? e.message : "Please try again in a moment.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="sd-clay overflow-hidden flex flex-col">
      {/* thread */}
      <div ref={scrollRef} className="max-h-[28rem] overflow-y-auto sd-scroll px-4 sm:px-5 py-5 space-y-3.5">
        {messages.length === 0 && !sending && (
          <div className="text-center py-10 px-4">
            <div className="mx-auto w-fit rounded-3xl bg-sd-surface p-4 mb-4">
              <Bot className="w-7 h-7 text-sd-forest" />
            </div>
            <div className="font-semibold text-sd-ink">Ask SuryaDesk AI</div>
            <p className="text-sm text-sd-ink-soft mt-1.5 max-w-sm mx-auto leading-relaxed">
              Ask about open requests, technician workload, or expiring AMC contracts.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                onClick={() => setInput("What needs my attention today?")}
                className="rounded-full border border-sd-line bg-white px-4 py-2 text-xs font-medium text-sd-forest hover:bg-[#176B52]/5 transition-colors sd-focus"
              >
                What needs my attention today?
              </button>
              <button
                onClick={() => setInput("How is the workload spread across technicians?")}
                className="rounded-full border border-sd-line bg-white px-4 py-2 text-xs font-medium text-sd-forest hover:bg-[#176B52]/5 transition-colors sd-focus"
              >
                How is the workload spread across technicians?
              </button>
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-br-md bg-[#176B52]/[0.12] px-4 py-2.5 text-sm text-sd-ink leading-relaxed whitespace-pre-wrap">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div
                className={cn(
                  "max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap flex items-start gap-2.5",
                  m.error
                    ? "bg-[#D99A32]/12 border border-[#D99A32]/30 text-[#96660d]"
                    : "sd-clay-sm text-sd-ink"
                )}
              >
                {m.error ? (
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                ) : (
                  <Bot className="w-4 h-4 mt-0.5 text-sd-forest shrink-0" aria-hidden="true" />
                )}
                <span>{m.content.replace(/\*\*/g, "").replace(/^#+\s*/gm, "")}</span>
              </div>
            </div>
          )
        )}

        {sending && (
          <div className="flex justify-start">
            <div className="sd-clay-sm rounded-2xl rounded-bl-md px-4 py-2.5 text-sm text-sd-ink-soft flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-sd-forest" /> Thinking…
            </div>
          </div>
        )}
      </div>

      {/* composer */}
      <div className="border-t border-sd-line/80 p-3.5 sm:p-4 bg-white/60">
        <div className="flex items-end gap-2.5">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask about your operations…"
            rows={1}
            aria-label="Message"
            className="sd-inset flex-1 px-3.5 py-2.5 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-sd-forest/40 resize-none min-h-11 max-h-36 sd-scroll"
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            aria-label="Send message"
            className="sd-btn-primary shrink-0 w-11 h-11 flex items-center justify-center sd-focus disabled:cursor-not-allowed"
          >
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
        <p className="mt-2.5 text-[0.7rem] text-sd-ink-soft flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-sd-forest shrink-0" aria-hidden="true" />
          Answers are grounded in your live database statistics.
        </p>
      </div>
    </div>
  );
}

// ── 2. Operations briefing ──────────────────────────────────────
function BriefingPane() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OpsResponse | null>(null);

  const generate = async () => {
    setLoading(true);
    try {
      const res = await api<OpsResponse>("/api/ai/ops-summary", { method: "POST", json: {} });
      setResult(res);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Couldn't generate briefing",
        description: e instanceof Error ? e.message : "Please try again in a moment.",
      });
    } finally {
      setLoading(false);
    }
  };

  const stats = result?.stats;
  const maxJobs = Math.max(1, ...(stats?.technicianWorkload ?? []).map((w) => w.activeJobs));
  const unresolved = stats ? Object.entries(stats.unresolvedByCategory ?? {}) : [];

  return (
    <div className="sd-clay overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-1">
        <div className="min-w-0">
          <h3 className="font-semibold text-sd-ink text-[0.95rem]">Operations briefing</h3>
          <p className="text-xs text-sd-ink-soft mt-0.5 max-w-lg leading-relaxed">
            The model narrates statistics computed directly from your database — it can never invent numbers.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="sd-btn-primary px-4 py-2.5 text-sm font-semibold sd-focus inline-flex items-center gap-2 shrink-0 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {loading ? "Composing…" : result ? "Regenerate" : "Generate briefing"}
        </button>
      </div>
      <div className="p-5">
        {loading && !result ? (
          <div className="space-y-4">
            <div className="h-24 rounded-2xl bg-sd-surface animate-pulse" />
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-24 rounded-2xl bg-sd-surface animate-pulse" style={{ animationDelay: `${i * 90}ms` }} />
              ))}
            </div>
          </div>
        ) : !result ? (
          <EmptyState
            icon={Sparkles}
            title="No briefing yet"
            body="Generate a briefing to get a narrated snapshot of workload, risks and next steps."
          />
        ) : (
          <div className="space-y-6">
            {result.ok ? (
              <div className="rounded-2xl bg-[#176B52]/[0.06] border border-[#176B52]/15 p-4 sm:p-5">
                <div className="flex items-center gap-2 text-sd-forest font-semibold text-sm mb-2">
                  <Sparkles className="w-4 h-4" /> Briefing
                </div>
                <p className="text-sm text-sd-ink leading-relaxed whitespace-pre-wrap">{(result.summary ?? "").replace(/\*\*/g, "").replace(/^#+\s*/gm, "")}</p>
              </div>
            ) : (
              <div className="rounded-2xl bg-[#D99A32]/10 border border-[#D99A32]/25 p-4 text-sm text-[#96660d] flex items-start gap-2.5 leading-relaxed">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{result.error}</span>
              </div>
            )}

            {stats && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                  <KpiCard label="Open requests" value={stats.openRequests} icon={Wrench} tone="amber" />
                  <KpiCard label="Jobs in progress" value={stats.jobsInProgress} icon={HardHat} tone="forest" delay={0.05} />
                  <KpiCard label="Awaiting customer OTP" value={stats.jobsAwaitingCustomer} icon={Clock} tone="slate" delay={0.1} />
                  <KpiCard label="Overdue maintenance" value={stats.overdueMaintenance} icon={CalendarDays} tone="error" delay={0.15} />
                  <KpiCard label="AMC expiring soon" value={stats.amcExpiringSoon} icon={FileText} tone="amber" delay={0.2} />
                </div>

                {unresolved.length > 0 && (
                  <div>
                    <div className="text-[0.68rem] font-bold uppercase tracking-wide text-sd-ink-soft mb-2">
                      Unresolved requests by category
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {unresolved.map(([cat, n]) => (
                        <span key={cat} className="sd-pill sd-pill-slate">
                          {REQUEST_CATEGORY_LABELS[cat] ?? cat}: {n}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-[0.68rem] font-bold uppercase tracking-wide text-sd-ink-soft mb-3">
                    Technician workload (active jobs)
                  </div>
                  {stats.technicianWorkload.length === 0 ? (
                    <p className="text-sm text-sd-ink-soft">No active technicians on record.</p>
                  ) : (
                    <ul className="space-y-2.5">
                      {stats.technicianWorkload.map((w) => (
                        <li key={w.name} className="flex items-center gap-3 text-sm">
                          <span className="w-32 sm:w-44 truncate text-sd-ink font-medium">{w.name}</span>
                          <span className="flex-1 h-2 rounded-full bg-sd-inset overflow-hidden" aria-hidden="true">
                            <span
                              className="block h-full rounded-full bg-sd-forest"
                              style={{ width: `${Math.round((w.activeJobs / maxJobs) * 100)}%` }}
                            />
                          </span>
                          <span className="text-xs font-semibold text-sd-ink w-16 text-right shrink-0">
                            {w.activeJobs} job{w.activeJobs === 1 ? "" : "s"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 3. Complaint triage ─────────────────────────────────────────
function TriagePane() {
  const [requestId, setRequestId] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [applying, setApplying] = useState(false);
  const [suggestion, setSuggestion] = useState<ClassifySuggestion | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const newList = useApi<RequestsListResponse>("/api/requests" + qs({ status: "NEW", page: 1, pageSize: 20 }));
  const reviewList = useApi<RequestsListResponse>("/api/requests" + qs({ status: "UNDER_REVIEW", page: 1, pageSize: 20 }));

  const options = useMemo(() => {
    const merged = [...(newList.data?.requests ?? []), ...(reviewList.data?.requests ?? [])];
    merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return merged;
  }, [newList.data, reviewList.data]);
  const selected = options.find((r) => r.id === requestId) ?? null;

  const loading = newList.loading || reviewList.loading;
  const error = newList.error ?? reviewList.error;
  const refreshBoth = () => { newList.refresh(); reviewList.refresh(); };

  const reset = () => {
    setRequestId("");
    setSuggestion(null);
    setNote(null);
    setAiError(null);
  };

  const classify = async () => {
    if (!requestId || classifying) return;
    setClassifying(true);
    setSuggestion(null);
    setNote(null);
    setAiError(null);
    try {
      const res = await api<ClassifyResponse>("/api/ai/classify", { method: "POST", json: { requestId } });
      if (res.ok && res.suggestion) {
        setSuggestion(res.suggestion);
        setNote(res.note ?? "Review before applying — AI never changes records automatically.");
      } else {
        setAiError(res.error ?? "The AI service could not process this complaint right now.");
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Couldn't classify",
        description: e instanceof Error ? e.message : "Please try again in a moment.",
      });
    } finally {
      setClassifying(false);
    }
  };

  const apply = async () => {
    if (!selected || !suggestion || applying) return;
    setApplying(true);
    try {
      await api("/api/ai/classify", {
        method: "PUT",
        json: {
          requestId: selected.id,
          category: suggestion.category,
          priority: suggestion.priority,
          summary: suggestion.summary,
        },
      });
      toast({
        title: `Suggestion applied to ${selected.code}`,
        description: "Category, priority and the AI summary note were updated on the request.",
      });
      refreshBoth();
      reset();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Couldn't apply suggestion",
        description: e instanceof Error ? e.message : "Please try again in a moment.",
      });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="sd-clay p-5">
      <h3 className="font-semibold text-sd-ink text-[0.95rem]">Complaint triage</h3>
      <p className="text-xs text-sd-ink-soft mt-0.5 max-w-lg leading-relaxed">
        AI suggests a classification for a request; you review and apply it. Nothing changes without your approval.
      </p>

      <div className="mt-4">
        {loading ? (
          <SkeletonRows rows={4} />
        ) : error ? (
          <div className="rounded-2xl bg-[#C94B55]/8 border border-[#C94B55]/20 p-4 text-sm">
            <div className="text-[#a03340] font-semibold mb-1">We couldn&apos;t load the request queue</div>
            <div className="text-sd-ink-soft">{error}</div>
            <button onClick={refreshBoth} className="mt-3 sd-btn-primary px-4 py-2 text-xs font-semibold sd-focus">
              Try again
            </button>
          </div>
        ) : options.length === 0 ? (
          <EmptyState
            icon={Wand2}
            title="Nothing to triage"
            body="There are no new or under-review requests right now."
          />
        ) : (
          <div className="space-y-4">
            <div>
              <span className="text-sm font-semibold text-sd-ink">Pick a request</span>
              <div className="mt-1.5">
                <Select
                  value={requestId}
                  onValueChange={(v) => {
                    setRequestId(v);
                    setSuggestion(null);
                    setAiError(null);
                    setNote(null);
                  }}
                >
                  <SelectTrigger aria-label="Select request to classify" className="w-full h-11 rounded-xl bg-sd-inset border-sd-line text-sd-ink">
                    <SelectValue placeholder="Choose a request to classify" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.code} — {r.customer?.name ?? "Customer"} — {excerpt(r.description, 42)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {selected && (
              <div className="sd-inset p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-sd-ink text-sm">{selected.code}</span>
                  <StatusPill status={selected.status} />
                  <PriorityPill priority={selected.priority} className="ml-auto" />
                </div>
                <div className="text-xs text-sd-ink-soft mt-1.5 leading-relaxed">
                  {selected.customer?.name ?? "Customer"}
                  {selected.customer?.city ? ` · ${selected.customer.city}` : ""} · raised {fmtDateTime(selected.createdAt)} ·
                  currently {REQUEST_CATEGORY_LABELS[selected.category] ?? selected.category}
                </div>
                <p className="mt-2.5 text-sm text-sd-ink leading-relaxed">{selected.description}</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                onClick={classify}
                disabled={!requestId || classifying}
                className="sd-btn-primary px-4 py-2.5 text-sm font-semibold sd-focus inline-flex items-center gap-2 disabled:cursor-not-allowed"
              >
                {classifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {classifying ? "Classifying…" : "Classify with AI"}
              </button>
              {(suggestion || aiError) && (
                <button
                  onClick={reset}
                  className="rounded-xl border border-sd-line bg-white px-4 py-2.5 text-sm font-medium text-sd-ink-soft hover:text-sd-ink sd-focus"
                >
                  Clear
                </button>
              )}
            </div>

            {aiError && (
              <div className="rounded-2xl bg-[#D99A32]/10 border border-[#D99A32]/25 p-4 text-sm text-[#96660d] flex items-start gap-2.5 leading-relaxed">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{aiError}</span>
              </div>
            )}

            {suggestion && (
              <div className="rounded-2xl border border-[#176B52]/20 bg-[#176B52]/[0.05] p-4 sm:p-5">
                <div className="flex items-center gap-2 text-sd-forest font-semibold text-sm">
                  <Sparkles className="w-4 h-4" /> AI suggestion
                </div>
                <p className="mt-1 text-xs text-sd-ink-soft leading-relaxed">
                  {note ?? "Review before applying — AI never changes records automatically."}
                </p>
                <dl className="mt-3.5 space-y-3 text-sm">
                  <div className="flex items-center gap-3">
                    <dt className="w-24 shrink-0 text-sd-ink-soft">Category</dt>
                    <dd className="font-semibold text-sd-ink">
                      {REQUEST_CATEGORY_LABELS[suggestion.category] ?? suggestion.category}
                    </dd>
                  </div>
                  <div className="flex items-center gap-3">
                    <dt className="w-24 shrink-0 text-sd-ink-soft">Priority</dt>
                    <dd><PriorityPill priority={suggestion.priority} /></dd>
                  </div>
                  <div className="flex items-start gap-3">
                    <dt className="w-24 shrink-0 text-sd-ink-soft">Summary</dt>
                    <dd className="text-sd-ink leading-relaxed">{suggestion.summary}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    onClick={apply}
                    disabled={applying}
                    className="sd-btn-primary px-4 py-2.5 text-sm font-semibold sd-focus inline-flex items-center gap-2 disabled:cursor-not-allowed"
                  >
                    {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Apply to request
                  </button>
                  <span className="text-xs text-sd-ink-soft">
                    Applies category, priority and an AI summary note to {selected?.code ?? "the request"}.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
