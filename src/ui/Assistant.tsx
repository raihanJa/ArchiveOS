import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { InvestigatorCitation } from "../shared/types";
import { useNav } from "./nav";

interface Turn {
  role: "user" | "ai";
  text: string;
  citations?: InvestigatorCitation[];
  usedLlm?: boolean;
}

const SUGGESTED = [
  "Summarize the history of the organization",
  "What were the biggest mistakes made by the CEO?",
  "Show every data breach",
  "Which department had the highest turnover?",
  "Show every lawsuit",
  "Why did the last person leave?",
];

/** Render investigator markdown-ish text with clickable [e123] citations. */
function renderAnswer(text: string, citations: InvestigatorCitation[] | undefined, onCite: (id: number) => void): JSX.Element {
  const lines = text.split("\n");
  const out: JSX.Element[] = [];
  let list: JSX.Element[] = [];
  const flush = (key: string) => {
    if (list.length > 0) { out.push(<ul key={key}>{list}</ul>); list = []; }
  };
  const inline = (s: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    const re = /(\[e(\d+)\])|(\*\*([^*]+)\*\*)|(_([^_]+)_)/g;
    let last = 0; let m: RegExpExecArray | null; let k = 0;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) parts.push(s.slice(last, m.index));
      if (m[2]) { const id = Number(m[2]); parts.push(<span key={k++} className="cite" onClick={() => onCite(id)}>[{id}]</span>); }
      else if (m[4]) parts.push(<b key={k++}>{m[4]}</b>);
      else if (m[6]) parts.push(<i key={k++} style={{ color: "var(--text-dim)" }}>{m[6]}</i>);
      last = re.lastIndex;
    }
    if (last < s.length) parts.push(s.slice(last));
    return parts;
  };
  lines.forEach((ln, i) => {
    if (ln.startsWith("- ")) { list.push(<li key={`li${i}`}>{inline(ln.slice(2))}</li>); return; }
    flush(`ul${i}`);
    if (ln.startsWith("**") && ln.endsWith("**") && ln.length < 80) out.push(<h4 key={i}>{ln.replace(/\*\*/g, "")}</h4>);
    else if (ln.trim() === "") out.push(<div key={i} style={{ height: 4 }} />);
    else out.push(<p key={i}>{inline(ln)}</p>);
  });
  flush("ul-final");
  return <div>{out}</div>;
}

export function Assistant(): JSX.Element {
  const nav = useNav();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [llmOn, setLlmOn] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.getSettings().then((s) => setLlmOn(s.investigatorUsesLlm && s.hasKey)); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, busy]);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setInput("");
    setTurns((t) => [...t, { role: "user", text: question }]);
    setBusy(true);
    try {
      const res = await api.ask(question);
      setTurns((t) => [...t, { role: "ai", text: res.answer, citations: res.citations, usedLlm: res.usedLlm }]);
    } catch (err) {
      setTurns((t) => [...t, { role: "ai", text: `Something went wrong: ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>AI Investigator</h1>
      <div className="subtitle">
        Ask questions about the archive. The investigator reconstructs answers from recorded events and their causal links.
        {" "}{llmOn ? <span className="status-active">Claude reasoning enabled.</span> : <span className="faint">Running in local analysis mode (enable Claude in Settings for prose answers).</span>}
      </div>

      {turns.length === 0 && (
        <div className="suggested">
          {SUGGESTED.map((s) => <button key={s} onClick={() => ask(s)}>{s}</button>)}
        </div>
      )}

      <div className="chat">
        {turns.map((t, i) => (
          <div key={i} className={`msg ${t.role}`}>
            {t.role === "user" ? t.text : renderAnswer(t.text, t.citations, (id) => nav.select({ kind: "event", id }))}
            {t.role === "ai" && t.usedLlm === false && turns.length > 0 && i === turns.length - 1 && (
              <div className="faint" style={{ fontSize: 11, marginTop: 8 }}>Reconstructed locally from archive records.</div>
            )}
          </div>
        ))}
        {busy && <div className="msg ai"><i className="faint">Investigating the archive…</i></div>}
        <div ref={endRef} />
      </div>

      <div className="chat-input">
        <textarea placeholder="Ask the investigator… (e.g. Why was the CEO replaced?)" value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }} />
        <button className="btn primary" disabled={busy} onClick={() => ask(input)}>Ask</button>
      </div>
    </div>
  );
}
