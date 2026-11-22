import { all, one, run, tx, lastId, save } from "./db";
import { calculatePenalty, dueDateFor, PenaltyConfig } from "../lib/penalty";
import { today, MONTHS_EN } from "../lib/format";

export interface Society {
  id: number; name: string; city: string | null; due_day: number;
  penalty_method: PenaltyConfig["method"]; penalty_rate: number; penalty_grace_days: number;
  penalty_max_paise: number | null; penalty_effective_from: string;
}
export interface Flat {
  id: number; building: string; flat_no: string; owner_name: string; mobile: string | null; whatsapp: string | null;
  occupancy: string; monthly_maintenance_paise: number; penalty_exempt: number;
}

const audit = (action: string, entity: string, id: number | null, detail = "") =>
  run("INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?,?,?,?,?)", ["admin", action, entity, id, detail]);

export const getSociety = () => one<Society>("SELECT * FROM societies ORDER BY id LIMIT 1");

export const penaltyConfig = (s: Society): PenaltyConfig => ({
  method: s.penalty_method, rate: s.penalty_rate, graceDays: s.penalty_grace_days,
  maxPaise: s.penalty_max_paise, effectiveFrom: s.penalty_effective_from,
});

export async function createSociety(d: { name: string; city: string; method: PenaltyConfig["method"]; rate: number; graceDays: number; maxPaise: number | null }) {
  tx(() => {
    run("INSERT INTO societies (name, city, penalty_method, penalty_rate, penalty_grace_days, penalty_max_paise) VALUES (?,?,?,?,?,?)",
      [d.name, d.city, d.method, d.rate, d.graceDays, d.maxPaise]);
    audit("create", "society", lastId(), d.name);
  });
  await save();
}

export async function updatePenaltyRules(s: Society, d: { method: PenaltyConfig["method"]; rate: number; graceDays: number; maxPaise: number | null; effectiveFrom: string }) {
  tx(() => {
    run("UPDATE societies SET penalty_method=?, penalty_rate=?, penalty_grace_days=?, penalty_max_paise=?, penalty_effective_from=? WHERE id=?",
      [d.method, d.rate, d.graceDays, d.maxPaise, d.effectiveFrom, s.id]);
    audit("update", "penalty_rules", s.id, JSON.stringify(d));
  });
  await save();
}

export const listFlats = (societyId: number, q: string) => {
  const like = `%${q.trim()}%`;
  return all<Flat>(
    `SELECT * FROM flats WHERE society_id=? AND active=1 AND (flat_no LIKE ? OR owner_name LIKE ? OR IFNULL(mobile,'') LIKE ?)
     ORDER BY building, CAST(flat_no AS INTEGER), flat_no`, [societyId, like, like, like]);
};

export async function addFlat(societyId: number, d: { building: string; flat_no: string; owner_name: string; mobile: string; whatsapp: string; occupancy: string; maintenance_paise: number }) {
  tx(() => {
    run("INSERT INTO flats (society_id, building, flat_no, owner_name, mobile, whatsapp, occupancy, monthly_maintenance_paise) VALUES (?,?,?,?,?,?,?,?)",
      [societyId, d.building.trim(), d.flat_no.trim(), d.owner_name.trim(), d.mobile.trim(), d.whatsapp.trim(), d.occupancy, d.maintenance_paise]);
    const id = lastId();
    run("INSERT INTO ownership_history (flat_id, owner_name, from_date) VALUES (?,?,?)", [id, d.owner_name.trim(), today()]);
    audit("create", "flat", id, `${d.building} ${d.flat_no}`);
  });
  await save();
}

/** Creates the month's bill for every active flat that does not have one yet. Safe to run twice. */
export async function generateBills(s: Society, year: number, month: number): Promise<number> {
  let created = 0;
  tx(() => {
    const due = dueDateFor(year, month, s.due_day);
    for (const f of all<Flat>("SELECT * FROM flats WHERE society_id=? AND active=1", [s.id])) {
      const prev = one<{ n: number }>(
        `SELECT COALESCE(SUM(b.maintenance_paise + b.extra_paise + b.penalty_paise - b.penalty_waived_paise),0)
              - COALESCE((SELECT SUM(p.amount_paise) FROM payments p JOIN bills bb ON bb.id=p.bill_id WHERE bb.flat_id=? AND (bb.year*100+bb.month) < ?),0) AS n
         FROM bills b WHERE b.flat_id=? AND (b.year*100+b.month) < ?`, [f.id, year * 100 + month, f.id, year * 100 + month])!.n;
      run("INSERT OR IGNORE INTO bills (society_id, flat_id, year, month, due_date, maintenance_paise, previous_balance_paise) VALUES (?,?,?,?,?,?,?)",
        [s.id, f.id, year, month, due, f.monthly_maintenance_paise, Math.max(0, prev)]);
      if (all("SELECT changes() AS c")[0].c === 1) created++;
    }
    audit("generate_bills", "bills", null, `${year}-${month}: ${created} new`);
  });
  await save();
  return created;
}

export type BillStatus = "paid" | "partial" | "unpaid";
export interface BillView {
  id: number; flat_id: number; flat_no: string; building: string; owner_name: string; mobile: string | null;
  year: number; month: number; due_date: string;
  maintenance: number; previousBalance: number; penalty: number; penaltyDetail: string;
  total: number; paid: number; balance: number; status: BillStatus; overdue: boolean;
}

interface BillRow {
  id: number; flat_id: number; flat_no: string; building: string; owner_name: string; mobile: string | null; penalty_exempt: number;
  year: number; month: number; due_date: string; maintenance_paise: number; extra_paise: number; previous_balance_paise: number;
  penalty_paise: number; penalty_detail: string | null; penalty_waived_paise: number; paid: number; ontime_paid: number;
}

const BILL_SQL = `
  SELECT b.*, f.flat_no, f.building, f.owner_name, f.mobile, f.penalty_exempt,
    COALESCE((SELECT SUM(amount_paise) FROM payments p WHERE p.bill_id=b.id AND p.status='verified'),0) AS paid,
    COALESCE((SELECT SUM(amount_paise) FROM payments p WHERE p.bill_id=b.id AND p.status='verified' AND p.paid_on <= b.due_date),0) AS ontime_paid
  FROM bills b JOIN flats f ON f.id=b.flat_id`;

/** Penalty rule: charged on the unpaid maintenance after the due date; payments made on time reduce the base.
 *  Once the maintenance itself is fully paid the penalty is frozen at the amount assessed on that payment. */
function view(r: BillRow, s: Society, asOf: string): BillView {
  const principal = r.maintenance_paise + r.extra_paise;
  let penalty = r.penalty_paise;
  let detail = r.penalty_detail ?? "";
  if (r.paid < principal) {
    const live = calculatePenalty({
      principalPaise: principal - r.ontime_paid, dueDate: r.due_date, paidDate: asOf,
      config: penaltyConfig(s), exempt: !!r.penalty_exempt, waivedPaise: r.penalty_waived_paise,
    });
    penalty = live.penaltyPaise;
    detail = live.detail;
  }
  const total = principal + penalty; // waivers are already deducted inside the penalty figure
  const balance = Math.max(0, total - r.paid);
  return {
    id: r.id, flat_id: r.flat_id, flat_no: r.flat_no, building: r.building, owner_name: r.owner_name, mobile: r.mobile,
    year: r.year, month: r.month, due_date: r.due_date, maintenance: principal, previousBalance: r.previous_balance_paise,
    penalty, penaltyDetail: detail, total, paid: r.paid, balance,
    status: balance === 0 && r.paid > 0 ? "paid" : r.paid > 0 ? "partial" : "unpaid",
    overdue: balance > 0 && asOf > r.due_date,
  };
}

export const listBills = (s: Society, year: number, month: number): BillView[] =>
  all<BillRow>(`${BILL_SQL} WHERE b.society_id=? AND b.year=? AND b.month=? ORDER BY f.building, CAST(f.flat_no AS INTEGER)`, [s.id, year, month])
    .map((r) => view(r, s, today()));

export interface PaymentInput { billId: number; paidOn: string; amountPaise: number; mode: string; reference: string; note: string }

export async function recordPayment(s: Society, p: PaymentInput): Promise<string> {
  if (!(p.amountPaise > 0)) throw new Error("Enter an amount greater than zero.");
  let receipt = "";
  try {
    tx(() => {
      const row = one<BillRow>(`${BILL_SQL} WHERE b.id=?`, [p.billId]);
      if (!row) throw new Error("Bill not found.");
      const principal = row.maintenance_paise + row.extra_paise;
      // Assess the penalty as of the payment date, once, and overwrite (never add to) the stored value.
      let penalty = row.penalty_paise;
      let detail = row.penalty_detail ?? "";
      if (row.paid < principal) {
        const calc = calculatePenalty({
          principalPaise: principal - row.ontime_paid, dueDate: row.due_date, paidDate: p.paidOn,
          config: penaltyConfig(s), exempt: !!row.penalty_exempt, waivedPaise: row.penalty_waived_paise,
        });
        penalty = calc.penaltyPaise;
        detail = `${calc.detail} (assessed on ${p.paidOn})`;
      }
      const totalDue = principal + penalty;
      if (row.paid + p.amountPaise > totalDue) throw new Error("The amount is more than the balance due.");
      const seq = (one<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE society_id=?", [s.id])!.n) + 1;
      receipt = `R${p.paidOn.slice(0, 4)}-${String(seq).padStart(5, "0")}`;
      const penaltyPart = Math.max(0, Math.min(p.amountPaise, row.paid + p.amountPaise - principal));
      run("UPDATE bills SET penalty_paise=?, penalty_detail=? WHERE id=?", [penalty, detail, p.billId]);
      run(`INSERT INTO payments (society_id, bill_id, receipt_no, paid_on, amount_paise, mode, reference, status, penalty_part_paise, note, entered_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [s.id, p.billId, receipt, p.paidOn, p.amountPaise, p.mode, p.reference.trim() || null, "verified", penaltyPart, p.note, "admin"]);
      audit("payment", "payment", lastId(), `${receipt} ${p.amountPaise}`);
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("UNIQUE") && e.message.includes("reference"))
      throw new Error("This payment reference has already been recorded.");
    throw e;
  }
  await save();
  return receipt;
}

export function dashboard(s: Society, year: number, month: number) {
  const bills = listBills(s, year, month);
  const flats = one<{ n: number; occ: number }>(
    "SELECT COUNT(*) AS n, SUM(CASE WHEN occupancy='vacant' THEN 0 ELSE 1 END) AS occ FROM flats WHERE society_id=? AND active=1", [s.id])!;
  const billed = bills.reduce((a, b) => a + b.total, 0);
  const collected = bills.reduce((a, b) => a + b.paid, 0);
  const ex = expenseSummary(s.id, year, month);
  return {
    expenses: ex.total, pendingExpenses: ex.pendingCount, net: collected - ex.total,
    flats: flats.n, occupied: flats.occ ?? 0, vacant: flats.n - (flats.occ ?? 0),
    billed, collected, pending: billed - collected,
    penalty: bills.reduce((a, b) => a + b.penalty, 0),
    percent: billed ? Math.round((collected / billed) * 100) : 0,
    paidFlats: bills.filter((b) => b.status === "paid").length, billCount: bills.length,
    defaulters: bills.filter((b) => b.overdue),
  };
}

// ---------------------------------------------------------------- Expenses

export const EXPENSE_CATEGORIES = [
  "Electricity", "Water Supply", "Lift Maintenance", "Security", "Housekeeping", "Gardening", "Plumbing", "Repairs",
  "Staff Salary", "Insurance", "Property Tax", "Administrative Expenses", "Festival Expenses", "Other Expenses",
] as const;

export interface ExpenseRow {
  id: number; txn_date: string; voucher_no: string | null; category: string; description: string | null;
  vendor_name: string | null; invoice_no: string | null; amount_paise: number; mode: string | null; reference: string | null;
  approval: "pending" | "approved" | "rejected"; approved_by: string | null; reverses_id: number | null; reversed: number;
}

/** month = 0 means the whole year. */
function dateRange(year: number, month: number): [string, string] {
  const p = (n: number) => String(n).padStart(2, "0");
  if (month === 0) return [`${year}-01-01`, `${year + 1}-01-01`];
  return month === 12 ? [`${year}-12-01`, `${year + 1}-01-01`] : [`${year}-${p(month)}-01`, `${year}-${p(month + 1)}-01`];
}

export function listExpenses(societyId: number, year: number, month: number, category: string): ExpenseRow[] {
  const [from, to] = dateRange(year, month);
  return all<ExpenseRow>(
    `SELECT e.*, v.name AS vendor_name,
            EXISTS (SELECT 1 FROM income_expense r WHERE r.reverses_id = e.id) AS reversed
     FROM income_expense e LEFT JOIN vendors v ON v.id = e.vendor_id
     WHERE e.society_id=? AND e.kind='expense' AND e.txn_date >= ? AND e.txn_date < ? AND (?='' OR e.category=?)
     ORDER BY e.txn_date DESC, e.id DESC`, [societyId, from, to, category, category]);
}

export interface ExpenseInput {
  date: string; category: string; description: string; vendor: string; invoiceNo: string;
  amountPaise: number; mode: string; reference: string;
}

export async function addExpense(s: Society, d: ExpenseInput): Promise<string> {
  if (!(d.amountPaise > 0)) throw new Error("Enter an amount greater than zero.");
  if (!d.date) throw new Error("Choose the expense date.");
  let voucher = "";
  tx(() => {
    let vendorId: number | null = null;
    const name = d.vendor.trim();
    if (name) {
      const v = one<{ id: number }>("SELECT id FROM vendors WHERE society_id=? AND LOWER(name)=LOWER(?)", [s.id, name]);
      if (v) vendorId = v.id;
      else { run("INSERT INTO vendors (society_id, name) VALUES (?,?)", [s.id, name]); vendorId = lastId(); }
    }
    const seq = one<{ n: number }>("SELECT COUNT(*) AS n FROM income_expense WHERE society_id=? AND voucher_no IS NOT NULL", [s.id])!.n + 1;
    voucher = `V${d.date.slice(0, 4)}-${String(seq).padStart(5, "0")}`;
    run(`INSERT INTO income_expense (society_id, kind, txn_date, voucher_no, category, description, vendor_id, invoice_no, amount_paise, mode, reference, approval)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [s.id, "expense", d.date, voucher, d.category, d.description.trim(), vendorId, d.invoiceNo.trim(), d.amountPaise, d.mode, d.reference.trim(), "pending"]);
    audit("expense_add", "expense", lastId(), `${voucher} ${d.category} ${d.amountPaise}`);
  });
  await save();
  return voucher;
}

export async function decideExpense(id: number, decision: "approved" | "rejected", by: string) {
  if (!by.trim()) throw new Error("Enter the name of the person approving.");
  tx(() => {
    run("UPDATE income_expense SET approval=?, approved_by=? WHERE id=? AND kind='expense' AND approval='pending'", [decision, by.trim(), id]);
    if (all("SELECT changes() AS c")[0].c !== 1) throw new Error("This expense has already been decided.");
    audit(decision === "approved" ? "expense_approve" : "expense_reject", "expense", id, by.trim());
  });
  await save();
}

/** Expenses are never deleted. A wrong approved entry is cancelled by a matching negative entry. */
export async function reverseExpense(id: number, reason: string, by: string) {
  if (!reason.trim()) throw new Error("Enter the reason for the reversal.");
  tx(() => {
    const e = one<{ society_id: number; voucher_no: string; category: string; amount_paise: number; approval: string; reverses_id: number | null }>(
      "SELECT * FROM income_expense WHERE id=? AND kind='expense'", [id]);
    if (!e) throw new Error("Expense not found.");
    if (e.approval !== "approved" || e.reverses_id !== null) throw new Error("Only an approved expense can be reversed.");
    run(`INSERT INTO income_expense (society_id, kind, txn_date, category, description, amount_paise, reverses_id, approval, approved_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      [e.society_id, "expense", today(), e.category, `Reversal of ${e.voucher_no}: ${reason.trim()}`, -e.amount_paise, id, "approved", by.trim() || "admin"]);
    audit("expense_reverse", "expense", id, reason.trim());
  });
  await save();
}

export function expenseSummary(societyId: number, year: number, month: number) {
  const [from, to] = dateRange(year, month);
  const byCategory = all<{ category: string; total: number }>(
    `SELECT category, SUM(amount_paise) AS total FROM income_expense
     WHERE society_id=? AND kind='expense' AND approval='approved' AND txn_date >= ? AND txn_date < ?
     GROUP BY category ORDER BY total DESC`, [societyId, from, to]);
  const pending = one<{ n: number; total: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount_paise),0) AS total FROM income_expense
     WHERE society_id=? AND kind='expense' AND approval='pending' AND txn_date >= ? AND txn_date < ?`, [societyId, from, to])!;
  return { byCategory, total: byCategory.reduce((a, r) => a + r.total, 0), pendingCount: pending.n, pendingTotal: pending.total };
}

// ---------------------------------------------------------------- Editing

const diff = (before: Record<string, unknown>, after: Record<string, unknown>) =>
  JSON.stringify(Object.fromEntries(Object.keys(after).filter((k) => before[k] !== after[k]).map((k) => [k, { from: before[k], to: after[k] }])));

export async function updateSociety(s: Society, d: { name: string; city: string; dueDay: number }) {
  if (!d.name.trim()) throw new Error("Enter the society name.");
  if (!(d.dueDay >= 1 && d.dueDay <= 28)) throw new Error("Due day must be between 1 and 28.");
  tx(() => {
    const before = one<Record<string, string | number | null>>("SELECT name, city, due_day FROM societies WHERE id=?", [s.id])!;
    run("UPDATE societies SET name=?, city=?, due_day=? WHERE id=?", [d.name.trim(), d.city.trim(), d.dueDay, s.id]);
    audit("edit", "society", s.id, diff(before, { name: d.name.trim(), city: d.city.trim(), due_day: d.dueDay }));
  });
  await save();
}

export interface FlatInput { building: string; flat_no: string; owner_name: string; mobile: string; whatsapp: string; occupancy: string; maintenance_paise: number; exempt: boolean }

export async function updateFlat(id: number, d: FlatInput) {
  if (!d.flat_no.trim() || !d.owner_name.trim()) throw new Error("Flat number and owner name are required.");
  tx(() => {
    const before = one<Record<string, string | number | null>>(
      "SELECT building, flat_no, owner_name, mobile, whatsapp, occupancy, monthly_maintenance_paise, penalty_exempt FROM flats WHERE id=?", [id])!;
    const after = { building: d.building.trim(), flat_no: d.flat_no.trim(), owner_name: d.owner_name.trim(), mobile: d.mobile.trim(), whatsapp: d.whatsapp.trim(),
      occupancy: d.occupancy, monthly_maintenance_paise: d.maintenance_paise, penalty_exempt: d.exempt ? 1 : 0 };
    run(`UPDATE flats SET building=?, flat_no=?, owner_name=?, mobile=?, whatsapp=?, occupancy=?, monthly_maintenance_paise=?, penalty_exempt=? WHERE id=?`,
      [after.building, after.flat_no, after.owner_name, after.mobile, after.whatsapp, after.occupancy, after.monthly_maintenance_paise, after.penalty_exempt, id]);
    if (before.owner_name !== after.owner_name) { // ownership change: keep the previous owner in the history
      run("UPDATE ownership_history SET to_date=? WHERE flat_id=? AND to_date IS NULL", [today(), id]);
      run("INSERT INTO ownership_history (flat_id, owner_name, from_date) VALUES (?,?,?)", [id, after.owner_name, today()]);
    }
    audit("edit", "flat", id, diff(before, after));
  });
  await save();
}

/** Hides the flat from lists and future billing. Its bills, payments and history stay in the records. */
export async function removeFlat(id: number) {
  tx(() => { run("UPDATE flats SET active=0 WHERE id=?", [id]); audit("remove", "flat", id); });
  await save();
}

/** Recalculates the stored penalty and the penalty share of each payment after any bill or payment edit.
 *  Throws (and the caller's transaction rolls back) if the payments would exceed what is due. */
function reassess(s: Society, billId: number) {
  const row = one<BillRow>(`${BILL_SQL} WHERE b.id=?`, [billId]);
  if (!row) throw new Error("Bill not found.");
  const principal = row.maintenance_paise + row.extra_paise;
  const pays = all<{ id: number; paid_on: string; amount_paise: number }>(
    "SELECT id, paid_on, amount_paise FROM payments WHERE bill_id=? AND status='verified' ORDER BY paid_on, id", [billId]);
  let penalty = 0, detail = "";
  if (pays.length > 0) {
    let cum = 0, asOf = pays[pays.length - 1].paid_on;
    for (const p of pays) { cum += p.amount_paise; if (principal > 0 && cum >= principal) { asOf = p.paid_on; break; } }
    const calc = calculatePenalty({
      principalPaise: principal - row.ontime_paid, dueDate: row.due_date, paidDate: asOf,
      config: penaltyConfig(s), exempt: !!row.penalty_exempt, waivedPaise: row.penalty_waived_paise,
    });
    penalty = calc.penaltyPaise; detail = `${calc.detail} (assessed on ${asOf})`;
  }
  const paid = pays.reduce((a, p) => a + p.amount_paise, 0);
  if (paid > principal + penalty) throw new Error("The payments recorded would be more than the amount due on this bill.");
  run("UPDATE bills SET penalty_paise=?, penalty_detail=? WHERE id=?", [penalty, detail, billId]);
  let cum = 0;
  for (const p of pays) {
    const part = Math.max(0, Math.min(p.amount_paise, cum + p.amount_paise - principal));
    cum += p.amount_paise;
    run("UPDATE payments SET penalty_part_paise=? WHERE id=?", [part, p.id]);
  }
}

export async function updateBill(s: Society, billId: number, d: { maintenancePaise: number; extraPaise: number; waivedPaise: number }) {
  if (d.maintenancePaise < 0 || d.extraPaise < 0 || d.waivedPaise < 0) throw new Error("Amounts cannot be negative.");
  tx(() => {
    const before = one<Record<string, number>>("SELECT maintenance_paise, extra_paise, penalty_waived_paise FROM bills WHERE id=?", [billId])!;
    run("UPDATE bills SET maintenance_paise=?, extra_paise=?, penalty_waived_paise=? WHERE id=?", [d.maintenancePaise, d.extraPaise, d.waivedPaise, billId]);
    reassess(s, billId);
    audit("edit", "bill", billId, diff(before, { maintenance_paise: d.maintenancePaise, extra_paise: d.extraPaise, penalty_waived_paise: d.waivedPaise }));
  });
  await save();
}

export interface PaymentRow {
  id: number; bill_id: number; receipt_no: string; paid_on: string; amount_paise: number; mode: string; reference: string | null;
  note: string | null; reverses_payment_id: number | null; reversed: number; flat_no: string; building: string; owner_name: string;
}

export const listPayments = (s: Society, year: number, month: number) =>
  all<PaymentRow>(
    `SELECT p.*, EXISTS (SELECT 1 FROM payments r WHERE r.reverses_payment_id = p.id) AS reversed, f.flat_no, f.building, f.owner_name
     FROM payments p JOIN bills b ON b.id=p.bill_id JOIN flats f ON f.id=b.flat_id
     WHERE p.society_id=? AND b.year=? AND b.month=? ORDER BY p.paid_on DESC, p.id DESC`, [s.id, year, month]);

export async function updatePayment(s: Society, id: number, d: { paidOn: string; amountPaise: number; mode: string; reference: string; note: string }) {
  if (!(d.amountPaise > 0)) throw new Error("Enter an amount greater than zero.");
  try {
    tx(() => {
      const before = one<{ bill_id: number; paid_on: string; amount_paise: number; mode: string; reference: string | null; note: string | null; reverses_payment_id: number | null }>(
        "SELECT * FROM payments WHERE id=?", [id]);
      if (!before) throw new Error("Payment not found.");
      if (before.reverses_payment_id !== null) throw new Error("A cancellation entry cannot be edited.");
      if (one("SELECT id FROM payments WHERE reverses_payment_id=?", [id])) throw new Error("This payment was cancelled and cannot be edited.");
      run("UPDATE payments SET paid_on=?, amount_paise=?, mode=?, reference=?, note=? WHERE id=?",
        [d.paidOn, d.amountPaise, d.mode, d.reference.trim() || null, d.note, id]);
      reassess(s, before.bill_id);
      audit("edit", "payment", id, diff(before, { paid_on: d.paidOn, amount_paise: d.amountPaise, mode: d.mode, reference: d.reference.trim() || null, note: d.note }));
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("UNIQUE") && e.message.includes("reference")) throw new Error("This payment reference has already been recorded.");
    throw e;
  }
  await save();
}

/** For a payment entered against the wrong bill or flat: cancel it and record the right one. */
export async function cancelPayment(s: Society, id: number, reason: string) {
  if (!reason.trim()) throw new Error("Enter the reason for cancelling.");
  tx(() => {
    const p = one<{ bill_id: number; receipt_no: string; amount_paise: number; mode: string; reverses_payment_id: number | null }>("SELECT * FROM payments WHERE id=?", [id]);
    if (!p) throw new Error("Payment not found.");
    if (p.reverses_payment_id !== null) throw new Error("This is already a cancellation entry.");
    const seq = one<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE society_id=?", [s.id])!.n + 1;
    run(`INSERT INTO payments (society_id, bill_id, receipt_no, paid_on, amount_paise, mode, reverses_payment_id, note, entered_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      [s.id, p.bill_id, `C${today().slice(0, 4)}-${String(seq).padStart(5, "0")}`, today(), -p.amount_paise, p.mode, id, `Cancelled ${p.receipt_no}: ${reason.trim()}`, "admin"]);
    reassess(s, p.bill_id);
    audit("cancel", "payment", id, reason.trim());
  });
  await save();
}

export async function updateExpense(id: number, d: ExpenseInput, society: Society) {
  if (!(d.amountPaise > 0)) throw new Error("Enter an amount greater than zero.");
  tx(() => {
    const before = one<{ txn_date: string; category: string; description: string | null; vendor_id: number | null; invoice_no: string | null; amount_paise: number; mode: string | null; reference: string | null; reverses_id: number | null; approval: string }>(
      "SELECT * FROM income_expense WHERE id=? AND kind='expense'", [id]);
    if (!before) throw new Error("Expense not found.");
    if (before.reverses_id !== null) throw new Error("A reversal entry cannot be edited.");
    if (one("SELECT id FROM income_expense WHERE reverses_id=?", [id])) throw new Error("This expense was reversed and cannot be edited.");
    let vendorId: number | null = null;
    const name = d.vendor.trim();
    if (name) {
      const v = one<{ id: number }>("SELECT id FROM vendors WHERE society_id=? AND LOWER(name)=LOWER(?)", [society.id, name]);
      if (v) vendorId = v.id; else { run("INSERT INTO vendors (society_id, name) VALUES (?,?)", [society.id, name]); vendorId = lastId(); }
    }
    // A changed expense goes back for approval, so an approved figure cannot be altered unnoticed.
    run(`UPDATE income_expense SET txn_date=?, category=?, description=?, vendor_id=?, invoice_no=?, amount_paise=?, mode=?, reference=?, approval='pending', approved_by=NULL WHERE id=?`,
      [d.date, d.category, d.description.trim(), vendorId, d.invoiceNo.trim(), d.amountPaise, d.mode, d.reference.trim(), id]);
    audit("edit", "expense", id, diff(before, { txn_date: d.date, category: d.category, description: d.description.trim(), vendor_id: vendorId, invoice_no: d.invoiceNo.trim(), amount_paise: d.amountPaise, mode: d.mode, reference: d.reference.trim() }));
  });
  await save();
}

export const billParts = (billId: number) => {
  const r = one<{ maintenance_paise: number; extra_paise: number; penalty_waived_paise: number }>(
    "SELECT maintenance_paise, extra_paise, penalty_waived_paise FROM bills WHERE id=?", [billId])!;
  return { maintenance: r.maintenance_paise, extra: r.extra_paise, waived: r.penalty_waived_paise };
};

// ---------------------------------------------------------------- Messages

/** What each flat owes today across all months, including the penalty up to today. */
export function flatDues(s: Society): Map<number, { balance: number; months: string }> {
  const out = new Map<number, { balance: number; months: string[] }>();
  const rows = all<BillRow>(`${BILL_SQL} WHERE b.society_id=? ORDER BY b.year, b.month`, [s.id]);
  for (const r of rows) {
    const b = view(r, s, today());
    if (b.balance <= 0) continue;
    const e = out.get(b.flat_id) ?? { balance: 0, months: [] };
    e.balance += b.balance;
    e.months.push(`${MONTHS_EN[b.month - 1]} ${b.year}`);
    out.set(b.flat_id, e);
  }
  return new Map([...out].map(([k, v]) => [k, { balance: v.balance, months: v.months.join(", ") }]));
}

export async function logMessage(societyId: number, flatId: number, kind: string, number: string, body: string) {
  run("INSERT INTO message_log (society_id, flat_id, kind, to_number, body) VALUES (?,?,?,?,?)", [societyId, flatId, kind, number, body]);
  await save();
}

export const listMessageLog = (societyId: number, limit = 40) =>
  all<{ id: number; at: string; kind: string; body: string; building: string | null; flat_no: string | null; owner_name: string | null }>(
    `SELECT m.id, m.at, m.kind, m.body, f.building, f.flat_no, f.owner_name FROM message_log m LEFT JOIN flats f ON f.id=m.flat_id
     WHERE m.society_id=? ORDER BY m.id DESC LIMIT ?`, [societyId, limit]);
