import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Printer, MessageSquare, AlertCircle, Loader2, ChevronLeft, ChevronRight, CheckCircle2, FileText, BookOpen, Calendar as CalIcon, TrendingUp, BarChart3, Activity, AlertTriangle, Clock } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { doc, onSnapshot, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../lib/AuthContext";
import { useIsMobile } from "../hooks/use-mobile";
import { subscribePerStudent } from "../lib/perStudentQuery";
import { subscribeEnrollments } from "../lib/enrollmentQuery";
import { scopedQuery } from "../lib/scopedQuery";
import { SubjectMasteryRadar } from "../components/SubjectMasteryRadar";

// ── Tokens ───────────────────────────────────────────────────────────────────
const T = {
  bg: "#EEF4FF", white: "#ffffff", ink: "#0f172a", ink2: "#475569", ink3: "#94a3b8",
  bdr: "#e2e8f0", s1: "#f1f5f9", s2: "#e2e8f0", s3: "#cbd5e1",
  blue: "#3B5BDB", blBg: "#EDF2FF", blBdr: "#BAC8FF",
  grn: "#16a34a", glBg: "#f0fdf4", red: "#dc2626", rlBg: "#fef2f2",
  amb: "#d97706", alBg: "#fffbeb", pur: "#7c3aed",
};

const toDate = (v: any): Date | null => { if (!v) return null; if (v?.toDate) return v.toDate(); if (v?.seconds) return new Date(v.seconds * 1000); const d = new Date(v); return isNaN(d.getTime()) ? null : d; };
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const timeAgo = (v: any) => { const d = toDate(v); if (!d) return ""; const s = (Date.now() - d.getTime()) / 1000; if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase(); };

// IST date key — matches MarkAttendance writer (toLocaleDateString en-CA in Asia/Kolkata).
// Using UTC ISO here drops marks made in early IST morning into the previous day.
const istKey = (dt: Date | null | undefined): string =>
  dt ? dt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "";

// Canonical score normalizer. Test/result/gradebook writers use any of:
//   percentage / mark / marks / score, with optional maxMark / maxMarks / outOf.
// Returns 0 for missing/zero so caller can filter with > 0.
const pctOf = (t: any): number => {
  if (typeof t?.percentage === "number" && t.percentage > 0) return Math.min(100, t.percentage);
  const raw = t?.percentage ?? t?.mark ?? t?.marks ?? t?.score;
  const n = Number(raw);
  if (!isFinite(n) || n <= 0) return 0;
  const max = Number(t?.maxMark ?? t?.maxMarks ?? t?.totalMark ?? t?.outOf ?? 0);
  if (max > 0) return Math.min(100, Math.round((n / max) * 100));
  return Math.min(100, n);
};

const scoreDateOf = (t: any): Date | null =>
  toDate(t?.testDate) || toDate(t?.timestamp) || toDate(t?.createdAt) || toDate(t?.date);

// Generic descending-by-time comparator for items with createdAt/date/timestamp.
const itemTimeMs = (it: any): number => {
  const d = toDate(it?.createdAt) || toDate(it?.date) || toDate(it?.timestamp) || toDate(it?.updatedAt);
  return d ? d.getTime() : 0;
};
const cmpDescTime = (a: any, b: any) => itemTimeMs(b) - itemTimeMs(a);

// Submission counts as "completed" only when teacher hasn't flagged it as Not Submitted
// (parent-uploaded submission docs default to no status; teacher-graded ones may set it).
const isSubmissionCompleted = (s: any): boolean =>
  String(s?.status || "").toLowerCase() !== "not submitted";

// Severity → tone color for incidents. Writers (StudentBehaviour, Discipline) use
// `severity` as "low"/"medium"/"high"/"critical" or capitalised variants.
const severityTone = (raw: any): string => {
  const s = String(raw || "").toLowerCase();
  if (s.includes("crit") || s.includes("severe")) return T.red;
  if (s.includes("high")) return T.red;
  if (s.includes("med")) return T.amb;
  if (s.includes("low") || s.includes("minor")) return T.blue;
  return T.amb; // default — incidents are concerning by nature
};

// Due-date chip helper.
const dueChipFor = (a: any): { label: string; color: string; bg: string } | null => {
  const due = toDate(a?.dueDate);
  if (!due) return null;
  const ms = due.getTime() - Date.now();
  const days = Math.round(ms / 86400000);
  if (days < -1) return { label: `${Math.abs(days)}d overdue`, color: T.red, bg: T.rlBg };
  if (days <= 0) return { label: "Due today", color: T.amb, bg: T.alBg };
  if (days === 1) return { label: "Due tomorrow", color: T.amb, bg: T.alBg };
  if (days <= 7) return { label: `Due in ${days}d`, color: T.blue, bg: T.blBg };
  return { label: `Due ${due.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`, color: T.ink3, bg: T.s1 };
};

// ── Canonical blue-halo shadows (matches principal-dashboard tilt3D) ──────────
const SH_REST = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 20px 48px rgba(0,85,255,0.14)";
const SH_HOVER = "0 0 0 0.5px rgba(0,85,255,0.14), 0 8px 24px rgba(0,85,255,0.16), 0 20px 46px rgba(0,85,255,0.18)";

const Card = ({ children, title, action, style, onClick }: { children: React.ReactNode; title?: string; action?: React.ReactNode; style?: React.CSSProperties; onClick?: () => void }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      style={{
        background: T.white,
        border: `0.5px solid ${hovered ? "rgba(0,85,255,0.22)" : "rgba(0,85,255,0.10)"}`,
        borderRadius: 16,
        overflow: "hidden",
        transform: hovered ? "translate3d(0,-5px,0) scale(1.02)" : "translate3d(0,0,0) scale(1)",
        transition: hovered
          ? "transform 0.22s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.22s ease, border-color 0.22s ease"
          : "transform 0.28s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.28s ease, border-color 0.28s ease",
        boxShadow: hovered ? SH_HOVER : SH_REST,
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
        willChange: "transform",
        position: "relative",
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    >
      {title && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: `1px solid ${T.s2}`, position: "relative", zIndex: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>{title}</span>
          {action || null}
        </div>
      )}
      <div style={{ padding: "16px 20px", position: "relative", zIndex: 2 }}>{children}</div>
    </div>
  );
};

const DetailLink = ({ to }: { to: string }) => {
  const navigate = useNavigate();
  return (
    <span
      onClick={(e) => { e.stopPropagation(); navigate(to); }}
      style={{ fontSize: 11, color: T.blue, fontWeight: 500, cursor: "pointer" }}
    >
      Details →
    </span>
  );
};

// Standalone live clock — isolates 1Hz re-renders from the parent page so charts
// don't redraw every second.
const LiveClock = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span style={{ color: T.blue, fontWeight: 600 }}>
      {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// PARENT MY CHILD — canonical design (matches owner/principal/teacher)
// ═══════════════════════════════════════════════════════════════════════════════
const MyChildPage = () => {
  const { studentData } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [loading, setLoading] = useState(true);
  const [masterProfile, setMasterProfile] = useState<any>(null);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [testScores, setTestScores] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [parentNotes, setParentNotes] = useState<any[]>([]);
  const [interventions, setInterventions] = useState<any[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [calMonth, setCalMonth] = useState(new Date());

  const sid = studentData?.id || studentData?.studentId || "";

  // ── Live student master profile ────────────────────────────────────────────
  useEffect(() => {
    if (!sid) { setLoading(false); return; }
    const unsub = onSnapshot(doc(db, "students", sid), (d) => {
      if (d.exists()) setMasterProfile(d.data());
    }, (err) => {
      console.error("[MyChild] student doc listener error:", err);
    });
    return () => unsub();
  }, [sid]);

  // ── Per-student dual-key listeners (id + email merge) ──────────────────────
  // Memory rule `dual_query_pattern_studentid_email`: every per-student read
  // MUST query both studentId AND studentEmail to avoid silent data loss.
  useEffect(() => {
    if (!studentData?.id || !studentData.schoolId) {
      setLoading(false);
      return;
    }
    setLoading(true);

    // Track listener readiness so we can flip loading off once primary streams arrive.
    const ready = { att: false, scores: false, gb: false, res: false, sub: false, inc: false, pn: false, iv: false, en: false };
    const checkReady = () => {
      if (ready.att && ready.scores && ready.gb && ready.res && ready.sub && ready.inc && ready.pn && ready.iv && ready.en) {
        setLoading(false);
      }
    };

    const unsubs: Array<() => void> = [];
    const sub = (col: string, setter: (docs: any[]) => void, key: keyof typeof ready) => {
      unsubs.push(subscribePerStudent({
        collection: col,
        student: studentData,
        onChange: (docs) => {
          setter(docs.map(d => ({ id: d.id, ...d.data() })));
          ready[key] = true;
          checkReady();
        },
        onError: (err) => {
          console.error(`[MyChild] ${col} listener error:`, err);
          ready[key] = true;
          checkReady();
        },
      }));
    };

    sub("attendance", setAttendance, "att");
    sub("incidents", setIncidents, "inc");
    sub("parent_notes", setParentNotes, "pn");
    sub("interventions", setInterventions, "iv");
    sub("submissions", setSubmissions, "sub");

    // Scores: 3-source merge (test_scores + gradebook_scores + results).
    let tsCache: any[] = [], gbCache: any[] = [], rsCache: any[] = [];
    const emitScores = () => {
      const map = new Map<string, any>();
      [...tsCache, ...gbCache, ...rsCache].forEach(d => map.set(d.id, d));
      setTestScores(Array.from(map.values()));
    };
    unsubs.push(subscribePerStudent({
      collection: "test_scores",
      student: studentData,
      onChange: (docs) => { tsCache = docs.map(d => ({ id: d.id, ...d.data() })); emitScores(); ready.scores = true; checkReady(); },
      onError: (err) => { console.error("[MyChild] test_scores:", err); ready.scores = true; checkReady(); },
    }));
    unsubs.push(subscribePerStudent({
      collection: "gradebook_scores",
      student: studentData,
      onChange: (docs) => { gbCache = docs.map(d => ({ id: d.id, ...d.data() })); emitScores(); ready.gb = true; checkReady(); },
      onError: (err) => { console.error("[MyChild] gradebook_scores:", err); ready.gb = true; checkReady(); },
    }));
    unsubs.push(subscribePerStudent({
      collection: "results",
      student: studentData,
      onChange: (docs) => { rsCache = docs.map(d => ({ id: d.id, ...d.data() })); emitScores(); ready.res = true; checkReady(); },
      onError: (err) => { console.error("[MyChild] results:", err); ready.res = true; checkReady(); },
    }));

    // Enrollments via canonical dual-key helper (used to derive classId fallback).
    unsubs.push(subscribeEnrollments(
      studentData,
      (docs) => {
        setEnrollments(docs.map(d => ({ id: d.id, ...d.data() })));
        ready.en = true;
        checkReady();
      },
      (err) => { console.error("[MyChild] enrollments:", err); ready.en = true; checkReady(); },
    ));

    return () => { unsubs.forEach(u => u()); };
  }, [studentData?.id, studentData?.schoolId, studentData?.email, studentData?.studentEmail]);

  // ── Resolve ALL enrolled classIds (multi-class students are common) ────────
  // CRITICAL: a single-class query (`where classId == X`) silently misses any
  // assignment posted to a class the student is enrolled in but isn't the one
  // picked here. The user's exact symptom 2026-05-11: parent submitted an
  // assignment from AssignmentsPage (which uses multi-class), MyChildPage
  // didn't show it as submitted because the assignment itself never loaded.
  // We mirror AssignmentsPage's `where("classId", "in", classIds)` pattern so
  // both pages see the same set, and the submitted-flag flip is consistent.
  const classIds = useMemo(() => {
    const set = new Set<string>();
    if (studentData?.classId) set.add(String(studentData.classId));
    enrollments.forEach((e: any) => {
      if (e?.classId) set.add(String(e.classId));
    });
    return Array.from(set);
  }, [studentData?.classId, enrollments]);

  // ── LIVE multi-class assignments listener ──────────────────────────────────
  // Firestore `in` operator currently supports up to 30 values; defensively
  // cap the array so an edge-case student enrolled in >30 classes still gets
  // a working subscription (their excess classes simply won't surface — rare,
  // and a teacher-side enrollment-cleanup is the real fix in that scenario).
  useEffect(() => {
    if (!studentData?.schoolId || classIds.length === 0) {
      setAssignments([]);
      return;
    }
    const limited = classIds.slice(0, 30);
    const unsub = onSnapshot(
      scopedQuery("assignments", studentData.schoolId, where("classId", "in", limited)),
      (snap) => setAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => {
        console.error("[MyChild] assignments listener error:", err);
        setAssignments([]);
      },
    );
    return () => unsub();
    // Depend on a stable string-join so the listener doesn't tear down on
    // every render — only when the actual list of classIds changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classIds.join("|"), studentData?.schoolId]);

  // Merged student (live master overrides cached studentData)
  const student = useMemo(() => ({ ...studentData, ...(masterProfile || {}) }), [studentData, masterProfile]);

  // ── Metrics ────────────────────────────────────────────────────────────────
  const m = useMemo(() => {
    const tot = attendance.length;
    const pres = attendance.filter(r => r.status === "present").length;
    const late = attendance.filter(r => r.status === "late").length;
    const abs = tot - pres - late;
    const attRate = tot > 0 ? ((pres + late) / tot) * 100 : 0;

    const vals = testScores.map(pctOf).filter(n => n > 0);
    const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;

    // Per-subject averages (immutable build, no in-place mutation).
    const sums: Record<string, number> = {};
    const cnts: Record<string, number> = {};
    testScores.forEach(t => {
      const sub = String(t.subject || t.subjectName || "GENERAL").toUpperCase();
      const p = pctOf(t);
      if (p <= 0) return;
      sums[sub] = (sums[sub] || 0) + p;
      cnts[sub] = (cnts[sub] || 0) + 1;
    });
    let subScores: Record<string, number> = Object.fromEntries(
      Object.entries(sums).map(([k, sum]) => [k, Math.round(sum / cnts[k])])
    );
    // Per memory `bug_pattern_fallback_bucket_alone`: hide GENERAL bucket if it
    // is the only entry — no information vs the overall average.
    const subKeys = Object.keys(subScores);
    if (subKeys.length === 1 && subKeys[0] === "GENERAL") {
      subScores = {};
    }

    const sorted = [...testScores].sort((a, b) => (scoreDateOf(b)?.getTime() || 0) - (scoreDateOf(a)?.getTime() || 0));
    const r3 = sorted.slice(0, 3).map(pctOf).filter(n => n > 0);
    const p3 = sorted.slice(3, 6).map(pctOf).filter(n => n > 0);
    const rAvg = r3.length ? r3.reduce((a, b) => a + b, 0) / r3.length : 0;
    const pAvg = p3.length ? p3.reduce((a, b) => a + b, 0) / p3.length : 0;
    const trend: "up" | "down" | "flat" = rAvg - pAvg >= 5 ? "up" : pAvg - rAvg >= 5 ? "down" : "flat";

    const today0 = new Date();
    const monthly = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(today0.getFullYear(), today0.getMonth() - (5 - i), 1);
      const mAtt = attendance.filter(r => { const dt = toDate(r.date); return dt && dt.getMonth() === d.getMonth() && dt.getFullYear() === d.getFullYear(); });
      const mSc = testScores.filter(t => { const dt = scoreDateOf(t); return dt && dt.getMonth() === d.getMonth() && dt.getFullYear() === d.getFullYear(); });
      const mP = mAtt.filter(r => r.status === "present" || r.status === "late").length;
      const attP = mAtt.length > 0 ? (mP / mAtt.length) * 100 : 0;
      const sV = mSc.map(pctOf).filter(n => n > 0);
      const scP = sV.length > 0 ? sV.reduce((a, b) => a + b, 0) / sV.length : 0;
      return { month: MONTHS[d.getMonth()], score: Math.round(scP), attendance: Math.round(attP) };
    });

    // Submission completion: a submission counts only if it matches the assignment
    // AND is not flagged "Not Submitted" (teachers/parents can mint draft rows).
    //
    // CRITICAL: AssignmentsPage submission writer sets BOTH fields on every doc:
    //   homeworkId   = the assignment doc id (the parent's `assignment.id`)
    //   assignmentId = the teaching_assignment id (a DIFFERENT doc — falls back
    //                  to the literal string "legacy" when missing)
    // Naive `s.assignmentId || s.homeworkId` always picks `assignmentId` and
    // therefore misses every match (assignments[].id never equals the
    // teaching_assignment id or "legacy"). Add BOTH fields to the lookup set
    // so either match flavor lands the assignment as "submitted".
    const submittedAsgIds = new Set<string>();
    submissions.filter(isSubmissionCompleted).forEach((s: any) => {
      if (s.homeworkId)   submittedAsgIds.add(String(s.homeworkId));
      if (s.assignmentId) submittedAsgIds.add(String(s.assignmentId));
    });
    const subCount = assignments.filter(a => submittedAsgIds.has(a.id)).length;
    const asgCount = assignments.length;
    const completion = asgCount > 0 ? (subCount / asgCount) * 100 : 0;
    const days = new Set(attendance.map(a => istKey(toDate(a.date))).filter(Boolean)).size;

    // Recent incidents (last 30 days) for risk weighting — old incidents shouldn't haunt forever.
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const recentIncidents = incidents.filter((i: any) => {
      const d = toDate(i.createdAt || i.date);
      return d && d.getTime() >= cutoff;
    }).length;

    return { tot, pres, late, abs, attRate, avg, subScores, trend, monthly, subCount, asgCount, completion, days, recentIncidents, submittedAsgIds };
  }, [attendance, testScores, submissions, assignments, incidents]);

  // No-data guard: a brand-new student should show "NO DATA", not "CRITICAL".
  const hasAnyData = testScores.length > 0 || attendance.length > 0 || incidents.length > 0;

  const overallRisk = hasAnyData
    ? Math.round((Math.max(0, 100 - m.attRate) + Math.max(0, 100 - m.avg) + Math.max(0, 100 - m.completion) + Math.min(100, m.recentIncidents * 25)) / 4)
    : 0;
  const riskLevel = !hasAnyData ? "NO DATA"
    : overallRisk < 20 ? "STABLE"
    : overallRisk < 45 ? "MONITOR"
    : overallRisk < 70 ? "ELEVATED"
    : "CRITICAL";
  const riskColor = !hasAnyData ? T.ink3
    : overallRisk < 20 ? T.grn
    : overallRisk < 45 ? T.amb
    : T.red;

  // Sort subjects by average descending — deterministic display order.
  const subEntries = useMemo(
    () => Object.entries(m.subScores).sort((a, b) => b[1] - a[1]),
    [m.subScores]
  );
  const radarData = subEntries.slice(0, 8).map(([sub, sc]) => ({ subject: sub.slice(0, 10), score: sc, fullMark: 100 }));

  // ── Sorted recency lists — Firestore returns docs in arbitrary order, so EVERY
  // "recent X" view must sort by createdAt desc before slicing. Without these
  // memos, "Recent Messages" / "Recent Incidents" cards display arbitrary docs
  // (could be 6 months old). Trust killer.
  const sortedIncidents = useMemo(() => [...incidents].sort(cmpDescTime), [incidents]);
  const sortedParentNotes = useMemo(() => [...parentNotes].sort(cmpDescTime), [parentNotes]);
  const sortedInterventions = useMemo(() => [...interventions].sort(cmpDescTime), [interventions]);

  // Calendar lookup map — replaces O(days × attendance) per-cell .find() with O(1) get.
  const attendanceMap = useMemo(() => {
    const map = new Map<string, string>();
    attendance.forEach((a: any) => {
      const key = typeof a.date === "string" ? a.date : istKey(toDate(a.date));
      if (key) map.set(key, String(a.status || ""));
    });
    return map;
  }, [attendance]);

  // Assignment ordering: unsubmitted first (urgent to parent), then by due date
  // ascending so most-imminent appears at top.
  const sortedAssignments = useMemo(() => {
    return [...assignments].sort((a: any, b: any) => {
      const aSub = m.submittedAsgIds.has(a.id);
      const bSub = m.submittedAsgIds.has(b.id);
      if (aSub !== bSub) return aSub ? 1 : -1;
      const aDue = toDate(a.dueDate)?.getTime() ?? Number.POSITIVE_INFINITY;
      const bDue = toDate(b.dueDate)?.getTime() ?? Number.POSITIVE_INFINITY;
      return aDue - bDue;
    });
  }, [assignments, m.submittedAsgIds]);

  const calYear = calMonth.getFullYear();
  const calMon = calMonth.getMonth();
  const firstDay = new Date(calYear, calMon, 1).getDay();
  const daysInMonth = new Date(calYear, calMon + 1, 0).getDate();
  const calDays = Array.from({ length: 42 }, (_, i) => {
    const dayNum = i - firstDay + 1;
    if (dayNum < 1 || dayNum > daysInMonth) return null;
    const d = new Date(calYear, calMon, dayNum);
    const dateStr = istKey(d);
    return { dayNum, date: d, status: attendanceMap.get(dateStr) || null };
  });
  const calPresent = attendance.filter(a => { const d = toDate(a.date); return d && d.getMonth() === calMon && d.getFullYear() === calYear && a.status === "present"; }).length;
  const calLate = attendance.filter(a => { const d = toDate(a.date); return d && d.getMonth() === calMon && d.getFullYear() === calYear && a.status === "late"; }).length;
  const calAbsent = attendance.filter(a => { const d = toDate(a.date); return d && d.getMonth() === calMon && d.getFullYear() === calYear && a.status === "absent"; }).length;

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 10 }}>
      <Loader2 className="animate-spin" size={20} color={T.blue} /><span style={{ fontSize: 13, color: T.ink3 }}>Loading your child's profile...</span>
    </div>
  );
  if (!student || !sid) return (
    <div style={{ textAlign: "center", padding: 64 }}>
      <AlertCircle size={40} color={T.red} style={{ margin: "0 auto 12px" }} />
      <p style={{ fontSize: 16, fontWeight: 600, color: T.ink }}>No child profile linked to this account.</p>
    </div>
  );

  const sName = student.name || student.studentName || "My Child";
  const initials = sName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
  const today = new Date();

  const scoreHistory = [...testScores]
    .sort((a, b) => (scoreDateOf(b)?.getTime() || 0) - (scoreDateOf(a)?.getTime() || 0))
    .slice(0, 6);
  const barChartData = [...scoreHistory].reverse().map(t => ({
    name: String(t.subject || t.subjectName || "TEST").slice(0, 8),
    score: pctOf(t),
  }));

  // Predicted next score — deterministic forecast based on recent trend.
  const forecast = m.avg > 0
    ? Math.min(100, Math.round(m.avg + (m.trend === "up" ? 3 : m.trend === "down" ? -3 : 0)))
    : 0;

  return (
    <div style={{ minHeight: "100vh", background: T.bg, padding: isMobile ? "12px 12px 60px" : "20px 24px 60px", fontFamily: "'Inter','Plus Jakarta Sans',-apple-system,sans-serif" }}>

      {/* Print stylesheet — hide page chrome (top bar, status bar, action buttons)
          when the parent uses the browser's Print/Save-as-PDF flow. */}
      <style>{`
        @media print {
          .my-child-no-print { display: none !important; }
          body { background: #ffffff !important; }
        }
      `}</style>

      {/* ═══ TOP BAR ══════════════════════════════════════════════════════════ */}
      <div className="my-child-no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isMobile ? 14 : 24, gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => navigate("/")} style={{ display: "flex", alignItems: "center", gap: 6, padding: isMobile ? "7px 12px" : "8px 16px", borderRadius: 10, border: `1px solid ${T.bdr}`, background: T.white, color: T.ink2, fontSize: isMobile ? 12 : 13, fontWeight: 500, cursor: "pointer", flexShrink: 0 }}>
          <ArrowLeft size={14} /> {isMobile ? "BACK" : "RETURN"}
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => window.print()} style={{ display: "flex", alignItems: "center", gap: 6, padding: isMobile ? "7px 12px" : "8px 16px", borderRadius: 10, border: `1px solid ${T.bdr}`, background: T.white, color: T.ink2, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
            <Printer size={13} /> {isMobile ? "PDF" : "EXPORT"}
          </button>
          <button onClick={() => navigate("/teacher-notes")} style={{ display: "flex", alignItems: "center", gap: 6, padding: isMobile ? "7px 12px" : "8px 16px", borderRadius: 10, border: "none", background: T.blue, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <MessageSquare size={13} /> {isMobile ? "MSG" : "CONTACT"}
          </button>
        </div>
      </div>

      {/* ═══ HERO: 3-COLUMN (mobile: stacked, profile first) ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 280px 1fr", gap: isMobile ? 14 : 20, marginBottom: isMobile ? 14 : 20 }}>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* ─── Academic Performance — summary view (avg + trend + recent tests). */}
          <Card title="Academic Performance" action={<DetailLink to="/performance" />}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
              <div style={{ position: "relative", width: 72, height: 72 }}>
                <svg width="72" height="72" viewBox="0 0 72 72">
                  <circle cx="36" cy="36" r="28" fill="none" stroke={T.s2} strokeWidth="6" />
                  <circle cx="36" cy="36" r="28" fill="none" stroke={T.blue} strokeWidth="6" strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 28} strokeDashoffset={2 * Math.PI * 28 * (1 - m.avg / 100)} transform="rotate(-90 36 36)"
                    style={{ transition: "stroke-dashoffset 1s ease" }} />
                </svg>
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: T.blue }}>
                  {m.avg > 0 ? (m.avg / 10).toFixed(1) : "—"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, color: T.ink }}>
                  {m.avg > 0 ? `${Math.round(m.avg)}%` : "—"}
                </div>
                <div style={{ fontSize: 11, color: T.ink3, display: "flex", alignItems: "center", gap: 4 }}>
                  Avg · {testScores.length} {testScores.length === 1 ? "record" : "records"}
                  {m.trend === "up" && <TrendingUp size={12} color={T.grn} />}
                  {m.trend === "down" && <TrendingUp size={12} color={T.red} style={{ transform: "scaleY(-1)" }} />}
                </div>
              </div>
            </div>

            {/* Last 3 test chips — real recent scores. */}
            {scoreHistory.length === 0 ? (
              <p style={{ fontSize: 11, color: T.ink3, textAlign: "center", padding: "8px 0" }}>No test records yet</p>
            ) : (
              <>
                <div style={{ fontSize: 10, fontWeight: 600, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Most recent</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {scoreHistory.slice(0, 3).map(t => {
                    const p = pctOf(t);
                    const dt = scoreDateOf(t);
                    return (
                      <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: T.s1, borderRadius: 8 }}>
                        <span style={{ fontSize: 11, color: T.ink, flex: 1 }}>{String(t.subject || t.subjectName || "Test").slice(0, 24)}</span>
                        <span style={{ fontSize: 10, color: T.ink3 }}>{dt ? dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: p >= 75 ? T.blue : p >= 50 ? T.amb : T.red, minWidth: 36, textAlign: "right" }}>{p > 0 ? `${p}%` : "—"}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </Card>

          <Card title="Attendance" action={<DetailLink to="/attendance" />}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ position: "relative", width: 72, height: 72 }}>
                <svg width="72" height="72" viewBox="0 0 72 72">
                  <circle cx="36" cy="36" r="28" fill="none" stroke={T.s2} strokeWidth="7" />
                  <circle cx="36" cy="36" r="28" fill="none"
                    stroke={m.attRate >= 85 ? T.grn : m.attRate >= 70 ? T.amb : T.red}
                    strokeWidth="7" strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 28} strokeDashoffset={2 * Math.PI * 28 * (1 - m.attRate / 100)}
                    transform="rotate(-90 36 36)" style={{ transition: "stroke-dashoffset 1s ease" }} />
                </svg>
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: m.attRate >= 85 ? T.grn : T.amb }}>
                  {m.tot > 0 ? `${Math.round(m.attRate)}%` : "—"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: T.ink }}>Present</div>
                <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>Late: {m.late} · Abs: {m.abs}</div>
                <div style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>{m.tot > 0 ? `${m.pres + m.late} / ${m.tot} days` : "No attendance marked yet"}</div>
              </div>
            </div>
          </Card>

          <Card title="Subject Mastery" action={<DetailLink to="/performance" />}>
            {subEntries.length === 0 ? (
              <p style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "16px 0" }}>No subject scores yet</p>
            ) : (
              <>
                {radarData.length >= 3 && (
                  <div style={{ marginBottom: 12 }}>
                    <SubjectMasteryRadar data={radarData} color={T.blue} height={200} />
                  </div>
                )}
                {subEntries.slice(0, 8).map(([sub, sc]) => (
                  <div key={sub} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: T.ink3, width: 90, flexShrink: 0 }}>{sub}</span>
                    <div style={{ flex: 1, height: 6, background: T.s1, borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${sc}%`, background: sc >= 75 ? T.blue : sc >= 50 ? T.grn : T.red, borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: T.ink, width: 28, textAlign: "right" }}>{sc}</span>
                  </div>
                ))}
                {subEntries.length > 8 && (
                  <div style={{ fontSize: 10, color: T.ink3, textAlign: "center", marginTop: 4 }}>+ {subEntries.length - 8} more subjects</div>
                )}
              </>
            )}
          </Card>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: isMobile ? 16 : 20, order: isMobile ? -1 : 0, padding: isMobile ? "20px 16px 18px" : undefined, background: isMobile ? T.white : "transparent", borderRadius: isMobile ? 16 : 0, border: isMobile ? `1px solid ${T.bdr}` : "none" }}>
          <div style={{ width: isMobile ? 110 : 140, height: isMobile ? 110 : 140, borderRadius: "50%", border: `4px solid ${T.blue}`, background: T.blBg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: isMobile ? 12 : 16, boxShadow: "0 8px 30px rgba(59,91,219,0.15)" }}>
            <span style={{ fontSize: 42, fontWeight: 800, color: T.blue }}>{initials}</span>
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: T.ink, textAlign: "center", marginBottom: 4 }}>{sName}</h2>
          <p style={{ fontSize: 12, color: T.ink3, textAlign: "center", marginBottom: 4 }}>{student.className || student.class || "—"}</p>
          <p style={{ fontSize: 11, color: T.ink3, textAlign: "center", marginBottom: 12 }}>Roll: {student.rollNo || student.roll || "—"} · ID: {sid.slice(0, 6).toUpperCase()}</p>
          <div style={{ display: "flex", gap: 6 }}>
            <span style={{ padding: "4px 12px", borderRadius: 20, background: T.glBg, color: T.grn, fontSize: 10, fontWeight: 600 }}>ACTIVE</span>
            <span style={{ padding: "4px 12px", borderRadius: 20, background: riskColor === T.grn ? T.glBg : riskColor === T.amb ? T.alBg : riskColor === T.red ? T.rlBg : T.s1, color: riskColor, fontSize: 10, fontWeight: 600 }}>{riskLevel}</span>
          </div>
          {/* Edit Profile removed — student master data (DOB, blood, contacts) is
              owned by the school. Parent updates flow through the school office,
              not this dashboard. Firestore rules also block parent self-edit. */}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="Behaviour Record" action={<DetailLink to="/behaviour" />}>
            {sortedIncidents.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: T.glBg, borderRadius: 10 }}>
                <CheckCircle2 size={14} color={T.grn} /><span style={{ fontSize: 12, color: T.grn, fontWeight: 500 }}>No incidents recorded</span>
              </div>
            ) : sortedIncidents.slice(0, 3).map(inc => {
              const tone = severityTone(inc.severity);
              return (
                <div key={inc.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 0", borderBottom: `1px solid ${T.s2}` }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: tone, marginTop: 5, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: tone }}>{String(inc.type || "Incident").toUpperCase()}</span>
                    <p style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>{String(inc.description || inc.content || "").slice(0, 80)}</p>
                  </div>
                  <span style={{ fontSize: 10, color: T.ink3, flexShrink: 0 }}>{timeAgo(inc.createdAt || inc.date)}</span>
                </div>
              );
            })}
          </Card>

          <Card title="Performance Forecast" action={<DetailLink to="/performance" />}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: T.ink3 }}>Predicted next score:</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: T.blue }}>{forecast > 0 ? `${forecast}%` : "—"}</span>
            </div>
            <div style={{ fontSize: 11, color: T.ink3, lineHeight: 1.6 }}>
              {!hasAnyData ? "Not enough data yet. Forecast becomes available after the first few records." :
               m.trend === "up" ? "Performance is improving. Your child is on a positive trajectory." :
               m.trend === "down" ? "Performance has dipped recently. Consider checking in with teachers." :
               "Performance is stable. Keep up consistent study habits."}
            </div>
          </Card>

          <Card title="Teacher Messages" action={<DetailLink to="/teacher-notes" />}>
            {sortedParentNotes.length === 0 ? (
              <p style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "8px 0" }}>No messages yet</p>
            ) : sortedParentNotes.slice(0, 3).map(n => (
              <div key={n.id} style={{ padding: "8px 0", borderBottom: `1px solid ${T.s2}` }}>
                <div style={{ fontSize: 10, color: n.from === "teacher" ? T.blue : T.grn, fontWeight: 600, marginBottom: 2 }}>
                  {n.from === "teacher" ? (n.teacherName || "TEACHER") : "YOU"} · {timeAgo(n.createdAt)}
                </div>
                <p style={{ fontSize: 12, color: T.ink2, lineHeight: 1.5, margin: 0 }}>{String(n.content || n.message || "").slice(0, 100)}</p>
              </div>
            ))}
          </Card>
          {/* Teacher Observations card removed — was duplicating Teacher Messages
              with no separate data source. Communications card below has the
              full thread. */}
        </div>
      </div>

      {/* ═══ PERFORMANCE TIMELINE ═══ */}
      <Card title="Performance Timeline" action={<DetailLink to="/performance" />} style={{ marginBottom: isMobile ? 14 : 20 }}>
        <div style={{ height: isMobile ? 160 : 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={m.monthly}>
              <defs>
                <linearGradient id="pBlGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={T.blue} stopOpacity={0.15} /><stop offset="95%" stopColor={T.blue} stopOpacity={0} /></linearGradient>
                <linearGradient id="pGnGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={T.grn} stopOpacity={0.15} /><stop offset="95%" stopColor={T.grn} stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={T.s2} />
              <XAxis dataKey="month" tick={{ fill: T.ink3, fontSize: 11 }} axisLine={{ stroke: T.s2 }} />
              <YAxis tick={{ fill: T.ink3, fontSize: 11 }} axisLine={{ stroke: T.s2 }} domain={[0, 100]} />
              <Tooltip contentStyle={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="score" stroke={T.blue} fill="url(#pBlGrad)" strokeWidth={2.5} />
              <Area type="monotone" dataKey="attendance" stroke={T.grn} fill="url(#pGnGrad)" strokeWidth={2} strokeDasharray="5 3" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ═══ ASSIGNMENTS + RISK ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 20, marginBottom: isMobile ? 14 : 20 }}>
        <Card title={`Assignments · ${m.subCount}/${m.asgCount}`} action={<DetailLink to="/assignments" />}>
          {sortedAssignments.length === 0 ? (
            <p style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "16px 0" }}>No assignments yet</p>
          ) : sortedAssignments.slice(0, 5).map(a => {
            const submitted = m.submittedAsgIds.has(a.id);
            const due = dueChipFor(a);
            return (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderBottom: `1px solid ${T.s2}` }}>
                <CheckCircle2 size={16} color={submitted ? T.grn : T.ink3} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.3 }}>{String(a.title || "Assignment").slice(0, 40)}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                    {a.subject && <span style={{ fontSize: 10, color: T.ink3 }}>{String(a.subject).slice(0, 18)}</span>}
                    {!submitted && due && (
                      <span style={{ padding: "1px 7px", borderRadius: 4, background: due.bg, color: due.color, fontSize: 9, fontWeight: 600, letterSpacing: "0.02em" }}>
                        {due.label.toUpperCase()}
                      </span>
                    )}
                    {submitted && (
                      <span style={{ padding: "1px 7px", borderRadius: 4, background: T.glBg, color: T.grn, fontSize: 9, fontWeight: 600, letterSpacing: "0.02em" }}>SUBMITTED</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </Card>

        <Card title="Risk Assessment" action={<DetailLink to="/alerts" />}>
          <div style={{ fontSize: 22, fontWeight: 800, color: riskColor, marginBottom: 14 }}>{riskLevel}</div>
          {!hasAnyData ? (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", background: T.s1, borderRadius: 10 }}>
              <AlertTriangle size={16} color={T.ink3} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12, color: T.ink2, lineHeight: 1.5 }}>
                Risk tracking activates after the first records are entered. Once attendance is marked or a test is scored, this card will reflect your child's status.
              </div>
            </div>
          ) : (
            [
              { label: "ATTENDANCE", val: m.attRate, color: m.attRate >= 85 ? T.blue : T.amb, extra: undefined as string | undefined },
              { label: "ACADEMIC", val: m.avg, color: m.avg >= 75 ? T.blue : m.avg >= 50 ? T.amb : T.red, extra: undefined },
              { label: "SUBMISSION", val: m.completion, color: m.completion >= 80 ? T.blue : T.amb, extra: undefined },
              { label: "BEHAVIOURAL", val: m.recentIncidents > 0 ? -1 : 100, color: m.recentIncidents === 0 ? T.blue : T.red, extra: m.recentIncidents > 0 ? `${m.recentIncidents} recent` : undefined },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: T.ink3, width: 100, flexShrink: 0 }}>{r.label}</span>
                <div style={{ flex: 1, height: 6, background: T.s1, borderRadius: 3, overflow: "hidden" }}>
                  {r.val >= 0 && <div style={{ height: "100%", width: `${r.val}%`, background: r.color, borderRadius: 3, transition: "width 1s" }} />}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: r.color, width: 60, textAlign: "right" }}>{r.extra || `${Math.round(r.val >= 0 ? r.val : 0)}%`}</span>
              </div>
            ))
          )}
        </Card>
      </div>

      {/* ═══ CALENDAR + SUPPORT ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 20, marginBottom: isMobile ? 14 : 20 }}>
        <Card title="Attendance Calendar" action={<DetailLink to="/attendance" />}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 14 }}>
            <button onClick={() => setCalMonth(new Date(calYear, calMon - 1))} style={{ background: "none", border: "none", cursor: "pointer", color: T.ink3 }}><ChevronLeft size={16} /></button>
            <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{MONTHS[calMon]} {calYear}</span>
            <button onClick={() => setCalMonth(new Date(calYear, calMon + 1))} style={{ background: "none", border: "none", cursor: "pointer", color: T.ink3 }}><ChevronRight size={16} /></button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
            <div style={{ textAlign: "center", padding: "10px 0", background: T.glBg, borderRadius: 10 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: T.grn }}>{calPresent}</div><div style={{ fontSize: 10, color: T.grn }}>PRESENT</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 0", background: T.alBg, borderRadius: 10 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: T.amb }}>{calLate}</div><div style={{ fontSize: 10, color: T.amb }}>LATE</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 0", background: T.rlBg, borderRadius: 10 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: T.red }}>{calAbsent}</div><div style={{ fontSize: 10, color: T.red }}>ABSENT</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, textAlign: "center" }}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
              <div key={d} style={{ fontSize: 10, fontWeight: 600, color: T.ink3, padding: "4px 0" }}>{d}</div>
            ))}
            {calDays.map((d, i) => {
              if (!d) return <div key={i} />;
              const isToday = d.date.toDateString() === today.toDateString();
              const isWknd = d.date.getDay() === 0 || d.date.getDay() === 6;
              // "Not marked" = past weekday, teacher didn't take attendance.
              // Distinct from "absent" (red — student was actually absent).
              // Honest visual signal so parent doesn't blame the student when
              // no roll-call happened.
              const isPastWeekday = !isWknd && d.date.getTime() < today.getTime();
              const isUnmarked = !d.status && isPastWeekday && !isToday;
              const bg =
                d.status === "present" ? T.grn :
                d.status === "late" ? T.amb :
                d.status === "absent" ? T.red :
                isUnmarked ? T.s3 :
                "transparent";
              const fontColor = d.status
                ? "#fff"
                : isUnmarked ? T.ink2
                : isWknd ? T.ink3
                : T.ink;
              return (
                <div key={i} style={{
                  width: 32, height: 32, borderRadius: isToday ? "50%" : 8, margin: "0 auto",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: isToday ? 700 : 400,
                  color: fontColor,
                  background: isToday && !d.status ? T.blue : bg,
                  border: isUnmarked ? `0.5px solid ${T.s2}` : "none",
                }}>
                  {d.dayNum}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: isMobile ? 10 : 14, marginTop: 12, justifyContent: "center", flexWrap: "wrap", rowGap: 8 }}>
            {[
              { c: T.grn, l: "Present" },
              { c: T.amb, l: "Late" },
              { c: T.red, l: "Absent" },
              { c: T.s2, l: "Weekend" },
              { c: T.s3, l: "Not marked" },
            ].map(x => (
              <div key={x.l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: x.c, border: `1px solid ${T.s2}` }} />
                <span style={{ fontSize: 10, color: T.ink3 }}>{x.l}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Support Actions" action={<DetailLink to="/alerts" />}>
          {sortedInterventions.length === 0 ? (
            <p style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "20px 0" }}>No active interventions</p>
          ) : sortedInterventions.map(iv => {
            const isDone = String(iv.status || "").toLowerCase() === "completed";
            return (
              <div key={iv.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 0", borderBottom: `1px solid ${T.s2}` }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: isDone ? T.grn : T.amb, marginTop: 5, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: T.ink3, marginBottom: 2 }}>{timeAgo(iv.createdAt || iv.date)}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{iv.actionTitle || iv.title || "Intervention"}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    {(iv.actionType || iv.type) && (
                      <span style={{ padding: "2px 8px", borderRadius: 4, background: T.blBg, color: T.blue, fontSize: 10, fontWeight: 600 }}>{String(iv.actionType || iv.type).toUpperCase()}</span>
                    )}
                    <span style={{ padding: "2px 8px", borderRadius: 4, background: isDone ? T.glBg : T.alBg, color: isDone ? T.grn : T.amb, fontSize: 10, fontWeight: 600 }}>{isDone ? "Complete" : (iv.status || "Active")}</span>
                  </div>
                </div>
                <span style={{ fontSize: 10, color: T.ink3, flexShrink: 0 }}>{iv.assignedTo || ""}</span>
              </div>
            );
          })}
        </Card>
      </div>

      {/* ═══ INCIDENTS + OVERVIEW ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 20, marginBottom: isMobile ? 14 : 20 }}>
        <Card title="Incidents" action={<DetailLink to="/behaviour" />}>
          {sortedIncidents.length === 0 ? (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <CheckCircle2 size={24} color={T.grn} style={{ margin: "0 auto 8px" }} />
              <p style={{ fontSize: 12, color: T.grn, fontWeight: 500 }}>No incidents on record</p>
            </div>
          ) : sortedIncidents.map(inc => {
            const tone = severityTone(inc.severity);
            return (
              <div key={inc.id} style={{ padding: "10px 0", borderBottom: `1px solid ${T.s2}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: tone }}>• {String(inc.type || "Incident").toUpperCase()}</span>
                  <span style={{ fontSize: 10, color: T.ink3 }}>{timeAgo(inc.createdAt || inc.date)}</span>
                </div>
                <p style={{ fontSize: 11, color: T.ink2, marginTop: 4, lineHeight: 1.5 }}>{String(inc.description || inc.content || "").slice(0, 120)}</p>
              </div>
            );
          })}
          {sortedIncidents.length > 0 && (
            <div style={{ textAlign: "center", padding: "10px 0", marginTop: 8, background: T.rlBg, borderRadius: 8 }}>
              <span style={{ fontSize: 11, color: T.red, fontWeight: 500 }}>Total: {sortedIncidents.length} incident{sortedIncidents.length > 1 ? "s" : ""} recorded</span>
            </div>
          )}
        </Card>

        <Card title="Overview" action={<DetailLink to="/" />}>
          {[
            { icon: FileText, label: "TOTAL TESTS", val: testScores.length },
            { icon: BookOpen, label: "SUBJECTS TRACKED", val: subEntries.length },
            { icon: CalIcon, label: "DAYS ON RECORD", val: m.days },
            { icon: Activity, label: "AVG ATTENDANCE", val: m.tot > 0 ? `${Math.round(m.attRate)}%` : "—" },
            { icon: BarChart3, label: "ASSIGNMENT RATE", val: m.asgCount > 0 ? `${Math.round(m.completion)}%` : "—" },
            { icon: MessageSquare, label: "TEACHER MESSAGES", val: parentNotes.length },
          ].map(item => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${T.s2}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <item.icon size={14} color={T.ink3} />
                <span style={{ fontSize: 12, color: T.ink3 }}>{item.label}</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{item.val}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* ═══ COMMS + SCORE HISTORY ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 20, marginBottom: isMobile ? 14 : 20 }}>
        <Card title={`Communications · ${sortedParentNotes.length} entries`} action={<DetailLink to="/teacher-notes" />}>
          {sortedParentNotes.length === 0 ? (
            <p style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "16px 0" }}>No communications</p>
          ) : sortedParentNotes.slice(0, 3).map(n => (
            <div key={n.id} style={{ padding: "12px 0", borderBottom: `1px solid ${T.s2}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{n.from === "teacher" ? (n.teacherName || "TEACHER") : "YOU"}</span>
                <span style={{ padding: "2px 8px", borderRadius: 4, background: n.from === "teacher" ? T.blBg : T.glBg, color: n.from === "teacher" ? T.blue : T.grn, fontSize: 10, fontWeight: 600 }}>{n.from === "teacher" ? "FACULTY" : "PARENT"}</span>
                <span style={{ fontSize: 10, color: T.ink3, marginLeft: "auto" }}>{timeAgo(n.createdAt)}</span>
              </div>
              <p style={{ fontSize: 12, color: T.ink2, lineHeight: 1.5, margin: 0 }}>{String(n.content || n.message || "").slice(0, 120)}</p>
            </div>
          ))}
        </Card>

        <Card title={`Score History · ${testScores.length} records`} action={<DetailLink to="/tests" />}>
          {barChartData.length > 0 && (
            <div style={{ height: 150, marginBottom: 12 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.s2} />
                  <XAxis dataKey="name" tick={{ fill: T.ink3, fontSize: 9 }} axisLine={{ stroke: T.s2 }} />
                  <YAxis tick={{ fill: T.ink3, fontSize: 9 }} axisLine={{ stroke: T.s2 }} domain={[0, 100]} />
                  <Tooltip contentStyle={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 8, fontSize: 11 }} />
                  <Bar dataKey="score" fill={T.blue} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 280 }}>
            <thead>
              <tr>{["SUBJECT", "DATE", "SCORE"].map(h => <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, color: T.ink3, fontWeight: 600, borderBottom: `1px solid ${T.s2}` }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {scoreHistory.length === 0 ? (
                <tr><td colSpan={3} style={{ padding: "16px 8px", textAlign: "center", color: T.ink3, fontSize: 12 }}>No test records yet</td></tr>
              ) : scoreHistory.map(t => {
                const d = scoreDateOf(t);
                const p = pctOf(t);
                return (
                  <tr key={t.id} style={{ borderBottom: `1px solid ${T.s2}` }}>
                    <td style={{ padding: "8px", color: T.ink }}>{String(t.subject || t.subjectName || "TEST").slice(0, 20)}</td>
                    <td style={{ padding: "8px", color: T.ink3 }}>{d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }).toUpperCase() : "—"}</td>
                    <td style={{ padding: "8px", fontWeight: 600, color: T.blue }}>{p > 0 ? `${p}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Card>
      </div>

      {/* ═══ BOTTOM STATUS BAR — honest counters only, no fabricated metrics ═══ */}
      <div className="my-child-no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: isMobile ? "10px 14px" : "10px 20px", background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 12, fontSize: 10, color: T.ink3, flexWrap: "wrap", gap: isMobile ? 8 : 0, rowGap: 6 }}>
        <span>★ {parentNotes.length} message{parentNotes.length === 1 ? "" : "s"}</span>
        {!isMobile && <span>★ {testScores.length} test record{testScores.length === 1 ? "" : "s"}</span>}
        {!isMobile && <span>★ Live data</span>}
        <span>★ Secured</span>
        <span>★ ID: {sid.slice(0, 8).toUpperCase()}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Clock size={11} color={T.blue} />
          <LiveClock />
        </span>
      </div>
    </div>
  );
};

export default MyChildPage;
