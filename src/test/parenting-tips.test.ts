import { describe, it, expect } from "vitest";
import { selectParentingTips } from "../ai/system/parenting-tips";

describe("selectParentingTips", () => {
  it("always returns the requested count of tips", () => {
    const tips = selectParentingTips({
      attendance: null, avgScore: 0, pending: null, tests: null, childName: "",
    }, 3);
    expect(tips).toHaveLength(3);
  });

  it("returns evergreen-only tips when there is no signal-firing data", () => {
    const tips = selectParentingTips({
      attendance: null, avgScore: 0, pending: null, tests: null, childName: "Kid",
    });
    // top 3 evergreens by priority: sleep / reading / breakfast
    expect(tips[0].tip).toMatch(/sleep/i);
    expect(tips[1].tip).toMatch(/reading/i);
    expect(tips[2].tip).toMatch(/breakfast/i);
  });

  it("fires attendance_low tip when attendance < 75", () => {
    const tips = selectParentingTips({
      attendance: 70, avgScore: 0, pending: null, tests: null, childName: "Aditya",
    });
    expect(tips.some(t => /school attendance a top priority/i.test(t.tip))).toBe(true);
  });

  it("fires score_low tip when avgScore < 60", () => {
    const tips = selectParentingTips({
      attendance: null, avgScore: 55, pending: null, tests: null, childName: "Aditya",
    });
    expect(tips.some(t => /lowest-scoring|revision block/i.test(t.tip))).toBe(true);
  });

  it("fires pending_heavy tip when pending > 3 and personalises with child name", () => {
    const tips = selectParentingTips({
      attendance: null, avgScore: 0, pending: 5, tests: null, childName: "Aditya",
    });
    const sit = tips.find(t => /Sit with Aditya tonight/.test(t.tip));
    expect(sit).toBeDefined();
  });

  it("fires tests_upcoming tip when tests > 0", () => {
    const tips = selectParentingTips({
      attendance: null, avgScore: 0, pending: null, tests: 2, childName: "Kid",
    });
    expect(tips.some(t => /three-day preparation|mock test|night-before/i.test(t.tip))).toBe(true);
  });

  it("uses grade-stage tips: primary (1-5) gets reading-aloud", () => {
    const tips = selectParentingTips({
      attendance: 95, avgScore: 90, pending: 0, tests: 0, childName: "Kid", grade: 4,
    });
    expect(tips.some(t => /Read aloud/i.test(t.tip))).toBe(true);
  });

  it("middle stage (6-8) gets weekly notebook review or timetable tip", () => {
    const tips = selectParentingTips({
      attendance: 95, avgScore: 90, pending: 0, tests: 0, childName: "Kid", grade: 7,
    });
    expect(tips.some(t => /weekly review of notebooks|study timetable/i.test(t.tip))).toBe(true);
  });

  it("senior stage (9-12) gets long-term subject interest or board paper tip", () => {
    const tips = selectParentingTips({
      attendance: 95, avgScore: 90, pending: 0, tests: 0, childName: "Kid", grade: 11,
    });
    expect(tips.some(t => /long-term subject|mock board|wellbeing check-ins/i.test(t.tip))).toBe(true);
  });

  it("parses grade strings like 'Class 10' or '10A' correctly", () => {
    const tipsA = selectParentingTips({
      attendance: 95, avgScore: 90, pending: 0, tests: 0, childName: "Kid", grade: "Class 10",
    });
    const tipsB = selectParentingTips({
      attendance: 95, avgScore: 90, pending: 0, tests: 0, childName: "Kid", grade: "10A",
    });
    // both should pick up senior-stage tips
    expect(tipsA.some(t => /long-term subject|mock board|wellbeing check-ins/i.test(t.tip))).toBe(true);
    expect(tipsB.some(t => /long-term subject|mock board|wellbeing check-ins/i.test(t.tip))).toBe(true);
  });

  it("is deterministic — identical input produces identical output across runs", () => {
    const input = {
      attendance: 72, avgScore: 58, pending: 5, tests: 2, childName: "Aditya", grade: 7,
    };
    const a = selectParentingTips(input);
    const b = selectParentingTips(input);
    const c = selectParentingTips(input);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("diversity pass: does NOT emit two tips with the same primary signal", () => {
    // Many attendance_low tips exist (priorities 95, 90, 80). Diversity should
    // pick at most one and fill remaining slots with other signals.
    const tips = selectParentingTips({
      attendance: 60, avgScore: 50, pending: 5, tests: 2, childName: "Kid",
    }, 3);
    // Count tips containing "attendance" — should be exactly 1 (the priority-95 one)
    const attCount = tips.filter(t => /attendance/i.test(t.tip)).length;
    expect(attCount).toBeLessThanOrEqual(1);
  });

  it("falls back to 'your child' if name is empty", () => {
    const tips = selectParentingTips({
      attendance: null, avgScore: 0, pending: 5, tests: null, childName: "",
    });
    const sit = tips.find(t => /Sit with your child tonight/.test(t.tip));
    expect(sit).toBeDefined();
  });

  it("attendance_high (>=85) yields the recognition tip when no other strong signal", () => {
    const tips = selectParentingTips({
      attendance: 92, avgScore: 0, pending: null, tests: null, childName: "Aditya",
    });
    expect(tips.some(t => /Acknowledge Aditya's strong attendance habit/.test(t.tip))).toBe(true);
  });

  it("pending_clear (0) yields recognition tip when no other strong signal", () => {
    const tips = selectParentingTips({
      attendance: null, avgScore: 0, pending: 0, tests: null, childName: "Aditya",
    });
    // Priority 35 — lower than evergreens. So with no other signals, only top 2-3 evergreens win.
    // But evergreen vs pending_clear on same priority: we always include the highest-priority one.
    // Just verify pending_clear is in eligible pool by forcing count high enough.
    const many = selectParentingTips({
      attendance: null, avgScore: 0, pending: 0, tests: null, childName: "Aditya",
    }, 10);
    expect(many.some(t => /Praise Aditya's clean homework slate/.test(t.tip))).toBe(true);
  });

  it("returns valid {tip, reason} shape on every entry", () => {
    const tips = selectParentingTips({
      attendance: 85, avgScore: 75, pending: 2, tests: 1, childName: "Kid", grade: 8,
    });
    tips.forEach(t => {
      expect(typeof t.tip).toBe("string");
      expect(t.tip.length).toBeGreaterThan(10);
      expect(typeof t.reason).toBe("string");
      expect(t.reason.length).toBeGreaterThan(10);
    });
  });
});
