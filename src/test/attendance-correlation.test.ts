import { describe, it, expect } from "vitest";
import { computeAttendanceCorrelation } from "../ai/system/attendance-correlation";

const log = (date: string, status: "present" | "absent" | "late") => ({ date, status });

describe("computeAttendanceCorrelation — totals & percentage", () => {
  it("computes percentage as (present + late) / total_marked", () => {
    const out = computeAttendanceCorrelation({
      childName: "Aditya",
      logs: [
        log("2026-04-01", "present"),
        log("2026-04-02", "present"),
        log("2026-04-03", "present"),
        log("2026-04-06", "late"),
        log("2026-04-07", "absent"),
      ],
    });
    expect(out.totals).toEqual({
      total_marked: 5, present: 3, absent: 1, late: 1, percentage: 80,
    });
  });

  it("returns 0% with empty logs and band 'needs_improvement' (NOT excellent — no fake perfect record)", () => {
    const out = computeAttendanceCorrelation({ childName: "Kid", logs: [] });
    expect(out.totals.percentage).toBe(0);
    expect(out.band).toBe("needs_improvement");
    expect(out.correlation_narrative).toMatch(/No attendance has been marked/);
  });

  it("ignores logs with unknown statuses", () => {
    const out = computeAttendanceCorrelation({
      childName: "Kid",
      logs: [
        log("2026-04-01", "present"),
        { date: "2026-04-02", status: "weekend" } as any,
        { date: "2026-04-03", status: undefined } as any,
      ],
    });
    expect(out.totals.total_marked).toBe(1);
  });
});

describe("computeAttendanceCorrelation — band thresholds", () => {
  const make = (presents: number, absents: number) =>
    computeAttendanceCorrelation({
      childName: "Kid",
      logs: [
        ...Array.from({ length: presents }, (_, i) => log(`2026-04-${String(i + 1).padStart(2, "0")}`, "present")),
        ...Array.from({ length: absents }, (_, i) => log(`2026-05-${String(i + 1).padStart(2, "0")}`, "absent")),
      ],
    });

  it(">=90% → excellent", () => {
    expect(make(9, 1).band).toBe("excellent");      // 90%
    expect(make(95, 5).band).toBe("excellent");      // 95%
  });

  it("75..89% → good", () => {
    expect(make(89, 11).band).toBe("good");          // 89%
    expect(make(75, 25).band).toBe("good");          // 75%
  });

  it("60..74% → needs_improvement", () => {
    expect(make(74, 26).band).toBe("needs_improvement"); // 74%
    expect(make(60, 40).band).toBe("needs_improvement"); // 60%
  });

  it("<60% → critical", () => {
    expect(make(59, 41).band).toBe("critical");      // 59%
    expect(make(20, 80).band).toBe("critical");      // 20%
  });
});

describe("computeAttendanceCorrelation — narrative & impact", () => {
  it("uses the child's name in the narrative", () => {
    const out = computeAttendanceCorrelation({
      childName: "Aditya",
      logs: [log("2026-04-01", "present"), log("2026-04-02", "present")],
    });
    expect(out.correlation_narrative).toMatch(/Aditya/);
  });

  it("falls back to 'Your child' when name is empty", () => {
    const out = computeAttendanceCorrelation({
      childName: "",
      logs: [log("2026-04-01", "present"), log("2026-04-02", "present")],
    });
    expect(out.correlation_narrative).toMatch(/Your child/);
  });

  it("returns exactly 3 impact_analysis bullets for every band", () => {
    const cases = [
      { presents: 10, absents: 0 },   // excellent
      { presents: 8, absents: 2 },    // good
      { presents: 7, absents: 3 },    // needs_improvement
      { presents: 4, absents: 6 },    // critical
    ];
    cases.forEach(({ presents, absents }) => {
      const out = computeAttendanceCorrelation({
        childName: "Kid",
        logs: [
          ...Array.from({ length: presents }, (_, i) => log(`2026-04-${String(i + 1).padStart(2, "0")}`, "present")),
          ...Array.from({ length: absents }, (_, i) => log(`2026-05-${String(i + 1).padStart(2, "0")}`, "absent")),
        ],
      });
      expect(out.impact_analysis).toHaveLength(3);
      out.impact_analysis.forEach(b => expect(b.length).toBeGreaterThan(10));
    });
  });

  it("growth_strategy is non-empty for every band", () => {
    [10, 80, 70, 50].forEach(p => {
      const out = computeAttendanceCorrelation({
        childName: "Kid",
        logs: Array.from({ length: 100 }, (_, i) =>
          log(`2026-04-${String((i % 28) + 1).padStart(2, "0")}`, i < p ? "present" : "absent")),
      });
      expect(out.growth_strategy.length).toBeGreaterThan(15);
    });
  });
});

describe("computeAttendanceCorrelation — streak", () => {
  it("computes longest streak across the window", () => {
    const out = computeAttendanceCorrelation({
      childName: "Kid",
      logs: [
        log("2026-04-01", "present"),
        log("2026-04-02", "present"),
        log("2026-04-03", "absent"),
        log("2026-04-06", "present"),
        log("2026-04-07", "present"),
        log("2026-04-08", "present"),
        log("2026-04-09", "present"),
        log("2026-04-10", "absent"),
      ],
    });
    expect(out.streak.longest_streak).toBe(4);
  });

  it("computes current_streak from the END of the timeline (chronological)", () => {
    const out = computeAttendanceCorrelation({
      childName: "Kid",
      logs: [
        log("2026-04-01", "absent"),
        log("2026-04-02", "present"),
        log("2026-04-03", "present"),
        log("2026-04-04", "present"),
      ],
    });
    expect(out.streak.current_streak).toBe(3);
  });

  it("current_streak is 0 if the most recent record is not 'present'", () => {
    const out = computeAttendanceCorrelation({
      childName: "Kid",
      logs: [
        log("2026-04-01", "present"),
        log("2026-04-02", "present"),
        log("2026-04-03", "absent"),
      ],
    });
    expect(out.streak.current_streak).toBe(0);
  });

  it("logs supplied out-of-order still produce correct streaks (sorted internally)", () => {
    const out = computeAttendanceCorrelation({
      childName: "Kid",
      logs: [
        log("2026-04-04", "present"),
        log("2026-04-01", "present"),
        log("2026-04-03", "present"),
        log("2026-04-02", "present"),
      ],
    });
    expect(out.streak.longest_streak).toBe(4);
    expect(out.streak.current_streak).toBe(4);
  });
});

describe("computeAttendanceCorrelation — day pattern", () => {
  it("detects the dominant absent weekday when 40%+ of absences cluster there", () => {
    // Three Mondays absent (2026-04-06/13/20 are Mondays), one other day
    const out = computeAttendanceCorrelation({
      childName: "Kid",
      logs: [
        log("2026-04-06", "absent"),
        log("2026-04-13", "absent"),
        log("2026-04-20", "absent"),
        log("2026-04-08", "absent"),  // Wednesday
      ],
    });
    expect(out.day_pattern.weekday).toBe("Monday");
    expect(out.day_pattern.absence_count).toBe(3);
  });

  it("does NOT call out a pattern with fewer than 3 absences total", () => {
    const out = computeAttendanceCorrelation({
      childName: "Kid",
      logs: [log("2026-04-06", "absent"), log("2026-04-13", "absent")],
    });
    expect(out.day_pattern.weekday).toBeNull();
  });

  it("does NOT call out a pattern when no weekday holds 40%+", () => {
    // Spread 5 absences across 5 different weekdays (each = 20%)
    const out = computeAttendanceCorrelation({
      childName: "Kid",
      logs: [
        log("2026-04-06", "absent"), // Mon
        log("2026-04-07", "absent"), // Tue
        log("2026-04-08", "absent"), // Wed
        log("2026-04-09", "absent"), // Thu
        log("2026-04-10", "absent"), // Fri
      ],
    });
    expect(out.day_pattern.weekday).toBeNull();
  });

  it("ignores invalid date formats safely", () => {
    const out = computeAttendanceCorrelation({
      childName: "Kid",
      logs: [
        { date: "not-a-date", status: "absent" },
        log("2026-04-06", "absent"),
        log("2026-04-13", "absent"),
        log("2026-04-20", "absent"),
      ],
    });
    expect(out.day_pattern.weekday).toBe("Monday");
  });
});

describe("computeAttendanceCorrelation — output shape", () => {
  it("always returns the full insight object even with empty input", () => {
    const out = computeAttendanceCorrelation({ childName: "", logs: [] });
    expect(out).toHaveProperty("band");
    expect(out).toHaveProperty("band_label");
    expect(out).toHaveProperty("correlation_narrative");
    expect(out).toHaveProperty("impact_analysis");
    expect(out).toHaveProperty("growth_strategy");
    expect(out).toHaveProperty("streak");
    expect(out).toHaveProperty("day_pattern");
    expect(out).toHaveProperty("totals");
  });

  it("is deterministic — identical input produces identical output", () => {
    const input = {
      childName: "Aditya",
      logs: [
        log("2026-04-01", "present"),
        log("2026-04-02", "absent"),
        log("2026-04-03", "late"),
      ],
    };
    expect(computeAttendanceCorrelation(input)).toEqual(computeAttendanceCorrelation(input));
  });
});
