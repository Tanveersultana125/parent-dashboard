// Deterministic concept-mastery bucketing.
// Replaces the AI prompt previously at ai/prompts/concept-prompt.ts ::
// getMasteryAnalysisPrompt. Returns the same shape the controller used to
// emit so existing UI code (ConceptStrengthsPage) keeps working unchanged.
//
// Thresholds (locked spec — see ai_features_master_breakdown.md):
//   percentage >= 80           → strong
//   percentage 60..79          → developing
//   percentage <  60           → attention

export type MasteryItem = {
  title: string;
  score: string;     // human-readable, e.g. "84/100" or "92%"
  percentage: number;
  ai_msg: string;    // short deterministic note kept for API compatibility
};

export type SubjectBucket = {
  strong: MasteryItem[];
  developing: MasteryItem[];
  attention: MasteryItem[];
};

export type ConceptMasteryInput = {
  scores: any[];
  assignments: any[];
  enrolled_subjects: string[];
};

const STRONG_FLOOR = 80;
const DEVELOPING_FLOOR = 60;

const normalizeSubject = (raw: any): string => {
  const s = (raw || "").toString().trim();
  if (!s || s.toLowerCase() === "general") return "General";
  return s;
};

const toPercentage = (item: any): number | null => {
  if (typeof item?.percentage === "number") return Math.round(item.percentage);
  const score = Number(item?.score);
  const max = Number(item?.maxScore ?? item?.maxMarks);
  if (Number.isFinite(score) && Number.isFinite(max) && max > 0) {
    return Math.round((score / max) * 100);
  }
  return null;
};

const noteForBucket = (pct: number, bucket: "strong" | "developing" | "attention"): string => {
  if (bucket === "strong") return `Strong grasp at ${pct}% — keep reinforcing with periodic review.`;
  if (bucket === "developing") return `Developing at ${pct}% — targeted practice will lift this into mastery.`;
  return `Needs attention at ${pct}% — schedule focused revision and concept rebuild.`;
};

// Subject matching policy
// ------------------------
// Items are routed to AT MOST ONE subject bucket — never duplicated across
// multiple subjects. The previous AI prompt and the page's per-tab filter
// both treated "General" as a wildcard; doing the same here would inflate
// bucket counts (one general item × N enrolled subjects = N copies). So:
//   1. Exact case-insensitive match wins.
//   2. Substring match wins ONLY if both sides are >= 4 chars (avoids
//      "Hi" matching "Hindi" via includes()).
//   3. Otherwise the item lands under its own subject key — including
//      "General" as a real, separate bucket.
const findEnrolledMatch = (itemSubject: string, enrolled: string[]): string | null => {
  const a = itemSubject.toLowerCase();
  for (const target of enrolled) {
    if (target.toLowerCase() === a) return target;
  }
  if (a.length >= 4) {
    for (const target of enrolled) {
      const b = target.toLowerCase();
      if (b.length >= 4 && (a.includes(b) || b.includes(a))) return target;
    }
  }
  return null;
};

// Hard cap to keep render and serialization bounded for outlier students
// with thousands of historical scores. Within a bucket we keep the most
// representative items (top scores in strong/developing, lowest in attention).
const MAX_ITEMS_PER_BUCKET = 50;

export function computeConceptMastery(input: ConceptMasteryInput): Record<string, SubjectBucket> {
  const subjects: Record<string, SubjectBucket> = {};

  const enrolled = (input.enrolled_subjects || [])
    .map(normalizeSubject)
    .filter(Boolean);

  // Seed every enrolled subject so the UI always renders columns even when
  // no scored items exist for that subject yet.
  enrolled.forEach((sub) => {
    if (!subjects[sub]) subjects[sub] = { strong: [], developing: [], attention: [] };
  });

  const ensureBucket = (sub: string) => {
    if (!subjects[sub]) subjects[sub] = { strong: [], developing: [], attention: [] };
    return subjects[sub];
  };

  const items = [
    ...(input.scores || []).map((s: any) => ({
      title: s.testName || s.title || s.columnName || "Assessment",
      subject: normalizeSubject(s.subject || s.className),
      pct: toPercentage(s),
      raw: s,
    })),
    ...(input.assignments || []).map((a: any) => ({
      title: a.title || a.name || "Assignment",
      subject: normalizeSubject(a.subject || a.className),
      pct: toPercentage(a),
      raw: a,
    })),
  ];

  items.forEach((it) => {
    if (it.pct === null) return;

    // Route to exactly one subject bucket — never duplicate.
    const target = enrolled.length > 0
      ? (findEnrolledMatch(it.subject, enrolled) ?? it.subject)
      : it.subject;

    const bucketSet = ensureBucket(target);
    const bucket: keyof SubjectBucket =
      it.pct >= STRONG_FLOOR ? "strong"
      : it.pct >= DEVELOPING_FLOOR ? "developing"
      : "attention";

    const max = Number(it.raw?.maxScore ?? it.raw?.maxMarks);
    const rawScore = Number(it.raw?.score);
    const display = Number.isFinite(rawScore) && Number.isFinite(max) && max > 0
      ? `${rawScore}/${max}`
      : `${it.pct}%`;

    bucketSet[bucket].push({
      title: it.title,
      score: display,
      percentage: it.pct,
      ai_msg: noteForBucket(it.pct, bucket),
    });
  });

  // Stable ordering + bucket cap. strong/developing keep highest scores,
  // attention keeps the lowest (those are the items that need the most help).
  Object.values(subjects).forEach((b) => {
    b.strong.sort((x, y) => y.percentage - x.percentage);
    b.developing.sort((x, y) => y.percentage - x.percentage);
    b.attention.sort((x, y) => x.percentage - y.percentage);
    if (b.strong.length > MAX_ITEMS_PER_BUCKET) b.strong = b.strong.slice(0, MAX_ITEMS_PER_BUCKET);
    if (b.developing.length > MAX_ITEMS_PER_BUCKET) b.developing = b.developing.slice(0, MAX_ITEMS_PER_BUCKET);
    if (b.attention.length > MAX_ITEMS_PER_BUCKET) b.attention = b.attention.slice(0, MAX_ITEMS_PER_BUCKET);
  });

  return subjects;
}
