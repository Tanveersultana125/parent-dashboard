import { useState, useEffect } from "react";
import {
  Calendar, CheckCircle, Clock, Loader2, User,
  FlaskConical, Calculator, Book, History, GraduationCap
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { db } from "@/lib/firebase";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { collection, query, where, onSnapshot, limit } from "firebase/firestore";
import { subscribeEnrollments } from "@/lib/enrollmentQuery";
import { PageHeader } from "@/components/ui/PageHeader";
import { useIsMobile } from "@/hooks/use-mobile";

const TestsPage = () => {
  const { studentData } = useAuth();
  const { gradeScale } = useSchoolSettings();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [upcomingTests, setUpcomingTests] = useState<any[]>([]);
  const [recentResults, setRecentResults] = useState<any[]>([]);
  const [stats, setStats] = useState({ aGrade: 0, bGrade: 0, cGrade: 0, belowC: 0, totalTaken: 0 });

  useEffect(() => {
    if (!studentData?.id) return;
    setLoading(true);
    const schoolId = studentData.schoolId;

    // Enrollments → classIds → tests (single query, scoped to school)
    let enrollSnap: any = null;
    let unsubTests: any = () => {};

    const processEnrollments = () => {
      const classIds = Array.from(new Set((enrollSnap?.docs || []).map((d: any) => d.data().classId).filter(Boolean))) as string[];
      const searchIds = classIds.length > 0 ? classIds : [studentData.classId || "General"];

      unsubTests();
      // Chunk classIds to handle >10 (Firestore "in" limit)
      const chunks: string[][] = [];
      for (let i = 0; i < searchIds.length; i += 10) chunks.push(searchIds.slice(i, i + 10));

      const allTests: any[] = [];
      let resolved = 0;
      chunks.forEach(chunk => {
        const q = schoolId
          ? query(collection(db, "tests"), where("schoolId", "==", schoolId), where("classId", "in", chunk))
          : query(collection(db, "tests"), where("classId", "in", chunk));
        const unsub = onSnapshot(q, (snap) => {
          snap.docs.forEach(d => {
            const idx = allTests.findIndex(t => t.id === d.id);
            const item = { id: d.id, ...(d.data() as any) };
            if (idx >= 0) allTests[idx] = item; else allTests.push(item);
          });
          resolved++;
          if (resolved >= chunks.length) {
            const now = new Date();
            const filtered = allTests
              .filter(t => { const d = t.date || t.testDate; return d && new Date(d) >= now; })
              .sort((a, b) => new Date(a.date || a.testDate).getTime() - new Date(b.date || b.testDate).getTime());
            setUpcomingTests(filtered);
          }
        });
        unsubTests = unsub; // keep last chunk unsub (simplified; all chunks clean up on effect cleanup)
      });
    };

    // Dual-listener helper — also matches legacy enrollments where the
    // teacher/principal-dashboard wrote studentId as the email.
    const unsubEnroll = subscribeEnrollments(studentData, (docs) => {
      enrollSnap = { docs };
      processEnrollments();
    });

    // test_scores — single scoped query
    const scoresQ = schoolId
      ? query(collection(db, "test_scores"), where("schoolId", "==", schoolId), where("studentId", "==", studentData.id), limit(20))
      : query(collection(db, "test_scores"), where("studentId", "==", studentData.id), limit(20));

    const unsubScores = onSnapshot(scoresQ, (snap) => {
      const scores = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => {
          const tA = a.timestamp?.toMillis?.() || new Date(a.timestamp || 0).getTime();
          const tB = b.timestamp?.toMillis?.() || new Date(b.timestamp || 0).getTime();
          return tB - tA;
        });
      setRecentResults(scores);
      let a = 0, b = 0, c = 0, d = 0;
      scores.forEach((s: any) => {
        const raw = s.percentage ?? (s.maxScore > 0 ? (s.score / s.maxScore * 100) : 0);
        const pct = isFinite(raw) ? raw : 0;
        if (pct >= (gradeScale?.A ?? 85)) a++;
        else if (pct >= (gradeScale?.B ?? 70)) b++;
        else if (pct >= (gradeScale?.C ?? 50)) c++;
        else d++;
      });
      setStats({ aGrade: a, bGrade: b, cGrade: c, belowC: d, totalTaken: scores.length });
      setLoading(false);
    });

    return () => { unsubEnroll(); unsubScores(); unsubTests(); };
  }, [studentData?.id, studentData?.schoolId]);

  const getSubjectIcon = (title: string = "") => {
    const t = title.toLowerCase();
    if (t.includes("sci")) return { icon: <FlaskConical className="w-5 h-5" />, bg: "bg-green-100 text-green-600" };
    if (t.includes("math")) return { icon: <Calculator className="w-5 h-5" />, bg: "bg-blue-100 text-blue-600" };
    if (t.includes("history")) return { icon: <History className="w-5 h-5" />, bg: "bg-rose-100 text-rose-500" };
    if (t.includes("english") || t.includes("lang")) return { icon: <Book className="w-5 h-5" />, bg: "bg-orange-100 text-orange-500" };
    return { icon: <GraduationCap className="w-5 h-5" />, bg: "bg-slate-100 text-slate-500" };
  };

  const getDayDiff = (dateStr: string) => {
    if (!dateStr) return 0;
    const diff = new Date(dateStr).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 3600 * 24)));
  };

  const formatDate = (date: any) => {
    if (!date) return "--";
    const d = date?.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const nextTest = upcomingTests[0];

  /* ═══════════════════════════════════════════════════════════════
     MOBILE — Bright Blue Apple UI
     ═══════════════════════════════════════════════════════════════ */
  if (isMobile) {
    const B1 = "#0055FF", B2 = "#1166FF", B4 = "#4499FF";
    const BG = "#EEF4FF", BG2 = "#E0ECFF";
    const T1 = "#001040", T3 = "#5070B0", T4 = "#99AACC";
    const GREEN = "#00C853";
    const RED = "#FF3355";
    const ORANGE = "#FF8800";
    const SH = "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.09), 0 10px 24px rgba(0,85,255,0.10)";
    const SH_LG = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.11), 0 18px 44px rgba(0,85,255,0.13)";
    const SH_BTN = "0 6px 22px rgba(0,85,255,0.42), 0 2px 6px rgba(0,85,255,0.22)";

    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    const toSafeDate = (v: any): Date | null => {
      if (!v) return null;
      if (typeof v?.toDate === "function") return v.toDate();
      if (v?.seconds) return new Date(v.seconds * 1000);
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };

    // Test-type classification for tag label
    const getTestTypeTag = (t: any) => {
      const raw = (t.type || t.testType || t.mode || t.testName || "").toString().toLowerCase();
      if (raw.includes("oral") || raw.includes("viva") || raw.includes("speak")) return { label: "Oral", cls: "orange" };
      if (raw.includes("quiz")) return { label: "Quiz", cls: "blue" };
      if (raw.includes("practical") || raw.includes("lab")) return { label: "Practical", cls: "green" };
      return { label: "Written", cls: "blue" };
    };

    const tagStyle: Record<string, { bg: string; color: string; border: string }> = {
      blue:   { bg: "rgba(0,85,255,0.10)",  color: B1,        border: "rgba(0,85,255,0.20)" },
      green:  { bg: "rgba(0,200,83,0.10)",  color: "#007830", border: "rgba(0,200,83,0.22)" },
      orange: { bg: "rgba(255,136,0,0.10)", color: "#884400", border: "rgba(255,136,0,0.22)" },
    };

    const dateChipStyle = (urgent: boolean) => ({
      background: urgent ? "linear-gradient(135deg, #FF6600, #FFAA33)" : `linear-gradient(135deg, #0044EE, #2277FF)`,
      boxShadow: urgent ? "0 3px 10px rgba(255,102,0,0.24)" : "0 3px 10px rgba(0,68,238,0.28)",
    });

    // Score color based on percentage
    const scoreGradient = (pct: number) => {
      if (pct >= 80) return { bg: "linear-gradient(135deg, #00A040, #00C853)", shadow: "0 3px 10px rgba(0,160,64,0.30)" };
      if (pct >= 60) return { bg: `linear-gradient(135deg, ${B1}, ${B2})`, shadow: "0 3px 10px rgba(0,85,255,0.30)" };
      if (pct >= 40) return { bg: "linear-gradient(135deg, #FF6600, #FFAA33)", shadow: "0 3px 10px rgba(255,102,0,0.28)" };
      return { bg: "linear-gradient(135deg, #FF3355, #FF6688)", shadow: "0 3px 10px rgba(255,51,85,0.28)" };
    };

    // Monthly activity — count results per month (last 6 months)
    const now = new Date();
    const monthlyActivity = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { label: MONTHS[d.getMonth()], year: d.getFullYear(), month: d.getMonth(), count: 0, isCurrent: i === 5 };
    });
    recentResults.forEach((r: any) => {
      const ts = toSafeDate(r.timestamp || r.date || r.createdAt);
      if (!ts) return;
      const slot = monthlyActivity.find(m => m.year === ts.getFullYear() && m.month === ts.getMonth());
      if (slot) slot.count += 1;
    });
    const maxMonthly = Math.max(1, ...monthlyActivity.map(m => m.count));

    return (
      <div className="animate-in fade-in duration-500 -mx-3 -mt-3 md:mx-0 md:mt-0"
        style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: BG, minHeight: "100vh" }}>

        {/* ── Page Head ── */}
        <div className="px-[22px] pt-[18px]">
          <div className="text-[26px] font-bold mb-[3px]" style={{ color: T1, letterSpacing: "-0.7px" }}>Tests &amp; Examinations</div>
          <div className="text-[12px] font-normal" style={{ color: T3 }}>Track upcoming assessments and latest outcomes</div>
        </div>

        {/* ── Hero Banner ── */}
        <div className="mx-5 mt-[18px] rounded-[26px] px-[22px] py-6 relative overflow-hidden flex flex-col items-center text-center"
          style={{
            background: "linear-gradient(140deg, #0033CC 0%, #0055FF 42%, #2277FF 72%, #55AAFF 100%)",
            boxShadow: SH_BTN,
            minHeight: 156,
          }}>
          <div className="absolute -top-5 -right-5 w-[130px] h-[130px] rounded-full pointer-events-none" style={{ background: "rgba(255,255,255,0.10)" }} />
          <div className="absolute -bottom-[30px] right-5 w-[120px] h-[120px] rounded-full pointer-events-none" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.10)" }} />
          <div className="absolute -bottom-[10px] right-[80px] w-20 h-20 rounded-full pointer-events-none" style={{ background: "rgba(255,255,255,0.07)" }} />
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.016) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.016) 1px, transparent 1px)",
            backgroundSize: "24px 24px"
          }} />
          <div className="absolute right-[-10px] top-1/2 -translate-y-1/2 opacity-[0.10] pointer-events-none">
            <GraduationCap size={180} color="#fff" strokeWidth={0.8} />
          </div>

          <div className="w-[52px] h-[52px] rounded-[18px] flex items-center justify-center mb-4 relative z-10"
            style={{
              background: "rgba(255,255,255,0.22)",
              border: "0.5px solid rgba(255,255,255,0.32)",
              WebkitBackdropFilter: "blur(8px)",
              backdropFilter: "blur(8px)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.15)"
            }}>
            <Calendar className="w-[26px] h-[26px]" style={{ color: "rgba(255,255,255,0.95)" }} strokeWidth={2.2} />
          </div>
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] mb-2 relative z-10" style={{ color: "rgba(255,255,255,0.55)" }}>Coming Up Next</div>
          <div className="text-[24px] font-bold text-white mb-2 relative z-10 leading-[1.15]" style={{ letterSpacing: "-0.6px" }}>
            {nextTest?.testName || "No upcoming tests"}
          </div>
          <div className="flex items-center justify-center gap-[7px] relative z-10">
            {nextTest && (
              <>
                <div className="w-1 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.45)" }} />
                <span className="text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.65)", letterSpacing: "-0.1px" }}>
                  {formatDate(nextTest.date)}
                </span>
              </>
            )}
            <div className="w-1 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.45)" }} />
            <span className="text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.65)", letterSpacing: "-0.1px" }}>
              {nextTest?.time || "9:00 AM"}
            </span>
            {nextTest && (
              <>
                <div className="w-1 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.45)" }} />
                <span className="text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.65)", letterSpacing: "-0.1px" }}>
                  {getDayDiff(nextTest.date)} day{getDayDiff(nextTest.date) === 1 ? "" : "s"}
                </span>
              </>
            )}
          </div>
        </div>

        {/* ── Upcoming Tests Section ── */}
        <div className="mx-5 mt-[14px] bg-white rounded-[24px] p-5 relative overflow-hidden"
          style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
          <div className="absolute -top-10 -right-8 w-[120px] h-[120px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
          <div className="flex items-center justify-between mb-[14px]">
            <div className="text-[17px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Upcoming Tests</div>
            <div className="text-[11px] font-bold px-[10px] py-[3px] rounded-full tracking-[0.02em]"
              style={{ color: B1, background: "rgba(0,85,255,0.10)", border: "0.5px solid rgba(0,85,255,0.18)" }}>
              {upcomingTests.length} test{upcomingTests.length === 1 ? "" : "s"}
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: B1 }} />
              <p className="text-xs font-medium" style={{ color: T4 }}>Loading tests…</p>
            </div>
          ) : upcomingTests.length === 0 ? (
            <div className="flex flex-col items-center gap-[10px] pt-6 pb-4 relative z-10">
              <div className="w-14 h-14 rounded-[18px] flex items-center justify-center"
                style={{ background: "rgba(0,200,83,0.10)", border: "0.5px solid rgba(0,200,83,0.22)", boxShadow: "0 0 0 8px rgba(0,85,255,0.04)" }}>
                <CheckCircle className="w-[26px] h-[26px]" style={{ color: GREEN }} strokeWidth={2.2} />
              </div>
              <div className="text-[13px] font-medium" style={{ color: T4, letterSpacing: "-0.1px" }}>No upcoming tests</div>
              <div className="text-[11px] font-normal text-center max-w-[200px] leading-[1.55]" style={{ color: T4 }}>
                You're all clear! New tests will appear here when scheduled by your teacher.
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-[10px] relative z-10">
              {upcomingTests.map((t: any, i: number) => {
                const d = toSafeDate(t.date || t.testDate);
                const days = d ? getDayDiff(d.toISOString()) : 0;
                const urgent = days <= 3;
                const type = getTestTypeTag(t);
                const tag = tagStyle[type.cls];
                return (
                  <div key={t.id || i}
                    className="flex items-center gap-[13px] px-[15px] py-[13px] rounded-[18px] active:scale-[0.97] transition-transform cursor-pointer"
                    style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.12)", transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)" }}>
                    <div className="w-11 h-11 rounded-[14px] flex flex-col items-center justify-center gap-[1px] shrink-0"
                      style={dateChipStyle(urgent)}>
                      <div className="text-[17px] font-bold text-white leading-none">{d ? d.getDate() : "—"}</div>
                      <div className="text-[8px] font-bold uppercase tracking-[0.08em]" style={{ color: "rgba(255,255,255,0.68)" }}>
                        {d ? MONTHS[d.getMonth()] : ""}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-bold truncate" style={{ color: T1, letterSpacing: "-0.2px", marginBottom: 3 }}>
                        {t.testName || t.subject || "Test"}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {t.teacherName && (
                          <div className="flex items-center gap-[4px] text-[11px] font-medium" style={{ color: T3 }}>
                            <User className="w-[10px] h-[10px]" strokeWidth={2.5} />
                            <span className="truncate max-w-[90px]">{t.teacherName}</span>
                          </div>
                        )}
                        {(t.time || d) && (
                          <div className="flex items-center gap-[4px] text-[11px] font-medium" style={{ color: T3 }}>
                            <Clock className="w-[10px] h-[10px]" strokeWidth={2.5} />
                            {t.time || `${days} day${days === 1 ? "" : "s"}`}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="px-[10px] py-1 rounded-full text-[10px] font-bold shrink-0"
                      style={{ background: tag.bg, color: tag.color, border: `0.5px solid ${tag.border}` }}>
                      {type.label}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Recent Results Section ── */}
        <div className="mx-5 mt-[14px] bg-white rounded-[24px] p-5 relative overflow-hidden"
          style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
          <div className="absolute -top-10 -right-8 w-[120px] h-[120px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
          <div className="flex items-center justify-between mb-[14px]">
            <div className="text-[17px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Recent Results</div>
            <div className="text-[11px] font-bold px-[10px] py-[3px] rounded-full tracking-[0.02em]"
              style={{ color: B1, background: "rgba(0,85,255,0.10)", border: "0.5px solid rgba(0,85,255,0.18)" }}>
              {recentResults.length} result{recentResults.length === 1 ? "" : "s"}
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: B1 }} />
              <p className="text-xs font-medium" style={{ color: T4 }}>Loading results…</p>
            </div>
          ) : recentResults.length === 0 ? (
            <div className="flex flex-col items-center gap-[10px] pt-6 pb-4 relative z-10">
              <div className="w-14 h-14 rounded-[18px] flex items-center justify-center"
                style={{ background: "rgba(0,85,255,0.08)", border: "0.5px solid rgba(0,85,255,0.16)", boxShadow: "0 0 0 8px rgba(0,85,255,0.04)" }}>
                <Clock className="w-[26px] h-[26px]" style={{ color: "rgba(0,85,255,0.5)" }} strokeWidth={2.2} />
              </div>
              <div className="text-[13px] font-medium" style={{ color: T4, letterSpacing: "-0.1px" }}>No results yet</div>
              <div className="text-[11px] font-normal text-center max-w-[200px] leading-[1.55]" style={{ color: T4 }}>
                Completed test results will be shown here after grading.
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-[10px] relative z-10">
              {recentResults.slice(0, 5).map((r: any, i: number) => {
                const raw = r.percentage ?? (r.maxScore > 0 ? (r.score / r.maxScore * 100) : 0);
                const pct = isFinite(raw) ? raw : 0;
                const grad = scoreGradient(pct);
                return (
                  <div key={r.id || i}
                    className="flex items-center gap-[13px] px-[15px] py-[13px] rounded-[18px] active:scale-[0.97] transition-transform cursor-pointer"
                    style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.12)", transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)" }}>
                    <div className="w-11 h-11 rounded-[14px] flex items-center justify-center text-[16px] font-bold text-white shrink-0"
                      style={{ background: grad.bg, boxShadow: grad.shadow }}>
                      {Math.round(pct)}%
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-bold truncate" style={{ color: T1, letterSpacing: "-0.2px", marginBottom: 3 }}>
                        {r.testName || r.subject || "Test"}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-medium" style={{ color: T3 }}>
                          {r.score ?? "—"}/{r.maxScore ?? 100}
                        </span>
                        <span className="text-[11px] font-medium" style={{ color: T4 }}>·</span>
                        <span className="text-[11px] font-medium" style={{ color: T3 }}>
                          {formatDate(r.timestamp || r.date)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── This Term Performance (Grade grid) ── */}
        <div className="mx-5 mt-[14px] bg-white rounded-[24px] p-5 relative overflow-hidden"
          style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
          <div className="absolute -top-10 -right-8 w-[120px] h-[120px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
          <div className="flex items-center justify-between mb-1">
            <div className="text-[17px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>This Term Performance</div>
            <div className="text-[11px] font-bold" style={{ color: B1 }}>{stats.totalTaken} taken</div>
          </div>
          <div className="grid grid-cols-2 gap-[10px] mt-3 relative z-10">
            {[
              { val: stats.aGrade, label: "A Grade", color: GREEN,  bg: "rgba(0,200,83,0.09)",  border: "rgba(0,200,83,0.20)", bar: "linear-gradient(90deg, #00C853, #66EE88)" },
              { val: stats.bGrade, label: "B Grade", color: B1,     bg: "rgba(0,85,255,0.09)",  border: "rgba(0,85,255,0.18)", bar: `linear-gradient(90deg, ${B1}, ${B4})` },
              { val: stats.cGrade, label: "C Grade", color: ORANGE, bg: "rgba(255,136,0,0.09)", border: "rgba(255,136,0,0.20)", bar: "linear-gradient(90deg, #FF8800, #FFCC44)" },
              { val: stats.belowC, label: "Below C", color: RED,    bg: "rgba(255,51,85,0.09)", border: "rgba(255,51,85,0.18)", bar: "linear-gradient(90deg, #FF3355, #FF88AA)" },
            ].map(({ val, label, color, bg, border, bar }) => (
              <div key={label} className="rounded-[18px] px-4 py-[18px] flex flex-col items-center gap-[6px] active:scale-[0.96] transition-transform"
                style={{ background: bg, border: `0.5px solid ${border}`, transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)" }}>
                <div className="text-[36px] font-bold leading-none" style={{ color, letterSpacing: "-1.2px" }}>{val}</div>
                <div className="text-[11px] font-bold uppercase tracking-[0.06em]" style={{ color }}>{label}</div>
                <div className="h-[3px] rounded-[2px] mt-[2px]" style={{ width: "80%", background: bar }} />
              </div>
            ))}
          </div>
        </div>

        {/* ── Monthly Activity ── */}
        {!loading && stats.totalTaken > 0 && (
          <div className="mx-5 mt-3 bg-white rounded-[20px] px-[18px] py-4" style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[14px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>Monthly Activity</div>
              <div className="text-[11px] font-bold" style={{ color: B1 }}>2025–26 Term</div>
            </div>
            <div className="flex items-end gap-[7px] h-12 mb-[7px]">
              {monthlyActivity.map((m, i) => {
                const h = 6 + (m.count / maxMonthly) * 36;
                const opacity = m.isCurrent ? 1 : m.count === 0 ? 0.22 : 0.55;
                return (
                  <div key={i} className="flex flex-col items-center gap-1 flex-1">
                    <div
                      className="w-full rounded-t-[5px] min-h-[4px]"
                      style={{
                        height: h,
                        background: `linear-gradient(180deg, ${B1}, ${B4})`,
                        opacity,
                        boxShadow: m.isCurrent ? "0 0 0 3px rgba(0,85,255,0.18)" : "none",
                      }}
                    />
                    <span className="text-[9px] font-bold uppercase tracking-[0.04em]" style={{ color: m.isCurrent ? B1 : T4 }}>
                      {m.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="h-6" />
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     DESKTOP — Existing UI (unchanged)
     ═══════════════════════════════════════════════════════════════ */
  return (
    <div className="animate-in fade-in duration-500">
      <PageHeader
        title="Tests & Examinations"
        subtitle="Track upcoming assessments and latest outcomes"
        badge={stats.totalTaken > 0 ? `${stats.totalTaken} Completed` : ""}
      />

      {/* Upcoming Banner - Optimized for mobile */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl p-5 md:p-8 mb-6 text-white relative overflow-hidden shadow-xl shadow-blue-900/10">
        <div className="absolute top-0 right-0 opacity-10 scale-150 transform translate-x-1/4 -translate-y-1/4">
          <GraduationCap size={150} />
        </div>
        
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 relative z-10">
          <div className="flex items-center text-center sm:text-left flex-col sm:flex-row gap-5">
            <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-inner">
              <Calendar className="w-8 h-8 text-white" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-100 mb-1">Coming Up Next</p>
              <h2 className="text-2xl md:text-3xl font-black mb-1">{nextTest?.testName || "No upcoming tests"}</h2>
              <p className="text-sm text-blue-100 font-bold opacity-80">
                {nextTest?.date ? formatDate(nextTest.date) : "—"} • {nextTest?.time || "9:00 AM"}
              </p>
            </div>
          </div>
          
          {nextTest && (
            <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-8 py-4 text-center min-w-[120px]">
              <p className="text-4xl md:text-5xl font-black leading-none mb-1 text-white">{getDayDiff(nextTest.date)}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-100">Days Left</p>
            </div>
          )}
        </div>
      </div>

      {/* Two-column: Upcoming + Recent */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">

        {/* Upcoming Tests */}
        <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 mb-4">Upcoming Tests</h3>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-slate-300" /></div>
          ) : upcomingTests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-300 gap-2">
              <CheckCircle className="w-10 h-10 text-emerald-200" />
              <p className="text-xs">No upcoming tests</p>
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingTests.map((t, i) => {
                const { icon, bg } = getSubjectIcon(t.testName || t.subject);
                return (
                  <div key={i} className="flex items-center justify-between p-3.5 rounded-xl hover:bg-slate-50 transition-all">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center`}>{icon}</div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{t.testName}</p>
                        <p className="text-xs text-slate-400">{formatDate(t.date)}</p>
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full">
                      {getDayDiff(t.date)} days
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Results */}
        <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 mb-4">Recent Results</h3>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-slate-300" /></div>
          ) : recentResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-300 gap-2">
              <Clock className="w-10 h-10 text-slate-200" />
              <p className="text-xs">No results yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentResults.slice(0, 5).map((r, i) => {
                const raw = r.percentage ?? (r.maxScore > 0 ? (r.score / r.maxScore * 100) : 0);
                const pct = isFinite(raw) ? raw : 0;
                const isHigh = pct >= 80;
                const { icon, bg } = getSubjectIcon(r.testName || r.subject);
                return (
                  <div key={i} className="flex items-center justify-between p-3.5 rounded-xl hover:bg-slate-50 transition-all">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center`}>{icon}</div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{r.testName}</p>
                        <p className="text-xs text-slate-400">{formatDate(r.timestamp)}</p>
                      </div>
                    </div>
                    <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${isHigh ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-600"}`}>
                      {r.score}/{r.maxScore}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* This Term Performance */}
      <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-slate-800">This Term Performance</h3>
          <p className="text-sm text-slate-400">{stats.totalTaken} tests taken</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { val: stats.aGrade, label: "A Grade", color: "text-emerald-600", bg: "bg-emerald-50" },
            { val: stats.bGrade, label: "B Grade", color: "text-blue-600", bg: "bg-blue-50" },
            { val: stats.cGrade, label: "C Grade", color: "text-orange-500", bg: "bg-orange-50" },
            { val: stats.belowC, label: "Below C", color: "text-rose-600", bg: "bg-rose-50" },
          ].map((g, i) => (
            <div key={i} className={`${g.bg} rounded-xl p-5 text-center`}>
              <p className={`text-4xl font-bold ${g.color} mb-1`}>{g.val}</p>
              <p className="text-xs text-slate-500">{g.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TestsPage;
