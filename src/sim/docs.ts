import type { Rng } from "./rng";
import type { Theme } from "./themes";
import type {
  Client, Department, DeptFunction, DocType, Employee, OrgState, Product,
  Project, SimDocument, SimEvent, Technology,
} from "../shared/types";

/**
 * Document generation: turns events into authentic-feeling archive artifacts
 * (emails, memos, minutes, reports, letters, filings, press releases).
 *
 * Pure and deterministic given the ctx's RNG position — the engine owns the RNG.
 */

export interface DocCtx {
  rng: Rng;
  theme: Theme;
  org: OrgState;
  day: number;
  dateLabel: (day: number) => string;
  emp: (id: number) => Employee | undefined;
  dept: (id: number) => Department | undefined;
  proj: (id: number) => Project | undefined;
  prod: (id: number) => Product | undefined;
  client: (id: number) => Client | undefined;
  tech: (id: number) => Technology | undefined;
  money: (n: number) => string;
  pickByFn: (fn: DeptFunction) => Employee | undefined;
}

export type DocDraft = Omit<SimDocument, "id" | "day" | "eventId">;

function domain(org: OrgState): string {
  return org.name.toLowerCase().replace(/[^a-z0-9]+/g, "") + (org.kind === "fantasy_kingdom" ? ".realm" : ".com");
}

function addr(e: Employee | undefined, org: OrgState): string {
  if (!e) return `archive@${domain(org)}`;
  const parts = e.name.toLowerCase().replace(/[^a-z ]/g, "").split(" ");
  return `${parts[0][0]}${parts[parts.length - 1]}@${domain(org)}`;
}

function first(e: Employee): string {
  return e.name.split(" ")[0];
}

function emailDoc(ctx: DocCtx, from: Employee | undefined, to: string, subject: string, body: string): DocDraft {
  const header = `FROM:    ${from ? `${from.name} <${addr(from, ctx.org)}>` : `Archive System <archive@${domain(ctx.org)}>`}\nTO:      ${to}\nDATE:    ${ctx.dateLabel(ctx.day)}\nSUBJECT: ${subject}\n\n`;
  return { type: "email", title: subject, authorId: from?.id ?? null, body: header + body };
}

function signoff(ctx: DocCtx, e: Employee | undefined): string {
  if (!e) return "";
  const opts = e.personality.empathy > 60
    ? ["Warm regards,", "All the best,", "Thanks, as always,"]
    : e.personality.volatility > 65
      ? ["Regards.", "— sent from my phone", "Make it happen."]
      : ["Regards,", "Best,", "Sincerely,"];
  return `\n\n${ctx.rng.pick(opts)}\n${e.name}\n${e.role}`;
}

/** ---------- per-event composers ---------- */

export function composeDocs(ctx: DocCtx, ev: SimEvent): DocDraft[] {
  const out: DocDraft[] = [];
  const rng = ctx.rng;
  const org = ctx.org;
  const a0 = ev.actorIds.length > 0 ? ctx.emp(ev.actorIds[0]) : undefined;

  switch (ev.type) {
    case "founding": {
      out.push({
        type: "memo", title: `Articles of Incorporation — ${org.name}`, authorId: a0?.id ?? null,
        body: `ARTICLES OF ${org.kind === "fantasy_kingdom" ? "ROYAL CHARTER" : "INCORPORATION"}\n\nEntity: ${org.name}\nDate: ${ctx.dateLabel(0)}\nRegistered seat: ${String(ev.data.city ?? "the capital")}\nFounding capital: ${ctx.money(org.cash)}\n\nPurpose: ${ctx.theme.kind === "fantasy_kingdom" ? "To govern, protect and prosper the realm and its subjects." : `To research, develop and commercialize advanced capabilities befitting a ${ctx.theme.orgNoun} of ambition.`}\n\nSigned,\n${a0?.name ?? "The Founders"}\n${a0?.role ?? ""}`,
      });
      out.push(pressRelease(ctx, `${org.name} announces its founding`, `${a0?.name ?? "The founders"} today announced the establishment of ${org.name}. "${rng.pick([
        "We are building something that will outlast all of us",
        "The next decade belongs to those bold enough to claim it",
        "We start small, but we do not think small",
      ])}," said ${a0?.name ?? "the founder"}, ${a0?.role ?? ""}.`));
      break;
    }
    case "hire": {
      if (a0) {
        out.push({
          type: "offer_letter", title: `Offer of Employment — ${a0.name}`, authorId: ctx.pickByFn("hr")?.id ?? null,
          body: `${org.name.toUpperCase()}\nOFFER OF EMPLOYMENT\n\nDate: ${ctx.dateLabel(ctx.day)}\nCandidate: ${a0.name}\nPosition: ${a0.role}\nAnnual compensation: ${ctx.money(a0.salary)}\nStart date: immediate\n\nWe are pleased to extend this offer. ${rng.pick([
            "Your references spoke highly of your abilities; we intend to test them.",
            "The team was unanimous, which almost never happens.",
            "We believe you will do significant work here.",
          ])}\n\n${ctx.pickByFn("hr")?.name ?? "The Office of Personnel"}\n${ctx.pickByFn("hr")?.role ?? "Personnel"}`,
        });
      }
      break;
    }
    case "promotion": {
      if (a0) out.push({
        type: "promotion_letter", title: `Promotion — ${a0.name} to ${a0.role}`, authorId: ctx.pickByFn("hr")?.id ?? null,
        body: `INTERNAL — PERSONNEL ACTION\n\nDate: ${ctx.dateLabel(ctx.day)}\nEmployee: ${a0.name}\nAction: Promotion to ${a0.role}\nNew compensation: ${ctx.money(a0.salary)}\n\nRationale: ${rng.pick([
          "sustained performance above expectations",
          "leadership demonstrated under difficult circumstances",
          "critical contributions over the past review cycle",
        ])}.\n\nEffective immediately.`,
      });
      break;
    }
    case "termination": {
      if (a0) out.push({
        type: "termination_letter", title: `Termination of Employment — ${a0.name}`, authorId: ctx.pickByFn("hr")?.id ?? null,
        body: `PRIVATE & CONFIDENTIAL\n\nDate: ${ctx.dateLabel(ctx.day)}\nTo: ${a0.name}\n\nThis letter confirms the termination of your employment with ${org.name}, effective today. Reason: ${String(ev.data.reason ?? "cause documented in your personnel file")}.\n\nYou are required to return all ${ctx.theme.kind === "fantasy_kingdom" ? "seals, keys and regalia" : "equipment, credentials and materials"} before end of day. Final compensation will be settled per policy.\n\n${ctx.pickByFn("hr")?.name ?? "Office of Personnel"}`,
      });
      break;
    }
    case "resignation": {
      if (a0) out.push({
        type: "resignation_letter", title: `Resignation — ${a0.name}`, authorId: a0.id,
        body: `Date: ${ctx.dateLabel(ctx.day)}\n\nTo whom it may concern,\n\nI hereby resign my position as ${a0.role} at ${org.name}. ${rng.pick([
          "This was not an easy decision.",
          "My reasons are my own.",
          "I leave with gratitude for some of it, and clarity about the rest.",
          "I wish the team every success — sincerely.",
        ])} ${String(ev.data.reason ?? "")}\n\n${a0.name}`,
      });
      break;
    }
    case "retirement": {
      if (a0) out.push(emailDoc(ctx, a0, `all@${domain(org)}`, `After ${Math.max(1, Math.round(Number(ev.data.tenureDays ?? 365) / 365))} years — thank you`,
        `Team,\n\nToday is my last day. ${rng.pick([
          "I remember when all of this fit in one room.",
          "I counted this morning: I have survived every reorganization.",
          "There are people here I will miss more than I intend to admit in writing.",
        ])}\n\nTake care of the place.${signoff(ctx, a0)}`));
      break;
    }
    case "project_started": case "project_revived": {
      const p = ev.projectId !== null ? ctx.proj(ev.projectId) : undefined;
      const lead = p?.leadId != null ? ctx.emp(p.leadId) : a0;
      if (p) out.push({
        type: "project_proposal", title: `Proposal: ${p.codename}`, authorId: lead?.id ?? null,
        body: `PROJECT PROPOSAL — ${p.codename.toUpperCase()}\nDate: ${ctx.dateLabel(ctx.day)}\nSponsoring department: ${ctx.dept(p.deptId)?.name ?? "—"}\nProposed lead: ${lead?.name ?? "TBD"}\nBudget request: ${ctx.money(p.budget)}\nEstimated duration: ${Math.round(p.expectedDays / 30)} months\nTeam size: ${p.teamIds.length}\n\nOBJECTIVE\n${p.description}\n\nRISKS\n${p.risk > 60 ? "Significant technical and schedule risk. The committee should fund this with open eyes." : p.risk > 35 ? "Moderate risk profile, mitigable with disciplined execution." : "Low risk; the primary danger is insufficient ambition."}\n\nAPPROVAL\nStatus: APPROVED\n`,
      });
      if (lead && p) out.push(emailDoc(ctx, lead, p.teamIds.map((id) => addr(ctx.emp(id), org)).join(", "), `Kickoff — ${p.codename}`,
        `Team,\n\n${rng.pick(["We're on.", "Funding cleared this morning.", "It's official."])} ${p.codename} starts today. First sync ${rng.pick(["tomorrow 9:00", "Monday 10:00", "this afternoon"])} — bring ${rng.pick(["questions", "skepticism", "coffee", "your notes"])}.${signoff(ctx, lead)}`));
      break;
    }
    case "project_completed": {
      const p = ev.projectId !== null ? ctx.proj(ev.projectId) : undefined;
      if (p) out.push(meetingMinutes(ctx, `${p.codename} — closeout review`, ev.actorIds, [
        `Final spend ${ctx.money(p.spent)} against budget ${ctx.money(p.budget)}.`,
        `Quality assessment ${Math.round(p.quality)}/100.`,
        rng.pick(["Lessons-learned document assigned.", "Team reassignment to follow within two weeks.", "Celebration budget approved, within reason."]),
      ]));
      break;
    }
    case "project_cancelled": {
      const p = ev.projectId !== null ? ctx.proj(ev.projectId) : undefined;
      if (p) out.push({
        type: "memo", title: `Cancellation notice — ${p.codename}`, authorId: null,
        body: `INTERNAL MEMO\nDate: ${ctx.dateLabel(ctx.day)}\nRe: ${p.codename}\n\nEffective immediately, ${p.codename} is cancelled. Reason: ${String(ev.data.reason ?? "portfolio reprioritization")}.\n\nAll materials are to be archived. ${rng.pick([
          "No further work is authorized.",
          "Team members will be reassigned by their department heads.",
          "Leadership thanks the team for their effort; the decision reflects circumstances, not performance.",
        ])}`,
      });
      break;
    }
    case "tech_invented": case "breakthrough": {
      if (ev.type === "tech_invented" && a0) {
        const t = ev.data.techId !== undefined ? ctx.tech(Number(ev.data.techId)) : undefined;
        out.push({
          type: "research_paper", title: `${t ? `On the ${t.name}` : "Technical findings"} — internal preprint`, authorId: a0.id,
          body: `${org.name} — INTERNAL RESEARCH ARCHIVE\n\nTitle: On the ${t?.name ?? "recent findings"}\nAuthor: ${a0.name}\nDate: ${ctx.dateLabel(ctx.day)}\nClassification: ${(t?.potency ?? 0) > 70 ? "RESTRICTED — leadership distribution only" : "internal"}\n\nABSTRACT\nWe describe a working ${t?.name ?? "system"} and its implications. ${rng.pick([
            "Early results exceed our most optimistic projections.",
            "The approach is unreasonably effective and we do not yet fully understand why.",
            "Reproduction across three independent test rigs confirms the effect.",
          ])} Significance is assessed at ${t?.potency ?? "—"}/100.\n\nIMPLICATIONS\n${(t?.potency ?? 0) > 70 ? "If productized, this changes the organization's trajectory. Secrecy until filing is essential." : "A meaningful improvement over the current state of the art."}`,
        });
      }
      break;
    }
    case "product_launched": {
      const p = ev.productId !== null ? ctx.prod(ev.productId) : undefined;
      if (p) out.push(pressRelease(ctx, `${org.name} launches ${p.name}`,
        `${org.name} today announced ${p.name}. ${rng.pick([
          `"This is the culmination of years of work," leadership said.`,
          `Early partners describe the results as "${rng.pick(["remarkable", "unlike anything else on the market", "long overdue"])}".`,
          `${p.name} is available to customers starting today.`,
        ])}`));
      break;
    }
    case "data_breach": case "security_incident": case "espionage": {
      const author = ctx.pickByFn("security");
      out.push({
        type: "incident_report", title: `Incident Report — ${ev.headline}`, authorId: author?.id ?? null,
        body: `SECURITY INCIDENT REPORT\nClassification: ${ev.type === "data_breach" ? "SEVERITY 1" : "SEVERITY 3"}\nDate: ${ctx.dateLabel(ctx.day)}\nPrepared by: ${author?.name ?? "Duty Officer"}\n\nSUMMARY\n${ev.summary}\n\nVECTOR\n${String(ev.data.vector ?? "under investigation")}\n\nIMMEDIATE ACTIONS\n- ${rng.pick(["Credentials rotated across affected systems", "Perimeter rules tightened", "Affected systems isolated from the network", "Watch rotation doubled"])}\n- ${rng.pick(["Forensic timeline reconstruction underway", "External counsel notified", "All access logs preserved under litigation hold", "Counterintelligence review opened"])}\n\nRECOMMENDATIONS\n${rng.pick(["Mandatory security training for all personnel.", "Budget increase for defensive tooling.", "Third-party audit of vendor access.", "Review of privileged account inventory."])}`,
      });
      out.push({
        type: "security_log", title: `Security log excerpt — day ${ctx.day}`, authorId: null,
        body: `${org.name} — AUTOMATED SECURITY LOG (EXCERPT)\n\n${securityLogLines(ctx)}`,
      });
      if (ev.type === "data_breach") {
        out.push(pressRelease(ctx, `Statement on recent security incident`,
          `${org.name} confirms it experienced a security incident affecting a portion of its systems. ${rng.pick([
            "We have engaged outside experts and notified the relevant authorities.",
            "Affected parties are being contacted directly.",
            "We deeply regret this incident and are strengthening our defenses.",
          ])}`));
      }
      break;
    }
    case "lawsuit_filed": {
      out.push({
        type: "legal_filing", title: `Complaint — ${String(ev.data.claim ?? "civil action")} v. ${org.name}`, authorId: null,
        body: `IN THE ${ctx.theme.kind === "fantasy_kingdom" ? "COURT OF THE CROWN" : "DISTRICT COURT"}\n\nCOMPLAINT\n\nPlaintiff alleges ${String(ev.data.claim ?? "damages")} against defendant ${org.name} and seeks damages of ${ctx.money(Number(ev.data.amount ?? 0))}.\n\nFiled: ${ctx.dateLabel(ctx.day)}\n\n[Full pleading retained in legal hold archive]`,
      });
      break;
    }
    case "board_meeting": {
      out.push({
        type: "board_minutes", title: `Minutes — quarterly meeting, ${ctx.dateLabel(ctx.day)}`, authorId: null,
        body: `MINUTES OF THE ${ctx.theme.kind === "fantasy_kingdom" ? "COUNCIL OF LORDS" : "BOARD OF DIRECTORS"}\nDate: ${ctx.dateLabel(ctx.day)}\n\nATTENDANCE: quorum present.\n\nMATTERS DISCUSSED\n1. Financial position: cash ${ctx.money(Number(ev.data.cash ?? 0))}.\n2. Personnel: ${String(ev.data.headcount ?? "—")} active.\n3. Standing reputation: ${String(ev.data.reputation ?? "—")}/100.\n4. ${rng.pick(["Risk register reviewed without amendment.", "Executive session held; minutes sealed.", "Compensation committee report accepted.", "Audit timeline approved."])}\n\nRESOLVED: ${rng.pick(["continue current course", "management to report monthly until further notice", "no dividends declared", "strategy review scheduled for next quarter"])}.\n\n[Approved and entered into the record]`,
      });
      out.push({
        type: "financial_report", title: `Quarterly financial summary — ${ctx.dateLabel(ctx.day)}`, authorId: ctx.pickByFn("finance")?.id ?? null,
        body: `${org.name.toUpperCase()} — QUARTERLY FINANCIAL SUMMARY\nPrepared: ${ctx.dateLabel(ctx.day)}\nPrepared by: ${ctx.pickByFn("finance")?.name ?? "Finance Office"}\n\nCash position: ${ctx.money(Number(ev.data.cash ?? 0))}\nMonthly payroll: ${ctx.money(Number((ev.data as Record<string, number>).payroll ?? 0) || 0)}\nHeadcount: ${String(ev.data.headcount ?? "—")}\n\nNOTES\n${rng.pick(["Expense discipline holding.", "Revenue concentration remains a watch item.", "Working capital adequate for two quarters.", "Auditors raised no material findings."])}`,
      });
      break;
    }
    case "conflict": case "mediation": case "reconciliation": {
      if (ev.actorIds.length >= 2 && rng.chance(0.7)) {
        const a = ctx.emp(ev.actorIds[0]);
        const b = ctx.emp(ev.actorIds[1]);
        if (a && b) out.push(emailDoc(ctx, a, addr(b, org), ev.type === "conflict" ? rng.pick([`Re: yesterday`, `We need to talk`, `Re: the meeting`]) : `Moving forward`,
          ev.type === "conflict"
            ? `${first(b)},\n\n${rng.pick([
              "I want to be professional about this, so I'm putting it in writing.",
              "I've thought about it overnight and I stand by what I said.",
              "Let's be clear about what actually happened.",
            ])} ${rng.pick([
              "I expect credit for the work I did.",
              "Do not go around me to leadership again.",
              "If this continues I will escalate.",
            ])}\n\n${a.name}`
            : `${first(b)},\n\n${rng.pick([
              "Life is too short. Coffee this week?",
              "We were both right, and both wrong. Let's move on.",
              "I'd rather have you as an ally than whatever this has been.",
            ])}${signoff(ctx, a)}`));
      }
      break;
    }
    case "government_investigation": case "regulatory_fine": case "investigation_concluded": {
      if (rng.chance(0.8)) out.push({
        type: "memo", title: `Counsel memo — ${ev.headline}`, authorId: ctx.pickByFn("legal")?.id ?? null,
        body: `PRIVILEGED & CONFIDENTIAL — ATTORNEY WORK PRODUCT\nDate: ${ctx.dateLabel(ctx.day)}\n\n${ev.summary}\n\nGUIDANCE\n- ${rng.pick(["Preserve all documents; suspend routine deletion.", "Route all external inquiries through counsel.", "No public comment beyond the approved statement.", "Interviews to be scheduled with counsel present."])}\n- ${rng.pick(["Exposure assessment to follow.", "Insurance carriers have been notified.", "Cooperation posture recommended.", "Settlement authority to be discussed at next session."])}`,
      });
      break;
    }
    case "financial_crisis": case "funding_round": {
      out.push(emailDoc(ctx, ctx.emp(org.ceoId ?? -1), `all@${domain(org)}`,
        ev.type === "financial_crisis" ? "A difficult day" : "Good news on funding",
        ev.type === "financial_crisis"
          ? `All,\n\nBy now you have heard. ${rng.pick([
            "I will not insult you with spin: we grew faster than our discipline.",
            "The decisions announced today were the least bad options available.",
            "This is the hardest message I have written in this role.",
          ])} To those leaving us: this failure is leadership's, not yours.\n\nWe will get through this.\n\n${ctx.emp(org.ceoId ?? -1)?.name ?? "Leadership"}`
          : `All,\n\n${rng.pick(["The wire cleared this morning.", "Signatures are in.", "It's done."])} We have secured ${ctx.money(Number(ev.data.raise ?? 0))}. This buys us time — let's not need rescuing twice.\n\n${ctx.emp(org.ceoId ?? -1)?.name ?? "Leadership"}`));
      break;
    }
    case "ceo_resignation": case "ceo_appointed": {
      out.push(pressRelease(ctx, ev.headline, ev.summary));
      break;
    }
    case "marketing_campaign": case "office_opened": case "anniversary": case "award": case "contract_won": {
      if (rng.chance(ev.type === "contract_won" ? 0.4 : 0.8)) out.push(pressRelease(ctx, ev.headline, ev.summary));
      break;
    }
    case "complaint": {
      const c = ev.clientId !== null ? ctx.client(ev.clientId) : undefined;
      if (c) out.push(emailDoc(ctx, undefined, `support@${domain(org)}`, `Formal complaint — ${c.name}`,
        `To whom it may concern,\n\nWe write to formally document our dissatisfaction. ${rng.pick([
          "Response times have degraded beyond what our agreement contemplates.",
          "The issues we reported months ago remain unresolved.",
          "We are evaluating alternatives, which we would prefer not to do.",
        ])}\n\nWe expect a remediation plan within ten business days.\n\nProcurement Office\n${c.name}`));
      break;
    }
    case "sabbatical": case "promotion_denied": case "misconduct": {
      if (ev.type === "misconduct" && rng.chance(0.75)) {
        const hr = ctx.pickByFn("hr");
        out.push({
          type: "memo", title: `Case opened — allegations re: ${a0?.name ?? "employee"}`, authorId: hr?.id ?? null,
          body: `CONFIDENTIAL — PERSONNEL CASE FILE\nDate: ${ctx.dateLabel(ctx.day)}\nSubject: ${a0?.name ?? "[redacted]"}\nAllegation: ${String(ev.data.kind ?? "policy violation")}\n\nAn investigation has been opened. Interviews scheduled. Access review requested. Subject has ${rng.chance(0.5) ? "been notified" : "not yet been notified"}.\n\n${hr?.name ?? "Personnel"}`,
        });
      }
      break;
    }
    case "secret_exposed": {
      const hr = ctx.pickByFn("hr");
      out.push({
        type: "hr_report", title: `Confidential findings — ${a0?.name ?? "employee"}`, authorId: hr?.id ?? null,
        body: `CONFIDENTIAL — HR FINDINGS\nDate: ${ctx.dateLabel(ctx.day)}\nSubject: ${a0?.name ?? "[redacted]"}\nMatter: ${String(ev.data.kind ?? "undisclosed conduct")}\nAssessed severity: ${String(ev.data.severity ?? "—")}/100\n\nSUMMARY\n${ev.summary}\n\nRECOMMENDATION\n${Number(ev.data.severity ?? 0) > 60 ? "Escalate to a formal investigation. Preserve all records; restrict system access pending review." : "Handle through standard personnel process with a documented warning."}\n\n${hr?.name ?? "Office of Personnel"}`,
      });
      break;
    }
    case "scandal": {
      const tier = String(ev.data.tier ?? "moderate");
      const claim = String(ev.data.claim ?? "misconduct");
      if (tier === "major" || tier === "critical") {
        out.push(pressRelease(ctx, `${org.name} responds to allegations`, `${org.name} is aware of reports concerning ${claim}. ${rng.pick([
          "We take these matters with the utmost seriousness and have opened a full investigation.",
          "We will not comment on personnel matters under active review, but we are cooperating fully.",
          "The conduct alleged, if substantiated, is contrary to everything this organization stands for.",
        ])}`));
      }
      out.push({
        type: "memo", title: `Leadership notice — active investigation`, authorId: ctx.pickByFn("legal")?.id ?? null,
        body: `INTERNAL — LEADERSHIP DISTRIBUTION\nDate: ${ctx.dateLabel(ctx.day)}\nRe: allegations of ${claim}\n\nA matter concerning ${a0?.name ?? "a member of staff"} is under investigation. All staff are directed to preserve relevant records and to route inquiries to ${ctx.pickByFn("legal")?.name ?? "counsel"}. Speculation is unhelpful and, in some cases, actionable.`,
      });
      break;
    }
    case "scandal_investigation": {
      const claim = String(ev.data.claim ?? "the allegations");
      const investigator = ev.actorIds.length > 1 ? ctx.emp(ev.actorIds[1]) : ctx.pickByFn("legal");
      out.push({
        type: "investigation_report", title: `Investigation opened — ${claim}`, authorId: investigator?.id ?? null,
        body: `INVESTIGATION FILE — CONFIDENTIAL\nDate opened: ${ctx.dateLabel(ctx.day)}\nLead: ${investigator?.name ?? "assigned counsel"}\nScope: ${claim}\n\nMETHOD\nDocument preservation notice issued. Witness interviews to follow. System access logs pulled.\n\nSTATUS\nActive. Findings to be reported to leadership on conclusion.`,
      });
      // A couple of witness statements give the file texture.
      const dept = ev.deptId !== null ? ctx.dept(ev.deptId) : undefined;
      for (let i = 0; i < 2; i++) {
        out.push({
          type: "witness_statement", title: `Witness statement (${i + 1})`, authorId: null,
          body: `WITNESS STATEMENT — CONFIDENTIAL\nDate: ${ctx.dateLabel(ctx.day)}\nMatter: ${claim}\n\n"${rng.pick([
            "I only know what I saw, and I saw less than people think.",
            "There were signs. In hindsight, obvious ones.",
            "I don't want to be involved, but I won't lie under questioning.",
            "Everyone knew something was off. Nobody said it out loud.",
          ])}"\n\nStatement recorded and countersigned.`,
        });
      }
      break;
    }
    case "scandal_resolved": {
      out.push(meetingMinutes(ctx, `Board session — ${String(ev.data.claim ?? "investigation")} findings`, ev.actorIds, [
        `Investigation into ${String(ev.data.claim ?? "the matter")} substantiated.`,
        rng.pick(["Termination approved.", "Referral to authorities under discussion.", "Separation agreed on leadership's terms."]),
        rng.pick(["Communications to prepare a statement.", "Legal to assess exposure.", "Board requests a governance review."]),
      ]));
      break;
    }
    case "cover_up": {
      out.push({
        type: "memo", title: `File closed — no further action`, authorId: ctx.pickByFn("legal")?.id ?? null,
        body: `INTERNAL\nDate: ${ctx.dateLabel(ctx.day)}\nRe: ${String(ev.data.claim ?? "the matter")}\n\nThe review is concluded. No findings will be published and no further action will be taken. This memo is the complete record. Distribution is restricted.`,
      });
      break;
    }
    case "arrest": {
      out.push({
        type: "arrest_record", title: `Arrest — ${a0?.name ?? "individual"}`, authorId: null,
        body: `LAW ENFORCEMENT RECORD (COPY ON FILE)\nDate: ${ctx.dateLabel(ctx.day)}\nName: ${a0?.name ?? "[redacted]"}\nIn connection with: ${String(ev.data.claim ?? "an ongoing matter")}\n\nThe individual was taken into custody. ${org.name} states it is cooperating with authorities and has suspended the individual pending proceedings.`,
      });
      out.push(pressRelease(ctx, `Statement on the arrest of ${a0?.name ?? "a former employee"}`, `${org.name} confirms that ${a0?.name ?? "the individual"} is no longer affiliated with the organization. We are cooperating fully with authorities and will not comment further.`));
      break;
    }
    case "rumor_spread": {
      if (a0 && rng.chance(0.6)) {
        out.push(emailDoc(ctx, undefined, `[a colleague] <someone@${domain(org)}>`, `did you hear…`,
          `Keeping this off the record, but — ${ev.summary}\n\n${rng.pick([
            "You didn't hear it from me.",
            "No idea if it's true. Probably is.",
            "Delete this after you read it.",
            "Anyway. Back to work.",
          ])}`));
      }
      break;
    }
    default: {
      // Routine events occasionally leave a stray email in the archive.
      if (rng.chance(0.15) && a0) {
        out.push(emailDoc(ctx, a0, `team@${domain(org)}`, `FYI: ${ev.headline}`, `${ev.summary}${signoff(ctx, a0)}`));
      }
    }
  }
  return out;
}

function pressRelease(ctx: DocCtx, title: string, body: string): DocDraft {
  return {
    type: "press_release", title: `PRESS RELEASE: ${title}`, authorId: ctx.pickByFn("marketing")?.id ?? null,
    body: `FOR IMMEDIATE RELEASE\n${ctx.dateLabel(ctx.day)}\n\n${title.toUpperCase()}\n\n${body}\n\nAbout ${ctx.org.name}: ${aboutLine(ctx)}\n\nMedia contact: press@${domain(ctx.org)}`,
  };
}

function aboutLine(ctx: DocCtx): string {
  const years = Math.floor(ctx.day / 365);
  return `${ctx.org.name} is a ${ctx.theme.orgNoun} founded ${years > 0 ? `${years} years ago` : "this year"}${ctx.theme.kind === "fantasy_kingdom" ? ", sovereign over its lands and subjects." : ", dedicated to work that matters."}`;
}

function meetingMinutes(ctx: DocCtx, title: string, attendeeIds: number[], items: string[]): DocDraft {
  const names = attendeeIds.map((id) => ctx.emp(id)?.name).filter(Boolean).slice(0, 8);
  return {
    type: "meeting_minutes", title: `Minutes — ${title}`, authorId: attendeeIds.length > 0 ? attendeeIds[0] : null,
    body: `MEETING MINUTES\nDate: ${ctx.dateLabel(ctx.day)}\nSubject: ${title}\nAttendees: ${names.join(", ") || "—"}\n\n${items.map((it, i) => `${i + 1}. ${it}`).join("\n")}\n\nNext steps recorded in the action tracker.`,
  };
}

function securityLogLines(ctx: DocCtx): string {
  const rng = ctx.rng;
  const lines: string[] = [];
  const hosts = ["gw-01", "auth-02", "db-prod-1", "vpn-edge", "mail-01", "backup-03"];
  let hour = rng.int(0, 20);
  for (let i = 0; i < rng.int(5, 9); i++) {
    hour = Math.min(23, hour + rng.int(0, 1));
    const min = rng.int(0, 59).toString().padStart(2, "0");
    lines.push(`${hour.toString().padStart(2, "0")}:${min}:${rng.int(0, 59).toString().padStart(2, "0")} ${rng.pick(hosts)} ${rng.pick([
      "AUTH_FAIL user=svc_backup src=external",
      "GEO_ANOMALY login from unrecognized region",
      "PRIV_ESC attempt blocked policy=deny-all",
      "EXFIL_WATCH large outbound transfer flagged",
      "IDS signature match: lateral movement toolkit",
      "TOKEN_REUSE stale session presented",
      "FW rule 447 drop count exceeded threshold",
      "MALWARE quarantine: dropper.bin sha256=…",
    ])}`);
  }
  return lines.join("\n");
}
