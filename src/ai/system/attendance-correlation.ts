// Deterministic attendance-correlation insights — replaces the AI prompt that
// used to live at ai/engines/attendance-engine.ts ::
// generateAttendanceInsights. Pure functions over real Firestore-derived
// attendance logs. No mock, no defaults that look like data.
//
// Returns four insight surfaces the AttendancePage renders:
//   1. band             — "excellent" | "good" | "needs_improvement" | "critical"
//   2. correlation_narrative — sentence that ties the band to academic impact
//   3. impact_analysis  — 3 concrete bullet points the parent can act on
//   4. growth_strategy  — single-sentence next-step plan
//   5. streak           — current/longest run of present days
//   6. day_pattern      — most-missed weekday, if a clear pattern exists
//
// Band thresholds (locked spec — see ai_features_master_breakdown.md):
//   percentage >= 90  → excellent
//   75..89            → good
//   60..74            → needs_improvement
//   < 60              → critical

export type AttendanceLog = {
  date?: string;                 // "YYYY-MM-DD"
  status?: "present" | "absent" | "late" | string;
};

export type AttendanceBand = "excellent" | "good" | "needs_improvement" | "critical";

export type AttendanceCorrelation = {
  band: AttendanceBand;
  band_label: string;
  correlation_narrative: string;
  impact_analysis: string[];
  growth_strategy: string;
  streak: {
    current_streak: number;       // current consecutive present days (0 if today is absent/late)
    longest_streak: number;       // longest historical present streak in window
  };
  day_pattern: {
    weekday: string | null;       // "Monday" | ... | null if no clear pattern
    absence_count: number;        // absences on that weekday in the window
  };
  totals: {
    total_marked: number;
    present: number;
    absent: number;
    late: number;
    percentage: number;            // (present + late) / total_marked, rounded
  };
};

export type AttendanceCorrelationInput = {
  childName: string;
  logs: AttendanceLog[];
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const safeName = (n: string): string => (n && n.trim().length > 0 ? n.trim() : "Your child");

const bandFromPct = (pct: number, totalMarked: number): AttendanceBand => {
  // No marked days yet → treat as needs_improvement so the UI prompts action,
  // never as "excellent" (which would silently fake a perfect record).
  if (totalMarked === 0) return "needs_improvement";
  if (pct >= 90) return "excellent";
  if (pct >= 75) return "good";
  if (pct >= 60) return "needs_improvement";
  return "critical";
};

const labelFor = (band: AttendanceBand): string => ({
  excellent: "Excellent attendance",
  good: "On track",
  needs_improvement: "Needs improvement",
  critical: "Critical — immediate action",
}[band]);

const narrativeFor = (
  band: AttendanceBand,
  pct: number,
  name: string,
  totalMarked: number,
): string => {
  if (totalMarked === 0) {
    return `No attendance has been marked for ${name} yet. Once teachers begin recording daily attendance, this section will track patterns and their impact on learning.`;
  }
  switch (band) {
    case "excellent":
      return `${name}'s ${pct}% attendance is excellent — research consistently shows students above 90% retain materially more from each term and recover faster from missed lessons.`;
    case "good":
      return `${name}'s ${pct}% attendance is on track. Students in the 75–89% band typically perform within one grade band of their peers but lose marks on topics taught during their absent days.`;
    case "needs_improvement":
      return `${name}'s ${pct}% attendance is below the comfort zone. At 60–75%, missed concepts start compounding — every absent week makes the next one harder to follow.`;
    case "critical":
      return `${name}'s ${pct}% attendance is at a critical level. Below 60%, students typically miss the foundation of new chapters and exam syllabi, putting current and next term at real risk.`;
  }
};

const impactFor = (
  band: AttendanceBand,
  totals: { absent: number; late: number },
  name: string,
): string[] => {
  switch (band) {
    case "excellent":
      return [
        "Consistent presence is directly improving classroom understanding and assessment performance.",
        `Only ${totals.absent} absences and ${totals.late} late arrivals so far this term — a strong base for the next test cycle.`,
        "Teachers are more likely to recommend high-attendance students for enrichment opportunities and competitions.",
      ];
    case "good":
      return [
        "Some lessons have been missed; reviewing the school diary for the absent days will help close minor gaps.",
        `${totals.absent} absences and ${totals.late} late arrivals recorded — pushing presence above 90% widens the margin for unexpected sick days later.`,
        "A short Friday catch-up routine on the week's missed work prevents drift before tests.",
      ];
    case "needs_improvement":
      return [
        `${totals.absent} absences are starting to affect topic continuity — chapter-based subjects (Math, Science) will be the first to show the gap.`,
        `${totals.late} late entries also disrupt the day's first lesson, often the one with the most new material.`,
        "Without a recovery plan, this attendance level usually correlates with a 5–15% drop in term-end averages.",
      ];
    case "critical":
      return [
        "At this level the student is missing foundational concepts that later chapters depend on — recovery requires structured catch-up, not just attending more days.",
        `${totals.absent} absences and ${totals.late} late arrivals — exam eligibility and term promotion may be at risk depending on school policy.`,
        "Speak to the class teacher this week to identify the most critical missed topics and arrange remedial sessions.",
      ];
  }
};

const strategyFor = (band: AttendanceBand, name: string): string => {
  switch (band) {
    case "excellent":
      return `Keep ${name}'s morning routine consistent — predictable wake-up and leave-by times are the single biggest lever for sustaining 90%+ attendance.`;
    case "good":
      return `Identify the one weekday ${name} most often misses and protect it: a small change there typically lifts attendance into the excellent band within a month.`;
    case "needs_improvement":
      return `Schedule a 15-minute weekly catch-up session at home for missed lessons, and target attending every day next week as a short reset goal.`;
    case "critical":
      return `Meet the class teacher this week to agree on a recovery plan for missed topics, and treat full attendance over the next two weeks as the single most important academic priority.`;
  }
};

const computeStreak = (logs: AttendanceLog[]): { current_streak: number; longest_streak: number } => {
  // Sort ascending by date so we can compute streaks chronologically
  const sorted = logs
    .filter((l) => l.date && l.status)
    .slice()
    .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0));

  let longest = 0;
  let running = 0;
  for (const l of sorted) {
    if (l.status === "present") {
      running += 1;
      if (running > longest) longest = running;
    } else {
      running = 0;
    }
  }

  // current_streak = consecutive present days at the END of the sorted list
  let current = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].status === "present") current += 1;
    else break;
  }

  return { current_streak: current, longest_streak: longest };
};

const computeDayPattern = (logs: AttendanceLog[]): { weekday: string | null; absence_count: number } => {
  const absencesByDow = [0, 0, 0, 0, 0, 0, 0];
  let totalAbsences = 0;
  for (const l of logs) {
    if (l.status !== "absent" || !l.date) continue;
    // Parse "YYYY-MM-DD" without timezone surprises (Date(string) is local-tz)
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(l.date);
    if (!m) continue;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(d.getTime())) continue;
    absencesByDow[d.getDay()] += 1;
    totalAbsences += 1;
  }
  // Need at least 3 absences in the window AND one weekday must hold 40%+
  // of them to call it a "pattern". Prevents calling a single Wed absence
  // "a Wednesday pattern".
  if (totalAbsences < 3) return { weekday: null, absence_count: 0 };
  let bestDow = -1;
  let bestCount = 0;
  for (let i = 1; i <= 5; i++) { // weekdays only (Mon=1..Fri=5)
    if (absencesByDow[i] > bestCount) {
      bestCount = absencesByDow[i];
      bestDow = i;
    }
  }
  if (bestDow < 0 || bestCount / totalAbsences < 0.4) return { weekday: null, absence_count: 0 };
  return { weekday: WEEKDAYS[bestDow], absence_count: bestCount };
};

export function computeAttendanceCorrelation(
  input: AttendanceCorrelationInput,
): AttendanceCorrelation {
  const name = safeName(input.childName);
  const logs = Array.isArray(input.logs) ? input.logs : [];

  let present = 0, absent = 0, late = 0;
  for (const l of logs) {
    if (l.status === "present") present += 1;
    else if (l.status === "absent") absent += 1;
    else if (l.status === "late") late += 1;
  }
  const totalMarked = present + absent + late;
  const percentage = totalMarked === 0 ? 0 : Math.round(((present + late) / totalMarked) * 100);

  const band = bandFromPct(percentage, totalMarked);
  const totals = { total_marked: totalMarked, present, absent, late, percentage };

  return {
    band,
    band_label: labelFor(band),
    correlation_narrative: narrativeFor(band, percentage, name, totalMarked),
    impact_analysis: impactFor(band, { absent, late }, name),
    growth_strategy: strategyFor(band, name),
    streak: computeStreak(logs),
    day_pattern: computeDayPattern(logs),
    totals,
  };
}
