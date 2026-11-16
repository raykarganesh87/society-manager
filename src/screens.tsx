import { useEffect, useMemo, useState } from "react";
import type { Key } from "./lib/i18n";
import { MONTHS_EN, rupees, toPaise, today } from "./lib/format";
import { PenaltyConfig } from "./lib/penalty";
import {
  addFlat, createSociety, dashboard, generateBills, listBills, listFlats, recordPayment, updatePenaltyRules, Society, BillView,
} from "./db/services";
import { exportBytes, restoreBytes, safetyCopyExists, undoRestore } from "./db/db";
import { decodeBackup, encodeBackup } from "./lib/backup";
import { copyText, exportTextFile } from "./lib/storage";

type T = (k: Key) => string;
type Notice = { kind: "ok" | "err"; text: string } | null;
const Msg = ({ n }: { n: Notice }) => (n ? <p className={`msg ${n.kind}`} role="status">{n.text}</p> : null);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const METHODS: PenaltyConfig["method"][] = ["fixed", "percent", "per_day", "monthly_interest"];

function PenaltyFields({ t, v, set }: { t: T; v: RuleForm; set: (v: RuleForm) => void }) {
  return (
    <div className="row">
      <label>{t("penalty_method")}
        <select value={v.method} onChange={(e) => set({ ...v, method: e.target.value as PenaltyConfig["method"] })}>
          {METHODS.map((m) => <option key={m} value={m}>{t(m)}</option>)}
        </select></label>
      <label>{t("rate")}<input inputMode="decimal" value={v.rate} onChange={(e) => set({ ...v, rate: e.target.value })} /></label>
      <label>{t("grace")}<input inputMode="numeric" value={v.grace} onChange={(e) => set({ ...v, grace: e.target.value })} /></label>
      <label>{t("max_penalty")}<input inputMode="decimal" value={v.max} onChange={(e) => set({ ...v, max: e.target.value })} /></label>
    </div>
  );
}
interface RuleForm { method: PenaltyConfig["method"]; rate: string; grace: string; max: string }
const maxToPaise = (s: string) => (s.trim() === "" ? null : toPaise(s));

export function Setup({ t, onDone }: { t: T; onDone: () => void }) {
  const [name, setName] = useState(""); const [city, setCity] = useState("");
  const [rules, setRules] = useState<RuleForm>({ method: "fixed", rate: "50", grace: "0", max: "" });
  const [n, setN] = useState<Notice>(null);
  const submit = async () => {
    if (!name.trim()) return setN({ kind: "err", text: `${t("society_name")}?` });
    try {
      await createSociety({ name: name.trim(), city: city.trim(), method: rules.method, rate: parseFloat(rules.rate) || 0, graceDays: parseInt(rules.grace) || 0, maxPaise: maxToPaise(rules.max) });
      onDone();
    } catch (e) { setN({ kind: "err", text: errText(e) }); }
  };
  return (
    <section className="card">
      <h2>{t("setup_title")}</h2><Msg n={n} />
      <div className="row">
        <label>{t("society_name")}<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>{t("city")}<input value={city} onChange={(e) => setCity(e.target.value)} /></label>
      </div>
      <PenaltyFields t={t} v={rules} set={setRules} />
      <p><button className="btn" onClick={submit}>{t("create")}</button></p>
    </section>
  );
}

export function RulesScreen({ t, society, onChange }: { t: T; society: Society; onChange: () => void }) {
  const [rules, setRules] = useState<RuleForm>({
    method: society.penalty_method, rate: String(society.penalty_rate), grace: String(society.penalty_grace_days),
    max: society.penalty_max_paise === null ? "" : String(society.penalty_max_paise / 100),
  });
  const [eff, setEff] = useState(society.penalty_effective_from);
  const [n, setN] = useState<Notice>(null);
  const save = async () => {
    try {
      await updatePenaltyRules(society, { method: rules.method, rate: parseFloat(rules.rate) || 0, graceDays: parseInt(rules.grace) || 0, maxPaise: maxToPaise(rules.max), effectiveFrom: eff });
      setN({ kind: "ok", text: "✓" }); onChange();
    } catch (e) { setN({ kind: "err", text: errText(e) }); }
  };
  return (
    <section className="card">
      <h2>{t("settings")}</h2><Msg n={n} />
      <PenaltyFields t={t} v={rules} set={setRules} />
      <div className="row"><label>{t("effective")}<input type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></label></div>
      <p><button className="btn" onClick={save}>{t("save_rules")}</button></p>
    </section>
  );
}

function MonthPicker({ t, y, m, setY, setM }: { t: T; y: number; m: number; setY: (n: number) => void; setM: (n: number) => void }) {
  return (
    <div className="row">
      <label>{t("month")}<select value={m} onChange={(e) => setM(+e.target.value)}>{MONTHS_EN.map((x, i) => <option key={x} value={i + 1}>{x}</option>)}</select></label>
      <label>{t("year")}<input type="number" value={y} onChange={(e) => setY(+e.target.value)} /></label>
    </div>
  );
}
const now = new Date();

export function Dashboard({ t, society }: { t: T; society: Society }) {
  const [y, setY] = useState(now.getFullYear()); const [m, setM] = useState(now.getMonth() + 1);
  const d = useMemo(() => dashboard(society, y, m), [society, y, m]);
  const stats: [Key, string][] = [
    ["total_flats", String(d.flats)], ["occupied", String(d.occupied)], ["vacant", String(d.vacant)],
    ["billed", rupees(d.billed)], ["collected", rupees(d.collected)], ["pending", rupees(d.pending)], ["penalty", rupees(d.penalty)],
  ];
  return (
    <>
      <section className="card">
        <MonthPicker t={t} y={y} m={m} setY={setY} setM={setM} />
        <div className="grid" style={{ marginTop: 12 }}>
          {stats.map(([k, v]) => <div className="stat" key={k}><b>{v}</b><span>{t(k)}</span></div>)}
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>{t("collection")}: {d.percent}% · {t("paid_flats")}: {d.paidFlats}/{d.billCount}</p>
        <div className="bar"><i style={{ width: `${d.percent}%` }} /></div>
      </section>
      <section className="card">
        <h2>{t("defaulters")}</h2>
        {d.defaulters.length === 0 ? <p className="muted">{t("none_overdue")}</p> : (
          <div className="scroll"><table><thead><tr><th>{t("flat_no")}</th><th>{t("owner")}</th><th>{t("mobile")}</th><th className="num">{t("balance")}</th></tr></thead>
            <tbody>{d.defaulters.map((b) => <tr key={b.id}><td>{b.building} {b.flat_no}</td><td>{b.owner_name}</td><td>{b.mobile}</td><td className="num">{rupees(b.balance)}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </>
  );
}

export function FlatsScreen({ t, society, onChange }: { t: T; society: Society; onChange: () => void }) {
  const blank = { building: "", flat_no: "", owner_name: "", mobile: "", occupancy: "owner", maintenance: "" };
  const [f, setF] = useState(blank); const [q, setQ] = useState(""); const [n, setN] = useState<Notice>(null);
  const flats = listFlats(society.id, q);
  const add = async () => {
    if (!f.flat_no.trim() || !f.owner_name.trim()) return setN({ kind: "err", text: `${t("flat_no")}, ${t("owner")}` });
    try {
      await addFlat(society.id, { ...f, maintenance_paise: toPaise(f.maintenance) });
      setF(blank); setN(null); onChange();
    } catch (e) {
      const m = errText(e);
      setN({ kind: "err", text: m.includes("UNIQUE") ? "This flat number already exists in this wing." : m });
    }
  };
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <section className="card"><Msg n={n} />
        <div className="row">
          <label>{t("building")}<input value={f.building} onChange={set("building")} /></label>
          <label>{t("flat_no")}<input value={f.flat_no} onChange={set("flat_no")} /></label>
          <label>{t("owner")}<input value={f.owner_name} onChange={set("owner_name")} /></label>
          <label>{t("mobile")}<input inputMode="tel" value={f.mobile} onChange={set("mobile")} /></label>
          <label>{t("occupancy")}<select value={f.occupancy} onChange={set("occupancy")}>
            <option value="owner">{t("owner_occ")}</option><option value="tenant">{t("tenant")}</option><option value="vacant">{t("vacant")}</option></select></label>
          <label>{t("maintenance")}<input inputMode="decimal" value={f.maintenance} onChange={set("maintenance")} /></label>
          <button className="btn" onClick={add}>{t("add_flat")}</button>
        </div>
      </section>
      <section className="card">
        <label><input type="search" placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} /></label>
        {flats.length === 0 ? <p className="muted">{t("no_flats")}</p> : (
          <div className="scroll"><table><thead><tr><th>{t("flat_no")}</th><th>{t("owner")}</th><th>{t("mobile")}</th><th>{t("occupancy")}</th><th className="num">{t("maintenance")}</th></tr></thead>
            <tbody>{flats.map((x) => <tr key={x.id}><td>{x.building} {x.flat_no}</td><td>{x.owner_name}</td><td>{x.mobile}</td><td>{t(x.occupancy === "owner" ? "owner_occ" : (x.occupancy as Key))}</td><td className="num">{rupees(x.monthly_maintenance_paise)}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </>
  );
}

function PayForm({ t, society, bill, onDone, onCancel }: { t: T; society: Society; bill: BillView; onDone: (receipt: string) => void; onCancel: () => void }) {
  const [amount, setAmount] = useState((bill.balance / 100).toFixed(2));
  const [mode, setMode] = useState("cash"); const [ref, setRef] = useState(""); const [date, setDate] = useState(today()); const [note, setNote] = useState("");
  const [n, setN] = useState<Notice>(null);
  const save = async () => {
    try { onDone(await recordPayment(society, { billId: bill.id, paidOn: date, amountPaise: toPaise(amount), mode, reference: ref, note })); }
    catch (e) { setN({ kind: "err", text: errText(e) }); }
  };
  return (
    <section className="card">
      <h2>{t("pay")}: {bill.building} {bill.flat_no} · {bill.owner_name}</h2><Msg n={n} />
      <div className="row">
        <label>{t("amount")}<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label>{t("date")}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>{t("mode")}<select value={mode} onChange={(e) => setMode(e.target.value)}>
          {(["cash", "upi", "cheque", "neft_rtgs", "bank_transfer", "card", "other"] as Key[]).map((m) => <option key={m} value={m}>{t(m)}</option>)}</select></label>
        <label>{t("reference")}<input value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        <label>{t("note")}<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <p className="row" style={{ justifyContent: "flex-start" }}>
        <button className="btn" onClick={save}>{t("save_payment")}</button>
        <button className="btn ghost" onClick={onCancel}>{t("cancel")}</button>
      </p>
    </section>
  );
}

export function BillingScreen({ t, society, onChange }: { t: T; society: Society; onChange: () => void }) {
  const [y, setY] = useState(now.getFullYear()); const [m, setM] = useState(now.getMonth() + 1);
  const [paying, setPaying] = useState<BillView | null>(null); const [n, setN] = useState<Notice>(null);
  const bills = listBills(society, y, m);
  const generate = async () => {
    try { const c = await generateBills(society, y, m); setN({ kind: "ok", text: `${c} ${t("generated")}` }); onChange(); }
    catch (e) { setN({ kind: "err", text: errText(e) }); }
  };
  return (
    <>
      <section className="card"><Msg n={n} />
        <div className="row"><MonthPicker t={t} y={y} m={m} setY={setY} setM={setM} /><button className="btn" onClick={generate}>{t("generate")}</button></div>
      </section>
      {paying && <PayForm t={t} society={society} bill={paying} onCancel={() => setPaying(null)}
        onDone={(r) => { setPaying(null); setN({ kind: "ok", text: `${t("receipt")} ${r}` }); onChange(); }} />}
      <section className="card">
        {bills.length === 0 ? <p className="muted">{t("no_bills")}</p> : (
          <div className="scroll"><table>
            <thead><tr><th>{t("flat_no")}</th><th>{t("owner")}</th><th>{t("due")}</th><th className="num">{t("maintenance")}</th><th className="num">{t("penalty")}</th><th className="num">{t("total")}</th><th className="num">{t("paid")}</th><th className="num">{t("balance")}</th><th></th><th></th></tr></thead>
            <tbody>{bills.map((b) => (
              <tr key={b.id} title={b.penaltyDetail}>
                <td>{b.building} {b.flat_no}</td><td>{b.owner_name}</td><td>{b.due_date}</td>
                <td className="num">{rupees(b.maintenance)}</td><td className="num">{rupees(b.penalty)}</td><td className="num">{rupees(b.total)}</td>
                <td className="num">{rupees(b.paid)}</td><td className="num">{rupees(b.balance)}</td>
                <td><span className={`tag ${b.status}`}>{t(b.status)}</span></td>
                <td>{b.balance > 0 && <button className="btn ghost" onClick={() => setPaying(b)}>{t("pay")}</button>}</td>
              </tr>))}</tbody></table></div>
        )}
      </section>
    </>
  );
}

export function BackupScreen({ t, onRestored }: { t: T; onRestored: () => void }) {
  const [text, setText] = useState(""); const [n, setN] = useState<Notice>(null); const [canUndo, setCanUndo] = useState(false);
  useEffect(() => { safetyCopyExists().then(setCanUndo); }, []);
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const restore = async (raw: string) => {
    if (!window.confirm(t("restore_warn"))) return;
    try { await restoreBytes(await decodeBackup(raw)); setText(""); setCanUndo(true); setN({ kind: "ok", text: t("restored") }); onRestored(); }
    catch (e) { setN({ kind: "err", text: errText(e) }); }
  };
  return (
    <section className="card">
      <h2>{t("backup_title")}</h2><Msg n={n} />
      <p className="row" style={{ justifyContent: "flex-start" }}>
        <button className="btn" onClick={async () => { try { await copyText(await encodeBackup(exportBytes())); setN({ kind: "ok", text: t("copied") }); } catch (e) { setN({ kind: "err", text: errText(e) }); } }}>{t("copy_backup")}</button>
        <button className="btn ghost" onClick={async () => { try { await exportTextFile(`society-${stamp()}.ssbackup`, await encodeBackup(exportBytes())); } catch (e) { setN({ kind: "err", text: errText(e) }); } }}>{t("save_file")}</button>
      </p>
      <label>{t("paste_here")}<textarea value={text} onChange={(e) => setText(e.target.value)} /></label>
      <p className="muted">{t("restore_warn")}</p>
      <p className="row" style={{ justifyContent: "flex-start" }}>
        <button className="btn" disabled={!text.trim()} onClick={() => restore(text)}>{t("restore_text")}</button>
        <label className="btn ghost" style={{ cursor: "pointer", color: "var(--brand)" }}>{t("restore_file")}
          <input type="file" accept="*/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) restore(await f.text()); }} /></label>
        {canUndo && <button className="btn ghost" onClick={async () => { try { await undoRestore(); setN({ kind: "ok", text: t("undone") }); onRestored(); } catch (e) { setN({ kind: "err", text: errText(e) }); } }}>{t("undo")}</button>}
      </p>
    </section>
  );
}
