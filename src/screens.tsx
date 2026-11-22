import { useEffect, useMemo, useState } from "react";
import type { Key, Lang } from "./lib/i18n";
import { fillTemplate, TEMPLATES, TemplateKind, waLink, waNumber } from "./lib/whatsapp";
import { MONTHS_EN, rupees, toPaise, today } from "./lib/format";
import { PenaltyConfig } from "./lib/penalty";
import {
  flatDues, listMessageLog, logMessage, addExpense, addFlat, updateSociety, updateFlat, removeFlat, updateBill, billParts, listPayments, updatePayment, cancelPayment, updateExpense, PaymentRow, Flat, createSociety, dashboard, decideExpense, EXPENSE_CATEGORIES, expenseSummary, listExpenses, reverseExpense, ExpenseRow, generateBills, listBills, listFlats, recordPayment, updatePenaltyRules, Society, BillView,
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

export function SocietyDetails({ t, society, onChange }: { t: T; society: Society; onChange: () => void }) {
  const [d, setD] = useState({ name: society.name, city: society.city ?? "", dueDay: String(society.due_day) });
  const [n, setN] = useState<Notice>(null);
  const save = async () => {
    try { await updateSociety(society, { name: d.name, city: d.city, dueDay: parseInt(d.dueDay) || 0 }); setN({ kind: "ok", text: t("saved") }); onChange(); }
    catch (e) { setN({ kind: "err", text: errText(e) }); }
  };
  return (
    <section className="card"><h2>{t("society_details")}</h2><Msg n={n} />
      <div className="row">
        <label>{t("society_name")}<input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
        <label>{t("city")}<input value={d.city} onChange={(e) => setD({ ...d, city: e.target.value })} /></label>
        <label>{t("due_day")}<input inputMode="numeric" value={d.dueDay} onChange={(e) => setD({ ...d, dueDay: e.target.value })} /></label>
        <button className="btn" onClick={save}>{t("save_changes")}</button>
      </div>
      <p className="muted">{t("edit_history_note")}</p>
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
    ["total_expenses", rupees(d.expenses)], ["pending_expenses", String(d.pendingExpenses)], ["net", rupees(d.net)],
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
  const blank = { building: "", flat_no: "", owner_name: "", mobile: "", whatsapp: "", occupancy: "owner", maintenance: "", exempt: false };
  const [f, setF] = useState(blank); const [q, setQ] = useState(""); const [n, setN] = useState<Notice>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const flats = listFlats(society.id, q);
  const submit = async () => {
    if (!f.flat_no.trim() || !f.owner_name.trim()) return setN({ kind: "err", text: `${t("flat_no")}, ${t("owner")}` });
    try {
      const data = { building: f.building, flat_no: f.flat_no, owner_name: f.owner_name, mobile: f.mobile, whatsapp: f.whatsapp, occupancy: f.occupancy, maintenance_paise: toPaise(f.maintenance), exempt: f.exempt };
      if (editId !== null) await updateFlat(editId, data); else await addFlat(society.id, data);
      setF(blank); setEditId(null); setN({ kind: "ok", text: t("saved") }); onChange();
    } catch (e) {
      const m = errText(e);
      setN({ kind: "err", text: m.includes("UNIQUE") ? "This flat number already exists in this wing." : m });
    }
  };
  const startEdit = (x: Flat) => {
    setF({ building: x.building, flat_no: x.flat_no, owner_name: x.owner_name, mobile: x.mobile ?? "", whatsapp: x.whatsapp ?? "", occupancy: x.occupancy,
      maintenance: (x.monthly_maintenance_paise / 100).toFixed(2), exempt: !!x.penalty_exempt });
    setEditId(x.id); setN(null); window.scrollTo(0, 0);
  };
  const remove = async (x: Flat) => {
    if (!window.confirm(t("remove_confirm"))) return;
    try { await removeFlat(x.id); if (editId === x.id) { setEditId(null); setF(blank); } onChange(); } catch (e) { setN({ kind: "err", text: errText(e) }); }
  };
  const set = (k: "building" | "flat_no" | "owner_name" | "mobile" | "whatsapp" | "occupancy" | "maintenance") => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <section className="card"><h2>{editId !== null ? t("editing_flat") : t("add_flat")}</h2><Msg n={n} />
        <div className="row">
          <label>{t("building")}<input value={f.building} onChange={set("building")} /></label>
          <label>{t("flat_no")}<input value={f.flat_no} onChange={set("flat_no")} /></label>
          <label>{t("owner")}<input value={f.owner_name} onChange={set("owner_name")} /></label>
          <label>{t("mobile")}<input inputMode="tel" value={f.mobile} onChange={set("mobile")} /></label>
          <label>{t("whatsapp_no")}<input inputMode="tel" value={f.whatsapp} onChange={set("whatsapp")} /></label>
          <label>{t("occupancy")}<select value={f.occupancy} onChange={set("occupancy")}>
            <option value="owner">{t("owner_occ")}</option><option value="tenant">{t("tenant")}</option><option value="vacant">{t("vacant")}</option></select></label>
          <label>{t("maintenance")}<input inputMode="decimal" value={f.maintenance} onChange={set("maintenance")} /></label>
          <label style={{ flex: "0 0 auto" }}><input type="checkbox" style={{ width: "auto" }} checked={f.exempt} onChange={(e) => setF({ ...f, exempt: e.target.checked })} /> {t("exempt")}</label>
          <button className="btn" onClick={submit}>{editId !== null ? t("save_changes") : t("add_flat")}</button>
          {editId !== null && <button className="btn ghost" onClick={() => { setEditId(null); setF(blank); }}>{t("stop_editing")}</button>}
        </div>
      </section>
      <section className="card">
        <label><input type="search" placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} /></label>
        {flats.length === 0 ? <p className="muted">{t("no_flats")}</p> : (
          <div className="scroll"><table><thead><tr><th>{t("flat_no")}</th><th>{t("owner")}</th><th>{t("mobile")}</th><th>{t("occupancy")}</th><th className="num">{t("maintenance")}</th><th></th></tr></thead>
            <tbody>{flats.map((x) => <tr key={x.id}><td>{x.building} {x.flat_no}</td><td>{x.owner_name}</td><td>{x.mobile}</td>
              <td>{t(x.occupancy === "owner" ? "owner_occ" : (x.occupancy as Key))}</td><td className="num">{rupees(x.monthly_maintenance_paise)}</td>
              <td><span className="row" style={{ flexWrap: "nowrap" }}>
                <button className="btn ghost" onClick={() => startEdit(x)}>{t("edit")}</button>
                <button className="btn ghost" onClick={() => remove(x)}>{t("remove")}</button></span></td></tr>)}</tbody></table></div>
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

function EditBillForm({ t, society, bill, onDone, onCancel }: { t: T; society: Society; bill: BillView; onDone: () => void; onCancel: () => void }) {
  const parts = useMemo(() => billParts(bill.id), [bill.id]);
  const [m, setM] = useState((parts.maintenance / 100).toFixed(2));
  const [extra, setExtra] = useState((parts.extra / 100).toFixed(2));
  const [waive, setWaive] = useState((parts.waived / 100).toFixed(2));
  const [n, setN] = useState<Notice>(null);
  const save = async () => {
    try { await updateBill(society, bill.id, { maintenancePaise: toPaise(m), extraPaise: toPaise(extra), waivedPaise: toPaise(waive) }); onDone(); }
    catch (e) { setN({ kind: "err", text: errText(e) }); }
  };
  return (
    <section className="card"><h2>{t("edit_bill")}: {bill.building} {bill.flat_no} · {bill.owner_name}</h2><Msg n={n} />
      <div className="row">
        <label>{t("maintenance")}<input inputMode="decimal" value={m} onChange={(e) => setM(e.target.value)} /></label>
        <label>{t("extra_charges")}<input inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} /></label>
        <label>{t("waive")}<input inputMode="decimal" value={waive} onChange={(e) => setWaive(e.target.value)} /></label>
        <button className="btn" onClick={save}>{t("save_changes")}</button><button className="btn ghost" onClick={onCancel}>{t("cancel")}</button>
      </div>
      <p className="muted">{t("edit_history_note")}</p>
    </section>
  );
}

function EditPaymentForm({ t, society, p, onDone, onCancel }: { t: T; society: Society; p: PaymentRow; onDone: () => void; onCancel: () => void }) {
  const [amount, setAmount] = useState((p.amount_paise / 100).toFixed(2)); const [date, setDate] = useState(p.paid_on);
  const [mode, setMode] = useState(p.mode); const [ref, setRef] = useState(p.reference ?? ""); const [note, setNote] = useState(p.note ?? "");
  const [n, setN] = useState<Notice>(null);
  const save = async () => {
    try { await updatePayment(society, p.id, { paidOn: date, amountPaise: toPaise(amount), mode, reference: ref, note }); onDone(); }
    catch (e) { setN({ kind: "err", text: errText(e) }); }
  };
  return (
    <section className="card"><h2>{t("edit_payment")}: {p.receipt_no} · {p.building} {p.flat_no}</h2><Msg n={n} />
      <div className="row">
        <label>{t("amount")}<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label>{t("date")}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>{t("mode")}<select value={mode} onChange={(e) => setMode(e.target.value)}>
          {(["cash", "upi", "cheque", "neft_rtgs", "bank_transfer", "card", "other"] as Key[]).map((m) => <option key={m} value={m}>{t(m)}</option>)}</select></label>
        <label>{t("reference")}<input value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        <label>{t("note")}<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button className="btn" onClick={save}>{t("save_changes")}</button><button className="btn ghost" onClick={onCancel}>{t("cancel")}</button>
      </div>
      <p className="muted">{t("edit_history_note")}</p>
    </section>
  );
}

export function BillingScreen({ t, society, onChange }: { t: T; society: Society; onChange: () => void }) {
  const [y, setY] = useState(now.getFullYear()); const [m, setM] = useState(now.getMonth() + 1);
  const [paying, setPaying] = useState<BillView | null>(null); const [editBill, setEditBill] = useState<BillView | null>(null);
  const [editPay, setEditPay] = useState<PaymentRow | null>(null); const [cancelling, setCancelling] = useState<number | null>(null); const [reason, setReason] = useState("");
  const [n, setN] = useState<Notice>(null);
  const bills = listBills(society, y, m);
  const payments = listPayments(society, y, m);
  const done = (text: string) => { setPaying(null); setEditBill(null); setEditPay(null); setCancelling(null); setReason(""); setN({ kind: "ok", text }); onChange(); };
  const generate = async () => {
    try { const c = await generateBills(society, y, m); setN({ kind: "ok", text: `${c} ${t("generated")}` }); onChange(); }
    catch (e) { setN({ kind: "err", text: errText(e) }); }
  };
  const cancelIt = async () => {
    if (cancelling === null) return;
    try { await cancelPayment(society, cancelling, reason); done(t("saved")); } catch (e) { setN({ kind: "err", text: errText(e) }); }
  };
  return (
    <>
      <section className="card"><Msg n={n} />
        <div className="row"><MonthPicker t={t} y={y} m={m} setY={setY} setM={setM} /><button className="btn" onClick={generate}>{t("generate")}</button></div>
      </section>
      {paying && <PayForm key={paying.id} t={t} society={society} bill={paying} onCancel={() => setPaying(null)} onDone={(r) => done(`${t("receipt")} ${r}`)} />}
      {editBill && <EditBillForm key={editBill.id} t={t} society={society} bill={editBill} onCancel={() => setEditBill(null)} onDone={() => done(t("saved"))} />}
      {editPay && <EditPaymentForm key={editPay.id} t={t} society={society} p={editPay} onCancel={() => setEditPay(null)} onDone={() => done(t("saved"))} />}
      {cancelling !== null && (
        <section className="card"><h2>{t("cancel_payment")}</h2>
          <div className="row"><label>{t("cancel_reason")}<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <button className="btn" onClick={cancelIt}>{t("confirm_cancel")}</button>
            <button className="btn ghost" onClick={() => { setCancelling(null); setReason(""); }}>{t("cancel")}</button></div></section>
      )}
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
                <td><span className="row" style={{ flexWrap: "nowrap" }}>
                  {b.balance > 0 && <button className="btn ghost" onClick={() => setPaying(b)}>{t("pay")}</button>}
                  <button className="btn ghost" onClick={() => setEditBill(b)}>{t("edit")}</button></span></td>
              </tr>))}</tbody></table></div>
        )}
      </section>
      {payments.length > 0 && (
        <section className="card"><h2>{t("payments_list")}</h2>
          <div className="scroll"><table>
            <thead><tr><th>{t("receipt")}</th><th>{t("date")}</th><th>{t("flat_no")}</th><th>{t("owner")}</th><th>{t("mode")}</th><th>{t("reference")}</th><th className="num">{t("amount")}</th><th></th></tr></thead>
            <tbody>{payments.map((p) => (
              <tr key={p.id}>
                <td>{p.receipt_no}</td><td>{p.paid_on}</td><td>{p.building} {p.flat_no}</td><td>{p.owner_name}</td><td>{t(p.mode as Key)}</td><td>{p.reference}</td>
                <td className="num">{rupees(p.amount_paise)}</td>
                <td>{p.reverses_payment_id !== null ? <span className="tag unpaid">{t("cancelled_tag")}</span> : p.reversed ? <span className="tag unpaid">{t("cancelled_tag")}</span> : (
                  <span className="row" style={{ flexWrap: "nowrap" }}>
                    <button className="btn ghost" onClick={() => setEditPay(p)}>{t("edit")}</button>
                    <button className="btn ghost" onClick={() => setCancelling(p.id)}>{t("cancel_payment")}</button></span>)}</td>
              </tr>))}</tbody></table></div></section>
      )}
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

const EXPENSE_MODES = ["cash", "upi", "cheque", "neft_rtgs", "bank_transfer", "card", "other"] as Key[];
const STATUS_CLASS = { approved: "paid", pending: "partial", rejected: "unpaid" } as const;
const STATUS_KEY = { approved: "st_approved", pending: "st_pending", rejected: "st_rejected" } as const;

export function ExpensesScreen({ t, society, onChange }: { t: T; society: Society; onChange: () => void }) {
  const blank = { date: today(), category: EXPENSE_CATEGORIES[0] as string, description: "", vendor: "", invoiceNo: "", amount: "", mode: "cash", reference: "" };
  const [f, setF] = useState(blank); const [editId, setEditId] = useState<number | null>(null);
  const [y, setY] = useState(now.getFullYear()); const [m, setM] = useState(now.getMonth() + 1); const [cat, setCat] = useState("");
  const [approver, setApprover] = useState(localStorage.getItem("approver") || "");
  const [reversing, setReversing] = useState<number | null>(null); const [reason, setReason] = useState("");
  const [n, setN] = useState<Notice>(null);
  const rows = listExpenses(society.id, y, m, cat);
  const sum = expenseSummary(society.id, y, m);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const catName = (c: string) => t(`cat_${c}` as Key);

  const add = async () => {
    try {
      const data = { date: f.date, category: f.category, description: f.description, vendor: f.vendor, invoiceNo: f.invoiceNo, amountPaise: toPaise(f.amount), mode: f.mode, reference: f.reference };
      if (editId !== null) { await updateExpense(editId, data, society); setEditId(null); setN({ kind: "ok", text: `${t("saved")} ${t("edit_expense_note")}` }); }
      else { await addExpense(society, data); setN({ kind: "ok", text: t("expense_saved") }); }
      setF({ ...blank, date: f.date }); onChange();
    } catch (e) { setN({ kind: "err", text: errText(e) }); }
  };
  const startEdit = (r: ExpenseRow) => {
    setF({ date: r.txn_date, category: r.category, description: r.description ?? "", vendor: r.vendor_name ?? "", invoiceNo: r.invoice_no ?? "",
      amount: (r.amount_paise / 100).toFixed(2), mode: r.mode ?? "cash", reference: r.reference ?? "" });
    setEditId(r.id); setN(null); window.scrollTo(0, 0);
  };
  const decide = async (id: number, d: "approved" | "rejected") => {
    try { localStorage.setItem("approver", approver); await decideExpense(id, d, approver); setN(null); onChange(); }
    catch (e) { setN({ kind: "err", text: errText(e) }); }
  };
  const reverse = async () => {
    if (reversing === null) return;
    try { await reverseExpense(reversing, reason, approver); setReversing(null); setReason(""); setN(null); onChange(); }
    catch (e) { setN({ kind: "err", text: errText(e) }); }
  };

  return (
    <>
      <section className="card"><h2>{editId !== null ? t("editing_expense") : t("add_expense")}</h2><Msg n={n} />
        <div className="row">
          <label>{t("expense_date")}<input type="date" value={f.date} onChange={set("date")} /></label>
          <label>{t("category")}<select value={f.category} onChange={set("category")}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{catName(c)}</option>)}</select></label>
          <label>{t("amount")}<input inputMode="decimal" value={f.amount} onChange={set("amount")} /></label>
          <label>{t("vendor")}<input value={f.vendor} onChange={set("vendor")} /></label>
          <label>{t("invoice_no")}<input value={f.invoiceNo} onChange={set("invoiceNo")} /></label>
          <label>{t("mode")}<select value={f.mode} onChange={set("mode")}>{EXPENSE_MODES.map((k) => <option key={k} value={k}>{t(k)}</option>)}</select></label>
          <label>{t("reference")}<input value={f.reference} onChange={set("reference")} /></label>
          <label>{t("description")}<input value={f.description} onChange={set("description")} /></label>
          <button className="btn" onClick={add}>{editId !== null ? t("save_changes") : t("add_expense")}</button>
          {editId !== null && <button className="btn ghost" onClick={() => { setEditId(null); setF(blank); }}>{t("stop_editing")}</button>}
        </div>
      </section>

      <section className="card">
        <div className="row">
          <label>{t("month")}<select value={m} onChange={(e) => setM(+e.target.value)}>
            <option value={0}>{t("all_months")}</option>{MONTHS_EN.map((x, i) => <option key={x} value={i + 1}>{x}</option>)}</select></label>
          <label>{t("year")}<input type="number" value={y} onChange={(e) => setY(+e.target.value)} /></label>
          <label>{t("category")}<select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">{t("all_categories")}</option>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{catName(c)}</option>)}</select></label>
          <label>{t("approver_name")}<input value={approver} onChange={(e) => setApprover(e.target.value)} /></label>
        </div>
        <div className="grid" style={{ marginTop: 12 }}>
          <div className="stat"><b>{rupees(sum.total)}</b><span>{t("total_expenses")}</span></div>
          <div className="stat"><b>{sum.pendingCount} · {rupees(sum.pendingTotal)}</b><span>{t("pending_expenses")}</span></div>
        </div>
        {sum.byCategory.length > 0 && (
          <div className="scroll" style={{ marginTop: 12 }}><table><thead><tr><th>{t("by_category")}</th><th className="num">{t("amount")}</th></tr></thead>
            <tbody>{sum.byCategory.map((r) => <tr key={r.category}><td>{catName(r.category)}</td><td className="num">{rupees(r.total)}</td></tr>)}</tbody></table></div>
        )}
      </section>

      {reversing !== null && (
        <section className="card"><h2>{t("reverse")}</h2>
          <div className="row"><label>{t("reverse_reason")}<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <button className="btn" onClick={reverse}>{t("confirm_reverse")}</button>
            <button className="btn ghost" onClick={() => { setReversing(null); setReason(""); }}>{t("cancel")}</button></div>
        </section>
      )}

      <section className="card">
        {rows.length === 0 ? <p className="muted">{t("no_expenses")}</p> : (
          <div className="scroll"><table>
            <thead><tr><th>{t("expense_date")}</th><th>{t("voucher")}</th><th>{t("category")}</th><th>{t("vendor")}</th><th>{t("description")}</th><th className="num">{t("amount")}</th><th>{t("status")}</th><th>{t("approved_by")}</th><th></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td>{r.txn_date}</td><td>{r.voucher_no ?? "—"}</td><td>{catName(r.category)}</td><td>{r.vendor_name ?? ""}</td>
                <td style={{ whiteSpace: "normal", minWidth: 140 }}>{r.description}{r.invoice_no ? ` (${r.invoice_no})` : ""}</td>
                <td className="num">{rupees(r.amount_paise)}</td>
                <td><span className={`tag ${STATUS_CLASS[r.approval]}`}>{t(STATUS_KEY[r.approval])}</span>{r.reversed ? <> <span className="tag unpaid">{t("reversed_tag")}</span></> : null}</td>
                <td>{r.approved_by}</td>
                <td>
                  {r.approval === "pending" && <span className="row" style={{ flexWrap: "nowrap" }}>
                    <button className="btn ghost" onClick={() => decide(r.id, "approved")}>{t("approve")}</button>
                    <button className="btn ghost" onClick={() => decide(r.id, "rejected")}>{t("reject")}</button></span>}
                  {!r.reversed && r.reverses_id === null && <button className="btn ghost" onClick={() => startEdit(r)}>{t("edit")}</button>}
                  {r.approval === "approved" && !r.reversed && r.reverses_id === null && <button className="btn ghost" onClick={() => setReversing(r.id)}>{t("reverse")}</button>}
                </td>
              </tr>))}</tbody></table></div>
        )}
      </section>
    </>
  );
}

const KINDS: TemplateKind[] = ["reminder", "notice", "greeting", "custom"];
const KIND_KEY = { reminder: "tpl_reminder", notice: "tpl_notice", greeting: "tpl_greeting", custom: "tpl_custom" } as const;

export function MessagesScreen({ t, lang, society }: { t: T; lang: Lang; society: Society }) {
  const [kind, setKind] = useState<TemplateKind>("reminder");
  const [text, setText] = useState(TEMPLATES[lang].reminder);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [sent, setSent] = useState<Set<number>>(new Set());
  const [q, setQ] = useState(""); const [n, setN] = useState<Notice>(null);
  const flats = listFlats(society.id, q);
  const dues = flatDues(society);
  const history = listMessageLog(society.id);

  const pickKind = (k: TemplateKind) => { setKind(k); setText(TEMPLATES[lang][k]); setSent(new Set()); };
  const toggle = (id: number) => { const s2 = new Set(sel); if (s2.has(id)) s2.delete(id); else s2.add(id); setSel(s2); };

  const vars = (f: Flat) => ({
    name: f.owner_name, flat: `${f.building} ${f.flat_no}`.trim(), society: society.name,
    amount: rupees(dues.get(f.id)?.balance ?? 0), months: dues.get(f.id)?.months ?? "",
  });
  const numberOf = (f: Flat) => waNumber(f.whatsapp || f.mobile);
  const eligible = (f: Flat) => numberOf(f) !== null && (kind !== "reminder" || (dues.get(f.id)?.balance ?? 0) > 0);

  const chosen = flats.filter((f) => sel.has(f.id));
  const queue = chosen.filter((f) => eligible(f) && !sent.has(f.id));
  const first = chosen[0];

  const open = async (f: Flat) => {
    const number = numberOf(f);
    if (!number) return setN({ kind: "err", text: `${f.building} ${f.flat_no}: ${t("no_number")}` });
    const body = fillTemplate(text, vars(f));
    window.open(waLink(number, body), "_blank");
    try { await logMessage(society.id, f.id, kind, number, body); } catch (e) { setN({ kind: "err", text: errText(e) }); }
    setSent(new Set(sent).add(f.id));
  };
  const next = () => {
    if (chosen.length === 0) return setN({ kind: "err", text: t("pick_someone") });
    if (queue.length === 0) return setN({ kind: "ok", text: t("all_done") });
    setN(null); void open(queue[0]);
  };

  return (
    <>
      <section className="card"><h2>{t("messages")}</h2><Msg n={n} />
        <div className="row"><label>{t("msg_type")}<select value={kind} onChange={(e) => pickKind(e.target.value as TemplateKind)}>
          {KINDS.map((k) => <option key={k} value={k}>{t(KIND_KEY[k])}</option>)}</select></label></div>
        <label style={{ marginTop: 10 }}>{t("message_text")}<textarea style={{ fontFamily: "inherit", fontSize: 15, minHeight: 130 }} value={text} onChange={(e) => setText(e.target.value)} /></label>
        <p className="muted">{t("placeholders_help")}</p>
        {first && <p className="msg"><b>{t("preview")} {first.owner_name}</b><br /><span style={{ whiteSpace: "pre-wrap" }}>{fillTemplate(text, vars(first))}</span></p>}
      </section>

      <section className="card"><h2>{t("recipients")}</h2>
        <div className="row" style={{ marginBottom: 8 }}>
          <label><input type="search" placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <button className="btn ghost" onClick={() => setSel(new Set(flats.map((f) => f.id)))}>{t("select_all")}</button>
          <button className="btn ghost" onClick={() => setSel(new Set(flats.filter((f) => (dues.get(f.id)?.balance ?? 0) > 0).map((f) => f.id)))}>{t("select_defaulters")}</button>
          <button className="btn ghost" onClick={() => { setSel(new Set()); setSent(new Set()); }}>{t("clear_sel")}</button>
        </div>
        {flats.length === 0 ? <p className="muted">{t("no_flats")}</p> : (
          <div className="scroll"><table>
            <thead><tr><th></th><th>{t("flat_no")}</th><th>{t("owner")}</th><th>{t("mobile")}</th><th className="num">{t("dues")}</th><th></th></tr></thead>
            <tbody>{flats.map((f) => {
              const ok = numberOf(f) !== null;
              return (
                <tr key={f.id}>
                  <td><input type="checkbox" style={{ width: "auto" }} aria-label={f.owner_name} checked={sel.has(f.id)} onChange={() => toggle(f.id)} /></td>
                  <td>{f.building} {f.flat_no}</td><td>{f.owner_name}</td>
                  <td>{ok ? (f.whatsapp || f.mobile) : <span className="tag unpaid">{t("no_number")}</span>}</td>
                  <td className="num">{rupees(dues.get(f.id)?.balance ?? 0)}</td>
                  <td><span className="row" style={{ flexWrap: "nowrap" }}>
                    {sent.has(f.id) && <span className="tag paid">{t("sent_tag")}</span>}
                    <button className="btn ghost" disabled={!ok} onClick={() => open(f)}>{t("send_one")}</button></span></td>
                </tr>);
            })}</tbody></table></div>
        )}
        <p className="row" style={{ justifyContent: "flex-start", marginTop: 12 }}>
          <button className="btn" onClick={next}>{t("send_next")} ({queue.length} {t("left_n")} · {chosen.length} {t("selected_n")})</button>
        </p>
        <p className="muted">{t("skip_note")} {t("wa_note")}</p>
      </section>

      {history.length > 0 && (
        <section className="card"><h2>{t("msg_history")}</h2>
          <div className="scroll"><table><thead><tr><th>{t("date")}</th><th>{t("flat_no")}</th><th>{t("owner")}</th><th>{t("kind")}</th></tr></thead>
            <tbody>{history.map((h) => <tr key={h.id} title={h.body}><td>{h.at}</td><td>{h.building} {h.flat_no}</td><td>{h.owner_name}</td><td>{t((KIND_KEY as Record<string, string>)[h.kind] as Key)}</td></tr>)}</tbody></table></div></section>
      )}
    </>
  );
}
