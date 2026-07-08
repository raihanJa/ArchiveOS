import React, { useEffect, useState } from "react";
import { api } from "./api";

export function Settings({ onReset }: { onReset: () => void }): JSX.Element {
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [model, setModel] = useState("claude-haiku-4-5-20251001");
  const [useLlm, setUseLlm] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => {
      setHasKey(s.hasKey);
      setKey(s.hasKey ? s.anthropicApiKey : "");
      setModel(s.llmModel || "claude-haiku-4-5-20251001");
      setUseLlm(s.investigatorUsesLlm);
    });
  }, []);

  const save = async () => {
    await api.setSettings({ anthropicApiKey: key, llmModel: model, investigatorUsesLlm: useLlm });
    setSaved(true);
    const s = await api.getSettings();
    setHasKey(s.hasKey);
    setKey(s.hasKey ? s.anthropicApiKey : "");
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <h1>Settings</h1>
      <div className="subtitle">Configure the AI Investigator and manage your archive.</div>

      <h2>AI Investigator</h2>
      <p className="dim" style={{ maxWidth: 640, marginBottom: 12 }}>
        The investigator always works offline using local reasoning over the archive. Optionally connect the Claude API
        for richer, prose-style answers. Your key is stored locally and only sent to Anthropic's API.
      </p>
      <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
          <span>Use Claude for investigator answers {hasKey ? "" : "(requires an API key)"}</span>
        </label>
        <div>
          <div className="k faint" style={{ marginBottom: 4 }}>Anthropic API key</div>
          <input type="text" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div>
          <div className="k faint" style={{ marginBottom: 4 }}>Model</div>
          <select value={model} onChange={(e) => setModel(e.target.value)} style={{ width: "100%" }}>
            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (fast, cheap)</option>
            <option value="claude-sonnet-5">Claude Sonnet 5 (balanced)</option>
            <option value="claude-opus-4-8">Claude Opus 4.8 (deepest reasoning)</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn primary" onClick={save}>Save settings</button>
          {saved && <span className="status-active">Saved.</span>}
        </div>
      </div>

      <h2 style={{ marginTop: 28 }}>Archive management</h2>
      <p className="dim" style={{ maxWidth: 640, marginBottom: 12 }}>
        The archive lives in a local SQLite database and persists across restarts. Resetting permanently erases the entire
        history and lets you start a new organization.
      </p>
      {!confirming ? (
        <button className="btn danger" onClick={() => setConfirming(true)}>Reset archive…</button>
      ) : (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="status-fired">This erases everything. Are you sure?</span>
          <button className="btn danger" onClick={async () => { await api.resetOrg(); onReset(); }}>Yes, erase everything</button>
          <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      )}

      <h2 style={{ marginTop: 28 }}>About</h2>
      <p className="dim" style={{ maxWidth: 640 }}>
        ArchiveOS is an autonomous history simulator. It runs an agent-based simulation of a fictional organization,
        generating people, projects, events and documents that link together into emergent stories. Leave it running and
        return to an archive that has grown a history of its own.
      </p>
    </div>
  );
}
