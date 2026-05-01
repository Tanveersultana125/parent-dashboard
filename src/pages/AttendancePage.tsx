import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, XCircle, Clock, ChevronLeft, ChevronRight, Loader2, Calendar as CalendarIcon, Users, TrendingUp, UserCheck, CalendarX, Hourglass, Sparkles, Flame, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { where } from "firebase/firestore";
import { subscribePerStudent } from "@/lib/perStudentQuery";
import { useIsMobile } from "@/hooks/use-mobile";
import { computeAttendanceCorrelation } from "@/ai/system/attendance-correlation";

type DayStatus = "present" | "absent" | "late" | "weekend" | "forgotten" | "empty";

const AttendancePage = () => {
  const { studentData } = useAuth();
  const navigate = useNavigate();
  const { attendanceThreshold } = useSchoolSettings();
  const isMobile = useIsMobile();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [attendanceLogs, setAttendanceLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ present: 0, absent: 0, late: 0, percentage: 0 });
  const [monthStats, setMonthStats] = useState({ present: 0, absent: 0, late: 0 });

  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    if (!studentData?.id) return;
    setLoading(true);

    // Limit to current academic year — avoids fetching 4+ years of history.
    // Academic year: June of this year if after June, else June of last year.
    const now = new Date();
    const yearStart = now.getMonth() >= 5
      ? `${now.getFullYear()}-06-01`
      : `${now.getFullYear() - 1}-06-01`;

    // Dual-query (studentId + studentEmail) via shared helper. Catches
    // attendance docs whose studentId field doesn't match the parent's auth
    // doc id (a real bug confirmed live 2026-05-01 — see memory file
    // dual_query_pattern_studentid_email.md).
    const u = subscribePerStudent({
      collection: "attendance",
      student: studentData,
      filters: [where("date", ">=", yearStart)],
      onChange: (docs) => {
        if (!mountedRef.current) return;
        const uniqueLogs = docs
          .map((d) => ({ id: d.id, ...d.data() as any }))
          // Null-safe: an attendance doc missing `date` used to crash the sort
          // with `TypeError: cannot read 'localeCompare' of undefined`.
          .sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""));
        setAttendanceLogs(uniqueLogs);

        const pCount = uniqueLogs.filter((l: any) => l.status === "present").length;
        const aCount = uniqueLogs.filter((l: any) => l.status === "absent").length;
        const lCount = uniqueLogs.filter((l: any) => l.status === "late").length;
        const total = pCount + aCount + lCount;
        // Don't fake 100% when there are zero records — that misled parents into
        // thinking the student had perfect attendance even before any class day
        // had been marked. 0 conveys "no data" without implying a positive value.
        setStats({ present: pCount, absent: aCount, late: lCount, percentage: total === 0 ? 0 : Math.round(((pCount + lCount) / total) * 100) });

        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const thisMonth = uniqueLogs.filter((l: any) => l.date?.startsWith(ym));
        setMonthStats({
          present: thisMonth.filter((l: any) => l.status === "present").length,
          absent: thisMonth.filter((l: any) => l.status === "absent").length,
          late: thisMonth.filter((l: any) => l.status === "late").length,
        });
        setLoading(false);
      },
      onError: (err) => {
        console.warn("[Attendance] listener error:", err);
        setLoading(false);
      },
    });
    return () => u();
  }, [studentData?.id, studentData?.schoolId, studentData?.email]);

  const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1).getDay();
  const handlePrevMonth = () => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1));
  const handleNextMonth = () => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1));

  // Hoisted out of getDayStatus — previously this was recreated 30+ times
  // per render (once per day of the month). Hoisting the snapshot here is
  // strictly cheaper and gives deterministic behaviour for the whole pass.
  const todayMidnightMs = new Date().setHours(0, 0, 0, 0);

  const getDayStatus = (day: number): DayStatus => {
    const d = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day);
    // Weekend check first — always weekend regardless of records
    if (d.getDay() === 0 || d.getDay() === 6) return "weekend";

    const dateStr = d.toLocaleDateString("en-CA");
    const logs = attendanceLogs.filter(l => l.date === dateStr);

    if (logs.length === 0) {
      // No records for this day — check if it's a past weekday (teacher forgot)
      if (d.getTime() < todayMidnightMs) return "forgotten";
      return "empty"; // today or future
    }

    if (logs.some(l => l.status === "absent")) return "absent";
    if (logs.some(l => l.status === "late")) return "late";
    if (logs.some(l => l.status === "present")) return "present";
    return "empty";
  };

  const monthName = selectedDate.toLocaleString("default", { month: "long", year: "numeric" });
  const recentAbsences = attendanceLogs.filter(a => a.status !== "present").slice(0, 5);

  // ── Attendance Correlation (system-driven, no AI call) ─────────────────────
  // Recomputes only when the underlying logs or student name change. Pure
  // function — no network, no side effects. See ai/system/attendance-correlation.ts.
  const correlation = useMemo(() => computeAttendanceCorrelation({
    childName: studentData?.name?.split(" ")[0] || "",
    logs: attendanceLogs,
  }), [attendanceLogs, studentData?.name]);

  /* ═══════════════════════════════════════════════════════════════
     MOBILE — Bright Blue Apple UI
     ═══════════════════════════════════════════════════════════════ */
  if (isMobile) {
    const B1 = "#0055FF", B2 = "#1166FF", B4 = "#4499FF";
    const BG = "#EEF4FF", BG2 = "#E0ECFF";
    const T1 = "#001040", T2 = "#002080", T3 = "#5070B0", T4 = "#99AACC";
    const SEP = "rgba(0,85,255,0.07)";
    const GREEN = "#00C853", GREEN_D = "#007830", GREEN_S = "rgba(0,200,83,0.10)", GREEN_B = "rgba(0,200,83,0.22)";
    const RED = "#FF3355";
    const ORANGE = "#FF8800";
    const SH = "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.09), 0 10px 28px rgba(0,85,255,0.11)";
    const SH_LG = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 20px 48px rgba(0,85,255,0.13)";
    const SH_BTN = "0 6px 22px rgba(0,85,255,0.42), 0 2px 6px rgba(0,85,255,0.22)";

    // Ring: green if at/above threshold, red otherwise
    const aboveThreshold = stats.percentage >= attendanceThreshold;
    const ringColor = aboveThreshold ? GREEN : RED;
    const ringR = 36;
    const ringCirc = 2 * Math.PI * ringR;
    const ringOffset = ringCirc - (Math.min(stats.percentage, 100) / 100) * ringCirc;

    // Real bar percentages for this-month stat cards. Previously "Present"
    // was hardcoded to 100, so a student with 2 present days in a 20-day
    // month got the same full-width bar as a student with 20 — visually
    // lying about coverage. Now the bar is present-days ÷ total-marked-days.
    const monthTotal = monthStats.present + monthStats.absent + monthStats.late;
    const presentPct = monthTotal === 0 ? 0 : Math.round((monthStats.present / monthTotal) * 100);
    const absentPct  = monthTotal === 0 ? 0 : Math.round((monthStats.absent  / monthTotal) * 100);
    const latePct    = monthTotal === 0 ? 0 : Math.round((monthStats.late    / monthTotal) * 100);

    // Current week's daily attendance bars (Mon–Fri).
    // Note: we use a dedicated midnight snapshot `todayMidnightMs` for
    // future-check so we don't mutate `now` inside the loop (the old code
    // called `now.setHours(0,0,0,0)` on every iteration, which mutated the
    // shared date object — worked by accident because setHours is idempotent
    // after the first call, but unsafe if anyone reads `now` later).
    const now = new Date();
    const jsDow = now.getDay();
    const daysFromMonday = jsDow === 0 ? 6 : jsDow - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysFromMonday);
    monday.setHours(0, 0, 0, 0);
    const todayMidnightMs = new Date().setHours(0, 0, 0, 0);
    const weekBars = Array.from({ length: 5 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = d.toLocaleDateString("en-CA");
      const isFuture = d.getTime() > todayMidnightMs;
      const log = attendanceLogs.find(l => l.date === dateStr);
      const isToday = d.toDateString() === new Date().toDateString();
      const status = log?.status || (isFuture ? "future" : "none");
      return { label: ["Mon", "Tue", "Wed", "Thu", "Fri"][i], status, isToday, isFuture };
    });

    const studentFirstName = studentData?.name?.split(" ")[0] || "Student";

    return (
      <div className="animate-in fade-in duration-500 -mx-3 -mt-3 md:mx-0 md:mt-0"
        style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: BG, minHeight: "100vh" }}>

        {/* ── Page Head ── */}
        <div className="flex items-start justify-between px-[22px] pt-[18px]">
          <div>
            <div className="text-[24px] font-bold" style={{ color: T1, letterSpacing: "-0.6px" }}>Attendance Tracking</div>
            <div className="text-[12px] mt-[3px] font-normal" style={{ color: T3 }}>Monitor daily presence and monthly patterns</div>
          </div>
          <div className="px-3 py-[5px] rounded-full text-[11px] font-bold tracking-[0.02em] whitespace-nowrap mt-1 shrink-0"
            style={{ background: GREEN_S, color: GREEN_D, border: `0.5px solid ${GREEN_B}` }}>
            {stats.percentage}% AVG
          </div>
        </div>

        {/* ── Stat Grid 2×2 ── */}
        <div className="grid grid-cols-2 gap-[10px] mx-5 mt-4">
          {[
            {
              icon: CheckCircle, decorIcon: TrendingUp, iconColor: GREEN,
              cardBg: "linear-gradient(135deg, rgba(0,200,83,0.13) 0%, rgba(0,200,83,0.04) 100%)", cardBdr: "rgba(0,200,83,0.20)",
              iconBoxBg: "rgba(0,200,83,0.18)", iconBoxBdr: "rgba(0,200,83,0.30)",
              label: "Overall", value: `${stats.percentage}%`, valColor: GREEN,
              bar: `linear-gradient(90deg, ${GREEN}, #66EE99)`, barPct: Math.max(stats.percentage, 3),
              route: "/reports"
            },
            {
              icon: Users, decorIcon: UserCheck, iconColor: B1,
              cardBg: "linear-gradient(135deg, rgba(0,85,255,0.10) 0%, rgba(0,85,255,0.03) 100%)", cardBdr: "rgba(0,85,255,0.20)",
              iconBoxBg: "rgba(0,85,255,0.14)", iconBoxBdr: "rgba(0,85,255,0.28)",
              label: "Present", value: monthStats.present.toString(), valColor: B1,
              bar: `linear-gradient(90deg, ${B1}, ${B4})`, barPct: presentPct,
              route: "/reports"
            },
            {
              icon: XCircle, decorIcon: CalendarX, iconColor: RED,
              cardBg: "linear-gradient(135deg, rgba(255,51,85,0.10) 0%, rgba(255,51,85,0.03) 100%)", cardBdr: "rgba(255,51,85,0.20)",
              iconBoxBg: "rgba(255,51,85,0.14)", iconBoxBdr: "rgba(255,51,85,0.30)",
              label: "Absent", value: monthStats.absent.toString(), valColor: RED,
              bar: `linear-gradient(90deg, ${RED}, #FF8899)`, barPct: absentPct,
              route: "/alerts"
            },
            {
              icon: Clock, decorIcon: Hourglass, iconColor: ORANGE,
              cardBg: "linear-gradient(135deg, rgba(255,136,0,0.13) 0%, rgba(255,136,0,0.04) 100%)", cardBdr: "rgba(255,136,0,0.22)",
              iconBoxBg: "rgba(255,136,0,0.18)", iconBoxBdr: "rgba(255,136,0,0.32)",
              label: "Late", value: monthStats.late.toString(), valColor: ORANGE,
              bar: `linear-gradient(90deg, ${ORANGE}, #FFB366)`, barPct: latePct,
              route: "/alerts"
            },
          ].map(({ icon: Icon, decorIcon: DecorIcon, iconColor, cardBg, cardBdr, iconBoxBg, iconBoxBdr, label, value, valColor, bar, barPct, route }) => (
            <div
              key={label}
              role="button"
              tabIndex={0}
              aria-label={`Open ${route === "/alerts" ? "alerts" : "reports"} page for ${label}`}
              onClick={() => navigate(route)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(route); } }}
              className="rounded-[22px] px-4 py-[18px] relative overflow-hidden cursor-pointer active:scale-[0.96] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
              style={{ background: cardBg, boxShadow: SH, border: `0.5px solid ${cardBdr}`, transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)" }}>
              <div className="absolute pointer-events-none" style={{ bottom: 10, right: 10 }}>
                <DecorIcon style={{ width: 60, height: 60, color: iconColor, opacity: 0.20, strokeWidth: 1.6 }} />
              </div>
              <div className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center mb-3 relative"
                style={{ background: iconBoxBg, border: `0.5px solid ${iconBoxBdr}` }}>
                <Icon className="w-[17px] h-[17px]" style={{ color: iconColor }} strokeWidth={2.2} />
              </div>
              <div className="text-[26px] font-bold leading-none mb-[5px] relative" style={{ color: valColor, letterSpacing: "-0.6px" }}>{value}</div>
              <div className="text-[9px] font-bold uppercase tracking-[0.09em] relative" style={{ color: T4 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* ── This Month Ring Summary ── */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Open reports page for monthly attendance"
          onClick={() => navigate("/reports")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/reports"); } }}
          className="mx-5 mt-3 bg-white rounded-[24px] p-5 flex items-center gap-5 cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
          style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
          <div className="flex-1">
            <div className="text-[16px] font-bold mb-1" style={{ color: T1, letterSpacing: "-0.3px" }}>This Month</div>
            <div className="text-[12px] mb-[14px] font-normal" style={{ color: T3 }}>{monthName} summary</div>
            <div className="flex items-center gap-[7px] mb-[6px]">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: GREEN }} />
              <span className="text-[12px] font-bold" style={{ color: T2 }}>Present</span>
              <span className="text-[12px] font-bold ml-auto" style={{ color: GREEN }}>{monthStats.present} {monthStats.present === 1 ? "day" : "days"}</span>
            </div>
            <div className="flex items-center gap-[7px] mb-[6px]">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: RED }} />
              <span className="text-[12px] font-bold" style={{ color: T2 }}>Absent</span>
              <span className="text-[12px] font-bold ml-auto" style={{ color: RED }}>{monthStats.absent} {monthStats.absent === 1 ? "day" : "days"}</span>
            </div>
            <div className="flex items-center gap-[7px]">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: ORANGE }} />
              <span className="text-[12px] font-bold" style={{ color: T2 }}>Late</span>
              <span className="text-[12px] font-bold ml-auto" style={{ color: ORANGE }}>{monthStats.late} {monthStats.late === 1 ? "day" : "days"}</span>
            </div>
          </div>
          <div className="relative w-[90px] h-[90px] shrink-0">
            <svg width="90" height="90" viewBox="0 0 90 90" style={{ transform: "rotate(-90deg)" }}>
              <defs>
                <linearGradient id="attRingGreen" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={GREEN} />
                  <stop offset="100%" stopColor="#66EE88" />
                </linearGradient>
                <linearGradient id="attRingRed" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={RED} />
                  <stop offset="100%" stopColor="#FF8899" />
                </linearGradient>
              </defs>
              <circle cx="45" cy="45" r={ringR} fill="none" stroke="rgba(0,85,255,0.08)" strokeWidth="8" />
              <circle cx="45" cy="45" r={ringR} fill="none" stroke={aboveThreshold ? "url(#attRingGreen)" : "url(#attRingRed)"} strokeWidth="8" strokeLinecap="round"
                strokeDasharray={ringCirc} strokeDashoffset={ringOffset}
                style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)" }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[20px] font-bold leading-none" style={{ color: ringColor, letterSpacing: "-0.5px" }}>{stats.percentage}%</div>
              <div className="text-[9px] font-bold uppercase tracking-[0.08em] mt-1" style={{ color: T4 }}>Rate</div>
            </div>
          </div>
        </div>

        {/* ── Calendar ── */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Open reports page for attendance detail"
          onClick={() => navigate("/reports")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/reports"); } }}
          className="mx-5 mt-3 bg-white rounded-[24px] p-5 cursor-pointer transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
          style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
          <div className="flex items-center justify-between mb-4">
            <button onClick={(e) => { e.stopPropagation(); handlePrevMonth(); }} aria-label="Previous month"
              className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center active:scale-[0.88] transition-transform"
              style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.12)", transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)" }}>
              <ChevronLeft className="w-[14px] h-[14px]" style={{ color: "rgba(0,85,255,0.7)" }} strokeWidth={2.5} />
            </button>
            <div className="flex items-center gap-[7px]">
              <div className="w-7 h-7 rounded-[9px] flex items-center justify-center"
                style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 2px 8px rgba(0,85,255,0.28)" }}>
                <CalendarIcon className="w-[14px] h-[14px] text-white" strokeWidth={2.2} />
              </div>
              <span className="text-[16px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>{monthName}</span>
            </div>
            <button onClick={(e) => { e.stopPropagation(); handleNextMonth(); }} aria-label="Next month"
              className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center active:scale-[0.88] transition-transform"
              style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.12)", transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)" }}>
              <ChevronRight className="w-[14px] h-[14px]" style={{ color: "rgba(0,85,255,0.7)" }} strokeWidth={2.5} />
            </button>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-[14px] mb-[14px]">
            <div className="flex items-center gap-[5px] text-[10px] font-bold tracking-[0.04em]" style={{ color: T3 }}>
              <div className="w-2 h-2 rounded-full" style={{ background: GREEN }} />Present
            </div>
            <div className="flex items-center gap-[5px] text-[10px] font-bold tracking-[0.04em]" style={{ color: T3 }}>
              <div className="w-2 h-2 rounded-full" style={{ background: RED }} />Absent
            </div>
            <div className="flex items-center gap-[5px] text-[10px] font-bold tracking-[0.04em]" style={{ color: T3 }}>
              <div className="w-2 h-2 rounded-full" style={{ background: ORANGE }} />Late
            </div>
          </div>

          {/* Day names */}
          <div className="grid grid-cols-7 mb-[6px]">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
              <div key={d} className="text-center py-1 text-[10px] font-bold uppercase tracking-[0.05em]" style={{ color: T4 }}>{d}</div>
            ))}
          </div>

          {loading ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: B1 }} />
              <p className="text-xs font-medium" style={{ color: T4 }}>Syncing logs…</p>
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-[4px]">
              {Array.from({ length: firstDayOfMonth(selectedDate) }).map((_, i) => (
                <div key={`e-${i}`} className="aspect-square" />
              ))}
              {Array.from({ length: daysInMonth(selectedDate) }).map((_, i) => {
                const day = i + 1;
                const status = getDayStatus(day);
                const todayDate = new Date();
                const isToday =
                  selectedDate.getFullYear() === todayDate.getFullYear() &&
                  selectedDate.getMonth() === todayDate.getMonth() &&
                  day === todayDate.getDate();

                const cellStyle: React.CSSProperties = (() => {
                  if (isToday) {
                    return {
                      background: `linear-gradient(135deg, ${B1}, ${B2})`,
                      color: "#fff",
                      fontWeight: 700,
                      boxShadow: "0 4px 14px rgba(0,85,255,0.36), 0 1px 4px rgba(0,85,255,0.22)",
                    };
                  }
                  switch (status) {
                    case "present":
                      return { background: "rgba(0,200,83,0.10)", color: GREEN_D, border: "0.5px solid rgba(0,200,83,0.18)", fontWeight: 600 };
                    case "absent":
                      return { background: "rgba(255,51,85,0.10)", color: RED, border: "0.5px solid rgba(255,51,85,0.18)", fontWeight: 600 };
                    case "late":
                      return { background: "rgba(255,136,0,0.10)", color: ORANGE, border: "0.5px solid rgba(255,136,0,0.18)", fontWeight: 600 };
                    case "weekend":
                      return { color: T4, fontWeight: 500 };
                    case "forgotten":
                      return { color: T4, opacity: 0.7, fontWeight: 500 };
                    default:
                      return { color: T2, fontWeight: 500 };
                  }
                })();

                return (
                  <div key={day} className="aspect-square rounded-[12px] flex items-center justify-center text-[13px] relative" style={cellStyle}>
                    {day}
                    {!isToday && (status === "present" || status === "absent" || status === "late") && (
                      <span
                        className="absolute bottom-[3px] left-1/2 -translate-x-1/2 w-[5px] h-[5px] rounded-full"
                        style={{ background: status === "present" ? GREEN : status === "absent" ? RED : ORANGE }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Weekly Attendance Bars ── */}
        {!loading && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Open reports page for weekly attendance"
            onClick={() => navigate("/reports")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/reports"); } }}
            className="mx-5 mt-3 bg-white rounded-[22px] px-5 py-[18px] cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
            style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="text-[14px] font-bold mb-[14px]" style={{ color: T1, letterSpacing: "-0.2px" }}>Weekly Attendance</div>
            <div className="flex items-end justify-between gap-[6px] h-[52px] mb-2">
              {weekBars.map((b, i) => {
                const h =
                  b.status === "present" ? 44 :
                  b.status === "late" ? 32 :
                  b.status === "absent" ? 14 :
                  b.status === "future" ? 18 : 18;
                const bg =
                  b.status === "present" ? `linear-gradient(180deg, ${B1}, ${B4})` :
                  b.status === "late" ? `linear-gradient(180deg, ${ORANGE}, #FFB366)` :
                  b.status === "absent" ? `linear-gradient(180deg, ${RED}, #FF8899)` :
                  BG2;
                const isHighlight = b.isToday;
                return (
                  <div key={i} className="flex flex-col items-center gap-1 flex-1">
                    <div
                      className="w-full rounded-t-[5px] min-h-[4px] transition-all duration-300"
                      style={{
                        height: h,
                        background: bg,
                        boxShadow: isHighlight ? "0 0 0 3px rgba(0,85,255,0.20)" : "none"
                      }}
                    />
                    <span className="text-[9px] font-bold uppercase tracking-[0.04em]"
                      style={{ color: isHighlight ? B1 : T4 }}>
                      {b.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Recent Absences ── */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Open alerts page"
          onClick={() => navigate("/alerts")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/alerts"); } }}
          className="mx-5 mt-3 bg-white rounded-[24px] p-5 cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
          style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
          <div className="text-[16px] font-bold mb-4" style={{ color: T1, letterSpacing: "-0.3px" }}>Recent Absences</div>

          {recentAbsences.length === 0 ? (
            // Only celebrate "perfect attendance" when there's ACTUAL attendance
            // data to back it up. Otherwise (new student, no class days marked
            // yet, etc.) say so honestly — the previous version cheered for
            // students whose attendance had never been recorded.
            attendanceLogs.length === 0 ? (
              <div className="flex flex-col items-center gap-[10px] pt-5 pb-2">
                <div className="w-[60px] h-[60px] rounded-[20px] flex items-center justify-center"
                  style={{ background: "rgba(48,48,110,0.06)", border: `0.5px solid rgba(48,48,110,0.12)` }}>
                  <CalendarIcon className="w-7 h-7" style={{ color: T4 }} strokeWidth={2.2} />
                </div>
                <div className="text-[14px] font-semibold" style={{ color: T3 }}>No attendance recorded yet</div>
                <div className="text-[12px] text-center max-w-[220px] leading-[1.55] font-normal" style={{ color: T4 }}>
                  Once your child's teacher starts marking attendance, the records will appear here.
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-[10px] pt-5 pb-2">
                <div className="w-[60px] h-[60px] rounded-[20px] flex items-center justify-center"
                  style={{ background: GREEN_S, border: `0.5px solid ${GREEN_B}`, boxShadow: "0 0 0 8px rgba(0,200,83,0.05)" }}>
                  <CheckCircle className="w-7 h-7" style={{ color: GREEN }} strokeWidth={2.2} />
                </div>
                <div className="text-[14px] font-semibold" style={{ color: T3 }}>Perfect attendance! 🎉</div>
                <div className="text-[12px] text-center max-w-[200px] leading-[1.55] font-normal" style={{ color: T4 }}>
                  No absences recorded this month. Keep it up!
                </div>
              </div>
            )
          ) : (
            recentAbsences.map((a: any, i: number, arr: any[]) => {
              const isAbsent = a.status === "absent";
              const parts = a.date?.split("-");
              const dateObj = parts?.length === 3
                ? new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
                : new Date(a.date);
              const dateStr = dateObj.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
              return (
                <div key={i}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open alerts page for ${dateStr} ${isAbsent ? "absence" : "late"}`}
                  onClick={() => navigate("/alerts")}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/alerts"); } }}
                  className="flex items-center gap-[13px] py-3 cursor-pointer active:bg-[#EEF4FF] transition-colors rounded-[12px] -mx-2 px-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                  style={{ borderBottom: i < arr.length - 1 ? `0.5px solid ${SEP}` : "none" }}>
                  <div className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0"
                    style={{
                      background: isAbsent ? "rgba(255,51,85,0.10)" : "rgba(255,136,0,0.10)",
                      border: `0.5px solid ${isAbsent ? "rgba(255,51,85,0.22)" : "rgba(255,136,0,0.22)"}`
                    }}>
                    {isAbsent
                      ? <XCircle className="w-[18px] h-[18px]" style={{ color: RED }} strokeWidth={2.2} />
                      : <Clock className="w-[18px] h-[18px]" style={{ color: ORANGE }} strokeWidth={2.2} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>{dateStr}</div>
                    <div className="text-[11px] mt-0.5 truncate font-normal" style={{ color: T3 }}>
                      {a.note || (isAbsent ? "Reason: Not specified" : "Arrived late")}
                    </div>
                  </div>
                  <div className="px-[11px] py-1 rounded-full text-[10px] font-bold shrink-0"
                    style={{
                      background: isAbsent ? "rgba(255,51,85,0.10)" : "rgba(255,136,0,0.10)",
                      color: isAbsent ? RED : ORANGE,
                      border: `0.5px solid ${isAbsent ? "rgba(255,51,85,0.22)" : "rgba(255,136,0,0.22)"}`
                    }}>
                    {isAbsent ? "Absent" : "Late"}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Policy Card (blue gradient) ── */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Open settings to view attendance policy"
          onClick={() => navigate("/settings")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/settings"); } }}
          className="mx-5 mt-3 rounded-[22px] px-5 py-[18px] relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          style={{
            background: `linear-gradient(135deg, ${B1} 0%, ${B2} 100%)`,
            boxShadow: SH_BTN,
            border: "0.5px solid rgba(255,255,255,0.16)"
          }}>
          <div className="absolute -top-[30px] -right-5 w-[150px] h-[150px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(255,255,255,0.14) 0%, transparent 65%)" }} />
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
            backgroundSize: "24px 24px"
          }} />
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] mb-2 relative z-10" style={{ color: "rgba(255,255,255,0.52)" }}>
            Attendance Policy
          </div>
          <p className="text-[13px] leading-[1.6] font-normal mb-[14px] relative z-10" style={{ color: "rgba(255,255,255,0.82)" }}>
            Minimum {attendanceThreshold}% attendance required for exam eligibility. Students below the threshold will be notified.
          </p>
          <div className="flex items-center gap-2 pt-3 relative z-10" style={{ borderTop: "0.5px solid rgba(255,255,255,0.16)" }}>
            <div className="w-[22px] h-[22px] rounded-[7px] flex items-center justify-center shrink-0"
              style={{
                background: aboveThreshold ? GREEN_S : "rgba(255,51,85,0.15)",
                border: `0.5px solid ${aboveThreshold ? GREEN_B : "rgba(255,51,85,0.30)"}`
              }}>
              {aboveThreshold
                ? <CheckCircle className="w-3 h-3" style={{ color: GREEN }} strokeWidth={2.5} />
                : <XCircle className="w-3 h-3" style={{ color: "#fff" }} strokeWidth={2.5} />}
            </div>
            <span className="text-[13px] font-bold text-white" style={{ letterSpacing: "-0.1px" }}>
              {studentFirstName} is {aboveThreshold ? "above the threshold" : "below the requirement"}
            </span>
          </div>
        </div>

        {/* ── Attendance Correlation Insight (system-driven) ── */}
        {!loading && (() => {
          const bandTone = correlation.band === "excellent" ? { c: GREEN, bg: GREEN_S, bdr: GREEN_B }
            : correlation.band === "good" ? { c: B1, bg: "rgba(0,85,255,0.07)", bdr: "rgba(0,85,255,0.18)" }
            : correlation.band === "needs_improvement" ? { c: ORANGE, bg: "rgba(255,136,0,0.08)", bdr: "rgba(255,136,0,0.22)" }
            : { c: RED, bg: "rgba(255,51,85,0.07)", bdr: "rgba(255,51,85,0.20)" };
          return (
            <div className="mx-5 mt-3 bg-white rounded-[22px] overflow-hidden"
              style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
              <div className="flex items-center gap-3 px-5 py-4 relative overflow-hidden"
                style={{ background: "linear-gradient(140deg, #001888 0%, #0033CC 48%, #0055FF 100%)" }}>
                <div className="absolute -top-7 -right-4 w-[120px] h-[120px] rounded-full pointer-events-none"
                  style={{ background: "radial-gradient(circle, rgba(255,255,255,0.10) 0%, transparent 65%)" }} />
                <div className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center relative z-10"
                  style={{ background: "rgba(255,255,255,0.18)", border: "0.5px solid rgba(255,255,255,0.26)" }}>
                  <Sparkles className="w-4 h-4 text-white" strokeWidth={2.2} />
                </div>
                <div className="relative z-10">
                  <div className="text-[15px] font-bold text-white" style={{ letterSpacing: "-0.3px" }}>Attendance Correlation</div>
                  <div className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>How presence is shaping {studentFirstName}'s learning</div>
                </div>
              </div>

              {/* Band pill + narrative */}
              <div className="px-5 py-4">
                <div className="inline-flex items-center gap-[6px] px-[11px] py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.04em] mb-[10px]"
                  style={{ background: bandTone.bg, color: bandTone.c, border: `0.5px solid ${bandTone.bdr}` }}>
                  <span className="w-[6px] h-[6px] rounded-full" style={{ background: bandTone.c }} />
                  {correlation.band_label}
                </div>
                <p className="text-[13px] leading-[1.6]" style={{ color: T2 }}>
                  {correlation.correlation_narrative}
                </p>
              </div>

              {/* Streak + day pattern */}
              {(correlation.streak.longest_streak > 0 || correlation.day_pattern.weekday) && (
                <div className="px-5 pb-4 flex flex-col gap-[10px]">
                  {correlation.streak.longest_streak > 0 && (
                    <div className="flex items-center gap-[10px] px-[14px] py-[10px] rounded-[14px]"
                      style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                      <div className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center shrink-0"
                        style={{ background: "rgba(255,136,0,0.12)", border: "0.5px solid rgba(255,136,0,0.24)" }}>
                        <Flame className="w-[15px] h-[15px]" style={{ color: ORANGE }} strokeWidth={2.2} />
                      </div>
                      <div className="flex-1">
                        <div className="text-[12px] font-bold" style={{ color: T1 }}>
                          Current streak: {correlation.streak.current_streak} {correlation.streak.current_streak === 1 ? "day" : "days"}
                          <span className="font-normal" style={{ color: T3 }}> · best: {correlation.streak.longest_streak}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  {correlation.day_pattern.weekday && (
                    <div className="flex items-center gap-[10px] px-[14px] py-[10px] rounded-[14px]"
                      style={{ background: "rgba(255,51,85,0.05)", border: "0.5px solid rgba(255,51,85,0.16)" }}>
                      <div className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center shrink-0"
                        style={{ background: "rgba(255,51,85,0.10)", border: "0.5px solid rgba(255,51,85,0.22)" }}>
                        <AlertTriangle className="w-[14px] h-[14px]" style={{ color: RED }} strokeWidth={2.2} />
                      </div>
                      <div className="flex-1">
                        <div className="text-[12px] font-bold" style={{ color: T1 }}>
                          Pattern: most absences on {correlation.day_pattern.weekday}s
                          <span className="font-normal" style={{ color: T3 }}> ({correlation.day_pattern.absence_count})</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Impact analysis */}
              <div className="px-5 pb-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.10em] mb-[8px]" style={{ color: T4 }}>Impact analysis</div>
                <div className="flex flex-col gap-2">
                  {correlation.impact_analysis.map((pt, i) => (
                    <div key={i} className="flex items-start gap-[10px]">
                      <div className="w-[18px] h-[18px] rounded-[6px] flex items-center justify-center text-[10px] font-bold shrink-0 mt-[1px]"
                        style={{ background: "rgba(0,85,255,0.08)", color: B1, border: "0.5px solid rgba(0,85,255,0.16)" }}>
                        {i + 1}
                      </div>
                      <p className="text-[12px] leading-[1.55]" style={{ color: T2 }}>{pt}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Growth strategy */}
              <div className="mx-5 mb-4 rounded-[16px] px-4 py-[14px]"
                style={{ background: bandTone.bg, border: `0.5px solid ${bandTone.bdr}` }}>
                <div className="text-[10px] font-bold uppercase tracking-[0.10em] mb-[5px]" style={{ color: bandTone.c }}>Next step</div>
                <p className="text-[12px] leading-[1.55]" style={{ color: T2 }}>{correlation.growth_strategy}</p>
              </div>
            </div>
          );
        })()}

        {/* ── Exam Eligibility Threshold Bar ── */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Open settings to view attendance threshold"
          onClick={() => navigate("/settings")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/settings"); } }}
          className="mx-5 mt-3 bg-white rounded-[22px] px-5 py-[18px] cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
          style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)" }}>
          <div className="flex items-end justify-between mb-[10px]">
            <div>
              <div className="text-[13px] font-bold" style={{ color: T1, letterSpacing: "-0.2px", marginBottom: 2 }}>Exam Eligibility</div>
              <div className="text-[11px] font-normal" style={{ color: T3 }}>{attendanceThreshold}% threshold required</div>
            </div>
            <div className="text-[18px] font-bold" style={{ color: aboveThreshold ? GREEN : RED, letterSpacing: "-0.4px" }}>
              {stats.percentage}%
            </div>
          </div>
          <div className="h-2 rounded-[4px] overflow-hidden relative mb-[6px]" style={{ background: BG2 }}>
            <div className="h-full rounded-[4px]"
              style={{
                width: `${Math.min(stats.percentage, 100)}%`,
                background: aboveThreshold
                  ? `linear-gradient(90deg, ${GREEN}, #66EE88)`
                  : `linear-gradient(90deg, ${RED}, #FF8899)`
              }} />
            <div className="absolute -top-[2px] w-[2px] h-3 rounded-[1px]"
              style={{ left: `${Math.min(attendanceThreshold, 100)}%`, background: "rgba(0,85,255,0.4)" }} />
          </div>
          <div className="flex justify-between">
            <span className="text-[10px] font-bold" style={{ color: aboveThreshold ? GREEN : RED }}>{stats.percentage}% current</span>
            <span className="text-[10px] font-bold" style={{ color: "rgba(0,85,255,0.5)" }}>{attendanceThreshold}% required</span>
          </div>
        </div>

        <div className="h-6" />
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     DESKTOP — Bright Blue Apple UI (matches mobile)
     ═══════════════════════════════════════════════════════════════ */
  const B1 = "#0055FF", B2 = "#1166FF", B4 = "#4499FF";
  const BG = "#EEF4FF", BG2 = "#E0ECFF";
  const T1 = "#001040", T2 = "#002080", T3 = "#5070B0", T4 = "#99AACC";
  const SEP = "rgba(0,85,255,0.07)";
  const GREEN = "#00C853", GREEN_D = "#007830", GREEN_S = "rgba(0,200,83,0.10)", GREEN_B = "rgba(0,200,83,0.22)";
  const RED = "#FF3355";
  const ORANGE = "#FF8800";
  const SH = "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.09), 0 10px 28px rgba(0,85,255,0.11)";
  const SH_LG = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 20px 48px rgba(0,85,255,0.13)";
  const SH_BTN = "0 6px 22px rgba(0,85,255,0.42), 0 2px 6px rgba(0,85,255,0.22)";

  const aboveThreshold = stats.percentage >= attendanceThreshold;
  const ringColor = aboveThreshold ? GREEN : RED;
  const ringR = 52;
  const ringCirc = 2 * Math.PI * ringR;
  const ringOffset = ringCirc - (Math.min(stats.percentage, 100) / 100) * ringCirc;

  // Real bar percentages for this-month stat cards (see mobile comment above).
  const monthTotalD = monthStats.present + monthStats.absent + monthStats.late;
  const presentPctD = monthTotalD === 0 ? 0 : Math.round((monthStats.present / monthTotalD) * 100);
  const absentPctD  = monthTotalD === 0 ? 0 : Math.round((monthStats.absent  / monthTotalD) * 100);
  const latePctD    = monthTotalD === 0 ? 0 : Math.round((monthStats.late    / monthTotalD) * 100);

  // Current week bars
  const nowD = new Date();
  const jsDowD = nowD.getDay();
  const daysFromMondayD = jsDowD === 0 ? 6 : jsDowD - 1;
  const mondayD = new Date(nowD);
  mondayD.setDate(nowD.getDate() - daysFromMondayD);
  mondayD.setHours(0, 0, 0, 0);
  const weekBarsD = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(mondayD);
    d.setDate(mondayD.getDate() + i);
    const dateStr = d.toLocaleDateString("en-CA");
    const nowChk = new Date(); nowChk.setHours(0, 0, 0, 0);
    const isFuture = d.getTime() > nowChk.getTime();
    const log = attendanceLogs.find(l => l.date === dateStr);
    const isToday = d.toDateString() === new Date().toDateString();
    const status = log?.status || (isFuture ? "future" : "none");
    return { label: ["Mon", "Tue", "Wed", "Thu", "Fri"][i], status, isToday, isFuture };
  });

  const studentFirstName = studentData?.name?.split(" ")[0] || "Student";

  return (
    <div className="animate-in fade-in duration-500 -m-4 sm:-m-6 md:-m-8 min-h-[calc(100vh-64px)]"
      style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: BG }}>
      <div className="w-full px-6 pt-8 pb-12">

        {/* ── Toolbar ── */}
        <div className="flex items-start justify-between gap-6 flex-wrap mb-6">
          <div>
            <div className="text-[32px] font-bold" style={{ color: T1, letterSpacing: "-0.9px" }}>Attendance Tracking</div>
            <div className="text-[14px] mt-2 font-normal" style={{ color: T3 }}>Monitor daily presence and monthly patterns</div>
          </div>
          <div className="px-4 py-[10px] rounded-full text-[13px] font-bold tracking-[0.02em] whitespace-nowrap"
            style={{ background: GREEN_S, color: GREEN_D, border: `0.5px solid ${GREEN_B}` }}>
            {stats.percentage}% Avg
          </div>
        </div>

        {/* ── 4 Stat Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
          {[
            { icon: CheckCircle, decorIcon: TrendingUp, iconColor: GREEN, cardBg: "linear-gradient(135deg, rgba(0,200,83,0.13) 0%, rgba(0,200,83,0.04) 100%)", cardBdr: "rgba(0,200,83,0.20)", iconBoxBg: "rgba(0,200,83,0.18)", iconBoxBdr: "rgba(0,200,83,0.30)", label: "Overall", value: `${stats.percentage}%`, valColor: GREEN, bar: `linear-gradient(90deg, ${GREEN}, #66EE99)`, barPct: Math.max(stats.percentage, 3), route: "/reports" },
            { icon: Users, decorIcon: UserCheck, iconColor: B1, cardBg: "linear-gradient(135deg, rgba(0,85,255,0.10) 0%, rgba(0,85,255,0.03) 100%)", cardBdr: "rgba(0,85,255,0.20)", iconBoxBg: "rgba(0,85,255,0.14)", iconBoxBdr: "rgba(0,85,255,0.28)", label: "Present", value: monthStats.present.toString(), valColor: B1, bar: `linear-gradient(90deg, ${B1}, ${B4})`, barPct: presentPctD, route: "/reports" },
            { icon: XCircle, decorIcon: CalendarX, iconColor: RED, cardBg: "linear-gradient(135deg, rgba(255,51,85,0.10) 0%, rgba(255,51,85,0.03) 100%)", cardBdr: "rgba(255,51,85,0.20)", iconBoxBg: "rgba(255,51,85,0.14)", iconBoxBdr: "rgba(255,51,85,0.30)", label: "Absent", value: monthStats.absent.toString(), valColor: RED, bar: `linear-gradient(90deg, ${RED}, #FF8899)`, barPct: absentPctD, route: "/alerts" },
            { icon: Clock, decorIcon: Hourglass, iconColor: ORANGE, cardBg: "linear-gradient(135deg, rgba(255,136,0,0.13) 0%, rgba(255,136,0,0.04) 100%)", cardBdr: "rgba(255,136,0,0.22)", iconBoxBg: "rgba(255,136,0,0.18)", iconBoxBdr: "rgba(255,136,0,0.32)", label: "Late", value: monthStats.late.toString(), valColor: ORANGE, bar: `linear-gradient(90deg, ${ORANGE}, #FFB366)`, barPct: latePctD, route: "/alerts" },
          ].map(({ icon: Icon, decorIcon: DecorIcon, iconColor, cardBg, cardBdr, iconBoxBg, iconBoxBdr, label, value, valColor, bar, barPct, route }) => (
            <div
              key={label}
              role="button"
              tabIndex={0}
              aria-label={`Open ${route === "/alerts" ? "alerts" : "reports"} page for ${label}`}
              onClick={() => navigate(route)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(route); } }}
              className="rounded-[22px] px-5 py-5 relative overflow-hidden cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
              style={{ background: cardBg, boxShadow: SH, border: `0.5px solid ${cardBdr}` }}>
              <div className="absolute pointer-events-none" style={{ bottom: 14, right: 14 }}>
                <DecorIcon style={{ width: 80, height: 80, color: iconColor, opacity: 0.20, strokeWidth: 1.6 }} />
              </div>
              <div className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center mb-4 relative"
                style={{ background: iconBoxBg, border: `0.5px solid ${iconBoxBdr}` }}>
                <Icon className="w-[18px] h-[18px]" style={{ color: iconColor }} strokeWidth={2.2} />
              </div>
              <div className="text-[34px] font-bold leading-none mb-[5px] relative" style={{ color: valColor, letterSpacing: "-1px" }}>{value}</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.10em] relative" style={{ color: T4 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* ── Main row: Calendar (3) + Sidebar (2) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

          {/* Calendar (lg:col-span-3) */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Open reports page for attendance detail"
            onClick={() => navigate("/reports")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/reports"); } }}
            className="lg:col-span-3 bg-white rounded-[24px] p-6 cursor-pointer transition-all hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
            style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
              <div className="flex items-center gap-2">
                <button onClick={(e) => { e.stopPropagation(); handlePrevMonth(); }} aria-label="Previous month"
                  className="w-10 h-10 rounded-[12px] flex items-center justify-center transition-transform hover:scale-[1.05]"
                  style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.12)" }}>
                  <ChevronLeft className="w-[16px] h-[16px]" style={{ color: "rgba(0,85,255,0.7)" }} strokeWidth={2.5} />
                </button>
                <div className="flex items-center gap-[8px] px-4 py-[9px] rounded-[12px]"
                  style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.12)" }}>
                  <div className="w-7 h-7 rounded-[9px] flex items-center justify-center"
                    style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 2px 8px rgba(0,85,255,0.28)" }}>
                    <CalendarIcon className="w-[14px] h-[14px] text-white" strokeWidth={2.2} />
                  </div>
                  <span className="text-[15px] font-bold min-w-[160px] text-center" style={{ color: T1, letterSpacing: "-0.3px" }}>{monthName}</span>
                </div>
                <button onClick={(e) => { e.stopPropagation(); handleNextMonth(); }} aria-label="Next month"
                  className="w-10 h-10 rounded-[12px] flex items-center justify-center transition-transform hover:scale-[1.05]"
                  style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.12)" }}>
                  <ChevronRight className="w-[16px] h-[16px]" style={{ color: "rgba(0,85,255,0.7)" }} strokeWidth={2.5} />
                </button>
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-[5px] text-[11px] font-bold tracking-[0.04em]" style={{ color: T3 }}>
                  <div className="w-2 h-2 rounded-full" style={{ background: GREEN }} />Present
                </div>
                <div className="flex items-center gap-[5px] text-[11px] font-bold tracking-[0.04em]" style={{ color: T3 }}>
                  <div className="w-2 h-2 rounded-full" style={{ background: RED }} />Absent
                </div>
                <div className="flex items-center gap-[5px] text-[11px] font-bold tracking-[0.04em]" style={{ color: T3 }}>
                  <div className="w-2 h-2 rounded-full" style={{ background: ORANGE }} />Late
                </div>
              </div>
            </div>

            <div className="grid grid-cols-7 mb-2">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
                <div key={d} className="text-center py-1 text-[11px] font-bold uppercase tracking-[0.06em]" style={{ color: T4 }}>{d}</div>
              ))}
            </div>

            {loading ? (
              <div className="flex flex-col items-center gap-3 py-16">
                <Loader2 className="w-10 h-10 animate-spin" style={{ color: B1 }} />
                <p className="text-[13px] font-medium" style={{ color: T4 }}>Syncing logs…</p>
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-[6px]">
                {Array.from({ length: firstDayOfMonth(selectedDate) }).map((_, i) => (
                  <div key={`e-${i}`} className="aspect-square" />
                ))}
                {Array.from({ length: daysInMonth(selectedDate) }).map((_, i) => {
                  const day = i + 1;
                  const status = getDayStatus(day);
                  const todayDate = new Date();
                  const isToday =
                    selectedDate.getFullYear() === todayDate.getFullYear() &&
                    selectedDate.getMonth() === todayDate.getMonth() &&
                    day === todayDate.getDate();

                  const cellStyle: React.CSSProperties = (() => {
                    if (isToday) {
                      return {
                        background: `linear-gradient(135deg, ${B1}, ${B2})`,
                        color: "#fff",
                        fontWeight: 700,
                        boxShadow: "0 4px 14px rgba(0,85,255,0.36), 0 1px 4px rgba(0,85,255,0.22)",
                      };
                    }
                    switch (status) {
                      case "present":
                        return { background: "rgba(0,200,83,0.10)", color: GREEN_D, border: "0.5px solid rgba(0,200,83,0.18)", fontWeight: 600 };
                      case "absent":
                        return { background: "rgba(255,51,85,0.10)", color: RED, border: "0.5px solid rgba(255,51,85,0.18)", fontWeight: 600 };
                      case "late":
                        return { background: "rgba(255,136,0,0.10)", color: ORANGE, border: "0.5px solid rgba(255,136,0,0.18)", fontWeight: 600 };
                      case "weekend":
                        return { color: T4, fontWeight: 500 };
                      case "forgotten":
                        return { color: T4, opacity: 0.7, fontWeight: 500 };
                      default:
                        return { color: T2, fontWeight: 500 };
                    }
                  })();

                  return (
                    <div key={day} className="aspect-square rounded-[14px] flex items-center justify-center text-[15px] relative" style={cellStyle}>
                      {day}
                      {!isToday && (status === "present" || status === "absent" || status === "late") && (
                        <span
                          className="absolute bottom-[4px] left-1/2 -translate-x-1/2 w-[6px] h-[6px] rounded-full"
                          style={{ background: status === "present" ? GREEN : status === "absent" ? RED : ORANGE }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right sidebar (lg:col-span-2) */}
          <div className="lg:col-span-2 flex flex-col gap-4">

            {/* This Month Ring */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Open reports page for monthly attendance"
              onClick={() => navigate("/reports")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/reports"); } }}
              className="bg-white rounded-[24px] p-5 flex items-center gap-5 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
              style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
              <div className="flex-1">
                <div className="text-[17px] font-bold mb-1" style={{ color: T1, letterSpacing: "-0.3px" }}>This Month</div>
                <div className="text-[12px] mb-4 font-normal" style={{ color: T3 }}>{monthName} summary</div>
                <div className="flex items-center gap-[7px] mb-[6px]">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: GREEN }} />
                  <span className="text-[12px] font-bold" style={{ color: T2 }}>Present</span>
                  <span className="text-[12px] font-bold ml-auto" style={{ color: GREEN }}>{monthStats.present} {monthStats.present === 1 ? "day" : "days"}</span>
                </div>
                <div className="flex items-center gap-[7px] mb-[6px]">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: RED }} />
                  <span className="text-[12px] font-bold" style={{ color: T2 }}>Absent</span>
                  <span className="text-[12px] font-bold ml-auto" style={{ color: RED }}>{monthStats.absent} {monthStats.absent === 1 ? "day" : "days"}</span>
                </div>
                <div className="flex items-center gap-[7px]">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: ORANGE }} />
                  <span className="text-[12px] font-bold" style={{ color: T2 }}>Late</span>
                  <span className="text-[12px] font-bold ml-auto" style={{ color: ORANGE }}>{monthStats.late} {monthStats.late === 1 ? "day" : "days"}</span>
                </div>
              </div>
              <div className="relative w-[120px] h-[120px] shrink-0">
                <svg width="120" height="120" viewBox="0 0 120 120" style={{ transform: "rotate(-90deg)" }}>
                  <defs>
                    <linearGradient id="attRingGreenD" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor={GREEN} />
                      <stop offset="100%" stopColor="#66EE88" />
                    </linearGradient>
                    <linearGradient id="attRingRedD" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor={RED} />
                      <stop offset="100%" stopColor="#FF8899" />
                    </linearGradient>
                  </defs>
                  <circle cx="60" cy="60" r={ringR} fill="none" stroke="rgba(0,85,255,0.08)" strokeWidth="10" />
                  <circle cx="60" cy="60" r={ringR} fill="none" stroke={aboveThreshold ? "url(#attRingGreenD)" : "url(#attRingRedD)"} strokeWidth="10" strokeLinecap="round"
                    strokeDasharray={ringCirc} strokeDashoffset={ringOffset}
                    style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)" }} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-[26px] font-bold leading-none" style={{ color: ringColor, letterSpacing: "-0.7px" }}>{stats.percentage}%</div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.08em] mt-1" style={{ color: T4 }}>Rate</div>
                </div>
              </div>
            </div>

            {/* Weekly Bars */}
            {!loading && (
              <div
                role="button"
                tabIndex={0}
                aria-label="Open reports page for weekly attendance"
                onClick={() => navigate("/reports")}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/reports"); } }}
                className="bg-white rounded-[22px] px-5 py-5 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                <div className="text-[15px] font-bold mb-4" style={{ color: T1, letterSpacing: "-0.2px" }}>Weekly Attendance</div>
                <div className="flex items-end justify-between gap-[8px] h-[70px] mb-2">
                  {weekBarsD.map((b, i) => {
                    const h =
                      b.status === "present" ? 60 :
                      b.status === "late" ? 44 :
                      b.status === "absent" ? 20 :
                      b.status === "future" ? 26 : 26;
                    const bg =
                      b.status === "present" ? `linear-gradient(180deg, ${B1}, ${B4})` :
                      b.status === "late" ? `linear-gradient(180deg, ${ORANGE}, #FFB366)` :
                      b.status === "absent" ? `linear-gradient(180deg, ${RED}, #FF8899)` :
                      BG2;
                    const isHighlight = b.isToday;
                    return (
                      <div key={i} className="flex flex-col items-center gap-1 flex-1">
                        <div
                          className="w-full rounded-t-[6px] min-h-[5px] transition-all duration-300"
                          style={{
                            height: h,
                            background: bg,
                            boxShadow: isHighlight ? "0 0 0 3px rgba(0,85,255,0.20)" : "none"
                          }}
                        />
                        <span className="text-[10px] font-bold uppercase tracking-[0.04em]"
                          style={{ color: isHighlight ? B1 : T4 }}>
                          {b.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Attendance Correlation Insight (system-driven) ── */}
        {!loading && (() => {
          const bandTone = correlation.band === "excellent" ? { c: GREEN, bg: GREEN_S, bdr: GREEN_B }
            : correlation.band === "good" ? { c: B1, bg: "rgba(0,85,255,0.07)", bdr: "rgba(0,85,255,0.18)" }
            : correlation.band === "needs_improvement" ? { c: ORANGE, bg: "rgba(255,136,0,0.08)", bdr: "rgba(255,136,0,0.22)" }
            : { c: RED, bg: "rgba(255,51,85,0.07)", bdr: "rgba(255,51,85,0.20)" };
          return (
            <div className="bg-white rounded-[24px] overflow-hidden mt-5"
              style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
              {/* Header */}
              <div className="flex items-center gap-3 px-6 py-5 relative overflow-hidden"
                style={{ background: "linear-gradient(140deg, #001888 0%, #0033CC 48%, #0055FF 100%)" }}>
                <div className="absolute -top-7 -right-4 w-[160px] h-[160px] rounded-full pointer-events-none"
                  style={{ background: "radial-gradient(circle, rgba(255,255,255,0.10) 0%, transparent 65%)" }} />
                <div className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center relative z-10"
                  style={{ background: "rgba(255,255,255,0.18)", border: "0.5px solid rgba(255,255,255,0.26)" }}>
                  <Sparkles className="w-[18px] h-[18px] text-white" strokeWidth={2.2} />
                </div>
                <div className="relative z-10">
                  <div className="text-[17px] font-bold text-white" style={{ letterSpacing: "-0.3px" }}>Attendance Correlation</div>
                  <div className="text-[12px] mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>How presence is shaping {studentFirstName}'s learning</div>
                </div>
              </div>

              <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Left: narrative + band */}
                <div className="lg:col-span-2">
                  <div className="inline-flex items-center gap-[6px] px-3 py-[5px] rounded-full text-[11px] font-bold uppercase tracking-[0.04em] mb-3"
                    style={{ background: bandTone.bg, color: bandTone.c, border: `0.5px solid ${bandTone.bdr}` }}>
                    <span className="w-[7px] h-[7px] rounded-full" style={{ background: bandTone.c }} />
                    {correlation.band_label}
                  </div>
                  <p className="text-[14px] leading-[1.65] mb-5" style={{ color: T2 }}>
                    {correlation.correlation_narrative}
                  </p>

                  <div className="text-[10px] font-bold uppercase tracking-[0.10em] mb-3" style={{ color: T4 }}>Impact analysis</div>
                  <div className="flex flex-col gap-[10px]">
                    {correlation.impact_analysis.map((pt, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className="w-[22px] h-[22px] rounded-[7px] flex items-center justify-center text-[11px] font-bold shrink-0 mt-[2px]"
                          style={{ background: "rgba(0,85,255,0.08)", color: B1, border: "0.5px solid rgba(0,85,255,0.16)" }}>
                          {i + 1}
                        </div>
                        <p className="text-[13px] leading-[1.55]" style={{ color: T2 }}>{pt}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: streak + day pattern + growth strategy */}
                <div className="flex flex-col gap-3">
                  {correlation.streak.longest_streak > 0 && (
                    <div className="flex items-center gap-3 px-4 py-[14px] rounded-[16px]"
                      style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                      <div className="w-[36px] h-[36px] rounded-[11px] flex items-center justify-center shrink-0"
                        style={{ background: "rgba(255,136,0,0.12)", border: "0.5px solid rgba(255,136,0,0.24)" }}>
                        <Flame className="w-[18px] h-[18px]" style={{ color: ORANGE }} strokeWidth={2.2} />
                      </div>
                      <div>
                        <div className="text-[12px] font-bold" style={{ color: T1 }}>
                          Streak: {correlation.streak.current_streak} {correlation.streak.current_streak === 1 ? "day" : "days"}
                        </div>
                        <div className="text-[11px]" style={{ color: T3 }}>Best so far: {correlation.streak.longest_streak} days</div>
                      </div>
                    </div>
                  )}
                  {correlation.day_pattern.weekday && (
                    <div className="flex items-center gap-3 px-4 py-[14px] rounded-[16px]"
                      style={{ background: "rgba(255,51,85,0.05)", border: "0.5px solid rgba(255,51,85,0.16)" }}>
                      <div className="w-[36px] h-[36px] rounded-[11px] flex items-center justify-center shrink-0"
                        style={{ background: "rgba(255,51,85,0.10)", border: "0.5px solid rgba(255,51,85,0.22)" }}>
                        <AlertTriangle className="w-[16px] h-[16px]" style={{ color: RED }} strokeWidth={2.2} />
                      </div>
                      <div>
                        <div className="text-[12px] font-bold" style={{ color: T1 }}>
                          Pattern: {correlation.day_pattern.weekday}s
                        </div>
                        <div className="text-[11px]" style={{ color: T3 }}>{correlation.day_pattern.absence_count} absences fall on this day</div>
                      </div>
                    </div>
                  )}
                  <div className="rounded-[16px] px-4 py-[14px]"
                    style={{ background: bandTone.bg, border: `0.5px solid ${bandTone.bdr}` }}>
                    <div className="text-[10px] font-bold uppercase tracking-[0.10em] mb-[6px]" style={{ color: bandTone.c }}>Next step</div>
                    <p className="text-[13px] leading-[1.55]" style={{ color: T2 }}>{correlation.growth_strategy}</p>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Bottom row: Recent Absences + Policy + Eligibility ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-5">

          {/* Recent Absences */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Open alerts page"
            onClick={() => navigate("/alerts")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/alerts"); } }}
            className="bg-white rounded-[24px] p-6 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
            style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="text-[17px] font-bold mb-4" style={{ color: T1, letterSpacing: "-0.3px" }}>Recent Absences</div>

            {recentAbsences.length === 0 ? (
              attendanceLogs.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-8">
                  <div className="w-[70px] h-[70px] rounded-[22px] flex items-center justify-center"
                    style={{ background: "rgba(48,48,110,0.06)", border: "0.5px solid rgba(48,48,110,0.12)" }}>
                    <CalendarIcon className="w-8 h-8" style={{ color: T4 }} strokeWidth={2.2} />
                  </div>
                  <div className="text-[15px] font-semibold" style={{ color: T3 }}>No attendance recorded yet</div>
                  <div className="text-[12px] text-center max-w-[260px] leading-[1.55] font-normal" style={{ color: T4 }}>
                    Once your child's teacher starts marking attendance, the records will appear here.
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-8">
                  <div className="w-[70px] h-[70px] rounded-[22px] flex items-center justify-center"
                    style={{ background: GREEN_S, border: `0.5px solid ${GREEN_B}`, boxShadow: "0 0 0 8px rgba(0,200,83,0.05)" }}>
                    <CheckCircle className="w-8 h-8" style={{ color: GREEN }} strokeWidth={2.2} />
                  </div>
                  <div className="text-[15px] font-semibold" style={{ color: T3 }}>Perfect attendance! 🎉</div>
                  <div className="text-[12px] text-center max-w-[220px] leading-[1.55] font-normal" style={{ color: T4 }}>
                    No absences recorded this month. Keep it up!
                  </div>
                </div>
              )
            ) : (
              <div className="flex flex-col">
                {recentAbsences.map((a: any, i: number, arr: any[]) => {
                  const isAbsent = a.status === "absent";
                  const parts = a.date?.split("-");
                  const dateObj = parts?.length === 3
                    ? new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
                    : new Date(a.date);
                  const dateStr = dateObj.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
                  return (
                    <div key={i}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open alerts page for ${dateStr} ${isAbsent ? "absence" : "late"}`}
                      onClick={() => navigate("/alerts")}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/alerts"); } }}
                      className="flex items-center gap-[13px] py-3 cursor-pointer transition-colors hover:bg-[#F5F9FF] rounded-[12px] -mx-2 px-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                      style={{ borderBottom: i < arr.length - 1 ? `0.5px solid ${SEP}` : "none" }}>
                      <div className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0"
                        style={{
                          background: isAbsent ? "rgba(255,51,85,0.10)" : "rgba(255,136,0,0.10)",
                          border: `0.5px solid ${isAbsent ? "rgba(255,51,85,0.22)" : "rgba(255,136,0,0.22)"}`
                        }}>
                        {isAbsent
                          ? <XCircle className="w-[18px] h-[18px]" style={{ color: RED }} strokeWidth={2.2} />
                          : <Clock className="w-[18px] h-[18px]" style={{ color: ORANGE }} strokeWidth={2.2} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>{dateStr}</div>
                        <div className="text-[11px] mt-0.5 truncate font-normal" style={{ color: T3 }}>
                          {a.note || (isAbsent ? "Reason: Not specified" : "Arrived late")}
                        </div>
                      </div>
                      <div className="px-3 py-[5px] rounded-full text-[11px] font-bold shrink-0"
                        style={{
                          background: isAbsent ? "rgba(255,51,85,0.10)" : "rgba(255,136,0,0.10)",
                          color: isAbsent ? RED : ORANGE,
                          border: `0.5px solid ${isAbsent ? "rgba(255,51,85,0.22)" : "rgba(255,136,0,0.22)"}`
                        }}>
                        {isAbsent ? "Absent" : "Late"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Policy gradient card */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Open settings to view attendance policy"
            onClick={() => navigate("/settings")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/settings"); } }}
            className="rounded-[24px] px-6 py-6 relative overflow-hidden cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            style={{
              background: `linear-gradient(135deg, ${B1} 0%, ${B2} 100%)`,
              boxShadow: SH_BTN,
              border: "0.5px solid rgba(255,255,255,0.16)"
            }}>
            <div className="absolute -top-[40px] -right-[10px] w-[200px] h-[200px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(255,255,255,0.14) 0%, transparent 65%)" }} />
            <div className="absolute inset-0 pointer-events-none" style={{
              backgroundImage: "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
              backgroundSize: "24px 24px"
            }} />
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] mb-3 relative z-10" style={{ color: "rgba(255,255,255,0.52)" }}>
              Attendance Policy
            </div>
            <p className="text-[15px] leading-[1.65] font-normal mb-5 relative z-10" style={{ color: "rgba(255,255,255,0.88)" }}>
              Minimum {attendanceThreshold}% attendance required for exam eligibility. Students below the threshold will be notified.
            </p>
            <div className="flex items-center gap-2 pt-4 relative z-10" style={{ borderTop: "0.5px solid rgba(255,255,255,0.16)" }}>
              <div className="w-[26px] h-[26px] rounded-[8px] flex items-center justify-center shrink-0"
                style={{
                  background: aboveThreshold ? GREEN_S : "rgba(255,51,85,0.15)",
                  border: `0.5px solid ${aboveThreshold ? GREEN_B : "rgba(255,51,85,0.30)"}`
                }}>
                {aboveThreshold
                  ? <CheckCircle className="w-[13px] h-[13px]" style={{ color: GREEN }} strokeWidth={2.5} />
                  : <XCircle className="w-[13px] h-[13px]" style={{ color: "#fff" }} strokeWidth={2.5} />}
              </div>
              <span className="text-[14px] font-bold text-white" style={{ letterSpacing: "-0.1px" }}>
                {studentFirstName} is {aboveThreshold ? "above the threshold" : "below the requirement"}
              </span>
            </div>
          </div>

          {/* Exam Eligibility */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Open settings to view attendance threshold"
            onClick={() => navigate("/settings")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/settings"); } }}
            className="bg-white rounded-[22px] px-6 py-6 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
            style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="flex items-end justify-between mb-3">
              <div>
                <div className="text-[15px] font-bold" style={{ color: T1, letterSpacing: "-0.2px", marginBottom: 3 }}>Exam Eligibility</div>
                <div className="text-[12px] font-normal" style={{ color: T3 }}>{attendanceThreshold}% threshold required</div>
              </div>
              <div className="text-[26px] font-bold" style={{ color: aboveThreshold ? GREEN : RED, letterSpacing: "-0.7px" }}>
                {stats.percentage}%
              </div>
            </div>
            <div className="h-[10px] rounded-[5px] overflow-hidden relative mb-2" style={{ background: BG2 }}>
              <div className="h-full rounded-[5px]"
                style={{
                  width: `${Math.min(stats.percentage, 100)}%`,
                  background: aboveThreshold
                    ? `linear-gradient(90deg, ${GREEN}, #66EE88)`
                    : `linear-gradient(90deg, ${RED}, #FF8899)`
                }} />
              <div className="absolute -top-[3px] w-[3px] h-[16px] rounded-[2px]"
                style={{ left: `${Math.min(attendanceThreshold, 100)}%`, background: "rgba(0,85,255,0.55)" }} />
            </div>
            <div className="flex justify-between">
              <span className="text-[11px] font-bold" style={{ color: aboveThreshold ? GREEN : RED }}>{stats.percentage}% current</span>
              <span className="text-[11px] font-bold" style={{ color: "rgba(0,85,255,0.6)" }}>{attendanceThreshold}% required</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AttendancePage;
