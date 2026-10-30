"use client";
// SuryaDesk · Manager workspace · Customers module
// List + create/edit/invite/archive + 360° customer detail dialog.

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle, Archive, CalendarDays, Check, ChevronLeft, ChevronRight, Copy,
  Eye, FileText, KeyRound, Loader2, Mail, MapPin, MoreHorizontal, Pencil, Phone, Search, Send,
  StickyNote, UserPlus, Users, Wrench,
} from "lucide-react";
import { api, qs, useApi } from "@/lib/surya/client";
import { fmtDate, REQUEST_CATEGORY_LABELS } from "@/lib/surya/types";
import { toast } from "@/hooks/use-toast";
import {
  EmptyState, LoadingBlock, PageHeader, SdAvatar, SectionCard, SkeletonRows, StatusPill, TableShell,
} from "../shared/bits";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

// ── API types (contract) ────────────────────────────────────────────────
export interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
  portalStatus: string;
  notes: string | null;
  installationCount: number;
  totalCapacityKw: number | null;
  amcActive: boolean;
  lastService: string | null;
  createdAt: string;
}

interface CustomerListResp {
  total: number;
  page: number;
  pageSize: number;
  customers: CustomerRow[];
}

interface MetaResp {
  customers: { id: string; name: string; city: string | null }[];
  cities: string[];
}

interface InstLite {
  id: string;
  assetCode: string;
  capacityKw: number | null;
  installDate: string | null;
  amcContracts: { status: string }[];
  warranties: { kind: string; status: string; endDate: string | null }[];
}

interface AmcLite { id: string; contractCode: string; startDate: string | null; endDate: string | null; status: string }
interface RequestLite { id: string; code: string; category: string; status: string; createdAt?: string | null }
interface JobLite { id: string; code: string; title: string | null; status: string; scheduledFor: string | null }
interface ReportLite { id: string; code?: string | null; title?: string | null; summary: string | null; createdAt?: string | null }

interface CustomerDetail extends CustomerRow {
  installations: InstLite[];
  amcContracts: AmcLite[];
  requests: RequestLite[];
  jobs: JobLite[];
  reports: ReportLite[];
}

// ── shared local helpers ────────────────────────────────────────────────
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const inputCls =
  "sd-inset px-3.5 py-2.5 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-sd-forest/40 w-full";
const selectCls =
  "sd-inset w-full h-auto px-3.5 py-2.5 text-sm text-sd-ink font-normal border-0 shadow-none focus-visible:ring-2 focus-visible:ring-sd-forest/40 data-[placeholder]:text-sd-ink-soft/60";
const btnPrimary =
  "sd-btn-primary sd-focus px-4 py-2 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed";
const btnGhost =
  "sd-clay-sm sd-focus sd-press px-3.5 py-2 text-sm font-medium text-sd-ink hover:bg-sd-surface transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed";
const thCls = "text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide whitespace-nowrap";
const tdCls = "px-4 py-3.5 border-t border-sd-line/70 align-middle";
const monoBadge =
  "font-mono text-[0.7rem] font-semibold text-sd-forest bg-sd-surface rounded-lg px-2 py-1 whitespace-nowrap";

function Field({ label, required, children, className }: { label: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={"space-y-1.5 " + (className ?? "")}>
      <label className="text-xs font-semibold text-sd-ink-soft tracking-wide">
        {label}
        {required && <span className="text-[#C94B55]"> *</span>}
      </label>
      {children}
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="sd-clay p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-[#C94B55]/10 p-2.5 shrink-0">
          <AlertTriangle className="w-4 h-4 text-[#a03340]" />
        </div>
        <div>
          <div className="font-semibold text-sd-ink text-sm">Couldn&apos;t load customers</div>
          <div className="text-xs text-sd-ink-soft mt-0.5">{message}</div>
        </div>
      </div>
      <button className={btnGhost} onClick={onRetry}>Retry</button>
    </div>
  );
}

function MiniEmpty({ text }: { text: string }) {
  return <div className="py-8 text-center text-sm text-sd-ink-soft">{text}</div>;
}

function PortalPill({ status }: { status: string }) {
  if (status === "ACTIVE") return <span className="sd-pill sd-pill-green">Active</span>;
  if (status === "INVITED") return <span className="sd-pill sd-pill-teal">Invited</span>;
  return <span className="sd-pill sd-pill-slate">Not invited</span>;
}

function fmtKw(n: number | null | undefined): string {
  return n == null ? "—" : `${n} kW`;
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="w-4 h-4 text-sd-ink-soft mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-[0.68rem] uppercase tracking-wide text-sd-ink-soft font-semibold">{label}</div>
        <div className="text-sm text-sd-ink mt-0.5 break-words">{value}</div>
      </div>
    </div>
  );
}

// ── customer detail dialog ──────────────────────────────────────────────
function CustomerDetailDialog({
  customerId, onClose, onChanged,
}: { customerId: string; onClose: () => void; onChanged: () => void }) {
  const { data, loading, error, refresh } = useApi<{ customer: CustomerDetail }>(`/api/customers/${customerId}`);
  const cust = data?.customer;

  const [edit, setEdit] = useState<{ name: string; email: string; phone: string; city: string; address: string; notes: string } | null>(null);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    if (!cust) return;
    setEdit({
      name: cust.name ?? "",
      email: cust.email ?? "",
      phone: cust.phone ?? "",
      city: cust.city ?? "",
      address: cust.address ?? "",
      notes: cust.notes ?? "",
    });
  }

  async function saveEdit() {
    if (!cust || !edit) return;
    if (!edit.name.trim() || !edit.phone.trim() || !edit.city.trim()) {
      toast({ variant: "destructive", title: "Check the form", description: "Name, phone and city are required." });
      return;
    }
    setSaving(true);
    try {
      await api(`/api/customers/${cust.id}`, {
        method: "PATCH",
        json: {
          name: edit.name.trim(),
          email: edit.email.trim() || undefined,
          phone: edit.phone.trim(),
          city: edit.city.trim(),
          address: edit.address.trim() || undefined,
          notes: edit.notes.trim() || undefined,
        },
      });
      toast({ title: "Customer updated", description: `${edit.name.trim()}'s details were saved.` });
      setEdit(null);
      refresh();
      onChanged();
    } catch (e) {
      toast({ variant: "destructive", title: "Update failed", description: e instanceof Error ? e.message : "Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-3xl w-[calc(100%-2rem)] p-0 gap-0 rounded-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <DialogTitle className="sr-only">Loading customer</DialogTitle>
        {loading && <div className="p-6"><LoadingBlock label="Loading customer…" /></div>}
        {error && <div className="p-6"><ErrorCard message={error} onRetry={refresh} /></div>}
        {cust && (
          <>
            <DialogHeader className="px-5 sm:px-6 pt-5 pb-3 shrink-0">
              <div className="flex items-start justify-between gap-3 pr-8">
                <div className="flex items-center gap-3.5 min-w-0">
                  <SdAvatar name={cust.name} size={46} />
                  <div className="min-w-0">
                    <DialogTitle className="text-lg font-bold text-sd-ink truncate">{cust.name}</DialogTitle>
                    <DialogDescription className="text-sm text-sd-ink-soft truncate">
                      {cust.email ?? "No email"} · {cust.phone ?? "No phone"}
                    </DialogDescription>
                  </div>
                </div>
                <PortalPill status={cust.portalStatus} />
              </div>
            </DialogHeader>

            <div className="px-5 sm:px-6 pb-5 overflow-y-auto sd-scroll">
              <Tabs defaultValue="overview">
                <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-sd-inset rounded-[0.875rem] p-1">
                  {[
                    ["overview", "Overview"],
                    ["installations", `Installations (${cust.installations.length})`],
                    ["amc", `AMC (${cust.amcContracts.length})`],
                    ["complaints", `Complaints (${cust.requests.length})`],
                    ["service", `Service (${cust.jobs.length})`],
                    ["reports", `Reports (${cust.reports.length})`],
                  ].map(([v, l]) => (
                    <TabsTrigger
                      key={v}
                      value={v}
                      className="h-auto flex-none px-3 py-1.5 text-xs font-medium rounded-[0.6rem] text-sd-ink-soft data-[state=active]:bg-[var(--card)] data-[state=active]:text-sd-ink data-[state=active]:shadow-sm border-transparent"
                    >
                      {l}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {/* Overview */}
                <TabsContent value="overview" className="mt-4 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <InfoRow icon={Mail} label="Email" value={cust.email ?? "—"} />
                    <InfoRow icon={Phone} label="Phone" value={cust.phone ?? "—"} />
                    <InfoRow icon={MapPin} label="City" value={cust.city ?? "—"} />
                    <InfoRow icon={MapPin} label="Address" value={cust.address ?? "—"} />
                    <InfoRow icon={CalendarDays} label="Customer since" value={fmtDate(cust.createdAt)} />
                    <InfoRow icon={Wrench} label="Last service" value={cust.lastService ? fmtDate(cust.lastService) : "No service yet"} />
                  </div>
                  {cust.notes && (
                    <div className="sd-inset p-4 flex items-start gap-2.5">
                      <StickyNote className="w-4 h-4 text-sd-ink-soft mt-0.5 shrink-0" />
                      <p className="text-sm text-sd-ink whitespace-pre-wrap">{cust.notes}</p>
                    </div>
                  )}

                  <SectionCard
                    title="Edit details"
                    actions={
                      edit ? undefined : (
                        <button className={btnGhost} onClick={startEdit}>
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </button>
                      )
                    }
                  >
                    {edit ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field label="Name" required>
                          <Input className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                        </Field>
                        <Field label="Email">
                          <Input className={inputCls} type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
                        </Field>
                        <Field label="Phone" required>
                          <Input className={inputCls} value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
                        </Field>
                        <Field label="City" required>
                          <Input className={inputCls} value={edit.city} onChange={(e) => setEdit({ ...edit, city: e.target.value })} />
                        </Field>
                        <Field label="Address" className="sm:col-span-2">
                          <Input className={inputCls} value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
                        </Field>
                        <Field label="Notes" className="sm:col-span-2">
                          <Textarea className={inputCls + " min-h-20"} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
                        </Field>
                        <div className="sm:col-span-2 flex items-center gap-2 justify-end">
                          <button className={btnGhost} onClick={() => setEdit(null)} disabled={saving}>Cancel</button>
                          <button className={btnPrimary} onClick={saveEdit} disabled={saving}>
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save changes
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-sd-ink-soft">Update contact details, address or notes for this customer.</p>
                    )}
                  </SectionCard>
                </TabsContent>

                {/* Installations */}
                <TabsContent value="installations" className="mt-4">
                  {cust.installations.length === 0 ? (
                    <MiniEmpty text="No installations registered for this customer yet." />
                  ) : (
                    <ul className="divide-y divide-sd-line/70">
                      {cust.installations.map((inst) => {
                        const amc = inst.amcContracts.find((c) => c.status === "ACTIVE") ?? inst.amcContracts[0];
                        return (
                          <li key={inst.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className={monoBadge}>{inst.assetCode}</span>
                              <span className="text-sm font-semibold text-sd-ink">{fmtKw(inst.capacityKw)}</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-sd-ink-soft flex-wrap">
                              <span>Installed {fmtDate(inst.installDate)}</span>
                              {amc ? <StatusPill status={amc.status} /> : <span>—</span>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </TabsContent>

                {/* AMC contracts */}
                <TabsContent value="amc" className="mt-4">
                  {cust.amcContracts.length === 0 ? (
                    <MiniEmpty text="No AMC contracts for this customer yet." />
                  ) : (
                    <ul className="divide-y divide-sd-line/70">
                      {cust.amcContracts.map((c) => (
                        <li key={c.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                          <span className={monoBadge}>{c.contractCode}</span>
                          <div className="flex items-center gap-3 text-xs text-sd-ink-soft flex-wrap">
                            <span>{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</span>
                            <StatusPill status={c.status} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                {/* Complaints */}
                <TabsContent value="complaints" className="mt-4">
                  {cust.requests.length === 0 ? (
                    <MiniEmpty text="No complaints raised by this customer." />
                  ) : (
                    <ul className="divide-y divide-sd-line/70">
                      {cust.requests.map((r) => (
                        <li key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className={monoBadge}>{r.code}</span>
                            <span className="text-sm text-sd-ink">{REQUEST_CATEGORY_LABELS[r.category] ?? r.category}</span>
                          </div>
                          <StatusPill status={r.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                {/* Service history */}
                <TabsContent value="service" className="mt-4">
                  {cust.jobs.length === 0 ? (
                    <MiniEmpty text="No service jobs recorded yet." />
                  ) : (
                    <ul className="divide-y divide-sd-line/70">
                      {cust.jobs.map((j) => (
                        <li key={j.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className={monoBadge}>{j.code}</span>
                            <span className="text-sm text-sd-ink truncate">{j.title ?? "Service job"}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-sd-ink-soft flex-wrap">
                            <span>{j.scheduledFor ? fmtDate(j.scheduledFor) : "—"}</span>
                            <StatusPill status={j.status} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                {/* Reports */}
                <TabsContent value="reports" className="mt-4">
                  {cust.reports.length === 0 ? (
                    <MiniEmpty text="No service reports yet." />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {cust.reports.map((r) => (
                        <div key={r.id} className="sd-clay-sm p-4">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText className="w-4 h-4 text-sd-forest shrink-0" />
                              <span className="text-sm font-semibold text-sd-ink truncate">{r.code ?? r.title ?? "Service report"}</span>
                            </div>
                            <span className="text-xs text-sd-ink-soft whitespace-nowrap">{fmtDate(r.createdAt)}</span>
                          </div>
                          <p className="text-sm text-sd-ink-soft mt-2 line-clamp-3">{r.summary ?? "No summary recorded."}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── main view ───────────────────────────────────────────────────────────
const emptyForm = { name: "", email: "", phone: "", city: "", address: "", notes: "" };

export default function CustomersView() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [city, setCity] = useState("ALL");
  const [portal, setPortal] = useState("ALL");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => setPage(1), [debouncedSearch, city, portal]);

  const list = useApi<CustomerListResp>(
    `/api/customers${qs({ search: debouncedSearch, city: city === "ALL" ? "" : city, portal: portal === "ALL" ? "" : portal, page, pageSize })}`
  );
  const meta = useApi<MetaResp>("/api/meta");

  // dialogs
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailNonce, setDetailNonce] = useState(0);
  const [editRow, setEditRow] = useState<CustomerRow | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [archiveRow, setArchiveRow] = useState<CustomerRow | null>(null);
  const [inviteInfo, setInviteInfo] = useState<{ name: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const rows = list.data?.customers ?? [];
  const total = list.data?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  function bumpDetail(id: string) {
    if (detailId === id) setDetailNonce((n) => n + 1);
  }

  // ── create ──
  async function submitAdd() {
    if (!form.name.trim() || !form.phone.trim() || !form.city.trim()) {
      toast({ variant: "destructive", title: "Check the form", description: "Name, phone and city are required." });
      return;
    }
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      toast({ variant: "destructive", title: "Check the form", description: "That email address doesn't look right." });
      return;
    }
    setSaving(true);
    try {
      await api("/api/customers", {
        method: "POST",
        json: {
          name: form.name.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim(),
          city: form.city.trim(),
          address: form.address.trim() || undefined,
          notes: form.notes.trim() || undefined,
        },
      });
      toast({ title: "Customer added", description: `${form.name.trim()} is now in your customer book.` });
      setAddOpen(false);
      setForm(emptyForm);
      list.refresh();
      meta.refresh();
    } catch (e) {
      toast({ variant: "destructive", title: "Could not add customer", description: e instanceof Error ? e.message : "Please try again." });
    } finally {
      setSaving(false);
    }
  }

  // ── edit (from row menu) ──
  function openEdit(c: CustomerRow) {
    setEditForm({
      name: c.name ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      city: c.city ?? "",
      address: c.address ?? "",
      notes: c.notes ?? "",
    });
    setEditRow(c);
  }

  async function submitEdit() {
    if (!editRow) return;
    if (!editForm.name.trim() || !editForm.phone.trim() || !editForm.city.trim()) {
      toast({ variant: "destructive", title: "Check the form", description: "Name, phone and city are required." });
      return;
    }
    setSaving(true);
    try {
      await api(`/api/customers/${editRow.id}`, {
        method: "PATCH",
        json: {
          name: editForm.name.trim(),
          email: editForm.email.trim() || undefined,
          phone: editForm.phone.trim(),
          city: editForm.city.trim(),
          address: editForm.address.trim() || undefined,
          notes: editForm.notes.trim() || undefined,
        },
      });
      toast({ title: "Customer updated", description: `${editForm.name.trim()}'s details were saved.` });
      setEditRow(null);
      list.refresh();
      meta.refresh();
      bumpDetail(editRow.id);
    } catch (e) {
      toast({ variant: "destructive", title: "Update failed", description: e instanceof Error ? e.message : "Please try again." });
    } finally {
      setSaving(false);
    }
  }

  // ── invite ──
  async function invite(c: CustomerRow) {
    try {
      const res = await api<{ ok: boolean; emailQueued?: boolean; tempPassword?: string | null; message?: string }>(
        `/api/customers/${c.id}/invite`,
        { method: "POST" }
      );
      toast({ title: "Portal invite sent", description: res.message ?? `An invitation email was queued for ${c.email ?? c.name}.` });
      if (res.tempPassword) {
        setCopied(false);
        setInviteInfo({ name: c.name, password: res.tempPassword });
      }
      list.refresh();
      bumpDetail(c.id);
    } catch (e) {
      toast({ variant: "destructive", title: "Invite failed", description: e instanceof Error ? e.message : "Please try again." });
    }
  }

  // ── archive ──
  async function archive() {
    if (!archiveRow) return;
    const c = archiveRow;
    setArchiveRow(null);
    try {
      await api(`/api/customers/${c.id}`, { method: "DELETE" });
      toast({ title: "Customer archived", description: `${c.name} was moved to the archive.` });
      list.refresh();
    } catch (e) {
      toast({ variant: "destructive", title: "Archive failed", description: e instanceof Error ? e.message : "Please try again." });
    }
  }

  async function copyPassword() {
    if (!inviteInfo) return;
    try {
      await navigator.clipboard.writeText(inviteInfo.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Select the password and copy it manually." });
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
      <PageHeader
        title="Customers"
        subtitle="Your customer book — contact details, installations, contracts and service history in one place."
        actions={
          <button className={btnPrimary} onClick={() => setAddOpen(true)}>
            <UserPlus className="w-4 h-4" /> Add customer
          </button>
        }
      />

      {/* toolbar */}
      <div className="sd-clay p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sd-ink-soft pointer-events-none" />
          <input
            className={inputCls + " pl-10"}
            placeholder="Search name, email or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search customers"
          />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger className={selectCls + " w-40"} aria-label="Filter by city">
              <SelectValue placeholder="All cities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All cities</SelectItem>
              {(meta.data?.cities ?? []).map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={portal} onValueChange={setPortal}>
            <SelectTrigger className={selectCls + " w-44"} aria-label="Filter by portal status">
              <SelectValue placeholder="Portal status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All portal statuses</SelectItem>
              <SelectItem value="ACTIVE">Portal active</SelectItem>
              <SelectItem value="INVITED">Invited</SelectItem>
              <SelectItem value="NONE">Not invited</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-sd-ink-soft whitespace-nowrap font-medium">
            {total} result{total === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {/* list */}
      {list.loading && <SkeletonRows rows={6} />}
      {list.error && !list.loading && <ErrorCard message={list.error} onRetry={list.refresh} />}
      {!list.loading && !list.error && rows.length === 0 && (
        <EmptyState
          icon={Users}
          title="No customers found"
          body={search || city !== "ALL" || portal !== "ALL" ? "Try clearing the filters or searching for something else." : "Add your first customer to start logging installations and service jobs."}
          action={
            <button className={btnPrimary} onClick={() => setAddOpen(true)}>
              <UserPlus className="w-4 h-4" /> Add customer
            </button>
          }
        />
      )}
      {!list.loading && !list.error && rows.length > 0 && (
        <>
          <TableShell>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Customer</th>
                  <th className={thCls}>City</th>
                  <th className={thCls}>Installations</th>
                  <th className={thCls}>AMC</th>
                  <th className={thCls}>Last service</th>
                  <th className={thCls}>Portal</th>
                  <th className={thCls + " text-right"}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer hover:bg-sd-surface/60 transition-colors"
                    onClick={() => setDetailId(c.id)}
                  >
                    <td className={tdCls}>
                      <div className="flex items-center gap-3 min-w-0">
                        <SdAvatar name={c.name} size={34} />
                        <div className="min-w-0">
                          <div className="font-semibold text-sd-ink truncate">{c.name}</div>
                          <div className="text-xs text-sd-ink-soft truncate">{c.email ?? "No email"}</div>
                        </div>
                      </div>
                    </td>
                    <td className={tdCls + " text-sd-ink"}>{c.city ?? "—"}</td>
                    <td className={tdCls}>
                      <div className="text-sm font-semibold text-sd-ink">{c.installationCount}</div>
                      <div className="text-xs text-sd-ink-soft">{fmtKw(c.totalCapacityKw)}</div>
                    </td>
                    <td className={tdCls}>{c.amcActive ? <StatusPill status="ACTIVE" /> : <span className="text-sd-ink-soft">—</span>}</td>
                    <td className={tdCls + " text-sd-ink whitespace-nowrap"}>{c.lastService ? fmtDate(c.lastService) : "—"}</td>
                    <td className={tdCls}><PortalPill status={c.portalStatus} /></td>
                    <td className={tdCls + " text-right"} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          className="sd-clay-sm sd-focus sd-press px-3 py-1.5 text-xs font-medium text-sd-ink hover:bg-sd-surface transition-colors inline-flex items-center gap-1.5"
                          onClick={() => setDetailId(c.id)}
                        >
                          <Eye className="w-3.5 h-3.5" /> View
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="sd-clay-sm sd-focus sd-press p-2 text-sd-ink-soft hover:text-sd-ink transition-colors" aria-label={`More actions for ${c.name}`}>
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onClick={() => openEdit(c)}>
                              <Pencil className="w-3.5 h-3.5" /> Edit details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => invite(c)} disabled={c.portalStatus === "ACTIVE"}>
                              <Send className="w-3.5 h-3.5" /> Invite to portal
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-[#a03340] focus:text-[#a03340]" onClick={() => setArchiveRow(c)}>
                              <Archive className="w-3.5 h-3.5" /> Archive customer
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>

          {/* pagination */}
          <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
            <p className="text-xs text-sd-ink-soft">
              {from}–{to} of {total}
            </p>
            <div className="flex items-center gap-2">
              <button className={btnGhost} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page">
                <ChevronLeft className="w-4 h-4" /> Prev
              </button>
              <button className={btnGhost} disabled={to >= total} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* add dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setForm(emptyForm); }}>
        <DialogContent className="sm:max-w-xl w-[calc(100%-2rem)] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-sd-ink">Add customer</DialogTitle>
            <DialogDescription>Register a customer to start attaching installations and contracts.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Name" required>
              <Input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ananya Sharma" />
            </Field>
            <Field label="Phone" required>
              <Input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" />
            </Field>
            <Field label="Email">
              <Input className={inputCls} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" />
            </Field>
            <Field label="City" required>
              <Input className={inputCls} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="e.g. Pune" />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Input className={inputCls} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street, locality (optional)" />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea className={inputCls + " min-h-20"} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Anything the service team should know (optional)" />
            </Field>
          </div>
          <DialogFooter>
            <button className={btnGhost} onClick={() => setAddOpen(false)} disabled={saving}>Cancel</button>
            <button className={btnPrimary} onClick={submitAdd} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Add customer
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* edit dialog (row menu) */}
      <Dialog open={!!editRow} onOpenChange={(o) => { if (!o) setEditRow(null); }}>
        <DialogContent className="sm:max-w-xl w-[calc(100%-2rem)] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-sd-ink">Edit customer</DialogTitle>
            <DialogDescription>Update {editRow?.name ?? "customer"}&apos;s details.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Name" required>
              <Input className={inputCls} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </Field>
            <Field label="Phone" required>
              <Input className={inputCls} value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input className={inputCls} type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            </Field>
            <Field label="City" required>
              <Input className={inputCls} value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Input className={inputCls} value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea className={inputCls + " min-h-20"} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <button className={btnGhost} onClick={() => setEditRow(null)} disabled={saving}>Cancel</button>
            <button className={btnPrimary} onClick={submitEdit} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save changes
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* archive confirm */}
      <AlertDialog open={!!archiveRow} onOpenChange={(o) => { if (!o) setArchiveRow(null); }}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this customer?</AlertDialogTitle>
            <AlertDialogDescription>
              {archiveRow?.name} will be hidden from the active customer list. Their installations, contracts and history stay intact and can be restored later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-[0.875rem]">Keep customer</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-[0.875rem] bg-[#C94B55] text-white hover:bg-[#b23f49] sd-focus"
              onClick={archive}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* temp password dialog (demo mode) */}
      <Dialog open={!!inviteInfo} onOpenChange={(o) => { if (!o) setInviteInfo(null); }}>
        <DialogContent className="sm:max-w-md w-[calc(100%-2rem)] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-sd-ink flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-sd-amber" /> Demo mode: temporary password
            </DialogTitle>
            <DialogDescription>
              A portal account was created for {inviteInfo?.name}. In this demo environment the email isn&apos;t actually
              delivered — share this one-time password with the customer so they can log in.
            </DialogDescription>
          </DialogHeader>
          <div className="sd-inset px-4 py-3.5 flex items-center justify-between gap-3">
            <code className="font-mono text-base font-bold text-sd-ink tracking-widest select-all">{inviteInfo?.password}</code>
            <button className={btnGhost} onClick={copyPassword} aria-label="Copy temporary password">
              {copied ? <Check className="w-4 h-4 text-sd-forest" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* detail dialog */}
      {detailId && (
        <CustomerDetailDialog
          key={`${detailId}-${detailNonce}`}
          customerId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => { list.refresh(); }}
        />
      )}
    </motion.div>
  );
}
