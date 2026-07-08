import React, { useEffect, useState } from "react";
import { api, type EmployeeDetail, type ProjectDetail } from "./api";
import type { EventDetail } from "../shared/types";
import { fmtDay, money, titleCase } from "./format";
import { KV, MiniEvent } from "./components";
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

function EmployeeContext({ id }: { id: number }): JSX.Element {
  const nav = useNav();
  const [d, setD] = useState<EmployeeDetail | null>(null);
  useEffect(() => { setD(null); api.getEmployee(id).then(setD); }, [id]);
  if (!d) return <div className="empty">Loading…</div>;
  const e = d.employee;
  return (
    <div>
      <h3>Person</h3>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{e.name}</div>
      <div className="dim" style={{ marginBottom: 8 }}>{e.role} · <span className={`status-${e.status}`}>{e.status}</span></div>
      <KV rows={[
        ["Department", d.deptName ?? "—"],
        ["Level", `L${e.level}`],
        ["Salary", money(e.salary)],
        ["Hired", fmtDay(e.hiredDay)],
        ...(e.leftDay !== null ? [["Left", fmtDay(e.leftDay)] as [string, React.ReactNode]] : []),
        ["Traits", e.traits.join(", ")],
      ]} />
      <h3>Disposition</h3>
      <KV rows={[
        ["Skill", `${e.skill}/100`],
        ["Happiness", `${e.happiness}/100`],
        ["Stress", `${e.stress}/100`],
        ["Reputation", `${e.reputation}/100`],
        ["Wins / Losses", `${e.achievements} / ${e.failures}`],
      ]} />
      {d.relationships.length > 0 && <>
        <h3>Relationships</h3>
        {d.relationships.map((r) => (
          <div key={r.otherId} className="rel-row">
            <a onClick={() => nav.select({ kind: "employee", id: r.otherId })}>{r.otherName}</a>
            <span className={`rel-kind-${r.kind}`}>{r.kind} {r.strength > 0 ? "+" : ""}{r.strength}</span>
          </div>
        ))}
      </>}
      <h3>Recent history</h3>
      {d.events.slice(-8).reverse().map((ev) => <MiniEvent key={ev.id} ev={ev} />)}
      <div style={{ marginTop: 12 }}><a onClick={() => nav.open({ kind: "employee", id: e.id })}>→ Full dossier</a></div>
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
