import { all, one, run, tx, lastId, save } from "./db";
import { calculatePenalty, dueDateFor, PenaltyConfig } from "../lib/penalty";
import { today } from "../lib/format";

export interface Society {
  id: number; name: string; due_day: number;
  penalty_method: PenaltyConfig["method"]; penalty_rate: number; penalty_grace_days: number;
  penalty_max_paise: number | null; penalty_effective_from: string;
}
export interface Flat {
  id: number; building: string; flat_no: string; owner_name: string; mobile: string | null;
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

export async function addFlat(societyId: number, d: { building: string; flat_no: string; owner_name: string; mobile: string; occupancy: string; maintenance_paise: number }) {
  tx(() => {
    run("INSERT INTO flats (society_id, building, flat_no, owner_name, mobile, occupancy, monthly_maintenance_paise) VALUES (?,?,?,?,?,?,?)",
      [societyId, d.building.trim(), d.flat_no.trim(), d.owner_name.trim(), d.mobile.trim(), d.occupancy, d.maintenance_paise]);
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
  return {
    flats: flats.n, occupied: flats.occ ?? 0, vacant: flats.n - (flats.occ ?? 0),
    billed, collected, pending: billed - collected,
    penalty: bills.reduce((a, b) => a + b.penalty, 0),
    percent: billed ? Math.round((collected / billed) * 100) : 0,
    paidFlats: bills.filter((b) => b.status === "paid").length, billCount: bills.length,
    defaulters: bills.filter((b) => b.overdue),
  };
}
