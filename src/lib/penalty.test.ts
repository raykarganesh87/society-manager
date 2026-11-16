import { describe, expect, it } from "vitest";
import { calculatePenalty, dueDateFor, daysBetween, PenaltyConfig } from "./penalty";

const base: PenaltyConfig = { method: "fixed", rate: 50, graceDays: 0, maxPaise: null, effectiveFrom: "2020-01-01" };
const due = dueDateFor(2026, 11);
const run = (paidDate: string, config: Partial<PenaltyConfig> = {}, extra = {}) =>
  calculatePenalty({ principalPaise: 200000, dueDate: due, paidDate, config: { ...base, ...config }, ...extra });

describe("penalty", () => {
  it("builds the due date", () => expect(due).toBe("2026-11-15"));
  it("counts days across month ends", () => expect(daysBetween("2026-11-15", "2026-12-02")).toBe(17));
  it("no penalty on the due date", () => expect(run("2026-11-15").penaltyPaise).toBe(0));
  it("no penalty before the due date", () => expect(run("2026-11-03").penaltyPaise).toBe(0));
  it("fixed penalty from the 16th", () => expect(run("2026-11-16").penaltyPaise).toBe(5000));
  it("percent", () => expect(run("2026-11-20", { method: "percent", rate: 2 }).penaltyPaise).toBe(4000));
  it("per day", () => expect(run("2026-11-20", { method: "per_day", rate: 10 }).penaltyPaise).toBe(5000));
  it("monthly interest rounds up to whole months", () => {
    expect(run("2026-11-16", { method: "monthly_interest", rate: 1.5 }).penaltyPaise).toBe(3000);
    expect(run("2026-12-20", { method: "monthly_interest", rate: 1.5 }).penaltyPaise).toBe(6000);
  });
  it("grace period delays the penalty", () => {
    expect(run("2026-11-18", { graceDays: 3 }).penaltyPaise).toBe(0);
    expect(run("2026-11-19", { graceDays: 3 }).penaltyPaise).toBe(5000);
  });
  it("per-day counts only days after grace", () =>
    expect(run("2026-11-20", { method: "per_day", rate: 10, graceDays: 2 }).penaltyPaise).toBe(3000));
  it("respects the maximum", () =>
    expect(run("2026-12-30", { method: "per_day", rate: 10, maxPaise: 10000 }).penaltyPaise).toBe(10000));
  it("exempt flats pay nothing", () => expect(run("2026-12-30", {}, { exempt: true }).penaltyPaise).toBe(0));
  it("waiver reduces the penalty and is recorded", () => {
    const r = run("2026-11-20", {}, { waivedPaise: 2000 });
    expect(r.penaltyPaise).toBe(3000);
    expect(r.detail).toContain("waived");
  });
  it("waiver cannot make it negative", () => expect(run("2026-11-20", {}, { waivedPaise: 99999 }).penaltyPaise).toBe(0));
  it("ignores bills due before the effective date", () =>
    expect(run("2026-12-30", { effectiveFrom: "2027-01-01" }).penaltyPaise).toBe(0));
});
