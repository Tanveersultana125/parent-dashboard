// Deterministic performance insights — replaces the AI prompt that used to live
// at ai/prompts/performance-prompt.ts. The data PerformancePage already
// computes locally (per-subject avg, trend, grade) is fed in here; this module
// turns it into the three narrative surfaces the page renders:
//
//   1. generatePerformanceNarrative()  — narrative_analysis (3-4 sentence story)
//   2. getGoalInsight()                — goal_setting (target gap + action plan)
//   3. getBenchmarkTier()              — peer_comparison (rank tier)
//
// All inputs are real Firestore-derived numbers — no mock, no defaults that
// look like data. Every function is pure and side-effect free.

export type SubjectSummary = {
  name: string;
  progress: number;          // 0..100, already rounded
};

// ── 1. Narrative ─────────────────────────────────────────────────────────────

export function generatePerformanceNarrative(input: {
  studentName: string;
  subjects: SubjectSummary[];
  overallAvg: number;
}): string {
  const { studentName, subjects, overallAvg } = input;
  const name = studentName?.trim() || "Your child";

  if (subjects.length === 0) return "Loading performance insights...";

  const sorted = [...subjects].sort((a, b) => b.progress - a.progress);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];

  let text = `${name} is performing best in ${top.name} with ${top.progress}% this term — ${
    top.progress >= 85 ? "an excellent result" : "showing steady progress"
  }. `;

  if (sorted.length > 1 && bottom.progress < 75) {
    text += `${bottom.name} needs extra attention at ${bottom.progress}% — targeted revision on weak topics can help close the gap. `;
  }

  if (overallAvg >= 85) {
    text += `Overall performance is outstanding. Keep up the great work!`;
  } else if (overallAvg >= 75) {
    text += `The overall average of ${overallAvg}% reflects consistent effort. A little more daily revision can push it to the next level.`;
  } else if (overallAvg >= 60) {
    text += `With a ${overallAvg}% overall average, there is room to grow. Structured study of 30–45 minutes per subject daily can make a real difference.`;
  } else {
    text += `The overall average is ${overallAvg}%. Extra practice and teacher support are recommended to build confidence and improve results.`;
  }

  return text;
}

// ── 2. Goal Setting ──────────────────────────────────────────────────────────

export type GoalInsight = {
  line1: string;
  line2: string;
  /** Tailwind text color class for the headline */
  color: string;
  /** Tailwind bg+border class for the card */
  bg: string;
  /** Numeric gap (target - current); 0 means goal already met */
  gap: number;
};

export function getGoalInsight(current: number, target: number, subName: string): GoalInsight {
  const gap = Math.max(0, target - current);

  if (target <= current) {
    return {
      line1: `✓ Target already achieved in ${subName}!`,
      line2: "Maintain consistency to stay at this level.",
      color: "text-emerald-700",
      bg: "bg-emerald-50 border-emerald-200",
      gap: 0,
    };
  }
  if (gap <= 5) {
    return {
      line1: `Just ${gap}% more needed in ${subName}`,
      line2: "20 mins of daily revision for 1–2 weeks can close this gap.",
      color: "text-sky-700",
      bg: "bg-sky-50 border-sky-200",
      gap,
    };
  }
  if (gap <= 15) {
    return {
      line1: `${gap}% gap to close in ${subName}`,
      line2: "30 mins of focused daily practice for 3–4 weeks is recommended.",
      color: "text-indigo-700",
      bg: "bg-indigo-50 border-indigo-200",
      gap,
    };
  }
  if (gap <= 25) {
    return {
      line1: `${gap}% improvement needed in ${subName}`,
      line2: "45 mins daily for 1.5–2 months, with weekly mock tests, should get there.",
      color: "text-amber-700",
      bg: "bg-amber-50 border-amber-200",
      gap,
    };
  }
  return {
    line1: `${gap}% is a big gap in ${subName}`,
    line2: "1 hour of daily study for 2–3 months + teacher guidance strongly recommended.",
    color: "text-rose-700",
    bg: "bg-rose-50 border-rose-200",
    gap,
  };
}

// ── 3. Benchmark / Peer Comparison ───────────────────────────────────────────

export type BenchmarkTier = {
  label: string;
  /** Tailwind text + bg classes for the pill */
  color: string;
  icon: string;
};

export function getBenchmarkTier(pct: number): BenchmarkTier {
  if (pct >= 90) return { label: "Top 10%", color: "text-violet-700 bg-violet-100", icon: "🏆" };
  if (pct >= 80) return { label: "Top 20%", color: "text-indigo-700 bg-indigo-100", icon: "⭐" };
  if (pct >= 70) return { label: "Top 40%", color: "text-emerald-700 bg-emerald-100", icon: "📈" };
  if (pct >= 60) return { label: "Top 60%", color: "text-amber-700 bg-amber-100", icon: "📊" };
  return { label: "Needs Work", color: "text-rose-700 bg-rose-100", icon: "📚" };
}
