import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calendar, CheckCircle, Clock, Loader2, User,
  GraduationCap, Trophy, Medal, Target, TrendingDown
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { useSchoolSettings, resolveAcademicYear } from "@/hooks/useSchoolSettings";
import { where, onSnapshot, limit } from "firebase/firestore";
import { scopedQuery } from "@/lib/scopedQuery";
import { subscribeEnrollments } from "@/lib/enrollmentQuery";
import { subscribePerStudent } from "@/lib/perStudentQuery";
import { useIsMobile } from "@/hooks/use-mobile";

const TestsPage = () => {
  const { studentData } = useAuth();
  const navigate = useNavigate();
  const settings = useSchoolSettings();
  const { gradeScale } = settings;
  // Real academic year — replaces the two hardcoded "2025–26" strings that
  // showed the same year to every school regardless of date.
  const academicYear = resolveAcademicYear(settings);
  const isMobile = useIsMobile();
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
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
    // Previously this stored ONLY the last chunk's unsub, silently leaking
    // every earlier chunk's listener after a re-render. Now every chunk's
    // unsub is collected and cleaned up on effect teardown.
    let testUnsubs: Array<() => void> = [];
    const cleanupTests = () => {
      testUnsubs.forEach(u => { try { u(); } catch { /* noop */ } });
      testUnsubs = [];
    };

    const processEnrollments = () => {
      const classIds = Array.from(new Set((enrollSnap?.docs || []).map((d: any) => d.data().classId).filter(Boolean))) as string[];
      const searchIds = classIds.length > 0 ? classIds : [studentData.classId || "General"];

      cleanupTests();
      // Chunk classIds to handle >10 (Firestore "in" limit)
      const chunks: string[][] = [];
      for (let i = 0; i < searchIds.length; i += 10) chunks.push(searchIds.slice(i, i + 10));

      const allTests: any[] = [];
      let resolved = 0;
      chunks.forEach(chunk => {
        const q = scopedQuery("tests", schoolId, where("classId", "in", chunk));
        const unsub = onSnapshot(q, (snap) => {
          if (!mountedRef.current) return;
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
        testUnsubs.push(unsub);
      });
    };

    // Dual-listener helper — also matches legacy enrollments where the
    // teacher/principal-dashboard wrote studentId as the email.
    const unsubEnroll = subscribeEnrollments(studentData, (docs) => {
      enrollSnap = { docs };
      processEnrollments();
    });

    // test_scores — dual-query (studentId + studentEmail) via shared helper
    const unsubScores = subscribePerStudent({
      collection: "test_scores",
      student: studentData,
      filters: [limit(20)],
      onChange: (docs) => {
        if (!mountedRef.current) return;
        const scores = docs
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
      },
    });

    return () => { unsubEnroll(); unsubScores(); cleanupTests(); };
  }, [studentData?.id, studentData?.schoolId, studentData?.email]);

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

        {/* ── Hero Banner (dashboard 4-stat-card vibe) ── */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Open syllabus page to prepare for upcoming test"
          onClick={() => navigate("/syllabus")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/syllabus"); } }}
          className="mx-5 mt-[18px] rounded-[22px] px-4 pt-[18px] pb-[18px] relative overflow-hidden cursor-pointer active:scale-[0.96] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
          style={{
            background: "linear-gradient(135deg, rgba(0,85,255,0.10) 0%, rgba(0,85,255,0.03) 100%)",
            boxShadow: SH,
            border: "0.5px solid rgba(0,85,255,0.20)",
            transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)",
          }}>
          <div className="absolute pointer-events-none" style={{ bottom: 10, right: 10 }}>
            <GraduationCap style={{ width: 72, height: 72, color: B1, opacity: 0.20, strokeWidth: 1.6 }} />
          </div>
          <div className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center mb-[14px] relative"
            style={{ background: "rgba(0,85,255,0.14)", border: "0.5px solid rgba(0,85,255,0.28)" }}>
            <Calendar className="w-[17px] h-[17px]" style={{ color: B1 }} />
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] relative" style={{ color: T4 }}>Coming Up Next</div>
          <div className="text-[22px] font-bold mt-1 leading-[1.15] relative" style={{ color: T1, letterSpacing: "-0.6px" }}>
            {nextTest?.testName || "No upcoming tests"}
          </div>
          {nextTest && (
            <div className="flex items-center gap-[7px] mt-[10px] relative flex-wrap">
              <span className="text-[12px] font-semibold" style={{ color: T3, letterSpacing: "-0.1px" }}>
                {formatDate(nextTest.date)}
              </span>
              {/* Only render time when the test doc provides one —
                  previously defaulted to "9:00 AM" which looked real. */}
              {nextTest.time && (
                <>
                  <div className="w-1 h-1 rounded-full" style={{ background: T4 }} />
                  <span className="text-[12px] font-semibold" style={{ color: T3 }}>{nextTest.time}</span>
                </>
              )}
              <div className="w-1 h-1 rounded-full" style={{ background: T4 }} />
              <span className="text-[12px] font-semibold" style={{ color: B1 }}>
                {getDayDiff(nextTest.date)} day{getDayDiff(nextTest.date) === 1 ? "" : "s"}
              </span>
            </div>
          )}
        </div>

        {/* ── Upcoming Tests Section ── */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Open syllabus page"
          onClick={() => navigate("/syllabus")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/syllabus"); } }}
          className="mx-5 mt-[14px] bg-white rounded-[24px] p-5 relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
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
                const subject = t.subject || t.testName || "";
                const openRow = () => navigate("/syllabus", { state: { subject } });
                return (
                  <div key={t.id || i}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open syllabus for ${subject || "test"}`}
                    onClick={(e) => { e.stopPropagation(); openRow(); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); openRow(); } }}
                    className="flex items-center gap-[13px] px-[15px] py-[13px] rounded-[18px] active:scale-[0.97] transition-transform cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
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
        <div
          role="button"
          tabIndex={0}
          aria-label="Open performance page for detailed results"
          onClick={() => navigate("/performance")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/performance"); } }}
          className="mx-5 mt-[14px] bg-white rounded-[24px] p-5 relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
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
                const subject = r.subject || r.testName || "";
                const openRow = () => navigate("/performance", { state: { subject } });
                return (
                  <div key={r.id || i}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open performance for ${subject || "result"}`}
                    onClick={(e) => { e.stopPropagation(); openRow(); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); openRow(); } }}
                    className="flex items-center gap-[13px] px-[15px] py-[13px] rounded-[18px] active:scale-[0.97] transition-transform cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
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
        <div
          role="button"
          tabIndex={0}
          aria-label="Open performance page for term breakdown"
          onClick={() => navigate("/performance")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/performance"); } }}
          className="mx-5 mt-[14px] bg-white rounded-[24px] p-5 relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
          style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
          <div className="absolute -top-10 -right-8 w-[120px] h-[120px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
          <div className="flex items-center justify-between mb-1">
            <div className="text-[17px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>This Term Performance</div>
            <div className="text-[11px] font-bold" style={{ color: B1 }}>{stats.totalTaken} taken</div>
          </div>
          <div className="grid grid-cols-2 gap-[10px] mt-3 relative z-10">
            {[
              { val: stats.aGrade, label: "A Grade", color: GREEN,  decorIcon: Trophy,        cardBg: "linear-gradient(135deg, rgba(0,200,83,0.13) 0%, rgba(0,200,83,0.04) 100%)",   cardBdr: "rgba(0,200,83,0.20)" },
              { val: stats.bGrade, label: "B Grade", color: B1,     decorIcon: Medal,         cardBg: "linear-gradient(135deg, rgba(0,85,255,0.10) 0%, rgba(0,85,255,0.03) 100%)",   cardBdr: "rgba(0,85,255,0.20)" },
              { val: stats.cGrade, label: "C Grade", color: ORANGE, decorIcon: Target,        cardBg: "linear-gradient(135deg, rgba(255,136,0,0.13) 0%, rgba(255,136,0,0.04) 100%)", cardBdr: "rgba(255,136,0,0.22)" },
              { val: stats.belowC, label: "Below C", color: RED,    decorIcon: TrendingDown,  cardBg: "linear-gradient(135deg, rgba(255,51,85,0.10) 0%, rgba(255,51,85,0.03) 100%)", cardBdr: "rgba(255,51,85,0.20)" },
            ].map(({ val, label, color, decorIcon: DecorIcon, cardBg, cardBdr }) => (
              <div key={label} className="rounded-[18px] px-4 py-[18px] relative overflow-hidden active:scale-[0.96] transition-transform"
                style={{ background: cardBg, border: `0.5px solid ${cardBdr}`, transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)" }}>
                <div className="absolute pointer-events-none" style={{ bottom: 8, right: 8 }}>
                  <DecorIcon style={{ width: 56, height: 56, color, opacity: 0.20, strokeWidth: 1.6 }} />
                </div>
                <div className="text-[36px] font-bold leading-none relative" style={{ color, letterSpacing: "-1.2px" }}>{val}</div>
                <div className="text-[11px] font-bold uppercase tracking-[0.06em] mt-[6px] relative" style={{ color }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Monthly Activity ── */}
        {!loading && stats.totalTaken > 0 && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Open performance page for monthly activity"
            onClick={() => navigate("/performance")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/performance"); } }}
            className="mx-5 mt-3 bg-white rounded-[20px] px-[18px] py-4 cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
            style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[14px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>Monthly Activity</div>
              <div className="text-[11px] font-bold" style={{ color: B1 }}>{academicYear} Term</div>
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
     DESKTOP — Bright Blue Apple UI (matches mobile)
     ═══════════════════════════════════════════════════════════════ */
  const B1 = "#0055FF", B2 = "#1166FF", B4 = "#4499FF";
  const BG = "#EEF4FF";
  const T1 = "#001040", T3 = "#5070B0", T4 = "#99AACC";
  const GREEN = "#00C853";
  const RED = "#FF3355";
  const ORANGE = "#FF8800";
  const SH = "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.09), 0 10px 24px rgba(0,85,255,0.10)";
  const SH_LG = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.11), 0 18px 44px rgba(0,85,255,0.13)";

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const toSafeDateD = (v: any): Date | null => {
    if (!v) return null;
    if (typeof v?.toDate === "function") return v.toDate();
    if (v?.seconds) return new Date(v.seconds * 1000);
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  };

  const getTestTypeTagD = (t: any) => {
    const raw = (t.type || t.testType || t.mode || t.testName || "").toString().toLowerCase();
    if (raw.includes("oral") || raw.includes("viva") || raw.includes("speak")) return { label: "Oral", cls: "orange" };
    if (raw.includes("quiz")) return { label: "Quiz", cls: "blue" };
    if (raw.includes("practical") || raw.includes("lab")) return { label: "Practical", cls: "green" };
    return { label: "Written", cls: "blue" };
  };

  const tagStyleD: Record<string, { bg: string; color: string; border: string }> = {
    blue:   { bg: "rgba(0,85,255,0.10)",  color: B1,        border: "rgba(0,85,255,0.20)" },
    green:  { bg: "rgba(0,200,83,0.10)",  color: "#007830", border: "rgba(0,200,83,0.22)" },
    orange: { bg: "rgba(255,136,0,0.10)", color: "#884400", border: "rgba(255,136,0,0.22)" },
  };

  const dateChipStyleD = (urgent: boolean) => ({
    background: urgent ? "linear-gradient(135deg, #FF6600, #FFAA33)" : `linear-gradient(135deg, #0044EE, #2277FF)`,
    boxShadow: urgent ? "0 3px 10px rgba(255,102,0,0.24)" : "0 3px 10px rgba(0,68,238,0.28)",
  });

  const scoreGradientD = (pct: number) => {
    if (pct >= 80) return { bg: "linear-gradient(135deg, #00A040, #00C853)", shadow: "0 3px 10px rgba(0,160,64,0.30)" };
    if (pct >= 60) return { bg: `linear-gradient(135deg, ${B1}, ${B2})`, shadow: "0 3px 10px rgba(0,85,255,0.30)" };
    if (pct >= 40) return { bg: "linear-gradient(135deg, #FF6600, #FFAA33)", shadow: "0 3px 10px rgba(255,102,0,0.28)" };
    return { bg: "linear-gradient(135deg, #FF3355, #FF6688)", shadow: "0 3px 10px rgba(255,51,85,0.28)" };
  };

  const nowD = new Date();
  const monthlyActivityD = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(nowD.getFullYear(), nowD.getMonth() - (5 - i), 1);
    return { label: MONTHS[d.getMonth()], year: d.getFullYear(), month: d.getMonth(), count: 0, isCurrent: i === 5 };
  });
  recentResults.forEach((r: any) => {
    const ts = toSafeDateD(r.timestamp || r.date || r.createdAt);
    if (!ts) return;
    const slot = monthlyActivityD.find(m => m.year === ts.getFullYear() && m.month === ts.getMonth());
    if (slot) slot.count += 1;
  });
  const maxMonthlyD = Math.max(1, ...monthlyActivityD.map(m => m.count));

  return (
    <div className="animate-in fade-in duration-500 -m-4 sm:-m-6 md:-m-8 min-h-[calc(100vh-64px)]"
      style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: BG }}>
      <div className="w-full px-6 pt-8 pb-12">

        {/* ── Toolbar ── */}
        <div className="flex items-start justify-between gap-6 flex-wrap mb-5">
          <div>
            <div className="text-[32px] font-bold" style={{ color: T1, letterSpacing: "-0.9px" }}>Tests &amp; Examinations</div>
            <div className="text-[14px] mt-2 font-normal" style={{ color: T3 }}>Track upcoming assessments and latest outcomes</div>
          </div>
          {stats.totalTaken > 0 && (
            <div className="px-4 py-[10px] rounded-full text-[13px] font-bold tracking-[0.02em] whitespace-nowrap"
              style={{ background: "rgba(0,85,255,0.10)", color: B1, border: "0.5px solid rgba(0,85,255,0.20)" }}>
              {stats.totalTaken} Completed
            </div>
          )}
        </div>

        {/* ── Hero Banner (dashboard 4-stat-card vibe) ── */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Open syllabus page to prepare for upcoming test"
          onClick={() => navigate("/syllabus")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/syllabus"); } }}
          className="rounded-[24px] px-6 py-6 relative overflow-hidden mb-5 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
          style={{
            background: "linear-gradient(135deg, rgba(0,85,255,0.10) 0%, rgba(0,85,255,0.03) 100%)",
            boxShadow: SH,
            border: "0.5px solid rgba(0,85,255,0.20)",
          }}>
          <div className="absolute pointer-events-none" style={{ bottom: 16, right: 20 }}>
            <GraduationCap style={{ width: 110, height: 110, color: B1, opacity: 0.18, strokeWidth: 1.6 }} />
          </div>

          <div className="flex items-center justify-between gap-6 flex-wrap relative z-10">
            <div className="flex items-center gap-4">
              <div className="w-[44px] h-[44px] rounded-[14px] flex items-center justify-center shrink-0"
                style={{ background: "rgba(0,85,255,0.14)", border: "0.5px solid rgba(0,85,255,0.28)" }}>
                <Calendar className="w-[22px] h-[22px]" style={{ color: B1 }} strokeWidth={2.2} />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.10em]" style={{ color: T4 }}>Coming Up Next</div>
                <div className="text-[28px] font-bold mt-1 leading-[1.1]" style={{ color: T1, letterSpacing: "-0.8px" }}>
                  {nextTest?.testName || "No upcoming tests"}
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {nextTest && (
                    <span className="text-[13px] font-semibold" style={{ color: T3, letterSpacing: "-0.1px" }}>
                      {formatDate(nextTest.date)}
                    </span>
                  )}
                  {/* Only render time when the test doc provides one —
                      previously defaulted to "9:00 AM" which looked real. */}
                  {nextTest?.time && (
                    <>
                      <div className="w-1 h-1 rounded-full" style={{ background: T4 }} />
                      <span className="text-[13px] font-semibold" style={{ color: T3, letterSpacing: "-0.1px" }}>
                        {nextTest.time}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {nextTest && (
              <div className="px-6 py-4 rounded-[18px] text-center min-w-[120px] relative"
                style={{ background: "rgba(0,85,255,0.08)", border: "0.5px solid rgba(0,85,255,0.20)" }}>
                <div className="text-[44px] font-bold leading-none" style={{ color: B1, letterSpacing: "-1.4px" }}>{getDayDiff(nextTest.date)}</div>
                <div className="text-[10px] font-bold uppercase tracking-widest mt-1" style={{ color: T4 }}>Days Left</div>
              </div>
            )}
          </div>
        </div>

        {/* ── Row: Upcoming + Recent ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">

          {/* Upcoming Tests */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Open syllabus page"
            onClick={() => navigate("/syllabus")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/syllabus"); } }}
            className="bg-white rounded-[24px] p-6 relative overflow-hidden cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
            style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="absolute -top-10 -right-8 w-[140px] h-[140px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
            <div className="flex items-center justify-between mb-4 relative z-10">
              <div className="text-[18px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Upcoming Tests</div>
              <div className="text-[11px] font-bold px-3 py-[4px] rounded-full tracking-[0.02em]"
                style={{ color: B1, background: "rgba(0,85,255,0.10)", border: "0.5px solid rgba(0,85,255,0.18)" }}>
                {upcomingTests.length} test{upcomingTests.length === 1 ? "" : "s"}
              </div>
            </div>

            {loading ? (
              <div className="flex flex-col items-center gap-3 py-12">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: B1 }} />
                <p className="text-xs font-medium" style={{ color: T4 }}>Loading tests…</p>
              </div>
            ) : upcomingTests.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 relative z-10">
                <div className="w-[60px] h-[60px] rounded-[20px] flex items-center justify-center"
                  style={{ background: "rgba(0,200,83,0.10)", border: "0.5px solid rgba(0,200,83,0.22)", boxShadow: "0 0 0 8px rgba(0,85,255,0.04)" }}>
                  <CheckCircle className="w-7 h-7" style={{ color: GREEN }} strokeWidth={2.2} />
                </div>
                <div className="text-[14px] font-medium" style={{ color: T4, letterSpacing: "-0.1px" }}>No upcoming tests</div>
                <div className="text-[12px] font-normal text-center max-w-[260px] leading-[1.55]" style={{ color: T4 }}>
                  You're all clear! New tests will appear here when scheduled by your teacher.
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-[10px] relative z-10">
                {upcomingTests.map((t: any, i: number) => {
                  const d = toSafeDateD(t.date || t.testDate);
                  const days = d ? getDayDiff(d.toISOString()) : 0;
                  const urgent = days <= 3;
                  const type = getTestTypeTagD(t);
                  const tag = tagStyleD[type.cls];
                  const subject = t.subject || t.testName || "";
                  const openRow = () => navigate("/syllabus", { state: { subject } });
                  return (
                    <div key={t.id || i}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open syllabus for ${subject || "test"}`}
                      onClick={(e) => { e.stopPropagation(); openRow(); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); openRow(); } }}
                      className="flex items-center gap-[13px] px-4 py-[13px] rounded-[18px] transition-all hover:-translate-y-0.5 hover:shadow-md cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                      style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.12)" }}>
                      <div className="w-12 h-12 rounded-[14px] flex flex-col items-center justify-center gap-[1px] shrink-0"
                        style={dateChipStyleD(urgent)}>
                        <div className="text-[18px] font-bold text-white leading-none">{d ? d.getDate() : "—"}</div>
                        <div className="text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: "rgba(255,255,255,0.72)" }}>
                          {d ? MONTHS[d.getMonth()] : ""}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-bold truncate mb-[3px]" style={{ color: T1, letterSpacing: "-0.2px" }}>
                          {t.testName || t.subject || "Test"}
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          {t.teacherName && (
                            <div className="flex items-center gap-1 text-[11px] font-medium" style={{ color: T3 }}>
                              <User className="w-[11px] h-[11px]" strokeWidth={2.5} />
                              <span className="truncate max-w-[120px]">{t.teacherName}</span>
                            </div>
                          )}
                          {(t.time || d) && (
                            <div className="flex items-center gap-1 text-[11px] font-medium" style={{ color: T3 }}>
                              <Clock className="w-[11px] h-[11px]" strokeWidth={2.5} />
                              {t.time || `${days} day${days === 1 ? "" : "s"}`}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="px-3 py-[5px] rounded-full text-[10px] font-bold shrink-0"
                        style={{ background: tag.bg, color: tag.color, border: `0.5px solid ${tag.border}` }}>
                        {type.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Results */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Open performance page for detailed results"
            onClick={() => navigate("/performance")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/performance"); } }}
            className="bg-white rounded-[24px] p-6 relative overflow-hidden cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
            style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="absolute -top-10 -right-8 w-[140px] h-[140px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
            <div className="flex items-center justify-between mb-4 relative z-10">
              <div className="text-[18px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Recent Results</div>
              <div className="text-[11px] font-bold px-3 py-[4px] rounded-full tracking-[0.02em]"
                style={{ color: B1, background: "rgba(0,85,255,0.10)", border: "0.5px solid rgba(0,85,255,0.18)" }}>
                {recentResults.length} result{recentResults.length === 1 ? "" : "s"}
              </div>
            </div>

            {loading ? (
              <div className="flex flex-col items-center gap-3 py-12">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: B1 }} />
                <p className="text-xs font-medium" style={{ color: T4 }}>Loading results…</p>
              </div>
            ) : recentResults.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 relative z-10">
                <div className="w-[60px] h-[60px] rounded-[20px] flex items-center justify-center"
                  style={{ background: "rgba(0,85,255,0.08)", border: "0.5px solid rgba(0,85,255,0.16)", boxShadow: "0 0 0 8px rgba(0,85,255,0.04)" }}>
                  <Clock className="w-7 h-7" style={{ color: "rgba(0,85,255,0.5)" }} strokeWidth={2.2} />
                </div>
                <div className="text-[14px] font-medium" style={{ color: T4, letterSpacing: "-0.1px" }}>No results yet</div>
                <div className="text-[12px] font-normal text-center max-w-[260px] leading-[1.55]" style={{ color: T4 }}>
                  Completed test results will be shown here after grading.
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-[10px] relative z-10">
                {recentResults.slice(0, 6).map((r: any, i: number) => {
                  const raw = r.percentage ?? (r.maxScore > 0 ? (r.score / r.maxScore * 100) : 0);
                  const pct = isFinite(raw) ? raw : 0;
                  const grad = scoreGradientD(pct);
                  const subject = r.subject || r.testName || "";
                  const openRow = () => navigate("/performance", { state: { subject } });
                  return (
                    <div key={r.id || i}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open performance for ${subject || "result"}`}
                      onClick={(e) => { e.stopPropagation(); openRow(); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); openRow(); } }}
                      className="flex items-center gap-[13px] px-4 py-[13px] rounded-[18px] transition-all hover:-translate-y-0.5 hover:shadow-md cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                      style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.12)" }}>
                      <div className="w-12 h-12 rounded-[14px] flex items-center justify-center text-[17px] font-bold text-white shrink-0"
                        style={{ background: grad.bg, boxShadow: grad.shadow }}>
                        {Math.round(pct)}%
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-bold truncate mb-[3px]" style={{ color: T1, letterSpacing: "-0.2px" }}>
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
        </div>

        {/* ── Term Performance + Monthly Activity row ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* This Term Performance (lg:col-span-2) */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Open performance page for term breakdown"
            onClick={() => navigate("/performance")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/performance"); } }}
            className="lg:col-span-2 bg-white rounded-[24px] p-6 relative overflow-hidden cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
            style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="absolute -top-10 -right-8 w-[140px] h-[140px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
            <div className="flex items-center justify-between mb-2 relative z-10">
              <div className="text-[18px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>This Term Performance</div>
              <div className="text-[12px] font-bold" style={{ color: B1 }}>{stats.totalTaken} taken</div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4 relative z-10">
              {[
                { val: stats.aGrade, label: "A Grade", color: GREEN,  decorIcon: Trophy,        cardBg: "linear-gradient(135deg, rgba(0,200,83,0.13) 0%, rgba(0,200,83,0.04) 100%)",   cardBdr: "rgba(0,200,83,0.20)" },
                { val: stats.bGrade, label: "B Grade", color: B1,     decorIcon: Medal,         cardBg: "linear-gradient(135deg, rgba(0,85,255,0.10) 0%, rgba(0,85,255,0.03) 100%)",   cardBdr: "rgba(0,85,255,0.20)" },
                { val: stats.cGrade, label: "C Grade", color: ORANGE, decorIcon: Target,        cardBg: "linear-gradient(135deg, rgba(255,136,0,0.13) 0%, rgba(255,136,0,0.04) 100%)", cardBdr: "rgba(255,136,0,0.22)" },
                { val: stats.belowC, label: "Below C", color: RED,    decorIcon: TrendingDown,  cardBg: "linear-gradient(135deg, rgba(255,51,85,0.10) 0%, rgba(255,51,85,0.03) 100%)", cardBdr: "rgba(255,51,85,0.20)" },
              ].map(({ val, label, color, decorIcon: DecorIcon, cardBg, cardBdr }) => (
                <div key={label} className="rounded-[20px] px-5 py-6 relative overflow-hidden transition-transform hover:-translate-y-0.5"
                  style={{ background: cardBg, border: `0.5px solid ${cardBdr}` }}>
                  <div className="absolute pointer-events-none" style={{ bottom: 12, right: 12 }}>
                    <DecorIcon style={{ width: 72, height: 72, color, opacity: 0.20, strokeWidth: 1.6 }} />
                  </div>
                  <div className="text-[42px] font-bold leading-none relative" style={{ color, letterSpacing: "-1.4px" }}>{val}</div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] mt-2 relative" style={{ color }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Monthly Activity */}
          {stats.totalTaken > 0 ? (
            <div
              role="button"
              tabIndex={0}
              aria-label="Open performance page for monthly activity"
              onClick={() => navigate("/performance")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/performance"); } }}
              className="bg-white rounded-[22px] px-5 py-5 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
              style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)" }}>
              <div className="flex items-center justify-between mb-4">
                <div className="text-[15px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>Monthly Activity</div>
                <div className="text-[11px] font-bold" style={{ color: B1 }}>{academicYear}</div>
              </div>
              <div className="flex items-end gap-[8px] h-[100px] mb-2">
                {monthlyActivityD.map((m, i) => {
                  const h = 8 + (m.count / maxMonthlyD) * 86;
                  const opacity = m.isCurrent ? 1 : m.count === 0 ? 0.22 : 0.55;
                  return (
                    <div key={i} className="flex flex-col items-center gap-1 flex-1">
                      <div
                        className="w-full rounded-t-[6px] min-h-[5px]"
                        style={{
                          height: h,
                          background: `linear-gradient(180deg, ${B1}, ${B4})`,
                          opacity,
                          boxShadow: m.isCurrent ? "0 0 0 3px rgba(0,85,255,0.18)" : "none",
                        }}
                      />
                      <span className="text-[10px] font-bold uppercase tracking-[0.04em]" style={{ color: m.isCurrent ? B1 : T4 }}>
                        {m.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between pt-3 mt-2" style={{ borderTop: "0.5px solid rgba(0,85,255,0.08)" }}>
                <span className="text-[11px] font-medium" style={{ color: T4 }}>Tests this month</span>
                <span className="text-[13px] font-bold" style={{ color: B1 }}>{monthlyActivityD[monthlyActivityD.length - 1].count}</span>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-[22px] px-5 py-12 flex flex-col items-center gap-3 text-center"
              style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)" }}>
              <div className="w-[60px] h-[60px] rounded-[18px] flex items-center justify-center"
                style={{ background: "rgba(0,85,255,0.08)", border: "0.5px solid rgba(0,85,255,0.16)" }}>
                <GraduationCap className="w-8 h-8" style={{ color: "rgba(0,85,255,0.5)" }} strokeWidth={2.2} />
              </div>
              <div className="text-[14px] font-bold" style={{ color: T1 }}>No activity yet</div>
              <div className="text-[11px]" style={{ color: T4 }}>Monthly test activity will appear here</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TestsPage;
