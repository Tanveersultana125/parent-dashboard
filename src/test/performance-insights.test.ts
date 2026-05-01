import { describe, it, expect } from "vitest";
import {
  generatePerformanceNarrative,
  getGoalInsight,
  getBenchmarkTier,
} from "../ai/system/performance-insights";

describe("generatePerformanceNarrative", () => {
  it("returns the loading copy when there are no subjects", () => {
    expect(generatePerformanceNarrative({ studentName: "Aditya", subjects: [], overallAvg: 0 }))
      .toBe("Loading performance insights...");
  });

  it("highlights the top subject with the student's name", () => {
    const text = generatePerformanceNarrative({
      studentName: "Aditya",
      subjects: [
        { name: "Math", progress: 92 },
        { name: "Science", progress: 70 },
      ],
      overallAvg: 81,
    });
    expect(text).toMatch(/^Aditya is performing best in Math with 92%/);
  });

  it("calls the top result 'excellent' once it crosses 85%", () => {
    const text = generatePerformanceNarrative({
      studentName: "Aditya",
      subjects: [{ name: "Math", progress: 88 }],
      overallAvg: 88,
    });
    expect(text).toMatch(/an excellent result/);
  });

  it("flags weak subjects (<75%) for extra attention", () => {
    const text = generatePerformanceNarrative({
      studentName: "Aditya",
      subjects: [
        { name: "Math", progress: 92 },
        { name: "Hindi", progress: 55 },
      ],
      overallAvg: 73,
    });
    expect(text).toMatch(/Hindi needs extra attention at 55%/);
  });

  it("does NOT flag a 'weak' subject when only one subject exists", () => {
    const text = generatePerformanceNarrative({
      studentName: "Aditya",
      subjects: [{ name: "Math", progress: 50 }],
      overallAvg: 50,
    });
    expect(text).not.toMatch(/needs extra attention/);
  });

  it("uses the right tone for each overall-avg band (>=85, 75-84, 60-74, <60)", () => {
    const base = (avg: number) => generatePerformanceNarrative({
      studentName: "Kid",
      subjects: [{ name: "Math", progress: avg }],
      overallAvg: avg,
    });
    expect(base(90)).toMatch(/outstanding/);
    expect(base(78)).toMatch(/consistent effort/);
    expect(base(65)).toMatch(/room to grow/);
    expect(base(50)).toMatch(/teacher support/);
  });

  it("falls back to 'Your child' when name is empty", () => {
    const text = generatePerformanceNarrative({
      studentName: "",
      subjects: [{ name: "Math", progress: 90 }],
      overallAvg: 90,
    });
    expect(text).toMatch(/^Your child is performing best/);
  });
});

describe("getGoalInsight", () => {
  it("returns 'achieved' when target is at or below current", () => {
    const out = getGoalInsight(80, 80, "Math");
    expect(out.line1).toMatch(/already achieved/);
    expect(out.gap).toBe(0);
  });

  it("uses the small-gap copy for 1-5% gap", () => {
    const out = getGoalInsight(78, 82, "Math");
    expect(out.gap).toBe(4);
    expect(out.line1).toMatch(/Just 4% more/);
    expect(out.line2).toMatch(/20 mins/);
  });

  it("uses the moderate-gap copy for 6-15%", () => {
    const out = getGoalInsight(70, 82, "Math");
    expect(out.gap).toBe(12);
    expect(out.line1).toMatch(/12% gap/);
    expect(out.line2).toMatch(/30 mins/);
  });

  it("uses the larger-gap copy for 16-25%", () => {
    const out = getGoalInsight(60, 80, "Math");
    expect(out.gap).toBe(20);
    expect(out.line1).toMatch(/20% improvement/);
    expect(out.line2).toMatch(/45 mins/);
  });

  it("uses the big-gap copy for >25%", () => {
    const out = getGoalInsight(40, 90, "Math");
    expect(out.gap).toBe(50);
    expect(out.line1).toMatch(/50% is a big gap/);
    expect(out.line2).toMatch(/teacher guidance/);
  });

  it("preserves the subject name in line1", () => {
    expect(getGoalInsight(60, 80, "Sanskrit").line1).toMatch(/Sanskrit/);
  });

  it("returns valid Tailwind classes for color and bg on every band", () => {
    const cases: Array<[number, number]> = [[80, 80], [78, 82], [70, 82], [60, 80], [40, 90]];
    cases.forEach(([cur, tgt]) => {
      const out = getGoalInsight(cur, tgt, "Math");
      expect(out.color).toMatch(/^text-/);
      expect(out.bg).toMatch(/^bg-/);
    });
  });
});

describe("getBenchmarkTier", () => {
  it("returns Top 10% for >=90", () => {
    expect(getBenchmarkTier(95).label).toBe("Top 10%");
    expect(getBenchmarkTier(90).label).toBe("Top 10%");
  });

  it("returns Top 20% for 80-89", () => {
    expect(getBenchmarkTier(85).label).toBe("Top 20%");
    expect(getBenchmarkTier(80).label).toBe("Top 20%");
    expect(getBenchmarkTier(89).label).toBe("Top 20%");
  });

  it("returns Top 40% for 70-79", () => {
    expect(getBenchmarkTier(75).label).toBe("Top 40%");
  });

  it("returns Top 60% for 60-69", () => {
    expect(getBenchmarkTier(65).label).toBe("Top 60%");
  });

  it("returns Needs Work for <60", () => {
    expect(getBenchmarkTier(50).label).toBe("Needs Work");
    expect(getBenchmarkTier(0).label).toBe("Needs Work");
  });

  it("returns a non-empty icon and color on every band", () => {
    [95, 85, 75, 65, 50].forEach(p => {
      const t = getBenchmarkTier(p);
      expect(t.icon.length).toBeGreaterThan(0);
      expect(t.color).toMatch(/text-/);
    });
  });
});
