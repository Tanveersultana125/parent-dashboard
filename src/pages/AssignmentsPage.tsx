import { useState, useEffect, useRef } from "react";
import { User, Clock, CheckCircle2, Loader2, Upload, FileCheck, X, FileText, Book, FlaskConical, Calculator, BarChart3, Target, Trophy, Send, Lightbulb, Sparkles, ChevronDown } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { db, storage } from "@/lib/firebase";
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, Unsubscribe } from "firebase/firestore";
import { subscribeEnrollments } from "@/lib/enrollmentQuery";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

import { callAI } from "../ai/utils/callAI";

const tabs = ["Pending", "Completed", "Overdue"];

const AssignmentsPage = () => {
  const { studentData } = useAuth();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState(0);
  const [submittingFile, setSubmittingFile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  
  // Submission Panel States
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [studentNote, setStudentNote] = useState("");

  // AI — Instant Submission Feedback
  const [instantFeedback, setInstantFeedback] = useState<any>(null);
  const [generatingFeedback, setGeneratingFeedback] = useState(false);

  // AI — Hints System
  const [isHintsOpen, setIsHintsOpen] = useState(false);
  const [hintsTask, setHintsTask] = useState<any>(null);
  const [hintDoubt, setHintDoubt] = useState("");
  const [hints, setHints] = useState<string[]>([]);
  const [hintIndex, setHintIndex] = useState(0);
  const [generatingHints, setGeneratingHints] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!studentData?.id) return;
    setLoading(true);
    let unsubAssignments: Unsubscribe | null = null;

    const schoolId = studentData.schoolId;

    const setupAssignmentListener = (classIds: string[]) => {
        if (unsubAssignments) unsubAssignments();
        if (classIds.length === 0) {
            setAssignments([]);
            setLoading(false);
            return;
        }
        const assignmentsRef = collection(db, "assignments");
        // CRITICAL: filter by schoolId server-side — without it, a colliding
        // classId across schools would surface another school's assignments.
        const q = schoolId
          ? query(assignmentsRef, where("schoolId", "==", schoolId), where("classId", "in", classIds))
          : query(assignmentsRef, where("classId", "in", classIds));
        unsubAssignments = onSnapshot(q, (snap) => {
            setAssignments(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            setLoading(false);
        });
    };

    // Dual-listener helper — picks up legacy enrollments (studentId stored
    // as email by older teacher/principal writes) as well as new ones.
    const unsubEnroll = subscribeEnrollments(studentData, (docs) => {
      const classIds = [...new Set(docs.map(d => d.data().classId).filter(Boolean))] as string[];
      setupAssignmentListener(classIds);
    });

    // Submissions — scoped query
    const subQ = schoolId
      ? query(collection(db, "submissions"), where("schoolId", "==", schoolId), where("studentId", "==", studentData.id))
      : query(collection(db, "submissions"), where("studentId", "==", studentData.id));
    const unsubSub = onSnapshot(subQ, (snapshot) => {
      setSubmissions(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => { unsubEnroll(); if (unsubAssignments) unsubAssignments(); unsubSub(); };
  }, [studentData?.id, studentData?.schoolId]);

  // ── Feature 12: Instant Submission Feedback ──────────────────────────────
  const generateInstantFeedback = async (task: any) => {
    setGeneratingFeedback(true);
    setInstantFeedback(null);
    try {
      const result = await callAI(
        `A student just completed and is about to submit an assignment.
Assignment title: "${task.title}"
Description: "${task.description || "No description provided"}"
Give encouraging, constructive pre-submission feedback.
Return JSON: { emoji: "one emoji", overall: "short encouraging sentence", strengths: ["s1","s2"], improvements: ["i1","i2"], tip: "one final tip" }`
      );
      setInstantFeedback(result);
    } catch {
      setInstantFeedback({
        emoji: "✨", overall: "Great effort completing this assignment!",
        strengths: ["Assignment completed and ready to submit", "Good initiative in getting it done"],
        improvements: ["Review key points one final time", "Ensure all parts of the question are addressed"],
        tip: "Take a quick final look before submitting — small checks make a big difference!"
      });
    } finally { setGeneratingFeedback(false); }
  };

  // ── Feature 11: AI Hints System ──────────────────────────────────────────
  const handleGetHints = async () => {
    if (!hintDoubt.trim() || !hintsTask) return;
    setGeneratingHints(true);
    setHints([]);
    setHintIndex(0);
    try {
      const result = await callAI(
        `A school student needs help with their assignment but NOT the direct answer.
Assignment: "${hintsTask.title}"
Description: "${hintsTask.description || "No description"}"
Student is stuck on: "${hintDoubt}"
Give 4-5 progressive Socratic hints — nudges, not answers.
Return JSON: { hints: ["hint1 (gentle nudge)","hint2","hint3","hint4","hint5 (near solution — still no direct answer)"] }`
      );
      setHints(result.hints || []);
    } catch {
      setHints([
        `Read the assignment question again: what is it really asking you to do?`,
        `Identify the key words or numbers. What subject area does this connect to?`,
        `Think about a similar example you've seen in class. How did that work?`,
        `Try breaking the problem into smaller steps — what's the very first thing you'd do?`,
        `Almost there! Write out your reasoning step by step and see if it leads you to an answer.`,
      ]);
    } finally { setGeneratingHints(false); }
  };

  const handleOfficialSubmission = async () => {
    if (!uploadFile || !selectedTask) return toast.error("Please attach your homework artifact first!");
    
    setSubmittingFile(true);
    try {
        const sRef = ref(storage, `submissions/${studentData.id}_${selectedTask.id}_${uploadFile.name}`);
        const snap = await uploadBytes(sRef, uploadFile);
        const url = await getDownloadURL(snap.ref);

        await addDoc(collection(db, "submissions"), {
            homeworkId: selectedTask.id, // Renamed from assignmentId to differentiate from teaching_assignment
            assignmentId: selectedTask.assignmentId || "legacy", // Enforced Phase 1 spec: tracking the teaching_assignment
            studentId: studentData.id,
            studentEmail: studentData.email?.toLowerCase() || "",
            studentName: studentData.name,
            fileUrl: url,
            fileName: uploadFile.name,
            studentNote: studentNote,
            timestamp: serverTimestamp(),
            status: "Submitted"
        });
        
        toast.success("Assignment officially submitted to institutional repository!");
        setIsSubmitOpen(false);
        setUploadFile(null);
        setStudentNote("");
    } catch (e) {
        toast.error("Cloud handover failed. Check connection.");
    } finally {
        setSubmittingFile(false);
    }
  };

  const getSub = (aId: string) => submissions.find(s => 
    s.homeworkId === aId ||    // Parent dashboard saves here
    s.assignmentId === aId     // Fallback for older records
  );

  const filteredAssignments = assignments.filter(a => {
    const sub = getSub(a.id);
    if (activeTab === 1) return !!sub;
    if (activeTab === 2) return false; 
    return !sub;
  });

  const getSubjectIcon = (title: string) => {
     const t = title.toLowerCase();
     if (t.includes('sci') || t.includes('chem')) return <FlaskConical className="w-8 h-8 text-amber-500" />;
     if (t.includes('math') || t.includes('calc')) return <Calculator className="w-8 h-8 text-blue-500" />;
     if (t.includes('eng') || t.includes('hist')) return <Book className="w-8 h-8 text-indigo-500" />;
     return <FileText className="w-8 h-8 text-slate-400" />;
  };

  /* ═══════════════════════════════════════════════════════════════
     MOBILE — Bright Blue Apple UI
     ═══════════════════════════════════════════════════════════════ */
  if (isMobile) {
    const B1 = "#0055FF", B2 = "#1166FF", B4 = "#4499FF";
    const BG = "#EEF4FF", BG2 = "#E0ECFF";
    const T1 = "#001040", T2 = "#002080", T3 = "#5070B0", T4 = "#99AACC";
    const SEP = "rgba(0,85,255,0.07)";
    const GREEN = "#00C853";
    const RED = "#FF3355";
    const ORANGE = "#FF8800";
    const VIOLET = "#6B21E8";
    const SH = "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.09), 0 10px 28px rgba(0,85,255,0.11)";
    const SH_LG = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.14)";

    // ── Parse due date → Date object (or null) ──
    const parseDue = (a: any): Date | null => {
      const v = a.dueDate || a.due_date || a.deadline || a.due;
      if (!v) return null;
      if (typeof v?.toDate === "function") return v.toDate();
      if (v?.seconds) return new Date(v.seconds * 1000);
      if (typeof v === "string" || typeof v === "number") {
        const d = new Date(v);
        if (!isNaN(d.getTime())) return d;
      }
      return null;
    };

    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);

    const isOverdue = (a: any) => {
      const d = parseDue(a);
      return !!d && d.getTime() < todayStart.getTime();
    };

    const unsubmitted = assignments.filter(a => !getSub(a.id));
    const overdueList = unsubmitted.filter(a => isOverdue(a));
    const pendingList = unsubmitted.filter(a => !isOverdue(a));
    const completedList = assignments.filter(a => !!getSub(a.id));

    const pendingCount = pendingList.length;
    const completedCount = completedList.length;
    const overdueCount = overdueList.length;

    const mobileList =
      activeTab === 0 ? pendingList :
      activeTab === 1 ? completedList :
      overdueList;

    // Upcoming — next 3 unsubmitted with due dates (pending only), sorted by due asc
    const upcoming = pendingList
      .map(a => ({ a, d: parseDue(a) }))
      .filter(x => x.d)
      .sort((x: any, y: any) => x.d.getTime() - y.d.getTime())
      .slice(0, 3);

    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const formatDueShort = (d: Date) => `Due ${MONTHS[d.getMonth()]} ${d.getDate()}`;
    const daysUntil = (d: Date) => Math.max(0, Math.round((d.getTime() - todayStart.getTime()) / 86400000));

    // Accent palette rotation (blue-only styles for design match)
    const rowAccents = [
      { cls: "c1", ico: "linear-gradient(135deg, #0044EE, #2277FF)", icoSh: "0 3px 10px rgba(0,68,238,0.26)" },
      { cls: "c3", ico: "linear-gradient(135deg, #FF6600, #FFAA33)", icoSh: "0 3px 10px rgba(255,102,0,0.24)" },
      { cls: "c1", ico: "linear-gradient(135deg, #0033CC, #0055FF)", icoSh: "0 3px 10px rgba(0,51,204,0.26)" },
      { cls: "c2", ico: "linear-gradient(135deg, #00A040, #00C853)", icoSh: "0 3px 10px rgba(0,160,64,0.26)" },
    ];
    const getRowAccent = (idx: number) => rowAccents[idx % rowAccents.length];
    const accentBar = (cls: string) =>
      cls === "c1" ? `linear-gradient(180deg, ${B1}, ${B4})` :
      cls === "c2" ? `linear-gradient(180deg, ${GREEN}, #66EE88)` :
      cls === "c3" ? `linear-gradient(180deg, ${ORANGE}, #FFCC44)` :
      `linear-gradient(180deg, ${RED}, #FF88AA)`;

    const tagForAssignment = (a: any) => {
      if (getSub(a.id)) return { cls: "green", bg: "rgba(0,200,83,0.10)", color: "#007830", border: "rgba(0,200,83,0.22)", label: "Handed In" };
      if (isOverdue(a)) return { cls: "red", bg: "rgba(255,51,85,0.10)", color: RED, border: "rgba(255,51,85,0.22)", label: "Overdue" };
      const d = parseDue(a);
      if (d) {
        const days = daysUntil(d);
        if (days <= 3) return { cls: "orange", bg: "rgba(255,136,0,0.10)", color: "#884400", border: "rgba(255,136,0,0.22)", label: "Due Soon" };
      }
      return { cls: "blue", bg: "rgba(0,85,255,0.10)", color: B1, border: "rgba(0,85,255,0.20)", label: "Pending" };
    };

    const openSubmit = (a: any) => {
      setSelectedTask(a);
      setInstantFeedback(null);
      setUploadFile(null);
      setStudentNote("");
      setIsSubmitOpen(true);
    };
    const openHints = (a: any) => {
      setHintsTask(a);
      setHintDoubt("");
      setHints([]);
      setHintIndex(0);
      setIsHintsOpen(true);
    };

    return (
      <>
        <div className="animate-in fade-in duration-500 -mx-3 -mt-3 md:mx-0 md:mt-0"
          style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: BG, minHeight: "100vh" }}>

          {/* ── Page Head ── */}
          <div className="px-[22px] pt-[18px]">
            <div className="text-[24px] font-bold mb-[3px]" style={{ color: T1, letterSpacing: "-0.6px" }}>Assignments &amp; Coursework</div>
            <div className="text-[12px] font-normal" style={{ color: T3 }}>Manage submissions and track academic tasks</div>
          </div>

          {/* ── Stats Scroll (Completion / On-Time / Avg Score) ── */}
          <div className="flex gap-[10px] px-[22px] pt-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {[
              { label: "Completion", value: "93%", color: GREEN, iconBg: "rgba(0,200,83,0.12)", iconBorder: "rgba(0,200,83,0.22)", icon: Target, bar: "linear-gradient(90deg, #00C853, #66EE99)", barPct: 93, glow: "rgba(0,200,83,0.14)" },
              { label: "On-Time",    value: "96%", color: B1,    iconBg: "rgba(0,85,255,0.10)",   iconBorder: "rgba(0,85,255,0.18)",   icon: BarChart3, bar: `linear-gradient(90deg, ${B1}, ${B4})`, barPct: 96, glow: "rgba(0,85,255,0.10)" },
              { label: "Avg Score",  value: "82%", color: VIOLET, iconBg: "rgba(107,33,232,0.10)", iconBorder: "rgba(107,33,232,0.20)", icon: Trophy, bar: "linear-gradient(90deg, #6B21E8, #A87FF8)", barPct: 82, glow: "rgba(107,33,232,0.10)" },
            ].map(({ label, value, color, iconBg, iconBorder, icon: Icon, bar, barPct, glow }) => (
              <div key={label} className="bg-white rounded-[22px] px-[18px] py-4 min-w-[110px] flex-shrink-0 relative overflow-hidden active:scale-[0.96] transition-transform"
                style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)", transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)" }}>
                <div className="absolute -top-[16px] -right-[16px] w-[60px] h-[60px] rounded-full pointer-events-none"
                  style={{ background: `radial-gradient(circle, ${glow} 0%, transparent 70%)`, opacity: 0.55 }} />
                <div className="flex items-center justify-between mb-[10px] relative">
                  <span className="text-[9px] font-bold uppercase tracking-[0.10em]" style={{ color: T4 }}>{label}</span>
                  <div className="w-[26px] h-[26px] rounded-[8px] flex items-center justify-center"
                    style={{ background: iconBg, border: `0.5px solid ${iconBorder}` }}>
                    <Icon className="w-[13px] h-[13px]" style={{ color }} strokeWidth={2.5} />
                  </div>
                </div>
                <div className="text-[28px] font-bold leading-none mb-[6px] relative" style={{ color, letterSpacing: "-0.8px" }}>{value}</div>
                <div className="h-[3.5px] rounded-[2px] relative" style={{ background: BG2, width: "100%" }}>
                  <div className="h-full rounded-[2px]" style={{ width: `${barPct}%`, background: bar }} />
                </div>
              </div>
            ))}
          </div>

          {/* ── Segment Tabs ── */}
          <div className="px-[22px] pt-[14px]">
            <div className="flex gap-1 p-1 rounded-[16px] bg-white"
              style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)" }}>
              {[
                { label: "Pending", count: pendingCount, idx: 0, over: false },
                { label: "Completed", count: completedCount, idx: 1, over: false },
                { label: "Overdue", count: overdueCount, idx: 2, over: true },
              ].map(({ label, count, idx, over }) => {
                const isAct = activeTab === idx;
                return (
                  <button key={label}
                    onClick={() => setActiveTab(idx)}
                    className="flex-1 px-[10px] py-[9px] rounded-[12px] text-[11px] font-bold tracking-[0.02em] flex items-center justify-center gap-[5px] transition-all"
                    style={{
                      background: isAct ? `linear-gradient(135deg, ${B1}, ${B2})` : "transparent",
                      color: isAct ? "#fff" : T4,
                      boxShadow: isAct ? "0 3px 12px rgba(0,85,255,0.32), 0 1px 3px rgba(0,85,255,0.20)" : "none",
                      transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)",
                    }}>
                    {label}
                    <span
                      className="min-w-[18px] h-[18px] rounded-[6px] flex items-center justify-center px-[4px] text-[10px] font-bold"
                      style={{
                        background: isAct ? "rgba(255,255,255,0.22)" : over && count > 0 ? "rgba(255,51,85,0.10)" : BG2,
                        color: isAct ? "#fff" : over && count > 0 ? RED : T3,
                      }}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Content: loading / empty / list ── */}
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-14">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: B1 }} />
              <p className="text-xs font-medium" style={{ color: T4 }}>Loading assignments…</p>
            </div>
          ) : mobileList.length === 0 ? (
            <div className="mx-5 mt-[14px] bg-white rounded-[24px] py-8 px-5 flex flex-col items-center text-center relative overflow-hidden"
              style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
              <div className="absolute -top-[50px] -right-[40px] w-[180px] h-[180px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
              <div className="absolute -bottom-[50px] -left-[30px] w-[160px] h-[160px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(0,85,255,0.04) 0%, transparent 70%)" }} />
              <div className="w-[72px] h-[72px] rounded-[24px] flex items-center justify-center mb-[18px] relative z-10"
                style={{
                  background: `linear-gradient(135deg, ${B1}, ${B2})`,
                  boxShadow: "0 6px 22px rgba(0,85,255,0.42), 0 2px 6px rgba(0,85,255,0.22), 0 0 0 8px rgba(0,85,255,0.08)",
                }}>
                <FileCheck className="w-8 h-8" style={{ color: "rgba(255,255,255,0.95)" }} strokeWidth={2} />
              </div>
              <div className="text-[18px] font-bold mb-2 relative z-10" style={{ color: T1, letterSpacing: "-0.4px" }}>
                {activeTab === 0 ? "All Caught Up! 🎉" :
                 activeTab === 1 ? "Nothing submitted yet" :
                                   "No overdue items ✓"}
              </div>
              <div className="text-[13px] font-normal leading-[1.6] max-w-[220px] relative z-10" style={{ color: T3 }}>
                {activeTab === 0 ? "No pending assignments right now. New tasks will appear here when added by your teacher." :
                 activeTab === 1 ? "Once you submit an assignment, it'll show here." :
                                   "Great — nothing past its deadline. Keep it up!"}
              </div>
            </div>
          ) : (
            <div className="mx-5 mt-[14px] flex flex-col gap-[10px]">
              {mobileList.map((a: any, idx: number) => {
                const mySub = getSub(a.id);
                const accent = getRowAccent(idx);
                const tag = tagForAssignment(a);
                const d = parseDue(a);
                return (
                  <div key={a.id}
                    onClick={() => !mySub && openSubmit(a)}
                    className="bg-white rounded-[20px] p-4 flex items-center gap-[14px] relative overflow-hidden active:scale-[0.97] transition-transform cursor-pointer"
                    style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)", transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)" }}>
                    <div className="absolute left-0 top-0 bottom-0 w-[3.5px] rounded-l-[2px]" style={{ background: accentBar(accent.cls) }} />
                    <div className="w-[42px] h-[42px] rounded-[14px] flex items-center justify-center shrink-0"
                      style={{ background: accent.ico, boxShadow: accent.icoSh }}>
                      <FileText className="w-[18px] h-[18px] text-white" strokeWidth={2.2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-bold mb-1 truncate" style={{ color: T1, letterSpacing: "-0.2px" }}>{a.title || "Assignment"}</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {a.teacherName && (
                          <div className="flex items-center gap-[3px] text-[11px] font-medium" style={{ color: T3 }}>
                            <User className="w-[10px] h-[10px]" strokeWidth={2.5} />
                            <span className="truncate max-w-[100px]">{a.teacherName}</span>
                          </div>
                        )}
                        {d && (
                          <div className="flex items-center gap-[3px] text-[11px] font-medium" style={{ color: T3 }}>
                            <Clock className="w-[10px] h-[10px]" strokeWidth={2.5} />
                            {formatDueShort(d)}
                          </div>
                        )}
                      </div>
                    </div>
                    {!mySub && (
                      <button
                        onClick={e => { e.stopPropagation(); openHints(a); }}
                        className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 active:scale-[0.88] transition-transform"
                        style={{ background: "rgba(255,136,0,0.10)", border: "0.5px solid rgba(255,136,0,0.22)", transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)" }}
                        aria-label="Get hints"
                      >
                        <Lightbulb className="w-[15px] h-[15px]" style={{ color: ORANGE }} strokeWidth={2.2} />
                      </button>
                    )}
                    <div className="px-[10px] py-1 rounded-full text-[10px] font-bold shrink-0 tracking-[0.02em]"
                      style={{ background: tag.bg, color: tag.color, border: `0.5px solid ${tag.border}` }}>
                      {tag.label}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Upcoming Deadlines (only if there are upcoming pending items) ── */}
          {!loading && upcoming.length > 0 && (
            <div className="mx-5 mt-3 bg-white rounded-[24px] px-5 py-[18px]"
              style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
              <div className="flex items-center justify-between mb-[14px]">
                <div className="text-[16px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Upcoming Deadlines</div>
                <button onClick={() => setActiveTab(0)} className="text-[12px] font-bold" style={{ color: B1 }}>See all</button>
              </div>
              {upcoming.map((x: any, i: number, arr: any[]) => {
                const a = x.a;
                const d: Date = x.d;
                const days = daysUntil(d);
                const urgent = days <= 3;
                return (
                  <div key={a.id}
                    className="flex items-center gap-3 py-3 cursor-pointer"
                    style={{ borderBottom: i < arr.length - 1 ? `0.5px solid ${SEP}` : "none" }}
                    onClick={() => openSubmit(a)}>
                    <div className="w-[42px] h-[42px] rounded-[13px] flex flex-col items-center justify-center gap-[1px] shrink-0"
                      style={{
                        background: urgent ? "linear-gradient(135deg, #FF6600, #FFAA33)" : `linear-gradient(135deg, ${B1}, ${B2})`,
                        boxShadow: urgent ? "0 3px 10px rgba(255,102,0,0.24)" : "0 3px 10px rgba(0,85,255,0.28)"
                      }}>
                      <div className="text-[16px] font-bold text-white leading-none">{d.getDate()}</div>
                      <div className="text-[8px] font-bold uppercase tracking-[0.08em]" style={{ color: "rgba(255,255,255,0.65)" }}>{MONTHS[d.getMonth()]}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold truncate" style={{ color: T1, letterSpacing: "-0.2px" }}>{a.title || "Assignment"}</div>
                      <div className="text-[11px] mt-0.5 truncate" style={{ color: T3 }}>
                        {a.teacherName ? a.teacherName : "Teacher"}{a.description ? ` · ${a.description.split(".")[0].slice(0, 40)}` : ""}
                      </div>
                    </div>
                    <div className="px-[10px] py-1 rounded-full text-[10px] font-bold shrink-0"
                      style={{
                        background: urgent ? "rgba(255,136,0,0.10)" : "rgba(0,85,255,0.10)",
                        color: urgent ? "#884400" : B1,
                        border: `0.5px solid ${urgent ? "rgba(255,136,0,0.22)" : "rgba(0,85,255,0.20)"}`
                      }}>
                      {days === 0 ? "Today" : days === 1 ? "1 day" : `${days} days`}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Summary Dark Card ── */}
          <div className="mx-5 mt-[14px] rounded-[24px] px-[22px] py-5 relative overflow-hidden"
            style={{
              background: "linear-gradient(140deg, #001888 0%, #0033CC 48%, #0055FF 100%)",
              boxShadow: "0 8px 30px rgba(0,51,204,0.34), 0 0 0 0.5px rgba(255,255,255,0.14)",
            }}>
            <div className="absolute -top-10 -right-7 w-[180px] h-[180px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(255,255,255,0.14) 0%, transparent 65%)" }} />
            <div className="absolute inset-0 pointer-events-none" style={{
              backgroundImage: "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
              backgroundSize: "24px 24px"
            }} />
            <div className="text-[9px] font-bold uppercase tracking-[0.12em] mb-2 relative z-10" style={{ color: "rgba(255,255,255,0.50)" }}>Term Summary</div>
            <div className="text-[17px] font-bold mb-[14px] relative z-10 text-white" style={{ letterSpacing: "-0.3px" }}>Assignment Overview</div>
            <div className="grid grid-cols-3 rounded-[16px] overflow-hidden relative z-10" style={{ gap: "1px", background: "rgba(255,255,255,0.12)" }}>
              <div className="py-[13px] px-[14px] text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="text-[22px] font-bold text-white leading-none mb-1" style={{ letterSpacing: "-0.6px" }}>{pendingCount}</div>
                <div className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.42)" }}>Pending</div>
              </div>
              <div className="py-[13px] px-[14px] text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="text-[22px] font-bold text-white leading-none mb-1" style={{ letterSpacing: "-0.6px" }}>{completedCount}</div>
                <div className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.42)" }}>Done</div>
              </div>
              <div className="py-[13px] px-[14px] text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="text-[22px] font-bold text-white leading-none mb-1" style={{ letterSpacing: "-0.6px" }}>{overdueCount}</div>
                <div className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.42)" }}>Overdue</div>
              </div>
            </div>
          </div>

          <div className="h-6" />
        </div>

        {/* ── AI HINTS SHEET (shared with desktop state) ── */}
        <Sheet open={isHintsOpen} onOpenChange={v => { setIsHintsOpen(v); if (!v) { setHints([]); setHintIndex(0); setHintDoubt(""); } }}>
          <SheetContent side="right" className="w-full sm:max-w-lg p-0 border-l border-slate-100 bg-white">
            <div className="h-full flex flex-col">
              <div className="p-8 pb-6" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #f97316 100%)" }}>
                <SheetHeader className="text-left">
                  <SheetTitle className="text-white text-2xl font-black tracking-tight leading-none mb-1">AI Hints System</SheetTitle>
                  <SheetDescription className="text-amber-100 font-semibold text-xs">Stuck? Get step-by-step clues — not the answer!</SheetDescription>
                </SheetHeader>
                <div className="mt-4 bg-white/20 rounded-2xl px-4 py-3">
                  <p className="text-[9px] font-black text-white/70 uppercase tracking-widest mb-0.5">Assignment</p>
                  <p className="text-sm font-bold text-white leading-tight">{hintsTask?.title}</p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">What are you stuck on?</label>
                  <textarea
                    value={hintDoubt}
                    onChange={e => setHintDoubt(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGetHints(); } }}
                    rows={3}
                    placeholder="Describe the part you don't understand... e.g. 'I don't know how to start question 2'"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none"
                  />
                  <button
                    onClick={handleGetHints}
                    disabled={generatingHints || !hintDoubt.trim()}
                    className="mt-3 w-full h-11 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-all"
                  >
                    {generatingHints ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {generatingHints ? "Thinking of hints..." : "Get Hints"}
                  </button>
                </div>

                {generatingHints && (
                  <div className="flex items-center gap-3 p-4 bg-amber-50 rounded-2xl border border-amber-100">
                    <Loader2 className="w-4 h-4 text-amber-500 animate-spin flex-shrink-0" />
                    <p className="text-xs text-amber-700 font-semibold">Preparing your hints...</p>
                  </div>
                )}

                {hints.length > 0 && !generatingHints && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="w-4 h-4 text-amber-500" />
                      <p className="text-xs font-bold text-slate-600">Hints revealed: {Math.min(hintIndex + 1, hints.length)} / {hints.length}</p>
                    </div>
                    {hints.slice(0, hintIndex + 1).map((hint, i) => (
                      <div key={i} className={`rounded-2xl p-4 border ${i === hintIndex ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-100"}`}>
                        <div className="flex items-start gap-3">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-black ${i === hintIndex ? "bg-amber-500 text-white" : "bg-slate-200 text-slate-500"}`}>
                            {i + 1}
                          </div>
                          <p className="text-sm text-slate-700 leading-relaxed">{hint}</p>
                        </div>
                      </div>
                    ))}
                    {hintIndex < hints.length - 1 ? (
                      <button
                        onClick={() => setHintIndex(prev => prev + 1)}
                        className="w-full h-11 rounded-2xl border-2 border-dashed border-amber-200 text-amber-600 text-sm font-bold flex items-center justify-center gap-2 hover:bg-amber-50 transition-all active:scale-95"
                      >
                        <ChevronDown className="w-4 h-4" /> Next Hint
                      </button>
                    ) : (
                      <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-4 text-center">
                        <p className="text-sm font-bold text-emerald-700">All hints shown! Now try solving it yourself.</p>
                        <button onClick={() => { setHints([]); setHintIndex(0); setHintDoubt(""); }} className="mt-2 text-xs text-emerald-600 font-semibold underline">Ask about something else</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {/* ── SUBMISSION SHEET (shared) ── */}
        <Sheet open={isSubmitOpen} onOpenChange={setIsSubmitOpen}>
          <SheetContent side="right" className="w-full sm:max-w-xl p-0 border-l border-slate-100 bg-white">
            <div className="h-full flex flex-col">
              <div className="bg-slate-900 p-10 text-white text-left">
                <SheetHeader className="text-left">
                  <SheetTitle className="text-white text-3xl font-black tracking-tight leading-none mb-2">Subject Submission</SheetTitle>
                  <SheetDescription className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Portal Identification: {studentData?.id?.substring(0,10)}</SheetDescription>
                </SheetHeader>
              </div>

              <div className="flex-1 p-10 space-y-10 overflow-y-auto">
                <div className="space-y-4 text-left">
                  <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Target Task</p>
                    <h4 className="text-xl font-black text-slate-800">{selectedTask?.title}</h4>
                  </div>
                </div>

                <div className="space-y-6 text-left">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Academic Artifact (PDF/JPG)</label>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full p-12 border-2 border-dashed border-slate-100 rounded-[2.5rem] bg-slate-50/50 hover:bg-slate-100 transition-all cursor-pointer flex flex-col items-center justify-center text-center group"
                  >
                    <input type="file" ref={fileInputRef} className="hidden" accept=".pdf,.jpg,.png" onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setUploadFile(file);
                      if (file && selectedTask) generateInstantFeedback(selectedTask);
                    }} />
                    {uploadFile ? (
                      <div className="flex items-center gap-4 bg-white p-4 rounded-2xl shadow-xl border border-slate-50 animate-in zoom-in-95">
                        <FileText className="w-10 h-10 text-indigo-600" />
                        <div className="text-left"><p className="text-xs font-black text-slate-800">{uploadFile.name}</p></div>
                        <button onClick={(e) => { e.stopPropagation(); setUploadFile(null); }} className="p-2 text-rose-400"><X className="w-4 h-4" /></button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center">
                        <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center mb-4 shadow-sm border border-slate-50"><Upload className="w-8 h-8 text-slate-300" /></div>
                        <p className="text-sm font-black text-slate-400 group-hover:text-slate-600 transition-colors">Select Submission File</p>
                      </div>
                    )}
                  </div>
                </div>

                {(generatingFeedback || instantFeedback) && (
                  <div className="rounded-3xl overflow-hidden border border-indigo-100">
                    <div className="bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-3 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-white" />
                      <span className="text-[10px] font-black text-white uppercase tracking-widest">AI Pre-Submission Feedback</span>
                    </div>
                    {generatingFeedback ? (
                      <div className="p-5 flex items-center gap-3 bg-indigo-50">
                        <Loader2 className="w-4 h-4 text-indigo-500 animate-spin flex-shrink-0" />
                        <p className="text-xs text-indigo-600 font-semibold">Analysing your submission...</p>
                      </div>
                    ) : instantFeedback && (
                      <div className="p-5 space-y-4 bg-white">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{instantFeedback.emoji || "✨"}</span>
                          <p className="text-sm font-bold text-slate-800">{instantFeedback.overall}</p>
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                          <div className="bg-emerald-50 rounded-2xl p-4">
                            <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest mb-2">Strengths</p>
                            {(instantFeedback.strengths || []).map((s: string, i: number) => (
                              <div key={i} className="flex items-start gap-2 mb-1">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-slate-600">{s}</p>
                              </div>
                            ))}
                          </div>
                          <div className="bg-amber-50 rounded-2xl p-4">
                            <p className="text-[9px] font-black text-amber-700 uppercase tracking-widest mb-2">Room to Improve</p>
                            {(instantFeedback.improvements || []).map((s: string, i: number) => (
                              <div key={i} className="flex items-start gap-2 mb-1">
                                <ChevronDown className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-slate-600">{s}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                        {instantFeedback.tip && (
                          <div className="flex items-start gap-2 bg-slate-50 rounded-2xl p-3">
                            <Lightbulb className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-slate-500 italic">{instantFeedback.tip}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-4 text-left">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Teacher Notes (Optional)</label>
                  <textarea
                    rows={4}
                    value={studentNote}
                    onChange={(e) => setStudentNote(e.target.value)}
                    className="w-full p-6 bg-slate-50 border border-slate-100 rounded-3xl text-sm font-medium text-slate-600 focus:bg-white focus:ring-4 focus:ring-slate-100 outline-none transition-all resize-none placeholder:text-slate-300"
                    placeholder="Add any specific details for your teacher here..."
                  />
                </div>
              </div>

              <div className="p-10 border-t border-slate-100">
                <button
                  onClick={handleOfficialSubmission}
                  disabled={submittingFile || !uploadFile}
                  className="w-full py-6 bg-slate-900 text-white rounded-[2rem] text-[11px] font-black uppercase tracking-[0.3em] hover:bg-slate-800 shadow-2xl transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-4"
                >
                  {submittingFile ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Send className="w-5 h-5" /> Confirm Academic Hand-in</>}
                </button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     DESKTOP — Existing UI (unchanged)
     ═══════════════════════════════════════════════════════════════ */
  return (
    <div className="animate-in fade-in duration-500">
      <PageHeader
        title="Assignments & Coursework"
        subtitle="Manage submissions and track academic tasks"
        badge={assignments.length > 0 ? `${assignments.length} Total` : ""}
      />

      {/* STATS - Scrollable on mobile */}
      <div className="flex overflow-x-auto pb-4 gap-4 scrollbar-none no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 mb-6 font-bold">
        {[
          { label: 'Completion', value: '93%', color: 'text-emerald-500', icon: Target },
          { label: 'On-Time', value: '96%', color: 'text-blue-500', icon: BarChart3 },
          { label: 'Avg Score', value: '82%', color: 'text-indigo-500', icon: Trophy },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-3 min-w-[160px] flex-1">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">{stat.label}</p>
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
            </div>
            <h4 className={`text-2xl font-black ${stat.color}`}>{stat.value}</h4>
          </div>
        ))}
      </div>

      {/* TABS - Scrollable on mobile */}
      <div className="flex overflow-x-auto pb-2 mb-6 gap-2 scrollbar-none no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex bg-white p-1.5 rounded-2xl border border-slate-100 shadow-sm w-full sm:w-fit">
          {tabs.map((tab, i) => (
            <button key={tab} onClick={() => setActiveTab(i)} className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${i === activeTab ? "bg-slate-900 text-white shadow-lg" : "text-slate-400"}`}>
              {tab} ({i === 0 ? assignments.filter(a => !getSub(a.id)).length : i === 1 ? submissions.length : 0})
            </button>
          ))}
        </div>
      </div>

        {/* LIST */}
        <div className="space-y-6">
          {loading ? (
             <div className="py-24 text-center bg-white border border-dashed border-slate-100 rounded-[3rem]"><Loader2 className="w-10 h-10 text-indigo-600 animate-spin mx-auto mb-4" /></div>
          ) : filteredAssignments.length === 0 ? (
             <div className="py-24 bg-white border border-dashed border-slate-200 rounded-[3.5rem] text-center"><FileCheck className="w-12 h-12 text-slate-200 mx-auto mb-6" /><h3 className="text-xl font-black text-slate-800 uppercase">No Curriculums Found</h3></div>
          ) : (
             filteredAssignments.map((a) => {
               const mySub = getSub(a.id);
               return (
                 <div key={a.id} className="bg-white rounded-3xl border border-slate-100 p-5 md:p-8 shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row items-center gap-6 md:gap-8">
                   <div className="w-20 h-20 md:w-24 md:h-24 rounded-3xl flex items-center justify-center border-2 shrink-0 bg-slate-50 border-slate-100 shadow-inner">
                      {getSubjectIcon(a.title)}
                   </div>
                   <div className="flex-1 space-y-3 w-full font-bold">
                     <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                        <h3 className="text-xl md:text-2xl font-black text-slate-800 tracking-tight leading-tight">{a.title}</h3>
                        <span className={`w-fit px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${mySub ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                           {mySub ? 'Handed In' : 'Outstanding'}
                        </span>
                     </div>
                     <p className="text-sm font-bold text-slate-400 line-clamp-2">{a.description}</p>
                     <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1 font-bold">
                        <div className="flex items-center gap-2"><User className="w-4 h-4 text-slate-300"/><span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{a.teacherName || "Institutional Faculty"}</span></div>
                        <div className="flex items-center gap-2 text-rose-500"><Clock className="w-4 h-4"/><span className="text-[10px] font-black uppercase tracking-widest">Due Mar 28</span></div>
                     </div>
                   </div>
                   <div className="flex flex-col gap-3 w-full md:w-[200px]">
                      {mySub ? (
                         <div className="bg-emerald-50 text-emerald-600 p-4 rounded-2xl border border-emerald-100 text-center flex flex-col items-center shadow-sm">
                            <CheckCircle2 className="w-5 h-5 mb-1" />
                            <p className="text-[10px] font-black uppercase tracking-widest">Handed In</p>
                         </div>
                      ) : (
                         <>
                           <button
                             onClick={() => { setSelectedTask(a); setInstantFeedback(null); setUploadFile(null); setStudentNote(""); setIsSubmitOpen(true); }}
                             className="w-full px-6 py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-slate-800 shadow-lg active:scale-95 transition-all"
                           >
                             Submit Online
                           </button>
                           <button
                             onClick={() => { setHintsTask(a); setHintDoubt(""); setHints([]); setHintIndex(0); setIsHintsOpen(true); }}
                             className="w-full px-6 py-3 border border-amber-200 bg-amber-50 rounded-2xl text-[10px] font-black text-amber-600 uppercase tracking-widest hover:bg-amber-100 active:scale-95 transition-all flex items-center justify-center gap-2"
                           >
                             <Lightbulb className="w-3.5 h-3.5" /> AI Hints
                           </button>
                         </>
                      )}
                      {a.pdfUrl && <a href={a.pdfUrl} target="_blank" rel="noreferrer" className="w-full px-6 py-3 border border-slate-100 rounded-2xl text-[9px] font-black text-slate-400 uppercase tracking-widest hover:bg-slate-50 transition-all text-center">View Blueprint</a>}
                   </div>
                 </div>
               )
             })
          )}
        </div>

        {/* ── AI HINTS SHEET ── */}
        <Sheet open={isHintsOpen} onOpenChange={v => { setIsHintsOpen(v); if (!v) { setHints([]); setHintIndex(0); setHintDoubt(""); } }}>
          <SheetContent side="right" className="w-full sm:max-w-lg p-0 border-l border-slate-100 bg-white">
            <div className="h-full flex flex-col">
              {/* Header */}
              <div className="p-8 pb-6" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #f97316 100%)" }}>
                <SheetHeader className="text-left">
                  <SheetTitle className="text-white text-2xl font-black tracking-tight leading-none mb-1">AI Hints System</SheetTitle>
                  <SheetDescription className="text-amber-100 font-semibold text-xs">Stuck? Get step-by-step clues — not the answer!</SheetDescription>
                </SheetHeader>
                <div className="mt-4 bg-white/20 rounded-2xl px-4 py-3">
                  <p className="text-[9px] font-black text-white/70 uppercase tracking-widest mb-0.5">Assignment</p>
                  <p className="text-sm font-bold text-white leading-tight">{hintsTask?.title}</p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {/* Doubt input */}
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">What are you stuck on?</label>
                  <textarea
                    value={hintDoubt}
                    onChange={e => setHintDoubt(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGetHints(); } }}
                    rows={3}
                    placeholder="Describe the part you don't understand... e.g. 'I don't know how to start question 2'"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none"
                  />
                  <button
                    onClick={handleGetHints}
                    disabled={generatingHints || !hintDoubt.trim()}
                    className="mt-3 w-full h-11 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-all"
                  >
                    {generatingHints ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {generatingHints ? "Thinking of hints..." : "Get Hints"}
                  </button>
                </div>

                {/* Hints */}
                {generatingHints && (
                  <div className="flex items-center gap-3 p-4 bg-amber-50 rounded-2xl border border-amber-100">
                    <Loader2 className="w-4 h-4 text-amber-500 animate-spin flex-shrink-0" />
                    <p className="text-xs text-amber-700 font-semibold">Preparing your hints...</p>
                  </div>
                )}

                {hints.length > 0 && !generatingHints && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="w-4 h-4 text-amber-500" />
                      <p className="text-xs font-bold text-slate-600">Hints revealed: {Math.min(hintIndex + 1, hints.length)} / {hints.length}</p>
                    </div>

                    {hints.slice(0, hintIndex + 1).map((hint, i) => (
                      <div key={i} className={`rounded-2xl p-4 border ${i === hintIndex ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-100"}`}>
                        <div className="flex items-start gap-3">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-black ${i === hintIndex ? "bg-amber-500 text-white" : "bg-slate-200 text-slate-500"}`}>
                            {i + 1}
                          </div>
                          <p className="text-sm text-slate-700 leading-relaxed">{hint}</p>
                        </div>
                      </div>
                    ))}

                    {hintIndex < hints.length - 1 ? (
                      <button
                        onClick={() => setHintIndex(prev => prev + 1)}
                        className="w-full h-11 rounded-2xl border-2 border-dashed border-amber-200 text-amber-600 text-sm font-bold flex items-center justify-center gap-2 hover:bg-amber-50 transition-all active:scale-95"
                      >
                        <ChevronDown className="w-4 h-4" /> Next Hint
                      </button>
                    ) : (
                      <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-4 text-center">
                        <p className="text-sm font-bold text-emerald-700">All hints shown! Now try solving it yourself.</p>
                        <button onClick={() => { setHints([]); setHintIndex(0); setHintDoubt(""); }} className="mt-2 text-xs text-emerald-600 font-semibold underline">Ask about something else</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {/* SUBMISSION CENTER PANEL */}
        <Sheet open={isSubmitOpen} onOpenChange={setIsSubmitOpen}>
           <SheetContent side="right" className="w-full sm:max-w-xl p-0 border-l border-slate-100 bg-white">
              <div className="h-full flex flex-col">
                 <div className="bg-slate-900 p-10 text-white text-left">
                    <SheetHeader className="text-left">
                       <SheetTitle className="text-white text-3xl font-black tracking-tight leading-none mb-2">Subject Submission</SheetTitle>
                       <SheetDescription className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Portal Identification: {studentData?.id?.substring(0,10)}</SheetDescription>
                    </SheetHeader>
                 </div>

                 <div className="flex-1 p-10 space-y-10">
                    <div className="space-y-4 text-left">
                       <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Target Task</p>
                          <h4 className="text-xl font-black text-slate-800">{selectedTask?.title}</h4>
                       </div>
                    </div>

                    <div className="space-y-6 text-left">
                       <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Academic Artifact (PDF/JPG)</label>
                       <div 
                         onClick={() => fileInputRef.current?.click()}
                         className="w-full p-12 border-2 border-dashed border-slate-100 rounded-[2.5rem] bg-slate-50/50 hover:bg-slate-100 transition-all cursor-pointer flex flex-col items-center justify-center text-center group"
                       >
                          <input type="file" ref={fileInputRef} className="hidden" accept=".pdf,.jpg,.png" onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            setUploadFile(file);
                            if (file && selectedTask) generateInstantFeedback(selectedTask);
                          }} />
                          {uploadFile ? (
                             <div className="flex items-center gap-4 bg-white p-4 rounded-2xl shadow-xl border border-slate-50 animate-in zoom-in-95">
                                <FileText className="w-10 h-10 text-indigo-600" />
                                <div className="text-left"><p className="text-xs font-black text-slate-800">{uploadFile.name}</p></div>
                                <button onClick={(e) => { e.stopPropagation(); setUploadFile(null); }} className="p-2 text-rose-400"><X className="w-4 h-4" /></button>
                             </div>
                          ) : (
                             <div className="flex flex-col items-center">
                                <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center mb-4 shadow-sm border border-slate-50"><Upload className="w-8 h-8 text-slate-300" /></div>
                                <p className="text-sm font-black text-slate-400 group-hover:text-slate-600 transition-colors">Select Submission File</p>
                             </div>
                          )}
                       </div>
                    </div>

                    {/* ── AI Instant Feedback ── */}
                    {(generatingFeedback || instantFeedback) && (
                      <div className="rounded-3xl overflow-hidden border border-indigo-100">
                        <div className="bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-3 flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-white" />
                          <span className="text-[10px] font-black text-white uppercase tracking-widest">AI Pre-Submission Feedback</span>
                        </div>
                        {generatingFeedback ? (
                          <div className="p-5 flex items-center gap-3 bg-indigo-50">
                            <Loader2 className="w-4 h-4 text-indigo-500 animate-spin flex-shrink-0" />
                            <p className="text-xs text-indigo-600 font-semibold">Analysing your submission...</p>
                          </div>
                        ) : instantFeedback && (
                          <div className="p-5 space-y-4 bg-white">
                            <div className="flex items-center gap-3">
                              <span className="text-2xl">{instantFeedback.emoji || "✨"}</span>
                              <p className="text-sm font-bold text-slate-800">{instantFeedback.overall}</p>
                            </div>
                            <div className="grid grid-cols-1 gap-3">
                              <div className="bg-emerald-50 rounded-2xl p-4">
                                <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest mb-2">Strengths</p>
                                {(instantFeedback.strengths || []).map((s: string, i: number) => (
                                  <div key={i} className="flex items-start gap-2 mb-1">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                                    <p className="text-xs text-slate-600">{s}</p>
                                  </div>
                                ))}
                              </div>
                              <div className="bg-amber-50 rounded-2xl p-4">
                                <p className="text-[9px] font-black text-amber-700 uppercase tracking-widest mb-2">Room to Improve</p>
                                {(instantFeedback.improvements || []).map((s: string, i: number) => (
                                  <div key={i} className="flex items-start gap-2 mb-1">
                                    <ChevronDown className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                                    <p className="text-xs text-slate-600">{s}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                            {instantFeedback.tip && (
                              <div className="flex items-start gap-2 bg-slate-50 rounded-2xl p-3">
                                <Lightbulb className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-slate-500 italic">{instantFeedback.tip}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="space-y-4 text-left">
                       <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Teacher Notes (Optional)</label>
                       <textarea 
                         rows={4}
                         value={studentNote}
                         onChange={(e) => setStudentNote(e.target.value)}
                         className="w-full p-6 bg-slate-50 border border-slate-100 rounded-3xl text-sm font-medium text-slate-600 focus:bg-white focus:ring-4 focus:ring-slate-100 outline-none transition-all resize-none placeholder:text-slate-300"
                         placeholder="Add any specific details for your teacher here..."
                       />
                    </div>
                 </div>

                 <div className="p-10 border-t border-slate-100">
                    <button 
                      onClick={handleOfficialSubmission}
                      disabled={submittingFile || !uploadFile}
                      className="w-full py-6 bg-slate-900 text-white rounded-[2rem] text-[11px] font-black uppercase tracking-[0.3em] hover:bg-slate-800 shadow-2xl transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-4"
                    >
                       {submittingFile ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Send className="w-5 h-5" /> Confirm Academic Hand-in</>}
                    </button>
                 </div>
              </div>
           </SheetContent>
        </Sheet>
      </div>
  );
};

export default AssignmentsPage;
