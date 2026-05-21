import { useEffect, useState, useMemo } from "react";
import type { ComponentType, ReactNode } from "react";
import { useNavigate, type NavigateFunction } from "react-router-dom";
import {
  ArrowUp, ArrowDown, Minus, Loader2, AlertCircle,
  Calculator, FlaskConical, Languages, Globe, Monitor, Palette, BookOpen,
  Sparkles, Target, Trophy,
  FileText, Calendar, CheckCircle2, Clock, Heart, AlertTriangle, Activity, ChevronRight,
  Brain,
} from "lucide-react";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart,
  BarChart, Bar, Cell, LabelList,
} from "recharts";
import { SubjectPerformanceDetail } from "@/components/performance/SubjectPerformanceDetail";
import { useAuth } from "@/lib/AuthContext";
import { db } from "@/lib/firebase";
import { onSnapshot, where } from "firebase/firestore";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { subscribePerStudent } from "@/lib/perStudentQuery";
import { subscribeEnrollments } from "@/lib/enrollmentQuery";
import { scopedQuery } from "@/lib/scopedQuery";
import {
  generatePerformanceNarrative,
  getGoalInsight,
  getBenchmarkTier,
} from "@/ai/system/performance-insights";

/* ════════════════════════════════════════════════════════════════════════
   TYPES — strict shapes for raw + derived data so the page can't silently
   read a missing field as `any`.
   ════════════════════════════════════════════════════════════════════════ */

interface RawScore {
  id: string;
  studentId?: string;
  studentEmail?: string;
  classId?: string;
  subject?: string;
  subjectName?: string;
  topic?: string;
  topics?: string[];
  testName?: string;
  columnName?: string;
  // Numeric variants stamped by different writers across the project:
  score?: number | string;
  maxScore?: number | string;
  mark?: number | string;
  maxMarks?: number | string;
  marks?: number | string;
  percentage?: number | string;
  // Timestamp variants — each writer uses a different field name.
  timestamp?: { toDate?: () => Date; seconds?: number } | string | number | null;
  createdAt?: { toDate?: () => Date; seconds?: number } | string | number | null;
  date?: string | number | null;
  testDate?: string | number | null;
}

interface RawFeedback {
  id: string;
  studentId?: string;
  studentEmail?: string;
  subject?: string;
  teacherName?: string;
  content?: string;
  message?: string;
  timestamp?: { toDate?: () => Date; seconds?: number } | string | number | null;
  createdAt?: { toDate?: () => Date; seconds?: number } | string | number | null;
}

interface SubjectAgg {
  name: string;
  grade: string;
  progress: number;
  status: string;
  trendDir: "up" | "down" | "stable";
  raw: RawScore[];
}

interface OverallStats {
  grade: string;     // "A+" or "—"
  avg: number;       // 0-100
  trend: string;     // "+8%" or "—"
  hasData: boolean;
}

interface TrendPoint {
  month: string;
  score: number | null;
}

/* ── Additional collections for end-to-end performance picture ─────── */

interface RawAssignment {
  id: string;
  title?: string;
  classId?: string;
  dueDate?: { toDate?: () => Date; seconds?: number } | string | number | null;
  createdAt?: { toDate?: () => Date; seconds?: number } | string | number | null;
}

// AI Practice attempt — saved by AIPracticePage.tsx into `practice_attempts`
// when the student submits an exam. Contains the score, topic, difficulty,
// and submission timestamp so PerformancePage can show self-study activity
// alongside teacher-graded tests + assignments.
interface RawAIAttempt {
  id: string;
  studentId?: string;
  studentEmail?: string;
  examTitle?: string;
  topic?: string;
  difficulty?: string;
  questionType?: string;
  questionCount?: number;
  score?: number;
  total?: number;
  percentage?: number;
  grade?: string;
  weakTopics?: string[];
  timeTaken?: number;
  submittedAt?: { toDate?: () => Date; seconds?: number } | string | number | null;
}

interface RawSubmission {
  id: string;
  studentId?: string;
  studentEmail?: string;
  // Memory `bug_pattern_dual_id_writer_or_short_circuit`: writer stamps
  // BOTH `homeworkId` (assignment doc id) AND `assignmentId` (teaching
  // assignment id, falls back to "legacy"). Reader must match either.
  homeworkId?: string;
  assignmentId?: string;
  status?: string;          // "Submitted" / "Not Submitted" / undefined
  submittedAt?: { toDate?: () => Date; seconds?: number } | string | number | null;
  timestamp?: { toDate?: () => Date; seconds?: number } | string | number | null;
  score?: number | string;
  grade?: number | string;
}

interface RawAttendance {
  id: string;
  studentId?: string;
  studentEmail?: string;
  // Memory `bug_pattern_ist_vs_utc_date_filter`: MarkAttendance writes
  // `date` as IST date string `YYYY-MM-DD`. Compare with IST-aware key.
  date?: string;
  status?: string;          // "present" / "late" / "absent"
}

interface RawIncident {
  id: string;
  studentId?: string;
  studentEmail?: string;
  type?: string;
  severity?: string;
  description?: string;
  content?: string;
  createdAt?: { toDate?: () => Date; seconds?: number } | string | number | null;
  date?: { toDate?: () => Date; seconds?: number } | string | number | null;
}

interface RawRating {
  id: string;
  studentId?: string;
  studentEmail?: string;
  rating?: number | string;
  note?: string;
  createdAt?: { toDate?: () => Date; seconds?: number } | string | number | null;
}

/** Derived snapshot — every metric the parent should see at a glance. */
interface PerformanceSnapshot {
  subjectsAvg: number | null;       // 0-100 or null
  testsAvg: number | null;
  testCount: number;
  assignmentTotal: number;
  assignmentSubmitted: number;
  assignmentOnTime: number;
  attendancePresent: number;
  attendanceLate: number;
  attendanceAbsent: number;
  attendanceRate: number | null;    // 0-100
  attendanceTotal: number;
  incidents30d: number;
  ratingAvg: number | null;         // 0-5 scale
  ratingCount: number;
}

interface AssignmentRow {
  id: string;
  title: string;
  dueDate: Date | null;
  submitted: boolean;
  onTime: boolean | null;
}

interface TestScoreRow {
  id: string;
  name: string;
  subject: string;
  date: Date | null;
  pct: number;
}

/* ════════════════════════════════════════════════════════════════════════
   HELPERS — score normalization, date safety, grading, subject key.
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Return a 0-100 percentage from any score doc — or `null` when the doc
 * doesn't have enough information for an honest conversion.
 *
 * Memory `bug_pattern_score_zero_no_data`: distinguish "no data" from
 * "actual 0%". Returning `null` lets the caller drop the doc from
 * averages without conflating a missing score with a real zero.
 *
 * Memory `bug_pattern_score_field_singular_mark`: gradebook writes
 * `mark` (singular) + `maxMarks`. We check that first since gradebook
 * is the most common writer.
 */
const pctOf = (s: RawScore): number | null => {
  if (s.percentage != null) {
    const p = Number(s.percentage);
    if (isFinite(p) && p >= 0) return Math.min(100, p);
  }
  if (s.mark != null && s.maxMarks != null) {
    const m = Number(s.mark);
    const max = Number(s.maxMarks);
    if (isFinite(m) && isFinite(max) && max > 0 && m >= 0) {
      return Math.min(100, (m / max) * 100);
    }
  }
  if (s.score != null && s.maxScore != null) {
    const v = Number(s.score);
    const max = Number(s.maxScore);
    if (isFinite(v) && isFinite(max) && max > 0 && v >= 0) {
      return Math.min(100, (v / max) * 100);
    }
  }
  if (s.marks != null) {
    const v = Number(s.marks);
    if (isFinite(v) && v >= 0 && v <= 100) return v;
  }
  // Score alone without explicit max — only safe to interpret as a
  // percentage when the value is plausibly in [0,100]. If a teacher
  // writes `score: 25` thinking out-of-50, we can't recover that
  // intent here; better to return null than fabricate "25%".
  if (s.score != null && s.maxScore == null) {
    const v = Number(s.score);
    if (isFinite(v) && v >= 0 && v <= 100) return v;
  }
  return null;
};

const toSafeDate = (v: unknown): Date | null => {
  if (!v) return null;
  if (typeof v === "object" && v !== null) {
    const obj = v as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === "function") return obj.toDate();
    if (typeof obj.seconds === "number") return new Date(obj.seconds * 1000);
  }
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const scoreDateMs = (s: RawScore): number => {
  const d =
    toSafeDate(s.timestamp) ||
    toSafeDate(s.createdAt) ||
    toSafeDate(s.testDate) ||
    toSafeDate(s.date);
  return d ? d.getTime() : 0;
};

/** Real-subject key — drops testName / columnName (those are titles, not
 *  subjects). Memory: subject grouping with bogus keys creates spurious
 *  cards like "Unit Test 1" or "Col-abc123" as if they were subjects. */
const subjectKey = (s: RawScore): string => {
  const k = (s.subject || s.subjectName || "").trim();
  return k || "General";
};

const gradeFor = (avg: number): string =>
  avg >= 90 ? "A+" :
  avg >= 85 ? "A" :
  avg >= 80 ? "A-" :
  avg >= 75 ? "B+" :
  avg >= 70 ? "B" :
  avg >= 65 ? "C+" : "C";

const subjectStatusFor = (avg: number): string =>
  avg >= 90 ? "Outstanding" :
  avg >= 80 ? "Excellent" :
  avg >= 70 ? "Improving" :
  avg >= 60 ? "Stable" : "Needs Attention";

const getSubIcon = (
  name: string,
): ComponentType<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }> => {
  const n = name.toLowerCase();
  if (n.includes("math")) return Calculator;
  if (n.includes("science")) return FlaskConical;
  if (n.includes("english")) return Languages;
  if (n.includes("social")) return Globe;
  if (n.includes("computer")) return Monitor;
  if (n.includes("art")) return Palette;
  return BookOpen;
};

/** IST date key — `MarkAttendance.tsx` writes `date` as IST `YYYY-MM-DD`.
 *  Comparing with UTC silently drops early-IST-morning marks. */
const istKey = (d: Date): string =>
  d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Match a submission to an assignment via EITHER `homeworkId` or
 *  `assignmentId`. Memory `bug_pattern_dual_id_writer_or_short_circuit`. */
const submissionMatchesAssignment = (sub: RawSubmission, asgId: string): boolean =>
  sub.homeworkId === asgId || sub.assignmentId === asgId;

const isSubmissionCompleted = (s: RawSubmission): boolean =>
  String(s.status || "").toLowerCase() !== "not submitted";

/** Was the submission submitted on-time (before or on the due date)? */
const wasOnTime = (sub: RawSubmission, dueDate: Date | null): boolean | null => {
  if (!dueDate) return null;
  const submittedAt =
    toSafeDate(sub.submittedAt) || toSafeDate(sub.timestamp);
  if (!submittedAt) return null;
  // End-of-day grace on the due date (matches AssignmentsPage convention).
  const eod = new Date(dueDate);
  eod.setHours(23, 59, 59, 999);
  return submittedAt.getTime() <= eod.getTime();
};

/* ════════════════════════════════════════════════════════════════════════
   DESIGN TOKENS — single source for both mobile + desktop, so the two
   branches stay in sync instead of duplicating the palette.
   ════════════════════════════════════════════════════════════════════════ */

const T_PALETTE = {
  B1: "#0055FF", B2: "#1166FF", B3: "#2277FF", B4: "#4499FF",
  BG: "#EEF4FF", BG2: "#E0ECFF",
  T1: "#001040", T2: "#002080", T3: "#5070B0", T4: "#99AACC",
  SEP: "rgba(0,85,255,0.07)",
  GREEN: "#00C853",
  GREEN_S: "rgba(0,200,83,0.12)",
  GREEN_B: "rgba(0,200,83,0.25)",
  GREEN_DEEP: "#007830",
  RED: "#FF3355",
  ORANGE: "#FF8800",
  SH:    "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.09), 0 10px 28px rgba(0,85,255,0.11)",
  SH_LG: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 20px 48px rgba(0,85,255,0.14)",
};

const UNIT_ACCENTS = [
  { icoBg: `linear-gradient(135deg, ${T_PALETTE.B1}, ${T_PALETTE.B3})`, icoShadow: "0 3px 10px rgba(0,85,255,0.28)" },
  { icoBg: "linear-gradient(135deg, #0044EE, #2277FF)", icoShadow: "0 3px 10px rgba(0,68,238,0.28)" },
  { icoBg: "linear-gradient(135deg, #002DBB, #0055FF)", icoShadow: "0 3px 10px rgba(0,45,187,0.28)" },
  { icoBg: "linear-gradient(135deg, #1155EE, #44AAFF)", icoShadow: "0 3px 10px rgba(17,85,238,0.28)" },
];

/* ════════════════════════════════════════════════════════════════════════
   SHARED SUB-COMPONENTS — single source between mobile + desktop. The
   page's outer layout still branches on isMobile, but every card body
   lives in exactly one place.
   ════════════════════════════════════════════════════════════════════════ */

const ListenerErrorBanner = ({
  message, onRetry, marginClass,
}: { message: string; onRetry: () => void; marginClass: string }) => (
  <div
    className={`${marginClass} px-4 py-3 rounded-[14px] flex items-center gap-3`}
    style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b" }}
  >
    <AlertCircle className="w-4 h-4 shrink-0" />
    <div className="flex-1 text-[12px] md:text-[13px]">{message}</div>
    <button onClick={onRetry} className="text-[11px] md:text-[12px] font-bold underline">
      Retry
    </button>
  </div>
);

const LoadingBlock = ({ isMobile }: { isMobile: boolean }) =>
  isMobile ? (
    <div className="flex flex-col items-center gap-3 py-14" style={{ color: T_PALETTE.T4 }}>
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: T_PALETTE.B1 }} />
      <p className="text-sm">Loading performance data…</p>
    </div>
  ) : (
    <div
      className="bg-white rounded-[22px] py-20 flex flex-col items-center gap-3"
      style={{ boxShadow: T_PALETTE.SH, border: "0.5px solid rgba(0,85,255,0.10)" }}
    >
      <Loader2 className="w-10 h-10 animate-spin" style={{ color: T_PALETTE.B1 }} />
      <p className="text-[13px] font-bold uppercase tracking-widest" style={{ color: T_PALETTE.T4 }}>
        Loading performance data…
      </p>
    </div>
  );

const EmptyBlock = ({ isMobile }: { isMobile: boolean }) =>
  isMobile ? (
    <div
      className="mx-5 mt-3 rounded-[22px] py-10 flex flex-col items-center text-center"
      style={{ background: "white", border: "0.5px solid rgba(0,85,255,0.10)" }}
    >
      <div
        className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-3"
        style={{ background: T_PALETTE.BG2, border: "0.5px solid rgba(0,85,255,0.14)" }}
      >
        <BookOpen className="w-7 h-7" style={{ color: T_PALETTE.T4 }} />
      </div>
      <div className="text-[15px] font-bold" style={{ color: T_PALETTE.T2 }}>
        No assessments yet
      </div>
      <div className="text-[12px] mt-1" style={{ color: T_PALETTE.T4 }}>
        Scores will appear here once graded.
      </div>
    </div>
  ) : (
    <div
      className="bg-white rounded-[22px] py-20 flex flex-col items-center gap-3 text-center"
      style={{ boxShadow: T_PALETTE.SH, border: "0.5px solid rgba(0,85,255,0.10)" }}
    >
      <div
        className="w-16 h-16 rounded-[20px] flex items-center justify-center"
        style={{ background: T_PALETTE.BG2, border: "0.5px solid rgba(0,85,255,0.14)" }}
      >
        <BookOpen className="w-8 h-8" style={{ color: T_PALETTE.T4 }} />
      </div>
      <div className="text-[16px] font-bold" style={{ color: T_PALETTE.T2 }}>
        No assessments yet
      </div>
      <div className="text-[13px] mt-1" style={{ color: T_PALETTE.T4 }}>
        Scores will appear here once graded.
      </div>
    </div>
  );

/* ── Overall hero ─────────────────────────────────────────────────────── */

interface OverallHeroProps {
  stats: OverallStats;
  isMobile: boolean;
  navigate: NavigateFunction;
}

const OverallPerformanceHero = ({ stats, isMobile, navigate }: OverallHeroProps) => {
  const trendNum = parseInt(stats.trend.replace(/[^0-9-]/g, ""), 10) || 0;
  const trendColor =
    !stats.hasData ? T_PALETTE.T4 :
    trendNum > 0 ? T_PALETTE.GREEN :
    trendNum < 0 ? T_PALETTE.RED : "#008844";

  const go = () => navigate("/reports");
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
  };

  if (isMobile) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label="Open reports page"
        onClick={go}
        onKeyDown={onKey}
        className="mx-5 mt-4 bg-white rounded-[24px] p-5 relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
        style={{ boxShadow: T_PALETTE.SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}
      >
        <div
          className="absolute -top-[50px] -right-[30px] w-[160px] h-[160px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(0,85,255,0.06) 0%, transparent 70%)" }}
        />
        <div
          className="text-[16px] font-bold relative z-10"
          style={{ color: T_PALETTE.T1, letterSpacing: "-0.3px", marginBottom: 3 }}
        >
          Overall Performance
        </div>
        <div className="text-[11px] mb-4 relative z-10" style={{ color: T_PALETTE.T3 }}>
          Across all recorded assessments
        </div>
        <div className="grid grid-cols-3 gap-[10px] relative z-10">
          <StatTile label="Grade" value={stats.grade} color={T_PALETTE.B1} compact />
          <StatTile
            label="Average"
            value={stats.hasData ? `${stats.avg}%` : "—"}
            color={T_PALETTE.T1}
            compact
          />
          <StatTile label="Trend" value={stats.trend} color={trendColor} compact />
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Open reports page"
      onClick={go}
      onKeyDown={onKey}
      className="bg-white rounded-[24px] p-7 relative overflow-hidden mb-5 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
      style={{ boxShadow: T_PALETTE.SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}
    >
      <div
        className="absolute -top-[60px] -right-[40px] w-[240px] h-[240px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(0,85,255,0.06) 0%, transparent 70%)" }}
      />
      <div className="flex items-center justify-between gap-6 flex-wrap relative z-10">
        <div>
          <div
            className="text-[20px] font-bold"
            style={{ color: T_PALETTE.T1, letterSpacing: "-0.4px" }}
          >
            Overall Performance
          </div>
          <div className="text-[13px] mt-1" style={{ color: T_PALETTE.T3 }}>
            Across all recorded assessments
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Grade" value={stats.grade} color={T_PALETTE.B1} />
          <StatTile
            label="Average"
            value={stats.hasData ? `${stats.avg}%` : "—"}
            color={T_PALETTE.T1}
          />
          <StatTile
            label="Trend"
            value={stats.trend}
            color={trendColor}
            trendIcon={
              !stats.hasData ? <Minus className="w-5 h-5" style={{ color: trendColor }} /> :
              trendNum > 0 ? <ArrowUp className="w-5 h-5" style={{ color: trendColor }} /> :
              trendNum < 0 ? <ArrowDown className="w-5 h-5" style={{ color: trendColor }} /> :
              <Minus className="w-5 h-5" style={{ color: trendColor }} />
            }
          />
        </div>
      </div>
    </div>
  );
};

const StatTile = ({
  label, value, color, compact, trendIcon,
}: {
  label: string;
  value: string;
  color: string;
  compact?: boolean;
  trendIcon?: ReactNode;
}) => {
  const valFontSize = compact ? (label === "Trend" ? 18 : 22) : 36;
  const trendValSize = compact ? 18 : 28;
  return (
    <div
      className={
        compact
          ? "flex flex-col items-center gap-[5px] px-3 py-[14px] rounded-[16px]"
          : "flex flex-col items-center gap-[6px] px-6 py-4 rounded-[18px] min-w-[140px]"
      }
      style={{ background: T_PALETTE.BG, border: "0.5px solid rgba(0,85,255,0.10)" }}
    >
      {trendIcon ? (
        <div className="flex items-center gap-1">
          {trendIcon}
          <div
            className="font-bold"
            style={{ color, letterSpacing: compact ? "-0.5px" : "-0.8px", fontSize: trendValSize }}
          >
            {value}
          </div>
        </div>
      ) : (
        <div
          className="font-bold"
          style={{ color, letterSpacing: compact ? "-0.5px" : "-1px", fontSize: valFontSize }}
        >
          {value}
        </div>
      )}
      <div
        className={compact ? "text-[9px] font-bold uppercase tracking-[0.09em]" : "text-[10px] font-bold uppercase tracking-[0.10em]"}
        style={{ color: T_PALETTE.T4 }}
      >
        {label}
      </div>
    </div>
  );
};

/* ── Subject card ─────────────────────────────────────────────────────── */

interface SubjectCardProps {
  subject: SubjectAgg;
  idx: number;
  isMobile: boolean;
  onClick: () => void;
}

const SubjectCard = ({ subject: s, idx, isMobile, onClick }: SubjectCardProps) => {
  const acc = UNIT_ACCENTS[idx % UNIT_ACCENTS.length];
  const Icon = getSubIcon(s.name);
  const needsAttention = s.progress < 60;
  const fill = needsAttention
    ? `linear-gradient(90deg, ${T_PALETTE.RED}, #FF6688)`
    : s.progress < 75
      ? `linear-gradient(90deg, ${T_PALETTE.ORANGE}, #FFAA33)`
      : `linear-gradient(90deg, ${T_PALETTE.B1}, ${T_PALETTE.B4})`;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${s.name} performance detail`}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={
        isMobile
          ? "mx-5 mt-3 bg-white rounded-[22px] px-5 py-[18px] relative overflow-hidden active:scale-[0.98] transition-transform cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
          : "bg-white rounded-[22px] px-5 py-5 relative overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lg cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
      }
      style={{ boxShadow: T_PALETTE.SH, border: "0.5px solid rgba(0,85,255,0.10)" }}
    >
      <div className={`flex items-center justify-between ${isMobile ? "mb-[14px]" : "mb-4"}`}>
        <div className="flex items-center gap-[10px]">
          <div
            className={isMobile ? "w-9 h-9 rounded-[12px] flex items-center justify-center" : "w-10 h-10 rounded-[13px] flex items-center justify-center"}
            style={{ background: acc.icoBg, boxShadow: acc.icoShadow }}
          >
            <Icon
              className={isMobile ? "w-[18px] h-[18px] text-white" : "w-5 h-5 text-white"}
              strokeWidth={2.2}
            />
          </div>
          <span
            className={isMobile ? "text-[15px] font-bold" : "text-[16px] font-bold"}
            style={{ color: T_PALETTE.T1, letterSpacing: "-0.2px" }}
          >
            {s.name}
          </span>
        </div>
        <div
          className={
            isMobile
              ? "w-7 h-7 rounded-[9px] flex items-center justify-center text-[12px] font-bold text-white"
              : "w-8 h-8 rounded-[10px] flex items-center justify-center text-[13px] font-bold text-white"
          }
          style={{
            background: `linear-gradient(135deg, ${T_PALETTE.B1}, ${T_PALETTE.B2})`,
            boxShadow: "0 2px 8px rgba(0,85,255,0.30)",
          }}
        >
          {s.grade}
        </div>
      </div>
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[11px] font-bold"
          style={{ color: T_PALETTE.T2, letterSpacing: "-0.1px" }}
        >
          Progress
        </span>
        <span
          className={isMobile ? "text-[13px] font-bold" : "text-[14px] font-bold"}
          style={{ color: T_PALETTE.B1 }}
        >
          {s.progress}%
        </span>
      </div>
      <div
        className={isMobile ? "h-[7px] rounded-[4px] overflow-hidden mb-[10px]" : "h-2 rounded-[4px] overflow-hidden mb-3"}
        style={{ background: T_PALETTE.BG2 }}
      >
        <div
          className="h-full rounded-[4px] transition-all duration-700"
          style={{ width: `${Math.max(s.progress, 3)}%`, background: fill }}
        />
      </div>
      {needsAttention ? (
        <div
          className={
            isMobile
              ? "inline-flex items-center gap-[5px] px-[11px] py-1 rounded-full text-[10px] font-bold"
              : "inline-flex items-center gap-[5px] px-3 py-1 rounded-full text-[10px] font-bold"
          }
          style={{
            background: "rgba(255,51,85,0.10)",
            color: T_PALETTE.RED,
            border: "0.5px solid rgba(255,51,85,0.22)",
          }}
        >
          <span className="w-[10px] h-[1.5px]" style={{ background: T_PALETTE.RED }} />
          Needs Attention
        </div>
      ) : s.progress >= 75 ? (
        <div
          className={
            isMobile
              ? "inline-flex items-center gap-[5px] px-[11px] py-1 rounded-full text-[10px] font-bold"
              : "inline-flex items-center gap-[5px] px-3 py-1 rounded-full text-[10px] font-bold"
          }
          style={{
            background: T_PALETTE.GREEN_S,
            color: "#007830",
            border: `0.5px solid ${T_PALETTE.GREEN_B}`,
          }}
        >
          ✓ On Track
        </div>
      ) : (
        <div
          className={
            isMobile
              ? "inline-flex items-center gap-[5px] px-[11px] py-1 rounded-full text-[10px] font-bold"
              : "inline-flex items-center gap-[5px] px-3 py-1 rounded-full text-[10px] font-bold"
          }
          style={{
            background: "rgba(255,136,0,0.12)",
            color: T_PALETTE.ORANGE,
            border: "0.5px solid rgba(255,136,0,0.25)",
          }}
        >
          Stable
        </div>
      )}
    </div>
  );
};

/* ── Trend chart ──────────────────────────────────────────────────────── */

const TrendChartCard = ({
  data, isMobile, navigate,
}: {
  data: TrendPoint[];
  isMobile: boolean;
  navigate: NavigateFunction;
}) => {
  // Drop months without data — a leading Feb-empty gap before Mar's first
  // point makes the area look broken and the curve start at thin air.
  const points = data.filter(p => p.score != null);
  if (points.length < 2) return null;

  const go = () => navigate("/reports");
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
  };

  const lineGradId = isMobile ? "perfLineBlueM" : "perfLineBlueD";
  const areaGradId = isMobile ? "perfAreaBlueM" : "perfAreaBlueD";

  // ≤ 2 real months → bar comparison reads sharper than a 2-point curve.
  // 3+ months → area chart shows progression.
  const useBars = points.length <= 2;

  // Smart Y-axis: zoom into the data range so 75% vs 93% movement is visible
  // (full 0-100 flattens the curve to nearly horizontal at the top).
  const scores = points.map(p => p.score as number);
  const minScore = Math.min(...scores);
  const yMin = minScore >= 90 ? 70 : minScore >= 75 ? 50 : minScore >= 50 ? 25 : 0;

  // Per-month colour for the bar variant — keeps the visual decoded vs. a
  // wall of identical blue bars. Matches the band semantics used elsewhere.
  const barColor = (s: number) =>
    s >= 85 ? "url(#perfBarHigh)" :
    s >= 70 ? "url(#perfBarGood)" :
    s >= 50 ? "url(#perfBarAmber)" :
              "url(#perfBarRed)";

  // Even 3-step Y-axis grid (yMin → mid → 100). Default recharts auto-ticks
  // can land on awkward values like 65/85 when zoomed; explicit ticks read
  // cleaner and keep the gridline rhythm consistent across all yMin values.
  const yMid = Math.round((yMin + 100) / 2);
  const yTicks = [yMin, yMid, 100];

  // Custom pill-shaped label — renders score as a white rounded chip with a
  // hairline border + drop shadow above each dot/bar. The chip lifts the
  // value off the chart background so it stays legible against the area
  // gradient AND avoids overlapping the Y-axis tick labels at the edges
  // (we nudge first/last pills inward).
  const PillLabel = (props: any) => {
    const { x, y, value, index } = props;
    if (typeof value !== "number" || typeof x !== "number" || typeof y !== "number") return null;
    const w = isMobile ? 38 : 46;
    const h = isMobile ? 20 : 24;
    const last = points.length - 1;
    const dx = index === 0 ? 8 : index === last ? -8 : 0;
    const px = x + dx - w / 2;
    const py = y - h - 10;
    return (
      <g style={{ pointerEvents: "none" }}>
        <rect
          x={px} y={py} width={w} height={h} rx={h / 2} ry={h / 2}
          fill="#fff"
          stroke="rgba(0,85,255,0.22)"
          strokeWidth={0.75}
          style={{ filter: "drop-shadow(0 2px 6px rgba(0,16,64,0.10))" }}
        />
        <text
          x={px + w / 2}
          y={py + h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={isMobile ? 11 : 12.5}
          fontWeight={700}
          fill={T_PALETTE.T1}
          style={{ letterSpacing: "-0.2px" }}
        >
          {value}%
        </text>
      </g>
    );
  };

  const subtitle =
    points.length === data.length
      ? "Score progression across recent months"
      : `Across ${points.length} month${points.length === 1 ? "" : "s"} of recorded tests`;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Open reports page for detailed trend"
      onClick={go}
      onKeyDown={onKey}
      className={
        isMobile
          ? "mx-5 mt-3 bg-white rounded-[24px] px-5 pt-5 pb-4 cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
          : "lg:col-span-3 bg-white rounded-[24px] px-6 pt-6 pb-5 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
      }
      style={{ boxShadow: T_PALETTE.SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}
    >
      <div
        className={isMobile ? "text-[16px] font-bold" : "text-[18px] font-bold"}
        style={{ color: T_PALETTE.T1, letterSpacing: "-0.3px", marginBottom: 4 }}
      >
        Performance Trend
      </div>
      <div className={isMobile ? "text-[11px] mb-4" : "text-[12px] mt-1 mb-4"} style={{ color: T_PALETTE.T3 }}>
        {subtitle}
      </div>
      <div className={isMobile ? "h-[180px] w-full" : "h-[260px] w-full"}>
        <ResponsiveContainer width="100%" height="100%">
          {useBars ? (
            <BarChart
              data={points}
              margin={{ top: 36, right: 24, left: isMobile ? 4 : 12, bottom: 4 }}
              barCategoryGap="30%"
            >
              <defs>
                <linearGradient id="perfBarHigh" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#16a34a" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#86EFAC" stopOpacity={0.7} />
                </linearGradient>
                <linearGradient id="perfBarGood" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T_PALETTE.B1} stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#A5B4FC" stopOpacity={0.7} />
                </linearGradient>
                <linearGradient id="perfBarAmber" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#d97706" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#FCD34D" stopOpacity={0.7} />
                </linearGradient>
                <linearGradient id="perfBarRed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#dc2626" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#FCA5A5" stopOpacity={0.7} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="rgba(0,85,255,0.10)" />
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: isMobile ? 11 : 13, fill: T_PALETTE.T2, fontWeight: 700 }}
                tickMargin={10}
                padding={{ left: 12, right: 12 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: isMobile ? 10 : 12, fill: T_PALETTE.T4, fontWeight: 600 }}
                domain={[yMin, 100]}
                ticks={yTicks}
                width={isMobile ? 32 : 40}
                tickFormatter={(v) => `${v}`}
              />
              <Tooltip
                cursor={{ fill: "rgba(0,85,255,0.05)" }}
                contentStyle={{
                  borderRadius: 12,
                  border: "0.5px solid rgba(0,85,255,0.15)",
                  boxShadow: "0 8px 28px rgba(0,16,64,0.12)",
                  fontSize: isMobile ? 11 : 12,
                  padding: isMobile ? "6px 10px" : "8px 12px",
                }}
                formatter={(val: unknown) =>
                  typeof val === "number" ? [`${val}%`, "Score"] : ["—", "Score"]
                }
              />
              <Bar
                dataKey="score"
                radius={[12, 12, 4, 4]}
                maxBarSize={isMobile ? 70 : 110}
              >
                {points.map((p, i) => (
                  <Cell key={i} fill={barColor(p.score as number)} />
                ))}
                <LabelList dataKey="score" content={<PillLabel />} />
              </Bar>
            </BarChart>
          ) : (
            <AreaChart data={points} margin={{ top: 36, right: 24, left: isMobile ? 4 : 12, bottom: 4 }}>
              <defs>
                <linearGradient id={areaGradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T_PALETTE.B1} stopOpacity={isMobile ? 0.26 : 0.28} />
                  <stop offset="100%" stopColor={T_PALETTE.B1} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={lineGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={T_PALETTE.B1} />
                  <stop offset="100%" stopColor="#3B82F6" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="rgba(0,85,255,0.10)" />
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: isMobile ? 11 : 13, fill: T_PALETTE.T2, fontWeight: 700 }}
                tickMargin={10}
                padding={{ left: 12, right: 12 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: isMobile ? 10 : 12, fill: T_PALETTE.T4, fontWeight: 600 }}
                domain={[yMin, 100]}
                ticks={yTicks}
                width={isMobile ? 32 : 40}
                tickFormatter={(v) => `${v}`}
              />
              <Tooltip
                cursor={{ stroke: "rgba(0,85,255,0.25)", strokeWidth: 1, strokeDasharray: "4 4" }}
                contentStyle={{
                  borderRadius: 12,
                  border: "0.5px solid rgba(0,85,255,0.15)",
                  boxShadow: "0 8px 28px rgba(0,16,64,0.12)",
                  fontSize: isMobile ? 11 : 12,
                  padding: isMobile ? "6px 10px" : "8px 12px",
                }}
                formatter={(val: unknown) =>
                  typeof val === "number" ? [`${val}%`, "Score"] : ["—", "Score"]
                }
              />
              <Area
                type="monotone"
                dataKey="score"
                stroke={`url(#${lineGradId})`}
                strokeWidth={isMobile ? 3 : 3.5}
                fill={`url(#${areaGradId})`}
                dot={{ r: isMobile ? 5 : 6, strokeWidth: 2.5, stroke: "#fff", fill: T_PALETTE.B1 }}
                activeDot={{
                  r: isMobile ? 7 : 8,
                  strokeWidth: 3,
                  stroke: "#fff",
                  fill: T_PALETTE.B1,
                  style: { filter: "drop-shadow(0 4px 10px rgba(0,85,255,0.35))" },
                }}
                connectNulls
              >
                <LabelList dataKey="score" content={<PillLabel />} />
              </Area>
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-center gap-[6px] mt-2">
        <span
          className={isMobile ? "w-6 h-[2.5px] rounded-[2px]" : "w-7 h-[3px] rounded-[2px]"}
          style={{ background: T_PALETTE.B1 }}
        />
        <span
          className={isMobile ? "text-[11px] font-medium" : "text-[12px] font-medium"}
          style={{ color: T_PALETTE.T3 }}
        >
          Overall Average
        </span>
      </div>
    </div>
  );
};

/* ── Narrative card (system-generated, not AI — drop "AI" framing) ──── */

const NarrativeCard = ({
  narrative, isMobile, navigate,
}: {
  narrative: string;
  isMobile: boolean;
  navigate: NavigateFunction;
}) => {
  const go = () => navigate("/reports");
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Open reports page for full narrative"
      onClick={go}
      onKeyDown={onKey}
      className={
        isMobile
          ? "mx-5 mt-3 rounded-[24px] px-5 py-[18px] relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          : "lg:col-span-2 rounded-[24px] px-6 py-6 relative overflow-hidden cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
      }
      style={{
        background: "linear-gradient(140deg, #001888 0%, #0033CC 48%, #0055FF 100%)",
        boxShadow: "0 8px 30px rgba(0,51,204,0.34), 0 0 0 0.5px rgba(255,255,255,0.14)",
        border: "0.5px solid rgba(255,255,255,0.14)",
      }}
    >
      <div
        className={isMobile ? "absolute -top-10 -right-7 w-[180px] h-[180px] rounded-full pointer-events-none" : "absolute -top-10 -right-7 w-[220px] h-[220px] rounded-full pointer-events-none"}
        style={{ background: "radial-gradient(circle, rgba(255,255,255,0.14) 0%, transparent 65%)" }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      <div className={`flex items-center gap-[8px] ${isMobile ? "mb-[14px]" : "mb-4"} relative z-10`}>
        <div
          className={isMobile ? "w-[30px] h-[30px] rounded-[9px] flex items-center justify-center" : "w-[32px] h-[32px] rounded-[10px] flex items-center justify-center"}
          style={{ background: "rgba(255,255,255,0.18)", border: "0.5px solid rgba(255,255,255,0.26)" }}
        >
          <Sparkles
            className={isMobile ? "w-4 h-4" : "w-[17px] h-[17px]"}
            style={{ color: "rgba(255,255,255,0.9)" }}
            strokeWidth={2.2}
          />
        </div>
        <span
          className={isMobile ? "text-[9px] font-bold uppercase tracking-[0.12em]" : "text-[10px] font-bold uppercase tracking-[0.12em]"}
          style={{ color: "rgba(255,255,255,0.55)" }}
        >
          Performance Insight
        </span>
      </div>
      <p
        className={isMobile ? "text-[13px] leading-[1.72] font-normal mb-[14px] relative z-10" : "text-[14px] leading-[1.72] font-normal mb-4 relative z-10"}
        style={{ color: "rgba(255,255,255,0.92)", letterSpacing: "-0.1px" }}
      >
        {narrative}
      </p>
      <div
        className="flex items-center gap-[6px] pt-3 relative z-10"
        style={{ borderTop: "0.5px solid rgba(255,255,255,0.12)" }}
      >
        <div
          className="w-[6px] h-[6px] rounded-full"
          style={{ background: T_PALETTE.B4, boxShadow: "0 0 0 2px rgba(68,153,255,0.25)" }}
        />
        <span
          className={isMobile ? "text-[9px] font-bold uppercase tracking-[0.09em]" : "text-[10px] font-bold uppercase tracking-[0.09em]"}
          style={{ color: "rgba(255,255,255,0.42)" }}
        >
          Generated from real-time assessment data
        </span>
      </div>
    </div>
  );
};

/* ── Goal planner card ────────────────────────────────────────────────── */

interface GoalPlannerProps {
  subjects: SubjectAgg[];
  goalSubject: string;
  setGoalSubject: (s: string) => void;
  goalTarget: number;
  setGoalTarget: (n: number) => void;
  isMobile: boolean;
}

const GoalPlannerCard = ({
  subjects, goalSubject, setGoalSubject, goalTarget, setGoalTarget, isMobile,
}: GoalPlannerProps) => {
  const active = subjects.find(s => s.name === (goalSubject || subjects[0]?.name));
  const insight = active ? getGoalInsight(active.progress, goalTarget, active.name) : null;
  const gap = active ? Math.max(0, goalTarget - active.progress) : 0;

  if (!active) return null;

  const ORANGE = T_PALETTE.ORANGE;
  const RED = T_PALETTE.RED;
  const B1 = T_PALETTE.B1;
  const T1 = T_PALETTE.T1, T3 = T_PALETTE.T3, T4 = T_PALETTE.T4;
  const BG = T_PALETTE.BG, BG2 = T_PALETTE.BG2;

  return (
    <div
      className={isMobile ? "mx-5 mt-3 bg-white rounded-[24px] p-5" : "bg-white rounded-[24px] p-6"}
      style={{ boxShadow: T_PALETTE.SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}
    >
      <div className={`flex items-center gap-3 ${isMobile ? "mb-[18px]" : "mb-5"}`}>
        <div
          className={isMobile ? "w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0" : "w-12 h-12 rounded-[14px] flex items-center justify-center shrink-0"}
          style={{
            background: `linear-gradient(135deg, ${ORANGE}, #FFAA33)`,
            boxShadow: "0 3px 12px rgba(255,136,0,0.30)",
          }}
        >
          <Target className="w-[22px] h-[22px] text-white" strokeWidth={2.2} />
        </div>
        <div>
          <div className={isMobile ? "text-[16px] font-bold" : "text-[17px] font-bold"}
            style={{ color: T1, letterSpacing: "-0.3px" }}>
            Goal Planner
          </div>
          <div className={isMobile ? "text-[11px] mt-0.5" : "text-[12px] mt-0.5"} style={{ color: T3 }}>
            Set a target score and get a personalised plan
          </div>
        </div>
      </div>

      <div
        className="text-[9px] font-bold uppercase tracking-[0.10em] mb-2"
        style={{ color: T4 }}
      >
        Subject
      </div>
      <select
        value={goalSubject || subjects[0]?.name || ""}
        onChange={(e) => setGoalSubject(e.target.value)}
        className={isMobile ? "w-full py-3 px-[14px] rounded-[14px] text-[14px] font-bold mb-4 cursor-pointer appearance-none" : "w-full py-3 px-[14px] rounded-[14px] text-[14px] font-bold mb-5 cursor-pointer appearance-none"}
        style={{
          border: "0.5px solid rgba(0,85,255,0.16)",
          background: `${BG} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%230055FF' stroke-width='2.5' stroke-linecap='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E") right 14px center / auto no-repeat`,
          color: T1,
          fontFamily: "inherit",
        }}
      >
        {subjects.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name} — Current: {s.progress}%
          </option>
        ))}
      </select>

      <div className="flex items-center justify-between mb-[10px]">
        <span
          className="text-[11px] font-bold uppercase tracking-[0.08em]"
          style={{ color: T4 }}
        >
          Target Score
        </span>
        <span
          className={isMobile ? "text-[16px] font-bold" : "text-[18px] font-bold"}
          style={{ color: ORANGE }}
        >
          {goalTarget}%
        </span>
      </div>

      <input
        type="range"
        min={50}
        max={100}
        value={goalTarget}
        onChange={(e) => setGoalTarget(Number(e.target.value))}
        className="w-full cursor-pointer"
        style={{
          WebkitAppearance: "none",
          appearance: "none",
          height: 6,
          borderRadius: 3,
          background: `linear-gradient(90deg, ${ORANGE} ${((goalTarget - 50) / 50) * 100}%, ${BG2} ${((goalTarget - 50) / 50) * 100}%)`,
          outline: "none",
        }}
      />
      <style>{`
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 22px; height: 22px; border-radius: 50%;
          background: linear-gradient(135deg, #FF8800, #FFAA33);
          box-shadow: 0 2px 10px rgba(255,136,0,0.40);
          cursor: pointer; border: 2.5px solid #fff;
        }
        input[type=range]::-moz-range-thumb {
          width: 22px; height: 22px; border-radius: 50%;
          background: linear-gradient(135deg, #FF8800, #FFAA33);
          box-shadow: 0 2px 10px rgba(255,136,0,0.40);
          cursor: pointer; border: 2.5px solid #fff;
        }
      `}</style>
      <div className="flex justify-between mt-[6px]">
        <span className="text-[10px] font-semibold" style={{ color: T4 }}>50%</span>
        <span className="text-[10px] font-semibold" style={{ color: T4 }}>75%</span>
        <span className="text-[10px] font-semibold" style={{ color: T4 }}>100%</span>
      </div>

      {insight && (
        <div
          className={isMobile ? "mt-[14px] rounded-[16px] px-4 py-[14px]" : "mt-5 rounded-[16px] px-4 py-[14px]"}
          style={{
            background:
              gap > 25 ? "rgba(255,51,85,0.06)" :
              gap > 15 ? "rgba(255,136,0,0.07)" : "rgba(0,85,255,0.05)",
            border: `0.5px solid ${
              gap > 25 ? "rgba(255,51,85,0.18)" :
              gap > 15 ? "rgba(255,136,0,0.22)" : "rgba(0,85,255,0.18)"
            }`,
          }}
        >
          <div
            className={isMobile ? "text-[14px] font-bold mb-[5px]" : "text-[15px] font-bold mb-1"}
            style={{
              color: gap > 25 ? RED : gap > 15 ? ORANGE : B1,
              letterSpacing: "-0.2px",
            }}
          >
            {insight.line1}
          </div>
          <div
            className={isMobile ? "text-[12px] leading-[1.6] font-normal" : "text-[13px] leading-[1.6] font-normal"}
            style={{
              color: gap > 25 ? "#AA2233" : gap > 15 ? "#AA5500" : T3,
            }}
          >
            {insight.line2}
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Benchmark insights card ──────────────────────────────────────────── */

interface BenchmarkInsightsProps {
  subjects: SubjectAgg[];
  benchmark: number;
  studentName: string;
  isMobile: boolean;
  onSubjectClick: (name: string) => void;
}

const BenchmarkInsightsCard = ({
  subjects, benchmark, studentName, isMobile, onSubjectClick,
}: BenchmarkInsightsProps) => {
  const { T1, T3, T4, B1, B2, B3, B4, BG, BG2, GREEN, GREEN_S, GREEN_B, RED, ORANGE, SH_LG, SEP } = T_PALETTE;
  return (
    <div
      className={isMobile ? "mx-5 mt-3 mb-2 bg-white rounded-[24px] p-5" : "bg-white rounded-[24px] p-6"}
      style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}
    >
      <div className={`flex items-center gap-3 ${isMobile ? "mb-[18px]" : "mb-5"}`}>
        <div
          className={isMobile ? "w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0" : "w-12 h-12 rounded-[14px] flex items-center justify-center shrink-0"}
          style={{ background: GREEN_S, border: `0.5px solid ${GREEN_B}` }}
        >
          <Trophy className="w-[22px] h-[22px]" style={{ color: GREEN }} strokeWidth={2.2} />
        </div>
        <div>
          <div className={isMobile ? "text-[16px] font-bold" : "text-[17px] font-bold"}
            style={{ color: T1, letterSpacing: "-0.3px" }}>
            Benchmark Insights
          </div>
          <div className={isMobile ? "text-[11px] mt-0.5" : "text-[12px] mt-0.5"} style={{ color: T3 }}>
            {studentName}'s score vs the {benchmark}% school standard
          </div>
        </div>
      </div>

      <div className={isMobile ? "" : "flex flex-col gap-3"}>
        {subjects.map((s, i) => {
          const tier = getBenchmarkTier(s.progress);
          const acc = UNIT_ACCENTS[i % UNIT_ACCENTS.length];
          const Icon = getSubIcon(s.name);
          const isOnTrack = s.progress >= 70;
          // Real recent scores only — no padding with fake "current avg" values
          // (memory: bug_pattern_fabricated_fallback). Show only what exists.
          const recent = (s.raw || [])
            .slice()
            .sort((a, b) => scoreDateMs(a) - scoreDateMs(b))
            .slice(-4)
            .map((r) => pctOf(r))
            .filter((p): p is number => p != null);

          return (
            <div key={s.name} className={isMobile ? "mb-3" : ""}>
              <div
                role="button"
                tabIndex={0}
                aria-label={`Open ${s.name} performance detail`}
                onClick={() => onSubjectClick(s.name)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSubjectClick(s.name); } }}
                className={
                  isMobile
                    ? "flex items-center justify-between px-4 py-[14px] rounded-[16px] cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                    : "flex items-center justify-between px-4 py-3 rounded-[16px] cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                }
                style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.10)" }}
              >
                <div className="flex items-center gap-[10px]">
                  <div
                    className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0"
                    style={{ background: acc.icoBg, boxShadow: acc.icoShadow }}
                  >
                    <Icon className="w-[18px] h-[18px] text-white" strokeWidth={2.2} />
                  </div>
                  <div>
                    <div
                      className="text-[14px] font-bold"
                      style={{ color: T1, letterSpacing: "-0.2px" }}
                    >
                      {s.name}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {isOnTrack ? (
                        <div
                          className={isMobile ? "px-[11px] py-1 rounded-full text-[10px] font-bold" : "px-[11px] py-[3px] rounded-full text-[10px] font-bold"}
                          style={{ background: GREEN_S, color: "#007830", border: `0.5px solid ${GREEN_B}` }}
                        >
                          {tier.label}
                        </div>
                      ) : (
                        <div
                          className={isMobile ? "px-[11px] py-1 rounded-full text-[10px] font-bold" : "px-[11px] py-[3px] rounded-full text-[10px] font-bold"}
                          style={{ background: "rgba(255,51,85,0.10)", color: RED, border: "0.5px solid rgba(255,51,85,0.20)" }}
                        >
                          Needs Work
                        </div>
                      )}
                      {!isMobile && (
                        <span className="text-[11px] font-bold" style={{ color: T3 }}>
                          Score: {s.progress}%
                        </span>
                      )}
                    </div>
                    {isMobile && (
                      <div className="text-[12px] font-bold mt-[5px]" style={{ color: T3 }}>
                        Score: {s.progress}%
                      </div>
                    )}
                  </div>
                </div>
                {recent.length >= 2 ? (() => {
                  // Performance-based color palette — each bar picks a gradient
                  // corresponding to the student's academic tier to make trends
                  // and concerns immediately visible to the parent:
                  //   ≥ 90 → Strong (Green)
                  //   ≥ 75 → Good (Blue)
                  //   ≥ 50 → Developing (Orange)
                  //   <  50 → Weak (Red)
                  const miniGrad = (v: number) =>
                    v >= 90 ? "linear-gradient(180deg, #006020 0%, #00C853 100%)" :
                    v >= 75 ? "linear-gradient(180deg, #003BB3 0%, #0055FF 100%)" :
                    v >= 50 ? "linear-gradient(180deg, #AA5500 0%, #FF8800 100%)" :
                              "linear-gradient(180deg, #AA2233 0%, #FF3355 100%)";
                  // Pixels per percent — keeps bars proportional to actual %, not
                  // to whichever value happens to be the max in this row.
                  const ppp = isMobile ? 0.32 : 0.40;
                  const trackH = isMobile ? 40 : 52;
                  // Benchmark guideline inside the mini chart — visual cue for
                  // "did this score clear the bar?" without extra copy.
                  const benchTop = trackH - benchmark * ppp;
                  return (
                    <div className="flex flex-col items-end gap-[6px]">
                      <div
                        className="relative flex items-end gap-[4px] px-[8px] py-[4px] rounded-[10px]"
                        style={{
                          height: trackH,
                          background: "rgba(255,255,255,0.55)",
                          border: "0.5px solid rgba(0,85,255,0.10)",
                          boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.6)",
                        }}
                      >
                        <div
                          className="absolute left-[8px] right-[8px] pointer-events-none"
                          style={{
                            top: benchTop,
                            height: 1,
                            backgroundImage: `linear-gradient(to right, ${ORANGE} 0 4px, transparent 4px 8px)`,
                            backgroundSize: "8px 1px",
                            backgroundRepeat: "repeat-x",
                            opacity: 0.55,
                          }}
                        />
                        {recent.map((val, k) => (
                          <div
                            key={k}
                            title={`${val}%`}
                            style={{
                              width: isMobile ? 8 : 10,
                              borderRadius: "4px 4px 1px 1px",
                              background: miniGrad(val),
                              height: `${Math.max(Math.min(val, 100), 6) * ppp}px`,
                              boxShadow:
                                "0 2px 5px rgba(0,16,64,0.28), inset 0 1px 0 rgba(255,255,255,0.18)",
                            }}
                          />
                        ))}
                      </div>
                      <div className="text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: T4 }}>
                        Last {recent.length}
                      </div>
                    </div>
                  );
                })() : recent.length === 1 ? (() => {
                  // Single-score state — same performance-based color palette as
                  // the multi-bar variant, with matching dynamic shadows.
                  const v = recent[0];
                  const chipGrad =
                    v >= 90 ? "linear-gradient(135deg, #006020 0%, #00C853 100%)" :
                    v >= 75 ? "linear-gradient(135deg, #003BB3 0%, #0055FF 100%)" :
                    v >= 50 ? "linear-gradient(135deg, #AA5500 0%, #FF8800 100%)" :
                              "linear-gradient(135deg, #AA2233 0%, #FF3355 100%)";
                  const chipShadow =
                    v >= 90 ? "rgba(0,200,83,0.35)" :
                    v >= 75 ? "rgba(0,85,255,0.30)" :
                    v >= 50 ? "rgba(255,136,0,0.35)" :
                              "rgba(255,51,85,0.35)";
                  return (
                    <div className="flex flex-col items-end gap-[6px]">
                      <div
                        className="px-[12px] py-[6px] rounded-[10px] text-[11px] font-bold text-white"
                        style={{
                          background: chipGrad,
                          boxShadow:
                            `0 3px 10px ${chipShadow}, inset 0 1px 0 rgba(255,255,255,0.18)`,
                          letterSpacing: "-0.1px",
                        }}
                      >
                        {v}%
                      </div>
                      <div className="text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: T4 }}>
                        Latest
                      </div>
                    </div>
                  );
                })() : null}
              </div>

              <div className={isMobile ? "mt-[10px] px-1" : "mt-2 px-1"}>
                {isMobile && (
                  <div className="flex justify-between mb-[7px]">
                    <span className="text-[11px] font-bold" style={{ color: T3 }}>Your score</span>
                    <span className="text-[11px] font-bold" style={{ color: T3 }}>Target</span>
                  </div>
                )}
                <div
                  className={isMobile ? "h-2 rounded-[4px] overflow-hidden relative mb-[5px]" : "h-2 rounded-[4px] overflow-hidden relative"}
                  style={{ background: BG2 }}
                >
                  <div
                    className="h-full rounded-[4px]"
                    style={{
                      width: `${Math.min(s.progress, 100)}%`,
                      background: `linear-gradient(90deg, ${B1}, ${B4})`,
                    }}
                  />
                  <div
                    className="absolute -top-[2px] w-[2px] h-3 rounded-[1px]"
                    style={{ left: `${benchmark}%`, background: ORANGE }}
                  />
                </div>
                <div className={isMobile ? "flex justify-between" : "flex justify-between mt-1"}>
                  <span className="text-[10px] font-bold" style={{ color: B1 }}>
                    {s.progress}%
                  </span>
                  <span className="text-[10px] font-bold" style={{ color: ORANGE }}>
                    {benchmark}% target
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        <div
          className="flex items-start gap-[7px] pt-3"
          style={{ borderTop: `0.5px solid ${SEP}` }}
        >
          <div
            className="w-4 h-4 rounded-[4px] flex items-center justify-center shrink-0 mt-0.5"
            style={{ background: "rgba(0,85,255,0.10)", border: "0.5px solid rgba(0,85,255,0.16)" }}
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={B1} strokeWidth={2.5} strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          {/* Honest copy: the target is the school's configured standard,
              NOT a "national benchmark". Memory bug_pattern_fabricated_fallback:
              never make claims you can't source. */}
          <span className="text-[11px] italic leading-[1.6]" style={{ color: T4 }}>
            Target reflects your school's configured academic standard ({benchmark}%). No other student's data is shown. Fully private.
          </span>
        </div>
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   PERFORMANCE SNAPSHOT — 6-tile stat row at the top of the page.
   Shows every signal a parent needs to track: subjects, tests, assignments,
   attendance, behaviour, ratings. Each tile clickable → deep-link to the
   dedicated page for that metric.
   ════════════════════════════════════════════════════════════════════════ */

interface SnapshotTileProps {
  icon: ComponentType<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }>;
  label: string;
  value: string;
  sub?: string;
  tone: "blue" | "green" | "amber" | "red" | "neutral";
  onClick?: () => void;
}

const SnapshotTile = ({ icon: Icon, label, value, sub, tone, onClick }: SnapshotTileProps) => {
  const toneMap = {
    blue:    { color: T_PALETTE.B1,    bg: "rgba(0,85,255,0.10)",   bdr: "rgba(0,85,255,0.18)" },
    green:   { color: T_PALETTE.GREEN, bg: T_PALETTE.GREEN_S,        bdr: T_PALETTE.GREEN_B },
    amber:   { color: "#CC6A00",       bg: "rgba(255,136,0,0.12)",   bdr: "rgba(255,136,0,0.25)" },
    red:     { color: T_PALETTE.RED,   bg: "rgba(255,51,85,0.10)",   bdr: "rgba(255,51,85,0.22)" },
    neutral: { color: T_PALETTE.T3,    bg: "rgba(15,23,42,0.04)",    bdr: "rgba(15,23,42,0.08)" },
  }[tone];
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `Open ${label} detail` : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      className={`bg-white rounded-[16px] p-3 flex flex-col gap-[6px] relative overflow-hidden ${onClick ? "cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40" : ""}`}
      style={{
        boxShadow: T_PALETTE.SH,
        border: "0.5px solid rgba(0,85,255,0.10)",
      }}
    >
      <div
        className="w-8 h-8 rounded-[10px] flex items-center justify-center"
        style={{ background: toneMap.bg, border: `0.5px solid ${toneMap.bdr}` }}
      >
        <Icon className="w-[15px] h-[15px]" style={{ color: toneMap.color }} strokeWidth={2.3} />
      </div>
      <div>
        <div
          className="text-[18px] font-bold leading-[1]"
          style={{ color: T_PALETTE.T1, letterSpacing: "-0.4px" }}
        >
          {value}
        </div>
        <div
          className="text-[9px] font-bold uppercase tracking-[0.09em] mt-[3px]"
          style={{ color: T_PALETTE.T4 }}
        >
          {label}
        </div>
        {sub && (
          <div className="text-[10px] mt-[2px]" style={{ color: T_PALETTE.T3 }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
};

interface SnapshotProps {
  snap: PerformanceSnapshot;
  isMobile: boolean;
  navigate: NavigateFunction;
}

const PerformanceSnapshotRow = ({ snap, isMobile, navigate }: SnapshotProps) => {
  const fmt = (v: number | null) => (v == null ? "—" : `${Math.round(v)}%`);
  const asgnRate =
    snap.assignmentTotal > 0
      ? Math.round((snap.assignmentSubmitted / snap.assignmentTotal) * 100)
      : null;
  return (
    <div
      className={
        isMobile
          ? "mx-5 mt-3 grid grid-cols-3 gap-[10px]"
          : "grid grid-cols-3 md:grid-cols-6 gap-3 mb-5"
      }
    >
      <SnapshotTile
        icon={BookOpen}
        label="Subjects Avg"
        value={fmt(snap.subjectsAvg)}
        tone={
          snap.subjectsAvg == null ? "neutral" :
          snap.subjectsAvg >= 75 ? "blue" :
          snap.subjectsAvg >= 60 ? "amber" : "red"
        }
      />
      <SnapshotTile
        icon={FileText}
        label="Tests"
        value={snap.testCount === 0 ? "—" : fmt(snap.testsAvg)}
        sub={snap.testCount > 0 ? `${snap.testCount} taken` : undefined}
        tone={
          snap.testsAvg == null ? "neutral" :
          snap.testsAvg >= 75 ? "blue" :
          snap.testsAvg >= 60 ? "amber" : "red"
        }
        onClick={() => navigate("/tests")}
      />
      <SnapshotTile
        icon={CheckCircle2}
        label="Assignments"
        value={asgnRate == null ? "—" : `${asgnRate}%`}
        sub={
          snap.assignmentTotal === 0
            ? undefined
            : `${snap.assignmentSubmitted}/${snap.assignmentTotal} done`
        }
        tone={
          asgnRate == null ? "neutral" :
          asgnRate >= 80 ? "green" :
          asgnRate >= 50 ? "amber" : "red"
        }
        onClick={() => navigate("/assignments")}
      />
      <SnapshotTile
        icon={Calendar}
        label="Attendance"
        value={fmt(snap.attendanceRate)}
        sub={snap.attendanceTotal > 0 ? `Last 30 days` : undefined}
        tone={
          snap.attendanceRate == null ? "neutral" :
          snap.attendanceRate >= 85 ? "green" :
          snap.attendanceRate >= 70 ? "amber" : "red"
        }
        onClick={() => navigate("/attendance")}
      />
      <SnapshotTile
        icon={AlertTriangle}
        label="Incidents"
        value={String(snap.incidents30d)}
        sub={snap.incidents30d > 0 ? "Last 30 days" : undefined}
        tone={
          snap.incidents30d === 0 ? "green" :
          snap.incidents30d <= 2 ? "amber" : "red"
        }
        onClick={() => navigate("/behaviour")}
      />
      <SnapshotTile
        icon={Heart}
        label="Behaviour"
        value={snap.ratingAvg == null ? "—" : `${snap.ratingAvg.toFixed(1)}/5`}
        sub={snap.ratingCount > 0 ? `${snap.ratingCount} rated` : undefined}
        tone={
          snap.ratingAvg == null ? "neutral" :
          snap.ratingAvg >= 4 ? "green" :
          snap.ratingAvg >= 3 ? "amber" : "red"
        }
        onClick={() => navigate("/behaviour")}
      />
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   TESTS & EXAMS CARD — pulls from `test_scores` only (not gradebook /
   results), shows recent tests + stats. Cross-links to /tests.
   ════════════════════════════════════════════════════════════════════════ */

interface TestsCardProps {
  rows: TestScoreRow[];
  isMobile: boolean;
  navigate: NavigateFunction;
}

// Performance tier classification — used on test rows + assignment scores.
// Pure function so it's safe to call inside render.
const tierForPct = (pct: number): { label: string; color: string; bg: string; bdr: string } => {
  if (pct >= 90) return { label: "Strong",     color: "#007830", bg: "rgba(0,200,83,0.12)",  bdr: "rgba(0,200,83,0.30)" };
  if (pct >= 75) return { label: "Good",       color: "#0055D4", bg: "rgba(0,85,255,0.10)",  bdr: "rgba(0,85,255,0.25)" };
  if (pct >= 50) return { label: "Developing", color: "#AA5500", bg: "rgba(255,136,0,0.10)", bdr: "rgba(255,136,0,0.28)" };
  return            { label: "Weak",       color: "#AA2233", bg: "rgba(255,51,85,0.10)", bdr: "rgba(255,51,85,0.25)" };
};

const TESTS_PAGE_SIZE = 8;

const TestsAndExamsCard = ({ rows, isMobile, navigate }: TestsCardProps) => {
  const [page, setPage] = useState(0);

  // Hooks MUST run unconditionally — the early-return for empty rows lives
  // after this block. Same hook-order trap as AIPracticeCard.
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const ad = a.date?.getTime() ?? 0;
        const bd = b.date?.getTime() ?? 0;
        return bd - ad;
      }),
    [rows],
  );

  // Tier mix summary — parent-friendly glance at how the child is doing overall.
  const tierCounts = useMemo(() => {
    const counts = { Strong: 0, Good: 0, Developing: 0, Weak: 0 };
    rows.forEach((r) => { counts[tierForPct(r.pct).label as keyof typeof counts]++; });
    return counts;
  }, [rows]);

  if (rows.length === 0) return null;

  const top = Math.max(...rows.map((r) => r.pct));
  const avg = Math.round(rows.reduce((a, r) => a + r.pct, 0) / rows.length);

  const totalPages = Math.max(1, Math.ceil(sorted.length / TESTS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * TESTS_PAGE_SIZE;
  const visible = sorted.slice(start, start + TESTS_PAGE_SIZE);

  return (
    <div
      className={isMobile ? "mx-5 mt-3 bg-white rounded-[24px] p-5" : "bg-white rounded-[24px] p-6"}
      style={{ boxShadow: T_PALETTE.SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0"
            style={{
              background: `linear-gradient(135deg, ${T_PALETTE.B1}, ${T_PALETTE.B3})`,
              boxShadow: "0 3px 10px rgba(0,85,255,0.28)",
            }}
          >
            <FileText className="w-[18px] h-[18px] text-white" strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <div
              className={isMobile ? "text-[16px] font-bold" : "text-[17px] font-bold"}
              style={{ color: T_PALETTE.T1, letterSpacing: "-0.3px" }}
            >
              Tests &amp; Exams
            </div>
            <div className={isMobile ? "text-[11px] mt-0.5" : "text-[12px] mt-0.5"} style={{ color: T_PALETTE.T3 }}>
              {rows.length} taken · avg {avg}% · top {Math.round(top)}%
            </div>
          </div>
        </div>
        <button
          onClick={() => navigate("/tests")}
          className="text-[12px] font-bold flex items-center gap-1 px-3 py-1.5 rounded-full transition-colors hover:bg-[#EEF4FF] shrink-0"
          style={{ color: T_PALETTE.B1 }}
        >
          Open page <ChevronRight className="w-[12px] h-[12px]" strokeWidth={2.4} />
        </button>
      </div>

      {/* Tier-mix glance row */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(["Strong", "Good", "Developing", "Weak"] as const).map((label) => {
          if (tierCounts[label] === 0) return null;
          const t = tierForPct(label === "Strong" ? 95 : label === "Good" ? 80 : label === "Developing" ? 60 : 30);
          return (
            <span
              key={label}
              className="text-[11px] font-bold px-[10px] py-[4px] rounded-full"
              style={{ background: t.bg, color: t.color, border: `0.5px solid ${t.bdr}` }}
            >
              {label} · {tierCounts[label]}
            </span>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        {visible.map((r) => {
          const tone = tierForPct(r.pct);
          return (
            <div
              key={r.id}
              className="flex items-center justify-between py-[10px] px-3 rounded-[14px]"
              style={{ background: T_PALETTE.BG, border: "0.5px solid rgba(0,85,255,0.10)" }}
            >
              <div className="min-w-0 flex-1">
                <p
                  className="text-[13px] font-bold truncate"
                  style={{ color: T_PALETTE.T1, letterSpacing: "-0.1px" }}
                >
                  {r.name}
                </p>
                <p className="text-[11px] mt-[2px]" style={{ color: T_PALETTE.T4 }}>
                  {r.subject || "—"}
                  {r.date && ` · ${r.date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span
                  className="text-[10px] font-bold px-[8px] py-[4px] rounded-full uppercase tracking-[0.08em]"
                  style={{ background: tone.bg, color: tone.color, border: `0.5px solid ${tone.bdr}` }}
                >
                  {tone.label}
                </span>
                <span
                  className="text-[12px] font-bold px-[10px] py-[5px] rounded-full tabular-nums"
                  style={{ background: tone.bg, color: tone.color, border: `0.5px solid ${tone.bdr}` }}
                >
                  {Math.round(r.pct)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: "0.5px solid rgba(0,85,255,0.10)" }}>
          <span className="text-[11px] font-medium" style={{ color: T_PALETTE.T4 }}>
            Showing {start + 1}–{Math.min(start + TESTS_PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#EEF4FF]"
              style={{ color: T_PALETTE.B1, border: `0.5px solid ${safePage === 0 ? "rgba(0,85,255,0.10)" : "rgba(0,85,255,0.30)"}` }}
            >
              ← Prev
            </button>
            <span className="text-[11px] font-bold tabular-nums" style={{ color: T_PALETTE.T2 }}>
              {safePage + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#EEF4FF]"
              style={{ color: T_PALETTE.B1, border: `0.5px solid ${safePage >= totalPages - 1 ? "rgba(0,85,255,0.10)" : "rgba(0,85,255,0.30)"}` }}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   ASSIGNMENTS CARD — submission rate + on-time rate + recent list.
   Cross-links to /assignments.
   ════════════════════════════════════════════════════════════════════════ */

interface AssignmentsCardProps {
  rows: AssignmentRow[];
  isMobile: boolean;
  navigate: NavigateFunction;
}

const ASSIGNMENTS_PAGE_SIZE = 8;

const AssignmentsCard = ({ rows, isMobile, navigate }: AssignmentsCardProps) => {
  const [page, setPage] = useState(0);
  if (rows.length === 0) return null;
  const submitted = rows.filter((r) => r.submitted).length;
  const onTimeEligible = rows.filter((r) => r.submitted && r.onTime !== null);
  const onTime = onTimeEligible.filter((r) => r.onTime === true).length;
  const submitRate = Math.round((submitted / rows.length) * 100);
  const onTimeRate =
    onTimeEligible.length > 0 ? Math.round((onTime / onTimeEligible.length) * 100) : null;
  // Newest-first by due date; items without dueDate sink to the bottom.
  const sorted = [...rows].sort((a, b) => {
    const ad = a.dueDate?.getTime() ?? 0;
    const bd = b.dueDate?.getTime() ?? 0;
    return bd - ad;
  });
  const totalPages = Math.max(1, Math.ceil(sorted.length / ASSIGNMENTS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * ASSIGNMENTS_PAGE_SIZE;
  const visible = sorted.slice(start, start + ASSIGNMENTS_PAGE_SIZE);
  return (
    <div
      className={isMobile ? "mx-5 mt-3 bg-white rounded-[24px] p-5" : "bg-white rounded-[24px] p-6"}
      style={{ boxShadow: T_PALETTE.SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0"
            style={{
              background: `linear-gradient(135deg, ${T_PALETTE.GREEN}, #00A040)`,
              boxShadow: "0 3px 10px rgba(0,200,83,0.28)",
            }}
          >
            <CheckCircle2 className="w-[18px] h-[18px] text-white" strokeWidth={2.2} />
          </div>
          <div>
            <div
              className={isMobile ? "text-[16px] font-bold" : "text-[17px] font-bold"}
              style={{ color: T_PALETTE.T1, letterSpacing: "-0.3px" }}
            >
              Assignment Performance
            </div>
            <div className={isMobile ? "text-[11px] mt-0.5" : "text-[12px] mt-0.5"} style={{ color: T_PALETTE.T3 }}>
              {submitted}/{rows.length} submitted · {submitRate}% completion
              {onTimeRate != null ? ` · ${onTimeRate}% on-time` : ""}
            </div>
          </div>
        </div>
        <button
          onClick={() => navigate("/assignments")}
          className="text-[12px] font-bold flex items-center gap-1 px-3 py-1.5 rounded-full transition-colors hover:bg-[#EEF4FF]"
          style={{ color: T_PALETTE.B1 }}
        >
          View all <ChevronRight className="w-[12px] h-[12px]" strokeWidth={2.4} />
        </button>
      </div>

      {/* Submission progress bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-[6px]">
          <span
            className="text-[11px] font-bold uppercase tracking-[0.08em]"
            style={{ color: T_PALETTE.T4 }}
          >
            Submission Rate
          </span>
          <span className="text-[13px] font-bold" style={{ color: T_PALETTE.B1 }}>
            {submitRate}%
          </span>
        </div>
        <div
          className="h-2 rounded-[4px] overflow-hidden"
          style={{ background: T_PALETTE.BG2 }}
        >
          <div
            className="h-full rounded-[4px] transition-all duration-700"
            style={{
              width: `${Math.max(submitRate, 3)}%`,
              background:
                submitRate >= 80
                  ? `linear-gradient(90deg, ${T_PALETTE.GREEN}, #00A040)`
                  : submitRate >= 50
                    ? `linear-gradient(90deg, ${T_PALETTE.ORANGE}, #FFAA33)`
                    : `linear-gradient(90deg, ${T_PALETTE.RED}, #FF6688)`,
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {visible.map((r) => {
          const dueLabel = r.dueDate
            ? r.dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
            : "—";
          return (
            <div
              key={r.id}
              className="flex items-center justify-between py-[10px] px-3 rounded-[14px]"
              style={{ background: T_PALETTE.BG, border: "0.5px solid rgba(0,85,255,0.10)" }}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <CheckCircle2
                  className="w-[16px] h-[16px] shrink-0"
                  style={{ color: r.submitted ? T_PALETTE.GREEN : T_PALETTE.T4 }}
                  strokeWidth={2.2}
                />
                <div className="min-w-0">
                  <p
                    className="text-[13px] font-bold truncate"
                    style={{ color: T_PALETTE.T1, letterSpacing: "-0.1px" }}
                  >
                    {r.title}
                  </p>
                  <p className="text-[11px] mt-[2px]" style={{ color: T_PALETTE.T4 }}>
                    Due {dueLabel}
                  </p>
                </div>
              </div>
              {r.submitted ? (
                r.onTime === false ? (
                  <span
                    className="text-[10px] font-bold px-[10px] py-[4px] rounded-full ml-2 shrink-0"
                    style={{
                      background: "rgba(255,136,0,0.12)",
                      color: "#AA5500",
                      border: "0.5px solid rgba(255,136,0,0.25)",
                    }}
                  >
                    Late
                  </span>
                ) : (
                  <span
                    className="text-[10px] font-bold px-[10px] py-[4px] rounded-full ml-2 shrink-0"
                    style={{
                      background: T_PALETTE.GREEN_S,
                      color: "#007830",
                      border: `0.5px solid ${T_PALETTE.GREEN_B}`,
                    }}
                  >
                    Submitted
                  </span>
                )
              ) : (
                <span
                  className="text-[10px] font-bold px-[10px] py-[4px] rounded-full ml-2 shrink-0"
                  style={{
                    background: "rgba(255,51,85,0.08)",
                    color: T_PALETTE.RED,
                    border: "0.5px solid rgba(255,51,85,0.20)",
                  }}
                >
                  Pending
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: "0.5px solid rgba(0,85,255,0.10)" }}>
          <span className="text-[11px] font-medium" style={{ color: T_PALETTE.T4 }}>
            Showing {start + 1}–{Math.min(start + ASSIGNMENTS_PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#EEF4FF]"
              style={{ color: T_PALETTE.B1, border: `0.5px solid ${safePage === 0 ? "rgba(0,85,255,0.10)" : "rgba(0,85,255,0.30)"}` }}
            >
              ← Prev
            </button>
            <span className="text-[11px] font-bold tabular-nums" style={{ color: T_PALETTE.T2 }}>
              {safePage + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#EEF4FF]"
              style={{ color: T_PALETTE.B1, border: `0.5px solid ${safePage >= totalPages - 1 ? "rgba(0,85,255,0.10)" : "rgba(0,85,255,0.30)"}` }}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   AI PRACTICE CARD — self-study attempts (practice_attempts collection).
   Shows attempt history, tier classification, weak-topic surface, pagination.
   Cross-links to /ai-practice for new sessions.
   ════════════════════════════════════════════════════════════════════════ */

interface AIPracticeCardProps {
  rows: RawAIAttempt[];
  isMobile: boolean;
  navigate: NavigateFunction;
}

const AI_PRACTICE_PAGE_SIZE = 8;

const AIPracticeCard = ({ rows, isMobile, navigate }: AIPracticeCardProps) => {
  const [page, setPage] = useState(0);

  // Convert + sort newest-first by submittedAt.
  // Hooks MUST run unconditionally — the early-return for empty rows lives
  // after this block. Returning before useMemo flipped the hook count between
  // renders and tripped React's Rules of Hooks check.
  const enriched = useMemo(
    () =>
      rows
        .map((r) => ({
          ...r,
          submittedDate: toSafeDate(r.submittedAt),
          pct: typeof r.percentage === "number" ? r.percentage : 0,
        }))
        .sort((a, b) => {
          const ad = a.submittedDate?.getTime() ?? 0;
          const bd = b.submittedDate?.getTime() ?? 0;
          return bd - ad;
        }),
    [rows],
  );

  // Tier mix summary — hoisted above the early return for the same reason.
  const tierCounts = useMemo(() => {
    const counts = { Strong: 0, Good: 0, Developing: 0, Weak: 0 };
    enriched.forEach((r) => { counts[tierForPct(r.pct).label as keyof typeof counts]++; });
    return counts;
  }, [enriched]);

  if (rows.length === 0) return null;

  const avg = Math.round(enriched.reduce((a, r) => a + r.pct, 0) / enriched.length);
  const top = Math.max(...enriched.map((r) => r.pct));
  const totalPages = Math.max(1, Math.ceil(enriched.length / AI_PRACTICE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * AI_PRACTICE_PAGE_SIZE;
  const visible = enriched.slice(start, start + AI_PRACTICE_PAGE_SIZE);

  // Aggregate weak topics across all attempts — small, dedup, capped at 6.
  const weakTopicsSet = new Set<string>();
  enriched.forEach((r) => (r.weakTopics || []).forEach((t) => weakTopicsSet.add(t)));
  const weakTopics = Array.from(weakTopicsSet).slice(0, 6);

  return (
    <div
      className={isMobile ? "mx-5 mt-3 bg-white rounded-[24px] p-5" : "bg-white rounded-[24px] p-6"}
      style={{ boxShadow: T_PALETTE.SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0"
            style={{
              background: "linear-gradient(135deg, #8B5CF6, #6D28D9)",
              boxShadow: "0 3px 10px rgba(109,40,217,0.28)",
            }}
          >
            <Brain className="w-[18px] h-[18px] text-white" strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <div
              className={isMobile ? "text-[16px] font-bold" : "text-[17px] font-bold"}
              style={{ color: T_PALETTE.T1, letterSpacing: "-0.3px" }}
            >
              AI Practice Activity
            </div>
            <div className={isMobile ? "text-[11px] mt-0.5" : "text-[12px] mt-0.5"} style={{ color: T_PALETTE.T3 }}>
              {enriched.length} attempts · avg {avg}% · top {Math.round(top)}%
            </div>
          </div>
        </div>
        <button
          onClick={() => navigate("/ai-practice")}
          className="text-[12px] font-bold flex items-center gap-1 px-3 py-1.5 rounded-full transition-colors hover:bg-[#EEF4FF] shrink-0"
          style={{ color: T_PALETTE.B1 }}
        >
          Practice now <ChevronRight className="w-[12px] h-[12px]" strokeWidth={2.4} />
        </button>
      </div>

      {/* Tier-mix glance row */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(["Strong", "Good", "Developing", "Weak"] as const).map((label) => {
          if (tierCounts[label] === 0) return null;
          const t = tierForPct(label === "Strong" ? 95 : label === "Good" ? 80 : label === "Developing" ? 60 : 30);
          return (
            <span
              key={label}
              className="text-[11px] font-bold px-[10px] py-[4px] rounded-full"
              style={{ background: t.bg, color: t.color, border: `0.5px solid ${t.bdr}` }}
            >
              {label} · {tierCounts[label]}
            </span>
          );
        })}
      </div>

      {/* Weak topics surface — only render if at least one */}
      {weakTopics.length > 0 && (
        <div className="mb-4 px-3 py-[10px] rounded-[12px]" style={{ background: "rgba(255,136,0,0.06)", border: "0.5px solid rgba(255,136,0,0.20)" }}>
          <div className="text-[10px] font-bold uppercase tracking-[0.10em] mb-[6px]" style={{ color: "#AA5500" }}>
            Topics to revisit
          </div>
          <div className="flex flex-wrap gap-1.5">
            {weakTopics.map((t) => (
              <span key={t} className="text-[11px] font-medium px-[10px] py-[3px] rounded-full"
                style={{ background: "rgba(255,136,0,0.10)", color: "#AA5500", border: "0.5px solid rgba(255,136,0,0.25)" }}>
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {visible.map((r) => {
          const tone = tierForPct(r.pct);
          const dateLabel = r.submittedDate
            ? r.submittedDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
            : "—";
          const title = r.examTitle || r.topic || "AI Practice Session";
          const meta = [r.topic, r.difficulty, r.questionType?.replace(/_/g, " ")]
            .filter(Boolean).join(" · ");
          return (
            <div
              key={r.id}
              className="flex items-center justify-between py-[10px] px-3 rounded-[14px]"
              style={{ background: T_PALETTE.BG, border: "0.5px solid rgba(0,85,255,0.10)" }}
            >
              <div className="min-w-0 flex-1">
                <p
                  className="text-[13px] font-bold truncate"
                  style={{ color: T_PALETTE.T1, letterSpacing: "-0.1px" }}
                >
                  {title}
                </p>
                <p className="text-[11px] mt-[2px] truncate" style={{ color: T_PALETTE.T4 }}>
                  {meta || "Practice session"} · {dateLabel}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span
                  className="text-[10px] font-bold px-[8px] py-[4px] rounded-full uppercase tracking-[0.08em]"
                  style={{ background: tone.bg, color: tone.color, border: `0.5px solid ${tone.bdr}` }}
                >
                  {tone.label}
                </span>
                <span
                  className="text-[12px] font-bold px-[10px] py-[5px] rounded-full tabular-nums"
                  style={{ background: tone.bg, color: tone.color, border: `0.5px solid ${tone.bdr}` }}
                >
                  {Math.round(r.pct)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: "0.5px solid rgba(0,85,255,0.10)" }}>
          <span className="text-[11px] font-medium" style={{ color: T_PALETTE.T4 }}>
            Showing {start + 1}–{Math.min(start + AI_PRACTICE_PAGE_SIZE, enriched.length)} of {enriched.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#EEF4FF]"
              style={{ color: T_PALETTE.B1, border: `0.5px solid ${safePage === 0 ? "rgba(0,85,255,0.10)" : "rgba(0,85,255,0.30)"}` }}
            >
              ← Prev
            </button>
            <span className="text-[11px] font-bold tabular-nums" style={{ color: T_PALETTE.T2 }}>
              {safePage + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#EEF4FF]"
              style={{ color: T_PALETTE.B1, border: `0.5px solid ${safePage >= totalPages - 1 ? "rgba(0,85,255,0.10)" : "rgba(0,85,255,0.30)"}` }}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   ATTENDANCE SNAPSHOT — last 30 days breakdown. Cross-links to /attendance.
   ════════════════════════════════════════════════════════════════════════ */

interface AttendanceCardProps {
  snap: PerformanceSnapshot;
  isMobile: boolean;
  navigate: NavigateFunction;
}

const AttendanceSnapshotCard = ({ snap, isMobile, navigate }: AttendanceCardProps) => {
  if (snap.attendanceTotal === 0) return null;
  const rate = snap.attendanceRate ?? 0;
  const tone =
    rate >= 85 ? { color: T_PALETTE.GREEN, bg: T_PALETTE.GREEN_S, bdr: T_PALETTE.GREEN_B } :
    rate >= 70 ? { color: T_PALETTE.ORANGE, bg: "rgba(255,136,0,0.12)", bdr: "rgba(255,136,0,0.25)" } :
                 { color: T_PALETTE.RED, bg: "rgba(255,51,85,0.10)", bdr: "rgba(255,51,85,0.22)" };
  return (
    <div
      className={isMobile ? "mx-5 mt-3 bg-white rounded-[24px] p-5" : "bg-white rounded-[24px] p-6"}
      style={{ boxShadow: T_PALETTE.SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0"
            style={{
              background: `linear-gradient(135deg, ${T_PALETTE.B1}, ${T_PALETTE.B2})`,
              boxShadow: "0 3px 10px rgba(0,85,255,0.28)",
            }}
          >
            <Calendar className="w-[18px] h-[18px] text-white" strokeWidth={2.2} />
          </div>
          <div>
            <div
              className={isMobile ? "text-[16px] font-bold" : "text-[17px] font-bold"}
              style={{ color: T_PALETTE.T1, letterSpacing: "-0.3px" }}
            >
              Attendance
            </div>
            <div className={isMobile ? "text-[11px] mt-0.5" : "text-[12px] mt-0.5"} style={{ color: T_PALETTE.T3 }}>
              Last 30 days · {snap.attendanceTotal} days recorded
            </div>
          </div>
        </div>
        <button
          onClick={() => navigate("/attendance")}
          className="text-[12px] font-bold flex items-center gap-1 px-3 py-1.5 rounded-full transition-colors hover:bg-[#EEF4FF]"
          style={{ color: T_PALETTE.B1 }}
        >
          View all <ChevronRight className="w-[12px] h-[12px]" strokeWidth={2.4} />
        </button>
      </div>

      <div className="flex items-center gap-4 mb-4">
        <div
          className="text-[42px] font-bold tabular-nums"
          style={{ color: tone.color, letterSpacing: "-1px", lineHeight: "1" }}
        >
          {Math.round(rate)}%
        </div>
        <div
          className="px-3 py-1 rounded-full text-[11px] font-bold"
          style={{ background: tone.bg, color: tone.color, border: `0.5px solid ${tone.bdr}` }}
        >
          {rate >= 85 ? "Excellent" : rate >= 70 ? "On Track" : "Needs Attention"}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div
          className="flex flex-col items-center gap-1 py-3 rounded-[14px]"
          style={{ background: T_PALETTE.GREEN_S, border: `0.5px solid ${T_PALETTE.GREEN_B}` }}
        >
          <div className="text-[18px] font-bold" style={{ color: T_PALETTE.GREEN, letterSpacing: "-0.5px" }}>
            {snap.attendancePresent}
          </div>
          <div className="text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: T_PALETTE.GREEN_DEEP || "#007830" }}>
            Present
          </div>
        </div>
        <div
          className="flex flex-col items-center gap-1 py-3 rounded-[14px]"
          style={{ background: "rgba(255,136,0,0.10)", border: "0.5px solid rgba(255,136,0,0.22)" }}
        >
          <div className="text-[18px] font-bold" style={{ color: T_PALETTE.ORANGE, letterSpacing: "-0.5px" }}>
            {snap.attendanceLate}
          </div>
          <div className="text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: "#AA5500" }}>
            Late
          </div>
        </div>
        <div
          className="flex flex-col items-center gap-1 py-3 rounded-[14px]"
          style={{ background: "rgba(255,51,85,0.08)", border: "0.5px solid rgba(255,51,85,0.20)" }}
        >
          <div className="text-[18px] font-bold" style={{ color: T_PALETTE.RED, letterSpacing: "-0.5px" }}>
            {snap.attendanceAbsent}
          </div>
          <div className="text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: "#AA2233" }}>
            Absent
          </div>
        </div>
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   BEHAVIOUR SNAPSHOT — incidents + ratings. Per memory
   `cross_dashboard_behaviour_sync`: teacher writes student_ratings +
   incidents, parent reads them here. Cross-links to /behaviour.
   ════════════════════════════════════════════════════════════════════════ */

interface BehaviourCardProps {
  snap: PerformanceSnapshot;
  recentIncidents: RawIncident[];
  isMobile: boolean;
  navigate: NavigateFunction;
}

const BehaviourSnapshotCard = ({ snap, recentIncidents, isMobile, navigate }: BehaviourCardProps) => {
  if (snap.incidents30d === 0 && snap.ratingCount === 0) return null;
  const incTone =
    snap.incidents30d === 0 ? { color: T_PALETTE.GREEN, bg: T_PALETTE.GREEN_S } :
    snap.incidents30d <= 2 ? { color: T_PALETTE.ORANGE, bg: "rgba(255,136,0,0.12)" } :
                              { color: T_PALETTE.RED, bg: "rgba(255,51,85,0.10)" };
  return (
    <div
      className={isMobile ? "mx-5 mt-3 bg-white rounded-[24px] p-5" : "bg-white rounded-[24px] p-6"}
      style={{ boxShadow: T_PALETTE.SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0"
            style={{
              background: "linear-gradient(135deg, #FF6688, #FF3355)",
              boxShadow: "0 3px 10px rgba(255,51,85,0.28)",
            }}
          >
            <Heart className="w-[18px] h-[18px] text-white" strokeWidth={2.2} />
          </div>
          <div>
            <div
              className={isMobile ? "text-[16px] font-bold" : "text-[17px] font-bold"}
              style={{ color: T_PALETTE.T1, letterSpacing: "-0.3px" }}
            >
              Behaviour Snapshot
            </div>
            <div className={isMobile ? "text-[11px] mt-0.5" : "text-[12px] mt-0.5"} style={{ color: T_PALETTE.T3 }}>
              {snap.ratingCount > 0 && snap.ratingAvg != null
                ? `${snap.ratingAvg.toFixed(1)}/5 from ${snap.ratingCount} teacher ratings`
                : "Teacher observations tracked here"}
            </div>
          </div>
        </div>
        <button
          onClick={() => navigate("/behaviour")}
          className="text-[12px] font-bold flex items-center gap-1 px-3 py-1.5 rounded-full transition-colors hover:bg-[#EEF4FF]"
          style={{ color: T_PALETTE.B1 }}
        >
          View all <ChevronRight className="w-[12px] h-[12px]" strokeWidth={2.4} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div
          className="flex flex-col gap-[3px] p-3 rounded-[14px]"
          style={{ background: incTone.bg, border: `0.5px solid rgba(15,23,42,0.04)` }}
        >
          <div className="text-[24px] font-bold tabular-nums" style={{ color: incTone.color, letterSpacing: "-0.5px" }}>
            {snap.incidents30d}
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.09em]" style={{ color: T_PALETTE.T4 }}>
            Incidents · 30d
          </div>
        </div>
        <div
          className="flex flex-col gap-[3px] p-3 rounded-[14px]"
          style={{ background: T_PALETTE.BG, border: "0.5px solid rgba(0,85,255,0.10)" }}
        >
          <div className="text-[24px] font-bold tabular-nums" style={{ color: T_PALETTE.T1, letterSpacing: "-0.5px" }}>
            {snap.ratingAvg != null ? snap.ratingAvg.toFixed(1) : "—"}
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.09em]" style={{ color: T_PALETTE.T4 }}>
            Avg Rating · /5
          </div>
        </div>
      </div>

      {recentIncidents.length > 0 && (
        <div className="flex flex-col gap-2">
          <div
            className="text-[10px] font-bold uppercase tracking-[0.10em]"
            style={{ color: T_PALETTE.T4 }}
          >
            Recent Observations
          </div>
          {recentIncidents.slice(0, 3).map((inc) => (
            <div
              key={inc.id}
              className="flex items-start gap-2 py-[10px] px-3 rounded-[14px]"
              style={{ background: T_PALETTE.BG, border: "0.5px solid rgba(0,85,255,0.10)" }}
            >
              <AlertTriangle
                className="w-[14px] h-[14px] mt-[2px] shrink-0"
                style={{ color: T_PALETTE.ORANGE }}
                strokeWidth={2.4}
              />
              <div className="min-w-0 flex-1">
                <p
                  className="text-[12px] font-bold"
                  style={{ color: T_PALETTE.T1, letterSpacing: "-0.1px" }}
                >
                  {inc.type || "Observation"}
                </p>
                <p
                  className="text-[11px] mt-[2px] leading-[1.5]"
                  style={{ color: T_PALETTE.T3 }}
                >
                  {String(inc.description || inc.content || "").slice(0, 80) || "—"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   PAGE
   ════════════════════════════════════════════════════════════════════════ */

const PerformancePage = () => {
  const { studentData } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const settings = useSchoolSettings();

  // Benchmark from school settings, fallback to 80. No more "national" claim.
  const benchmark = useMemo(() => {
    const fromSettings = (settings as { benchmarkPercentage?: number })?.benchmarkPercentage;
    return typeof fromSettings === "number" && fromSettings > 0 && fromSettings <= 100
      ? fromSettings
      : 80;
  }, [settings]);

  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [subjects, setSubjects] = useState<SubjectAgg[]>([]);
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);
  const [overallStats, setOverallStats] = useState<OverallStats>({
    grade: "—",
    avg: 0,
    trend: "—",
    hasData: false,
  });
  const [feedbacks, setFeedbacks] = useState<RawFeedback[]>([]);
  const [goalSubject, setGoalSubject] = useState<string>("");
  const [goalTarget, setGoalTarget] = useState<number>(80);
  const [listenerError, setListenerError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Additional collections for end-to-end performance visibility
  const [assignmentsList, setAssignmentsList] = useState<RawAssignment[]>([]);
  const [submissionsList, setSubmissionsList] = useState<RawSubmission[]>([]);
  const [attendanceList, setAttendanceList] = useState<RawAttendance[]>([]);
  const [incidentsList, setIncidentsList] = useState<RawIncident[]>([]);
  const [ratingsList, setRatingsList] = useState<RawRating[]>([]);
  const [aiAttemptsList, setAiAttemptsList] = useState<RawAIAttempt[]>([]);

  useEffect(() => {
    if (!studentData?.id || !studentData?.schoolId) {
      setLoading(false);
      return;
    }
    setListenerError(null);

    // Listener-scoped state — caches keyed by docId so the 3-source merge
    // is deterministic and an email-side listener can't replace the id-side.
    let testScoreCache: RawScore[] = [];
    let resultCache: RawScore[] = [];
    let gradebookCache: RawScore[] = [];
    let feedbackCache: RawFeedback[] = [];
    let lastClassIdsKey = "";
    let unsubGb: (() => void) | null = null;
    let cancelled = false;
    let callSeq = 0;

    const recompute = () => {
      const mySeq = ++callSeq;
      if (cancelled || mySeq !== callSeq) return;

      // 3-source merge — dedup by id so duplicates across collections
      // can't double-count. (Some teachers historically wrote the same
      // assessment into both `test_scores` and `results`.)
      const map = new Map<string, RawScore>();
      [...testScoreCache, ...resultCache, ...gradebookCache].forEach((s) => {
        if (!map.has(s.id)) map.set(s.id, s);
      });
      const allScores = Array.from(map.values());

      // Group by real subject only (no testName/columnName fallbacks).
      const subMap = new Map<string, { total: number; count: number; scores: RawScore[] }>();
      allScores.forEach((s) => {
        const pct = pctOf(s);
        if (pct == null) return; // truly no-data — skip
        const sub = subjectKey(s);
        if (!subMap.has(sub)) subMap.set(sub, { total: 0, count: 0, scores: [] });
        const cur = subMap.get(sub)!;
        cur.total += pct;
        cur.count += 1;
        cur.scores.push(s);
      });

      const derived: SubjectAgg[] = Array.from(subMap.entries()).map(([name, s]) => {
        const avg = Math.round(s.total / s.count);
        const byTime = [...s.scores].sort((a, b) => scoreDateMs(a) - scoreDateMs(b));
        const last = pctOf(byTime[byTime.length - 1]) ?? avg;
        const prev =
          byTime.length > 1 ? pctOf(byTime[byTime.length - 2]) ?? last : last;
        const trendDir: "up" | "down" | "stable" =
          last > prev ? "up" : last < prev ? "down" : "stable";
        return {
          name,
          grade: gradeFor(avg),
          progress: avg,
          status: subjectStatusFor(avg),
          trendDir,
          raw: s.scores,
        };
      });

      // Sort subjects deterministically (alphabetical).
      derived.sort((a, b) => a.name.localeCompare(b.name));
      setSubjects(derived);

      if (derived.length === 0) {
        setOverallStats({ grade: "—", avg: 0, trend: "—", hasData: false });
        setTrendData([]);
        setLoading(false);
        return;
      }

      const globalAvg = Math.round(
        derived.reduce((a, b) => a + b.progress, 0) / derived.length,
      );

      // Real trend from recent half vs older half — no fake "+8%" placeholder.
      const withPct = allScores
        .map((s) => ({ s, pct: pctOf(s), ms: scoreDateMs(s) }))
        .filter((x) => x.pct != null && x.ms > 0)
        .sort((a, b) => b.ms - a.ms);

      let trend = "—";
      if (withPct.length >= 2) {
        const half = Math.ceil(withPct.length / 2);
        const recent = withPct.slice(0, half);
        const older = withPct.slice(half);
        if (older.length > 0) {
          const r = recent.reduce((a, x) => a + (x.pct as number), 0) / recent.length;
          const o = older.reduce((a, x) => a + (x.pct as number), 0) / older.length;
          const diff = Math.round(r - o);
          trend = diff >= 0 ? `+${diff}%` : `${diff}%`;
        }
      }

      setOverallStats({
        grade: gradeFor(globalAvg),
        avg: globalAvg,
        trend,
        hasData: true,
      });

      // Trend chart — last 4 calendar months including current. Wraps year
      // boundary so January correctly shows Oct-Nov-Dec-Jan (prev year is
      // implicit; we only group by month-name for visual clarity).
      const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const byMonth = new Map<string, { total: number; count: number }>();
      allScores.forEach((s) => {
        const pct = pctOf(s);
        if (pct == null) return;
        const d = toSafeDate(s.timestamp) || toSafeDate(s.createdAt) || toSafeDate(s.testDate) || toSafeDate(s.date);
        if (!d) return;
        const m = MONTH[d.getMonth()];
        if (!byMonth.has(m)) byMonth.set(m, { total: 0, count: 0 });
        const cur = byMonth.get(m)!;
        cur.total += pct;
        cur.count += 1;
      });
      const currMonth = new Date().getMonth();
      const points: TrendPoint[] = [];
      for (let off = 3; off >= 0; off--) {
        const m = (currMonth - off + 12) % 12;
        const mm = byMonth.get(MONTH[m]);
        points.push({
          month: MONTH[m],
          score: mm && mm.count > 0 ? Math.round(mm.total / mm.count) : null,
        });
      }
      setTrendData(points);

      setFeedbacks(feedbackCache);
      setLoading(false);
    };

    /* ── Dual-key listeners via shared helper ──────────────────────────
       Memory `dual_query_pattern_studentid_email`: parent-dashboard must
       query by BOTH studentId AND studentEmail. The helper handles merge
       internally and stays consistent with every other parent page. */

    const unsubTS = subscribePerStudent({
      collection: "test_scores",
      student: studentData,
      onChange: (docs) => {
        if (cancelled) return;
        testScoreCache = docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RawScore, "id">) }));
        recompute();
      },
      onError: (err) => {
        if (cancelled) return;
        console.error("[Performance] test_scores listener error:", err);
        setListenerError(err.message || "Some scores couldn't load. Retry?");
      },
    });

    const unsubR = subscribePerStudent({
      collection: "results",
      student: studentData,
      onChange: (docs) => {
        if (cancelled) return;
        resultCache = docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RawScore, "id">) }));
        recompute();
      },
      onError: (err) => {
        if (cancelled) return;
        console.error("[Performance] results listener error:", err);
        setListenerError(err.message || "Some scores couldn't load. Retry?");
      },
    });

    const unsubF = subscribePerStudent({
      collection: "performance_feedback",
      student: studentData,
      onChange: (docs) => {
        if (cancelled) return;
        feedbackCache = docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<RawFeedback, "id">),
        }));
        recompute();
      },
      onError: (err) => {
        if (cancelled) return;
        console.error("[Performance] performance_feedback listener error:", err);
      },
    });

    /* ── End-to-end metric listeners (dual-key) ───────────────────────── */

    // AI Practice attempts — student's self-study sessions. Written by
    // AIPracticePage.tsx on exam submission. Dual-key per memory rule
    // `dual_query_pattern_studentid_email`.
    const unsubAI = subscribePerStudent({
      collection: "practice_attempts",
      student: studentData,
      onChange: (docs) => {
        if (cancelled) return;
        setAiAttemptsList(
          docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RawAIAttempt, "id">) })),
        );
      },
      onError: (err) => {
        if (cancelled) return;
        console.error("[Performance] practice_attempts listener error:", err);
      },
    });

    // Submissions — parent-uploaded homework. Used for assignment completion.
    const unsubSubs = subscribePerStudent({
      collection: "submissions",
      student: studentData,
      onChange: (docs) => {
        if (cancelled) return;
        setSubmissionsList(
          docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RawSubmission, "id">) })),
        );
      },
      onError: (err) => {
        if (cancelled) return;
        console.error("[Performance] submissions listener error:", err);
      },
    });

    // Attendance — teacher-marked. IST-aware compare on `date` field.
    const unsubAtt = subscribePerStudent({
      collection: "attendance",
      student: studentData,
      onChange: (docs) => {
        if (cancelled) return;
        setAttendanceList(
          docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RawAttendance, "id">) })),
        );
      },
      onError: (err) => {
        if (cancelled) return;
        console.error("[Performance] attendance listener error:", err);
      },
    });

    // Incidents — teacher-recorded behaviour notes. Memory cross_dashboard_behaviour_sync.
    const unsubInc = subscribePerStudent({
      collection: "incidents",
      student: studentData,
      onChange: (docs) => {
        if (cancelled) return;
        setIncidentsList(
          docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RawIncident, "id">) })),
        );
      },
      onError: (err) => {
        if (cancelled) return;
        console.error("[Performance] incidents listener error:", err);
      },
    });

    // Student ratings — teacher Quick Rate stars. Memory cross_dashboard_behaviour_sync.
    const unsubRat = subscribePerStudent({
      collection: "student_ratings",
      student: studentData,
      onChange: (docs) => {
        if (cancelled) return;
        setRatingsList(
          docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RawRating, "id">) })),
        );
      },
      onError: (err) => {
        if (cancelled) return;
        console.error("[Performance] student_ratings listener error:", err);
      },
    });

    /* ── Class-scoped listeners — gradebook + assignments ─────────────── */

    let unsubAsgn: (() => void) | null = null;

    const setupClassScopedListeners = (classIds: string[]) => {
      const key = classIds.slice().sort().join("|");
      if (key === lastClassIdsKey) return;
      lastClassIdsKey = key;

      if (unsubGb) { unsubGb(); unsubGb = null; }
      if (unsubAsgn) { unsubAsgn(); unsubAsgn = null; }

      if (classIds.length === 0) {
        gradebookCache = [];
        setAssignmentsList([]);
        recompute();
        return;
      }
      const limited = classIds.slice(0, 30); // Firestore `in` cap

      // Gradebook scores
      unsubGb = onSnapshot(
        scopedQuery(
          "gradebook_scores",
          studentData.schoolId,
          where("classId", "in", limited),
          where("studentId", "==", studentData.id),
        ),
        (snap) => {
          if (cancelled) return;
          gradebookCache = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<RawScore, "id">),
          }));
          recompute();
        },
        (err) => {
          if (cancelled) return;
          console.error("[Performance] gradebook_scores listener error:", err);
        },
      );

      // Assignments (class-scoped — published to whole class)
      unsubAsgn = onSnapshot(
        scopedQuery(
          "assignments",
          studentData.schoolId,
          where("classId", "in", limited),
        ),
        (snap) => {
          if (cancelled) return;
          setAssignmentsList(
            snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<RawAssignment, "id">),
            })),
          );
        },
        (err) => {
          if (cancelled) return;
          console.error("[Performance] assignments listener error:", err);
        },
      );
    };

    const unsubEnroll = subscribeEnrollments(
      studentData,
      (docs) => {
        if (cancelled) return;
        const classIds = Array.from(
          new Set(
            docs
              .map((d) => (d.data() as { classId?: string }).classId)
              .filter((id): id is string => !!id),
          ),
        );
        setupClassScopedListeners(classIds);
      },
      (err) => {
        if (cancelled) return;
        console.error("[Performance] enrollments listener error:", err);
      },
    );

    return () => {
      cancelled = true;
      unsubTS();
      unsubR();
      unsubF();
      unsubSubs();
      unsubAtt();
      unsubInc();
      unsubRat();
      unsubEnroll();
      unsubAI();
      if (unsubGb) unsubGb();
      if (unsubAsgn) unsubAsgn();
    };
  }, [studentData, refreshKey]);

  const studentName = useMemo(
    () => studentData?.name?.split(" ")[0] || "Your child",
    [studentData?.name],
  );

  const generateNarrative = () =>
    generatePerformanceNarrative({
      studentName,
      subjects,
      overallAvg: overallStats.avg,
    });

  /* ── Derived: end-to-end performance snapshot + cards data ────────── */

  // Assignment rows — one per published assignment for this student's class(es).
  // (We don't pre-build a "submitted ids" Set because assignmentRows already
  //  inlines the match via submissionMatchesAssignment + isSubmissionCompleted.
  //  Memory `bug_pattern_dual_id_writer_or_short_circuit` handled inside the
  //  helper.)
  const assignmentRows: AssignmentRow[] = useMemo(
    () =>
      assignmentsList.map((a) => {
        const due = toSafeDate(a.dueDate);
        const matchingSub = submissionsList
          .filter(isSubmissionCompleted)
          .find((s) => submissionMatchesAssignment(s, a.id));
        return {
          id: a.id,
          title: a.title || "Assignment",
          dueDate: due,
          submitted: !!matchingSub,
          onTime: matchingSub ? wasOnTime(matchingSub, due) : null,
        };
      }),
    [assignmentsList, submissionsList],
  );

  // Test/exam rows — only from `test_scores` collection (gradebook + results
  // are different sources). Recent 5 by score date desc.
  const testRows: TestScoreRow[] = useMemo(() => {
    const fromSubjects: TestScoreRow[] = [];
    subjects.forEach((sub) => {
      sub.raw.forEach((r) => {
        // Only docs that LOOK like proper tests — have a testName OR no
        // gradebook-specific field. Heuristic: testName present OR maxScore.
        const isTest = !!(r.testName || r.maxScore != null);
        if (!isTest) return;
        const pct = pctOf(r);
        if (pct == null) return;
        fromSubjects.push({
          id: r.id,
          name: r.testName || `${sub.name} assessment`,
          subject: sub.name,
          date:
            toSafeDate(r.timestamp) ||
            toSafeDate(r.testDate) ||
            toSafeDate(r.createdAt),
          pct,
        });
      });
    });
    // Sort by date desc, fallback by name
    fromSubjects.sort((a, b) => {
      const ad = a.date?.getTime() ?? 0;
      const bd = b.date?.getTime() ?? 0;
      if (ad !== bd) return bd - ad;
      return a.name.localeCompare(b.name);
    });
    return fromSubjects;
  }, [subjects]);

  // Recent incidents (last 30 days) sorted by createdAt desc
  const recentIncidents = useMemo(() => {
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    return incidentsList
      .filter((i) => {
        const d = toSafeDate(i.createdAt) || toSafeDate(i.date);
        return d ? d.getTime() >= cutoff : false;
      })
      .sort((a, b) => {
        const ad = (toSafeDate(a.createdAt) || toSafeDate(a.date))?.getTime() ?? 0;
        const bd = (toSafeDate(b.createdAt) || toSafeDate(b.date))?.getTime() ?? 0;
        return bd - ad;
      });
  }, [incidentsList]);

  // The end-to-end snapshot used by PerformanceSnapshotRow + the cards.
  const snapshot: PerformanceSnapshot = useMemo(() => {
    // Subjects avg
    const subjectsAvg =
      subjects.length > 0
        ? Math.round(subjects.reduce((a, s) => a + s.progress, 0) / subjects.length)
        : null;

    // Tests: only from test_scores rows
    const testsAvg =
      testRows.length > 0
        ? Math.round(testRows.reduce((a, r) => a + r.pct, 0) / testRows.length)
        : null;

    // Assignments
    const assignmentTotal = assignmentRows.length;
    const assignmentSubmitted = assignmentRows.filter((r) => r.submitted).length;
    const onTimeEligible = assignmentRows.filter((r) => r.submitted && r.onTime !== null);
    const assignmentOnTime = onTimeEligible.filter((r) => r.onTime === true).length;

    // Attendance — last 30 days, IST-aware
    const todayMs = Date.now();
    const thirtyAgo = todayMs - THIRTY_DAYS_MS;
    const recentAtt = attendanceList.filter((a) => {
      if (!a.date) return false;
      const d = new Date(`${a.date}T00:00:00`);
      const t = d.getTime();
      return !isNaN(t) && t >= thirtyAgo && t <= todayMs;
    });
    // Holiday days are excluded from attendance % (whole-class off-day).
    const recentCountable = recentAtt.filter((a) => a.status !== "holiday");
    const attendancePresent = recentCountable.filter((a) => a.status === "present").length;
    const attendanceLate = recentCountable.filter((a) => a.status === "late").length;
    const attendanceAbsent = recentCountable.filter((a) => a.status === "absent").length;
    const attendanceTotal = recentCountable.length;
    const attendanceRate =
      attendanceTotal > 0
        ? Math.round(((attendancePresent + attendanceLate) / attendanceTotal) * 100)
        : null;

    // Incidents — last 30 days
    const incidents30d = recentIncidents.length;

    // Ratings — 1-5 scale per Quick Rate writer
    const ratingValues = ratingsList
      .map((r) => Number(r.rating))
      .filter((v) => isFinite(v) && v > 0 && v <= 5);
    const ratingAvg =
      ratingValues.length > 0
        ? ratingValues.reduce((a, b) => a + b, 0) / ratingValues.length
        : null;
    const ratingCount = ratingValues.length;

    return {
      subjectsAvg,
      testsAvg,
      testCount: testRows.length,
      assignmentTotal,
      assignmentSubmitted,
      assignmentOnTime,
      attendancePresent,
      attendanceLate,
      attendanceAbsent,
      attendanceRate,
      attendanceTotal,
      incidents30d,
      ratingAvg,
      ratingCount,
    };
    // submittedAssignmentIds tracked indirectly via assignmentRows → suppress warning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects, testRows, assignmentRows, attendanceList, ratingsList, recentIncidents]);

  /* ── Subject detail view ──────────────────────────────────────────── */

  if (selectedSubject) {
    const s = subjects.find((sub) => sub.name === selectedSubject);
    if (!s) return null;

    // Real topic breakdown only — drop fallback to subject name (used to
    // render a fake "Math" topic inside the Math subject view).
    const topicMap = new Map<string, { total: number; count: number }>();
    s.raw.forEach((score) => {
      const t = score.topic || (score.topics && score.topics[0]) || "";
      if (!t) return; // no real topic — skip
      const pct = pctOf(score);
      if (pct == null) return;
      if (!topicMap.has(t)) topicMap.set(t, { total: 0, count: 0 });
      const cur = topicMap.get(t)!;
      cur.total += pct;
      cur.count += 1;
    });
    const processedTopics = Array.from(topicMap.entries())
      .map(([name, d]) => ({ name, score: Math.round(d.total / d.count) }))
      .sort((a, b) => b.score - a.score);

    const subFeedback = feedbacks
      .filter(
        (f) =>
          f.subject?.toLowerCase().includes(s.name.toLowerCase()) ||
          (f.subject ? s.name.toLowerCase().includes(f.subject.toLowerCase()) : false),
      )
      .sort((a, b) => {
        const ad = toSafeDate(a.timestamp) || toSafeDate(a.createdAt);
        const bd = toSafeDate(b.timestamp) || toSafeDate(b.createdAt);
        return (bd?.getTime() || 0) - (ad?.getTime() || 0);
      })[0];

    const testScores = [...s.raw]
      .sort((a, b) => scoreDateMs(b) - scoreDateMs(a))
      .map((r) => {
        const pct = pctOf(r);
        const maxNum = Number(r.maxScore ?? r.maxMarks);
        const rawValue = r.score ?? r.mark ?? r.marks;
        const scoreLabel =
          rawValue != null && Number.isFinite(maxNum) && maxNum > 0
            ? `${rawValue}/${maxNum}`
            : rawValue != null
              ? String(rawValue)
              : pct != null
                ? `${Math.round(pct)}%`
                : "—";
        const d = toSafeDate(r.timestamp) || toSafeDate(r.testDate) || toSafeDate(r.createdAt);
        return {
          name: r.testName || "Untitled assessment",
          date: d
            ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
            : "—",
          score: scoreLabel,
          status:
            pct != null && pct >= 75 ? "success" :
            pct != null && pct >= 60 ? "warning" : "error",
        };
      });

    return (
      <SubjectPerformanceDetail
        subject={s.name}
        teacher={subFeedback?.teacherName || "—"}
        grade={s.grade}
        average={s.progress}
        topics={processedTopics}
        testScores={testScores}
        feedback={
          subFeedback?.content ||
          "No teacher feedback recorded yet for this subject."
        }
        resources={[]}
        onBack={() => setSelectedSubject(null)}
      />
    );
  }

  /* ── MOBILE branch ────────────────────────────────────────────────── */

  if (isMobile) {
    const { T1, T3 } = T_PALETTE;
    const renderMain = () => {
      if (loading) return <LoadingBlock isMobile />;
      const hasAnyData =
        subjects.length > 0 ||
        snapshot.testCount > 0 ||
        snapshot.assignmentTotal > 0 ||
        snapshot.attendanceTotal > 0 ||
        snapshot.incidents30d > 0 ||
        snapshot.ratingCount > 0;
      if (!hasAnyData) return <EmptyBlock isMobile />;
      return (
        <>
          <PerformanceSnapshotRow snap={snapshot} isMobile navigate={navigate} />
          {subjects.map((s, i) => (
            <SubjectCard
              key={s.name}
              subject={s}
              idx={i}
              isMobile
              onClick={() => setSelectedSubject(s.name)}
            />
          ))}
          <TestsAndExamsCard rows={testRows} isMobile navigate={navigate} />
          <AssignmentsCard rows={assignmentRows} isMobile navigate={navigate} />
          <AIPracticeCard rows={aiAttemptsList} isMobile navigate={navigate} />
          <AttendanceSnapshotCard snap={snapshot} isMobile navigate={navigate} />
          <BehaviourSnapshotCard
            snap={snapshot}
            recentIncidents={recentIncidents}
            isMobile
            navigate={navigate}
          />
          <TrendChartCard data={trendData} isMobile navigate={navigate} />
          <NarrativeCard narrative={generateNarrative()} isMobile navigate={navigate} />
          <GoalPlannerCard
            subjects={subjects}
            goalSubject={goalSubject}
            setGoalSubject={setGoalSubject}
            goalTarget={goalTarget}
            setGoalTarget={setGoalTarget}
            isMobile
          />
          <BenchmarkInsightsCard
            subjects={subjects}
            benchmark={benchmark}
            studentName={studentName}
            isMobile
            onSubjectClick={setSelectedSubject}
          />
        </>
      );
    };

    return (
      <div
        className="animate-in fade-in duration-500 -mx-3 -mt-3 md:mx-0 md:mt-0"
        style={{
          fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
          background: T_PALETTE.BG,
          minHeight: "100vh",
        }}
      >
        {/* Page head */}
        <div className="flex items-start justify-between px-[22px] pt-[18px]">
          <div>
            <div className="text-[24px] font-bold" style={{ color: T1, letterSpacing: "-0.6px" }}>
              Performance Analytics
            </div>
            <div className="text-[12px] mt-[3px] font-normal" style={{ color: T3 }}>
              Detailed breakdown of academic progress
            </div>
          </div>
          <div
            className="w-8 h-8 rounded-[10px] flex items-center justify-center text-[14px] font-bold text-white mt-0.5 shrink-0"
            style={{
              background: `linear-gradient(135deg, ${T_PALETTE.B1}, ${T_PALETTE.B2})`,
              boxShadow: "0 3px 10px rgba(0,85,255,0.32)",
            }}
          >
            {overallStats.grade}
          </div>
        </div>

        {listenerError && (
          <ListenerErrorBanner
            message={listenerError}
            onRetry={() => setRefreshKey((k) => k + 1)}
            marginClass="mx-5 mt-3"
          />
        )}

        <OverallPerformanceHero stats={overallStats} isMobile navigate={navigate} />
        {renderMain()}

        <div className="h-6" />
      </div>
    );
  }

  /* ── DESKTOP branch ───────────────────────────────────────────────── */

  const { T1, T3, T4, B1, B2 } = T_PALETTE;
  return (
    <div
      className="animate-in fade-in duration-500 -m-4 sm:-m-6 md:-m-8 min-h-[calc(100vh-64px)]"
      style={{
        fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        background: T_PALETTE.BG,
      }}
    >
      <div className="w-full px-6 pt-8 pb-12">
        {/* Toolbar */}
        <div className="flex items-start justify-between gap-6 flex-wrap mb-6">
          <div>
            <div className="text-[32px] font-bold" style={{ color: T1, letterSpacing: "-0.9px" }}>
              Performance Analytics
            </div>
            <div className="text-[14px] mt-2 font-normal" style={{ color: T3 }}>
              Detailed breakdown of academic progress
            </div>
          </div>
          <div
            className="w-14 h-14 rounded-[16px] flex items-center justify-center text-[20px] font-bold text-white shrink-0"
            style={{
              background: `linear-gradient(135deg, ${B1}, ${B2})`,
              boxShadow: "0 4px 16px rgba(0,85,255,0.38)",
            }}
          >
            {overallStats.grade}
          </div>
        </div>

        {listenerError && (
          <ListenerErrorBanner
            message={listenerError}
            onRetry={() => setRefreshKey((k) => k + 1)}
            marginClass="mb-5"
          />
        )}

        <OverallPerformanceHero stats={overallStats} isMobile={false} navigate={navigate} />

        {loading ? (
          <LoadingBlock isMobile={false} />
        ) : (() => {
          const hasAnyData =
            subjects.length > 0 ||
            snapshot.testCount > 0 ||
            snapshot.assignmentTotal > 0 ||
            snapshot.attendanceTotal > 0 ||
            snapshot.incidents30d > 0 ||
            snapshot.ratingCount > 0;
          if (!hasAnyData) return <EmptyBlock isMobile={false} />;
          return (
            <>
              <PerformanceSnapshotRow snap={snapshot} isMobile={false} navigate={navigate} />

              {subjects.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {subjects.map((s, i) => (
                    <SubjectCard
                      key={s.name}
                      subject={s}
                      idx={i}
                      isMobile={false}
                      onClick={() => setSelectedSubject(s.name)}
                    />
                  ))}
                </div>
              )}

              {/* End-to-end metric cards — render only the ones with data */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
                <TestsAndExamsCard rows={testRows} isMobile={false} navigate={navigate} />
                <AssignmentsCard rows={assignmentRows} isMobile={false} navigate={navigate} />
                <AIPracticeCard rows={aiAttemptsList} isMobile={false} navigate={navigate} />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
                <AttendanceSnapshotCard snap={snapshot} isMobile={false} navigate={navigate} />
                <BehaviourSnapshotCard
                  snap={snapshot}
                  recentIncidents={recentIncidents}
                  isMobile={false}
                  navigate={navigate}
                />
              </div>

              {/* Trend + Narrative row (existing) */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 mt-5">
                {trendData.filter(p => p.score != null).length > 1 ? (
                  <TrendChartCard data={trendData} isMobile={false} navigate={navigate} />
                ) : (
                  <div className="lg:col-span-3" />
                )}
                <NarrativeCard
                  narrative={generateNarrative()}
                  isMobile={false}
                  navigate={navigate}
                />
              </div>

              {/* Goal + Benchmark row (existing) — only when subjects exist */}
              {subjects.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
                  <GoalPlannerCard
                    subjects={subjects}
                    goalSubject={goalSubject}
                    setGoalSubject={setGoalSubject}
                    goalTarget={goalTarget}
                    setGoalTarget={setGoalTarget}
                    isMobile={false}
                  />
                  <BenchmarkInsightsCard
                    subjects={subjects}
                    benchmark={benchmark}
                    studentName={studentName}
                    isMobile={false}
                    onSubjectClick={setSelectedSubject}
                  />
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
};

export default PerformancePage;
