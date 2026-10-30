"use client";
// SuryaDesk SPA store: session + role-based view routing.
import { create } from "zustand";
import type { SessionUser } from "./types";

export type AppView = string; // e.g. "dashboard", "customers", "tech:today", "portal:home"

interface SdState {
  user: SessionUser | null;
  unread: number;
  view: AppView;
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  authChecked: boolean;
  setSession: (user: SessionUser | null, unread?: number) => void;
  setUnread: (n: number) => void;
  setView: (v: AppView) => void;
  toggleSidebar: () => void;
  setMobileSidebar: (open: boolean) => void;
  setAuthChecked: (v: boolean) => void;
}

export const useSd = create<SdState>((set) => ({
  user: null,
  unread: 0,
  view: "dashboard",
  sidebarCollapsed: false,
  mobileSidebarOpen: false,
  authChecked: false,
  setSession: (user, unread = 0) =>
    set({
      user,
      unread,
      view: user ? defaultViewFor(user) : "dashboard",
      authChecked: true,
    }),
  setUnread: (n) => set({ unread: n }),
  setView: (v) => set({ view: v, mobileSidebarOpen: false }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setMobileSidebar: (open) => set({ mobileSidebarOpen: open }),
  setAuthChecked: (v) => set({ authChecked: v }),
}));

export function defaultViewFor(user: SessionUser): AppView {
  switch (user.orgRole) {
    case "TECHNICIAN":
      return "tech:today";
    case "CUSTOMER":
      return "portal:home";
    default:
      return "dashboard";
  }
}
