"use client";
// SuryaDesk — single-route application root.
// All workspaces are client-side views composed here.
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "@/lib/surya/client";
import { useSd, defaultViewFor } from "@/lib/surya/store";
import type { SessionUser } from "@/lib/surya/types";
import LoginScreen from "@/components/suryadesk/login-screen";
import AppShell from "@/components/suryadesk/app-shell";
import OwnerDashboard from "@/components/suryadesk/owner/owner-dashboard";
import ManagerHome from "@/components/suryadesk/manager/manager-home";
import CustomersView from "@/components/suryadesk/manager/customers-view";
import InstallationsView from "@/components/suryadesk/manager/installations-view";
import AmcView from "@/components/suryadesk/manager/amc-view";
import WarrantiesView from "@/components/suryadesk/manager/warranties-view";
import RequestsView from "@/components/suryadesk/manager/requests-view";
import JobsView from "@/components/suryadesk/manager/jobs-view";
import MaintenanceView from "@/components/suryadesk/manager/maintenance-view";
import TechniciansView from "@/components/suryadesk/manager/technicians-view";
import AnalyticsView from "@/components/suryadesk/owner/analytics-view";
import ReportsView from "@/components/suryadesk/manager/reports-view";
import NotificationsView from "@/components/suryadesk/manager/notifications-view";
import SettingsView from "@/components/suryadesk/manager/settings-view";
import TeamView from "@/components/suryadesk/manager/team-view";
import AiAssistantView from "@/components/suryadesk/owner/ai-assistant-view";
import TechnicianApp from "@/components/suryadesk/technician/technician-app";
import CustomerPortal from "@/components/suryadesk/customer/customer-portal";

export default function Page() {
  const { user, setSession, setView, view, authChecked, setAuthChecked } = useSd();
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api<{ user: SessionUser | null; unread?: number }>("/api/auth/me")
      .then((res) => {
        if (cancelled) return;
        if (res.user) {
          setSession(res.user, res.unread ?? 0);
        } else {
          setAuthChecked(true);
        }
      })
      .catch(() => setAuthChecked(true))
      .finally(() => !cancelled && setBooting(false));
    return () => {
      cancelled = true;
    };
     
  }, []);

  const refreshSession = () => {
    api<{ user: SessionUser | null; unread?: number }>("/api/auth/me").then((res) => {
      if (res.user) setSession(res.user, res.unread ?? 0);
      else {
        setSession(null);
        setAuthChecked(true);
      }
    });
  };

  const logout = () => {
    useSd.setState({ user: null, view: "dashboard", unread: 0 });
    setAuthChecked(true);
  };

  if (booting || !authChecked) {
    return (
      <div className="min-h-screen bg-sd-cream flex items-center justify-center">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#1D7A5D] to-[#104B3D] flex items-center justify-center shadow-lg">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2.2, ease: "linear" }}
              className="w-5 h-5 rounded-full border-[3px] border-[#F2B84B] border-t-transparent"
            />
          </div>
          <div className="text-sm font-semibold text-sd-ink">SuryaDesk</div>
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onAuthenticated={refreshSession} />;
  }

  return (
    <AppShell
      onLogout={logout}
      onNavigate={(q) => {
        // global search: route to the best guess view
        const v = user.orgRole === "TECHNICIAN" ? "tech:jobs" : user.orgRole === "CUSTOMER" ? "portal:requests" : "jobs";
        setView(v);
        // stash query for views that support it
        try {
          window.sessionStorage.setItem("sd-search", q);
        } catch {}
      }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="p-4 sm:p-6 lg:p-8"
        >
          <WorkspaceRouter view={view} user={user} onSessionRefresh={refreshSession} />
        </motion.div>
      </AnimatePresence>
    </AppShell>
  );
}

function WorkspaceRouter({ view, user, onSessionRefresh }: { view: string; user: SessionUser; onSessionRefresh: () => void }) {
  if (user.orgRole === "TECHNICIAN") return <TechnicianApp view={view} />;
  if (user.orgRole === "CUSTOMER") return <CustomerPortal view={view} />;

  const base = view.split(":")[0];
  switch (base) {
    case "dashboard":
      return user.orgRole === "OWNER" ? <OwnerDashboard /> : <ManagerHome />;
    case "customers":
      return <CustomersView />;
    case "installations":
      return <InstallationsView />;
    case "amc":
      return <AmcView />;
    case "warranties":
      return <WarrantiesView />;
    case "requests":
      return <RequestsView />;
    case "jobs":
      return <JobsView />;
    case "maintenance":
      return <MaintenanceView />;
    case "technicians":
      return <TechniciansView />;
    case "analytics":
      return <AnalyticsView />;
    case "reports":
      return <ReportsView />;
    case "notifications":
      return <NotificationsView />;
    case "settings":
      return <SettingsView onDemoReset={onSessionRefresh} />;
    case "team":
      return <TeamView />;
    case "ai":
      return <AiAssistantView />;
    default:
      return <OwnerDashboard />;
  }
}
