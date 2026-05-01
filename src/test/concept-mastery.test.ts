import { describe, it, expect } from "vitest";
import { computeConceptMastery } from "../ai/system/concept-mastery";

describe("computeConceptMastery", () => {
  it("seeds enrolled subjects with empty buckets when no data", () => {
    const out = computeConceptMastery({
      scores: [],
      assignments: [],
      enrolled_subjects: ["Math", "Science"],
    });
    expect(Object.keys(out).sort()).toEqual(["Math", "Science"]);
    expect(out.Math).toEqual({ strong: [], developing: [], attention: [] });
  });

  it("buckets scores by threshold (>=80 strong / 60-79 developing / <60 attention)", () => {
    const out = computeConceptMastery({
      scores: [
        { testName: "Algebra Quiz", subject: "Math", percentage: 92 },
        { testName: "Geometry Test", subject: "Math", percentage: 70 },
        { testName: "Calculus Mid", subject: "Math", percentage: 45 },
      ],
      assignments: [],
      enrolled_subjects: ["Math"],
    });
    expect(out.Math.strong.map(x => x.title)).toEqual(["Algebra Quiz"]);
    expect(out.Math.developing.map(x => x.title)).toEqual(["Geometry Test"]);
    expect(out.Math.attention.map(x => x.title)).toEqual(["Calculus Mid"]);
  });

  it("threshold boundaries land in expected buckets (80 strong, 60 developing, 59 attention)", () => {
    const out = computeConceptMastery({
      scores: [
        { testName: "T80", subject: "Math", percentage: 80 },
        { testName: "T79", subject: "Math", percentage: 79 },
        { testName: "T60", subject: "Math", percentage: 60 },
        { testName: "T59", subject: "Math", percentage: 59 },
      ],
      assignments: [],
      enrolled_subjects: ["Math"],
    });
    expect(out.Math.strong.map(x => x.title)).toEqual(["T80"]);
    expect(out.Math.developing.map(x => x.title).sort()).toEqual(["T60", "T79"]);
    expect(out.Math.attention.map(x => x.title)).toEqual(["T59"]);
  });

  it("computes percentage from score/maxScore when percentage is missing", () => {
    const out = computeConceptMastery({
      scores: [
        { testName: "Quiz", subject: "Math", score: 17, maxScore: 20 },  // 85%
        { testName: "Test", subject: "Math", score: 30, maxMarks: 100 }, // 30%
      ],
      assignments: [],
      enrolled_subjects: ["Math"],
    });
    expect(out.Math.strong[0]).toMatchObject({ title: "Quiz", percentage: 85, score: "17/20" });
    expect(out.Math.attention[0]).toMatchObject({ title: "Test", percentage: 30, score: "30/100" });
  });

  it("never duplicates a single item across multiple enrolled subjects (the bug we fixed)", () => {
    const out = computeConceptMastery({
      scores: [
        { testName: "General Quiz", subject: "general", percentage: 50 },
      ],
      assignments: [],
      enrolled_subjects: ["Math", "Science", "English"],
    });
    // Bug would have pushed "General Quiz" into Math + Science + English (3 copies).
    // Correct behavior: routes to its own "General" bucket exactly once.
    const totalAppearances =
      out.Math.attention.length + out.Science.attention.length + out.English.attention.length +
      (out.General?.attention.length ?? 0);
    expect(totalAppearances).toBe(1);
    expect(out.General?.attention[0]?.title).toBe("General Quiz");
  });

  it("matches enrolled subject case-insensitively", () => {
    const out = computeConceptMastery({
      scores: [{ testName: "Q", subject: "MATH", percentage: 90 }],
      assignments: [],
      enrolled_subjects: ["Math"],
    });
    expect(out.Math.strong).toHaveLength(1);
  });

  it("matches via substring only when both sides are >=4 chars", () => {
    // "Mathematics" includes "Math" → matches Math bucket
    const out = computeConceptMastery({
      scores: [{ testName: "X", subject: "Mathematics", percentage: 90 }],
      assignments: [],
      enrolled_subjects: ["Math"],
    });
    expect(out.Math.strong).toHaveLength(1);
    expect(out.Mathematics).toBeUndefined();
  });

  it("does NOT cross-match short codes (e.g. 'Hi' must not match 'Hindi')", () => {
    const out = computeConceptMastery({
      scores: [{ testName: "X", subject: "Hi", percentage: 90 }],
      assignments: [],
      enrolled_subjects: ["Hindi"],
    });
    // "Hi" is < 4 chars, so substring match disabled → routes to its own bucket
    expect(out.Hindi.strong).toHaveLength(0);
    expect(out.Hi?.strong).toHaveLength(1);
  });

  it("skips items with no resolvable percentage", () => {
    const out = computeConceptMastery({
      scores: [
        { testName: "Bad1", subject: "Math" },                       // no score
        { testName: "Bad2", subject: "Math", score: "abc" },         // NaN
        { testName: "Bad3", subject: "Math", score: 5, maxScore: 0 },// div-by-zero
        { testName: "Good", subject: "Math", percentage: 75 },
      ],
      assignments: [],
      enrolled_subjects: ["Math"],
    });
    expect(out.Math.developing).toHaveLength(1);
    expect(out.Math.developing[0].title).toBe("Good");
  });

  it("sorts strong/developing desc by percentage; attention asc (worst first)", () => {
    const out = computeConceptMastery({
      scores: [
        { testName: "S1", subject: "Math", percentage: 85 },
        { testName: "S2", subject: "Math", percentage: 95 },
        { testName: "A1", subject: "Math", percentage: 30 },
        { testName: "A2", subject: "Math", percentage: 50 },
      ],
      assignments: [],
      enrolled_subjects: ["Math"],
    });
    expect(out.Math.strong.map(x => x.title)).toEqual(["S2", "S1"]);
    expect(out.Math.attention.map(x => x.title)).toEqual(["A1", "A2"]);
  });

  it("caps each bucket at 50 items even with thousands of scores", () => {
    const scores = Array.from({ length: 200 }, (_, i) => ({
      testName: `T${i}`,
      subject: "Math",
      percentage: 90,
    }));
    const out = computeConceptMastery({
      scores,
      assignments: [],
      enrolled_subjects: ["Math"],
    });
    expect(out.Math.strong).toHaveLength(50);
  });

  it("merges scores + assignments into the same buckets", () => {
    const out = computeConceptMastery({
      scores: [{ testName: "Quiz", subject: "Math", percentage: 90 }],
      assignments: [{ title: "HW1", subject: "Math", score: 8, maxScore: 10 }], // 80%
      enrolled_subjects: ["Math"],
    });
    expect(out.Math.strong.map(x => x.title).sort()).toEqual(["HW1", "Quiz"]);
  });

  it("handles empty input gracefully", () => {
    const out = computeConceptMastery({ scores: [], assignments: [], enrolled_subjects: [] });
    expect(out).toEqual({});
  });
});
