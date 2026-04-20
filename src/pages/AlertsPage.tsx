import { useState, useEffect } from "react";
import {
  AlertCircle, Clock, Trophy, Calendar, User,
  Loader2, BellRing, CheckCircle, BookOpen, ShieldAlert, Sparkles,
  MessageSquare
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { PageHeader } from "@/components/ui/PageHeader";
import { db } from "@/lib/firebase";
import { subscribeEnrollments } from "@/lib/enrollmentQuery";
import {
  collection, query, where, onSnapshot,
  doc, updateDoc
} from "firebase/firestore";
import { toast } from "sonner";

const filterTabs = ["All", "Academic", "Attendance", "General"];

interface ParsedAlert {
  id: string;
  title: string;
  description: string;
  category: "Academic" | "Attendance" | "General";
  priority: "High Priority" | "Medium Priority" | "Good News" | "General";
  createdAt: any;
  teacherName?: string;
  date?: string;
  arrivalTime?: string;
  source: string; // which collection it came from
  sourceId?: string; // for dismissing in Firestore
  dismissed?: boolean;
}

const AlertsPage = () => {
  const { studentData } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);
  // Key scoped per user — prevents Parent A's dismissed list leaking to Parent B
  const dismissKey = `dismissed_alerts_${studentData?.id || "anon"}`;
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(`dismissed_alerts_${studentData?.id || "anon"}`) || "[]")); }
    catch { return new Set(); }
  });

  // Raw data from Firebase
  const [risks, setRisks] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [scores, setScores] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [smartAlerts, setSmartAlerts] = useState<any[]>([]);

  useEffect(() => {
    if (!studentData?.id) return;
    setLoading(true);
    const sid = studentData.id;
    const schoolId = studentData.schoolId;

    const unsubs: (() => void)[] = [];
    let loaded = 0;
    const total = 6; // collections: risks, attendance, test_scores, notes, smartAlerts, submissions (enrollments→assignments handled separately)

    const done = () => { loaded++; if (loaded >= total) setLoading(false); };

    // Single scoped query helper — one listener per collection, filtered by schoolId when available
    const scopedSnap = (collName: string, setter: (docs: any[]) => void) => {
      const q = schoolId
        ? query(collection(db, collName), where("schoolId", "==", schoolId), where("studentId", "==", sid))
        : query(collection(db, collName), where("studentId", "==", sid));
      const u = onSnapshot(q, snap => {
        setter(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        done();
      });
      unsubs.push(u);
    };

    // 1. risks
    scopedSnap("risks", setRisks);

    // 2. attendance
    scopedSnap("attendance", setAttendance);

    // 3. test_scores + gradebook_scores merged
    let tsSnap: any = null, gbSnap: any = null;
    const processScores = () => {
      const ts = (tsSnap?.docs || []).map((d: any) => ({ id: d.id, ...d.data() }));
      const gb = (gbSnap?.docs || []).map((d: any) => ({
        id: d.id, ...d.data(),
        testName: d.data().columnName || "Class Assessment",
        score: d.data().mark, maxScore: d.data().maxMarks || 100
      }));
      const all = new Map();
      [...ts, ...gb].forEach(d => { if (!all.has(d.id)) all.set(d.id, d); });
      setScores(Array.from(all.values()));
    };
    const tsQ = schoolId
      ? query(collection(db, "test_scores"), where("schoolId", "==", schoolId), where("studentId", "==", sid))
      : query(collection(db, "test_scores"), where("studentId", "==", sid));
    const gbQ = schoolId
      ? query(collection(db, "gradebook_scores"), where("schoolId", "==", schoolId), where("studentId", "==", sid))
      : query(collection(db, "gradebook_scores"), where("studentId", "==", sid));
    unsubs.push(
      onSnapshot(tsQ, s => { tsSnap = s; processScores(); done(); }),
      onSnapshot(gbQ, s => { gbSnap = s; processScores(); })
    );

    // 4. parent_notes
    scopedSnap("parent_notes", setNotes);

    // 5. student_smart_alerts
    scopedSnap("student_smart_alerts", setSmartAlerts);

    // 6. submissions
    scopedSnap("submissions", setSubmissions);

    // 7. enrollments → classIds → assignments
    // Uses chunked "in" queries to handle >10 classIds (Firestore limit)
    let enrollSnap: any = null;
    const assignUnsubs: (() => void)[] = [];
    const processEnrollments = () => {
      const classIds = [...new Set((enrollSnap?.docs || []).map((d: any) => d.data().classId).filter(Boolean))] as string[];
      assignUnsubs.forEach(u => u());
      assignUnsubs.length = 0;
      if (classIds.length === 0) return;

      const chunks: string[][] = [];
      for (let i = 0; i < classIds.length; i += 10) chunks.push(classIds.slice(i, i + 10));

      const allAssignments: Map<string, any> = new Map();
      chunks.forEach(chunk => {
        const q = schoolId
          ? query(collection(db, "assignments"), where("schoolId", "==", schoolId), where("classId", "in", chunk))
          : query(collection(db, "assignments"), where("classId", "in", chunk));
        const u = onSnapshot(q, snap => {
          snap.docs.forEach(d => allAssignments.set(d.id, { id: d.id, ...d.data() }));
          setAssignments(Array.from(allAssignments.values()));
        });
        assignUnsubs.push(u);
      });
    };
    // Dual-listener helper — also matches legacy enrollments where studentId
    // was stored as the email by older teacher/principal-dashboard writes.
    unsubs.push(subscribeEnrollments(studentData, (docs) => {
      enrollSnap = { docs };
      processEnrollments();
    }));

    return () => {
      unsubs.forEach(u => u());
      assignUnsubs.forEach(u => u());
    };
  }, [studentData?.id, studentData?.schoolId]);

  // Build parsed alerts from all sources
  const buildAlerts = (): ParsedAlert[] => {
    const result: ParsedAlert[] = [];
    const name = studentData?.name || "Student";
    const now = Date.now();

    // ── SOURCE 1: risks collection (teacher-created flags) ──
    risks
      .filter(r => !r.resolved)
      .forEach(r => {
        const catMap: Record<string, ParsedAlert["category"]> = {
          Attendance: "Attendance", Grades: "Academic",
          Submissions: "Academic", Behavior: "General"
        };
        const priMap: Record<string, ParsedAlert["priority"]> = {
          Critical: "High Priority", "High Priority": "High Priority",
          "Medium Priority": "Medium Priority"
        };
        result.push({
          id: `risk_${r.id}`,
          title: r.issue || "Risk Flag",
          description: Array.isArray(r.details) ? r.details.join(" · ") : (r.issue || ""),
          category: catMap[r.type] || "General",
          priority: priMap[r.severity] || "Medium Priority",
          createdAt: r.createdAt || null,
          teacherName: r.teacherName || "",
          source: "risks",
          sourceId: r.id
        });
      });

    // ── SOURCE 2: attendance (absent = High, late = Medium) ──
    // Pre-compute attendance context for storytelling
    const absentRecords = attendance.filter(a => a.status === "absent");
    const totalAbsences = absentRecords.length;
    const absentDayNums = absentRecords.map(a => {
      const parts = (a.date || "").split("-");
      return parts.length === 3 ? new Date(+parts[0], +parts[1] - 1, +parts[2]).getDay() : -1;
    }).filter(d => d >= 0);
    const dayTally = absentDayNums.reduce((acc, d) => { acc[d] = (acc[d] || 0) + 1; return acc; }, {} as Record<number, number>);
    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const topAbsentDays = Object.entries(dayTally).sort((a, b) => +b[1] - +a[1]).slice(0, 2).map(([d]) => DAYS[+d]);
    const dayPattern = topAbsentDays.length > 0 ? ` (mostly ${topAbsentDays.join(" and ")})` : "";
    const lowScoreSubjects = scores.filter(s => {
      const pct = s.percentage ?? (s.maxScore > 0 ? s.score / s.maxScore * 100 : 0);
      return pct < 60;
    });
    const academicImpact = lowScoreSubjects.length > 0
      ? ` This is directly affecting grades — ${lowScoreSubjects.length} subject${lowScoreSubjects.length > 1 ? "s are" : " is"} currently below the passing threshold.`
      : " Regular attendance is essential to stay on top of the curriculum.";
    const totalLates = attendance.filter(a => a.status === "late").length;

    attendance.forEach(a => {
      if (a.status === "absent") {
        const absenceStory = totalAbsences === 1
          ? `${name} was absent on ${fmtDateStr(a.date)}. This is their first recorded absence this term — please ensure it doesn't become a pattern.`
          : `${name} has been absent ${totalAbsences} time${totalAbsences > 1 ? "s" : ""} this term${dayPattern}.${academicImpact}`;
        result.push({
          id: `att_absent_${a.id}`,
          title: totalAbsences > 2 ? `Repeated Absences — ${totalAbsences} This Term` : "Absence Recorded",
          description: absenceStory,
          category: "Attendance",
          priority: "High Priority",
          createdAt: a.createdAt || null,
          teacherName: a.teacherName || "",
          date: a.date,
          source: "attendance"
        });
      } else if (a.status === "late") {
        const lateStory = `${name} arrived late on ${fmtDateStr(a.date)}${a.arrivalTime || a.time ? ` at ${a.arrivalTime || a.time}` : ""}. This is their ${totalLates === 1 ? "first" : `${totalLates}th`} late arrival this term — arriving on time ensures ${name.split(" ")[0]} doesn't miss the start of lessons.`;
        result.push({
          id: `att_late_${a.id}`,
          title: "Late Arrival Recorded",
          description: lateStory,
          category: "Attendance",
          priority: "Medium Priority",
          createdAt: a.createdAt || null,
          teacherName: a.teacherName || "",
          date: a.date,
          arrivalTime: a.arrivalTime || a.time || "",
          source: "attendance"
        });
      }
    });

    // ── SOURCE 3: test_scores / gradebook_scores ──
    const submittedIds = new Set(submissions.map(s => s.assignmentId));
    scores.forEach(s => {
      const pct = s.percentage ?? (s.maxScore > 0 ? (s.score / s.maxScore * 100) : 0);
      const sub = s.subject || "a subject";
      const testName = s.testName || "a test";

      if (pct >= 85) {
        // Find how many tests in this subject scored high
        const subjectHighScores = scores.filter(s2 => s2.subject === sub && (s2.percentage ?? (s2.maxScore > 0 ? s2.score/s2.maxScore*100 : 0)) >= 85).length;
        const story = subjectHighScores > 1
          ? `${name} scored ${Math.round(pct)}% in "${testName}" — their ${subjectHighScores === 2 ? "second" : `${subjectHighScores}th`} strong result in ${sub} this term. This consistent excellence is worth celebrating and encouraging at home!`
          : `${name} scored an impressive ${Math.round(pct)}% in "${testName}" (${sub}). Hard work is clearly paying off — keep encouraging this momentum!`;
        result.push({
          id: `score_good_${s.id}`,
          title: `Excellent in ${sub}! 🎉`,
          description: story,
          category: "Academic",
          priority: "Good News",
          createdAt: s.timestamp || s.createdAt || null,
          teacherName: s.teacherName || "",
          source: "test_scores"
        });
      } else if (pct < 60 && pct > 0) {
        // Calculate subject average and trend
        const subScores = scores.filter(s2 => s2.subject === sub).map(s2 => s2.percentage ?? (s2.maxScore > 0 ? s2.score/s2.maxScore*100 : 0));
        const subAvg = subScores.length > 0 ? Math.round(subScores.reduce((a, b) => a + b, 0) / subScores.length) : Math.round(pct);
        const isTrending = subScores.length > 1 && subScores[subScores.length - 1] < subScores[0];
        const trendNote = isTrending ? ` Performance in ${sub} has been declining — early intervention is key.` : ` Focused revision before the next assessment can make a significant difference.`;
        const story = `${name} scored ${Math.round(pct)}% in "${testName}" (${sub}). The current subject average is ${subAvg}%.${trendNote}`;
        result.push({
          id: `score_low_${s.id}`,
          title: `Below Passing — ${sub}`,
          description: story,
          category: "Academic",
          priority: "High Priority",
          createdAt: s.timestamp || s.createdAt || null,
          teacherName: s.teacherName || "",
          source: "test_scores"
        });
      }
    });

    // ── SOURCE 4: assignments (overdue + due soon) ──
    assignments.forEach(a => {
      if (!a.dueDate) return;
      const due = a.dueDate?.toMillis?.() || new Date(a.dueDate).getTime();
      if (!due) return;
      const alreadySubmitted = submittedIds.has(a.id);
      if (alreadySubmitted) return;

      const diffMs = due - now;
      const diffDays = Math.ceil(diffMs / (1000 * 3600 * 24));

      if (diffMs < 0) {
        const daysOverdue = Math.abs(Math.ceil(diffMs / (1000 * 3600 * 24)));
        const urgency = daysOverdue > 7 ? "This significantly impacts the term grade and requires immediate attention." : daysOverdue > 3 ? "Submitting it now — even late — is better than leaving it incomplete. Contact the teacher if an extension is needed." : "This was just missed — submitting it now with a brief apology note to the teacher may still earn partial credit.";
        result.push({
          id: `assign_overdue_${a.id}`,
          title: `Assignment Overdue — ${daysOverdue} Day${daysOverdue > 1 ? "s" : ""}`,
          description: `"${a.title}" was due on ${fmtTs(a.dueDate)} and remains unsubmitted. ${urgency}`,
          category: "Academic",
          priority: "High Priority",
          createdAt: a.dueDate,
          teacherName: a.teacherName || "",
          source: "assignments"
        });
      } else if (diffDays <= 3) {
        const urgency = diffDays === 1 ? "Due TOMORROW — action needed today." : `Due in ${diffDays} days — plan time tonight to complete it.`;
        result.push({
          id: `assign_soon_${a.id}`,
          title: `Due ${diffDays === 1 ? "Tomorrow" : `in ${diffDays} Days`} — ${a.title}`,
          description: `"${a.title}" is due on ${fmtTs(a.dueDate)}. ${urgency} Submitting on time keeps ${name.split(" ")[0]}'s completion record strong.`,
          category: "Academic",
          priority: "Medium Priority",
          createdAt: a.createdAt || null,
          teacherName: a.teacherName || "",
          source: "assignments"
        });
      }
    });

    // ── SOURCE 5: parent_notes (teacher notes to parent) ──
    notes.forEach(n => {
      const isPositive = (n.category || "").toLowerCase().includes("positive") || (n.category || "").toLowerCase().includes("praise");
      result.push({
        id: `note_${n.id}`,
        title: isPositive ? "Positive Note from Teacher" : "Teacher Note",
        description: n.content || "A note from your teacher.",
        category: "General",
        priority: isPositive ? "Good News" : "Medium Priority",
        createdAt: n.createdAt || null,
        teacherName: n.teacherName || "",
        source: "parent_notes"
      });
    });

    // ── SOURCE 6: student_smart_alerts (AI-generated) ──
    smartAlerts
      .filter(a => !a.resolved)
      .forEach(a => {
        const cat = a.category === "Behavior" ? "General" : (a.category || "General");
        result.push({
          id: `smart_${a.id}`,
          title: a.title || "Alert",
          description: a.description || "",
          category: cat as ParsedAlert["category"],
          priority: a.priority || "Medium Priority",
          createdAt: a.createdAt || null,
          teacherName: a.teacherName || "",
          source: "student_smart_alerts",
          sourceId: a.id
        });
      });

    // Deduplicate by id, filter dismissed
    const seen = new Set<string>();
    return result
      .filter(a => !dismissed.has(a.id) && !seen.has(a.id) && seen.add(a.id))
      .sort((a, b) => {
        const order: Record<string, number> = { "High Priority": 0, "Medium Priority": 1, "Good News": 2, General: 3 };
        return (order[a.priority] ?? 3) - (order[b.priority] ?? 3);
      });
  };

  const allAlerts = buildAlerts();

  const dismissAlert = async (alert: ParsedAlert) => {
    // Mark dismissed in local state + localStorage
    const next = new Set(dismissed);
    next.add(alert.id);
    setDismissed(next);
    localStorage.setItem(dismissKey, JSON.stringify([...next]));

    // If it came from a Firestore-writable source, persist it
    if (alert.source === "student_smart_alerts" && alert.sourceId) {
      try {
        await updateDoc(doc(db, "student_smart_alerts", alert.sourceId), { resolved: true });
      } catch { /* ignore */ }
    }
    if (alert.source === "risks" && alert.sourceId) {
      try {
        await updateDoc(doc(db, "risks", alert.sourceId), { resolved: true });
      } catch { /* ignore */ }
    }
    toast.success("Alert dismissed.");
  };

  const markAllRead = () => {
    const next = new Set(dismissed);
    allAlerts.forEach(a => next.add(a.id));
    setDismissed(next);
    localStorage.setItem(dismissKey, JSON.stringify([...next]));
    toast.success("All alerts dismissed.");
  };

  const filteredAlerts = allAlerts.filter(a => {
    const tab = filterTabs[activeTab];
    return tab === "All" || a.category === tab;
  });

  // ── Feature 16: AI Action Recommendations ────────────────────────────────
  type Action = { label: string; primary: boolean; color?: string; onClick: () => void };
  const getActions = (alert: ParsedAlert): Action[] => {
    const go = (path: string) => () => navigate(path);
    const dismiss = () => dismissAlert(alert);

    if (alert.category === "Attendance" && alert.priority === "High Priority")
      return [
        { label: "📞 Schedule Teacher Call", primary: true, color: "bg-rose-600 hover:bg-rose-700 text-white", onClick: go("/teacher-notes") },
        { label: "View Attendance Report", primary: false, onClick: go("/attendance") },
      ];

    if (alert.category === "Attendance")
      return [
        { label: "💬 Message Teacher", primary: true, color: "bg-blue-600 hover:bg-blue-700 text-white", onClick: go("/teacher-notes") },
        { label: "Acknowledge", primary: false, onClick: dismiss },
      ];

    if (alert.source === "test_scores" && alert.priority === "High Priority")
      return [
        { label: "📚 Request Extra Support", primary: true, color: "bg-indigo-600 hover:bg-indigo-700 text-white", onClick: go("/teacher-notes") },
        { label: "View Performance", primary: false, onClick: go("/performance") },
      ];

    if (alert.source === "assignments" && alert.priority === "High Priority")
      return [
        { label: "📤 Submit Now", primary: true, color: "bg-slate-900 hover:bg-slate-800 text-white", onClick: go("/assignments") },
        { label: "💬 Message Teacher", primary: false, onClick: go("/teacher-notes") },
      ];

    if (alert.source === "assignments" && alert.priority === "Medium Priority")
      return [
        { label: "⏰ Go to Assignments", primary: true, color: "bg-amber-500 hover:bg-amber-600 text-white", onClick: go("/assignments") },
        { label: "Dismiss", primary: false, onClick: dismiss },
      ];

    if (alert.priority === "Good News")
      return [
        { label: "🎉 View Full Performance", primary: true, color: "bg-emerald-600 hover:bg-emerald-700 text-white", onClick: go("/performance") },
        { label: "Acknowledge", primary: false, onClick: dismiss },
      ];

    if (alert.source === "parent_notes")
      return [
        { label: "💬 Reply to Teacher", primary: true, color: "bg-blue-600 hover:bg-blue-700 text-white", onClick: go("/teacher-notes") },
        { label: "Acknowledge", primary: false, onClick: dismiss },
      ];

    if (alert.source === "risks")
      return [
        { label: "📞 Contact Teacher Now", primary: true, color: "bg-rose-600 hover:bg-rose-700 text-white", onClick: go("/teacher-notes") },
        { label: "Dismiss", primary: false, onClick: dismiss },
      ];

    return [
      { label: "View Details", primary: true, color: "bg-indigo-600 hover:bg-indigo-700 text-white", onClick: go("/performance") },
      { label: "Dismiss", primary: false, onClick: dismiss },
    ];
  };

  const getTabCount = (tab: string) =>
    tab === "All" ? allAlerts.length : allAlerts.filter(a => a.category === tab).length;

  // ── Styling helpers ──
  const getBorderColor = (p: ParsedAlert["priority"]) => ({
    "High Priority": "border-l-rose-500",
    "Medium Priority": "border-l-amber-400",
    "Good News": "border-l-emerald-500",
    General: "border-l-blue-400"
  }[p] || "border-l-slate-300");

  const getIconStyle = (alert: ParsedAlert) => {
    if (alert.priority === "Good News")
      return { bg: "bg-emerald-100", color: "text-emerald-600", icon: <Trophy className="w-5 h-5" /> };
    if (alert.category === "Attendance" && alert.priority === "High Priority")
      return { bg: "bg-rose-100", color: "text-rose-500", icon: <AlertCircle className="w-5 h-5" /> };
    if (alert.category === "Attendance")
      return { bg: "bg-amber-100", color: "text-amber-500", icon: <Clock className="w-5 h-5" /> };
    if (alert.category === "Academic" && alert.priority === "High Priority")
      return { bg: "bg-rose-100", color: "text-rose-500", icon: <BookOpen className="w-5 h-5" /> };
    if (alert.category === "Academic")
      return { bg: "bg-blue-100", color: "text-blue-500", icon: <BookOpen className="w-5 h-5" /> };
    if (alert.source === "risks")
      return { bg: "bg-rose-100", color: "text-rose-500", icon: <ShieldAlert className="w-5 h-5" /> };
    return { bg: "bg-slate-100", color: "text-slate-500", icon: <Calendar className="w-5 h-5" /> };
  };

  const getPriorityBadge = (p: ParsedAlert["priority"]) => ({
    "High Priority": "bg-rose-100 text-rose-600",
    "Medium Priority": "bg-amber-100 text-amber-600",
    "Good News": "bg-emerald-100 text-emerald-600",
    General: "bg-slate-100 text-slate-500"
  }[p] || "bg-slate-100 text-slate-500");

  const getCategoryBadge = (c: ParsedAlert["category"]) => ({
    Academic: "bg-blue-50 text-blue-600",
    Attendance: "bg-emerald-50 text-emerald-600",
    General: "bg-slate-100 text-slate-500"
  }[c] || "bg-slate-100 text-slate-500");

  // ═══════════════════════════════════════════════════════════════
  // MOBILE — Blue Premium UI
  // ═══════════════════════════════════════════════════════════════
  if (isMobile) {
    const B1 = "#0055FF", B2 = "#1166FF";
    const BG = "#EEF4FF", BG2 = "#E0ECFF", CARD = "#FFFFFF";
    const T1 = "#001040", T2 = "#002080", T3 = "#5070B0", T4 = "#99AACC";
    const SH    = "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.08), 0 10px 28px rgba(0,85,255,0.10)";
    const SH_LG = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.11), 0 20px 48px rgba(0,85,255,0.13)";
    const SH_BTN = "0 6px 22px rgba(0,85,255,0.40), 0 2px 5px rgba(0,85,255,0.20)";
    const FONT = "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif";

    const avatarChar = (studentData?.name?.[0] || "S").toUpperCase();

    const isRecent = (ts: any) => {
      const d = ts?.toDate?.() || null;
      if (!d) return false;
      return (Date.now() - d.getTime()) < 24 * 60 * 60 * 1000;
    };

    const fmtAlertDate = (ts: any) => {
      if (isRecent(ts)) return "Recent";
      const d = ts?.toDate?.();
      if (!d) return "—";
      return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    };

    // Priority → visual theme
    type Theme = {
      stripe: string; iconGrad: string; iconShadow: string;
      badgeBg: string; badgeBdr: string; badgeText: string;
      emoji: string; label: string;
    };
    const themeFor = (p: ParsedAlert["priority"]): Theme => {
      if (p === "High Priority") return {
        stripe: "linear-gradient(180deg, #FF3355, #FF6688)",
        iconGrad: "linear-gradient(135deg, #FF3355, #FF6688)",
        iconShadow: "0 3px 12px rgba(255,51,85,0.28)",
        badgeBg: "rgba(255,51,85,0.09)", badgeBdr: "rgba(255,51,85,0.20)", badgeText: "#FF3355",
        emoji: "🔴", label: "High Priority",
      };
      if (p === "Medium Priority") return {
        stripe: "linear-gradient(180deg, #FF8800, #FFCC22)",
        iconGrad: "linear-gradient(135deg, #FF8800, #FFCC22)",
        iconShadow: "0 3px 12px rgba(255,136,0,0.28)",
        badgeBg: "rgba(255,136,0,0.09)", badgeBdr: "rgba(255,136,0,0.20)", badgeText: "#884400",
        emoji: "🟡", label: "Medium Priority",
      };
      if (p === "Good News") return {
        stripe: "linear-gradient(180deg, #00C853, #66EE88)",
        iconGrad: "linear-gradient(135deg, #00C853, #66EE88)",
        iconShadow: "0 3px 12px rgba(0,200,83,0.24)",
        badgeBg: "rgba(0,200,83,0.09)", badgeBdr: "rgba(0,200,83,0.20)", badgeText: "#007830",
        emoji: "🟢", label: "Great Work",
      };
      return {
        stripe: "linear-gradient(180deg, #0055FF, #1166FF)",
        iconGrad: "linear-gradient(135deg, #0055FF, #1166FF)",
        iconShadow: "0 3px 12px rgba(0,85,255,0.26)",
        badgeBg: "rgba(0,85,255,0.09)", badgeBdr: "rgba(0,85,255,0.20)", badgeText: "#0055FF",
        emoji: "🔵", label: "General",
      };
    };

    const iconFor = (a: ParsedAlert) => {
      if (a.priority === "Good News") return CheckCircle;
      if (a.category === "Attendance" && a.priority === "High Priority") return AlertCircle;
      if (a.category === "Attendance") return Calendar;
      if (a.source === "parent_notes") return MessageSquare;
      if (a.source === "assignments" || a.category === "Academic") return BookOpen;
      if (a.source === "risks") return ShieldAlert;
      return AlertCircle;
    };

    const unreadCount = allAlerts.filter(a => isRecent(a.createdAt)).length;
    const highCount = allAlerts.filter(a => a.priority === "High Priority").length;

    if (loading) {
      return (
        <div className="-mx-3 -mt-3 flex items-center justify-center" style={{ background: BG, minHeight: "100vh", fontFamily: FONT }}>
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: B1 }} />
        </div>
      );
    }

    return (
      <div className="-mx-3 -mt-3 md:mx-0 md:mt-0 animate-in fade-in duration-500"
        style={{ background: BG, minHeight: "100vh", fontFamily: FONT }}>

        {/* Header */}
        <div className="flex items-center justify-between px-[22px] pt-[14px]">
          <div className="flex items-center gap-[7px]">
            <div className="w-[7px] h-[7px] rounded-full animate-pulse" style={{ background: "#00CC55", boxShadow: "0 0 0 2.5px rgba(0,204,85,0.2)" }} />
            <span className="text-[16px] font-bold" style={{ color: B1 }}>EduIntellect</span>
          </div>
          <div className="flex items-center gap-[10px]">
            <div className="w-9 h-9 rounded-full flex items-center justify-center relative"
              style={{ background: "rgba(255,255,255,0.88)", border: "0.5px solid rgba(0,85,255,0.16)", boxShadow: SH }}>
              <BellRing className="w-[17px] h-[17px]" style={{ color: "rgba(0,85,255,0.60)" }} strokeWidth={1.8} />
              {unreadCount > 0 && (
                <span className="absolute top-[1px] right-[1px] w-2 h-2 rounded-full" style={{ background: "#FF3355", border: "1.5px solid white" }} />
              )}
            </div>
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-bold text-white"
              style={{ background: `linear-gradient(140deg, ${B1}, ${B2})`, boxShadow: "0 4px 16px rgba(0,85,255,0.38), 0 0 0 2.5px rgba(255,255,255,0.85)" }}>
              {avatarChar}
            </div>
          </div>
        </div>

        {/* Page head */}
        <div className="pt-[18px] px-[22px]">
          <div className="flex items-center gap-[10px] mb-1 flex-wrap">
            <h1 className="text-[26px] font-bold" style={{ color: T1, letterSpacing: "-0.7px" }}>Alerts &amp; Notifications</h1>
            {unreadCount > 0 && (
              <div className="px-3 py-[5px] rounded-full text-[11px] font-bold text-white"
                style={{ background: "linear-gradient(135deg, #FF3355, #FF6688)", boxShadow: "0 3px 10px rgba(255,51,85,0.30)", letterSpacing: "0.04em" }}>
                {unreadCount} NEW
              </div>
            )}
          </div>
          <p className="text-[12px] font-normal" style={{ color: T3 }}>Stay updated with your child's activities</p>
        </div>

        {/* Mark All Read */}
        {allAlerts.length > 0 && (
          <button onClick={markAllRead}
            className="mx-5 mt-4 w-[calc(100%-40px)] h-12 rounded-[16px] flex items-center justify-center gap-2 text-[14px] font-bold active:scale-[0.98] transition-transform"
            style={{ background: CARD, border: "0.5px solid rgba(0,85,255,0.16)", color: B1, boxShadow: SH, letterSpacing: "-0.1px" }}>
            <CheckCircle className="w-4 h-4" style={{ color: "rgba(0,85,255,0.7)" }} strokeWidth={2.2} />
            Mark All Read
          </button>
        )}

        {/* Filter Tabs */}
        <div className="flex gap-[6px] px-5 pt-[14px] overflow-x-auto no-sb" style={{ scrollbarWidth: "none" }}>
          {filterTabs.map((tab, i) => {
            const active = activeTab === i;
            return (
              <button key={tab} onClick={() => setActiveTab(i)}
                className="shrink-0 px-4 py-[9px] rounded-[14px] text-[12px] font-bold whitespace-nowrap active:scale-[0.94] transition-transform"
                style={active
                  ? { background: `linear-gradient(135deg, ${B1}, ${B2})`, color: "#fff", boxShadow: SH_BTN, letterSpacing: "0.02em" }
                  : { background: CARD, color: T3, border: "0.5px solid rgba(0,85,255,0.12)", boxShadow: SH, letterSpacing: "0.02em" }}>
                {tab} ({getTabCount(tab)})
              </button>
            );
          })}
        </div>

        {/* Alert cards OR empty state */}
        {filteredAlerts.length === 0 ? (
          <div className="mx-5 mt-4 rounded-[24px] px-5 py-10 flex flex-col items-center gap-[10px] relative overflow-hidden"
            style={{ background: CARD, boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
            <div className="absolute -top-10 -right-7 w-[150px] h-[150px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
            <div className="w-16 h-16 rounded-[22px] flex items-center justify-center mb-[6px] relative z-10"
              style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: `${SH_BTN}, 0 0 0 10px rgba(0,85,255,0.07)` }}>
              <BellRing className="w-[30px] h-[30px]" style={{ color: "rgba(255,255,255,0.95)" }} strokeWidth={2.1} />
            </div>
            <div className="text-[17px] font-bold text-center relative z-10" style={{ color: T1, letterSpacing: "-0.3px" }}>You're all caught up!</div>
            <div className="text-[12px] text-center max-w-[230px] leading-[1.6] font-normal relative z-10" style={{ color: T3 }}>
              No {filterTabs[activeTab] !== "All" ? `${filterTabs[activeTab].toLowerCase()} ` : ""}alerts right now. Check back later.
            </div>
          </div>
        ) : (
          filteredAlerts.map(alert => {
            const theme = themeFor(alert.priority);
            const Icon = iconFor(alert);
            const actions = getActions(alert);
            const recent = isRecent(alert.createdAt);
            const primary = actions.find(a => a.primary);
            const secondary = actions.find(a => !a.primary);
            const primaryIsGood = alert.priority === "Good News";
            const primaryGrad = primaryIsGood
              ? "linear-gradient(135deg, #00C853, #22EE66)"
              : `linear-gradient(135deg, ${B1}, ${B2})`;
            const primaryShadow = primaryIsGood
              ? "0 5px 16px rgba(0,200,83,0.30)"
              : SH_BTN;

            return (
              <div key={alert.id} className="mx-5 mt-[14px] rounded-[24px] relative overflow-hidden active:scale-[0.98] transition-transform"
                style={{ background: CARD, boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                {/* Left accent stripe */}
                <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-[2px]" style={{ background: theme.stripe }} />
                {/* Unread dot */}
                {recent && (
                  <div className="absolute top-4 right-4 w-2 h-2 rounded-full"
                    style={{ background: B1, boxShadow: "0 0 0 2.5px rgba(0,85,255,0.20)" }} />
                )}

                <div className="px-[18px] py-[18px] pl-[22px]">
                  {/* Top row */}
                  <div className="flex items-start gap-[13px] mb-3">
                    <div className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
                      style={{ background: theme.iconGrad, boxShadow: theme.iconShadow }}>
                      <Icon className="w-[22px] h-[22px] text-white" strokeWidth={2.2} />
                    </div>
                    <div className="flex-1 min-w-0 pr-5">
                      <div className="text-[15px] font-bold leading-[1.3] mb-[5px]" style={{ color: T1, letterSpacing: "-0.3px" }}>
                        {alert.title}
                      </div>
                      <div className="flex flex-wrap items-center gap-[6px]">
                        <div className="px-[10px] py-1 rounded-full text-[10px] font-bold whitespace-nowrap"
                          style={{ background: theme.badgeBg, color: theme.badgeText, border: `0.5px solid ${theme.badgeBdr}`, letterSpacing: "0.02em" }}>
                          {theme.emoji} {theme.label}
                        </div>
                        <div className="px-[10px] py-1 rounded-full text-[10px] font-bold whitespace-nowrap"
                          style={{
                            background: alert.category === "Academic" ? "rgba(0,85,255,0.10)" : alert.category === "Attendance" ? "rgba(0,200,83,0.09)" : "rgba(0,85,255,0.08)",
                            color: alert.category === "Academic" ? B1 : alert.category === "Attendance" ? "#007830" : T3,
                            border: `0.5px solid ${alert.category === "Academic" ? "rgba(0,85,255,0.20)" : alert.category === "Attendance" ? "rgba(0,200,83,0.20)" : "rgba(0,85,255,0.12)"}`,
                            letterSpacing: "0.02em",
                          }}>
                          {alert.category}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Message */}
                  <div className="text-[13px] leading-[1.72] font-normal mb-[10px]"
                    style={{ color: T2, letterSpacing: "-0.1px" }}>
                    {alert.description}
                  </div>

                  {/* Date row */}
                  <div className="flex items-center gap-[5px] text-[11px] font-semibold mb-[14px]" style={{ color: T4 }}>
                    <Calendar className="w-3 h-3" strokeWidth={2.3} />
                    {fmtAlertDate(alert.createdAt)}
                  </div>

                  {/* Divider */}
                  <div className="h-[0.5px] mb-[14px]" style={{ background: "rgba(0,85,255,0.07)" }} />

                  {/* Recommended Actions label */}
                  <div className="flex items-center gap-[6px] text-[9px] font-bold uppercase tracking-[0.10em] mb-[10px]" style={{ color: T4 }}>
                    <Sparkles className="w-[11px] h-[11px]" strokeWidth={2.5} />
                    Recommended Actions
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    {primary && (
                      <button onClick={primary.onClick}
                        className="flex-1 h-[42px] rounded-[13px] flex items-center justify-center gap-[6px] text-[12px] font-bold text-white active:scale-[0.95] transition-transform relative overflow-hidden"
                        style={{ background: primaryGrad, boxShadow: primaryShadow, letterSpacing: "0.02em" }}>
                        <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.14) 0%, transparent 52%)" }} />
                        <span className="relative z-10 px-1 text-center truncate">{primary.label}</span>
                      </button>
                    )}
                    {secondary && (
                      <button onClick={secondary.onClick}
                        className="flex-1 h-[42px] rounded-[13px] flex items-center justify-center gap-[6px] text-[12px] font-bold active:scale-[0.95] transition-transform"
                        style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.16)", color: T2, boxShadow: SH, letterSpacing: "0.02em" }}>
                        <span className="px-1 text-center truncate">{secondary.label}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Summary dark card */}
        {allAlerts.length > 0 && (
          <div className="mx-5 mt-[14px] rounded-[24px] px-[22px] py-5 relative overflow-hidden"
            style={{
              background: "linear-gradient(140deg, #001888 0%, #0033CC 48%, #0055FF 100%)",
              boxShadow: "0 8px 28px rgba(0,51,204,0.30), 0 0 0 0.5px rgba(255,255,255,0.14)",
            }}>
            <div className="absolute -top-10 -right-6 w-[160px] h-[160px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 65%)" }} />
            <div className="text-[9px] font-bold uppercase tracking-[0.12em] mb-[10px] relative z-10" style={{ color: "rgba(255,255,255,0.48)" }}>
              Notification Summary
            </div>
            <div className="grid grid-cols-3 gap-[1px] rounded-[16px] overflow-hidden relative z-10" style={{ background: "rgba(255,255,255,0.12)" }}>
              {[
                { val: unreadCount, label: "Unread" },
                { val: highCount, label: "High" },
                { val: allAlerts.length, label: "Total" },
              ].map(({ val, label }) => (
                <div key={label} className="py-[13px] px-3 text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div className="text-[24px] font-bold text-white leading-none mb-1" style={{ letterSpacing: "-0.7px" }}>{val}</div>
                  <div className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.40)" }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="h-5" />
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 md:mb-8">
        <PageHeader
          title="Alerts & Notifications"
          subtitle="Stay updated with your child's activities"
          badge={allAlerts.length > 0 ? `${allAlerts.length} New` : ""}
        />
        <button
          onClick={markAllRead}
          className="flex items-center justify-center gap-2 px-6 py-3 border border-slate-200 bg-white rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm active:scale-95"
        >
          <CheckCircle className="w-4 h-4" />
          Mark All Read
        </button>
      </div>

      {/* Filter Tabs - Scrollable on mobile */}
      <div className="flex overflow-x-auto pb-4 mb-4 gap-2 scrollbar-none no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-2 min-w-max">
          {filterTabs.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest border transition-all ${
                i === activeTab
                  ? "bg-[#1e3a8a] text-white border-[#1e3a8a] shadow-lg shadow-blue-900/10"
                  : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
              }`}
            >
              {tab} ({getTabCount(tab)})
            </button>
          ))}
        </div>
      </div>

      {/* Alert List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 className="w-10 h-10 text-blue-600 animate-spin mb-3" />
          <p className="text-xs text-slate-400">Loading alerts...</p>
        </div>
      ) : filteredAlerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 border-2 border-dashed border-slate-100 rounded-2xl">
          <BellRing className="w-12 h-12 text-slate-200 mb-3" />
          <p className="text-base font-semibold text-slate-400">No alerts</p>
          <p className="text-sm text-slate-300 mt-1">You're all caught up!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredAlerts.map((alert) => {
            const iconStyle = getIconStyle(alert);
            return (
              <div
                key={alert.id}
                className={`bg-white border border-slate-100 border-l-4 ${getBorderColor(alert.priority)} rounded-2xl p-4 md:p-5 shadow-sm hover:shadow-md transition-all`}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className={`w-9 h-9 md:w-10 md:h-10 rounded-full ${iconStyle.bg} ${iconStyle.color} flex items-center justify-center shrink-0 mt-0.5`}>
                    {iconStyle.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <h3 className="text-sm md:text-base font-bold text-slate-800">{alert.title}</h3>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${getPriorityBadge(alert.priority)}`}>
                        {alert.priority}
                      </span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${getCategoryBadge(alert.category)}`}>
                        {alert.category}
                      </span>
                    </div>

                    <p className="text-sm text-slate-500 leading-relaxed mb-3">{alert.description}</p>

                    {/* Metadata */}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      {alert.date ? (
                        <>
                          <span className="flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5" />
                            {fmtDateStr(alert.date)}
                          </span>
                          {alert.arrivalTime && (
                            <span className="flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5" />
                              Arrived at {alert.arrivalTime}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5" />
                          {fmtTs(alert.createdAt)}
                        </span>
                      )}
                      {alert.teacherName && (
                        <span className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5" />
                          {alert.teacherName}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Feature 16 — AI Action Recommendations */}
                <div className="mt-4 pt-3 border-t border-slate-50">
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <Sparkles className="w-3 h-3 text-indigo-400" />
                    <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Recommended Actions</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {getActions(alert).map((action, ai) => (
                      <button
                        key={ai}
                        onClick={action.onClick}
                        className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 ${
                          action.primary
                            ? `${action.color || "bg-[#1e3a8a] hover:bg-blue-900 text-white"} shadow-sm`
                            : "border border-slate-200 text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Utility functions ──
const fmtDateStr = (dateStr: string) => {
  if (!dateStr) return "Recent";
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }
  return dateStr;
};

const fmtTs = (ts: any): string => {
  if (!ts) return "Recent";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return "Recent";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export default AlertsPage;
