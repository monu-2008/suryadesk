"use client";
// Organization Settings — profile form, honest integration status cards,
// demo data reset (demo orgs only) and owner-only audit trail.
import { useEffect, useState } from "react";
import {
  Check, FlaskConical, History, Info, Loader2, Lock, Mail, MessageSquare,
  RotateCcw, Sparkles, TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, useApi } from "@/lib/surya/client";
import { fmtDateTime } from "@/lib/surya/types";
import { EmptyState, PageHeader, SectionCard, SkeletonRows } from "../shared/bits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface OrgProfile {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  phone: string | null;
  email: string | null;
  supportEmail: string | null;
  address: string | null;
  plan: string;
  isDemo: boolean;
}

interface MetaResponse {
  org: OrgProfile;
  integrations: { smtpConfigured: boolean; smsConfigured: boolean; aiConfigured: boolean };
  demoAccounts: { email: string; role: string; name: string; password: string }[] | null;
}

interface AuditEvent {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  detail: string | null;
  createdAt: string;
  actor: { name: string; email: string } | null;
}

interface AuditResponse {
  events: AuditEvent[];
}

type TabKey = "profile" | "integrations" | "demo" | "audit";

interface ProfileForm {
  name: string;
  city: string;
  phone: string;
  email: string;
  supportEmail: string;
  address: string;
}

const INPUT_CLS =
  "sd-inset px-3.5 py-2.5 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-sd-forest/40 w-full";

const CONFIRM_PHRASE = "RESET DEMO DATA";

// file-local error card with retry (kept per contract: no new shared files)
function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="sd-clay p-5 flex flex-col sm:flex-row items-start gap-4" role="alert">
      <div className="rounded-2xl bg-[#C94B55]/10 p-3 shrink-0">
        <TriangleAlert className="w-5 h-5 text-[#a03340]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-sd-ink text-sm">Couldn&apos;t load settings</div>
        <p className="text-xs text-sd-ink-soft mt-1 leading-relaxed">{message}</p>
      </div>
      <button onClick={onRetry} className="sd-btn-primary px-4 py-2 text-xs font-semibold sd-focus shrink-0">
        Try again
      </button>
    </div>
  );
}

// honest status card for one integration
function IntegrationCard({
  icon: Icon, title, sub, configured, readyLabel, readyBody, pendingLabel, pendingBody, envVars, hint,
}: {
  icon: LucideIcon;
  title: string;
  sub: string;
  configured: boolean;
  readyLabel: string;
  readyBody: string;
  pendingLabel: string;
  pendingBody: string;
  envVars: string[];
  hint: string;
}) {
  return (
    <div className="sd-clay p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-2xl bg-sd-surface p-2.5 shrink-0">
            <Icon className="w-5 h-5 text-sd-forest" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sd-ink text-sm leading-tight">{title}</div>
            <div className="text-[0.7rem] text-sd-ink-soft mt-0.5">{sub}</div>
          </div>
        </div>
        <span className={cn("sd-pill shrink-0", configured ? "sd-pill-green" : "sd-pill-amber")}>
          {configured ? readyLabel : pendingLabel}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-sd-ink-soft">{configured ? readyBody : pendingBody}</p>
      <div className="sd-inset p-3.5 mt-auto">
        <div className="text-[0.6rem] font-bold uppercase tracking-[0.08em] text-sd-ink-soft/80">Setup</div>
        <div className="font-mono text-[0.7rem] text-sd-forest mt-1.5 leading-relaxed break-words">
          {envVars.join(" · ")}
        </div>
        <p className="text-[0.66rem] text-sd-ink-soft mt-1.5 leading-relaxed">{hint}</p>
      </div>
    </div>
  );
}

function auditTone(action: string): string {
  if (action.includes("DEACTIVATED")) return "sd-pill-amber";
  if (action.includes("ROLE_CHANGED")) return "sd-pill-violet";
  if (action.includes("CREATED")) return "sd-pill-green";
  if (action.includes("UPDATED")) return "sd-pill-teal";
  if (action.includes("DELETED") || action.includes("REMOVED")) return "sd-pill-red";
  return "sd-pill-slate";
}

export default function SettingsView({ onDemoReset }: { onDemoReset: () => void }) {
  const [tab, setTab] = useState<TabKey>("profile");
  const meta = useApi<MetaResponse>("/api/meta");
  const audit = useApi<AuditResponse>(tab === "audit" ? "/api/audit" : null);

  const org = meta.data?.org ?? null;
  const integrations = meta.data?.integrations;

  // profile form (hydrated once from the org, re-hydrated after a demo reset)
  const [form, setForm] = useState<ProfileForm>({ name: "", city: "", phone: "", email: "", supportEmail: "", address: "" });
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (org && !hydrated) {
      setForm({
        name: org.name ?? "",
        city: org.city ?? "",
        phone: org.phone ?? "",
        email: org.email ?? "",
        supportEmail: org.supportEmail ?? "",
        address: org.address ?? "",
      });
      setHydrated(true);
    }
  }, [org, hydrated]);

  const isDirty =
    !!org &&
    (form.name.trim() !== (org.name ?? "").trim() ||
      form.city.trim() !== (org.city ?? "").trim() ||
      form.phone.trim() !== (org.phone ?? "").trim() ||
      form.email.trim() !== (org.email ?? "").trim() ||
      form.supportEmail.trim() !== (org.supportEmail ?? "").trim() ||
      form.address.trim() !== (org.address ?? "").trim());
  const canSave = !!org && isDirty && form.name.trim() !== "" && !saving;

  // demo reset state
  const [confirmText, setConfirmText] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const saveProfile = async () => {
    if (!org || !canSave) return;
    setSaving(true);
    try {
      await api<{ org: OrgProfile }>("/api/meta", {
        method: "PATCH",
        json: {
          name: form.name.trim(),
          city: form.city.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          supportEmail: form.supportEmail.trim(),
          address: form.address.trim(),
        },
      });
      toast({ title: "Profile saved", description: "Organization details were updated." });
      await meta.refresh();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Couldn't save profile",
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      const res = await api<{ ok?: boolean; message?: string }>("/api/demo/reset", {
        method: "POST",
        json: { confirm: CONFIRM_PHRASE },
      });
      toast({ title: "Demo data reset", description: res.message ?? "The demo organization was reseeded." });
      setConfirmText("");
      setHydrated(false); // re-hydrate the form from the freshly seeded org
      await meta.refresh();
      onDemoReset();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Reset failed",
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setResetting(false);
      setResetOpen(false);
    }
  };

  // whole-view states
  if (meta.loading && !meta.data) {
    return (
      <div className="space-y-5">
        <PageHeader title="Organization Settings" />
        <SkeletonRows rows={8} />
      </div>
    );
  }
  if (meta.error || !org) {
    return (
      <div className="space-y-5">
        <PageHeader title="Organization Settings" />
        <LoadError message={meta.error ?? "Organization not found."} onRetry={meta.refresh} />
      </div>
    );
  }

  const auditEvents = audit.data?.events ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Organization Settings" subtitle="Profile, integrations, demo data and audit trail." />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="space-y-5">
        <TabsList className="w-full sm:w-auto overflow-x-auto rounded-2xl h-auto p-1">
          <TabsTrigger value="profile" className="shrink-0 rounded-xl px-4 py-2">Profile</TabsTrigger>
          <TabsTrigger value="integrations" className="shrink-0 rounded-xl px-4 py-2">Integrations</TabsTrigger>
          <TabsTrigger value="demo" className="shrink-0 rounded-xl px-4 py-2">Demo data</TabsTrigger>
          <TabsTrigger value="audit" className="shrink-0 rounded-xl px-4 py-2">Audit trail</TabsTrigger>
        </TabsList>

        {/* ── Profile ── */}
        <TabsContent value="profile">
          <SectionCard
            title="Organization profile"
            subtitle="Shown on customer-facing documents, invitations and notifications."
          >
            <div className="flex flex-wrap items-center gap-2 mb-5">
              <span className="sd-pill sd-pill-slate font-mono normal-case" title="Workspace URL slug — read only">
                /{org.slug}
              </span>
              <span className="sd-pill sd-pill-teal uppercase" title="Billing plan — read only">{org.plan}</span>
              {org.isDemo && <span className="sd-pill sd-pill-amber">Demo organization</span>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="org-name" className="block text-xs font-semibold text-sd-ink-soft mb-1.5">
                  Organization name <span className="text-[#a03340]">*</span>
                </label>
                <input
                  id="org-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Sunbeam Solar Services"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="org-city" className="block text-xs font-semibold text-sd-ink-soft mb-1.5">City</label>
                <input
                  id="org-city"
                  value={form.city}
                  onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  placeholder="e.g. Pune"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="org-phone" className="block text-xs font-semibold text-sd-ink-soft mb-1.5">Phone</label>
                <input
                  id="org-phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+91 98xxxxxx00"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="org-email" className="block text-xs font-semibold text-sd-ink-soft mb-1.5">Email</label>
                <input
                  id="org-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="hello@example.com"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="org-support" className="block text-xs font-semibold text-sd-ink-soft mb-1.5">
                  Support email
                </label>
                <input
                  id="org-support"
                  type="email"
                  value={form.supportEmail}
                  onChange={(e) => setForm((f) => ({ ...f, supportEmail: e.target.value }))}
                  placeholder="support@example.com"
                  className={INPUT_CLS}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="org-address" className="block text-xs font-semibold text-sd-ink-soft mb-1.5">Address</label>
                <textarea
                  id="org-address"
                  rows={2}
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="Office address shown on service documents"
                  className={cn(INPUT_CLS, "resize-y min-h-[2.75rem]")}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 justify-end mt-5">
              {isDirty && (
                <button
                  onClick={() =>
                    setForm({
                      name: org.name ?? "",
                      city: org.city ?? "",
                      phone: org.phone ?? "",
                      email: org.email ?? "",
                      supportEmail: org.supportEmail ?? "",
                      address: org.address ?? "",
                    })
                  }
                  className="text-xs font-semibold text-sd-ink-soft hover:text-[#a03340] transition-colors sd-focus rounded-lg px-2 py-1"
                >
                  Discard changes
                </button>
              )}
              <button
                onClick={saveProfile}
                disabled={!canSave}
                className="sd-btn-primary px-5 py-2.5 text-sm font-semibold sd-focus flex items-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Check className="w-4 h-4" aria-hidden="true" />}
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </SectionCard>
        </TabsContent>

        {/* ── Integrations ── */}
        <TabsContent value="integrations">
          {!integrations ? (
            <SkeletonRows rows={3} />
          ) : (
            <div className="grid gap-4 md:grid-cols-3 items-stretch">
              <IntegrationCard
                icon={Mail}
                title="Email (SMTP)"
                sub="Transactional email"
                configured={integrations.smtpConfigured}
                readyLabel="Configured"
                readyBody="Verification, invitation and service emails are delivered via SMTP."
                pendingLabel="Queued only"
                pendingBody="Queued only — SMTP_HOST/SMTP_USER are not set in this environment. Emails are recorded as queued notifications instead of being sent."
                envVars={["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]}
                hint="Set these on the server and restart — delivery switches from queued notifications to real email."
              />
              <IntegrationCard
                icon={MessageSquare}
                title="SMS"
                sub="Service OTP delivery"
                configured={integrations.smsConfigured}
                readyLabel="Connected"
                readyBody="Service OTP codes are delivered to customers by SMS."
                pendingLabel="Test mode"
                pendingBody="Service OTP runs in clearly-labeled TEST mode: codes are shown in the technician app instead of being sent by SMS."
                envVars={["SMS_PROVIDER", "SMS_API_KEY"]}
                hint="Add a provider (e.g. Twilio or MSG91) to send real OTP messages."
              />
              <IntegrationCard
                icon={Sparkles}
                title="AI assistant"
                sub="Report drafting"
                configured={integrations.aiConfigured}
                readyLabel="Connected"
                readyBody="z-ai provider connected. Technicians can draft service report summaries with AI assistance."
                pendingLabel="Unavailable"
                pendingBody="The z-ai provider is not reachable in this environment; AI drafting is disabled."
                envVars={["Platform-managed"]}
                hint="Provided by the bundled z-ai provider — no keys to configure."
              />
            </div>
          )}
        </TabsContent>

        {/* ── Demo data ── */}
        <TabsContent value="demo">
          {!org.isDemo ? (
            <div className="sd-clay p-5 flex items-start gap-4">
              <div className="rounded-2xl bg-sd-surface p-3 shrink-0">
                <Info className="w-5 h-5 text-sd-ink-soft" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-sd-ink text-sm">Demo reset is not available for this organization.</div>
                <p className="text-xs text-sd-ink-soft mt-1 leading-relaxed max-w-lg">
                  Reset only applies to the disposable demo organization. This workspace holds live data and can never be reset from the UI.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="sd-clay p-5 flex items-start gap-4">
                <div className="rounded-2xl bg-[#D99A32]/12 p-3 shrink-0">
                  <FlaskConical className="w-5 h-5 text-[#96660d]" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-sd-ink text-sm">
                    This is the disposable demo organization (fictional data only)
                  </div>
                  <p className="text-xs text-sd-ink-soft mt-1 leading-relaxed max-w-xl">
                    Resetting wipes all demo customers, installations, jobs, reports and notifications, then reseeds a
                    fresh fictional dataset. User accounts and sign-in sessions survive — you stay signed in.
                  </p>
                </div>
              </div>

              <SectionCard
                title="Reset demo data"
                subtitle={`Type ${CONFIRM_PHRASE} exactly to unlock the reset button.`}
              >
                <label htmlFor="demo-confirm" className="block text-xs font-semibold text-sd-ink-soft mb-1.5">
                  Confirmation phrase
                </label>
                <input
                  id="demo-confirm"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={CONFIRM_PHRASE}
                  autoComplete="off"
                  spellCheck={false}
                  className={cn(INPUT_CLS, "font-mono tracking-[0.12em] uppercase")}
                />
                <p className="text-[0.68rem] text-sd-ink-soft mt-2">
                  This exact phrase is required — it guards against accidental resets.
                </p>
                <div className="flex justify-end mt-4">
                  <button
                    onClick={() => setResetOpen(true)}
                    disabled={confirmText !== CONFIRM_PHRASE || resetting}
                    className="sd-btn-primary px-5 py-2.5 text-sm font-semibold sd-focus flex items-center gap-2"
                  >
                    <RotateCcw className="w-4 h-4" aria-hidden="true" />
                    {resetting ? "Resetting…" : "Reset demo data"}
                  </button>
                </div>
              </SectionCard>
            </div>
          )}
        </TabsContent>

        {/* ── Audit trail ── */}
        <TabsContent value="audit">
          {audit.loading && !audit.data ? (
            <SkeletonRows rows={6} />
          ) : audit.error ? (
            <div className="sd-clay p-5 flex items-start gap-4" role="alert">
              <div className="rounded-2xl bg-[#D99A32]/12 p-3 shrink-0">
                <Lock className="w-5 h-5 text-[#96660d]" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sd-ink text-sm">Owner access required</div>
                <p className="text-xs text-sd-ink-soft mt-1 leading-relaxed max-w-lg">
                  The audit trail is restricted to organization owners. Sign in with an owner account to review recent activity.
                </p>
                <p className="text-[0.66rem] text-sd-ink-soft/70 mt-2">{audit.error}</p>
                <button
                  onClick={() => audit.refresh()}
                  className="mt-2 text-xs font-semibold text-sd-forest hover:underline sd-focus rounded"
                >
                  Try again
                </button>
              </div>
            </div>
          ) : auditEvents.length === 0 ? (
            <EmptyState
              icon={History}
              title="No audit events yet"
              body="Profile updates, role changes and other actions will appear here."
            />
          ) : (
            <div className="max-h-[34rem] overflow-y-auto sd-scroll space-y-2.5 pr-1" aria-label="Audit events">
              {auditEvents.map((e) => (
                <article key={e.id} className="sd-clay-sm p-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className={cn("sd-pill font-mono normal-case", auditTone(e.action))}>{e.action}</span>
                    <span className="text-[0.66rem] text-sd-ink-soft whitespace-nowrap shrink-0">
                      {fmtDateTime(e.createdAt)}
                    </span>
                  </div>
                  {e.detail && <p className="text-sm text-sd-ink mt-2 leading-snug break-words">{e.detail}</p>}
                  <div className="text-[0.7rem] text-sd-ink-soft mt-2 leading-relaxed">
                    {e.actor ? (
                      <>
                        {e.actor.name} · {e.actor.email}
                      </>
                    ) : (
                      "System"
                    )}
                    <span className="text-sd-ink-soft/60"> · {e.entityType ?? "—"}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* demo reset confirmation */}
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset demo data?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes and reseeds ONLY the demo organization&apos;s records. User accounts and sessions survive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl" disabled={resetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetting}
              onClick={(e) => {
                e.preventDefault();
                handleReset();
              }}
              className="rounded-xl bg-[#C94B55] text-white hover:bg-[#b53a44] focus-visible:ring-[#C94B55]/40"
            >
              {resetting && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
              Yes, reset now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
