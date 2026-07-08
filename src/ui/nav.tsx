import React, { createContext, useContext } from "react";

export type View = "dashboard" | "timeline" | "employees" | "projects" | "departments" | "documents" | "search" | "assistant" | "settings";

/** A selection drives the right-hand context panel. */
export type Selection =
  | { kind: "none" }
  | { kind: "event"; id: number }
  | { kind: "employee"; id: number }
  | { kind: "project"; id: number }
  | { kind: "department"; id: number }
  | { kind: "document"; id: number };

export interface NavState {
  view: View;
  params: Record<string, string | number>;
  selection: Selection;
  go(view: View, params?: Record<string, string | number>): void;
  select(sel: Selection): void;
  /** Navigate to the most sensible full view for an entity. */
  open(sel: Selection): void;
}

export const NavContext = createContext<NavState | null>(null);

export function useNav(): NavState {
  const n = useContext(NavContext);
  if (!n) throw new Error("NavContext missing");
  return n;
}
