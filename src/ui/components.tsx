import React from "react";
import type { SimEvent } from "../shared/types";
import { fmtDay, titleCase } from "./format";
import { useNav } from "./nav";

export function ImpBadge({ n }: { n: number }): JSX.Element {
  return <span className={`imp i${n}`}>{"★".repeat(Math.min(n, 5))}</span>;
}

export function StatusText({ status }: { status: string }): JSX.Element {
  return <span className={`status-${status}`}>{status}</span>;
}

export function EventRow({ ev, selected, onClick }: { ev: SimEvent; selected?: boolean; onClick?: () => void }): JSX.Element {
  return (
    <div className={`ev-row ${selected ? "sel" : ""}`} onClick={onClick}>
      <div className="ev-date">{fmtDay(ev.day)}</div>
      <div className="ev-head">
        <div className="h">{ev.headline}</div>
        <div className="s">{ev.summary}</div>
        <div style={{ marginTop: 4 }}>
          <span className="tag type">{titleCase(ev.type)}</span>
        </div>
      </div>
      <ImpBadge n={ev.importance} />
    </div>
  );
}

/** A compact event line for the context panel and entity views. */
export function MiniEvent({ ev }: { ev: SimEvent }): JSX.Element {
  const nav = useNav();
  return (
    <div className="mini-ev" onClick={() => nav.select({ kind: "event", id: ev.id })}>
      <div className="d2">{fmtDay(ev.day)} · {titleCase(ev.type)}</div>
      <div className="h2">{ev.headline}</div>
    </div>
  );
}

export function Bar({ value, max = 100, color }: { value: number; max?: number; color?: string }): JSX.Element {
  return (
    <div className="bar" title={`${Math.round(value)} / ${max}`}>
      <div style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: color }} />
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }): JSX.Element {
  return <div className="spin">{label}</div>;
}

export function Empty({ label }: { label: string }): JSX.Element {
  return <div className="spin">{label}</div>;
}

export function KV({ rows }: { rows: [string, React.ReactNode][] }): JSX.Element {
  return (
    <div className="kv">
      {rows.map(([k, v], i) => (
        <React.Fragment key={i}>
          <div className="k">{k}</div>
          <div className="v2">{v}</div>
        </React.Fragment>
      ))}
    </div>
  );
}

export function usePaged<T>(
  fetcher: (offset: number, limit: number) => Promise<{ total: number; rows: T[] }>,
  deps: unknown[],
  limit = 40,
): { rows: T[]; total: number; page: number; setPage: (p: number) => void; loading: boolean } {
  const [rows, setRows] = React.useState<T[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => { setPage(0); }, deps);
  React.useEffect(() => {
    let live = true;
    setLoading(true);
    fetcher(page * limit, limit).then((res) => {
      if (!live) return;
      setRows(res.rows);
      setTotal(res.total);
      setLoading(false);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, ...deps]);

  return { rows, total, page, setPage, loading };
}

export function Pager({ page, total, limit, setPage }: { page: number; total: number; limit: number; setPage: (p: number) => void }): JSX.Element | null {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Prev</button>
      <span>Page {page + 1} of {pages} · {total.toLocaleString()} records</span>
      <button className="btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next ›</button>
    </div>
  );
}
