import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/AuthContext";
import { CheckCircle, AlertCircle, Calendar, Star, Clock, Loader2, ShieldCheck, BrainCircuit, Sparkles, TrendingUp, BookOpen, Lightbulb, Download } from "lucide-react";
import { ParentAIController } from "../ai/controller/ai-controller";
import { generateWeeklyReport } from "../ai/engines/weekly-report-engine";
import WeeklyReportPDF from "../components/WeeklyReportPDF";
import { PageHeader } from "@/components/ui/PageHeader";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, getDocs, Timestamp } from "firebase/firestore";
import { subscribeEnrollments } from "@/lib/enrollmentQuery";
import { useSchoolSettings, resolveAcademicYear } from "@/hooks/useSchoolSettings";
import { useIsMobile } from "@/hooks/use-mobile";

function timeAgo(date: Date): string {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 172800) return "Yesterday";
  return date.toLocaleDateString();
}

function generateSmartParentingTips(stats: { attendance: number; avgScore: number; pending: number; tests: number }, childName: string) {
  const tips: { tip: string; reason: string }[] = [];
  const name = childName || "your child";

  if (stats.attendance < 75) {
    tips.push({
      tip: `Make school attendance a top priority for ${name}`,
      reason: `Attendance is at ${stats.attendance}% — below 75% risks missing critical lessons and falling behind peers.`
    });
  } else if (stats.attendance < 85) {
    tips.push({
      tip: `Work on improving ${name}'s attendance consistency`,
      reason: `At ${stats.attendance}%, a few more absences could affect term performance. Aim for 90%+.`
    });
  } else {
    tips.push({
      tip: `Keep up ${name}'s great attendance habit`,
      reason: `${stats.attendance}% attendance is excellent — consistent presence directly improves academic retention.`
    });
  }

  if (stats.avgScore > 0 && stats.avgScore < 60) {
    tips.push({
      tip: `Schedule dedicated revision time at home with ${name}`,
      reason: `Average score is ${stats.avgScore}% — focused daily revision of 30–45 mins can significantly improve results.`
    });
  } else if (stats.avgScore >= 60 && stats.avgScore < 80) {
    tips.push({
      tip: `Encourage ${name} to practice weak subjects with extra exercises`,
      reason: `Scoring ${stats.avgScore}% on average — targeted practice on lower-scoring subjects will push overall grades higher.`
    });
  } else if (stats.avgScore >= 80) {
    tips.push({
      tip: `Challenge ${name} with advanced problems to stay ahead`,
      reason: `Strong ${stats.avgScore}% average — keeping the mind challenged prevents complacency and builds exam confidence.`
    });
  }

  if (stats.pending > 3) {
    tips.push({
      tip: `Help ${name} create a daily homework schedule`,
      reason: `There are ${stats.pending} pending assignments — prioritizing them daily prevents last-minute pressure and missed deadlines.`
    });
  } else if (stats.pending > 0) {
    tips.push({
      tip: `Remind ${name} to complete ${stats.pending} pending assignment${stats.pending > 1 ? "s" : ""} this week`,
      reason: `Staying on top of assignments builds discipline and prevents grade penalties.`
    });
  }

  if (stats.tests > 0) {
    tips.push({
      tip: `Start test preparation now — ${stats.tests} test${stats.tests > 1 ? "s" : ""} coming up this week`,
      reason: `Reviewing notes 2–3 days before tests instead of last-minute cramming improves retention by up to 50%.`
    });
  }

  // Always include a health tip
  tips.push({
    tip: `Ensure ${name} gets 8–9 hours of sleep on school nights`,
    reason: `Sleep directly impacts memory consolidation — well-rested students perform better in class and retain lessons longer.`
  });

  return tips.slice(0, 3); // Max 3 tips
}

function getInitials(name: string): string {
  return (name || "")
    .split(" ")
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || "")
    .join("");
}

/** Donut ring — used for attendance & score */
function DonutRing({ pct, color, size = 80, stroke = 9, label }: { pct: number; color: string; size?: number; stroke?: number; label?: string }) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  const c = size / 2;
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s ease", filter: `drop-shadow(0 0 6px ${color}90)` }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-black text-white leading-none">{pct}%</span>
        {label && <span className="text-[8px] text-slate-500 font-medium mt-0.5">{label}</span>}
      </div>
    </div>
  );
}

/** Thin horizontal bar */
function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
      <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color, boxShadow: `0 0 6px ${color}80` }} />
    </div>
  );
}

/** Score arc (half-circle gauge) */
function ScoreArc({ pct, color, size = 80 }: { pct: number; color: string; size?: number }) {
  const stroke = 9;
  const r = (size - stroke * 2) / 2;
  const circ = Math.PI * r; // half circle
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  const cx = size / 2, cy = size / 2 + 8;
  return (
    <div className="relative flex items-end justify-center" style={{ width: size, height: size / 2 + 14 }}>
      <svg width={size} height={size / 2 + 10} style={{ overflow: "visible" }}>
        <path d={`M ${stroke} ${cy} A ${r} ${r} 0 0 1 ${size - stroke} ${cy}`}
          fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} strokeLinecap="round" />
        <path d={`M ${stroke} ${cy} A ${r} ${r} 0 0 1 ${size - stroke} ${cy}`}
          fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1s ease", filter: `drop-shadow(0 0 6px ${color}90)` }} />
      </svg>
      <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center">
        <span className="text-sm font-black text-white leading-none">{pct > 0 ? `${pct}%` : "N/A"}</span>
      </div>
    </div>
  );
}

const DashboardPage = () => {
  const { studentData, user } = useAuth();
  const isMobile = useIsMobile();
  const settings = useSchoolSettings();
  // Real academic year — replaces two hardcoded "2025-26" strings.
  const academicYear = resolveAcademicYear(settings);
  const [aiInsights, setAiInsights] = useState<any>(null);
  // Initial defaults must NOT look like real data. attendance:100 was showing
  // "100% attendance" for brand-new students who had zero records — making
  // the dashboard appear to have data that didn't exist in Firestore.
  // Use null to mean "no data yet"; UI renders "—" instead of a fake percentage.
  const [liveStats, setLiveStats] = useState<{
    attendance: number | null;
    pending: number | null;
    tests: number | null;
    avgScore: number;
    recentGrade: string;
    recentSubject: string;
    trendPct: number;
    hasAttendanceData: boolean;
    hasAssignmentData: boolean;
    hasTestData: boolean;
    hasScoreData: boolean;
  }>({
    attendance: null,
    pending: null,
    tests: null,
    avgScore: 0,
    recentGrade: "N/A",
    recentSubject: "—",
    trendPct: 0,
    hasAttendanceData: false,
    hasAssignmentData: false,
    hasTestData: false,
    hasScoreData: false,
  });
  const [recentAlerts, setRecentAlerts] = useState<any[]>([]);
  const [teacherInfo, setTeacherInfo] = useState({ name: "—" });
  const [studentMeta, setStudentMeta] = useState({ className: "—", rollNo: "—" });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [dataLoading, setDataLoading] = useState(true);
  const [smartTips, setSmartTips] = useState<{ tip: string; reason: string }[]>([]);
  const [weeklyReport, setWeeklyReport] = useState<any>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [pdfData, setPdfData] = useState<any>(null);
  const pdfRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!studentData?.id) return;
    const schoolId = studentData.schoolId;

    // Helper: build a scoped query (schoolId filter when available prevents cross-school reads)
    const sq = (collName: string, field = "studentId", value = studentData.id) =>
      schoolId
        ? query(collection(db, collName), where("schoolId", "==", schoolId), where(field, "==", value))
        : query(collection(db, collName), where(field, "==", value));

    // Shared error handler — all listeners below route here so a rule rejection
    // or network blip can't leave the UI stuck in an indeterminate state.
    const onListenerError = (label: string) => (err: Error) => {
      console.error(`[Dashboard] ${label} listener error:`, err);
      setDataLoading(false);
    };

    // 1. Attendance — single listener (was 2)
    const u1 = onSnapshot(sq("attendance"), snap => {
      const records = snap.docs.map(d => d.data());
      if (records.length === 0) {
        // No attendance recorded yet. Don't fake a "100%" — show empty state.
        setLiveStats(prev => ({ ...prev, attendance: null, hasAttendanceData: false }));
        return;
      }
      const present = records.filter((r: any) => r.status === "present" || r.status === "late").length;
      const pct = Math.round((present / records.length) * 100);
      setLiveStats(prev => ({ ...prev, attendance: pct, hasAttendanceData: true }));
    }, onListenerError("attendance"));

    // 2. Enrollments → assignments + tests (single listener, was 2 + unbounded classIds)
    let enSnap: any = null;
    const processEnroll = async () => {
      const docs = enSnap?.docs || [];
      if (!docs.length) {
        // No enrollments → student not in any class → no pending/tests data exists.
        // Mark explicitly as "no data" so UI can render empty state instead of "0".
        setLiveStats(prev => ({
          ...prev,
          pending: null,
          tests: null,
          hasAssignmentData: false,
          hasTestData: false,
        }));
        setTeacherInfo({ name: "—" });
        setStudentMeta({ className: "—", rollNo: "—" });
        setDataLoading(false);
        return;
      }
      const first = docs[0].data();
      setTeacherInfo({ name: first.teacherName || "—" });
      setStudentMeta({
        className: first.className || studentData?.grade || "—",
        rollNo: first.rollNo || studentData?.rollNo || "—",
      });
      const classIds = [...new Set(docs.map((d: any) => d.data().classId).filter(Boolean))] as string[];
      if (!classIds.length) {
        setLiveStats(prev => ({
          ...prev,
          pending: null,
          tests: null,
          hasAssignmentData: false,
          hasTestData: false,
        }));
        setDataLoading(false);
        return;
      }

      // Chunk classIds to handle >10 (Firestore "in" operator limit)
      const chunks: string[][] = [];
      for (let i = 0; i < classIds.length; i += 10) chunks.push(classIds.slice(i, i + 10));

      // CRITICAL: every assignments/tests query MUST include schoolId — otherwise
      // a colliding classId across schools leaks another school's data into this
      // parent's dashboard. Same pattern enforced via Firestore rules but we
      // belt-and-braces it client-side too.
      const buildQ = (coll: string, ids: string[]) =>
        schoolId
          ? query(collection(db, coll), where("schoolId", "==", schoolId), where("classId", "in", ids))
          : query(collection(db, coll), where("classId", "in", ids));

      const [aSnaps, tSnaps, subSnap] = await Promise.all([
        Promise.all(chunks.map(c => getDocs(buildQ("assignments", c)))),
        Promise.all(chunks.map(c => getDocs(buildQ("tests", c)))),
        getDocs(sq("submissions")),
      ]);
      const allAssignments = aSnaps.flatMap(s => s.docs);
      const allTests = tSnaps.flatMap(s => s.docs);
      const subIds = new Set(subSnap.docs.flatMap(d => [d.data().homeworkId, d.data().assignmentId].filter(Boolean)));
      const pending = allAssignments.filter(d => !subIds.has(d.id)).length;
      const today = new Date().toISOString().split("T")[0];
      const nw = new Date(); nw.setDate(nw.getDate() + 7);
      const tests = allTests.filter(d => {
        const dt = d.data().date;
        return dt >= today && dt <= nw.toISOString().split("T")[0];
      }).length;
      setLiveStats(prev => ({
        ...prev,
        pending,
        tests,
        hasAssignmentData: allAssignments.length > 0,
        hasTestData: allTests.length > 0,
      }));
      setDataLoading(false);
    };
    // Use the dual-listener helper so legacy enrollments (where studentId
    // was set to email by older teacher/principal-dashboard code) are also
    // picked up — otherwise pending/tests show "no data" for those students.
    const u2 = subscribeEnrollments(studentData, (docs) => {
      enSnap = { docs };
      processEnroll();
    });

    // 3. Results + gradebook — single listener each (was 4)
    let rSnap: any = null, gSnap: any = null;
    const processResults = () => {
      const testRes = (rSnap?.docs || []).map((d: any) => ({ id: d.id, ...d.data() as any }));
      const gbRes = (gSnap?.docs || []).map((d: any) => {
        const data = d.data();
        return { id: d.id, ...data, score: (data.mark / (data.maxMarks || 100)) * 100, subject: data.subject || data.className || "General", timestamp: data.updatedAt ? Timestamp.fromMillis(data.updatedAt) : Timestamp.now() };
      });
      const all = Array.from(new Map([...testRes, ...gbRes].map(d => [d.id, d])).values())
        .sort((a, b) => (b.timestamp?.toDate()?.getTime() || 0) - (a.timestamp?.toDate()?.getTime() || 0));
      if (!all.length) {
        // No scores at all → keep defaults but mark as "no data" so UI knows.
        setLiveStats(prev => ({
          ...prev,
          avgScore: 0,
          recentGrade: "N/A",
          recentSubject: "—",
          trendPct: 0,
          hasScoreData: false,
        }));
        return;
      }
      const avg = all.reduce((s, r) => s + (parseFloat(r.score) || 0), 0) / all.length;
      const latest = all[0];
      const grade = (s: number) => s >= 90 ? "A+" : s >= 80 ? "A" : s >= 70 ? "A-" : s >= 60 ? "B" : "C";
      const scores = all.map(r => parseFloat(r.score) || 0);
      const recent3 = scores.slice(0, 3);
      const prev3 = scores.slice(3, 6);
      let trendPct = 0;
      if (recent3.length > 0 && prev3.length > 0) {
        const recentAvg = recent3.reduce((a, b) => a + b, 0) / recent3.length;
        const prevAvg = prev3.reduce((a, b) => a + b, 0) / prev3.length;
        trendPct = Math.round(recentAvg - prevAvg);
      }
      setLiveStats(prev => ({
        ...prev,
        avgScore: Math.round(avg),
        recentGrade: grade(parseFloat(latest.score) || 0),
        recentSubject: latest.className || latest.subject || "—",
        trendPct,
        hasScoreData: true,
      }));
    };
    const u3 = onSnapshot(sq("results"), s => { rSnap = s; processResults(); }, onListenerError("results"));
    const u4 = onSnapshot(sq("gradebook_scores"), s => { gSnap = s; processResults(); }, onListenerError("gradebook_scores"));

    // 4. Risks — single listener (was 2)
    const u5 = onSnapshot(sq("risks"), snap => {
      const unique = snap.docs
        .map(d => ({ id: d.id, ...d.data() as any }))
        .sort((a, b) => (b.timestamp?.toDate()?.getTime() || 0) - (a.timestamp?.toDate()?.getTime() || 0));
      setRecentAlerts(unique.slice(0, 3).map(d => ({ id: d.id, title: d.issue, time: d.timestamp?.toDate() || new Date(), urgent: d.severity === "Critical" })));
    }, onListenerError("risks"));

    return () => [u1, u2, u3, u4, u5].forEach(u => u());
  }, [studentData?.id, studentData?.schoolId]);

  useEffect(() => {
    if (dataLoading) return;
    setSmartTips(generateSmartParentingTips(liveStats, studentData?.name?.split(" ")[0] || ""));
  }, [dataLoading, liveStats.attendance, liveStats.avgScore, liveStats.pending, liveStats.tests]);

  // Week config: Fri/Sat/Sun = generate window; Mon = prev week report + block
  const getWeekConfig = () => {
    const day = new Date().getDay(); // 0=Sun,1=Mon,...5=Fri,6=Sat
    const now = new Date();
    // This week's Sunday (end of this reporting week)
    const thisSunday = new Date(now);
    thisSunday.setDate(now.getDate() + (day === 0 ? 0 : 7 - day));
    const thisWeekKey = `weekly_report_${studentData?.id}_${thisSunday.toISOString().split("T")[0]}`;
    // Previous week's Sunday
    const prevSunday = new Date(thisSunday);
    prevSunday.setDate(prevSunday.getDate() - 7);
    const prevWeekKey = `weekly_report_${studentData?.id}_${prevSunday.toISOString().split("T")[0]}`;
    const canGenerate = day === 5 || day === 6 || day === 0;
    const daysLeft = ({ 1: 4, 2: 3, 3: 2, 4: 1 } as any)[day] ?? 0;
    return { canGenerate, thisWeekKey, prevWeekKey, isMonday: day === 1, daysLeft, day };
  };

  // Load cached weekly report on mount
  useEffect(() => {
    if (!studentData?.id) return;
    const { thisWeekKey, prevWeekKey, isMonday, canGenerate } = getWeekConfig();
    // Try current week first
    const cached = localStorage.getItem(thisWeekKey);
    if (cached) { try { setWeeklyReport(JSON.parse(cached)); return; } catch {} }
    // Monday with no current report → load prev week's report (read-only)
    if (isMonday || !canGenerate) {
      const prevCached = localStorage.getItem(prevWeekKey);
      if (prevCached) { try { setWeeklyReport(JSON.parse(prevCached)); } catch {} }
    }
  }, [studentData?.id]);

  const handleGenerateWeeklyReport = async () => {
    if (!studentData?.id || weeklyLoading) return;
    setWeeklyLoading(true);
    try {
      const now = new Date();
      const weekStart = new Date(now); weekStart.setDate(now.getDate() - 6); weekStart.setHours(0, 0, 0, 0);
      const weekStartStr = weekStart.toISOString().split("T")[0];
      const weekEndStr = now.toISOString().split("T")[0];
      const { thisWeekKey: weekCacheKey } = getWeekConfig();

      const schoolId = studentData.schoolId;
      // Scoped query helper for report fetches
      const rq = (collName: string, extraFilters: any[] = []) => {
        const base = schoolId
          ? query(collection(db, collName), where("schoolId", "==", schoolId), where("studentId", "==", studentData.id), ...extraFilters)
          : query(collection(db, collName), where("studentId", "==", studentData.id), ...extraFilters);
        return getDocs(base);
      };

      // Fetch only this week's attendance — date range filter avoids fetching years of history
      const attSnap = await rq("attendance", [where("date", ">=", weekStartStr)]);
      const attDocs = attSnap.docs.map(d => d.data());
      const attPresent = attDocs.filter((d: any) => d.status === "present").length;
      const attLate = attDocs.filter((d: any) => d.status === "late").length;
      const attAbsent = attDocs.filter((d: any) => d.status === "absent").length;
      const attTotal = attDocs.length;
      // Don't fake 100% when there are zero attendance records this week —
      // 0 conveys "no data" without misleading the parent.
      const attPct = attTotal === 0 ? 0 : Math.round(((attPresent + attLate) / attTotal) * 100);

      // Fetch this week's results (scoped, no full history scan)
      const resSnap = await rq("results");
      const resDocs = resSnap.docs.map(d => d.data());
      const weekTests = resDocs
        .filter((d: any) => { const dt = d.date || d.createdAt?.toDate?.()?.toISOString?.()?.split?.("T")?.[0] || ""; return dt >= weekStartStr; })
        .map((d: any) => {
          const score = parseFloat(d.score) || 0;
          const max = parseFloat(d.maxScore || d.totalMarks || 100);
          const pct = (score / max) * 100;
          return { subject: d.subject || d.className || "General", score, max, grade: pct >= 90 ? "A+" : pct >= 80 ? "A" : pct >= 70 ? "B+" : pct >= 60 ? "B" : "C" };
        });

      // Fetch this week's submissions to get accurate counts (no hardcoded "+2").
      const subSnap = await rq("submissions", [where("submittedAt", ">=", Timestamp.fromDate(weekStart))]);
      const submittedThisWeek = subSnap.docs.length;
      const pendingNow = liveStats.pending ?? 0;

      const reportData = {
        child_name: studentData.name,
        grade: studentData.grade || "—",
        week_start: weekStartStr,
        week_end: weekEndStr,
        attendance: { present: attPresent, absent: attAbsent, late: attLate, total: attTotal, pct: attPct },
        tests: weekTests,
        assignments: {
          total: submittedThisWeek + pendingNow,
          submitted: submittedThisWeek,
          pending: pendingNow,
        },
        overall_avg: liveStats.avgScore,
        recent_alerts: recentAlerts.map(a => a.title).slice(0, 3),
      };

      const report = await generateWeeklyReport(reportData);
      if (report) {
        setWeeklyReport(report);
        setPdfData({ ...reportData, weekEnd: weekEndStr });
        try { localStorage.setItem(weekCacheKey, JSON.stringify(report)); } catch {}
      }
    } catch (e) {
      console.error("Weekly report generation failed:", e);
    } finally {
      setWeeklyLoading(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!pdfRef.current || !weeklyReport) return;
    setPdfDownloading(true);

    const el = pdfRef.current;
    const wrapper = el.parentElement as HTMLElement | null;

    // Temporarily bring into viewport so html2canvas can render SVGs correctly
    const origStyle = wrapper?.style.cssText || "";
    if (wrapper) {
      wrapper.style.cssText =
        "position:fixed;top:0;left:0;z-index:99999;background:#fff;overflow:auto;";
    }

    try {
      // Give browser one frame to paint charts
      await new Promise(r => setTimeout(r, 300));

      const html2canvas = (await import("html2canvas")).default;
      const jsPDF = (await import("jspdf")).jsPDF;

      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#060e1c",
        logging: false,
        windowWidth: el.scrollWidth,
        windowHeight: el.scrollHeight,
      });

      // Restore hidden state immediately after capture
      if (wrapper) wrapper.style.cssText = origStyle;

      const imgData = canvas.toDataURL("image/png");
      // Landscape A4
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();  // 297mm
      const pageH = pdf.internal.pageSize.getHeight(); // 210mm
      const imgH = (canvas.height * pageW) / canvas.width;

      let y = 0;
      while (y < imgH) {
        pdf.addImage(imgData, "PNG", 0, -y, pageW, imgH);
        if (y + pageH < imgH) pdf.addPage();
        y += pageH;
      }
      pdf.save(`${studentData?.name || "Student"}_WeeklyReport_${new Date().toISOString().split("T")[0]}.pdf`);
    } catch (e) {
      console.error("PDF generation failed:", e);
      if (wrapper) wrapper.style.cssText = origStyle;
    } finally {
      setPdfDownloading(false);
    }
  };

  useEffect(() => {
    if (!studentData?.id || dataLoading) return;
    // Skip AI insight call if there's no real data — feeding "null"/zero stats
    // to the AI produces hallucinated narratives about a student that hasn't
    // done anything yet.
    const noDataYet =
      !liveStats.hasAttendanceData &&
      !liveStats.hasAssignmentData &&
      !liveStats.hasTestData &&
      !liveStats.hasScoreData;
    if (noDataYet) {
      setAiInsights(null);
      return;
    }
    ParentAIController.getDashboardInsights({
      child_name: studentData.name,
      attendance: liveStats.attendance === null ? "No data" : `${liveStats.attendance}%`,
      avg_score: liveStats.avgScore > 0 ? `${liveStats.avgScore}%` : "No data",
      pending_assignments: liveStats.pending ?? 0,
      upcoming_tests: liveStats.tests ?? 0,
      recent_grade: liveStats.recentGrade,
      recent_subject: liveStats.recentSubject,
      grade: studentData.grade || "—",
      recent_alerts: recentAlerts.map(a => a.title).slice(0, 3),
    }).then(r => { if (r.status === "success") setAiInsights(r.data); }).catch(() => {});
  }, [studentData?.id, dataLoading]);

  if (studentData?.status === "Invited") return (
    <div className="h-[80vh] flex flex-col items-center justify-center p-10 text-center gap-4">
      <Loader2 className="w-12 h-12 text-[#1e3a8a] animate-spin opacity-40" />
      <h2 className="text-xl font-bold text-slate-700">Setting up your account...</h2>
      <p className="text-sm text-slate-400">Your access is being provisioned. Please wait.</p>
    </div>
  );

  const greeting = currentTime.getHours() < 12 ? "Good Morning" : currentTime.getHours() < 17 ? "Good Afternoon" : "Good Evening";
  const parentFirstName = user?.displayName?.split(" ")[0] || "Parent";
  const childFirstName = studentData?.name?.split(" ")[0] || "your child";
  const userInitials = getInitials(user?.displayName || "RS");
  const studentInitials = getInitials(studentData?.name || "AS");
  const weekConfig = getWeekConfig();
  const isPrevWeekReport = !!weeklyReport && !weekConfig.canGenerate && !localStorage.getItem(weekConfig.thisWeekKey);

  // Null-safe display strings — used by BOTH mobile and desktop branches.
  // Defined here (function scope) so neither return path duplicates the logic.
  const attDisplay = liveStats.attendance === null ? "—" : `${liveStats.attendance}%`;
  const pendingDisplay = liveStats.pending === null ? "—" : liveStats.pending.toString();
  const testsDisplay = liveStats.tests === null ? "—" : liveStats.tests.toString();

  /* ═══════════════════════════════════════════════════════════════
     MOBILE — Edullent Indigo Apple UI
     ═══════════════════════════════════════════════════════════════ */
  if (isMobile) {
    // ── Indigo theme tokens ──
    const IND = "#30306E";
    const IND2 = "#4444A0";
    const IND3 = "#6666C0";
    const BG = "#EEEEF3";
    const T1 = "rgba(48,48,110,0.90)";
    const T2 = "rgba(48,48,110,0.70)";
    const T3 = "rgba(48,48,110,0.42)";
    const T4 = "rgba(48,48,110,0.25)";
    const SEP = "rgba(48,48,110,0.06)";
    const IND_BDR = "rgba(48,48,110,0.12)";
    const IND_SOFT = "rgba(48,48,110,0.07)";
    const GREEN = "#12C04E";
    const GREEN_S = "rgba(18,192,78,0.10)";
    const GREEN_B = "rgba(18,192,78,0.22)";
    const ORANGE = "#F5A000";
    const ORANGE_S = "rgba(245,160,0,0.10)";
    const ORANGE_B = "rgba(245,160,0,0.22)";
    const ROSE = "#FF6EA8";
    const ROSE_S = "rgba(255,110,168,0.10)";
    const DK = "#09092A";
    const DK_CELL = "rgba(9,9,42,0.58)";
    const SH = "0 0 0 0.5px rgba(48,48,110,0.06), 0 1px 3px rgba(48,48,110,0.04), 0 8px 20px rgba(48,48,110,0.07)";
    const SH_LG = "0 0 0 0.5px rgba(48,48,110,0.08), 0 2px 8px rgba(48,48,110,0.06), 0 16px 36px rgba(48,48,110,0.10), 0 32px 56px rgba(48,48,110,0.06)";
    const SH_BTN = "0 4px 14px rgba(48,48,110,0.28), 0 1px 4px rgba(48,48,110,0.18)";
    // Academic Health ring
    const scorePct = Math.min(liveStats.avgScore, 100);
    const ringR = 40, ringCirc = 2 * Math.PI * ringR;
    const ringOffset = ringCirc - (scorePct / 100) * ringCirc;
    // Status flags — null means "no data", which is NOT the same as 0% / on-track.
    const attOnTrack = liveStats.attendance !== null && liveStats.attendance >= 85;
    const noPending = liveStats.pending === 0;
    const isImproving = liveStats.trendPct > 0;
    const isDeclining = liveStats.trendPct < 0;
    const trendStable = liveStats.trendPct === 0;

    return (
      <div className="animate-in fade-in duration-500 -mx-3 -mt-3 md:mx-0 md:mt-0" style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: BG, minHeight: "100vh" }}>

        {/* ── Greeting ── */}
        <div className="px-6 pt-6 pb-0">
          <h1 className="text-[32px] font-bold leading-[1.10]" style={{ color: T1, letterSpacing: "-0.8px" }}>
            {greeting},<br />
            <span style={{ background: `linear-gradient(130deg, ${IND} 0%, ${IND3} 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              {parentFirstName}
            </span> 👋
          </h1>
          <p className="text-[14px] mt-[5px]" style={{ color: T3, letterSpacing: "-0.1px" }}>Here's how {childFirstName} is doing today</p>
        </div>

        {/* ── Academic Health Card ── */}
        <div className="mx-5 mt-[22px] bg-white rounded-[28px] p-6 relative overflow-hidden"
          style={{ boxShadow: SH_LG, border: `0.5px solid ${IND_BDR}` }}>
          <div className="absolute -top-[70px] -right-[50px] w-[220px] h-[220px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(48,48,110,0.05) 0%, transparent 70%)" }} />
          <div className="absolute -bottom-[50px] left-5 w-[160px] h-[160px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(48,48,110,0.03) 0%, transparent 70%)" }} />
          <div className="relative z-10">
            <h3 className="text-[18px] font-bold" style={{ color: T1, letterSpacing: "-0.4px" }}>Academic Health</h3>
            <p className="text-[13px] mt-0.5" style={{ color: T3 }}>Overall performance indicator</p>
            <div className="inline-flex items-center gap-[5px] mt-[14px] px-[13px] py-[5px] rounded-full text-[12px] font-semibold"
              style={{
                background: trendStable || isImproving ? GREEN_S : ORANGE_S,
                color: trendStable || isImproving ? "#0A6A2E" : "#905800",
                border: `0.5px solid ${trendStable || isImproving ? GREEN_B : ORANGE_B}`,
                letterSpacing: "-0.1px"
              }}>
              <TrendingUp className={`w-3 h-3 ${isDeclining ? "rotate-180" : ""}`} />
              {trendStable ? "Stable performance" : isImproving ? `Improved by ${liveStats.trendPct}%` : `Declined by ${Math.abs(liveStats.trendPct)}%`}
            </div>
            <div className="flex items-end justify-between mt-[22px]">
              <div className="flex flex-col gap-1">
                <div className="text-[56px] font-bold leading-none" style={{ color: IND, letterSpacing: "-3px" }}>
                  {liveStats.avgScore > 0 ? `${liveStats.avgScore}%` : "—"}
                </div>
                <div className="text-[10px] font-bold uppercase tracking-[0.09em] mt-1" style={{ color: T4 }}>
                  {liveStats.avgScore >= 75 ? "Good Standing" : liveStats.avgScore > 0 ? "Needs Attention" : "No data yet"}
                </div>
              </div>
              <div className="relative w-[96px] h-[96px] shrink-0">
                <svg viewBox="0 0 96 96" width="96" height="96" style={{ transform: "rotate(-90deg)" }}>
                  <defs>
                    <linearGradient id="indGradMobile" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor={IND3} />
                      <stop offset="100%" stopColor={IND} />
                    </linearGradient>
                  </defs>
                  <circle cx="48" cy="48" r={ringR} fill="none" stroke="rgba(48,48,110,0.09)" strokeWidth="7" />
                  <circle cx="48" cy="48" r={ringR} fill="none" stroke="url(#indGradMobile)" strokeWidth="7" strokeLinecap="round"
                    strokeDasharray={ringCirc} strokeDashoffset={ringOffset}
                    style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)" }} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-[15px] font-bold" style={{ color: T1, letterSpacing: "-0.4px" }}>
                  {liveStats.avgScore > 0 ? `${liveStats.avgScore}%` : "—"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Stats Grid 2×2 ── */}
        <div className="grid grid-cols-2 gap-3 mx-5 mt-[14px]">
          {[
            { icon: CheckCircle, iconColor: GREEN, bg: GREEN_S, border: "rgba(18,192,78,0.20)", glow: "rgba(18,192,78,0.14)", label: "Attendance", value: attDisplay, status: liveStats.attendance === null ? "No records yet" : attOnTrack ? "On track ✓" : "Below target", statusColor: liveStats.attendance === null ? T4 : attOnTrack ? GREEN : ORANGE },
            { icon: AlertCircle, iconColor: ORANGE, bg: ORANGE_S, border: "rgba(245,160,0,0.20)", glow: "rgba(245,160,0,0.14)", label: "Pending Work", value: pendingDisplay, status: liveStats.pending === null ? "No assignments yet" : noPending ? "All clear ✓" : "Due this week", statusColor: liveStats.pending === null ? T4 : noPending ? GREEN : ORANGE },
            { icon: Calendar, iconColor: IND, bg: IND_SOFT, border: IND_BDR, glow: "rgba(48,48,110,0.09)", label: "Upcoming Tests", value: testsDisplay, status: liveStats.tests === null ? "No tests scheduled" : "Next 7 days", statusColor: T4 },
            { icon: Star, iconColor: ROSE, bg: ROSE_S, border: "rgba(255,110,168,0.20)", glow: "rgba(255,110,168,0.14)", label: "Recent Grade", value: liveStats.recentGrade !== "N/A" ? liveStats.recentGrade : "—", status: liveStats.recentSubject, statusColor: T4 },
          ].map(({ icon: Icon, iconColor, bg, border, glow, label, value, status, statusColor }) => (
            <div key={label} className="bg-white rounded-[22px] px-4 pt-[18px] pb-[18px] relative overflow-hidden active:scale-[0.96] transition-transform"
              style={{ boxShadow: SH, border: `0.5px solid ${IND_BDR}` }}>
              <div className="absolute -top-[18px] -right-[18px] w-[72px] h-[72px] rounded-full pointer-events-none"
                style={{ background: `radial-gradient(circle, ${glow} 0%, transparent 70%)`, opacity: 0.55 }} />
              <div className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center mb-[14px] relative"
                style={{ background: bg, border: `0.5px solid ${border}` }}>
                <Icon className="w-[17px] h-[17px]" style={{ color: iconColor }} />
              </div>
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] relative" style={{ color: T4 }}>{label}</div>
              <div className="text-[28px] font-bold mt-1 leading-none relative" style={{ color: T1, letterSpacing: "-0.8px" }}>{value}</div>
              <div className="text-[12px] font-medium mt-[6px] relative truncate" style={{ color: statusColor }}>{status}</div>
            </div>
          ))}
        </div>

        {/* ── AI Live Dark Card ── */}
        <div className="mx-5 mt-4 rounded-[28px] overflow-hidden relative"
          style={{ background: DK, boxShadow: "0 0 0 0.5px rgba(48,48,110,0.16), 0 12px 44px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.14)" }}>
          {/* Indigo ambient glow overlays */}
          <div className="absolute inset-0 pointer-events-none" style={{
            background: "radial-gradient(ellipse 300px 200px at 85% 0%, rgba(48,48,110,0.32) 0%, transparent 60%), radial-gradient(ellipse 220px 220px at -20% 85%, rgba(102,102,192,0.12) 0%, transparent 60%), radial-gradient(ellipse 180px 180px at 50% 52%, rgba(48,48,110,0.06) 0%, transparent 60%)"
          }} />
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: "linear-gradient(rgba(180,180,230,0.018) 1px, transparent 1px), linear-gradient(90deg, rgba(180,180,230,0.018) 1px, transparent 1px)",
            backgroundSize: "30px 30px"
          }} />

          {/* Header */}
          <div className="relative z-10 flex items-center justify-between px-5 pt-[18px] pb-[14px]" style={{ borderBottom: "0.5px solid rgba(180,180,230,0.08)" }}>
            <div className="flex items-center gap-2">
              <span className="text-[14px]" style={{ color: "rgba(180,180,230,0.7)" }}>✦</span>
              <span className="text-[11px] font-bold uppercase tracking-[0.10em]" style={{ color: "rgba(180,180,230,0.6)" }}>Edullent AI · Live</span>
            </div>
            <div className="flex items-center gap-[5px] px-[11px] py-1 rounded-full" style={{ background: "rgba(18,192,78,0.10)", border: "0.5px solid rgba(18,192,78,0.24)" }}>
              <div className="w-[5px] h-[5px] rounded-full animate-pulse" style={{ background: GREEN, boxShadow: "0 0 0 2px rgba(18,192,78,0.2)" }} />
              <span className="text-[10px] font-bold tracking-[0.06em]" style={{ color: GREEN }}>LIVE</span>
            </div>
          </div>

          {dataLoading ? (
            <div className="relative z-10 flex items-center gap-3 py-10 justify-center">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: IND3 }} />
              <span className="text-xs" style={{ color: "rgba(180,180,230,0.4)" }}>Loading {childFirstName}'s data...</span>
            </div>
          ) : (
            <>
              {/* 2×2 Metrics Grid */}
              <div className="relative z-10 grid grid-cols-2" style={{ gap: "1px", background: "rgba(180,180,230,0.07)" }}>
                {/* Attendance */}
                <div className="p-[18px] flex flex-col gap-[10px]" style={{ background: DK_CELL }}>
                  <span className="text-[9px] font-bold uppercase tracking-[0.10em]" style={{ color: "rgba(180,180,230,0.36)" }}>Attendance</span>
                  <div className="flex items-center gap-[10px]">
                    <DonutRing pct={liveStats.attendance ?? 0} color={attOnTrack ? GREEN : ORANGE} size={56} stroke={5} />
                    <div className="flex flex-col gap-[3px]">
                      <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.28)" }}>Target</span>
                      <span className="text-[11px] font-semibold" style={{ color: "rgba(255,255,255,0.58)" }}>85%</span>
                      <div className="w-[52px] h-[3px] rounded-full mt-[2px] overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.min(liveStats.attendance ?? 0, 100)}%`, background: attOnTrack ? GREEN : ORANGE }} />
                      </div>
                      <div className="inline-flex items-center gap-[3px] px-[9px] py-[3px] rounded-full mt-1 w-fit text-[10px] font-bold"
                        style={{
                          background: liveStats.attendance === null ? "rgba(255,255,255,0.05)" : attOnTrack ? "rgba(18,192,78,0.15)" : "rgba(232,51,74,0.15)",
                          color: liveStats.attendance === null ? "rgba(180,180,230,0.5)" : attOnTrack ? "#38DC78" : "#FF85AA",
                          border: `0.5px solid ${liveStats.attendance === null ? "rgba(180,180,230,0.10)" : attOnTrack ? "rgba(18,192,78,0.20)" : "rgba(232,51,74,0.20)"}`
                        }}>
                        {liveStats.attendance === null ? "No data" : attOnTrack ? "✓ On Track" : "Needs Work"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Avg Score */}
                <div className="p-[18px] flex flex-col gap-[10px]" style={{ background: DK_CELL }}>
                  <span className="text-[9px] font-bold uppercase tracking-[0.10em]" style={{ color: "rgba(180,180,230,0.36)" }}>Avg Score</span>
                  <div className="flex items-center gap-[10px]">
                    <DonutRing pct={liveStats.avgScore} color={liveStats.avgScore >= 80 ? GREEN : liveStats.avgScore >= 60 ? IND3 : "#FF6961"} size={56} stroke={5} />
                    <div>
                      <div className="inline-flex items-center px-[9px] py-[3px] rounded-full text-[10px] font-bold"
                        style={{
                          background: liveStats.avgScore >= 80 ? "rgba(18,192,78,0.15)" : liveStats.avgScore >= 60 ? "rgba(170,170,220,0.15)" : "rgba(232,51,74,0.15)",
                          color: liveStats.avgScore >= 80 ? "#38DC78" : liveStats.avgScore >= 60 ? "#AAAADC" : "#FF85AA",
                          border: `0.5px solid ${liveStats.avgScore >= 80 ? "rgba(18,192,78,0.20)" : liveStats.avgScore >= 60 ? "rgba(170,170,220,0.24)" : "rgba(232,51,74,0.20)"}`
                        }}>
                        {liveStats.avgScore >= 80 ? "Excellent" : liveStats.avgScore >= 60 ? "Good" : liveStats.avgScore > 0 ? "Needs Work" : "No Data"}
                      </div>
                      <div className="flex gap-1 mt-2">
                        {["C", "B", "A", "A+"].map(g => {
                          const active = liveStats.avgScore >= (g === "A+" ? 90 : g === "A" ? 80 : g === "B" ? 60 : 0);
                          return (
                            <div key={g} className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center text-[11px] font-bold"
                              style={{ background: active ? "rgba(232,51,74,0.22)" : "rgba(255,255,255,0.05)", color: active ? "#FF85AA" : "rgba(255,255,255,0.18)" }}>
                              {g}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Assignments */}
                <div className="p-[18px] flex flex-col gap-[10px]" style={{ background: DK_CELL }}>
                  <span className="text-[9px] font-bold uppercase tracking-[0.10em]" style={{ color: "rgba(180,180,230,0.36)" }}>Assignments</span>
                  <div className="text-[34px] font-bold leading-none text-white" style={{ letterSpacing: "-1.2px" }}>{pendingDisplay}</div>
                  <div className="text-[11px]" style={{ color: "rgba(255,255,255,0.32)", letterSpacing: "-0.1px" }}>
                    {liveStats.pending === null ? "no data" : "pending"}
                  </div>
                  <div className="inline-flex items-center gap-[3px] px-[9px] py-[3px] rounded-full w-fit text-[10px] font-bold"
                    style={{
                      background: liveStats.pending === null ? "rgba(255,255,255,0.05)" : noPending ? "rgba(18,192,78,0.15)" : "rgba(245,160,0,0.15)",
                      color: liveStats.pending === null ? "rgba(180,180,230,0.5)" : noPending ? "#38DC78" : "#F5A000",
                      border: `0.5px solid ${liveStats.pending === null ? "rgba(180,180,230,0.10)" : noPending ? "rgba(18,192,78,0.20)" : "rgba(245,160,0,0.20)"}`
                    }}>
                    {liveStats.pending === null ? "No assignments yet" : noPending ? "✓ All Done" : `${liveStats.pending} to complete`}
                  </div>
                </div>

                {/* Recent Test */}
                <div className="p-[18px] flex flex-col gap-[10px]" style={{ background: DK_CELL }}>
                  <span className="text-[9px] font-bold uppercase tracking-[0.10em]" style={{ color: "rgba(180,180,230,0.36)" }}>Recent Test</span>
                  <div className="text-[34px] font-bold leading-none text-white" style={{ letterSpacing: "-1.2px" }}>
                    {liveStats.recentGrade !== "N/A" ? liveStats.recentGrade : "—"}
                  </div>
                  <div className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.32)", letterSpacing: "-0.1px" }}>{liveStats.recentSubject}</div>
                  <div className="flex gap-1">
                    {["C", "B", "A", "A+"].map(g => {
                      const gradeSteps = ["C", "B", "A-", "A", "A+"];
                      const gradeIdx = gradeSteps.indexOf(liveStats.recentGrade);
                      const chipMap: Record<string, number> = { C: 0, B: 1, A: 3, "A+": 4 };
                      const chipIdx = chipMap[g];
                      const active = gradeIdx >= 0 && chipIdx <= gradeIdx;
                      return (
                        <div key={g} className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center text-[11px] font-bold"
                          style={{ background: active ? "rgba(232,51,74,0.22)" : "rgba(255,255,255,0.05)", color: active ? "#FF85AA" : "rgba(255,255,255,0.18)" }}>
                          {g}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* AI Insight Strip */}
              <div className="relative z-10 px-[18px] py-[14px] flex items-start gap-[10px]" style={{ borderTop: "0.5px solid rgba(180,180,230,0.07)", background: "rgba(255,255,255,0.016)" }}>
                <span className="text-[16px] mt-0.5">🤖</span>
                {aiInsights?.child_summary_narrative ? (
                  <p className="text-[12px] leading-[1.65]" style={{ color: "rgba(180,180,230,0.52)", letterSpacing: "-0.1px" }}>
                    <strong style={{ color: "rgba(255,255,255,0.86)", fontWeight: 600 }}>{studentData?.name}</strong>{" "}
                    {aiInsights.child_summary_narrative.replace(studentData?.name || "", "").trim()}
                  </p>
                ) : (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" style={{ color: IND3 }} />
                    <p className="text-[11px] italic" style={{ color: "rgba(180,180,230,0.4)" }}>AI summary generating...</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Profile Card (Indigo gradient) ── */}
        <div className="mx-5 mt-5 rounded-[28px] p-6 relative overflow-hidden"
          style={{
            background: `linear-gradient(140deg, ${IND} 0%, ${IND2} 100%)`,
            boxShadow: "0 10px 36px rgba(48,48,110,0.22), 0 0 0 0.5px rgba(255,255,255,0.18)",
            border: "0.5px solid rgba(255,255,255,0.18)"
          }}>
          <div className="absolute -top-[55px] -right-[35px] w-[210px] h-[210px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(255,255,255,0.11) 0%, transparent 70%)" }} />
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
            backgroundSize: "26px 26px"
          }} />

          <div className="relative z-10">
            <div className="w-[68px] h-[68px] rounded-[22px] flex items-center justify-center text-[24px] font-bold text-white mb-4"
              style={{ background: "rgba(255,255,255,0.18)", border: "0.5px solid rgba(255,255,255,0.26)", boxShadow: "0 4px 20px rgba(0,0,0,0.18)" }}>
              {studentInitials}
            </div>
            <div className="text-[22px] font-bold text-white" style={{ letterSpacing: "-0.6px" }}>{studentData?.name || "Student"}</div>
            <div className="text-[14px] mt-[3px]" style={{ color: "rgba(255,255,255,0.52)" }}>
              {studentMeta.className !== "—" ? `Grade ${studentMeta.className}` : studentData?.grade ? `Grade ${studentData.grade}` : "Grade —"}
              {teacherInfo.name !== "—" ? ` — ${teacherInfo.name}` : ""}
            </div>
            <div className="grid grid-cols-2 mt-5 rounded-[15px] overflow-hidden" style={{ gap: "1px", background: "rgba(255,255,255,0.10)" }}>
              <div className="px-[15px] py-[13px]" style={{ background: "rgba(255,255,255,0.07)" }}>
                <div className="text-[10px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.38)" }}>Class Teacher</div>
                <div className="text-[15px] font-semibold mt-1 text-white" style={{ letterSpacing: "-0.2px" }}>{teacherInfo.name}</div>
              </div>
              <div className="px-[15px] py-[13px]" style={{ background: "rgba(255,255,255,0.07)" }}>
                <div className="text-[10px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.38)" }}>Academic Year</div>
                <div className="text-[15px] font-semibold mt-1 text-white" style={{ letterSpacing: "-0.2px" }}>{academicYear}</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Recent Alerts ── */}
        <div className="mx-5 mt-[14px] bg-white rounded-[22px] p-5" style={{ boxShadow: SH, border: `0.5px solid ${IND_BDR}` }}>
          <h3 className="text-[18px] font-bold mb-5" style={{ color: T1, letterSpacing: "-0.4px" }}>Recent Alerts</h3>
          {recentAlerts.length > 0 ? (
            <div className="space-y-3">
              {recentAlerts.map(alert => (
                <div key={alert.id} className="flex items-start gap-3 p-3 rounded-xl"
                  style={{ background: alert.urgent ? "rgba(245,160,0,0.08)" : "rgba(18,192,78,0.08)" }}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: alert.urgent ? "rgba(245,160,0,0.15)" : "rgba(18,192,78,0.15)", color: alert.urgent ? ORANGE : GREEN }}>
                    {alert.urgent ? <Clock className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium leading-snug" style={{ color: T1 }}>{alert.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: T3 }}>{timeAgo(alert.time)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-[10px] p-4">
              <div className="w-[54px] h-[54px] rounded-[17px] flex items-center justify-center"
                style={{ background: IND_SOFT, border: `0.5px solid ${IND_BDR}`, boxShadow: "0 0 0 5px rgba(48,48,110,0.03)" }}>
                <ShieldCheck className="w-6 h-6" style={{ color: T4 }} />
              </div>
              <p className="text-[14px]" style={{ color: T3 }}>No alerts right now</p>
            </div>
          )}
        </div>

        {/* ── Weekly AI Report Card ── */}
        <div className="mx-5 mt-[14px] bg-white rounded-[22px] px-5 py-[18px]" style={{ boxShadow: SH, border: `0.5px solid ${IND_BDR}` }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-[42px] h-[42px] rounded-[14px] flex items-center justify-center"
                style={{ background: IND_SOFT, border: `0.5px solid ${IND_BDR}` }}>
                <BookOpen className="w-[18px] h-[18px]" style={{ color: IND }} />
              </div>
              <div>
                <div className="text-[15px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Weekly AI Report</div>
                <div className="text-[12px] mt-0.5" style={{ color: T3 }}>
                  {isPrevWeekReport ? "Last week's report" : weekConfig.canGenerate ? (weeklyReport ? "This week's digest" : "Generate this week's report") : "New report available Friday"}
                </div>
              </div>
            </div>
            {weekConfig.canGenerate && !weeklyReport ? (
              <button onClick={handleGenerateWeeklyReport} disabled={weeklyLoading || dataLoading}
                className="flex items-center gap-2 px-3 py-2 rounded-[12px] text-[12px] font-semibold text-white disabled:opacity-50"
                style={{ background: IND, boxShadow: "0 2px 8px rgba(48,48,110,0.28)" }}>
                {weeklyLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {weeklyLoading ? "..." : "Generate"}
              </button>
            ) : !weekConfig.canGenerate ? (
              <div className="flex items-center gap-1 px-[11px] py-[7px] rounded-[12px] text-[11px] font-semibold whitespace-nowrap"
                style={{ background: "#E5E5EC", color: T3, border: `0.5px solid ${IND_BDR}` }}>
                <Clock className="w-[11px] h-[11px]" />
                Fri{weekConfig.daysLeft > 0 ? ` · ${weekConfig.daysLeft}d` : ""}
              </div>
            ) : null}
          </div>

          {weeklyLoading && (
            <div className="flex flex-col items-center py-6 gap-3">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: IND }} />
              <p className="text-xs" style={{ color: T3 }}>Analysing {childFirstName}'s week...</p>
            </div>
          )}

          {!weeklyReport && !weeklyLoading && (
            <div className="flex items-start gap-2 mt-[14px] pt-[14px]" style={{ borderTop: `0.5px solid ${SEP}` }}>
              <Clock className="w-[14px] h-[14px] shrink-0 mt-0.5" style={{ color: T4 }} />
              <p className="text-[13px] leading-[1.6]" style={{ color: T3, letterSpacing: "-0.1px" }}>
                {weekConfig.canGenerate
                  ? `Tap "Generate" to get ${childFirstName}'s weekly digest.`
                  : `You can generate ${childFirstName}'s weekly report every Friday, Saturday & Sunday.`}
              </p>
            </div>
          )}

          {weeklyReport && !weeklyLoading && isPrevWeekReport && (
            <div className="flex items-start gap-2 mt-[14px] pt-[14px]" style={{ borderTop: `0.5px solid ${SEP}` }}>
              <Clock className="w-[14px] h-[14px] shrink-0 mt-0.5" style={{ color: T4 }} />
              <p className="text-[13px] leading-[1.55]" style={{ color: T3 }}>
                This is last week's report. A new report can be generated this Friday.
              </p>
            </div>
          )}
        </div>

        {/* ── AI Message (Indigo gradient) ── */}
        {weeklyReport && !weeklyLoading && (
          <div className="mx-5 mt-3 rounded-[24px] px-[22px] py-5 relative overflow-hidden"
            style={{
              background: `linear-gradient(138deg, ${IND} 0%, ${IND2} 100%)`,
              border: "0.5px solid rgba(48,48,110,0.22)",
              boxShadow: "0 6px 28px rgba(48,48,110,0.22), 0 2px 8px rgba(48,48,110,0.14)"
            }}>
            <div className="absolute -top-8 -right-5 w-[160px] h-[160px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(255,255,255,0.10) 0%, transparent 65%)" }} />
            <div className="absolute inset-0 pointer-events-none" style={{
              backgroundImage: "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
              backgroundSize: "26px 26px"
            }} />
            <div className="relative z-10">
              <div className="flex items-center gap-[6px] text-[10px] font-bold uppercase tracking-[0.10em] mb-3" style={{ color: "rgba(255,255,255,0.52)" }}>
                <Sparkles className="w-3 h-3" />
                AI Message
              </div>
              <p className="text-[14px] leading-[1.72] font-normal" style={{ color: "rgba(255,255,255,0.92)", letterSpacing: "-0.1px" }}>
                {weeklyReport.message}
              </p>
            </div>
          </div>
        )}

        {/* ── Detail Sections ── */}
        {weeklyReport && !weeklyLoading && (
          <div className="mx-5 mt-3 bg-white rounded-[22px] overflow-hidden" style={{ boxShadow: SH, border: `0.5px solid ${IND_BDR}` }}>
            {[
              { tag: "Attendance", text: weeklyReport.attendance_summary },
              { tag: "Tests", text: weeklyReport.test_analysis },
              { tag: "Assignments", text: weeklyReport.assignment_status },
            ].map(({ tag, text }, i, arr) => (
              <div key={tag} className="px-[18px] py-[15px] flex flex-col gap-[5px]"
                style={{ borderBottom: i < arr.length - 1 ? `0.5px solid ${SEP}` : "none" }}>
                <span className="text-[10px] font-bold uppercase tracking-[0.09em]" style={{ color: IND3 }}>{tag}</span>
                <p className="text-[13px] leading-[1.58]" style={{ color: T2, letterSpacing: "-0.1px" }}>{text}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Overall Performance Card ── */}
        {weeklyReport?.overall_performance && (
          <div className="mx-5 mt-[14px] bg-white rounded-[22px] px-5 py-[18px] flex items-start justify-between gap-[14px] relative overflow-hidden"
            style={{ border: `0.5px solid ${ORANGE_B}`, boxShadow: SH }}>
            <div className="absolute -top-4 -right-4 w-[60px] h-[60px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(245,160,0,0.10) 0%, transparent 70%)" }} />
            <div className="relative z-10">
              <div className="text-[10px] font-bold uppercase tracking-[0.09em] mb-[5px]" style={{ color: ORANGE }}>Overall Performance</div>
              <div className="text-[17px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>{weeklyReport.overall_performance.verdict}</div>
              <p className="text-[12px] mt-[5px] leading-[1.58]" style={{ color: T3, letterSpacing: "-0.1px" }}>{weeklyReport.overall_performance.score_context}</p>
            </div>
            <div className="flex items-center gap-1 px-[14px] py-[9px] rounded-[14px] text-[12px] font-bold shrink-0 relative z-10"
              style={{
                background: weeklyReport.overall_performance.trend === "Declining" ? ORANGE_S : GREEN_S,
                border: `0.5px solid ${weeklyReport.overall_performance.trend === "Declining" ? ORANGE_B : GREEN_B}`,
                color: weeklyReport.overall_performance.trend === "Declining" ? "#905800" : "#0A6A2E",
                boxShadow: "0 1px 4px rgba(0,0,0,0.04)"
              }}>
              <TrendingUp className={`w-3 h-3 ${weeklyReport.overall_performance.trend === "Declining" ? "rotate-180" : ""}`} />
              {weeklyReport.overall_performance.trend}
            </div>
          </div>
        )}

        {/* ── AI Improvement Tips ── */}
        {weeklyReport?.improvement_tips?.length > 0 && (
          <>
            <div className="px-6 pt-5 pb-0 text-[10px] font-bold uppercase tracking-[0.10em]" style={{ color: T4 }}>
              AI Improvement Tips
            </div>
            {weeklyReport.improvement_tips.map((t: { tip: string; reason: string }, i: number) => (
              <div key={i} className="mx-5 mt-[10px] bg-white rounded-[20px] px-[18px] py-4 flex items-start gap-[14px] active:scale-[0.97] transition-transform"
                style={{ boxShadow: SH, border: `0.5px solid ${IND_BDR}` }}>
                <div className="w-[42px] h-[42px] rounded-[13px] flex items-center justify-center shrink-0 text-[20px]"
                  style={{
                    background: i === 0 ? "rgba(255,215,0,0.12)" : IND_SOFT,
                    border: `0.5px solid ${i === 0 ? "rgba(255,215,0,0.22)" : IND_BDR}`
                  }}>
                  {i === 0 ? "💡" : "🎯"}
                </div>
                <div>
                  <div className="text-[14px] font-semibold leading-[1.35]" style={{ color: T1, letterSpacing: "-0.2px" }}>{t.tip}</div>
                  <p className="text-[12px] mt-[3px] leading-[1.5]" style={{ color: T3, letterSpacing: "-0.1px" }}>{t.reason}</p>
                </div>
              </div>
            ))}
          </>
        )}

        {/* ── Download PDF Button ── */}
        {weeklyReport && !weeklyLoading && (
          <button onClick={handleDownloadPDF} disabled={pdfDownloading}
            className="mx-5 mt-5 w-[calc(100%-40px)] rounded-[18px] py-[17px] flex items-center justify-center gap-[9px] text-[16px] font-bold text-white disabled:opacity-50 active:scale-[0.97] transition-transform relative overflow-hidden"
            style={{ background: `linear-gradient(135deg, ${IND} 0%, #1C1C4A 100%)`, boxShadow: SH_BTN, letterSpacing: "-0.2px" }}>
            <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.13) 0%, transparent 52%)" }} />
            <span className="relative z-10 flex items-center gap-[9px]">
              {pdfDownloading ? (
                <><Loader2 className="w-[17px] h-[17px] animate-spin" /> Generating PDF...</>
              ) : (
                <><Download className="w-[17px] h-[17px]" /> Download PDF Report</>
              )}
            </span>
          </button>
        )}

        {/* ── AI Parenting Tips ── */}
        <div className="mx-5 mt-5 mb-2 bg-white rounded-[22px] overflow-hidden" style={{ boxShadow: SH, border: `0.5px solid ${IND_BDR}` }}>
          {/* Indigo-gradient header */}
          <div className="flex items-center gap-3 px-5 py-4 relative overflow-hidden"
            style={{ background: `linear-gradient(135deg, ${IND} 0%, ${IND2} 100%)`, borderBottom: `0.5px solid ${IND_BDR}` }}>
            <div className="absolute -top-7 -right-4 w-[120px] h-[120px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(255,255,255,0.09) 0%, transparent 65%)" }} />
            <div className="absolute inset-0 pointer-events-none" style={{
              backgroundImage: "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
              backgroundSize: "24px 24px"
            }} />
            <span className="text-[22px] relative z-10">💡</span>
            <div className="relative z-10">
              <div className="text-[16px] font-bold text-white" style={{ letterSpacing: "-0.3px" }}>AI Parenting Tips</div>
              <div className="text-[12px] mt-0.5" style={{ color: "rgba(255,255,255,0.52)" }}>Based on {childFirstName}'s current data</div>
            </div>
          </div>

          {/* Tips list */}
          {(() => {
            const tips = aiInsights?.parenting_tips?.length > 0 ? aiInsights.parenting_tips : smartTips;
            return tips.length > 0 ? tips.map((item: { tip: string; reason: string }, i: number) => (
              <div key={i} className="px-[18px] py-[15px] flex items-start gap-[14px]"
                style={{ borderBottom: i < tips.length - 1 ? `0.5px solid ${SEP}` : "none" }}>
                <div className="w-7 h-7 rounded-[9px] flex items-center justify-center text-[12px] font-bold shrink-0 mt-0.5"
                  style={{ background: IND_SOFT, border: `0.5px solid ${IND_BDR}`, color: IND }}>
                  {i + 1}
                </div>
                <div>
                  <div className="text-[13px] font-semibold" style={{ color: T1, letterSpacing: "-0.2px" }}>{item.tip}</div>
                  <p className="text-[12px] mt-[3px] leading-[1.5]" style={{ color: T3, letterSpacing: "-0.1px" }}>{item.reason}</p>
                </div>
              </div>
            )) : (
              <div className="px-[18px] py-6 flex items-center gap-3">
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: IND }} />
                <p className="text-sm italic" style={{ color: T3 }}>Loading {childFirstName}'s tips...</p>
              </div>
            );
          })()}
        </div>

        <div className="h-6" />

        {/* Hidden PDF render target */}
        {weeklyReport && pdfData && (
          <div style={{ position: "fixed", top: "-9999px", left: "-9999px", zIndex: -1 }}>
            <WeeklyReportPDF
              ref={pdfRef}
              report={weeklyReport}
              studentName={pdfData.child_name}
              grade={pdfData.grade}
              attendance={pdfData.attendance}
              tests={pdfData.tests}
              assignments={pdfData.assignments}
              avgScore={pdfData.overall_avg}
              weekEnd={pdfData.weekEnd}
              onDownload={() => {}}
            />
          </div>
        )}
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     DESKTOP — Edullent Indigo Apple UI (matches mobile language)
     ═══════════════════════════════════════════════════════════════ */
  {
    // Indigo tokens (same as mobile)
    const IND = "#30306E";
    const IND2 = "#4444A0";
    const IND3 = "#6666C0";
    const BG = "#EEEEF3";
    const T1 = "rgba(48,48,110,0.90)";
    const T2 = "rgba(48,48,110,0.70)";
    const T3 = "rgba(48,48,110,0.42)";
    const T4 = "rgba(48,48,110,0.25)";
    const SEP = "rgba(48,48,110,0.06)";
    const IND_BDR = "rgba(48,48,110,0.12)";
    const IND_SOFT = "rgba(48,48,110,0.07)";
    const GREEN = "#12C04E";
    const GREEN_S = "rgba(18,192,78,0.10)";
    const GREEN_B = "rgba(18,192,78,0.22)";
    const ORANGE = "#F5A000";
    const ORANGE_S = "rgba(245,160,0,0.10)";
    const ORANGE_B = "rgba(245,160,0,0.22)";
    const ROSE = "#FF6EA8";
    const ROSE_S = "rgba(255,110,168,0.10)";
    const DK = "#09092A";
    const DK_CELL = "rgba(9,9,42,0.58)";
    const SH = "0 0 0 0.5px rgba(48,48,110,0.06), 0 1px 3px rgba(48,48,110,0.04), 0 8px 20px rgba(48,48,110,0.07)";
    const SH_LG = "0 0 0 0.5px rgba(48,48,110,0.08), 0 2px 8px rgba(48,48,110,0.06), 0 16px 36px rgba(48,48,110,0.10), 0 32px 56px rgba(48,48,110,0.06)";
    const SH_BTN = "0 4px 14px rgba(48,48,110,0.28), 0 1px 4px rgba(48,48,110,0.18)";

    const scorePct = Math.min(liveStats.avgScore, 100);
    const ringR = 56, ringCirc = 2 * Math.PI * ringR;
    const ringOffset = ringCirc - (scorePct / 100) * ringCirc;
    const attOnTrack = liveStats.attendance !== null && liveStats.attendance >= 85;
    const noPending = liveStats.pending === 0;
    const isImproving = liveStats.trendPct > 0;
    const isDeclining = liveStats.trendPct < 0;
    const trendStable = liveStats.trendPct === 0;

    return (
      <div className="animate-in fade-in duration-500 -m-4 sm:-m-6 md:-m-8 min-h-[calc(100vh-64px)]"
        style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: BG }}>
        <div className="w-full px-6 pt-8 pb-12">

          {/* ── Greeting + Date ── */}
          <div className="flex items-start justify-between gap-6 flex-wrap mb-8">
            <div>
              <h1 className="text-[42px] font-bold leading-[1.05]" style={{ color: T1, letterSpacing: "-1.2px" }}>
                {greeting},{" "}
                <span style={{ background: `linear-gradient(130deg, ${IND} 0%, ${IND3} 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  {parentFirstName}
                </span> 👋
              </h1>
              <p className="text-[15px] mt-2" style={{ color: T3, letterSpacing: "-0.1px" }}>Here's how {childFirstName} is doing today</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end">
                <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: T4 }}>
                  {currentTime.toLocaleDateString("en-US", { weekday: "long" })}
                </span>
                <span className="text-[14px] font-semibold mt-[2px]" style={{ color: T2 }}>
                  {currentTime.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                </span>
              </div>
              <div className="w-12 h-12 rounded-[14px] flex items-center justify-center text-[14px] font-bold text-white"
                style={{ background: `linear-gradient(140deg, ${IND} 0%, ${IND2} 100%)`, boxShadow: "0 4px 14px rgba(48,48,110,0.28)" }}>
                {userInitials}
              </div>
            </div>
          </div>

          {/* ── Row 1: Academic Health + Profile Card ── */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 mb-5">

            {/* Academic Health (lg:col-span-3) */}
            <div className="lg:col-span-3 bg-white rounded-[28px] p-8 relative overflow-hidden"
              style={{ boxShadow: SH_LG, border: `0.5px solid ${IND_BDR}` }}>
              <div className="absolute -top-[80px] -right-[60px] w-[260px] h-[260px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(48,48,110,0.05) 0%, transparent 70%)" }} />
              <div className="absolute -bottom-[60px] left-6 w-[200px] h-[200px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(48,48,110,0.03) 0%, transparent 70%)" }} />
              <div className="relative z-10">
                <div className="flex items-start justify-between gap-4 mb-6">
                  <div>
                    <h3 className="text-[22px] font-bold" style={{ color: T1, letterSpacing: "-0.5px" }}>Academic Health</h3>
                    <p className="text-[14px] mt-1" style={{ color: T3 }}>Overall performance indicator</p>
                  </div>
                  <div className="inline-flex items-center gap-[6px] px-[14px] py-[7px] rounded-full text-[13px] font-semibold"
                    style={{
                      background: trendStable || isImproving ? GREEN_S : ORANGE_S,
                      color: trendStable || isImproving ? "#0A6A2E" : "#905800",
                      border: `0.5px solid ${trendStable || isImproving ? GREEN_B : ORANGE_B}`,
                      letterSpacing: "-0.1px"
                    }}>
                    <TrendingUp className={`w-[13px] h-[13px] ${isDeclining ? "rotate-180" : ""}`} />
                    {trendStable ? "Stable performance" : isImproving ? `Improved by ${liveStats.trendPct}%` : `Declined by ${Math.abs(liveStats.trendPct)}%`}
                  </div>
                </div>
                <div className="flex items-end justify-between gap-6 mt-8">
                  <div className="flex flex-col gap-2">
                    <div className="text-[80px] font-bold leading-none" style={{ color: IND, letterSpacing: "-4.5px" }}>
                      {liveStats.avgScore > 0 ? `${liveStats.avgScore}%` : "—"}
                    </div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.10em] mt-2" style={{ color: T4 }}>
                      {liveStats.avgScore >= 75 ? "Good Standing" : liveStats.avgScore > 0 ? "Needs Attention" : "No data yet"}
                    </div>
                  </div>
                  <div className="relative w-[140px] h-[140px] shrink-0">
                    <svg viewBox="0 0 140 140" width="140" height="140" style={{ transform: "rotate(-90deg)" }}>
                      <defs>
                        <linearGradient id="indGradDesk" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor={IND3} />
                          <stop offset="100%" stopColor={IND} />
                        </linearGradient>
                      </defs>
                      <circle cx="70" cy="70" r={ringR} fill="none" stroke="rgba(48,48,110,0.09)" strokeWidth="10" />
                      <circle cx="70" cy="70" r={ringR} fill="none" stroke="url(#indGradDesk)" strokeWidth="10" strokeLinecap="round"
                        strokeDasharray={ringCirc} strokeDashoffset={ringOffset}
                        style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)" }} />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center text-[22px] font-bold" style={{ color: T1, letterSpacing: "-0.5px" }}>
                      {liveStats.avgScore > 0 ? `${liveStats.avgScore}%` : "—"}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Profile Card (lg:col-span-2) */}
            <div className="lg:col-span-2 rounded-[28px] p-7 relative overflow-hidden"
              style={{
                background: `linear-gradient(140deg, ${IND} 0%, ${IND2} 100%)`,
                boxShadow: "0 10px 36px rgba(48,48,110,0.22), 0 0 0 0.5px rgba(255,255,255,0.18)",
                border: "0.5px solid rgba(255,255,255,0.18)"
              }}>
              <div className="absolute -top-[55px] -right-[35px] w-[210px] h-[210px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(255,255,255,0.11) 0%, transparent 70%)" }} />
              <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
                backgroundSize: "26px 26px"
              }} />
              <div className="relative z-10">
                <div className="w-[68px] h-[68px] rounded-[22px] flex items-center justify-center text-[24px] font-bold text-white mb-4"
                  style={{ background: "rgba(255,255,255,0.18)", border: "0.5px solid rgba(255,255,255,0.26)", boxShadow: "0 4px 20px rgba(0,0,0,0.18)" }}>
                  {studentInitials}
                </div>
                <div className="text-[24px] font-bold text-white" style={{ letterSpacing: "-0.6px" }}>{studentData?.name || "Student"}</div>
                <div className="text-[14px] mt-[3px]" style={{ color: "rgba(255,255,255,0.52)" }}>
                  {studentMeta.className !== "—" ? `Grade ${studentMeta.className}` : studentData?.grade ? `Grade ${studentData.grade}` : "Grade —"}
                  {studentMeta.rollNo !== "—" ? ` · Roll ${studentMeta.rollNo}` : ""}
                </div>
                <div className="grid grid-cols-2 mt-5 rounded-[15px] overflow-hidden" style={{ gap: "1px", background: "rgba(255,255,255,0.10)" }}>
                  <div className="px-[15px] py-[13px]" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div className="text-[10px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.38)" }}>Class Teacher</div>
                    <div className="text-[15px] font-semibold mt-1 text-white truncate" style={{ letterSpacing: "-0.2px" }}>{teacherInfo.name}</div>
                  </div>
                  <div className="px-[15px] py-[13px]" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div className="text-[10px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.38)" }}>Academic Year</div>
                    <div className="text-[15px] font-semibold mt-1 text-white" style={{ letterSpacing: "-0.2px" }}>{academicYear}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Row 2: 4 Stat Cards ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            {[
              { icon: CheckCircle, iconColor: GREEN, bg: GREEN_S, border: "rgba(18,192,78,0.20)", glow: "rgba(18,192,78,0.14)", label: "Attendance", value: attDisplay, status: liveStats.attendance === null ? "No records yet" : attOnTrack ? "On track ✓" : "Below target", statusColor: liveStats.attendance === null ? T4 : attOnTrack ? GREEN : ORANGE },
              { icon: AlertCircle, iconColor: ORANGE, bg: ORANGE_S, border: "rgba(245,160,0,0.20)", glow: "rgba(245,160,0,0.14)", label: "Pending Work", value: pendingDisplay, status: liveStats.pending === null ? "No assignments yet" : noPending ? "All clear ✓" : "Due this week", statusColor: liveStats.pending === null ? T4 : noPending ? GREEN : ORANGE },
              { icon: Calendar, iconColor: IND, bg: IND_SOFT, border: IND_BDR, glow: "rgba(48,48,110,0.09)", label: "Upcoming Tests", value: testsDisplay, status: liveStats.tests === null ? "No tests scheduled" : "Next 7 days", statusColor: T4 },
              { icon: Star, iconColor: ROSE, bg: ROSE_S, border: "rgba(255,110,168,0.20)", glow: "rgba(255,110,168,0.14)", label: "Recent Grade", value: liveStats.recentGrade !== "N/A" ? liveStats.recentGrade : "—", status: liveStats.recentSubject, statusColor: T4 },
            ].map(({ icon: Icon, iconColor, bg, border, glow, label, value, status, statusColor }) => (
              <div key={label} className="bg-white rounded-[22px] px-5 pt-5 pb-5 relative overflow-hidden transition-transform hover:-translate-y-0.5"
                style={{ boxShadow: SH, border: `0.5px solid ${IND_BDR}` }}>
                <div className="absolute -top-[18px] -right-[18px] w-[90px] h-[90px] rounded-full pointer-events-none"
                  style={{ background: `radial-gradient(circle, ${glow} 0%, transparent 70%)`, opacity: 0.55 }} />
                <div className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center mb-4 relative"
                  style={{ background: bg, border: `0.5px solid ${border}` }}>
                  <Icon className="w-[18px] h-[18px]" style={{ color: iconColor }} />
                </div>
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] relative" style={{ color: T4 }}>{label}</div>
                <div className="text-[34px] font-bold mt-1 leading-none relative" style={{ color: T1, letterSpacing: "-1px" }}>{value}</div>
                <div className="text-[12px] font-medium mt-[6px] relative truncate" style={{ color: statusColor }}>{status}</div>
              </div>
            ))}
          </div>

          {/* ── AI Live Dark Card ── */}
          <div className="rounded-[28px] overflow-hidden relative mb-5"
            style={{ background: DK, boxShadow: "0 0 0 0.5px rgba(48,48,110,0.16), 0 12px 44px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.14)" }}>
            <div className="absolute inset-0 pointer-events-none" style={{
              background: "radial-gradient(ellipse 500px 300px at 85% 0%, rgba(48,48,110,0.32) 0%, transparent 60%), radial-gradient(ellipse 360px 360px at -10% 85%, rgba(102,102,192,0.12) 0%, transparent 60%), radial-gradient(ellipse 300px 300px at 50% 52%, rgba(48,48,110,0.06) 0%, transparent 60%)"
            }} />
            <div className="absolute inset-0 pointer-events-none" style={{
              backgroundImage: "linear-gradient(rgba(180,180,230,0.018) 1px, transparent 1px), linear-gradient(90deg, rgba(180,180,230,0.018) 1px, transparent 1px)",
              backgroundSize: "30px 30px"
            }} />

            {/* Header */}
            <div className="relative z-10 flex items-center justify-between px-7 pt-5 pb-[14px]" style={{ borderBottom: "0.5px solid rgba(180,180,230,0.08)" }}>
              <div className="flex items-center gap-2">
                <span className="text-[15px]" style={{ color: "rgba(180,180,230,0.7)" }}>✦</span>
                <span className="text-[12px] font-bold uppercase tracking-[0.10em]" style={{ color: "rgba(180,180,230,0.6)" }}>Edullent AI · Live Summary</span>
              </div>
              <div className="flex items-center gap-[5px] px-3 py-[5px] rounded-full" style={{ background: "rgba(18,192,78,0.10)", border: "0.5px solid rgba(18,192,78,0.24)" }}>
                <div className="w-[6px] h-[6px] rounded-full animate-pulse" style={{ background: GREEN, boxShadow: "0 0 0 2px rgba(18,192,78,0.2)" }} />
                <span className="text-[10px] font-bold tracking-[0.06em]" style={{ color: GREEN }}>LIVE</span>
              </div>
            </div>

            {dataLoading ? (
              <div className="relative z-10 flex items-center gap-3 py-14 justify-center">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: IND3 }} />
                <span className="text-sm" style={{ color: "rgba(180,180,230,0.4)" }}>Loading {childFirstName}'s data...</span>
              </div>
            ) : (
              <>
                <div className="relative z-10 grid grid-cols-2 lg:grid-cols-4" style={{ gap: "1px", background: "rgba(180,180,230,0.07)" }}>
                  {/* Attendance */}
                  <div className="p-5 flex flex-col gap-3" style={{ background: DK_CELL }}>
                    <span className="text-[10px] font-bold uppercase tracking-[0.10em]" style={{ color: "rgba(180,180,230,0.36)" }}>Attendance</span>
                    <div className="flex items-center gap-3">
                      <DonutRing pct={liveStats.attendance ?? 0} color={attOnTrack ? GREEN : ORANGE} size={72} stroke={6} />
                      <div className="flex flex-col gap-[3px]">
                        <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.28)" }}>Target</span>
                        <span className="text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.58)" }}>85%</span>
                        <div className="w-[60px] h-[3px] rounded-full mt-1 overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(liveStats.attendance ?? 0, 100)}%`, background: attOnTrack ? GREEN : ORANGE }} />
                        </div>
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-[3px] px-[9px] py-[3px] rounded-full w-fit text-[10px] font-bold"
                      style={{
                        background: liveStats.attendance === null ? "rgba(255,255,255,0.05)" : attOnTrack ? "rgba(18,192,78,0.15)" : "rgba(232,51,74,0.15)",
                        color: liveStats.attendance === null ? "rgba(180,180,230,0.5)" : attOnTrack ? "#38DC78" : "#FF85AA",
                        border: `0.5px solid ${liveStats.attendance === null ? "rgba(180,180,230,0.10)" : attOnTrack ? "rgba(18,192,78,0.20)" : "rgba(232,51,74,0.20)"}`
                      }}>
                      {liveStats.attendance === null ? "No data" : attOnTrack ? "✓ On Track" : "Needs Work"}
                    </div>
                  </div>

                  {/* Avg Score */}
                  <div className="p-5 flex flex-col gap-3" style={{ background: DK_CELL }}>
                    <span className="text-[10px] font-bold uppercase tracking-[0.10em]" style={{ color: "rgba(180,180,230,0.36)" }}>Avg Score</span>
                    <div className="flex items-center gap-3">
                      <DonutRing pct={liveStats.avgScore} color={liveStats.avgScore >= 80 ? GREEN : liveStats.avgScore >= 60 ? IND3 : "#FF6961"} size={72} stroke={6} />
                      <div>
                        <div className="inline-flex items-center px-[10px] py-[4px] rounded-full text-[11px] font-bold"
                          style={{
                            background: liveStats.avgScore >= 80 ? "rgba(18,192,78,0.15)" : liveStats.avgScore >= 60 ? "rgba(170,170,220,0.15)" : "rgba(232,51,74,0.15)",
                            color: liveStats.avgScore >= 80 ? "#38DC78" : liveStats.avgScore >= 60 ? "#AAAADC" : "#FF85AA",
                            border: `0.5px solid ${liveStats.avgScore >= 80 ? "rgba(18,192,78,0.20)" : liveStats.avgScore >= 60 ? "rgba(170,170,220,0.24)" : "rgba(232,51,74,0.20)"}`
                          }}>
                          {liveStats.avgScore >= 80 ? "Excellent" : liveStats.avgScore >= 60 ? "Good" : liveStats.avgScore > 0 ? "Needs Work" : "No Data"}
                        </div>
                        <div className="flex gap-1 mt-2">
                          {["C", "B", "A", "A+"].map(g => {
                            const active = liveStats.avgScore >= (g === "A+" ? 90 : g === "A" ? 80 : g === "B" ? 60 : 0);
                            return (
                              <div key={g} className="w-[28px] h-[28px] rounded-[8px] flex items-center justify-center text-[11px] font-bold"
                                style={{ background: active ? "rgba(232,51,74,0.22)" : "rgba(255,255,255,0.05)", color: active ? "#FF85AA" : "rgba(255,255,255,0.18)" }}>
                                {g}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Assignments */}
                  <div className="p-5 flex flex-col gap-3" style={{ background: DK_CELL }}>
                    <span className="text-[10px] font-bold uppercase tracking-[0.10em]" style={{ color: "rgba(180,180,230,0.36)" }}>Assignments</span>
                    <div className="text-[42px] font-bold leading-none text-white" style={{ letterSpacing: "-1.4px" }}>{pendingDisplay}</div>
                    <div className="text-[12px]" style={{ color: "rgba(255,255,255,0.32)", letterSpacing: "-0.1px" }}>
                      {liveStats.pending === null ? "no data" : "pending"}
                    </div>
                    <div className="inline-flex items-center gap-[3px] px-[9px] py-[3px] rounded-full w-fit text-[10px] font-bold"
                      style={{
                        background: liveStats.pending === null ? "rgba(255,255,255,0.05)" : noPending ? "rgba(18,192,78,0.15)" : "rgba(245,160,0,0.15)",
                        color: liveStats.pending === null ? "rgba(180,180,230,0.5)" : noPending ? "#38DC78" : "#F5A000",
                        border: `0.5px solid ${liveStats.pending === null ? "rgba(180,180,230,0.10)" : noPending ? "rgba(18,192,78,0.20)" : "rgba(245,160,0,0.20)"}`
                      }}>
                      {liveStats.pending === null ? "No assignments yet" : noPending ? "✓ All Done" : `${liveStats.pending} to complete`}
                    </div>
                  </div>

                  {/* Recent Test */}
                  <div className="p-5 flex flex-col gap-3" style={{ background: DK_CELL }}>
                    <span className="text-[10px] font-bold uppercase tracking-[0.10em]" style={{ color: "rgba(180,180,230,0.36)" }}>Recent Test</span>
                    <div className="text-[42px] font-bold leading-none text-white" style={{ letterSpacing: "-1.4px" }}>
                      {liveStats.recentGrade !== "N/A" ? liveStats.recentGrade : "—"}
                    </div>
                    <div className="text-[12px] truncate" style={{ color: "rgba(255,255,255,0.32)", letterSpacing: "-0.1px" }}>{liveStats.recentSubject}</div>
                    <div className="flex gap-1">
                      {["C", "B", "A", "A+"].map(g => {
                        const gradeSteps = ["C", "B", "A-", "A", "A+"];
                        const gradeIdx = gradeSteps.indexOf(liveStats.recentGrade);
                        const chipMap: Record<string, number> = { C: 0, B: 1, A: 3, "A+": 4 };
                        const chipIdx = chipMap[g];
                        const active = gradeIdx >= 0 && chipIdx <= gradeIdx;
                        return (
                          <div key={g} className="w-[28px] h-[28px] rounded-[8px] flex items-center justify-center text-[11px] font-bold"
                            style={{ background: active ? "rgba(232,51,74,0.22)" : "rgba(255,255,255,0.05)", color: active ? "#FF85AA" : "rgba(255,255,255,0.18)" }}>
                            {g}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* AI Insight Strip */}
                <div className="relative z-10 px-7 py-[14px] flex items-start gap-3" style={{ borderTop: "0.5px solid rgba(180,180,230,0.07)", background: "rgba(255,255,255,0.016)" }}>
                  <BrainCircuit className="w-4 h-4 shrink-0 mt-[2px]" style={{ color: IND3 }} />
                  {aiInsights?.child_summary_narrative ? (
                    <p className="text-[13px] leading-[1.65]" style={{ color: "rgba(180,180,230,0.62)", letterSpacing: "-0.1px" }}>
                      <strong style={{ color: "rgba(255,255,255,0.90)", fontWeight: 600 }}>{studentData?.name}</strong>{" "}
                      {aiInsights.child_summary_narrative.replace(studentData?.name || "", "").trim()}
                    </p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" style={{ color: IND3 }} />
                      <p className="text-[12px] italic" style={{ color: "rgba(180,180,230,0.4)" }}>AI summary generating...</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ── Row 3: Recent Alerts + Weekly Report Card ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">

            {/* Recent Alerts */}
            <div className="bg-white rounded-[22px] p-6" style={{ boxShadow: SH, border: `0.5px solid ${IND_BDR}` }}>
              <h3 className="text-[18px] font-bold mb-5" style={{ color: T1, letterSpacing: "-0.4px" }}>Recent Alerts</h3>
              {recentAlerts.length > 0 ? (
                <div className="space-y-3">
                  {recentAlerts.map(alert => (
                    <div key={alert.id} className="flex items-start gap-3 p-3 rounded-xl"
                      style={{ background: alert.urgent ? "rgba(245,160,0,0.08)" : "rgba(18,192,78,0.08)" }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: alert.urgent ? "rgba(245,160,0,0.15)" : "rgba(18,192,78,0.15)", color: alert.urgent ? ORANGE : GREEN }}>
                        {alert.urgent ? <Clock className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                      </div>
                      <div>
                        <p className="text-[14px] font-medium leading-snug" style={{ color: T1 }}>{alert.title}</p>
                        <p className="text-[12px] mt-0.5" style={{ color: T3 }}>{timeAgo(alert.time)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-10">
                  <div className="w-[60px] h-[60px] rounded-[18px] flex items-center justify-center"
                    style={{ background: IND_SOFT, border: `0.5px solid ${IND_BDR}`, boxShadow: "0 0 0 5px rgba(48,48,110,0.03)" }}>
                    <ShieldCheck className="w-7 h-7" style={{ color: T4 }} />
                  </div>
                  <p className="text-[14px]" style={{ color: T3 }}>No alerts right now</p>
                </div>
              )}
            </div>

            {/* Weekly AI Report header */}
            <div className="bg-white rounded-[22px] px-6 py-6" style={{ boxShadow: SH, border: `0.5px solid ${IND_BDR}` }}>
              <div className="flex items-center justify-between gap-3 mb-[14px]">
                <div className="flex items-center gap-3">
                  <div className="w-[46px] h-[46px] rounded-[14px] flex items-center justify-center"
                    style={{ background: IND_SOFT, border: `0.5px solid ${IND_BDR}` }}>
                    <BookOpen className="w-5 h-5" style={{ color: IND }} />
                  </div>
                  <div>
                    <div className="text-[16px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Weekly AI Report</div>
                    <div className="text-[12px] mt-0.5" style={{ color: T3 }}>
                      {isPrevWeekReport ? "Last week's report" : weekConfig.canGenerate ? (weeklyReport ? "This week's digest" : "Generate this week's report") : "New report available Friday"}
                    </div>
                  </div>
                </div>
                {weekConfig.canGenerate && !weeklyReport ? (
                  <button onClick={handleGenerateWeeklyReport} disabled={weeklyLoading || dataLoading}
                    className="flex items-center gap-2 px-4 py-[10px] rounded-[12px] text-[12px] font-semibold text-white disabled:opacity-50 transition-transform hover:scale-[1.02]"
                    style={{ background: IND, boxShadow: "0 4px 14px rgba(48,48,110,0.28)" }}>
                    {weeklyLoading ? <Loader2 className="w-[14px] h-[14px] animate-spin" /> : <Sparkles className="w-[14px] h-[14px]" />}
                    {weeklyLoading ? "Generating..." : "Generate"}
                  </button>
                ) : weekConfig.canGenerate && weeklyReport ? (
                  <button onClick={() => setWeeklyReport(null)}
                    className="text-[11px] font-medium px-3 py-[8px] rounded-[10px]"
                    style={{ color: T3, border: `0.5px solid ${IND_BDR}`, background: "white" }}>
                    Regenerate
                  </button>
                ) : (
                  <div className="flex items-center gap-1 px-3 py-[8px] rounded-[12px] text-[11px] font-semibold whitespace-nowrap"
                    style={{ background: "#E5E5EC", color: T3, border: `0.5px solid ${IND_BDR}` }}>
                    <Clock className="w-[12px] h-[12px]" />
                    Fri{weekConfig.daysLeft > 0 ? ` · ${weekConfig.daysLeft}d` : ""}
                  </div>
                )}
              </div>

              {weeklyLoading && (
                <div className="flex flex-col items-center py-6 gap-3">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: IND }} />
                  <p className="text-[12px]" style={{ color: T3 }}>Analysing {childFirstName}'s week...</p>
                </div>
              )}

              {!weeklyReport && !weeklyLoading && (
                <div className="flex items-start gap-2 pt-[14px]" style={{ borderTop: `0.5px solid ${SEP}` }}>
                  <Clock className="w-[15px] h-[15px] shrink-0 mt-0.5" style={{ color: T4 }} />
                  <p className="text-[13px] leading-[1.6]" style={{ color: T3, letterSpacing: "-0.1px" }}>
                    {weekConfig.canGenerate
                      ? `Click "Generate" to get ${childFirstName}'s weekly digest.`
                      : `You can generate ${childFirstName}'s weekly report every Friday, Saturday & Sunday.`}
                  </p>
                </div>
              )}

              {weeklyReport && !weeklyLoading && isPrevWeekReport && (
                <div className="flex items-start gap-2 pt-[14px]" style={{ borderTop: `0.5px solid ${SEP}` }}>
                  <Clock className="w-[15px] h-[15px] shrink-0 mt-0.5" style={{ color: T4 }} />
                  <p className="text-[13px] leading-[1.55]" style={{ color: T3 }}>
                    This is last week's report. A new report can be generated this Friday.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── AI Message gradient card ── */}
          {weeklyReport && !weeklyLoading && (
            <div className="rounded-[24px] px-7 py-6 relative overflow-hidden mb-5"
              style={{
                background: `linear-gradient(138deg, ${IND} 0%, ${IND2} 100%)`,
                border: "0.5px solid rgba(48,48,110,0.22)",
                boxShadow: "0 6px 28px rgba(48,48,110,0.22), 0 2px 8px rgba(48,48,110,0.14)"
              }}>
              <div className="absolute -top-10 -right-8 w-[200px] h-[200px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(255,255,255,0.10) 0%, transparent 65%)" }} />
              <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
                backgroundSize: "26px 26px"
              }} />
              <div className="relative z-10">
                <div className="flex items-center gap-[6px] text-[10px] font-bold uppercase tracking-[0.10em] mb-3" style={{ color: "rgba(255,255,255,0.52)" }}>
                  <Sparkles className="w-3 h-3" />
                  AI Message
                </div>
                <p className="text-[16px] leading-[1.72] font-normal max-w-[900px]" style={{ color: "rgba(255,255,255,0.92)", letterSpacing: "-0.1px" }}>
                  {weeklyReport.message}
                </p>
              </div>
            </div>
          )}

          {/* ── Detail Sections (3-col table) ── */}
          {weeklyReport && !weeklyLoading && (
            <div className="bg-white rounded-[22px] overflow-hidden grid grid-cols-1 lg:grid-cols-3 mb-5" style={{ boxShadow: SH, border: `0.5px solid ${IND_BDR}` }}>
              {[
                { tag: "Attendance", text: weeklyReport.attendance_summary },
                { tag: "Tests", text: weeklyReport.test_analysis },
                { tag: "Assignments", text: weeklyReport.assignment_status },
              ].map(({ tag, text }, i, arr) => (
                <div key={tag} className="px-6 py-5 flex flex-col gap-[6px]"
                  style={{
                    borderRight: i < arr.length - 1 ? `0.5px solid ${SEP}` : "none",
                    borderBottom: i < arr.length - 1 ? `0.5px solid ${SEP}` : "none",
                  }}>
                  <span className="text-[10px] font-bold uppercase tracking-[0.09em]" style={{ color: IND3 }}>{tag}</span>
                  <p className="text-[13px] leading-[1.58]" style={{ color: T2, letterSpacing: "-0.1px" }}>{text}</p>
                </div>
              ))}
            </div>
          )}

          {/* ── Overall Performance + Tips row ── */}
          {weeklyReport && !weeklyLoading && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">

              {/* Overall Performance */}
              {weeklyReport?.overall_performance ? (
                <div className="bg-white rounded-[22px] px-6 py-6 flex items-start justify-between gap-4 relative overflow-hidden"
                  style={{ border: `0.5px solid ${ORANGE_B}`, boxShadow: SH }}>
                  <div className="absolute -top-5 -right-5 w-[80px] h-[80px] rounded-full pointer-events-none"
                    style={{ background: "radial-gradient(circle, rgba(245,160,0,0.10) 0%, transparent 70%)" }} />
                  <div className="relative z-10">
                    <div className="text-[10px] font-bold uppercase tracking-[0.09em] mb-[5px]" style={{ color: ORANGE }}>Overall Performance</div>
                    <div className="text-[20px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>{weeklyReport.overall_performance.verdict}</div>
                    <p className="text-[13px] mt-[6px] leading-[1.58]" style={{ color: T3, letterSpacing: "-0.1px" }}>{weeklyReport.overall_performance.score_context}</p>
                  </div>
                  <div className="flex items-center gap-1 px-[14px] py-[9px] rounded-[14px] text-[12px] font-bold shrink-0 relative z-10"
                    style={{
                      background: weeklyReport.overall_performance.trend === "Declining" ? ORANGE_S : GREEN_S,
                      border: `0.5px solid ${weeklyReport.overall_performance.trend === "Declining" ? ORANGE_B : GREEN_B}`,
                      color: weeklyReport.overall_performance.trend === "Declining" ? "#905800" : "#0A6A2E",
                    }}>
                    <TrendingUp className={`w-3 h-3 ${weeklyReport.overall_performance.trend === "Declining" ? "rotate-180" : ""}`} />
                    {weeklyReport.overall_performance.trend}
                  </div>
                </div>
              ) : <div />}

              {/* Download PDF button */}
              <button onClick={handleDownloadPDF} disabled={pdfDownloading}
                className="rounded-[22px] py-[22px] px-6 flex items-center justify-center gap-3 text-[15px] font-bold text-white disabled:opacity-50 transition-transform hover:scale-[1.01] relative overflow-hidden"
                style={{ background: `linear-gradient(135deg, ${IND} 0%, #1C1C4A 100%)`, boxShadow: SH_BTN, letterSpacing: "-0.2px" }}>
                <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.13) 0%, transparent 52%)" }} />
                <span className="relative z-10 flex items-center gap-3">
                  {pdfDownloading ? (
                    <><Loader2 className="w-[18px] h-[18px] animate-spin" /> Generating PDF...</>
                  ) : (
                    <><Download className="w-[18px] h-[18px]" /> Download PDF Report</>
                  )}
                </span>
              </button>
            </div>
          )}

          {/* ── AI Improvement Tips ── */}
          {weeklyReport?.improvement_tips?.length > 0 && (
            <div className="mb-5">
              <div className="text-[10px] font-bold uppercase tracking-[0.10em] mb-3 px-1" style={{ color: T4 }}>
                AI Improvement Tips
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {weeklyReport.improvement_tips.map((t: { tip: string; reason: string }, i: number) => (
                  <div key={i} className="bg-white rounded-[20px] px-5 py-5 flex items-start gap-4 transition-transform hover:-translate-y-0.5"
                    style={{ boxShadow: SH, border: `0.5px solid ${IND_BDR}` }}>
                    <div className="w-[46px] h-[46px] rounded-[14px] flex items-center justify-center shrink-0 text-[22px]"
                      style={{
                        background: i === 0 ? "rgba(255,215,0,0.12)" : IND_SOFT,
                        border: `0.5px solid ${i === 0 ? "rgba(255,215,0,0.22)" : IND_BDR}`
                      }}>
                      {i === 0 ? "💡" : "🎯"}
                    </div>
                    <div>
                      <div className="text-[15px] font-semibold leading-[1.35]" style={{ color: T1, letterSpacing: "-0.2px" }}>{t.tip}</div>
                      <p className="text-[13px] mt-[4px] leading-[1.5]" style={{ color: T3, letterSpacing: "-0.1px" }}>{t.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── AI Parenting Tips ── */}
          <div className="bg-white rounded-[22px] overflow-hidden" style={{ boxShadow: SH, border: `0.5px solid ${IND_BDR}` }}>
            <div className="flex items-center gap-3 px-6 py-5 relative overflow-hidden"
              style={{ background: `linear-gradient(135deg, ${IND} 0%, ${IND2} 100%)`, borderBottom: `0.5px solid ${IND_BDR}` }}>
              <div className="absolute -top-7 -right-4 w-[140px] h-[140px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(255,255,255,0.09) 0%, transparent 65%)" }} />
              <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
                backgroundSize: "24px 24px"
              }} />
              <span className="text-[26px] relative z-10">💡</span>
              <div className="relative z-10">
                <div className="text-[17px] font-bold text-white" style={{ letterSpacing: "-0.3px" }}>AI Parenting Tips</div>
                <div className="text-[12px] mt-0.5" style={{ color: "rgba(255,255,255,0.52)" }}>Based on {childFirstName}'s current data</div>
              </div>
            </div>

            {(() => {
              const tips = aiInsights?.parenting_tips?.length > 0 ? aiInsights.parenting_tips : smartTips;
              return tips.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-3">
                  {tips.map((item: { tip: string; reason: string }, i: number, arr: any[]) => (
                    <div key={i} className="px-6 py-5 flex items-start gap-3"
                      style={{
                        borderRight: i < arr.length - 1 ? `0.5px solid ${SEP}` : "none",
                        borderBottom: i < arr.length - 1 ? `0.5px solid ${SEP}` : "none",
                      }}>
                      <div className="w-8 h-8 rounded-[10px] flex items-center justify-center text-[13px] font-bold shrink-0 mt-0.5"
                        style={{ background: IND_SOFT, border: `0.5px solid ${IND_BDR}`, color: IND }}>
                        {i + 1}
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold" style={{ color: T1, letterSpacing: "-0.2px" }}>{item.tip}</div>
                        <p className="text-[12px] mt-[4px] leading-[1.5]" style={{ color: T3, letterSpacing: "-0.1px" }}>{item.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-6 py-10 flex items-center gap-3 justify-center">
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: IND }} />
                  <p className="text-[14px] italic" style={{ color: T3 }}>Loading {childFirstName}'s tips...</p>
                </div>
              );
            })()}
          </div>

          {/* Hidden PDF render target */}
          {weeklyReport && pdfData && (
            <div style={{ position: "fixed", top: "-9999px", left: "-9999px", zIndex: -1 }}>
              <WeeklyReportPDF
                ref={pdfRef}
                report={weeklyReport}
                studentName={pdfData.child_name}
                grade={pdfData.grade}
                attendance={pdfData.attendance}
                tests={pdfData.tests}
                assignments={pdfData.assignments}
                avgScore={pdfData.overall_avg}
                weekEnd={pdfData.weekEnd}
                onDownload={() => {}}
              />
            </div>
          )}

        </div>
      </div>
    );
  }

};

export default DashboardPage;
