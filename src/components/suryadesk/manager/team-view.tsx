"use client";
// Team & Permissions — staff roster. Owners can deactivate/reactivate members
// and change roles (MANAGER ⇄ TECHNICIAN). Historical records are never deleted.
import { useState } from "react";
import {
  Info, Loader2, Lock, MoreHorizontal, ShieldCheck, TriangleAlert, UserCheck, UserX, Users,
} from "lucide-react";
import { api, useApi } from "@/lib/surya/client";
import { fmtDate } from "@/lib/surya/types";
import { useSd } from "@/lib/surya/store";
import { EmptyState, PageHeader, SdAvatar, SkeletonRows, TableShell } from "../shared/bits";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface TeamMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  role: string; // OWNER | MANAGER | TECHNICIAN
  title: string | null;
  isActive: boolean;
  joinedAt: string;
}

interface TeamResponse {
  members: TeamMember[];
}

// file-local error card with retry (kept per contract: no new shared files)
function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="sd-clay p-5 flex flex-col sm:flex-row items-start gap-4" role="alert">
      <div className="rounded-2xl bg-[#C94B55]/10 p-3 shrink-0">
        <TriangleAlert className="w-5 h-5 text-[#a03340]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-sd-ink text-sm">Couldn&apos;t load the team</div>
        <p className="text-xs text-sd-ink-soft mt-1 leading-relaxed">{message}</p>
      </div>
      <button onClick={onRetry} className="sd-btn-primary px-4 py-2 text-xs font-semibold sd-focus shrink-0">
        Try again
      </button>
    </div>
  );
}

function rolePill(role: string) {
  if (role === "OWNER") return <span className="sd-pill sd-pill-amber">Owner</span>;
  if (role === "MANAGER") return <span className="sd-pill sd-pill-teal">Manager</span>;
  return <span className="sd-pill sd-pill-slate">Technician</span>;
}

const ACTION_TITLES: Record<string, string> = {
  deactivate: "Member deactivated",
  activate: "Member reactivated",
  set_role: "Role updated",
};

export default function TeamView() {
  const { data, loading, error, refresh } = useApi<TeamResponse>("/api/team");
  const user = useSd((s) => s.user);
  const canManage = user?.orgRole === "OWNER";

  const [deactivateTarget, setDeactivateTarget] = useState<TeamMember | null>(null);
  const [roleTarget, setRoleTarget] = useState<TeamMember | null>(null);
  const [roleChoice, setRoleChoice] = useState<string>("TECHNICIAN");
  const [busy, setBusy] = useState(false);

  const runAction = async (memberId: string, action: "deactivate" | "activate" | "set_role", role?: string) => {
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; message: string }>("/api/team", {
        method: "PATCH",
        json: { memberId, action, ...(role ? { role } : {}) },
      });
      toast({ title: ACTION_TITLES[action] ?? "Updated", description: res.message });
      setDeactivateTarget(null);
      setRoleTarget(null);
      await refresh();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Action failed",
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const members = data?.members ?? [];

  let body: React.ReactNode;
  if (loading && !data) {
    body = <SkeletonRows rows={6} />;
  } else if (error) {
    body = <LoadError message={error} onRetry={refresh} />;
  } else if (members.length === 0) {
    body = (
      <EmptyState
        icon={Users}
        title="No members yet"
        body="Staff members of this organization will appear here."
      />
    );
  } else {
    body = (
      <TableShell>
        <table className="w-full min-w-[54rem] text-sm">
          <thead>
            <tr>
              <th className="text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide">Member</th>
              <th className="text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide">Role</th>
              <th className="text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide">Title</th>
              <th className="text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide">Phone</th>
              <th className="text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide">Joined</th>
              <th className="text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide">Status</th>
              <th className="text-right px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const manageable = canManage && m.role !== "OWNER";
              return (
                <tr key={m.id} className="border-t border-sd-line/70 hover:bg-sd-surface/50 transition-colors">
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <SdAvatar name={m.name} size={36} className={cn(!m.isActive && "grayscale")} />
                      <div className="min-w-0">
                        <div className="font-medium text-sd-ink leading-tight">{m.name}</div>
                        <div className="text-xs text-sd-ink-soft truncate max-w-[15rem]" title={m.email}>{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">{rolePill(m.role)}</td>
                  <td className="px-4 py-3.5">
                    <span className={cn(m.title ? "text-sd-ink" : "text-sd-ink-soft/70")}>{m.title ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={cn("whitespace-nowrap", m.phone ? "text-sd-ink-soft" : "text-sd-ink-soft/70")}>
                      {m.phone ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-sd-ink whitespace-nowrap">{fmtDate(m.joinedAt)}</td>
                  <td className="px-4 py-3.5">
                    {m.isActive ? (
                      <span className="sd-pill sd-pill-green">Active</span>
                    ) : (
                      <span className="sd-pill sd-pill-slate">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    {manageable ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="sd-clay-sm p-2 text-sd-ink-soft hover:text-sd-ink sd-focus"
                            aria-label={`Actions for ${m.name}`}
                          >
                            <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52 rounded-2xl border-sd-line">
                          <DropdownMenuItem
                            disabled={busy}
                            onClick={() => {
                              setRoleChoice(m.role === "MANAGER" ? "MANAGER" : "TECHNICIAN");
                              setRoleTarget(m);
                            }}
                            className="text-sm"
                          >
                            <ShieldCheck className="w-4 h-4 mr-2" aria-hidden="true" /> Change role
                          </DropdownMenuItem>
                          {m.isActive ? (
                            <DropdownMenuItem
                              disabled={busy}
                              onClick={() => setDeactivateTarget(m)}
                              className="text-sm text-[#a03340] focus:text-[#a03340]"
                            >
                              <UserX className="w-4 h-4 mr-2" aria-hidden="true" /> Deactivate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              disabled={busy}
                              onClick={() => runAction(m.id, "activate")}
                              className="text-sm"
                            >
                              <UserCheck className="w-4 h-4 mr-2" aria-hidden="true" /> Reactivate
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="text-xs text-sd-ink-soft/60" title={m.role === "OWNER" ? "Owner accounts cannot be modified" : "Owner access required"}>
                        —
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableShell>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Team & Permissions"
        subtitle="Your organization's staff members."
        actions={
          data ? (
            <span className="sd-pill sd-pill-slate">
              {members.length} member{members.length === 1 ? "" : "s"}
            </span>
          ) : undefined
        }
      />

      {/* managers can view but not manage */}
      {user?.orgRole === "MANAGER" && (
        <div className="sd-clay p-4 flex items-start gap-3">
          <div className="rounded-2xl bg-[#D99A32]/12 p-2.5 shrink-0">
            <Lock className="w-4 h-4 text-[#96660d]" aria-hidden="true" />
          </div>
          <p className="text-sm text-sd-ink-soft leading-relaxed">
            You can view the team roster. Only owners can deactivate members or change roles.
          </p>
        </div>
      )}

      {body}

      {/* deactivate confirmation */}
      <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => !o && setDeactivateTarget(null)}>
        {deactivateTarget && (
          <AlertDialogContent className="rounded-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Deactivate {deactivateTarget.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                They immediately lose access to this workspace. Their past service records and reports are preserved —
                service history is never deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="rounded-xl" disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                onClick={(e) => {
                  e.preventDefault();
                  runAction(deactivateTarget.id, "deactivate");
                }}
                className="rounded-xl bg-[#C94B55] text-white hover:bg-[#b53a44] focus-visible:ring-[#C94B55]/40"
              >
                {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                Deactivate member
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      {/* change role dialog */}
      <Dialog open={!!roleTarget} onOpenChange={(o) => !o && setRoleTarget(null)}>
        {roleTarget && (
          <DialogContent className="sm:max-w-md rounded-2xl">
            <DialogHeader>
              <DialogTitle>Change role — {roleTarget.name}</DialogTitle>
              <DialogDescription>
                Managers oversee customers, jobs and reports. Technicians work in the field app.
              </DialogDescription>
            </DialogHeader>
            <div>
              <label htmlFor="role-select" className="block text-xs font-semibold text-sd-ink-soft mb-1.5">
                Role
              </label>
              <Select value={roleChoice} onValueChange={setRoleChoice}>
                <SelectTrigger id="role-select" className="w-full rounded-xl border-sd-line">
                  <SelectValue placeholder="Choose a role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="TECHNICIAN">Technician</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[0.68rem] text-sd-ink-soft mt-2">
                Owner role cannot be assigned or changed from here.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" className="rounded-xl" onClick={() => setRoleTarget(null)} disabled={busy}>
                Cancel
              </Button>
              <button
                onClick={() => runAction(roleTarget.id, "set_role", roleChoice)}
                disabled={busy || roleChoice === roleTarget.role}
                className="sd-btn-primary px-5 py-2.5 text-sm font-semibold sd-focus flex items-center gap-2"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                Update role
              </button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* preservation note */}
      <div className="sd-clay p-4 flex items-start gap-3">
        <div className="rounded-2xl bg-sd-surface p-2.5 shrink-0">
          <Info className="w-4 h-4 text-sd-forest" aria-hidden="true" />
        </div>
        <p className="text-sm text-sd-ink-soft leading-relaxed">
          Deactivating a member preserves their historical service records and reports.
        </p>
      </div>
    </div>
  );
}
