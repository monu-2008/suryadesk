"use client";
// SuryaDesk premium app shell — collapsible animated sidebar with sliding
// active pill, topbar (search, notifications, profile), mobile bottom nav.
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Users, Zap, FileText, ShieldCheck, Wrench, CalendarDays, HardHat,
  Sparkles, BarChart3, ClipboardCheck, Bell, LogOut, ChevronsLeft, ChevronsRight, Menu, X,
  Search, Settings, Info,
} from "lucide-react";
import { useSd } from "@/lib/surya/store";
import { api, useApi } from "@/lib/surya/client";
import { SuryaLogo, SdAvatar, DemoBadge } from "./shared/bits";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/surya/types";
import { toast } from "@/hooks/use-toast";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

export interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

export const OWNER_NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Overview",
    items: [{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    section: "Management",
    items: [
      { id: "customers", label: "Customers", icon: Users },
      { id: "installations", label: "Installations", icon: Zap },
      { id: "amc", label: "AMC Contracts", icon: FileText },
      { id: "warranties", label: "Warranties", icon: ShieldCheck },
    ],
  },
  {
    section: "Operations",
    items: [
      { id: "requests", label: "Service Requests", icon: Wrench },
      { id: "jobs", label: "Service Jobs", icon: ClipboardCheck },
      { id: "maintenance", label: "Maintenance", icon: CalendarDays },
      { id: "technicians", label: "Technicians", icon: HardHat },
    ],
  },
  {
    section: "Intelligence",
    items: [
      { id: "ai", label: "AI Assistant", icon: Sparkles },
      { id: "analytics", label: "Service Analytics", icon: BarChart3 },
    ],
  },
  {
    section: "Records",
    items: [
      { id: "reports", label: "Service Reports", icon: ClipboardCheck },
      { id: "notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    section: "Settings",
    items: [
      { id: "settings", label: "Organization", icon: Settings },
      { id: "team", label: "Team & Permissions", icon: Users },
    ],
  },
];

export default function AppShell({
  children,
  onLogout,
  onNavigate,
}: {
  children: React.ReactNode;
  onLogout: () => void;
  onNavigate?: (query: string) => void;
}) {
  const { user, view, setView, sidebarCollapsed, toggleSidebar, mobileSidebarOpen, setMobileSidebar, unread, setUnread } = useSd();
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const collapsed = sidebarCollapsed;

  const nav = useMemo(() => OWNER_NAV, []);
  if (!user) return null;

  const isTech = user.orgRole === "TECHNICIAN";
  const isCustomer = user.orgRole === "CUSTOMER";

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    onLogout();
  };

  return (
    <div className="min-h-screen bg-sd-cream flex flex-col">
      {/* ── topbar ── */}
      <header className="sticky top-0 z-40 bg-sd-cream/85 backdrop-blur-md border-b border-sd-line">
        <div className="flex items-center gap-3 px-3.5 sm:px-5 h-16">
          {!isTech && !isCustomer ? (
            <button className="lg:hidden p-2 -ml-1 text-sd-ink" onClick={() => setMobileSidebar(true)} aria-label="Open menu">
              <Menu className="w-5 h-5" />
            </button>
          ) : (
            <div className="lg:hidden flex items-center">
              <SuryaLogo size={28} withWordmark={false} />
            </div>
          )}
          <div className="hidden lg:flex items-center gap-2 min-w-0">
            {user.isDemoOrg && <DemoBadge />}
            <span className="text-sm text-sd-ink-soft truncate">
              {isTech ? "Field App" : isCustomer ? "Customer Portal" : user.organizationName}
            </span>
          </div>

          <div className="flex-1" />

          {!isTech && !isCustomer && (
            <div className="relative hidden sm:block w-64 xl:w-80">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sd-ink-soft" />
              <input
                placeholder="Search customers, jobs, requests…"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && onNavigate) {
                    onNavigate((e.target as HTMLInputElement).value);
                  }
                }}
                className="sd-inset w-full py-2.5 pl-10 pr-4 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-sd-forest/30"
              />
            </div>
          )}
          <button className="sm:hidden p-2 text-sd-ink-soft" onClick={() => setMobileSearchOpen((s) => !s)} aria-label="Search">
            <Search className="w-5 h-5" />
          </button>

          <NotificationBell />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2.5 sd-clay-sm pl-1.5 pr-3 py-1.5 sd-focus" aria-label="Account menu">
                <SdAvatar name={user.name} size={30} />
                <div className="hidden md:block text-left leading-tight">
                  <div className="text-[0.8rem] font-semibold text-sd-ink">{user.name}</div>
                  <div className="text-[0.66rem] text-sd-ink-soft">{user.orgRole}</div>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 rounded-2xl border-sd-line">
              <DropdownMenuLabel className="text-xs text-sd-ink-soft">
                <div className="font-semibold text-sd-ink text-sm">{user.name}</div>
                <div className="mt-0.5">{user.email}</div>
                {user.title && <div className="mt-0.5 text-sd-forest font-medium">{user.title}</div>}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {!isTech && !isCustomer && (
                <DropdownMenuItem onClick={() => setView("settings")} className="text-sm">
                  <Settings className="w-4 h-4 mr-2" /> Organization settings
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setView("notifications")} className="text-sm">
                <Bell className="w-4 h-4 mr-2" /> Notifications
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-sm text-[#a03340] focus:text-[#a03340]">
                <LogOut className="w-4 h-4 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {mobileSearchOpen && !isTech && !isCustomer && (
          <div className="sm:hidden px-4 pb-3">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sd-ink-soft" />
              <input
                autoFocus
                placeholder="Search customers, jobs…"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && onNavigate) {
                    onNavigate((e.target as HTMLInputElement).value);
                    setMobileSearchOpen(false);
                  }
                }}
                className="sd-inset w-full py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-sd-forest/30"
              />
            </div>
          </div>
        )}
      </header>

      <div className="flex-1 flex">
        {/* ── desktop sidebar ── */}
        {!isTech && !isCustomer && (
          <motion.aside
            animate={{ width: collapsed ? 76 : 260 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className="hidden lg:flex flex-col sticky top-16 h-[calc(100vh-4rem)] shrink-0"
          >
            <div className="flex-1 px-3 py-4 overflow-y-auto sd-scroll">
              <div className="flex items-center justify-between px-2 mb-4">
                {!collapsed && <SuryaLogo size={30} />}
                <button onClick={toggleSidebar} className="p-1.5 rounded-lg text-sd-ink-soft hover:text-sd-ink hover:bg-sd-surface transition-colors ml-auto" aria-label="Toggle sidebar">
                  {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
                </button>
              </div>
              {nav.map((section) => (
                <div key={section.section} className="mb-4">
                  {!collapsed ? (
                    <div className="text-[0.64rem] font-bold uppercase tracking-[0.12em] text-sd-ink-soft/70 px-3 mb-1.5">{section.section}</div>
                  ) : (
                    <div className="h-px bg-sd-line mx-2 mb-2" />
                  )}
                  <SidebarNav section={section.items} collapsed={collapsed} />
                </div>
              ))}
            </div>
            {!collapsed && (
              <div className="p-3.5">
                <div className="sd-inset p-3.5 text-[0.68rem] text-sd-ink-soft leading-relaxed">
                  <div className="flex items-center gap-1.5 font-semibold text-sd-ink mb-1">
                    <Info className="w-3.5 h-3.5 text-sd-forest" /> Demo dataset
                  </div>
                  All records are fictional demo data. Use Settings to reset the demo organization.
                </div>
              </div>
            )}
          </motion.aside>
        )}

        {/* ── mobile drawer sidebar ── */}
        <AnimatePresence>
          {mobileSidebarOpen && !isTech && !isCustomer && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/35 z-50 lg:hidden"
                onClick={() => setMobileSidebar(false)}
              />
              <motion.aside
                initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }}
                transition={{ type: "spring", stiffness: 300, damping: 32 }}
                className="fixed left-0 top-0 bottom-0 w-[280px] bg-white z-50 lg:hidden flex flex-col shadow-2xl"
              >
                <div className="flex items-center justify-between p-4 border-b border-sd-line">
                  <SuryaLogo size={30} />
                  <button onClick={() => setMobileSidebar(false)} className="p-2 text-sd-ink-soft" aria-label="Close menu">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto sd-scroll p-3">
                  {nav.map((section) => (
                    <div key={section.section} className="mb-4">
                      <div className="text-[0.64rem] font-bold uppercase tracking-[0.12em] text-sd-ink-soft/70 px-3 mb-1.5">{section.section}</div>
                      <SidebarNav section={section.items} collapsed={false} />
                    </div>
                  ))}
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* ── main content ── */}
        <main className="flex-1 min-w-0 pb-24 lg:pb-8">{children}</main>
      </div>
    </div>
  );
}

// sidebar nav with sliding active pill
function SidebarNav({ section, collapsed }: { section: NavItem[]; collapsed: boolean }) {
  const { view, setView } = useSd();
  const activeId = view.split(":")[0];
  return (
    <nav className="space-y-0.5">
      {section.map((item) => {
        const active = activeId === item.id;
        return (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            title={collapsed ? item.label : undefined}
            className={cn(
              "relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[0.86rem] transition-colors sd-focus",
              active ? "text-sd-forest-deep font-semibold" : "text-sd-ink-soft hover:text-sd-ink"
            )}
          >
            {active && (
              <motion.span
                layoutId="sd-nav-pill"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                className="absolute inset-0 rounded-xl bg-[#176B52]/10 border border-[#176B52]/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
              />
            )}
            {active && !collapsed && (
              <motion.span layoutId="sd-nav-bar" className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-sd-forest" />
            )}
            <item.icon className={cn("w-[1.1rem] h-[1.1rem] relative shrink-0 transition-colors", active && "text-sd-forest")} strokeWidth={active ? 2.2 : 2} />
            {!collapsed && <span className="relative truncate">{item.label}</span>}
          </button>
        );
      })}
    </nav>
  );
}

// notification bell with unread badge + popover list
function NotificationBell() {
  const { setView, unread, setUnread } = useSd();
  const { data, refresh } = useApi<{ notifications: { id: string; title: string; body?: string; kind: string; readAt: string | null; createdAt: string }[]; unread: number }>("/api/notifications");
  const notifs = data?.notifications ?? [];

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) refresh();
      }}
    >
      <PopoverTrigger asChild>
        <button className="relative p-2 text-sd-ink-soft hover:text-sd-ink transition-colors" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-[#C94B55] text-white text-[0.62rem] font-bold flex items-center justify-center px-1 border-2 border-sd-cream">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0 rounded-2xl border-sd-line overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-sd-line">
          <div className="font-semibold text-sm text-sd-ink">Notifications</div>
          <button
            className="text-xs text-sd-forest font-medium hover:underline"
            onClick={async () => {
              await api("/api/notifications", { method: "PATCH", json: { all: true } });
              setUnread(0);
              refresh();
            }}
          >
            Mark all read
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto sd-scroll">
          {notifs.length === 0 && <div className="px-4 py-8 text-center text-sm text-sd-ink-soft">You&apos;re all caught up.</div>}
          {notifs.slice(0, 12).map((n) => (
            <button
              key={n.id}
              className={cn("w-full text-left px-4 py-3 border-b border-sd-line/60 hover:bg-sd-surface/60 transition-colors", !n.readAt && "bg-[#176B52]/[0.045]")}
              onClick={async () => {
                if (!n.readAt) {
                  await api("/api/notifications", { method: "PATCH", json: { ids: [n.id] } });
                  refresh();
                }
              }}
            >
              <div className="flex items-start gap-2.5">
                <span className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", n.readAt ? "bg-sd-line" : "bg-sd-forest")} />
                <div className="min-w-0">
                  <div className="text-[0.82rem] font-medium text-sd-ink leading-snug">{n.title}</div>
                  {n.body && <div className="text-[0.72rem] text-sd-ink-soft mt-0.5 leading-snug">{n.body}</div>}
                  <div className="text-[0.64rem] text-sd-ink-soft/70 mt-1">{fmtDateTime(n.createdAt)}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
        <button
          className="w-full py-2.5 text-xs font-semibold text-sd-forest hover:bg-sd-surface border-t border-sd-line"
          onClick={() => setView("notifications")}
        >
          View all notifications
        </button>
      </PopoverContent>
    </Popover>
  );
}
