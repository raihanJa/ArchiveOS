import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, type OrgInfo } from "./api";
import { SPEEDS, type ArchiveStats, type Speed, type TickPush } from "../shared/types";
import { setOrg } from "./format";
import { NavContext, type NavState, type Selection, type View } from "./nav";
import { ContextPanel } from "./ContextPanel";
import { Setup } from "./Setup";
import {
  Dashboard, Departments, Documents, EmployeeDetailView, Employees,
  ProjectDetailView, Projects, Search, Timeline,
} from "./views";
import { Assistant } from "./Assistant";
import { Settings } from "./Settings";

const NAV_ITEMS: { view: View; label: string; ico: string }[] = [
  { view: "dashboard", label: "Dashboard", ico: "▤" },
  { view: "timeline", label: "Timeline", ico: "≡" },
  { view: "employees", label: "Personnel", ico: "☺" },
  { view: "projects", label: "Projects", ico: "◈" },
  { view: "departments", label: "Departments", ico: "▦" },
  { view: "documents", label: "Documents", ico: "❐" },
  { view: "search", label: "Search", ico: "⌕" },
  { view: "assistant", label: "AI Investigator", ico: "✦" },
  { view: "settings", label: "Settings", ico: "⚙" },
];

function App(): JSX.Element {
  const [info, setInfo] = useState<OrgInfo | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [params, setParams] = useState<Record<string, string | number>>({});
  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  const [tick, setTick] = useState<TickPush | null>(null);

  const refresh = useCallback(() => {
    api.getOrg().then((i) => {
      setInfo(i);
      if (i.org) setOrg(i.org);
    });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const off = api.onTick((t) => {
      setTick(t);
      // Keep the date formatter's org in sync as time advances.
      setInfo((prev) => {
        if (prev?.org) { const org = { ...prev.org, day: t.day, cash: t.cash, reputation: t.reputation }; setOrg(org); return { ...prev, org, dateLabel: t.dateLabel, stats: t.stats, speed: t.speed }; }
        return prev;
      });
    });
    return off;
  }, []);

  const nav: NavState = useMemo(() => ({
    view, params, selection,
    go: (v, p = {}) => { setView(v); setParams(p); },
    select: (sel) => setSelection(sel),
    open: (sel) => {
      setSelection(sel);
      if (sel.kind === "employee") { setView("employees"); setParams({ id: sel.id }); }
      else if (sel.kind === "project") { setView("projects"); setParams({ id: sel.id }); }
      else if (sel.kind === "department") { setView("departments"); }
    },
  }), [view, params, selection]);

  if (!info) return <div className="setup"><div className="spin">Opening archive…</div></div>;
  if (!info.hasWorld) return <Setup onCreated={refresh} />;

  const stats: ArchiveStats | null = tick?.stats ?? info.stats ?? null;
  const speed = tick?.speed ?? info.speed ?? 1;
  const cash = tick?.cash ?? info.org?.cash ?? 0;
  const reputation = tick?.reputation ?? info.org?.reputation ?? 0;
  const dateLabel = tick?.dateLabel ?? info.dateLabel ?? "";

  const setSpeed = (s: Speed) => { api.setSpeed(s); };

  const showContext = view !== "settings" && view !== "assistant";

  return (
    <NavContext.Provider value={nav}>
      <div className={`shell ${showContext ? "" : "no-context"}`}>
        <header className="header">
          <div className="brand">ARCHIVE<span>OS</span></div>
          <div className="org-name" title={info.org?.name}>{info.org?.name}</div>
          <div className="sim-date">{dateLabel}</div>
          <div className="spacer" />
          {stats && <>
            <span className="stat-chip"><b>{stats.employeesActive}</b> staff</span>
            <span className="stat-chip"><b>{stats.events.toLocaleString()}</b> events</span>
            <span className="stat-chip">rep <b style={{ color: reputation >= 50 ? "var(--good)" : "var(--bad)" }}>{reputation}</b></span>
          </>}
          <div className="speeds">
            {SPEEDS.map((s) => (
              <button key={s} className={`${s === speed ? "on" : ""} ${s === 0 ? "paused" : ""}`} onClick={() => setSpeed(s)}>
                {s === 0 ? "❚❚" : `${s}×`}
              </button>
            ))}
          </div>
        </header>

        <div className="ticker">
          {(tick?.headlines ?? []).length === 0
            ? <span className="faint">History will scroll here as it happens. Press a speed above to begin.</span>
            : (tick?.headlines ?? []).map((h) => (
              <span key={h.id} className={`tk imp${h.importance}`} onClick={() => nav.select({ kind: "event", id: h.id })}>
                <span className="d">▸</span>{h.headline}
              </span>
            ))}
        </div>

        <nav className="sidebar">
          {NAV_ITEMS.map((it) => (
            <button key={it.view} className={`nav-item ${view === it.view ? "on" : ""}`} onClick={() => { setView(it.view); setParams({}); }}>
              <span className="ico">{it.ico}</span>{it.label}
            </button>
          ))}
          <div className="nav-sep" />
          <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-faint)", lineHeight: 1.5 }}>
            {stats && <>{stats.documents.toLocaleString()} documents<br />{stats.projectsTotal} projects<br />{stats.technologies} technologies</>}
          </div>
        </nav>

        <main className="main">
          {view === "dashboard" && <Dashboard stats={stats} cash={cash} reputation={reputation} />}
          {view === "timeline" && <Timeline />}
          {view === "employees" && (params.id ? <EmployeeDetailView id={Number(params.id)} /> : <Employees />)}
          {view === "projects" && (params.id ? <ProjectDetailView id={Number(params.id)} /> : <Projects />)}
          {view === "departments" && <Departments />}
          {view === "documents" && <Documents />}
          {view === "search" && <Search />}
          {view === "assistant" && <Assistant />}
          {view === "settings" && <Settings onReset={() => { setView("dashboard"); refresh(); }} />}
        </main>

        {showContext && <ContextPanel selection={selection} />}
      </div>
    </NavContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
