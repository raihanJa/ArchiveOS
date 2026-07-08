import React, { useEffect, useState } from "react";
import { api, type DeptRow } from "./api";
import type {
  ArchiveStats, Building, Client, Employee, Product, Project, SimEvent,
  Technology,
} from "../shared/types";
import { fmtDay, money, moneyFull, titleCase } from "./format";
import { Bar, EventRow, ImpBadge, KV, Pager, Spinner, StatusText, usePaged } from "./components";
import { useNav } from "./nav";

const EVENT_TYPES = [
  "hire", "promotion", "resignation", "termination", "retirement", "dept_created",
  "project_started", "project_completed", "project_cancelled", "project_revived",
  "tech_invented", "breakthrough", "product_launched", "product_discontinued",
  "data_breach", "security_incident", "espionage", "lawsuit_filed", "lawsuit_settled",
  "government_investigation", "regulatory_fine", "financial_crisis", "funding_round",
  "contract_won", "client_lost", "conflict", "misconduct", "marketing_campaign",
  "office_opened", "ceo_resignation", "ceo_appointed", "award", "board_meeting", "anniversary",
];

/** ---------- Dashboard ---------- */
export function Dashboard({ stats, cash, reputation }: { stats: ArchiveStats | null; cash: number; reputation: number }): JSX.Element {
  const nav = useNav();
  const [recent, setRecent] = useState<SimEvent[]>([]);
  const [historic, setHistoric] = useState<SimEvent[]>([]);
  useEffect(() => {
    const t = setInterval(() => {
      api.listEvents({ limit: 10, order: "desc" }).then((r) => setRecent(r.rows));
    }, 1500);
    api.listEvents({ limit: 10, order: "desc" }).then((r) => setRecent(r.rows));
    api.listEvents({ minImportance: 5, limit: 12, order: "desc" }).then((r) => setHistoric(r.rows));
    return () => clearInterval(t);
  }, []);
  if (!stats) return <Spinner />;
  return (
    <div>
      <h1>Archive Dashboard</h1>
      <div className="subtitle">A living record, updating in real time as the organization's history unfolds.</div>
      <div className="cards">
        <div className="card accent"><div className="v">{moneyFull(cash).replace(/^\$/, "$")}</div><div className="k">Cash on hand</div></div>
        <div className={`card ${reputation >= 50 ? "good" : "bad"}`}><div className="v">{reputation}</div><div className="k">Reputation</div></div>
        <div className="card blue"><div className="v">{stats.employeesActive}</div><div className="k">Active staff</div></div>
        <div className="card"><div className="v">{stats.employeesTotal}</div><div className="k">People ever</div></div>
        <div className="card"><div className="v">{stats.projectsActive}</div><div className="k">Active projects</div></div>
        <div className="card"><div className="v">{stats.departments}</div><div className="k">Departments</div></div>
        <div className="card blue"><div className="v">{stats.events.toLocaleString()}</div><div className="k">Events archived</div></div>
        <div className="card accent"><div className="v">{stats.documents.toLocaleString()}</div><div className="k">Documents</div></div>
        <div className="card"><div className="v">{stats.products}</div><div className="k">Products</div></div>
        <div className="card"><div className="v">{stats.technologies}</div><div className="k">Technologies</div></div>
        <div className="card"><div className="v">{stats.clients}</div><div className="k">Clients</div></div>
        <div className="card"><div className="v">{stats.buildings}</div><div className="k">Buildings</div></div>
      </div>

      <h2>As it happens</h2>
      <div className="ev-list">
        {recent.map((ev) => <EventRow key={ev.id} ev={ev} onClick={() => nav.select({ kind: "event", id: ev.id })} />)}
        {recent.length === 0 && <Spinner label="Waiting for history to unfold… (set a speed above)" />}
      </div>

      {historic.length > 0 && <>
        <h2>Historic moments</h2>
        <div className="ev-list">
          {historic.map((ev) => <EventRow key={ev.id} ev={ev} onClick={() => nav.select({ kind: "event", id: ev.id })} />)}
        </div>
      </>}
    </div>
  );
}

/** ---------- Timeline ---------- */
export function Timeline(): JSX.Element {
  const nav = useNav();
  const [text, setText] = useState("");
  const [type, setType] = useState("");
  const [minImp, setMinImp] = useState(0);
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const limit = 40;
  const filter = React.useMemo(() => ({
    text: text || undefined,
    types: type ? [type] : undefined,
    minImportance: minImp || undefined,
    order,
  }), [text, type, minImp, order]);
  const { rows, total, page, setPage, loading } = usePaged<SimEvent>(
    (offset) => api.listEvents({ ...filter, offset, limit }),
    [filter], limit,
  );
  const sel = nav.selection.kind === "event" ? nav.selection.id : null;
  return (
    <div>
      <h1>Historical Timeline</h1>
      <div className="subtitle">Every recorded event, newest first. Filter and click to trace causes and consequences.</div>
      <div className="toolbar">
        <input type="text" placeholder="Search headlines & summaries…" value={text} onChange={(e) => setText(e.target.value)} style={{ minWidth: 260 }} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {EVENT_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </select>
        <select value={minImp} onChange={(e) => setMinImp(Number(e.target.value))}>
          <option value={0}>Any importance</option>
          <option value={2}>★★ and up</option>
          <option value={3}>★★★ and up</option>
          <option value={4}>★★★★ and up</option>
          <option value={5}>★★★★★ only</option>
        </select>
        <button className="btn" onClick={() => setOrder(order === "desc" ? "asc" : "desc")}>{order === "desc" ? "Newest first" : "Oldest first"}</button>
      </div>
      <Pager page={page} total={total} limit={limit} setPage={setPage} />
      {loading ? <Spinner /> : (
        <div className="ev-list">
          {rows.map((ev) => <EventRow key={ev.id} ev={ev} selected={sel === ev.id} onClick={() => nav.select({ kind: "event", id: ev.id })} />)}
          {rows.length === 0 && <Spinner label="No events match those filters." />}
        </div>
      )}
      <Pager page={page} total={total} limit={limit} setPage={setPage} />
    </div>
  );
}

/** ---------- Employees ---------- */
export function Employees(): JSX.Element {
  const nav = useNav();
  const [text, setText] = useState("");
  const [status, setStatus] = useState("all");
  const limit = 50;
  const { rows, total, page, setPage, loading } = usePaged<Employee>(
    (offset) => api.listEmployees({ text: text || undefined, status, offset, limit }),
    [text, status], limit,
  );
  return (
    <div>
      <h1>Personnel</h1>
      <div className="subtitle">Everyone who has ever worked here — {total.toLocaleString()} records.</div>
      <div className="toolbar">
        <input type="text" placeholder="Search by name…" value={text} onChange={(e) => setText(e.target.value)} style={{ minWidth: 240 }} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="resigned">Resigned</option>
          <option value="fired">Fired</option>
          <option value="retired">Retired</option>
        </select>
      </div>
      <Pager page={page} total={total} limit={limit} setPage={setPage} />
      {loading ? <Spinner /> : (
        <table className="data">
          <thead><tr><th>Name</th><th>Role</th><th>Level</th><th>Skill</th><th>Happiness</th><th>Status</th><th>Salary</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="click" onClick={() => nav.open({ kind: "employee", id: e.id })}>
                <td>{e.name}</td>
                <td className="dim">{e.role}</td>
                <td className="num">L{e.level}</td>
                <td style={{ width: 80 }}><Bar value={e.skill} /></td>
                <td style={{ width: 80 }}><Bar value={e.happiness} color={e.happiness < 40 ? "var(--bad)" : "var(--good)"} /></td>
                <td><StatusText status={e.status} /></td>
                <td className="num dim">{money(e.salary)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pager page={page} total={total} limit={limit} setPage={setPage} />
    </div>
  );
}

export function EmployeeDetailView({ id }: { id: number }): JSX.Element {
  const nav = useNav();
  const [d, setD] = useState<Awaited<ReturnType<typeof api.getEmployee>>>(null);
  useEffect(() => { setD(null); api.getEmployee(id).then(setD); }, [id]);
  if (!d) return <Spinner />;
  const e = d.employee;
  return (
    <div>
      <a onClick={() => nav.go("employees")}>‹ Personnel</a>
      <h1 style={{ marginTop: 8 }}>{e.name}</h1>
      <div className="subtitle">{e.role} · {d.deptName ?? "no department"} · <StatusText status={e.status} /></div>
      <div className="cards">
        <div className="card"><div className="v">{e.skill}</div><div className="k">Skill</div></div>
        <div className="card"><div className="v">{e.reputation}</div><div className="k">Reputation</div></div>
        <div className={`card ${e.happiness < 40 ? "bad" : "good"}`}><div className="v">{e.happiness}</div><div className="k">Happiness</div></div>
        <div className={`card ${e.stress > 70 ? "bad" : ""}`}><div className="v">{e.stress}</div><div className="k">Stress</div></div>
        <div className="card"><div className="v">{e.achievements}/{e.failures}</div><div className="k">Wins / Losses</div></div>
      </div>
      <KV rows={[
        ["Ambition", `${e.name.split(" ")[0]} ${e.ambitionsText}`],
        ["Traits", e.traits.join(", ")],
        ["Salary", moneyFull(e.salary)],
        ["Hired", fmtDay(e.hiredDay)],
        ...(e.leftDay !== null ? [["Left", fmtDay(e.leftDay)] as [string, React.ReactNode]] : []),
      ]} />
      <h2>Career timeline ({d.events.length} events)</h2>
      <div className="ev-list">
        {d.events.slice().reverse().map((ev) => <EventRow key={ev.id} ev={ev} onClick={() => nav.select({ kind: "event", id: ev.id })} />)}
      </div>
    </div>
  );
}

/** ---------- Projects ---------- */
export function Projects(): JSX.Element {
  const nav = useNav();
  const [text, setText] = useState("");
  const [status, setStatus] = useState("all");
  const limit = 50;
  const { rows, total, page, setPage, loading } = usePaged<Project>(
    (offset) => api.listProjects({ text: text || undefined, status, offset, limit }),
    [text, status], limit,
  );
  return (
    <div>
      <h1>Projects</h1>
      <div className="subtitle">Every initiative the organization has undertaken — {total.toLocaleString()} in total.</div>
      <div className="toolbar">
        <input type="text" placeholder="Search codenames…" value={text} onChange={(e) => setText(e.target.value)} style={{ minWidth: 240 }} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="abandoned">Abandoned</option>
        </select>
      </div>
      <Pager page={page} total={total} limit={limit} setPage={setPage} />
      {loading ? <Spinner /> : (
        <table className="data">
          <thead><tr><th>Codename</th><th>Kind</th><th>Status</th><th>Progress</th><th>Budget</th><th>Started</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="click" onClick={() => nav.open({ kind: "project", id: p.id })}>
                <td>{p.codename}{p.revivedFromId !== null && <span className="tag" style={{ marginLeft: 6 }}>revived</span>}</td>
                <td className="dim">{titleCase(p.kind)}</td>
                <td><StatusText status={p.status} /></td>
                <td style={{ width: 90 }}><Bar value={p.progress} /></td>
                <td className="num dim">{money(p.budget)}</td>
                <td className="num faint">{fmtDay(p.startDay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pager page={page} total={total} limit={limit} setPage={setPage} />
    </div>
  );
}

export function ProjectDetailView({ id }: { id: number }): JSX.Element {
  const nav = useNav();
  const [d, setD] = useState<Awaited<ReturnType<typeof api.getProject>>>(null);
  useEffect(() => { setD(null); api.getProject(id).then(setD); }, [id]);
  if (!d) return <Spinner />;
  const p = d.project;
  return (
    <div>
      <a onClick={() => nav.go("projects")}>‹ Projects</a>
      <h1 style={{ marginTop: 8 }}>{p.codename}</h1>
      <div className="subtitle">{titleCase(p.kind)} · {d.deptName ?? "—"} · <StatusText status={p.status} /></div>
      <div style={{ marginBottom: 14 }}>{p.description}</div>
      <div className="cards">
        <div className="card"><div className="v">{Math.round(p.progress)}%</div><div className="k">Progress</div></div>
        <div className="card"><div className="v">{Math.round(p.quality)}</div><div className="k">Quality</div></div>
        <div className="card accent"><div className="v">{money(p.budget)}</div><div className="k">Budget</div></div>
        <div className="card"><div className="v">{money(p.spent)}</div><div className="k">Spent</div></div>
        <div className={`card ${p.risk > 60 ? "bad" : ""}`}><div className="v">{p.risk}</div><div className="k">Risk</div></div>
      </div>
      <h2>Team ({d.team.length})</h2>
      <table className="data">
        <tbody>
          {d.team.map((m) => (
            <tr key={m.id} className="click" onClick={() => nav.open({ kind: "employee", id: m.id })}>
              <td>{m.name}</td><td className="dim">{p.leadId === m.id ? "Lead" : m.role}</td><td><StatusText status={m.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Project timeline</h2>
      <div className="ev-list">
        {d.events.slice().reverse().map((ev) => <EventRow key={ev.id} ev={ev} onClick={() => nav.select({ kind: "event", id: ev.id })} />)}
      </div>
    </div>
  );
}

/** ---------- Departments ---------- */
export function Departments(): JSX.Element {
  const nav = useNav();
  const [rows, setRows] = useState<DeptRow[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [techs, setTechs] = useState<Technology[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  useEffect(() => {
    api.listDepartments().then(setRows);
    api.listProducts().then(setProducts);
    api.listClients().then(setClients);
    api.listTechnologies().then(setTechs);
    api.listBuildings().then(setBuildings);
  }, []);
  if (!rows) return <Spinner />;
  return (
    <div>
      <h1>Departments & Assets</h1>
      <div className="subtitle">Organizational structure, products, clients, technologies and offices.</div>
      <h2>Departments</h2>
      <table className="data">
        <thead><tr><th>Name</th><th>Function</th><th>Head</th><th>Headcount</th><th>Departures</th><th>Morale</th><th>Budget</th></tr></thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className="click" onClick={() => nav.select({ kind: "department", id: d.id })}>
              <td>{d.name}{d.closedDay !== null && <span className="tag" style={{ marginLeft: 6 }}>closed</span>}</td>
              <td className="dim">{titleCase(d.fn)}</td>
              <td className="dim">{d.headName ?? "—"}</td>
              <td className="num">{d.headcount}</td>
              <td className="num faint">{d.departures}</td>
              <td style={{ width: 80 }}><Bar value={d.morale} color={d.morale < 40 ? "var(--bad)" : undefined} /></td>
              <td className="num dim">{money(d.budget)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {products.length > 0 && <>
        <h2>Products</h2>
        <table className="data">
          <thead><tr><th>Name</th><th>Status</th><th>Quality</th><th>Annual revenue</th><th>Launched</th></tr></thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}><td>{p.name}</td><td><StatusText status={p.status} /></td><td className="num">{p.quality}</td>
                <td className="num dim">{money(p.annualRevenue)}</td><td className="num faint">{fmtDay(p.launchDay)}</td></tr>
            ))}
          </tbody>
        </table>
      </>}

      {techs.length > 0 && <>
        <h2>Technologies</h2>
        <table className="data">
          <thead><tr><th>Name</th><th>Potency</th><th>Status</th><th>Invented</th></tr></thead>
          <tbody>
            {techs.map((t) => (
              <tr key={t.id}><td>{t.name}</td><td style={{ width: 90 }}><Bar value={t.potency} color="var(--accent)" /></td>
                <td><StatusText status={t.status} /></td><td className="num faint">{fmtDay(t.inventedDay)}</td></tr>
            ))}
          </tbody>
        </table>
      </>}

      {clients.length > 0 && <>
        <h2>Clients</h2>
        <table className="data">
          <thead><tr><th>Name</th><th>Industry</th><th>Status</th><th>Annual value</th><th>Since</th></tr></thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}><td>{c.name}</td><td className="dim">{c.industry}</td><td><StatusText status={c.status} /></td>
                <td className="num dim">{money(c.annualValue)}</td><td className="num faint">{fmtDay(c.sinceDay)}</td></tr>
            ))}
          </tbody>
        </table>
      </>}

      {buildings.length > 0 && <>
        <h2>Offices</h2>
        <table className="data">
          <thead><tr><th>Name</th><th>City</th><th>Capacity</th><th>Opened</th></tr></thead>
          <tbody>
            {buildings.map((b) => (
              <tr key={b.id}><td>{b.name}</td><td className="dim">{b.city}</td><td className="num">{b.capacity}</td><td className="num faint">{fmtDay(b.openedDay)}</td></tr>
            ))}
          </tbody>
        </table>
      </>}
    </div>
  );
}

/** ---------- Documents ---------- */
const DOC_TYPES = [
  "email", "memo", "meeting_minutes", "incident_report", "press_release",
  "promotion_letter", "termination_letter", "offer_letter", "resignation_letter",
  "project_proposal", "financial_report", "research_paper", "security_log",
  "legal_filing", "board_minutes",
];

export function Documents(): JSX.Element {
  const nav = useNav();
  const [text, setText] = useState("");
  const [type, setType] = useState("");
  const limit = 40;
  const { rows, total, page, setPage, loading } = usePaged(
    (offset) => api.listDocs({ text: text || undefined, type: type || undefined, offset, limit }),
    [text, type], limit,
  );
  const openId = nav.selection.kind === "document" ? nav.selection.id : null;
  return (
    <div>
      <h1>Document Archive</h1>
      <div className="subtitle">{total.toLocaleString()} authentic records — emails, memos, reports, filings and more.</div>
      <div className="toolbar">
        <input type="text" placeholder="Full-text search documents…" value={text} onChange={(e) => setText(e.target.value)} style={{ minWidth: 260 }} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {DOC_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </select>
      </div>
      <Pager page={page} total={total} limit={limit} setPage={setPage} />
      {loading ? <Spinner /> : (
        <table className="data">
          <thead><tr><th>Title</th><th>Type</th><th>Date</th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className={`click ${openId === d.id ? "" : ""}`} onClick={() => nav.select({ kind: "document", id: d.id })}>
                <td>{d.title}</td><td className="dim">{titleCase(d.type)}</td><td className="num faint">{fmtDay(d.day)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pager page={page} total={total} limit={limit} setPage={setPage} />
    </div>
  );
}

/** ---------- Search ---------- */
export function Search(): JSX.Element {
  const nav = useNav();
  const [q, setQ] = useState((nav.params.q as string) ?? "");
  const [results, setResults] = useState<Awaited<ReturnType<typeof api.search>>>([]);
  const [searched, setSearched] = useState(false);
  const run = (query: string) => {
    if (!query.trim()) return;
    setSearched(true);
    api.search(query).then(setResults);
  };
  useEffect(() => { if (q) run(q); /* eslint-disable-next-line */ }, []);
  return (
    <div>
      <h1>Archive Search</h1>
      <div className="subtitle">Search across people, projects, products, departments, technologies, events and documents.</div>
      <div className="toolbar">
        <input type="text" autoFocus placeholder="Search the entire archive…" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run(q)} style={{ minWidth: 400, fontSize: 15, padding: "9px 14px" }} />
        <button className="btn primary" onClick={() => run(q)}>Search</button>
      </div>
      {searched && results.length === 0 && <Spinner label="No matches found." />}
      <div className="ev-list">
        {results.map((r, i) => (
          <div key={`${r.kind}-${r.id}-${i}`} className="ev-row" onClick={() => {
            if (r.kind === "event") nav.select({ kind: "event", id: r.id });
            else if (r.kind === "employee") nav.open({ kind: "employee", id: r.id });
            else if (r.kind === "project") nav.open({ kind: "project", id: r.id });
            else if (r.kind === "department") nav.select({ kind: "department", id: r.id });
            else if (r.kind === "document") nav.select({ kind: "document", id: r.id });
          }}>
            <div className="ev-date">{r.day !== null ? fmtDay(r.day) : ""}</div>
            <div className="ev-head">
              <div className="h">{r.title}</div>
              <div className="s">{r.snippet ? <span dangerouslySetInnerHTML={{ __html: escapeSnippet(r.snippet) }} /> : r.subtitle}</div>
            </div>
            <span className="tag type">{r.kind}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function escapeSnippet(s: string): string {
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/«/g, '<b style="color:var(--accent)">').replace(/»/g, "</b>");
}
