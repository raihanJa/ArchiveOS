import React, { useEffect, useState } from "react";
import { api, type EmployeeDetail, type ProjectDetail, type RelationshipRow } from "./api";
import type { EventDetail, RelationshipDetail, RelationshipExplanation } from "../shared/types";
import { fmtDay, money, titleCase } from "./format";
import { Bar, KV, MiniEvent, Spinner } from "./components";
import { useNav, type Selection } from "./nav";

export function ContextPanel({ selection }: { selection: Selection }): JSX.Element {
  if (selection.kind === "none") {
    return <div className="context"><div className="empty">Select an event, person or project to see connections here.</div></div>;
  }
  return (
    <div className="context">
      {selection.kind === "event" && <EventContext id={selection.id} />}
      {selection.kind === "employee" && <EmployeeContext id={selection.id} />}
      {selection.kind === "project" && <ProjectContext id={selection.id} />}
      {selection.kind === "department" && <DeptContext id={selection.id} />}
      {selection.kind === "document" && <DocContext id={selection.id} />}
      {selection.kind === "relationship" && <RelationshipContext aId={selection.aId} bId={selection.bId} />}
    </div>
  );
}

function EventContext({ id }: { id: number }): JSX.Element {
  const nav = useNav();
  const [d, setD] = useState<EventDetail | null>(null);
  useEffect(() => { setD(null); api.eventDetail(id).then(setD); }, [id]);
  if (!d) return <div className="empty">Loading…</div>;
  const ev = d.event;
  return (
    <div>
      <h3>Event</h3>
      <div style={{ fontWeight: 600 }}>{ev.headline}</div>
      <div className="dim" style={{ margin: "4px 0 8px" }}>{fmtDay(ev.day)} · <span className="tag type">{titleCase(ev.type)}</span></div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{ev.summary}</div>

      {d.actors.length > 0 && <>
        <h3>People involved</h3>
        {d.actors.map((a) => (
          <div key={a.id} className="rel-row">
            <a onClick={() => nav.open({ kind: "employee", id: a.id })}>{a.name}</a>
            <span className="faint">{a.role}</span>
          </div>
        ))}
      </>}

      {d.causes.length > 0 && <>
        <h3>Caused by</h3>
        {d.causes.map((c) => <MiniEvent key={c.id} ev={c} />)}
      </>}

      {d.consequences.length > 0 && <>
        <h3>Led to</h3>
        {d.consequences.map((c) => <MiniEvent key={c.id} ev={c} />)}
      </>}

      {d.documents.length > 0 && <>
        <h3>Documents</h3>
        {d.documents.map((doc) => (
          <div key={doc.id} className="mini-ev" onClick={() => nav.select({ kind: "document", id: doc.id })}>
            <div className="d2">{titleCase(doc.type)}</div>
            <div className="h2">{doc.title}</div>
          </div>
        ))}
      </>}

      {ev.projectId !== null && <div style={{ marginTop: 12 }}><a onClick={() => nav.open({ kind: "project", id: ev.projectId! })}>→ Open related project</a></div>}
    </div>
  );
}

/** Social-network buckets, in display order, derived from a relationship's status + composition. */
const SOCIAL_GROUPS: { label: string; test: (r: RelationshipRow) => boolean }[] = [
  { label: "Romantic partner", test: (r) => r.status === "romance" },
  { label: "Former partners", test: (r) => r.status === "ex_romance" },
  { label: "Mentors & protégés", test: (r) => r.status === "mentor" },
  { label: "Close friends", test: (r) => r.status === "close_friend" },
  { label: "Friends", test: (r) => r.status === "friend" },
  { label: "Rivals", test: (r) => r.status === "rival" },
  { label: "Enemies", test: (r) => r.status === "enemy" },
];

const MOOD_LABEL: Record<string, string> = {
  content: "Content", proud: "Proud", ashamed: "Ashamed", heartbroken: "Heartbroken",
  angry: "Angry", inspired: "Inspired", traumatized: "Traumatized", jealous: "Jealous", motivated: "Motivated",
};

function EmployeeContext({ id }: { id: number }): JSX.Element {
  const nav = useNav();
  const [d, setD] = useState<EmployeeDetail | null>(null);
  useEffect(() => { setD(null); api.getEmployee(id).then(setD); }, [id]);
  if (!d) return <div className="empty">Loading…</div>;
  const e = d.employee;
  const grouped = SOCIAL_GROUPS.map((g) => ({ label: g.label, rows: d.relationships.filter(g.test) }))
    .filter((g) => g.rows.length > 0);
  const ungrouped = d.relationships.filter((r) => !SOCIAL_GROUPS.some((g) => g.test(r)) && Math.abs(r.overall) >= 8);
  return (
    <div>
      <h3>Person</h3>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{e.name}</div>
      <div className="dim" style={{ marginBottom: 8 }}>
        {e.role} · <span className={`status-${e.status}`}>{e.status}</span>
        {e.mood && e.mood !== "content" && <> · <span className={`mood mood-${e.mood}`}>{MOOD_LABEL[e.mood] ?? e.mood}</span></>}
      </div>
      <KV rows={[
        ["Department", d.deptName ?? "—"],
        ["Level", `L${e.level}`],
        ["Salary", money(e.salary)],
        ["Hired", fmtDay(e.hiredDay)],
        ...(e.leftDay !== null ? [["Left", fmtDay(e.leftDay)] as [string, React.ReactNode]] : []),
        ["Traits", e.traits.join(", ")],
      ]} />
      {d.reputation.length > 0 && <>
        <h3>Reputation</h3>
        <div className="tag-row">
          {d.reputation.map((t) => (
            <span key={t.tag} className={`rep-tag rep-${t.tag}`} title={`strength ${t.strength}/100`}>{t.tag.replace("_", " ")}</span>
          ))}
        </div>
      </>}
      <h3>Disposition</h3>
      <KV rows={[
        ["Skill", `${e.skill}/100`],
        ["Happiness", `${e.happiness}/100`],
        ["Stress", `${e.stress}/100`],
        ["Reputation", `${e.reputation}/100`],
        ["Wins / Losses", `${e.achievements} / ${e.failures}`],
      ]} />
      {(grouped.length > 0 || ungrouped.length > 0) && <>
        <h3>Social network</h3>
        {grouped.map((g) => (
          <div key={g.label} style={{ marginBottom: 6 }}>
            <div className="faint" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4, margin: "6px 0 2px" }}>{g.label}</div>
            {g.rows.map((r) => <RelRow key={r.otherId} self={e.id} r={r} />)}
          </div>
        ))}
        {ungrouped.length > 0 && <div style={{ marginBottom: 6 }}>
          <div className="faint" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4, margin: "6px 0 2px" }}>Other contacts</div>
          {ungrouped.slice(0, 8).map((r) => <RelRow key={r.otherId} self={e.id} r={r} />)}
        </div>}
      </>}
      {d.secrets.length > 0 && <>
        <h3>Secrets on file</h3>
        {d.secrets.map((s) => (
          <div key={s.id} className="rel-row">
            <span>{s.kind.replace("_", " ")}</span>
            <span className={`secret-status secret-${s.status}`}>{s.status} · sev {s.severity}</span>
          </div>
        ))}
      </>}
      <h3>Recent history</h3>
      {d.events.slice(-8).reverse().map((ev) => <MiniEvent key={ev.id} ev={ev} />)}
      <div style={{ marginTop: 12 }}><a onClick={() => nav.open({ kind: "employee", id: e.id })}>→ Full dossier</a></div>
    </div>
  );
}

/** A relationship line that opens the full relationship panel on click. */
function RelRow({ self, r }: { self: number; r: RelationshipRow }): JSX.Element {
  const nav = useNav();
  return (
    <div className="rel-row">
      <a onClick={() => nav.select({ kind: "employee", id: r.otherId })}>{r.otherName}</a>
      <span>
        <span className={`rel-kind-${r.status}`}>{r.status.replace("_", " ")} {r.overall > 0 ? "+" : ""}{r.overall}</span>
        {" "}
        <a className="explain-link" onClick={() => nav.select({ kind: "relationship", aId: self, bId: r.otherId })} title="Explore this relationship">↗</a>
      </span>
    </div>
  );
}

function ProjectContext({ id }: { id: number }): JSX.Element {
  const nav = useNav();
  const [d, setD] = useState<ProjectDetail | null>(null);
  useEffect(() => { setD(null); api.getProject(id).then(setD); }, [id]);
  if (!d) return <div className="empty">Loading…</div>;
  const p = d.project;
  return (
    <div>
      <h3>Project</h3>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{p.codename}</div>
      <div className="dim" style={{ marginBottom: 8 }}>{titleCase(p.kind)} · <span className={`status-${p.status}`}>{p.status}</span></div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 8 }}>{p.description}</div>
      <KV rows={[
        ["Department", d.deptName ?? "—"],
        ["Budget", money(p.budget)],
        ["Spent", money(p.spent)],
        ["Progress", `${Math.round(p.progress)}%`],
        ["Quality", `${Math.round(p.quality)}/100`],
        ["Started", fmtDay(p.startDay)],
        ...(p.endDay !== null ? [["Ended", fmtDay(p.endDay)] as [string, React.ReactNode]] : []),
      ]} />
      <h3>Team ({d.team.length})</h3>
      {d.team.map((m) => (
        <div key={m.id} className="rel-row">
          <a onClick={() => nav.select({ kind: "employee", id: m.id })}>{m.name}</a>
          <span className="faint">{p.leadId === m.id ? "lead" : m.role}</span>
        </div>
      ))}
      <h3>History</h3>
      {d.events.slice(-8).reverse().map((ev) => <MiniEvent key={ev.id} ev={ev} />)}
      <div style={{ marginTop: 12 }}><a onClick={() => nav.open({ kind: "project", id: p.id })}>→ Full timeline</a></div>
    </div>
  );
}

function DeptContext({ id }: { id: number }): JSX.Element {
  const nav = useNav();
  const [d, setD] = useState<Awaited<ReturnType<typeof api.getDepartment>>>(null);
  useEffect(() => { setD(null); api.getDepartment(id).then(setD); }, [id]);
  if (!d) return <div className="empty">Loading…</div>;
  return (
    <div>
      <h3>Department</h3>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{d.department.name}</div>
      <div className="dim" style={{ marginBottom: 8 }}>{titleCase(d.department.fn)}</div>
      <KV rows={[
        ["Head", d.head ? <a onClick={() => nav.select({ kind: "employee", id: d.head!.id })}>{d.head.name}</a> : "—"],
        ["Budget", money(d.department.budget)],
        ["Morale", `${d.department.morale}/100`],
        ["Members", d.members.length],
        ["Created", fmtDay(d.department.createdDay)],
      ]} />
      <h3>Members</h3>
      {d.members.slice(0, 14).map((m) => (
        <div key={m.id} className="rel-row">
          <a onClick={() => nav.select({ kind: "employee", id: m.id })}>{m.name}</a>
          <span className="faint">{m.role}</span>
        </div>
      ))}
      <h3>History</h3>
      {d.events.slice(-6).reverse().map((ev) => <MiniEvent key={ev.id} ev={ev} />)}
    </div>
  );
}

function DocContext({ id }: { id: number }): JSX.Element {
  const nav = useNav();
  const [d, setD] = useState<Awaited<ReturnType<typeof api.getDoc>>>(null);
  useEffect(() => { setD(null); api.getDoc(id).then(setD); }, [id]);
  if (!d) return <div className="empty">Loading…</div>;
  return (
    <div>
      <h3>Document</h3>
      <div style={{ fontWeight: 600 }}>{d.title}</div>
      <div className="dim" style={{ margin: "4px 0 10px" }}>{fmtDay(d.day)} · <span className="tag type">{titleCase(d.type)}</span></div>
      <div className="doc-body" style={{ maxHeight: "60vh", overflow: "auto", fontSize: 11.5 }}>{d.body}</div>
      {d.eventId !== null && <div style={{ marginTop: 12 }}><a onClick={() => nav.select({ kind: "event", id: d.eventId! })}>→ Related event</a></div>}
    </div>
  );
}

/** A signed -100..100 bar rendered from the centre. */
function SignedBar({ value }: { value: number }): JSX.Element {
  const pct = Math.min(50, Math.abs(value) / 2);
  const positive = value >= 0;
  return (
    <div className="sbar" title={`${value > 0 ? "+" : ""}${value}`}>
      <div className="sbar-mid" />
      <div className="sbar-fill" style={{ left: positive ? "50%" : `${50 - pct}%`, width: `${pct}%`, background: positive ? "var(--good, #3fb950)" : "var(--bad, #f85149)" }} />
    </div>
  );
}

const DIM_ORDER: [string, string][] = [
  ["trust", "Professional trust"], ["friendship", "Friendship"], ["respect", "Respect"],
  ["admiration", "Admiration"], ["loyalty", "Loyalty"], ["mentorship", "Mentorship"],
  ["alignment", "Political alignment"], ["attraction", "Romantic attraction"],
  ["competition", "Rivalry"], ["jealousy", "Jealousy"], ["fear", "Fear"],
];

function RelationshipContext({ aId, bId }: { aId: number; bId: number }): JSX.Element {
  const nav = useNav();
  const [d, setD] = useState<RelationshipDetail | null>(null);
  const [exp, setExp] = useState<RelationshipExplanation | null>(null);
  const [explaining, setExplaining] = useState(false);
  useEffect(() => { setD(null); setExp(null); api.getRelationship(aId, bId).then(setD); }, [aId, bId]);
  if (!d) return <div className="empty">Loading…</div>;

  const runExplain = () => {
    setExplaining(true);
    api.explainRelationship(aId, bId).then((e) => { setExp(e); setExplaining(false); });
  };
  const activeDims = DIM_ORDER.filter(([k]) => (d.dims as Record<string, number>)[k] !== 0);

  return (
    <div>
      <h3>Relationship</h3>
      <div style={{ fontWeight: 600, fontSize: 14 }}>
        <a onClick={() => nav.select({ kind: "employee", id: d.aId })}>{d.aName}</a>
        {" ↔ "}
        <a onClick={() => nav.select({ kind: "employee", id: d.bId })}>{d.bName}</a>
      </div>
      <div className="dim" style={{ marginBottom: 8 }}>
        <span className={`rel-kind-${d.status}`}>{d.status.replace("_", " ")}</span>
        {" · "}overall {d.overall > 0 ? "+" : ""}{d.overall}
        {" · "}compatibility {d.compatibility > 0 ? "+" : ""}{d.compatibility}
        {d.sinceDay > 0 && <> · since {fmtDay(d.sinceDay)}</>}
      </div>

      <button className="btn primary" style={{ width: "100%", marginBottom: 8 }} disabled={explaining} onClick={runExplain}>
        {explaining ? "Thinking…" : exp ? "Re-explain" : "Explain this relationship"}
      </button>
      {explaining && <Spinner label="Reconstructing their history…" />}
      {exp && <div className="explain-box">
        <div className="doc-body" style={{ fontSize: 12, lineHeight: 1.55 }}>{exp.text}</div>
        {exp.citations.length > 0 && <div style={{ marginTop: 8 }}>
          <div className="faint" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>Sources</div>
          {exp.citations.map((c) => (
            <div key={c.id} className="mini-ev" onClick={() => nav.select({ kind: "event", id: c.id })}>
              <div className="h2">{c.label}</div>
            </div>
          ))}
        </div>}
        <div className="faint" style={{ fontSize: 10, marginTop: 6 }}>{exp.usedLlm ? "Generated with Claude" : "Local explanation"}</div>
      </div>}

      {activeDims.length > 0 && <>
        <h3>Breakdown</h3>
        {activeDims.map(([k, label]) => (
          <div key={k} className="dim-row">
            <span className="dim-label">{label}</span>
            <SignedBar value={(d.dims as Record<string, number>)[k]} />
          </div>
        ))}
      </>}

      {d.timeline.length > 0 && <>
        <h3>Timeline</h3>
        {d.timeline.slice(-14).reverse().map((t) => (
          <div key={t.id} className={`tl-row ${t.eventId != null ? "clickable" : ""}`} onClick={() => t.eventId != null && nav.select({ kind: "event", id: t.eventId })}>
            <span className="tl-date">{fmtDay(t.day)}</span>
            <span className={`tl-delta ${t.delta >= 0 ? "pos" : "neg"}`}>{t.delta > 0 ? "+" : ""}{t.delta}</span>
            <span className="tl-reason">{t.reason}</span>
          </div>
        ))}
      </>}

      {d.memories.length > 0 && <>
        <h3>Key memories</h3>
        {d.memories.slice(0, 6).map((m) => (
          <div key={m.id} className="mem-row">
            <span className={`mem-cat mem-${m.emotionalImpact >= 0 ? "pos" : "neg"}`}>{m.category.replace("_", " ")}</span>
            <span className="mem-text">{m.text}</span>
            <span className="faint" style={{ fontSize: 10 }}>{fmtDay(m.day)} · importance {m.importance}</span>
          </div>
        ))}
      </>}

      {(d.opinionAtoB || d.opinionBtoA) && <>
        <h3>How they see each other</h3>
        {d.opinionAtoB && <div className="op-card"><b>{d.aName}</b> on {d.bName}: <span className={d.opinionAtoB.sentiment >= 0 ? "pos" : "neg"}>{d.opinionAtoB.sentiment > 0 ? "+" : ""}{d.opinionAtoB.sentiment}</span><div className="faint">“{d.opinionAtoB.note}”</div></div>}
        {d.opinionBtoA && <div className="op-card"><b>{d.bName}</b> on {d.aName}: <span className={d.opinionBtoA.sentiment >= 0 ? "pos" : "neg"}>{d.opinionBtoA.sentiment > 0 ? "+" : ""}{d.opinionBtoA.sentiment}</span><div className="faint">“{d.opinionBtoA.note}”</div></div>}
      </>}

      {d.sharedProjects.length > 0 && <>
        <h3>Worked together on</h3>
        {d.sharedProjects.map((p) => (
          <div key={p.id} className="rel-row"><a onClick={() => nav.open({ kind: "project", id: p.id })}>{p.codename}</a></div>
        ))}
      </>}

      {d.mutualFriends.length > 0 && <>
        <h3>Mutual connections</h3>
        {d.mutualFriends.slice(0, 10).map((f) => (
          <div key={f.id} className="rel-row"><a onClick={() => nav.select({ kind: "employee", id: f.id })}>{f.name}</a></div>
        ))}
      </>}

      {d.incidents.length > 0 && <>
        <h3>Shared incidents</h3>
        {d.incidents.slice(-8).reverse().map((ev) => (
          <div key={ev.id} className="mini-ev" onClick={() => nav.select({ kind: "event", id: ev.id })}>
            <div className="d2">{fmtDay(ev.day)} · {titleCase(ev.type)}</div>
            <div className="h2">{ev.headline}</div>
          </div>
        ))}
      </>}
    </div>
  );
}
