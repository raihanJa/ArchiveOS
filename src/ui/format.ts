import type { OrgState } from "../shared/types";
import { formatSimDate } from "../shared/types";

let org: OrgState | null = null;

export function setOrg(o: OrgState): void {
  org = o;
}

export function fmtDay(day: number): string {
  if (!org) return `day ${day}`;
  return formatSimDate(org, day);
}

export function fmtYear(day: number): number {
  return (org?.foundedYear ?? 0) + Math.floor(day / 365);
}

export function money(n: number): string {
  const fantasy = org?.kind === "fantasy_kingdom";
  const abs = Math.abs(n);
  let s: string;
  if (abs >= 1e9) s = `${(n / 1e9).toFixed(2)}B`;
  else if (abs >= 1e6) s = `${(n / 1e6).toFixed(2)}M`;
  else if (abs >= 1e3) s = `${(n / 1e3).toFixed(0)}K`;
  else s = `${Math.round(n)}`;
  return fantasy ? `${s} gp` : `$${s}`;
}

export function moneyFull(n: number): string {
  const v = Math.round(n).toLocaleString("en-US");
  return org?.kind === "fantasy_kingdom" ? `${v} gp` : `$${v}`;
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
