// Late-payment penalty engine. All money is in paise (integer) to avoid rounding errors.

export type PenaltyMethod = "fixed" | "percent" | "per_day" | "monthly_interest";

export interface PenaltyConfig {
  method: PenaltyMethod;
  /** fixed: rupees. percent: % of unpaid maintenance. per_day: rupees per day. monthly_interest: % per month. */
  rate: number;
  graceDays: number;
  /** Cap on the penalty, in paise. null = no cap. */
  maxPaise: number | null;
  /** Penalty applies only to bills whose due date is on or after this date (YYYY-MM-DD). */
  effectiveFrom: string;
}

export interface PenaltyInput {
  /** Unpaid maintenance the penalty is calculated on, in paise. */
  principalPaise: number;
  dueDate: string; // YYYY-MM-DD
  paidDate: string; // YYYY-MM-DD (date payment was received)
  config: PenaltyConfig;
  exempt?: boolean;
  waivedPaise?: number;
}

export interface PenaltyResult {
  penaltyPaise: number;
  daysLate: number;
  chargeableDays: number;
  /** Plain-language record of how the amount was worked out. Stored with the bill. */
  detail: string;
}

export function dueDateFor(year: number, month: number, dueDay = 15): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`;
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

const none = (daysLate: number, chargeableDays: number, detail: string): PenaltyResult => ({
  penaltyPaise: 0, daysLate, chargeableDays, detail,
});

export function calculatePenalty(i: PenaltyInput): PenaltyResult {
  const { config } = i;
  const daysLate = daysBetween(i.dueDate, i.paidDate);
  const chargeableDays = daysLate - config.graceDays;

  if (i.exempt) return none(daysLate, chargeableDays, "Flat is exempted from penalty");
  if (i.dueDate < config.effectiveFrom) return none(daysLate, chargeableDays, `Due date is before penalty effective date ${config.effectiveFrom}`);
  if (daysLate <= 0) return none(daysLate, chargeableDays, "Paid on or before due date");
  if (chargeableDays <= 0) return none(daysLate, chargeableDays, `Within grace period of ${config.graceDays} day(s)`);
  if (i.principalPaise <= 0) return none(daysLate, chargeableDays, "Nothing unpaid");

  let raw = 0;
  let how = "";
  switch (config.method) {
    case "fixed":
      raw = Math.round(config.rate * 100);
      how = `Fixed ₹${config.rate}`;
      break;
    case "percent":
      raw = Math.round((i.principalPaise * config.rate) / 100);
      how = `${config.rate}% of ₹${(i.principalPaise / 100).toFixed(2)}`;
      break;
    case "per_day":
      raw = Math.round(config.rate * 100) * chargeableDays;
      how = `₹${config.rate} x ${chargeableDays} day(s)`;
      break;
    case "monthly_interest": {
      const months = Math.ceil(chargeableDays / 30);
      raw = Math.round((i.principalPaise * config.rate * months) / 100);
      how = `${config.rate}% x ${months} month(s) on ₹${(i.principalPaise / 100).toFixed(2)}`;
      break;
    }
  }

  let penalty = raw;
  let detail = `${how}; ${daysLate} day(s) late`;
  if (config.maxPaise !== null && penalty > config.maxPaise) {
    penalty = config.maxPaise;
    detail += `; capped at ₹${(config.maxPaise / 100).toFixed(2)}`;
  }
  const waived = Math.min(i.waivedPaise ?? 0, penalty);
  if (waived > 0) {
    penalty -= waived;
    detail += `; waived ₹${(waived / 100).toFixed(2)}`;
  }
  return { penaltyPaise: penalty, daysLate, chargeableDays, detail };
}
