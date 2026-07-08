import React, { useState } from "react";
import { ORG_KINDS, type OrgKind } from "../shared/types";
import { api } from "./api";

const NAME_SUGGESTIONS: Record<OrgKind, string[]> = {
  ai_company: ["Cerebrix", "Helix Intelligence", "Nordpeak AI", "Aperture Cognition"],
  space_agency: ["Meridian Space Agency", "Aurora Aerospace", "Vanguard Orbital"],
  cybersecurity: ["Blackvault Security", "Sentinel Defense", "Ironhaven Cyber"],
  intelligence_agency: ["Directorate Nine", "The Meridian Bureau", "Coldwater Agency"],
  robotics: ["Servomotive", "Ironclad Robotics", "Apex Automata"],
  pharma: ["Nevaris Pharmaceuticals", "Helion Biosciences", "Corda Therapeutics"],
  fantasy_kingdom: ["Kingdom of Emberhold", "The Silvermere Crown", "Realm of Thornwick"],
  game_studio: ["Ashen Forge Studios", "Nebula Interactive", "Crystalpeak Games"],
};

export function Setup({ onCreated }: { onCreated: () => void }): JSX.Element {
  const [kind, setKind] = useState<OrgKind>("ai_company");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const suggestions = NAME_SUGGESTIONS[kind];
  const create = async () => {
    setBusy(true);
    const finalName = name.trim() || suggestions[0];
    await api.initOrg({ name: finalName, kind });
    onCreated();
  };

  return (
    <div className="setup">
      <div className="setup-box">
        <h1>ARCHIVE<span style={{ color: "var(--text-dim)" }}>OS</span></h1>
        <div className="tag-line">Found an organization. Then step back and let its history write itself.</div>

        <div className="k faint" style={{ marginBottom: 8 }}>Choose an organization type</div>
        <div className="kind-grid">
          {ORG_KINDS.map((k) => (
            <div key={k.kind} className={`kind-card ${kind === k.kind ? "on" : ""}`} onClick={() => { setKind(k.kind); setName(""); }}>
              <div className="t">{k.label}</div>
              <div className="b">{k.blurb}</div>
            </div>
          ))}
        </div>

        <div className="k faint" style={{ marginBottom: 8 }}>Name it</div>
        <div className="setup-row">
          <input type="text" placeholder={suggestions[0]} value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()} autoFocus />
          <button className="btn primary" disabled={busy} onClick={create} style={{ padding: "10px 24px" }}>
            {busy ? "Founding…" : "Found organization →"}
          </button>
        </div>
        <div className="suggested">
          {suggestions.map((s) => <button key={s} onClick={() => setName(s)}>{s}</button>)}
        </div>
      </div>
    </div>
  );
}
