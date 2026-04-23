import { useState, useEffect } from "react";
import {
  AlertCircle, Clock, Trophy, Calendar, User,
  Loader2, BellRing, CheckCircle, BookOpen, ShieldAlert, Sparkles,
  MessageSquare
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { db } from "@/lib/firebase";
import { scopedQuery } from "@/lib/scopedQuery";
import { subscribeEnrollments } from "@/lib/enrollmentQuery";
import {
  where, onSnapshot,
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

    // Single scoped query helper — one listener per collection, filtered by schoolId when available.
    // `done()` runs on both success and error so the spinner is never stuck when one
    // source returns permission-denied (rule rejection does not progress the counter otherwise).
    const scopedSnap = (collName: string, setter: (docs: any[]) => void) => {
      const q = scopedQuery(collName, schoolId, where("studentId", "==", sid));
      const u = onSnapshot(
        q,
        snap => {
          setter(snap.docs.map(d => ({ id: d.id, ...d.data() })));
          done();
        },
        (err) => {
          console.error(`[Alerts] ${collName} listener error:`, err);
          setter([]);
          done();
        },
      );
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
    const tsQ = scopedQuery("test_scores", schoolId, where("studentId", "==", sid));
    const gbQ = scopedQuery("gradebook_scores", schoolId, where("studentId", "==", sid));
    unsubs.push(
      onSnapshot(tsQ, s => { tsSnap = s; processScores(); done(); }, (err) => {
        console.error("[Alerts] test_scores listener error:", err);
        done();
      }),
      onSnapshot(gbQ, s => { gbSnap = s; processScores(); }, (err) => {
        console.error("[Alerts] gradebook_scores listener error:", err);
      })
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
        const q = scopedQuery("assignments", schoolId, where("classId", "in", chunk));
        const u = onSnapshot(q, snap => {
          snap.docs.forEach(d => allAssignments.set(d.id, { id: d.id, ...d.data() }));
          setAssignments(Array.from(allAssignments.values()));
        }, (err) => {
          console.error("[Alerts] assignments chunk listener error:", err);
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
    // IMPORTANT: AssignmentsPage writes the submission as `homeworkId` (the
    // assignment doc id), not `assignmentId`. Earlier we only checked
    // `assignmentId`, so any already-submitted homework still fired an
    // "Overdue" alert — a straight-up false positive to the parent. Check
    // both field names to cover current writes and legacy records.
    const submittedIds = new Set(
      submissions.flatMap(s => [s.homeworkId, s.assignmentId].filter(Boolean)),
    );
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

            const runPrimary = () => { if (primary) primary.onClick(); };
            return (
              <div
                key={alert.id}
                role="button"
                tabIndex={0}
                aria-label={`${alert.title} — ${primary?.label || "view"}`}
                onClick={runPrimary}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); runPrimary(); } }}
                className="mx-5 mt-[14px] rounded-[24px] relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
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
                      <button onClick={(e) => { e.stopPropagation(); primary.onClick(); }}
                        className="flex-1 h-[42px] rounded-[13px] flex items-center justify-center gap-[6px] text-[12px] font-bold text-white active:scale-[0.95] transition-transform relative overflow-hidden"
                        style={{ background: primaryGrad, boxShadow: primaryShadow, letterSpacing: "0.02em" }}>
                        <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.14) 0%, transparent 52%)" }} />
                        <span className="relative z-10 px-1 text-center truncate">{primary.label}</span>
                      </button>
                    )}
                    {secondary && (
                      <button onClick={(e) => { e.stopPropagation(); secondary.onClick(); }}
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
          <div className="mx-5 mt-[14px] rounded-[24px] px-[22px] py-5 relative overflow-hidden transition-transform active:scale-[0.98]"
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

  /* ═══════════════════════════════════════════════════════════════
     DESKTOP — Bright Blue Apple UI + 3D hover cards
     ═══════════════════════════════════════════════════════════════ */
  const B1 = "#0055FF", B2 = "#1166FF";
  const BG_D = "#EEF4FF";
  const T1 = "#001040", T2 = "#002080", T3 = "#5070B0", T4 = "#99AACC";
  const GREEN_D = "#00C853", RED_D = "#FF3355", ORANGE_D = "#FF8800";
  const BLUE_BDR = "rgba(0,85,255,0.12)";
  const SH_D = "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.09), 0 10px 28px rgba(0,85,255,0.11)";
  const SH_LG_D = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.14)";
  const SH_BTN_D = "0 6px 22px rgba(0,85,255,0.42), 0 2px 6px rgba(0,85,255,0.22)";

  const isRecentD = (ts: any) => {
    const d = ts?.toDate?.() || null;
    if (!d) return false;
    return (Date.now() - d.getTime()) < 24 * 60 * 60 * 1000;
  };
  const fmtAlertDateD = (ts: any) => {
    if (isRecentD(ts)) return "Recent";
    const d = ts?.toDate?.();
    if (!d) return "—";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const themeForD = (p: ParsedAlert["priority"]) => {
    if (p === "High Priority") return {
      stripe: "linear-gradient(180deg, #FF3355, #FF6688)",
      iconGrad: "linear-gradient(135deg, #FF3355, #FF6688)",
      iconShadow: "0 3px 12px rgba(255,51,85,0.28)",
      badgeBg: "rgba(255,51,85,0.10)", badgeBdr: "rgba(255,51,85,0.22)", badgeText: RED_D,
      emoji: "🔴", label: "High Priority",
    };
    if (p === "Medium Priority") return {
      stripe: "linear-gradient(180deg, #FF8800, #FFCC22)",
      iconGrad: "linear-gradient(135deg, #FF8800, #FFCC22)",
      iconShadow: "0 3px 12px rgba(255,136,0,0.28)",
      badgeBg: "rgba(255,136,0,0.10)", badgeBdr: "rgba(255,136,0,0.22)", badgeText: "#884400",
      emoji: "🟡", label: "Medium",
    };
    if (p === "Good News") return {
      stripe: "linear-gradient(180deg, #00C853, #66EE88)",
      iconGrad: "linear-gradient(135deg, #00C853, #22EE66)",
      iconShadow: "0 3px 12px rgba(0,200,83,0.28)",
      badgeBg: "rgba(0,200,83,0.10)", badgeBdr: "rgba(0,200,83,0.22)", badgeText: "#007830",
      emoji: "🟢", label: "Great Work",
    };
    return {
      stripe: `linear-gradient(180deg, ${B1}, ${B2})`,
      iconGrad: `linear-gradient(135deg, ${B1}, ${B2})`,
      iconShadow: "0 3px 12px rgba(0,85,255,0.28)",
      badgeBg: "rgba(0,85,255,0.10)", badgeBdr: "rgba(0,85,255,0.20)", badgeText: B1,
      emoji: "🔵", label: "General",
    };
  };

  const iconForD = (a: ParsedAlert) => {
    if (a.priority === "Good News") return CheckCircle;
    if (a.category === "Attendance" && a.priority === "High Priority") return AlertCircle;
    if (a.category === "Attendance") return Calendar;
    if (a.source === "parent_notes") return MessageSquare;
    if (a.source === "assignments" || a.category === "Academic") return BookOpen;
    if (a.source === "risks") return ShieldAlert;
    return AlertCircle;
  };

  const unreadCountD = allAlerts.filter(a => isRecentD(a.createdAt)).length;
  const highCountD = allAlerts.filter(a => a.priority === "High Priority").length;
  const goodCountD = allAlerts.filter(a => a.priority === "Good News").length;

  // 3D tilt handlers
  const handle3DEnter = (e: React.MouseEvent<HTMLDivElement | HTMLButtonElement>) => {
    const el = e.currentTarget as HTMLElement;
    el.style.transition = "transform 0.06s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.2s ease";
  };
  const handle3DMove = (e: React.MouseEvent<HTMLDivElement | HTMLButtonElement>) => {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rotX = (((y / rect.height) - 0.5) * -6).toFixed(2);
    const rotY = (((x / rect.width) - 0.5) * 6).toFixed(2);
    el.style.transform = `perspective(1100px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-3px) scale(1.006)`;
    const glow = el.querySelector<HTMLDivElement>('[data-glow]');
    if (glow) {
      glow.style.opacity = "1";
      glow.style.background = `radial-gradient(420px circle at ${x}px ${y}px, rgba(0,85,255,0.12), transparent 45%)`;
    }
  };
  const handle3DLeave = (e: React.MouseEvent<HTMLDivElement | HTMLButtonElement>) => {
    const el = e.currentTarget as HTMLElement;
    el.style.transition = "transform 0.5s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.3s ease";
    el.style.transform = "perspective(1100px) rotateX(0deg) rotateY(0deg) translateY(0) scale(1)";
    const glow = el.querySelector<HTMLDivElement>('[data-glow]');
    if (glow) glow.style.opacity = "0";
  };

  return (
    <div className="animate-in fade-in duration-500 -m-4 sm:-m-6 md:-m-8 min-h-[calc(100vh-64px)]"
      style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: BG_D }}>
      <div className="w-full px-6 pt-8 pb-12">

        {/* ── Toolbar ── */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] mb-1 flex items-center gap-[7px]" style={{ color: T4 }}>
              <span className="w-[6px] h-[6px] rounded-full animate-pulse" style={{ background: RED_D, boxShadow: "0 0 0 3px rgba(255,51,85,0.18)" }} />
              Parent Dashboard · Alerts
            </div>
            <div className="flex items-center gap-3">
              <h1 className="text-[32px] font-bold leading-none" style={{ color: T1, letterSpacing: "-0.8px" }}>Alerts &amp; Notifications</h1>
              {unreadCountD > 0 && (
                <div className="px-3 py-[6px] rounded-full text-[11px] font-bold text-white"
                  style={{ background: `linear-gradient(135deg, ${RED_D}, #FF6688)`, boxShadow: "0 3px 10px rgba(255,51,85,0.30)", letterSpacing: "0.04em" }}>
                  {unreadCountD} NEW
                </div>
              )}
            </div>
            <div className="text-[13px] font-normal mt-[6px]" style={{ color: T3 }}>Stay updated with your child's activities</div>
          </div>
          <div className="flex items-center gap-[10px]">
            <button onClick={markAllRead}
              className="px-4 py-[10px] rounded-[14px] text-[13px] font-bold flex items-center gap-2 transition-transform hover:scale-[1.02]"
              style={{ background: "#fff", color: T2, border: `0.5px solid ${BLUE_BDR}`, boxShadow: SH_D, letterSpacing: "-0.1px" }}>
              <CheckCircle className="w-4 h-4" style={{ color: B1 }} strokeWidth={2.3} />
              Mark All Read
            </button>
            <div className="w-10 h-10 rounded-full flex items-center justify-center relative"
              style={{ background: "#fff", border: `0.5px solid ${BLUE_BDR}`, boxShadow: SH_D }}>
              <BellRing className="w-4 h-4" style={{ color: "rgba(0,85,255,0.60)" }} strokeWidth={1.8} />
              {unreadCountD > 0 && <span className="absolute top-[1px] right-[1px] w-2 h-2 rounded-full" style={{ background: RED_D, border: "1.5px solid white" }} />}
            </div>
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-bold text-white"
              style={{ background: `linear-gradient(140deg, ${B1}, ${B2})`, boxShadow: "0 3px 12px rgba(0,85,255,0.36), 0 0 0 2px rgba(255,255,255,0.8)" }}>
              {(studentData?.name?.[0] || "S").toUpperCase()}
            </div>
          </div>
        </div>

        {/* ── Stat cards (3D hover, functional filter tabs) ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5" style={{ perspective: "1200px" }}>
          {[
            { label: "Total", val: allAlerts.length, color: B1, icon: BellRing, grad: `linear-gradient(135deg, ${B1}, ${B2})`, sh: "0 3px 10px rgba(0,85,255,0.28)", glow: "rgba(0,85,255,0.09)", tab: 0 },
            { label: "Unread", val: unreadCountD, color: ORANGE_D, icon: Calendar, grad: `linear-gradient(135deg, ${ORANGE_D}, #FFAA22)`, sh: "0 3px 10px rgba(255,136,0,0.28)", glow: "rgba(255,136,0,0.09)", tab: 0 },
            { label: "High Priority", val: highCountD, color: RED_D, icon: AlertCircle, grad: `linear-gradient(135deg, ${RED_D}, #FF6688)`, sh: "0 3px 10px rgba(255,51,85,0.28)", glow: "rgba(255,51,85,0.09)", tab: 0 },
            { label: "Good News", val: goodCountD, color: GREEN_D, icon: Trophy, grad: `linear-gradient(135deg, ${GREEN_D}, #22EE66)`, sh: "0 3px 10px rgba(0,200,83,0.28)", glow: "rgba(0,200,83,0.09)", tab: 0 },
          ].map(({ label, val, color, icon: Icon, grad, sh, glow, tab }) => (
            <button key={label}
              onMouseEnter={handle3DEnter}
              onMouseMove={handle3DMove}
              onMouseLeave={handle3DLeave}
              onClick={() => setActiveTab(tab)}
              className="bg-white rounded-[22px] px-6 py-5 relative overflow-hidden text-left cursor-pointer"
              style={{
                boxShadow: SH_D,
                border: "0.5px solid rgba(0,85,255,0.10)",
                transformStyle: "preserve-3d",
                willChange: "transform",
              }}>
              <div data-glow className="absolute inset-0 pointer-events-none transition-opacity duration-300" style={{ opacity: 0 }} />
              <div className="absolute -top-[20px] -right-[20px] w-[100px] h-[100px] rounded-full pointer-events-none"
                style={{ background: `radial-gradient(circle, ${glow} 0%, transparent 70%)` }} />
              <div className="flex items-center justify-between mb-3 relative">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: T4 }}>{label}</span>
                <div className="w-10 h-10 rounded-[12px] flex items-center justify-center"
                  style={{ background: grad, boxShadow: sh, transform: "translateZ(18px)" }}>
                  <Icon className="w-[18px] h-[18px] text-white" strokeWidth={2.3} />
                </div>
              </div>
              <div className="text-[34px] font-bold leading-none relative" style={{ color, letterSpacing: "-1px", transform: "translateZ(10px)" }}>{val}</div>
            </button>
          ))}
        </div>

        {/* ── Filter Tabs ── */}
        <div className="flex gap-2 flex-wrap mb-5">
          {filterTabs.map((tab, i) => {
            const active = activeTab === i;
            return (
              <button key={tab} onClick={() => setActiveTab(i)}
                className="px-5 py-[10px] rounded-[14px] text-[12px] font-bold flex items-center gap-2 transition-transform hover:scale-[1.02]"
                style={active
                  ? { background: `linear-gradient(135deg, ${B1}, ${B2})`, color: "#fff", boxShadow: SH_BTN_D, letterSpacing: "-0.1px" }
                  : { background: "#fff", color: T3, border: `0.5px solid ${BLUE_BDR}`, boxShadow: SH_D, letterSpacing: "-0.1px" }}>
                {tab}
                <span className="min-w-[20px] h-[20px] rounded-[6px] flex items-center justify-center text-[11px] font-bold px-[5px]"
                  style={{ background: active ? "rgba(255,255,255,0.22)" : "rgba(0,85,255,0.08)", color: active ? "#fff" : B1 }}>
                  {getTabCount(tab)}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Main Row: Alerts (col-2) + Summary sidebar ── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* Alert list */}
          <div className="xl:col-span-2">
            {loading ? (
              <div className="bg-white rounded-[22px] py-24 flex flex-col items-center"
                style={{ boxShadow: SH_LG_D, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                <Loader2 className="w-12 h-12 animate-spin" style={{ color: B1 }} />
                <p className="text-[13px] font-medium mt-3" style={{ color: T4 }}>Loading alerts…</p>
              </div>
            ) : filteredAlerts.length === 0 ? (
              <div className="bg-white rounded-[22px] py-16 flex flex-col items-center text-center relative overflow-hidden"
                style={{ boxShadow: SH_LG_D, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                <div className="absolute -top-[50px] -right-[40px] w-[220px] h-[220px] rounded-full pointer-events-none"
                  style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
                <div className="w-[84px] h-[84px] rounded-[24px] flex items-center justify-center mb-4 relative z-10"
                  style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: `${SH_BTN_D}, 0 0 0 10px rgba(0,85,255,0.07)` }}>
                  <BellRing className="w-10 h-10 text-white" strokeWidth={2.1} />
                </div>
                <div className="text-[20px] font-bold mb-1 relative z-10" style={{ color: T1, letterSpacing: "-0.4px" }}>You're all caught up!</div>
                <div className="text-[13px] leading-[1.6] max-w-[400px] relative z-10" style={{ color: T3 }}>
                  No {filterTabs[activeTab] !== "All" ? `${filterTabs[activeTab].toLowerCase()} ` : ""}alerts right now. Check back later.
                </div>
              </div>
            ) : (
              <div className="space-y-3" style={{ perspective: "1200px" }}>
                {filteredAlerts.map(alert => {
                  const theme = themeForD(alert.priority);
                  const Icon = iconForD(alert);
                  const actions = getActions(alert);
                  const recent = isRecentD(alert.createdAt);
                  const primary = actions.find(a => a.primary);
                  const secondary = actions.find(a => !a.primary);
                  const primaryIsGood = alert.priority === "Good News";
                  const primaryGrad = primaryIsGood
                    ? `linear-gradient(135deg, ${GREEN_D}, #22EE66)`
                    : `linear-gradient(135deg, ${B1}, ${B2})`;
                  const primaryShadow = primaryIsGood
                    ? "0 5px 16px rgba(0,200,83,0.32)"
                    : SH_BTN_D;

                  return (
                    <div key={alert.id}
                      onMouseEnter={handle3DEnter}
                      onMouseMove={handle3DMove}
                      onMouseLeave={handle3DLeave}
                      className="rounded-[22px] relative overflow-hidden bg-white"
                      style={{
                        boxShadow: SH_LG_D,
                        border: "0.5px solid rgba(0,85,255,0.10)",
                        transformStyle: "preserve-3d",
                        willChange: "transform",
                      }}>
                      <div data-glow className="absolute inset-0 pointer-events-none transition-opacity duration-300" style={{ opacity: 0 }} />
                      <div className="absolute left-0 top-0 bottom-0 w-[4px] rounded-l-[2px]" style={{ background: theme.stripe }} />
                      {recent && (
                        <div className="absolute top-5 right-5 w-[8px] h-[8px] rounded-full"
                          style={{ background: B1, boxShadow: "0 0 0 3px rgba(0,85,255,0.20)", animation: "pulse 2s infinite" }} />
                      )}

                      <div className="px-7 py-6" style={{ transform: "translateZ(8px)" }}>
                        {/* Top row */}
                        <div className="flex items-start gap-4 mb-4">
                          <div className="w-[52px] h-[52px] rounded-[16px] flex items-center justify-center shrink-0"
                            style={{ background: theme.iconGrad, boxShadow: theme.iconShadow, transform: "translateZ(18px)" }}>
                            <Icon className="w-[24px] h-[24px] text-white" strokeWidth={2.2} />
                          </div>
                          <div className="flex-1 min-w-0 pr-8">
                            <div className="text-[17px] font-bold leading-[1.3] mb-2" style={{ color: T1, letterSpacing: "-0.3px" }}>
                              {alert.title}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="px-[10px] py-[4px] rounded-full text-[10px] font-bold whitespace-nowrap"
                                style={{ background: theme.badgeBg, color: theme.badgeText, border: `0.5px solid ${theme.badgeBdr}`, letterSpacing: "0.02em" }}>
                                {theme.emoji} {theme.label}
                              </div>
                              <div className="px-[10px] py-[4px] rounded-full text-[10px] font-bold whitespace-nowrap"
                                style={{
                                  background: alert.category === "Academic" ? "rgba(0,85,255,0.10)" : alert.category === "Attendance" ? "rgba(0,200,83,0.10)" : "rgba(0,85,255,0.08)",
                                  color: alert.category === "Academic" ? B1 : alert.category === "Attendance" ? "#007830" : T3,
                                  border: `0.5px solid ${alert.category === "Academic" ? "rgba(0,85,255,0.20)" : alert.category === "Attendance" ? "rgba(0,200,83,0.22)" : BLUE_BDR}`,
                                }}>
                                {alert.category}
                              </div>
                              {alert.teacherName && (
                                <div className="flex items-center gap-[4px] text-[11px] font-medium" style={{ color: T3 }}>
                                  <User className="w-[11px] h-[11px]" strokeWidth={2.3} /> {alert.teacherName}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Message */}
                        <p className="text-[13.5px] leading-[1.7] mb-3" style={{ color: T2, letterSpacing: "-0.1px" }}>
                          {alert.description}
                        </p>

                        {/* Date + meta */}
                        <div className="flex items-center gap-4 text-[11px] font-semibold mb-5" style={{ color: T4 }}>
                          <span className="flex items-center gap-[4px]">
                            <Calendar className="w-3 h-3" strokeWidth={2.3} />
                            {alert.date ? fmtDateStr(alert.date) : fmtAlertDateD(alert.createdAt)}
                          </span>
                          {alert.arrivalTime && (
                            <span className="flex items-center gap-[4px]">
                              <Clock className="w-3 h-3" strokeWidth={2.3} />
                              Arrived at {alert.arrivalTime}
                            </span>
                          )}
                        </div>

                        {/* Divider */}
                        <div className="h-[0.5px] mb-4" style={{ background: "rgba(0,85,255,0.08)" }} />

                        {/* AI Actions label */}
                        <div className="flex items-center gap-[6px] text-[10px] font-bold uppercase tracking-[0.10em] mb-3" style={{ color: B1 }}>
                          <Sparkles className="w-[12px] h-[12px]" strokeWidth={2.5} />
                          Recommended Actions
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2" style={{ transform: "translateZ(14px)" }}>
                          {primary && (
                            <button onClick={primary.onClick}
                              className="flex-1 h-11 rounded-[13px] flex items-center justify-center gap-2 text-[13px] font-bold text-white transition-transform hover:scale-[1.02] relative overflow-hidden"
                              style={{ background: primaryGrad, boxShadow: primaryShadow, letterSpacing: "-0.1px" }}>
                              <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.14) 0%, transparent 52%)" }} />
                              <span className="relative z-10 px-1 text-center truncate">{primary.label}</span>
                            </button>
                          )}
                          {secondary && (
                            <button onClick={secondary.onClick}
                              className="flex-1 h-11 rounded-[13px] flex items-center justify-center gap-2 text-[13px] font-bold transition-transform hover:scale-[1.02]"
                              style={{ background: BG_D, color: T2, border: `0.5px solid ${BLUE_BDR}`, boxShadow: SH_D, letterSpacing: "-0.1px" }}>
                              <span className="px-1 text-center truncate">{secondary.label}</span>
                            </button>
                          )}
                          <button onClick={() => dismissAlert(alert)}
                            className="w-11 h-11 rounded-[13px] flex items-center justify-center transition-transform hover:scale-[1.05]"
                            style={{ background: BG_D, color: T4, border: `0.5px solid ${BLUE_BDR}`, boxShadow: SH_D }}
                            title="Dismiss">
                            <CheckCircle className="w-4 h-4" strokeWidth={2.3} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sidebar: Summary + distribution */}
          <div className="space-y-4">
            {/* Summary dark card */}
            <div
              onMouseEnter={handle3DEnter}
              onMouseMove={handle3DMove}
              onMouseLeave={handle3DLeave}
              className="rounded-[22px] p-7 relative overflow-hidden text-white"
              style={{
                background: "linear-gradient(140deg, #001888 0%, #0033CC 48%, #0055FF 100%)",
                boxShadow: "0 8px 30px rgba(0,51,204,0.34), 0 0 0 0.5px rgba(255,255,255,0.14)",
                transformStyle: "preserve-3d",
                willChange: "transform",
              }}>
              <div data-glow className="absolute inset-0 pointer-events-none transition-opacity duration-300" style={{ opacity: 0 }} />
              <div className="absolute -top-[50px] -right-[35px] w-[220px] h-[220px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(255,255,255,0.14) 0%, transparent 65%)" }} />
              <div className="relative z-10" style={{ transform: "translateZ(14px)" }}>
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] mb-3" style={{ color: "rgba(255,255,255,0.50)" }}>Notification Summary</div>
                <div className="text-[22px] font-bold leading-[1.2] mb-5" style={{ letterSpacing: "-0.5px" }}>This Term</div>
                <div className="grid grid-cols-3 rounded-[16px] overflow-hidden" style={{ gap: "1px", background: "rgba(255,255,255,0.12)" }}>
                  {[
                    { val: unreadCountD, label: "Unread" },
                    { val: highCountD, label: "High" },
                    { val: allAlerts.length, label: "Total" },
                  ].map(({ val, label }) => (
                    <div key={label} className="py-[13px] px-2 text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
                      <div className="text-[22px] font-bold text-white leading-none mb-1" style={{ letterSpacing: "-0.6px" }}>{val}</div>
                      <div className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.42)" }}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Category distribution */}
            <div
              onMouseEnter={handle3DEnter}
              onMouseMove={handle3DMove}
              onMouseLeave={handle3DLeave}
              className="bg-white rounded-[22px] p-5 relative overflow-hidden"
              style={{ boxShadow: SH_LG_D, border: "0.5px solid rgba(0,85,255,0.10)", transformStyle: "preserve-3d", willChange: "transform" }}>
              <div data-glow className="absolute inset-0 pointer-events-none transition-opacity duration-300" style={{ opacity: 0 }} />
              <div className="text-[15px] font-bold mb-4" style={{ color: T1, letterSpacing: "-0.3px", transform: "translateZ(10px)" }}>By Category</div>
              <div className="space-y-3">
                {filterTabs.filter(t => t !== "All").map(cat => {
                  const count = getTabCount(cat);
                  const pct = allAlerts.length > 0 ? Math.round((count / allAlerts.length) * 100) : 0;
                  const color = cat === "Academic" ? B1 : cat === "Attendance" ? GREEN_D : T3;
                  const bar = cat === "Academic" ? `linear-gradient(90deg, ${B1}, #4499FF)` : cat === "Attendance" ? `linear-gradient(90deg, ${GREEN_D}, #66EE88)` : `linear-gradient(90deg, ${T3}, ${T4})`;
                  return (
                    <div key={cat}>
                      <div className="flex items-center justify-between mb-[6px]">
                        <span className="text-[12px] font-bold" style={{ color: T2 }}>{cat}</span>
                        <span className="text-[13px] font-bold" style={{ color }}>{count}</span>
                      </div>
                      <div className="h-[7px] rounded-[4px] overflow-hidden" style={{ background: "rgba(0,85,255,0.08)" }}>
                        <div className="h-full rounded-[4px]" style={{ width: `${pct}%`, background: bar, transition: "width 1s cubic-bezier(0.4,0,0.2,1)" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action tip card */}
            <div
              onMouseEnter={handle3DEnter}
              onMouseMove={handle3DMove}
              onMouseLeave={handle3DLeave}
              className="bg-white rounded-[22px] p-5 relative overflow-hidden"
              style={{ boxShadow: SH_LG_D, border: "0.5px solid rgba(0,85,255,0.10)", transformStyle: "preserve-3d", willChange: "transform" }}>
              <div data-glow className="absolute inset-0 pointer-events-none transition-opacity duration-300" style={{ opacity: 0 }} />
              <div className="absolute -top-[20px] -right-[20px] w-[120px] h-[120px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(107,33,232,0.08) 0%, transparent 70%)" }} />
              <div className="flex items-center gap-3 mb-3 relative z-10" style={{ transform: "translateZ(12px)" }}>
                <div className="w-11 h-11 rounded-[14px] flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, #6B21E8, #A87FF8)", boxShadow: "0 3px 12px rgba(107,33,232,0.28)" }}>
                  <Sparkles className="w-5 h-5 text-white" strokeWidth={2.3} />
                </div>
                <div>
                  <div className="text-[15px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>AI Assist</div>
                  <div className="text-[11px] font-normal" style={{ color: T3 }}>Action shortcuts</div>
                </div>
              </div>
              <p className="text-[12px] leading-[1.6] relative z-10" style={{ color: T3 }}>
                Each alert has tailored actions — message the teacher, view the report, or dismiss. Primary actions use the blue glow button.
              </p>
            </div>
          </div>
        </div>
      </div>
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
