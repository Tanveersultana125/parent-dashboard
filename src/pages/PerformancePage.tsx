import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUp, ArrowDown, Minus, Loader2,
  Calculator, FlaskConical, Languages, Globe, Monitor, Palette, BookOpen,
  Sparkles, Target, Trophy
} from "lucide-react";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";
import { SubjectPerformanceDetail } from "@/components/performance/SubjectPerformanceDetail";
import { useAuth } from "@/lib/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, getDocs } from "firebase/firestore";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  generatePerformanceNarrative,
  getGoalInsight,
  getBenchmarkTier,
} from "@/ai/system/performance-insights";

const getSubIcon = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes("math")) return Calculator;
  if (n.includes("science")) return FlaskConical;
  if (n.includes("english")) return Languages;
  if (n.includes("social")) return Globe;
  if (n.includes("computer")) return Monitor;
  if (n.includes("art")) return Palette;
  return BookOpen;
};

const CHART_COLORS = ["#1e3a8a", "#10b981", "#f59e0b", "#6366f1", "#ef4444", "#06b6d4"];

const PerformancePage = () => {
  const { studentData } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [trendData, setTrendData] = useState<any[]>([]);
  const [overallStats, setOverallStats] = useState({ grade: "N/A", avg: 0, trend: "+8%" });
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  const [goalSubject, setGoalSubject] = useState<string>("");
  const [goalTarget, setGoalTarget] = useState<number>(80);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    if (!studentData?.id) return;
    setLoading(true);
    let snap1Cache: any = null, snap2Cache: any = null, snap3Cache: any = null;

    // Normalize any score doc to a percentage value
    const getPct = (s: any): number => {
      if (s.percentage != null && !isNaN(Number(s.percentage))) return Number(s.percentage);
      if (s.mark != null && s.maxMarks) return (s.mark / s.maxMarks) * 100;
      if (s.score != null && s.maxScore) return (s.score / s.maxScore) * 100;
      if (s.score != null && !isNaN(Number(s.score))) return Number(s.score);
      return 0;
    };

    // Normalize any date-like value (Firestore Timestamp, seconds, ISO string, number)
    // into a JS Date. Hoisted to the top of processScores because the sort on
    // line below used to reference this before its declaration, which put the
    // const in its TDZ and would ReferenceError as soon as scores.length >= 2.
    const toSafeDate = (v: any): Date => {
      if (v?.toDate) return v.toDate();
      if (v?.seconds) return new Date(v.seconds * 1000);
      if (typeof v === "string" || typeof v === "number") { const d = new Date(v); if (!isNaN(d.getTime())) return d; }
      return new Date();
    };

    const processScores = () => {
      if (!mountedRef.current) return;
      const scoreMap = new Map();
      // Merge all 3 sources: test_scores + results + gradebook_scores
      [...(snap1Cache?.docs || []), ...(snap2Cache?.docs || []), ...(snap3Cache?.docs || [])].forEach((d: any) => {
        if (!scoreMap.has(d.id)) {
          const data = d.data();
          scoreMap.set(d.id, {
            id: d.id, ...data,
            // Normalize percentage field for all sources
            percentage: getPct(data),
          });
        }
      });
      const scores = Array.from(scoreMap.values()).filter(s => s.percentage > 0);

      const subMap = new Map();
      scores.forEach(s => {
        const sub = s.subject || s.subjectName || s.testName || s.columnName || "General";
        if (!subMap.has(sub)) subMap.set(sub, { name: sub, total: 0, count: 0, scores: [] });
        const curr = subMap.get(sub);
        curr.total += s.percentage;
        curr.count += 1;
        curr.scores.push(s);
      });

      const derivedSubjs = Array.from(subMap.values()).map(s => {
        const avg = Math.round(s.total / s.count);
        const sorted = s.scores.sort((a: any, b: any) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
        const last = sorted[sorted.length - 1]?.percentage || 0;
        const prev = sorted[sorted.length - 2]?.percentage || last;
        const trendDir = last > prev ? "up" : last < prev ? "down" : "stable";
        const status = avg >= 90 ? "Outstanding" : avg >= 80 ? "Excellent" : avg >= 70 ? "Improving" : avg >= 60 ? "Stable" : "Needs Attention";
        const barColor = avg >= 75 ? "bg-emerald-500" : avg >= 60 ? "bg-amber-500" : "bg-rose-500";
        const grade = avg >= 90 ? "A+" : avg >= 85 ? "A" : avg >= 80 ? "A-" : avg >= 75 ? "B+" : avg >= 70 ? "B" : avg >= 65 ? "C+" : "C";
        return { name: s.name, grade, progress: avg, status, trendDir, barColor, raw: s.scores };
      });

      setSubjects(derivedSubjs);
      if (derivedSubjs.length > 0) {
        const globalAvg = Math.round(derivedSubjs.reduce((a, b) => a + b.progress, 0) / derivedSubjs.length);
        // Calculate real trend from recent vs older scores
        const allSorted = scores.sort((a: any, b: any) => {
          const da = toSafeDate(a.timestamp || a.createdAt || a.date).getTime();
          const db2 = toSafeDate(b.timestamp || b.createdAt || b.date).getTime();
          return db2 - da;
        });
        const recent = allSorted.slice(0, Math.ceil(allSorted.length / 2));
        const older = allSorted.slice(Math.ceil(allSorted.length / 2));
        const recentAvg = recent.length > 0 ? recent.reduce((a: number, s: any) => a + s.percentage, 0) / recent.length : globalAvg;
        const olderAvg = older.length > 0 ? older.reduce((a: number, s: any) => a + s.percentage, 0) / older.length : globalAvg;
        const trendDiff = Math.round(recentAvg - olderAvg);
        const trendStr = trendDiff >= 0 ? `+${trendDiff}%` : `${trendDiff}%`;
        setOverallStats({
          avg: globalAvg,
          grade: globalAvg >= 90 ? "A+" : globalAvg >= 85 ? "A" : globalAvg >= 80 ? "A-" : globalAvg >= 75 ? "B+" : globalAvg >= 70 ? "B" : "C",
          trend: trendStr
        });
      }

      // Trend chart — handle all date formats (toSafeDate hoisted above)
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const scoresByMonth = new Map<string, Map<string, { total: number; count: number }>>();
      scores.forEach(s => {
        const date = toSafeDate(s.timestamp || s.createdAt || s.date);
        const month = monthNames[date.getMonth()];
        const sub = s.subject || s.subjectName || s.testName || "General";
        if (!scoresByMonth.has(month)) scoresByMonth.set(month, new Map());
        const mm = scoresByMonth.get(month)!;
        if (!mm.has(sub)) mm.set(sub, { total: 0, count: 0 });
        const curr = mm.get(sub)!;
        curr.total += (parseFloat(s.percentage) || 0);
        curr.count += 1;
      });
      const currMonth = new Date().getMonth();
      const displayMonths = monthNames.slice(Math.max(0, currMonth - 3), currMonth + 1);
      const chartData = displayMonths.map(m => {
        const entry: any = { month: m };
        const mm = scoresByMonth.get(m);
        derivedSubjs.forEach(s => {
          const d = mm?.get(s.name);
          entry[s.name] = d ? Math.round(d.total / d.count) : null;
        });
        return entry;
      });
      setTrendData(chartData.filter(d => Object.keys(d).length > 1));
      setLoading(false);
    };

    const sid = studentData.id;
    const email = (studentData.email || studentData.studentEmail || "").toLowerCase();

    // Query helper — tries studentId first, no schoolId filter (avoids composite index issues)
    const byId = (col: string) => query(collection(db, col), where("studentId", "==", sid));
    const byEmail = (col: string) => email
      ? query(collection(db, col), where("studentEmail", "==", email))
      : null;

    // 1. test_scores — by studentId
    const u1 = onSnapshot(byId("test_scores"), s => { snap1Cache = s; processScores(); },
      () => { /* silent fail if index missing */ });

    // 2. results — by studentId (many schools store scores here instead)
    const u2r = onSnapshot(byId("results"), s => { snap2Cache = s; processScores(); },
      () => {});

    // 3. Also fetch by email if available (covers email-based enrollments)
    let u3r = () => {};
    const emailQ = byEmail("test_scores");
    if (emailQ) {
      u3r = onSnapshot(emailQ, s => {
        // Merge email-based scores into snap1Cache
        if (snap1Cache) {
          const existingIds = new Set(snap1Cache.docs.map((d: any) => d.id));
          const newDocs = s.docs.filter((d: any) => !existingIds.has(d.id));
          if (newDocs.length > 0) {
            snap1Cache = { docs: [...snap1Cache.docs, ...newDocs] };
            processScores();
          }
        } else {
          snap1Cache = s;
          processScores();
        }
      }, () => {});
    }

    // 4. gradebook_scores — fetch by classId (need enrollment first)
    //
    // CRITICAL: include schoolId in the server-side query. Previously the query
    // only filtered by classId, then filtered to the current student CLIENT-side.
    // That meant Firestore briefly returned every student's gradebook for the
    // class to the browser before the filter ran — a leak both for performance
    // and for security (an attacker reading the network response sees all
    // classmates' marks).
    let u4r = () => {};
    const fetchGradebook = async () => {
      try {
        const enrolSnap = await getDocs(byId("enrollments"));
        const classIds = [...new Set(enrolSnap.docs.map(d => d.data().classId).filter(Boolean))] as string[];
        if (classIds.length > 0) {
          const chunks: string[][] = [];
          for (let i = 0; i < classIds.length; i += 10) chunks.push(classIds.slice(i, i + 10));
          const buildGbQ = (ch: string[]) =>
            studentData?.schoolId
              ? query(
                  collection(db, "gradebook_scores"),
                  where("schoolId", "==", studentData.schoolId),
                  where("classId", "in", ch),
                  where("studentId", "==", sid),
                )
              : query(
                  collection(db, "gradebook_scores"),
                  where("classId", "in", ch),
                  where("studentId", "==", sid),
                );
          const gbSnaps = await Promise.all(chunks.map(ch => getDocs(buildGbQ(ch))));
          // Server already filtered to this student. Only keep email-fallback
          // for legacy gradebook rows that may have used studentEmail instead
          // of studentId.
          const studentGbDocs = gbSnaps.flatMap(s => s.docs);
          // Bail if component unmounted while gradebook was being fetched —
          // otherwise processScores calls setState on an unmounted component.
          if (!mountedRef.current) return;
          if (studentGbDocs.length > 0) {
            snap3Cache = { docs: studentGbDocs };
            processScores();
          }
        }
      } catch (e) {
        console.warn("[Performance] Gradebook fetch failed:", e);
      }
    };
    fetchGradebook();

    // 5. Feedback
    const u5 = onSnapshot(byId("performance_feedback"), snap => {
      if (!mountedRef.current) return;
      const feedMap = new Map(snap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
      setFeedbacks(Array.from(feedMap.values()));
    }, () => {});

    return () => { u1(); u2r(); u3r(); u4r(); u5(); };
  }, [studentData?.id]);

  // ── System-driven insight helpers (extracted to ai/system/performance-insights.ts) ──
  const studentName = studentData?.name?.split(" ")[0] || "Your child";

  const generateNarrative = () =>
    generatePerformanceNarrative({ studentName, subjects, overallAvg: overallStats.avg });
  // ────────────────────────────────────────────────────────────────────────────

  // Subject detail view
  if (selectedSubject) {
    const s = subjects.find(sub => sub.name === selectedSubject);
    if (!s) return null;

    const topicMasteryMap = new Map();
    s.raw.forEach((score: any) => {
      const topics = score.topics || [s.name];
      topics.forEach((t: string) => {
        if (!topicMasteryMap.has(t)) topicMasteryMap.set(t, { total: 0, count: 0 });
        const curr = topicMasteryMap.get(t);
        curr.total += (parseFloat(score.percentage) || 0);
        curr.count += 1;
      });
    });
    const processedTopics = Array.from(topicMasteryMap.entries())
      .map(([name, data]: any) => ({ name, score: data.count > 0 ? Math.round(data.total / data.count) : 0 }))
      .sort((a, b) => b.score - a.score);

    const subFeedback = feedbacks
      .filter(f => f.subject?.toLowerCase().includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(f.subject?.toLowerCase()))
      .sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0))[0]
      || feedbacks.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0))[0];

    const avg = overallStats.avg;
    const resources: any[] = [];
    if (processedTopics.length > 0) {
      processedTopics.filter(t => t.score < 85).slice(0, 2).forEach(t => {
        resources.push({ icon: "PlayCircle", title: `${t.name} Concept Clarity`, subtitle: "Targeted Tutorial • Video", action: "Watch", color: "text-blue-500 bg-blue-50", url: `https://www.youtube.com/results?search_query=${t.name.replace(/\s+/g, "+")}+tutorial` });
      });
    }
    if (avg < 60) resources.push({ icon: "PlayCircle", title: "Study Techniques for Better Grades", subtitle: "Study Skills • Memory Tips", action: "Watch", color: "text-rose-500 bg-rose-50", url: "https://www.youtube.com/results?search_query=best+study+techniques+for+students" });
    if (avg >= 90) resources.push({ icon: "Star", title: "Advanced Learning Resources", subtitle: "Beyond Curriculum • Excellence", action: "Watch", color: "text-indigo-500 bg-indigo-50", url: "https://www.youtube.com/results?search_query=advanced+learning+for+top+students" });
    if (resources.length === 0) resources.push({ icon: "Star", title: "Continuous Learning Guide", subtitle: "Growth Strategies • Success", action: "Watch", color: "text-indigo-500 bg-indigo-50", url: "https://www.youtube.com/results?search_query=self+improvement+habits+for+students" });

    return (
      <SubjectPerformanceDetail
        subject={s.name}
        // Honest "—" instead of a generic "Class Teacher" string when the
        // subject's teacher hasn't been resolved from Firestore.
        teacher={subFeedback?.teacherName || "—"}
        grade={s.grade}
        average={s.progress}
        // Only render synthesized "Overall" topic if there are no real topic
        // breakdowns AND we actually have a score to show — otherwise empty.
        topics={
          processedTopics.length > 0
            ? processedTopics
            : (s.progress > 0 ? [{ name: "Overall", score: s.progress }] : [])
        }
        testScores={s.raw.map((r: any) => {
          // Derive a denominator only when Firestore has a real maxScore;
          // never fake "/100" when the actual max could be 25, 50, etc.
          const max = Number(r.maxScore);
          const scoreLabel = Number.isFinite(max) && max > 0 ? `${r.score}/${max}` : `${r.score}`;
          return {
            name: r.testName || "Untitled assessment",
            date: r.timestamp
              ? new Date(r.timestamp.seconds * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
              : "—",
            score: scoreLabel,
            status: r.percentage >= 75 ? "success" : r.percentage >= 60 ? "warning" : "error",
          };
        })}
        // No fabricated "is progressing well" placeholder — when the teacher
        // hasn't written feedback, say so explicitly so the parent knows
        // there's nothing to read yet (and doesn't mistake it for real input).
        feedback={subFeedback?.content || "No teacher feedback recorded yet for this subject."}
        resources={resources.slice(0, 3)}
        onBack={() => setSelectedSubject(null)}
      />
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     MOBILE — Bright Blue Apple UI
     ═══════════════════════════════════════════════════════════════ */
  if (isMobile) {
    const B1 = "#0055FF", B2 = "#1166FF", B3 = "#2277FF", B4 = "#4499FF";
    const BG = "#EEF4FF", BG2 = "#E0ECFF";
    const T1 = "#001040", T2 = "#002080", T3 = "#5070B0", T4 = "#99AACC";
    const SEP = "rgba(0,85,255,0.07)";
    const GREEN = "#00C853", GREEN_S = "rgba(0,200,83,0.12)", GREEN_B = "rgba(0,200,83,0.25)";
    const RED = "#FF3355";
    const ORANGE = "#FF8800";
    const SH = "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.09), 0 10px 28px rgba(0,85,255,0.11)";
    const SH_LG = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 20px 48px rgba(0,85,255,0.14)";

    // ── Overall monthly avg line (single series) ──
    const overallTrend = trendData.map((row: any) => {
      const vals = Object.entries(row)
        .filter(([k, v]) => k !== "month" && typeof v === "number" && v > 0)
        .map(([, v]) => v as number);
      const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
      return { month: row.month, score: avg };
    }).filter((d: any) => d.score != null);

    // Trend pill color
    const trendNum = parseInt(overallStats.trend.replace(/[^0-9-]/g, ""), 10) || 0;
    const trendColor = trendNum > 0 ? GREEN : trendNum < 0 ? RED : "#008844";

    // Goal logic (same as desktop)
    const activeGoalSub = subjects.find(s => s.name === (goalSubject || subjects[0]?.name));
    const goalInsight = activeGoalSub ? getGoalInsight(activeGoalSub.progress, goalTarget, activeGoalSub.name) : null;
    const goalGap = activeGoalSub ? Math.max(0, goalTarget - activeGoalSub.progress) : 0;

    // Per-card blue-only accent rotation
    const unitAccents = [
      { icoBg: `linear-gradient(135deg, ${B1}, ${B3})`, icoShadow: "0 3px 10px rgba(0,85,255,0.28)" },
      { icoBg: "linear-gradient(135deg, #0044EE, #2277FF)", icoShadow: "0 3px 10px rgba(0,68,238,0.28)" },
      { icoBg: "linear-gradient(135deg, #002DBB, #0055FF)", icoShadow: "0 3px 10px rgba(0,45,187,0.28)" },
      { icoBg: "linear-gradient(135deg, #1155EE, #44AAFF)", icoShadow: "0 3px 10px rgba(17,85,238,0.28)" },
    ];

    return (
      <div className="animate-in fade-in duration-500 -mx-3 -mt-3 md:mx-0 md:mt-0"
        style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: BG, minHeight: "100vh" }}>

        {/* ── Page Head ── */}
        <div className="flex items-start justify-between px-[22px] pt-[18px]">
          <div>
            <div className="text-[24px] font-bold" style={{ color: T1, letterSpacing: "-0.6px" }}>Performance Analytics</div>
            <div className="text-[12px] mt-[3px] font-normal" style={{ color: T3 }}>Detailed breakdown of academic progress</div>
          </div>
          <div className="w-8 h-8 rounded-[10px] flex items-center justify-center text-[14px] font-bold text-white mt-0.5 shrink-0"
            style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 3px 10px rgba(0,85,255,0.32)" }}>
            {overallStats.grade}
          </div>
        </div>

        {/* ── Overall Performance ── */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Open reports page"
          onClick={() => navigate("/reports")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/reports"); } }}
          className="mx-5 mt-4 bg-white rounded-[24px] p-5 relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
          style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
          <div className="absolute -top-[50px] -right-[30px] w-[160px] h-[160px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(0,85,255,0.06) 0%, transparent 70%)" }} />
          <div className="text-[16px] font-bold relative z-10" style={{ color: T1, letterSpacing: "-0.3px", marginBottom: 3 }}>Overall Performance</div>
          <div className="text-[11px] mb-4 relative z-10" style={{ color: T3 }}>Based on all assessments this term</div>
          <div className="grid grid-cols-3 gap-[10px] relative z-10">
            <div className="flex flex-col items-center gap-[5px] px-3 py-[14px] rounded-[16px]"
              style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
              <div className="text-[22px] font-bold" style={{ color: B1, letterSpacing: "-0.5px" }}>{overallStats.grade}</div>
              <div className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: T4 }}>Grade</div>
            </div>
            <div className="flex flex-col items-center gap-[5px] px-3 py-[14px] rounded-[16px]"
              style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
              <div className="text-[22px] font-bold" style={{ color: T1, letterSpacing: "-0.5px" }}>{overallStats.avg > 0 ? `${overallStats.avg}%` : "—"}</div>
              <div className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: T4 }}>Average</div>
            </div>
            <div className="flex flex-col items-center gap-[5px] px-3 py-[14px] rounded-[16px]"
              style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
              <div className="text-[18px] font-bold" style={{ color: trendColor, letterSpacing: "-0.5px" }}>{overallStats.trend}</div>
              <div className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: T4 }}>Trend</div>
            </div>
          </div>
        </div>

        {/* ── Subject / Unit Cards ── */}
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-14" style={{ color: T4 }}>
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: B1 }} />
            <p className="text-sm">Loading performance data…</p>
          </div>
        ) : subjects.length === 0 ? (
          <div className="mx-5 mt-3 rounded-[22px] py-10 flex flex-col items-center text-center"
            style={{ background: "white", border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-3"
              style={{ background: BG2, border: "0.5px solid rgba(0,85,255,0.14)" }}>
              <BookOpen className="w-7 h-7" style={{ color: T4 }} />
            </div>
            <div className="text-[15px] font-bold" style={{ color: T2 }}>No assessments yet</div>
            <div className="text-[12px] mt-1" style={{ color: T4 }}>Scores will appear here once graded.</div>
          </div>
        ) : (
          subjects.map((s, i) => {
            const acc = unitAccents[i % unitAccents.length];
            const Icon = getSubIcon(s.name);
            const needsAttention = s.progress < 60;
            const fill = needsAttention
              ? `linear-gradient(90deg, ${RED}, #FF6688)`
              : s.progress < 75
                ? `linear-gradient(90deg, ${ORANGE}, #FFAA33)`
                : `linear-gradient(90deg, ${B1}, ${B4})`;
            return (
              <div key={i}
                role="button"
                tabIndex={0}
                aria-label={`Open ${s.name} performance detail`}
                onClick={() => setSelectedSubject(s.name)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedSubject(s.name); } }}
                className="mx-5 mt-3 bg-white rounded-[22px] px-5 py-[18px] relative overflow-hidden active:scale-[0.98] transition-transform cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)", transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)" }}>
                <div className="flex items-center justify-between mb-[14px]">
                  <div className="flex items-center gap-[10px]">
                    <div className="w-9 h-9 rounded-[12px] flex items-center justify-center"
                      style={{ background: acc.icoBg, boxShadow: acc.icoShadow }}>
                      <Icon className="w-[18px] h-[18px] text-white" strokeWidth={2.2} />
                    </div>
                    <span className="text-[15px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>{s.name}</span>
                  </div>
                  <div className="w-7 h-7 rounded-[9px] flex items-center justify-center text-[12px] font-bold text-white"
                    style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 2px 8px rgba(0,85,255,0.30)" }}>
                    {s.grade}
                  </div>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold" style={{ color: T2, letterSpacing: "-0.1px" }}>Progress</span>
                  <span className="text-[13px] font-bold" style={{ color: B1 }}>{s.progress}%</span>
                </div>
                <div className="h-[7px] rounded-[4px] overflow-hidden mb-[10px]" style={{ background: BG2 }}>
                  <div className="h-full rounded-[4px] transition-all duration-700"
                    style={{ width: `${Math.max(s.progress, 3)}%`, background: fill }} />
                </div>
                {needsAttention ? (
                  <div className="inline-flex items-center gap-[5px] px-[11px] py-1 rounded-full text-[10px] font-bold"
                    style={{ background: "rgba(255,51,85,0.10)", color: RED, border: "0.5px solid rgba(255,51,85,0.22)" }}>
                    <span className="w-[10px] h-[1.5px]" style={{ background: RED }} />
                    Needs Attention
                  </div>
                ) : s.progress >= 75 ? (
                  <div className="inline-flex items-center gap-[5px] px-[11px] py-1 rounded-full text-[10px] font-bold"
                    style={{ background: GREEN_S, color: "#007830", border: `0.5px solid ${GREEN_B}` }}>
                    ✓ On Track
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-[5px] px-[11px] py-1 rounded-full text-[10px] font-bold"
                    style={{ background: "rgba(255,136,0,0.12)", color: ORANGE, border: "0.5px solid rgba(255,136,0,0.25)" }}>
                    Stable
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* ── Performance Trend Chart ── */}
        {!loading && overallTrend.length > 1 && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Open reports page for detailed trend"
            onClick={() => navigate("/reports")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/reports"); } }}
            className="mx-5 mt-3 bg-white rounded-[24px] px-5 pt-5 pb-4 cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
            style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="text-[16px] font-bold" style={{ color: T1, letterSpacing: "-0.3px", marginBottom: 4 }}>Performance Trend</div>
            <div className="text-[11px] mb-4" style={{ color: T3 }}>Score progression across months</div>
            <div className="h-[150px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={overallTrend} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="perfAreaBlue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={B1} stopOpacity={0.20} />
                      <stop offset="100%" stopColor={B1} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="perfLineBlue" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor={B1} />
                      <stop offset="100%" stopColor="#66BBFF" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="0" vertical={false} stroke="rgba(0,85,255,0.07)" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: T4, fontWeight: 600 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: T4, fontWeight: 600 }} domain={[0, 100]} width={30} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "0.5px solid rgba(0,85,255,0.15)", boxShadow: "0 4px 20px rgba(0,85,255,0.12)", fontSize: 11, padding: "6px 10px" }} />
                  <Area type="monotone" dataKey="score" stroke="url(#perfLineBlue)" strokeWidth={2.5} fill="url(#perfAreaBlue)" dot={{ r: 4, strokeWidth: 2, stroke: "#fff", fill: B1 }} activeDot={{ r: 6, strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center gap-[6px] mt-2">
              <span className="w-6 h-[2.5px] rounded-[2px]" style={{ background: B1 }} />
              <span className="text-[11px] font-medium" style={{ color: T3 }}>Overall Average</span>
            </div>
          </div>
        )}

        {/* ── AI Narrative Analysis ── */}
        {!loading && subjects.length > 0 && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Open reports page for full narrative"
            onClick={() => navigate("/reports")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/reports"); } }}
            className="mx-5 mt-3 rounded-[24px] px-5 py-[18px] relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            style={{
              background: "linear-gradient(140deg, #001888 0%, #0033CC 48%, #0055FF 100%)",
              boxShadow: "0 8px 30px rgba(0,51,204,0.34), 0 0 0 0.5px rgba(255,255,255,0.14)",
              border: "0.5px solid rgba(255,255,255,0.14)"
            }}>
            <div className="absolute -top-10 -right-7 w-[180px] h-[180px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(255,255,255,0.14) 0%, transparent 65%)" }} />
            <div className="absolute inset-0 pointer-events-none" style={{
              backgroundImage: "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
              backgroundSize: "24px 24px"
            }} />
            <div className="flex items-center gap-[7px] mb-[14px] relative z-10">
              <div className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.18)", border: "0.5px solid rgba(255,255,255,0.26)" }}>
                <Sparkles className="w-4 h-4" style={{ color: "rgba(255,255,255,0.9)" }} strokeWidth={2.2} />
              </div>
              <span className="text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.55)" }}>AI Narrative Analysis</span>
            </div>
            <p className="text-[13px] leading-[1.72] font-normal mb-[14px] relative z-10" style={{ color: "rgba(255,255,255,0.92)", letterSpacing: "-0.1px" }}>
              <strong style={{ color: "#fff", fontWeight: 700 }}>{studentName}</strong>{" "}
              {generateNarrative().replace(new RegExp(`^${studentName}\\s*`), "")}
            </p>
            <div className="flex items-center gap-[6px] pt-3 relative z-10" style={{ borderTop: "0.5px solid rgba(255,255,255,0.12)" }}>
              <div className="w-[6px] h-[6px] rounded-full" style={{ background: B4, boxShadow: "0 0 0 2px rgba(68,153,255,0.25)" }} />
              <span className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.42)" }}>Generated from real-time assessment data</span>
            </div>
          </div>
        )}

        {/* ── Goal Setting AI ── */}
        {!loading && subjects.length > 0 && activeGoalSub && (
          <div className="mx-5 mt-3 bg-white rounded-[24px] p-5"
            style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="flex items-center gap-3 mb-[18px]">
              <div className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
                style={{ background: `linear-gradient(135deg, ${ORANGE}, #FFAA33)`, boxShadow: "0 3px 12px rgba(255,136,0,0.30)" }}>
                <Target className="w-[22px] h-[22px] text-white" strokeWidth={2.2} />
              </div>
              <div>
                <div className="text-[16px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Goal Setting AI</div>
                <div className="text-[11px] mt-0.5" style={{ color: T3 }}>Set a target score and get a personalised plan</div>
              </div>
            </div>

            <div className="text-[9px] font-bold uppercase tracking-[0.10em] mb-2" style={{ color: T4 }}>Subject</div>
            <select
              value={goalSubject || subjects[0]?.name || ""}
              onChange={e => setGoalSubject(e.target.value)}
              className="w-full py-3 px-[14px] rounded-[14px] text-[14px] font-bold mb-4 cursor-pointer appearance-none"
              style={{
                border: "0.5px solid rgba(0,85,255,0.16)",
                background: `${BG} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%230055FF' stroke-width='2.5' stroke-linecap='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E") right 14px center / auto no-repeat`,
                color: T1,
                fontFamily: "inherit",
              }}
            >
              {subjects.map(s => (
                <option key={s.name} value={s.name}>{s.name} — Current: {s.progress}%</option>
              ))}
            </select>

            <div className="flex items-center justify-between mb-[10px]">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: T4 }}>Target Score</span>
              <span className="text-[16px] font-bold" style={{ color: ORANGE }}>{goalTarget}%</span>
            </div>

            <input
              type="range"
              min={50}
              max={100}
              value={goalTarget}
              onChange={e => setGoalTarget(Number(e.target.value))}
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
              .perf-mobile-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(135deg, #FF8800, #FFAA33); box-shadow: 0 2px 10px rgba(255,136,0,0.40); cursor: pointer; border: 2.5px solid #fff; }
              input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(135deg, #FF8800, #FFAA33); box-shadow: 0 2px 10px rgba(255,136,0,0.40); cursor: pointer; border: 2.5px solid #fff; }
              input[type=range]::-moz-range-thumb { width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(135deg, #FF8800, #FFAA33); box-shadow: 0 2px 10px rgba(255,136,0,0.40); cursor: pointer; border: 2.5px solid #fff; }
            `}</style>
            <div className="flex justify-between mt-[6px]">
              <span className="text-[10px] font-semibold" style={{ color: T4 }}>50%</span>
              <span className="text-[10px] font-semibold" style={{ color: T4 }}>75%</span>
              <span className="text-[10px] font-semibold" style={{ color: T4 }}>100%</span>
            </div>

            {goalInsight && (
              <div className="mt-[14px] rounded-[16px] px-4 py-[14px]"
                style={{
                  background: goalGap > 25 ? "rgba(255,51,85,0.06)" : goalGap > 15 ? "rgba(255,136,0,0.07)" : "rgba(0,85,255,0.05)",
                  border: `0.5px solid ${goalGap > 25 ? "rgba(255,51,85,0.18)" : goalGap > 15 ? "rgba(255,136,0,0.22)" : "rgba(0,85,255,0.18)"}`
                }}>
                <div className="text-[14px] font-bold mb-[5px]" style={{ color: goalGap > 25 ? RED : goalGap > 15 ? ORANGE : B1, letterSpacing: "-0.2px" }}>
                  {goalInsight.line1}
                </div>
                <div className="text-[12px] leading-[1.6] font-normal" style={{ color: goalGap > 25 ? "#AA2233" : goalGap > 15 ? "#AA5500" : T3 }}>
                  {goalInsight.line2}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Benchmark Insights ── */}
        {!loading && subjects.length > 0 && (
          <div className="mx-5 mt-3 mb-2 bg-white rounded-[24px] p-5"
            style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="flex items-center gap-3 mb-[18px]">
              <div className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
                style={{ background: GREEN_S, border: `0.5px solid ${GREEN_B}` }}>
                <Trophy className="w-[22px] h-[22px]" style={{ color: GREEN }} strokeWidth={2.2} />
              </div>
              <div>
                <div className="text-[16px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Benchmark Insights</div>
                <div className="text-[11px] mt-0.5" style={{ color: T3 }}>Where {studentName} stands vs academic benchmarks</div>
              </div>
            </div>

            {subjects.map((s, i) => {
              const tier = getBenchmarkTier(s.progress);
              const acc = unitAccents[i % unitAccents.length];
              const Icon = getSubIcon(s.name);
              const benchmark = 80; // visual benchmark target
              const isOnTrack = s.progress >= 70;
              // Mini bar chart — last 4 score percentages for this subject
              const miniScores = (s.raw || [])
                .slice(-4)
                .map((r: any) => parseFloat(r.percentage) || 0);
              while (miniScores.length < 4) miniScores.unshift(s.progress);

              return (
                <div key={i} className="mb-3">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${s.name} performance detail`}
                    onClick={() => setSelectedSubject(s.name)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedSubject(s.name); } }}
                    className="flex items-center justify-between px-4 py-[14px] rounded-[16px] cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                    style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                    <div className="flex items-center gap-[10px]">
                      <div className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0"
                        style={{ background: acc.icoBg, boxShadow: acc.icoShadow }}>
                        <Icon className="w-[18px] h-[18px] text-white" strokeWidth={2.2} />
                      </div>
                      <div>
                        <div className="text-[14px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>{s.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          {isOnTrack ? (
                            <div className="px-[11px] py-1 rounded-full text-[10px] font-bold"
                              style={{ background: GREEN_S, color: "#007830", border: `0.5px solid ${GREEN_B}` }}>
                              {tier.label}
                            </div>
                          ) : (
                            <div className="px-[11px] py-1 rounded-full text-[10px] font-bold"
                              style={{ background: "rgba(255,51,85,0.10)", color: RED, border: "0.5px solid rgba(255,51,85,0.20)" }}>
                              Needs Work
                            </div>
                          )}
                        </div>
                        <div className="text-[12px] font-bold mt-[5px]" style={{ color: T3 }}>Score: {s.progress}%</div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-[6px]">
                      <div className="flex items-end gap-[3px] h-8">
                        {miniScores.map((val: number, k: number) => (
                          <div key={k}
                            style={{
                              width: 8,
                              borderRadius: "3px 3px 0 0",
                              background: `linear-gradient(180deg, ${B1}, ${B3})`,
                              height: `${Math.max(Math.min(val, 100), 10) * 0.32}px`
                            }} />
                        ))}
                      </div>
                      <div className="text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: T4 }}>Score</div>
                    </div>
                  </div>

                  {/* benchmark progress bar */}
                  <div className="mt-[10px] px-1">
                    <div className="flex justify-between mb-[7px]">
                      <span className="text-[11px] font-bold" style={{ color: T3 }}>Your score</span>
                      <span className="text-[11px] font-bold" style={{ color: T3 }}>Benchmark</span>
                    </div>
                    <div className="h-2 rounded-[4px] overflow-hidden relative mb-[5px]" style={{ background: BG2 }}>
                      <div className="h-full rounded-[4px]"
                        style={{
                          width: `${Math.min(s.progress, 100)}%`,
                          background: `linear-gradient(90deg, ${B1}, ${B4})`
                        }} />
                      <div className="absolute -top-[2px] w-[2px] h-3 rounded-[1px]"
                        style={{ left: `${benchmark}%`, background: ORANGE }} />
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[10px] font-bold" style={{ color: B1 }}>{s.progress}%</span>
                      <span className="text-[10px] font-bold" style={{ color: ORANGE }}>{benchmark}% target</span>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="flex items-start gap-[7px] pt-3" style={{ borderTop: `0.5px solid ${SEP}` }}>
              <div className="w-4 h-4 rounded-[4px] flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: "rgba(0,85,255,0.10)", border: "0.5px solid rgba(0,85,255,0.16)" }}>
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={B1} strokeWidth={2.5} strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              </div>
              <span className="text-[11px] italic leading-[1.6]" style={{ color: T4 }}>
                Rankings based on national academic performance benchmarks. No other student's data is used. Fully private.
              </span>
            </div>
          </div>
        )}

        <div className="h-6" />
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     DESKTOP — Bright Blue Apple UI (matches mobile)
     ═══════════════════════════════════════════════════════════════ */
  const B1 = "#0055FF", B2 = "#1166FF", B3 = "#2277FF", B4 = "#4499FF";
  const BG = "#EEF4FF", BG2 = "#E0ECFF";
  const T1 = "#001040", T2 = "#002080", T3 = "#5070B0", T4 = "#99AACC";
  const SEP = "rgba(0,85,255,0.07)";
  const GREEN = "#00C853", GREEN_S = "rgba(0,200,83,0.12)", GREEN_B = "rgba(0,200,83,0.25)";
  const RED = "#FF3355";
  const ORANGE = "#FF8800";
  const SH = "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.09), 0 10px 28px rgba(0,85,255,0.11)";
  const SH_LG = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 20px 48px rgba(0,85,255,0.14)";

  // Overall monthly avg trend (for the small area chart)
  const overallTrend = trendData.map((row: any) => {
    const vals = Object.entries(row)
      .filter(([k, v]) => k !== "month" && typeof v === "number" && v > 0)
      .map(([, v]) => v as number);
    const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    return { month: row.month, score: avg };
  }).filter((d: any) => d.score != null);

  const trendNum = parseInt(overallStats.trend.replace(/[^0-9-]/g, ""), 10) || 0;
  const trendColor = trendNum > 0 ? GREEN : trendNum < 0 ? RED : "#008844";

  const activeGoalSub = subjects.find(s => s.name === (goalSubject || subjects[0]?.name));
  const goalInsight = activeGoalSub ? getGoalInsight(activeGoalSub.progress, goalTarget, activeGoalSub.name) : null;
  const goalGap = activeGoalSub ? Math.max(0, goalTarget - activeGoalSub.progress) : 0;

  const unitAccents = [
    { icoBg: `linear-gradient(135deg, ${B1}, ${B3})`, icoShadow: "0 3px 10px rgba(0,85,255,0.28)" },
    { icoBg: "linear-gradient(135deg, #0044EE, #2277FF)", icoShadow: "0 3px 10px rgba(0,68,238,0.28)" },
    { icoBg: "linear-gradient(135deg, #002DBB, #0055FF)", icoShadow: "0 3px 10px rgba(0,45,187,0.28)" },
    { icoBg: "linear-gradient(135deg, #1155EE, #44AAFF)", icoShadow: "0 3px 10px rgba(17,85,238,0.28)" },
  ];

  return (
    <div className="animate-in fade-in duration-500 -m-4 sm:-m-6 md:-m-8 min-h-[calc(100vh-64px)]"
      style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: BG }}>
      <div className="w-full px-6 pt-8 pb-12">

        {/* ── Toolbar ── */}
        <div className="flex items-start justify-between gap-6 flex-wrap mb-6">
          <div>
            <div className="text-[32px] font-bold" style={{ color: T1, letterSpacing: "-0.9px" }}>Performance Analytics</div>
            <div className="text-[14px] mt-2 font-normal" style={{ color: T3 }}>Detailed breakdown of academic progress</div>
          </div>
          <div className="w-14 h-14 rounded-[16px] flex items-center justify-center text-[20px] font-bold text-white shrink-0"
            style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 4px 16px rgba(0,85,255,0.38)" }}>
            {overallStats.grade}
          </div>
        </div>

        {/* ── Overall Performance Hero ── */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Open reports page"
          onClick={() => navigate("/reports")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/reports"); } }}
          className="bg-white rounded-[24px] p-7 relative overflow-hidden mb-5 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
          style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
          <div className="absolute -top-[60px] -right-[40px] w-[240px] h-[240px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(0,85,255,0.06) 0%, transparent 70%)" }} />
          <div className="flex items-center justify-between gap-6 flex-wrap relative z-10">
            <div>
              <div className="text-[20px] font-bold" style={{ color: T1, letterSpacing: "-0.4px" }}>Overall Performance</div>
              <div className="text-[13px] mt-1" style={{ color: T3 }}>Based on all assessments this term</div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col items-center gap-[6px] px-6 py-4 rounded-[18px] min-w-[140px]"
                style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                <div className="text-[36px] font-bold" style={{ color: B1, letterSpacing: "-1px" }}>{overallStats.grade}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.10em]" style={{ color: T4 }}>Grade</div>
              </div>
              <div className="flex flex-col items-center gap-[6px] px-6 py-4 rounded-[18px] min-w-[140px]"
                style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                <div className="text-[36px] font-bold" style={{ color: T1, letterSpacing: "-1px" }}>{overallStats.avg > 0 ? `${overallStats.avg}%` : "—"}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.10em]" style={{ color: T4 }}>Average</div>
              </div>
              <div className="flex flex-col items-center gap-[6px] px-6 py-4 rounded-[18px] min-w-[140px]"
                style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                <div className="flex items-center gap-1">
                  {trendNum > 0 ? <ArrowUp className="w-5 h-5" style={{ color: trendColor }} /> : trendNum < 0 ? <ArrowDown className="w-5 h-5" style={{ color: trendColor }} /> : <Minus className="w-5 h-5" style={{ color: trendColor }} />}
                  <div className="text-[28px] font-bold" style={{ color: trendColor, letterSpacing: "-0.8px" }}>{overallStats.trend}</div>
                </div>
                <div className="text-[10px] font-bold uppercase tracking-[0.10em]" style={{ color: T4 }}>Trend</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Subject Cards Grid ── */}
        {loading ? (
          <div className="bg-white rounded-[22px] py-20 flex flex-col items-center gap-3"
            style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <Loader2 className="w-10 h-10 animate-spin" style={{ color: B1 }} />
            <p className="text-[13px] font-bold uppercase tracking-widest" style={{ color: T4 }}>Loading performance data…</p>
          </div>
        ) : subjects.length === 0 ? (
          <div className="bg-white rounded-[22px] py-20 flex flex-col items-center gap-3 text-center"
            style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="w-16 h-16 rounded-[20px] flex items-center justify-center"
              style={{ background: BG2, border: "0.5px solid rgba(0,85,255,0.14)" }}>
              <BookOpen className="w-8 h-8" style={{ color: T4 }} />
            </div>
            <div className="text-[16px] font-bold" style={{ color: T2 }}>No assessments yet</div>
            <div className="text-[13px] mt-1" style={{ color: T4 }}>Scores will appear here once graded.</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {subjects.map((s, i) => {
              const acc = unitAccents[i % unitAccents.length];
              const Icon = getSubIcon(s.name);
              const needsAttention = s.progress < 60;
              const fill = needsAttention
                ? `linear-gradient(90deg, ${RED}, #FF6688)`
                : s.progress < 75
                  ? `linear-gradient(90deg, ${ORANGE}, #FFAA33)`
                  : `linear-gradient(90deg, ${B1}, ${B4})`;
              return (
                <div key={i}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${s.name} performance detail`}
                  onClick={() => setSelectedSubject(s.name)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedSubject(s.name); } }}
                  className="bg-white rounded-[22px] px-5 py-5 relative overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lg cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                  style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-[10px]">
                      <div className="w-10 h-10 rounded-[13px] flex items-center justify-center"
                        style={{ background: acc.icoBg, boxShadow: acc.icoShadow }}>
                        <Icon className="w-5 h-5 text-white" strokeWidth={2.2} />
                      </div>
                      <span className="text-[16px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>{s.name}</span>
                    </div>
                    <div className="w-8 h-8 rounded-[10px] flex items-center justify-center text-[13px] font-bold text-white"
                      style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 2px 8px rgba(0,85,255,0.30)" }}>
                      {s.grade}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold" style={{ color: T2, letterSpacing: "-0.1px" }}>Progress</span>
                    <span className="text-[14px] font-bold" style={{ color: B1 }}>{s.progress}%</span>
                  </div>
                  <div className="h-2 rounded-[4px] overflow-hidden mb-3" style={{ background: BG2 }}>
                    <div className="h-full rounded-[4px] transition-all duration-700"
                      style={{ width: `${Math.max(s.progress, 3)}%`, background: fill }} />
                  </div>
                  {needsAttention ? (
                    <div className="inline-flex items-center gap-[5px] px-3 py-1 rounded-full text-[10px] font-bold"
                      style={{ background: "rgba(255,51,85,0.10)", color: RED, border: "0.5px solid rgba(255,51,85,0.22)" }}>
                      <span className="w-[10px] h-[1.5px]" style={{ background: RED }} />
                      Needs Attention
                    </div>
                  ) : s.progress >= 75 ? (
                    <div className="inline-flex items-center gap-[5px] px-3 py-1 rounded-full text-[10px] font-bold"
                      style={{ background: GREEN_S, color: "#007830", border: `0.5px solid ${GREEN_B}` }}>
                      ✓ On Track
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-[5px] px-3 py-1 rounded-full text-[10px] font-bold"
                      style={{ background: "rgba(255,136,0,0.12)", color: ORANGE, border: "0.5px solid rgba(255,136,0,0.25)" }}>
                      Stable
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Trend + AI Narrative row ── */}
        {!loading && subjects.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 mt-5">

            {/* Performance Trend chart (lg:col-span-3) */}
            {overallTrend.length > 1 ? (
              <div
                role="button"
                tabIndex={0}
                aria-label="Open reports page for detailed trend"
                onClick={() => navigate("/reports")}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/reports"); } }}
                className="lg:col-span-3 bg-white rounded-[24px] px-6 pt-6 pb-5 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                <div className="text-[18px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Performance Trend</div>
                <div className="text-[12px] mt-1 mb-4" style={{ color: T3 }}>Score progression across months</div>
                <div className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={overallTrend} margin={{ top: 6, right: 6, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="perfAreaBlueD" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={B1} stopOpacity={0.22} />
                          <stop offset="100%" stopColor={B1} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="perfLineBlueD" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor={B1} />
                          <stop offset="100%" stopColor="#66BBFF" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="0" vertical={false} stroke="rgba(0,85,255,0.07)" />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: T4, fontWeight: 600 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: T4, fontWeight: 600 }} domain={[0, 100]} width={36} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: "0.5px solid rgba(0,85,255,0.15)", boxShadow: "0 4px 20px rgba(0,85,255,0.12)", fontSize: 12, padding: "8px 12px" }} />
                      <Area type="monotone" dataKey="score" stroke="url(#perfLineBlueD)" strokeWidth={3} fill="url(#perfAreaBlueD)" dot={{ r: 5, strokeWidth: 2, stroke: "#fff", fill: B1 }} activeDot={{ r: 7, strokeWidth: 2 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center justify-center gap-[6px] mt-2">
                  <span className="w-7 h-[3px] rounded-[2px]" style={{ background: B1 }} />
                  <span className="text-[12px] font-medium" style={{ color: T3 }}>Overall Average</span>
                </div>
              </div>
            ) : (
              <div className="lg:col-span-3" />
            )}

            {/* AI Narrative (lg:col-span-2) */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Open reports page for full narrative"
              onClick={() => navigate("/reports")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/reports"); } }}
              className="lg:col-span-2 rounded-[24px] px-6 py-6 relative overflow-hidden cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              style={{
                background: "linear-gradient(140deg, #001888 0%, #0033CC 48%, #0055FF 100%)",
                boxShadow: "0 8px 30px rgba(0,51,204,0.34), 0 0 0 0.5px rgba(255,255,255,0.14)",
                border: "0.5px solid rgba(255,255,255,0.14)"
              }}>
              <div className="absolute -top-10 -right-7 w-[220px] h-[220px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(255,255,255,0.14) 0%, transparent 65%)" }} />
              <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
                backgroundSize: "24px 24px"
              }} />
              <div className="flex items-center gap-[8px] mb-4 relative z-10">
                <div className="w-[32px] h-[32px] rounded-[10px] flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.18)", border: "0.5px solid rgba(255,255,255,0.26)" }}>
                  <Sparkles className="w-[17px] h-[17px]" style={{ color: "rgba(255,255,255,0.9)" }} strokeWidth={2.2} />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.55)" }}>AI Narrative Analysis</span>
              </div>
              <p className="text-[14px] leading-[1.72] font-normal mb-4 relative z-10" style={{ color: "rgba(255,255,255,0.92)", letterSpacing: "-0.1px" }}>
                <strong style={{ color: "#fff", fontWeight: 700 }}>{studentName}</strong>{" "}
                {generateNarrative().replace(new RegExp(`^${studentName}\\s*`), "")}
              </p>
              <div className="flex items-center gap-[6px] pt-3 relative z-10" style={{ borderTop: "0.5px solid rgba(255,255,255,0.12)" }}>
                <div className="w-[6px] h-[6px] rounded-full" style={{ background: B4, boxShadow: "0 0 0 2px rgba(68,153,255,0.25)" }} />
                <span className="text-[10px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.42)" }}>Generated from real-time assessment data</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Goal + Benchmark row ── */}
        {!loading && subjects.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">

            {/* Goal Setting AI */}
            {activeGoalSub && (
              <div className="bg-white rounded-[24px] p-6"
                style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-12 h-12 rounded-[14px] flex items-center justify-center shrink-0"
                    style={{ background: `linear-gradient(135deg, ${ORANGE}, #FFAA33)`, boxShadow: "0 3px 12px rgba(255,136,0,0.30)" }}>
                    <Target className="w-[22px] h-[22px] text-white" strokeWidth={2.2} />
                  </div>
                  <div>
                    <div className="text-[17px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Goal Setting AI</div>
                    <div className="text-[12px] mt-0.5" style={{ color: T3 }}>Set a target score and get a personalised plan</div>
                  </div>
                </div>

                <div className="text-[10px] font-bold uppercase tracking-[0.10em] mb-2" style={{ color: T4 }}>Subject</div>
                <select
                  value={goalSubject || subjects[0]?.name || ""}
                  onChange={e => setGoalSubject(e.target.value)}
                  className="w-full py-3 px-[14px] rounded-[14px] text-[14px] font-bold mb-5 cursor-pointer appearance-none"
                  style={{
                    border: "0.5px solid rgba(0,85,255,0.16)",
                    background: `${BG} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%230055FF' stroke-width='2.5' stroke-linecap='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E") right 14px center / auto no-repeat`,
                    color: T1,
                    fontFamily: "inherit",
                  }}>
                  {subjects.map(s => (
                    <option key={s.name} value={s.name}>{s.name} — Current: {s.progress}%</option>
                  ))}
                </select>

                <div className="flex items-center justify-between mb-[10px]">
                  <span className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: T4 }}>Target Score</span>
                  <span className="text-[18px] font-bold" style={{ color: ORANGE }}>{goalTarget}%</span>
                </div>

                <input
                  type="range" min={50} max={100} value={goalTarget}
                  onChange={e => setGoalTarget(Number(e.target.value))}
                  className="w-full cursor-pointer"
                  style={{
                    WebkitAppearance: "none", appearance: "none",
                    height: 6, borderRadius: 3,
                    background: `linear-gradient(90deg, ${ORANGE} ${((goalTarget - 50) / 50) * 100}%, ${BG2} ${((goalTarget - 50) / 50) * 100}%)`,
                    outline: "none",
                  }} />
                <div className="flex justify-between mt-[6px]">
                  <span className="text-[10px] font-semibold" style={{ color: T4 }}>50%</span>
                  <span className="text-[10px] font-semibold" style={{ color: T4 }}>75%</span>
                  <span className="text-[10px] font-semibold" style={{ color: T4 }}>100%</span>
                </div>

                {goalInsight && (
                  <div className="mt-5 rounded-[16px] px-4 py-[14px]"
                    style={{
                      background: goalGap > 25 ? "rgba(255,51,85,0.06)" : goalGap > 15 ? "rgba(255,136,0,0.07)" : "rgba(0,85,255,0.05)",
                      border: `0.5px solid ${goalGap > 25 ? "rgba(255,51,85,0.18)" : goalGap > 15 ? "rgba(255,136,0,0.22)" : "rgba(0,85,255,0.18)"}`
                    }}>
                    <div className="text-[15px] font-bold mb-1" style={{ color: goalGap > 25 ? RED : goalGap > 15 ? ORANGE : B1, letterSpacing: "-0.2px" }}>
                      {goalInsight.line1}
                    </div>
                    <div className="text-[13px] leading-[1.6] font-normal" style={{ color: goalGap > 25 ? "#AA2233" : goalGap > 15 ? "#AA5500" : T3 }}>
                      {goalInsight.line2}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Benchmark Insights */}
            <div className="bg-white rounded-[24px] p-6"
              style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-12 h-12 rounded-[14px] flex items-center justify-center shrink-0"
                  style={{ background: GREEN_S, border: `0.5px solid ${GREEN_B}` }}>
                  <Trophy className="w-[22px] h-[22px]" style={{ color: GREEN }} strokeWidth={2.2} />
                </div>
                <div>
                  <div className="text-[17px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Benchmark Insights</div>
                  <div className="text-[12px] mt-0.5" style={{ color: T3 }}>Where {studentName} stands vs academic benchmarks</div>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {subjects.map((s, i) => {
                  const tier = getBenchmarkTier(s.progress);
                  const acc = unitAccents[i % unitAccents.length];
                  const Icon = getSubIcon(s.name);
                  const benchmark = 80;
                  const isOnTrack = s.progress >= 70;
                  const miniScores = (s.raw || [])
                    .slice(-4)
                    .map((r: any) => parseFloat(r.percentage) || 0);
                  while (miniScores.length < 4) miniScores.unshift(s.progress);

                  return (
                    <div key={i}>
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={`Open ${s.name} performance detail`}
                        onClick={() => setSelectedSubject(s.name)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedSubject(s.name); } }}
                        className="flex items-center justify-between px-4 py-3 rounded-[16px] cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                        style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                        <div className="flex items-center gap-[10px]">
                          <div className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0"
                            style={{ background: acc.icoBg, boxShadow: acc.icoShadow }}>
                            <Icon className="w-[18px] h-[18px] text-white" strokeWidth={2.2} />
                          </div>
                          <div>
                            <div className="text-[14px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>{s.name}</div>
                            <div className="flex items-center gap-2 mt-1">
                              {isOnTrack ? (
                                <div className="px-[11px] py-[3px] rounded-full text-[10px] font-bold"
                                  style={{ background: GREEN_S, color: "#007830", border: `0.5px solid ${GREEN_B}` }}>
                                  {tier.label}
                                </div>
                              ) : (
                                <div className="px-[11px] py-[3px] rounded-full text-[10px] font-bold"
                                  style={{ background: "rgba(255,51,85,0.10)", color: RED, border: "0.5px solid rgba(255,51,85,0.20)" }}>
                                  Needs Work
                                </div>
                              )}
                              <span className="text-[11px] font-bold" style={{ color: T3 }}>Score: {s.progress}%</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-end gap-[3px] h-10">
                          {miniScores.map((val: number, k: number) => (
                            <div key={k}
                              style={{
                                width: 9,
                                borderRadius: "3px 3px 0 0",
                                background: `linear-gradient(180deg, ${B1}, ${B3})`,
                                height: `${Math.max(Math.min(val, 100), 10) * 0.4}px`
                              }} />
                          ))}
                        </div>
                      </div>
                      <div className="mt-2 px-1">
                        <div className="h-2 rounded-[4px] overflow-hidden relative" style={{ background: BG2 }}>
                          <div className="h-full rounded-[4px]"
                            style={{
                              width: `${Math.min(s.progress, 100)}%`,
                              background: `linear-gradient(90deg, ${B1}, ${B4})`
                            }} />
                          <div className="absolute -top-[2px] w-[2px] h-3 rounded-[1px]"
                            style={{ left: `${benchmark}%`, background: ORANGE }} />
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className="text-[10px] font-bold" style={{ color: B1 }}>{s.progress}%</span>
                          <span className="text-[10px] font-bold" style={{ color: ORANGE }}>{benchmark}% benchmark</span>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div className="flex items-start gap-[7px] pt-3" style={{ borderTop: `0.5px solid ${SEP}` }}>
                  <div className="w-4 h-4 rounded-[4px] flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: "rgba(0,85,255,0.10)", border: "0.5px solid rgba(0,85,255,0.16)" }}>
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={B1} strokeWidth={2.5} strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                  </div>
                  <span className="text-[11px] italic leading-[1.6]" style={{ color: T4 }}>
                    Rankings based on national academic performance benchmarks. No other student's data is used. Fully private.
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PerformancePage;
