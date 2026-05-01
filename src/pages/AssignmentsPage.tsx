import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { User, Clock, CheckCircle2, Loader2, Upload, FileCheck, X, FileText, BarChart3, Target, Trophy, Send, Lightbulb, Sparkles, ChevronDown, CalendarCheck, Hourglass } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { db, storage } from "@/lib/firebase";
import { collection, where, onSnapshot, addDoc, serverTimestamp, Unsubscribe } from "firebase/firestore";
import { scopedQuery } from "@/lib/scopedQuery";
import { subscribeEnrollments } from "@/lib/enrollmentQuery";
import { subscribePerStudent } from "@/lib/perStudentQuery";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

import { callAI } from "../ai/utils/callAI";

const AssignmentsPage = () => {
  const { studentData } = useAuth();
  const navigate = useNavigate();
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
        // CRITICAL: filter by schoolId server-side — without it, a colliding
        // classId across schools would surface another school's assignments.
        const q = scopedQuery("assignments", schoolId, where("classId", "in", classIds));
        unsubAssignments = onSnapshot(q, (snap) => {
            setAssignments(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            setLoading(false);
        }, (err) => {
            console.error("[Assignments] assignments listener error:", err);
            setAssignments([]);
            setLoading(false);
        });
    };

    // Dual-listener helper — picks up legacy enrollments (studentId stored
    // as email by older teacher/principal writes) as well as new ones.
    const unsubEnroll = subscribeEnrollments(studentData, (docs) => {
      const classIds = [...new Set(docs.map(d => d.data().classId).filter(Boolean))] as string[];
      setupAssignmentListener(classIds);
    });

    // Submissions — dual-query (studentId + studentEmail) via shared helper
    const unsubSub = subscribePerStudent({
      collection: "submissions",
      student: studentData,
      onChange: (docs) => setSubmissions(docs.map(d => ({ id: d.id, ...d.data() }))),
      onError: (err) => {
        console.error("[Assignments] submissions listener error:", err);
        setSubmissions([]);
      },
    });
    return () => { unsubEnroll(); if (unsubAssignments) unsubAssignments(); unsubSub(); };
  }, [studentData?.id, studentData?.schoolId, studentData?.email]);

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
    } catch (err) {
      // AI failed — surface it honestly instead of returning fabricated
      // "AI feedback" that the parent will believe is real.
      console.error("[AssignmentsPage] AI feedback generation failed:", err);
      setInstantFeedback({ error: "AI feedback unavailable. Please try again later." });
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
    } catch (err) {
      // AI failed — don't fall back to canned generic hints; that misleads
      // the parent into thinking AI generated something tailored.
      console.error("[AssignmentsPage] AI hints generation failed:", err);
      toast.error("Couldn't generate hints right now. Please try again.");
      setHints([]);
    } finally { setGeneratingHints(false); }
  };

  const handleOfficialSubmission = async () => {
    if (!uploadFile || !selectedTask) return toast.error("Please attach your homework artifact first!");

    // Storage rules require a schoolId segment — writing without one results
    // in a silent "permission-denied" from Firebase that looks like a generic
    // upload failure to the user.
    if (!studentData?.schoolId) {
      toast.error("Your school context is missing. Please sign in again.");
      return;
    }

    // Match Cloud Storage rule: files must be one of these types and under
    // 50 MB. Failing fast here avoids a confusing Firebase "permission-denied"
    // after a slow upload attempt.
    const allowedTypes = new Set([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ]);
    if (!allowedTypes.has(uploadFile.type)) {
      toast.error("Unsupported file type. Use PDF, image, Word, or text file.");
      return;
    }
    if (uploadFile.size > 50 * 1024 * 1024) {
      toast.error("File too large. Max size is 50 MB.");
      return;
    }

    setSubmittingFile(true);
    try {
        // Sanitise the filename before embedding in a Storage path. Raw user
        // filenames can contain "/" or ".." segments that confuse path logic
        // downstream and, with permissive rules, enable traversal.
        //
        // Use \p{L}\p{N} (Unicode letters/numbers) instead of \w so that
        // Hindi / Tamil / other non-ASCII filenames survive the sanitisation
        // — this app ships to schools across India.
        const safeName = uploadFile.name
          .replace(/[^\p{L}\p{N}.\-_]/gu, "_")
          .replace(/_{2,}/g, "_")
          .slice(0, 120);
        // IMPORTANT: Storage rule matches `/submissions/{schoolId}/{allPaths=**}`.
        // The previous flat path `submissions/{filename}` did not include a
        // schoolId segment, so every upload since the 2026-04-18 rules deploy
        // has been silently rejected as permission-denied. This proper path
        // restores the write.
        const sRef = ref(
          storage,
          `submissions/${studentData.schoolId}/${studentData.id}/${selectedTask.id}/${safeName}`,
        );
        const snap = await uploadBytes(sRef, uploadFile);
        const url = await getDownloadURL(snap.ref);

        await addDoc(collection(db, "submissions"), {
            homeworkId: selectedTask.id, // Renamed from assignmentId to differentiate from teaching_assignment
            assignmentId: selectedTask.assignmentId || "legacy", // Enforced Phase 1 spec: tracking the teaching_assignment
            studentId: studentData.id,
            studentEmail: studentData.email?.toLowerCase() || "",
            studentName: studentData.name,
            // Required by tenant-isolation rule — guaranteed non-empty because
            // handleOfficialSubmission() bails out early without schoolId.
            schoolId: studentData.schoolId,
            fileUrl: url,
            fileName: uploadFile.name,
            studentNote: studentNote,
            timestamp: serverTimestamp(),
            status: "Submitted"
        });

        toast.success("Assignment submitted.");
        setIsSubmitOpen(false);
        setUploadFile(null);
        setStudentNote("");
    } catch (e: any) {
        console.error("[Assignments] submission failed:", e?.code, e?.message || e);
        // Distinguish permission-denied (actionable via re-login) from a real
        // network/storage issue (actionable via retry). Never surface raw
        // Firebase error codes to the parent — they look like a crash report.
        const msg = e?.code === "permission-denied" || e?.code === "storage/unauthorized"
          ? "Upload was blocked. Please sign in again and retry."
          : "Upload failed. Check your connection and try again.";
        toast.error(msg);
    } finally {
        setSubmittingFile(false);
    }
  };

  const getSub = (aId: string) => submissions.find(s =>
    s.homeworkId === aId ||    // Parent dashboard saves here
    s.assignmentId === aId     // Fallback for older records
  );

  // ── Real term stats ────────────────────────────────────────────────────────
  // Previously this page displayed hardcoded "93% Completion / 96% On-Time /
  // 82% Avg Score" to every parent regardless of actual submissions — a
  // materially misleading bug for a page parents trust. These are now derived
  // from the live submissions list.
  const parseDueForStats = (a: any): Date | null => {
    const v = a?.dueDate || a?.due_date || a?.deadline || a?.due || a?.dueOn;
    if (!v) return null;
    if (typeof v?.toDate === "function") return v.toDate();
    if (v?.seconds) return new Date(v.seconds * 1000);
    if (typeof v === "string" || typeof v === "number") {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  };
  const toDateSafe = (v: any): Date | null => {
    if (!v) return null;
    if (typeof v?.toDate === "function") return v.toDate();
    if (v?.seconds) return new Date(v.seconds * 1000);
    if (typeof v === "string" || typeof v === "number") {
      const d = new Date(v); return isNaN(d.getTime()) ? null : d;
    }
    return null;
  };

  const totalAssignments = assignments.length;
  const completedAssignmentsCount = assignments.filter(a => !!getSub(a.id)).length;
  const completionPct = totalAssignments === 0 ? null : Math.round((completedAssignmentsCount / totalAssignments) * 100);

  // On-Time: fraction of completed submissions handed in on or before the
  // assignment's due date. Only counts submissions whose assignment HAS a
  // due date — assignments without deadlines can't be "on-time".
  const datedCompletions = assignments
    .map(a => ({ a, sub: getSub(a.id), due: parseDueForStats(a) }))
    .filter(x => x.sub && x.due);
  const onTimeCompletions = datedCompletions.filter(x => {
    const subTime = toDateSafe(x.sub.timestamp || x.sub.submittedAt);
    if (!subTime || !x.due) return false;
    // end-of-day grace: a submission on the due date counts as on-time
    const dueEod = new Date(x.due); dueEod.setHours(23, 59, 59, 999);
    return subTime.getTime() <= dueEod.getTime();
  }).length;
  const onTimePct = datedCompletions.length === 0 ? null : Math.round((onTimeCompletions / datedCompletions.length) * 100);

  // Avg Score: only when submissions carry a numeric grade/score. The current
  // Cloud Firestore schema does NOT store grades on submissions, so this will
  // almost always be null — we render "—" rather than fabricating "82%".
  const gradedSubs = submissions.filter(s => {
    const g = typeof s.grade === "number" ? s.grade : typeof s.score === "number" ? s.score : null;
    return g != null && isFinite(g);
  });
  const avgScorePct = gradedSubs.length === 0
    ? null
    : Math.round(gradedSubs.reduce((acc, s) => acc + (typeof s.grade === "number" ? s.grade : s.score), 0) / gradedSubs.length);

  // Display helpers — show "—" (honest empty) rather than 0%/NaN% when the
  // dataset is empty, matching the rest of the parent dashboard's null-state
  // conventions.
  const completionDisplay = completionPct == null ? "—" : `${completionPct}%`;
  const onTimeDisplay = onTimePct == null ? "—" : `${onTimePct}%`;
  const avgScoreDisplay = avgScorePct == null ? "—" : `${avgScorePct}%`;

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
              { label: "Completion", value: completionDisplay, color: GREEN, decorIcon: CheckCircle2, cardBg: "linear-gradient(135deg, rgba(0,200,83,0.13) 0%, rgba(0,200,83,0.04) 100%)", cardBdr: "rgba(0,200,83,0.20)", iconBoxBg: "rgba(0,200,83,0.18)", iconBoxBdr: "rgba(0,200,83,0.30)", icon: Target },
              { label: "On-Time",    value: onTimeDisplay,    color: B1,    decorIcon: CalendarCheck, cardBg: "linear-gradient(135deg, rgba(0,85,255,0.10) 0%, rgba(0,85,255,0.03) 100%)", cardBdr: "rgba(0,85,255,0.20)", iconBoxBg: "rgba(0,85,255,0.14)", iconBoxBdr: "rgba(0,85,255,0.28)", icon: BarChart3 },
              { label: "Avg Score",  value: avgScoreDisplay,  color: VIOLET, decorIcon: Sparkles, cardBg: "linear-gradient(135deg, rgba(107,33,232,0.12) 0%, rgba(107,33,232,0.04) 100%)", cardBdr: "rgba(107,33,232,0.22)", iconBoxBg: "rgba(107,33,232,0.16)", iconBoxBdr: "rgba(107,33,232,0.30)", icon: Trophy },
            ].map(({ label, value, color, decorIcon: DecorIcon, cardBg, cardBdr }) => (
              <div
                key={label}
                role="button"
                tabIndex={0}
                aria-label={`Open reports page for ${label}`}
                onClick={() => navigate("/reports")}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/reports"); } }}
                className="rounded-[22px] px-[18px] py-4 min-w-[130px] flex-shrink-0 relative overflow-hidden cursor-pointer active:scale-[0.96] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                style={{ background: cardBg, boxShadow: SH, border: `0.5px solid ${cardBdr}`, transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)" }}>
                <div className="absolute pointer-events-none" style={{ bottom: 8, right: 8 }}>
                  <DecorIcon style={{ width: 52, height: 52, color, opacity: 0.20, strokeWidth: 1.6 }} />
                </div>
                <div className="text-[9px] font-bold uppercase tracking-[0.10em] mb-[10px] relative" style={{ color: T4 }}>{label}</div>
                <div className="text-[28px] font-bold leading-none relative" style={{ color, letterSpacing: "-0.8px" }}>{value}</div>
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
                // For completed items, opening the submitted file gives the
                // parent an immediate, meaningful action instead of a silent
                // no-op. For open items, the tap starts the submission flow.
                const handleRowClick = () => {
                  if (mySub?.fileUrl) { window.open(mySub.fileUrl, "_blank", "noopener,noreferrer"); return; }
                  if (!mySub) openSubmit(a);
                };
                return (
                  <div key={a.id}
                    role="button"
                    tabIndex={0}
                    aria-label={mySub ? `View submission for ${a.title || "assignment"}` : `Submit ${a.title || "assignment"}`}
                    onClick={handleRowClick}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleRowClick(); } }}
                    className="bg-white rounded-[20px] p-4 flex items-center gap-[14px] relative overflow-hidden active:scale-[0.97] transition-transform cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
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
            <div className="mx-5 mt-3 bg-white rounded-[24px] px-5 py-[18px] transition-transform"
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
                    role="button"
                    tabIndex={0}
                    aria-label={`Submit ${a.title || "assignment"}, due in ${days} days`}
                    className="flex items-center gap-3 py-3 cursor-pointer active:bg-[#EEF4FF] transition-colors rounded-[12px] -mx-2 px-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                    style={{ borderBottom: i < arr.length - 1 ? `0.5px solid ${SEP}` : "none" }}
                    onClick={() => openSubmit(a)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSubmit(a); } }}>
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
          <div
            role="button"
            tabIndex={0}
            aria-label="Open reports page for term summary"
            onClick={() => navigate("/reports")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/reports"); } }}
            className="mx-5 mt-[14px] rounded-[24px] px-[22px] py-5 relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
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

        {/* ── SUBMISSION SHEET (Bright Blue Apple UI) ── */}
        <Sheet open={isSubmitOpen} onOpenChange={setIsSubmitOpen}>
          <SheetContent side="right" className="w-full sm:max-w-xl p-0 border-0" style={{ background: BG }}>
            <div className="h-full flex flex-col" style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}>
              {/* Hero header — dark navy gradient */}
              <div className="px-6 pt-7 pb-6 text-white text-left relative overflow-hidden"
                style={{ background: "linear-gradient(140deg, #001888 0%, #0033CC 48%, #0055FF 100%)" }}>
                <div className="absolute -top-10 -right-7 w-[200px] h-[200px] rounded-full pointer-events-none"
                  style={{ background: "radial-gradient(circle, rgba(255,255,255,0.14) 0%, transparent 65%)" }} />
                <div className="absolute inset-0 pointer-events-none" style={{
                  backgroundImage: "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
                  backgroundSize: "24px 24px"
                }} />
                <SheetHeader className="text-left relative z-10">
                  <SheetTitle className="text-white text-[26px] font-bold tracking-tight leading-none mb-2" style={{ letterSpacing: "-0.6px" }}>
                    Submit Assignment
                  </SheetTitle>
                  <SheetDescription className="font-bold uppercase tracking-[0.10em] text-[10px]" style={{ color: "rgba(255,255,255,0.55)" }}>
                    ID: {studentData?.id?.substring(0, 10)}
                  </SheetDescription>
                </SheetHeader>
              </div>

              <div className="flex-1 px-5 py-5 space-y-5 overflow-y-auto" style={{ background: BG }}>
                {/* Target task card */}
                <div className="bg-white rounded-[22px] px-5 py-[18px]"
                  style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.10em] mb-2" style={{ color: T4 }}>Target Task</p>
                  <h4 className="text-[17px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>{selectedTask?.title}</h4>
                </div>

                {/* File upload */}
                <div className="space-y-3 text-left">
                  <label className="text-[10px] font-bold uppercase tracking-[0.10em] ml-1 block" style={{ color: T4 }}>
                    Academic Artifact (PDF/JPG)
                  </label>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full px-5 py-8 rounded-[24px] cursor-pointer flex flex-col items-center justify-center text-center transition-all active:scale-[0.98]"
                    style={{
                      background: "white",
                      border: "1.5px dashed rgba(0,85,255,0.25)",
                      boxShadow: SH,
                      transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)"
                    }}>
                    <input type="file" ref={fileInputRef} className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.txt" onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setUploadFile(file);
                      if (file && selectedTask) generateInstantFeedback(selectedTask);
                    }} />
                    {uploadFile ? (
                      <div className="flex items-center gap-3 px-3 py-3 rounded-[14px] animate-in zoom-in-95 w-full"
                        style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.12)" }}>
                        <div className="w-11 h-11 rounded-[12px] flex items-center justify-center shrink-0"
                          style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 2px 8px rgba(0,85,255,0.30)" }}>
                          <FileText className="w-5 h-5 text-white" />
                        </div>
                        <p className="text-[13px] font-bold flex-1 truncate text-left" style={{ color: T1 }}>{uploadFile.name}</p>
                        <button onClick={(e) => { e.stopPropagation(); setUploadFile(null); }} className="p-2" style={{ color: RED }} aria-label="Remove file">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-14 h-14 rounded-[16px] flex items-center justify-center"
                          style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 3px 12px rgba(0,85,255,0.32)" }}>
                          <Upload className="w-6 h-6 text-white" strokeWidth={2.2} />
                        </div>
                        <p className="text-[14px] font-bold" style={{ color: T2, letterSpacing: "-0.2px" }}>Tap to choose file</p>
                        <p className="text-[11px]" style={{ color: T3 }}>PDF, JPG, PNG, DOC up to 10 MB</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* AI Pre-Submission Feedback */}
                {(generatingFeedback || instantFeedback) && (
                  <div className="rounded-[22px] overflow-hidden"
                    style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                    <div className="px-5 py-3 flex items-center gap-2 relative overflow-hidden"
                      style={{ background: "linear-gradient(135deg, #001888 0%, #0033CC 50%, #0055FF 100%)" }}>
                      <Sparkles className="w-4 h-4 text-white relative z-10" />
                      <span className="text-[10px] font-bold text-white uppercase tracking-[0.12em] relative z-10">AI Pre-Submission Feedback</span>
                    </div>
                    {generatingFeedback ? (
                      <div className="p-5 flex items-center gap-3 bg-white">
                        <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: B1 }} />
                        <p className="text-[12px] font-semibold" style={{ color: T2 }}>Analysing your submission...</p>
                      </div>
                    ) : instantFeedback?.error ? (
                      <div className="p-5 flex items-start gap-3 bg-white">
                        <Sparkles className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: RED }} />
                        <p className="text-[12px] font-semibold" style={{ color: RED }}>{instantFeedback.error}</p>
                      </div>
                    ) : instantFeedback && (
                      <div className="p-5 space-y-4 bg-white">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{instantFeedback.emoji || "✨"}</span>
                          <p className="text-[14px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>{instantFeedback.overall}</p>
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                          <div className="rounded-[16px] p-4" style={{ background: "rgba(0,200,83,0.08)", border: "0.5px solid rgba(0,200,83,0.20)" }}>
                            <p className="text-[9px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: "#007830" }}>Strengths</p>
                            {(instantFeedback.strengths || []).map((s: string, i: number) => (
                              <div key={i} className="flex items-start gap-2 mb-1">
                                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: GREEN }} />
                                <p className="text-[12px]" style={{ color: T2 }}>{s}</p>
                              </div>
                            ))}
                          </div>
                          <div className="rounded-[16px] p-4" style={{ background: "rgba(255,136,0,0.08)", border: "0.5px solid rgba(255,136,0,0.22)" }}>
                            <p className="text-[9px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: "#AA5500" }}>Room to Improve</p>
                            {(instantFeedback.improvements || []).map((s: string, i: number) => (
                              <div key={i} className="flex items-start gap-2 mb-1">
                                <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: ORANGE }} />
                                <p className="text-[12px]" style={{ color: T2 }}>{s}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                        {instantFeedback.tip && (
                          <div className="flex items-start gap-2 rounded-[14px] p-3" style={{ background: BG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                            <Lightbulb className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: B1 }} />
                            <p className="text-[12px] italic" style={{ color: T3 }}>{instantFeedback.tip}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Teacher notes */}
                <div className="space-y-3 text-left">
                  <label className="text-[10px] font-bold uppercase tracking-[0.10em] ml-1 block" style={{ color: T4 }}>
                    Teacher Notes (Optional)
                  </label>
                  <textarea
                    rows={4}
                    value={studentNote}
                    onChange={(e) => setStudentNote(e.target.value)}
                    className="w-full p-4 rounded-[18px] text-[13px] font-medium outline-none transition-all resize-none focus:ring-2 focus:ring-[#0055FF]/30"
                    style={{
                      background: "white",
                      color: T1,
                      border: "0.5px solid rgba(0,85,255,0.12)",
                      boxShadow: SH,
                    }}
                    placeholder="Add any specific details for your teacher here..."
                  />
                </div>
              </div>

              {/* Submit button */}
              <div className="px-5 pt-3 pb-5" style={{ background: BG, borderTop: "0.5px solid rgba(0,85,255,0.07)" }}>
                <button
                  onClick={handleOfficialSubmission}
                  disabled={submittingFile || !uploadFile}
                  className="w-full py-[18px] rounded-[20px] text-[13px] font-bold uppercase tracking-[0.16em] transition-all active:scale-[0.97] disabled:opacity-40 flex items-center justify-center gap-3 text-white relative overflow-hidden">
                  <span className="absolute inset-0" style={{
                    background: "linear-gradient(135deg, #001888 0%, #0033CC 50%, #0055FF 100%)",
                    boxShadow: "0 6px 22px rgba(0,85,255,0.42), 0 2px 6px rgba(0,85,255,0.22)"
                  }} />
                  <span className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.13) 0%, transparent 52%)" }} />
                  <span className="relative z-10 flex items-center gap-3">
                    {submittingFile ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Send className="w-4 h-4" /> Submit Assignment</>}
                  </span>
                </button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     DESKTOP — Bright Blue Apple UI
     ═══════════════════════════════════════════════════════════════ */
  const B1 = "#0055FF", B2 = "#1166FF", B4 = "#4499FF";
  const BG = "#EEF4FF", BG2 = "#E0ECFF";
  const T1 = "#001040", T2 = "#002080", T3 = "#5070B0", T4 = "#99AACC";
  const SEP = "rgba(0,85,255,0.07)";
  const GREEN = "#00C853", RED = "#FF3355", ORANGE = "#FF8800", VIOLET = "#6B21E8";
  const BLUE_BDR = "rgba(0,85,255,0.12)";
  const SH = "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.09), 0 10px 28px rgba(0,85,255,0.11)";
  const SH_LG = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.14)";
  const SH_BTN = "0 6px 22px rgba(0,85,255,0.42), 0 2px 6px rgba(0,85,255,0.22)";

  const parseDueD = (a: any): Date | null => {
    const v = a.dueDate || a.due_date || a.deadline || a.due || a.dueOn;
    if (!v) return null;
    if (typeof v?.toDate === "function") return v.toDate();
    if (v?.seconds) return new Date(v.seconds * 1000);
    if (typeof v === "string" || typeof v === "number") {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  };
  const nowD = new Date();
  const todayStartD = new Date(nowD); todayStartD.setHours(0, 0, 0, 0);
  const isOverdueD = (a: any) => {
    const d = parseDueD(a);
    return !!d && d.getTime() < todayStartD.getTime();
  };
  const unsubmittedD = assignments.filter(a => !getSub(a.id));
  const overdueListD = unsubmittedD.filter(a => isOverdueD(a));
  const pendingListD = unsubmittedD.filter(a => !isOverdueD(a));
  const completedListD = assignments.filter(a => !!getSub(a.id));
  const desktopList =
    activeTab === 0 ? pendingListD :
    activeTab === 1 ? completedListD :
    overdueListD;

  const MONTHS_D = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const daysUntilD = (d: Date) => Math.max(0, Math.round((d.getTime() - todayStartD.getTime()) / 86400000));

  const upcomingD = pendingListD
    .map(a => ({ a, d: parseDueD(a) }))
    .filter(x => x.d)
    .sort((x: any, y: any) => x.d.getTime() - y.d.getTime())
    .slice(0, 4);

  const rowAccentsD = [
    { ico: "linear-gradient(135deg, #0044EE, #2277FF)", icoSh: "0 3px 10px rgba(0,68,238,0.26)", bar: `linear-gradient(180deg, ${B1}, ${B4})` },
    { ico: "linear-gradient(135deg, #FF6600, #FFAA33)", icoSh: "0 3px 10px rgba(255,102,0,0.24)", bar: `linear-gradient(180deg, ${ORANGE}, #FFCC44)` },
    { ico: "linear-gradient(135deg, #00A040, #00C853)", icoSh: "0 3px 10px rgba(0,160,64,0.26)", bar: `linear-gradient(180deg, ${GREEN}, #66EE88)` },
    { ico: "linear-gradient(135deg, #6B21E8, #A87FF8)", icoSh: "0 3px 10px rgba(107,33,232,0.26)", bar: `linear-gradient(180deg, ${VIOLET}, #A87FF8)` },
  ];
  const getRowAccentD = (idx: number) => rowAccentsD[idx % rowAccentsD.length];

  const tagForD = (a: any) => {
    if (getSub(a.id)) return { bg: "rgba(0,200,83,0.10)", color: "#007830", border: "rgba(0,200,83,0.22)", label: "Handed In" };
    if (isOverdueD(a)) return { bg: "rgba(255,51,85,0.10)", color: RED, border: "rgba(255,51,85,0.22)", label: "Overdue" };
    const d = parseDueD(a);
    if (d) {
      const days = daysUntilD(d);
      if (days <= 3) return { bg: "rgba(255,136,0,0.10)", color: "#884400", border: "rgba(255,136,0,0.22)", label: "Due Soon" };
    }
    return { bg: "rgba(0,85,255,0.10)", color: B1, border: "rgba(0,85,255,0.20)", label: "Pending" };
  };

  return (
    <div className="animate-in fade-in duration-500 -m-4 sm:-m-6 md:-m-8 min-h-[calc(100vh-64px)]"
      style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: BG }}>
      <div className="w-full px-6 pt-8 pb-12">

        {/* ── Toolbar ── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] mb-1 flex items-center gap-[7px]" style={{ color: T4 }}>
              <span className="w-[6px] h-[6px] rounded-full" style={{ background: GREEN, boxShadow: "0 0 0 3px rgba(0,200,83,0.2)" }} />
              Parent Dashboard · Assignments
            </div>
            <h1 className="text-[32px] font-bold leading-none" style={{ color: T1, letterSpacing: "-0.8px" }}>Assignments &amp; Coursework</h1>
            <div className="text-[13px] font-normal mt-[6px]" style={{ color: T3 }}>Manage submissions and track academic tasks</div>
          </div>
          <div className="flex items-center gap-[10px]">
            <div className="px-[14px] py-[8px] rounded-full text-[12px] font-bold" style={{ background: "rgba(0,85,255,0.08)", color: B1, border: `0.5px solid ${BLUE_BDR}` }}>
              {assignments.length} Total
            </div>
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-bold text-white"
              style={{ background: `linear-gradient(140deg, ${B1}, ${B2})`, boxShadow: "0 3px 12px rgba(0,85,255,0.36), 0 0 0 2px rgba(255,255,255,0.8)" }}>
              {studentData?.name?.[0]?.toUpperCase() || "S"}
            </div>
          </div>
        </div>

        {/* ── Stats Row (4-col) ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Completion", value: completionDisplay, color: GREEN, decorIcon: CheckCircle2, cardBg: "linear-gradient(135deg, rgba(0,200,83,0.13) 0%, rgba(0,200,83,0.04) 100%)", cardBdr: "rgba(0,200,83,0.20)", iconBoxBg: "rgba(0,200,83,0.18)", iconBoxBdr: "rgba(0,200,83,0.30)", icon: Target },
            { label: "On-Time",    value: onTimeDisplay,    color: B1,    decorIcon: CalendarCheck, cardBg: "linear-gradient(135deg, rgba(0,85,255,0.10) 0%, rgba(0,85,255,0.03) 100%)", cardBdr: "rgba(0,85,255,0.20)", iconBoxBg: "rgba(0,85,255,0.14)", iconBoxBdr: "rgba(0,85,255,0.28)", icon: BarChart3 },
            { label: "Avg Score",  value: avgScoreDisplay,  color: VIOLET, decorIcon: Sparkles, cardBg: "linear-gradient(135deg, rgba(107,33,232,0.12) 0%, rgba(107,33,232,0.04) 100%)", cardBdr: "rgba(107,33,232,0.22)", iconBoxBg: "rgba(107,33,232,0.16)", iconBoxBdr: "rgba(107,33,232,0.30)", icon: Trophy },
            { label: "Pending",    value: `${pendingListD.length}`, color: ORANGE, decorIcon: Hourglass, cardBg: "linear-gradient(135deg, rgba(255,136,0,0.13) 0%, rgba(255,136,0,0.04) 100%)", cardBdr: "rgba(255,136,0,0.22)", iconBoxBg: "rgba(255,136,0,0.18)", iconBoxBdr: "rgba(255,136,0,0.32)", icon: Clock },
          ].map(({ label, value, color, decorIcon: DecorIcon, cardBg, cardBdr }) => (
            <div
              key={label}
              role="button"
              tabIndex={0}
              aria-label={`Open reports page for ${label}`}
              onClick={() => navigate("/reports")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/reports"); } }}
              className="rounded-[22px] px-6 py-5 relative overflow-hidden cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
              style={{ background: cardBg, boxShadow: SH, border: `0.5px solid ${cardBdr}` }}>
              <div className="absolute pointer-events-none" style={{ bottom: 14, right: 14 }}>
                <DecorIcon style={{ width: 80, height: 80, color, opacity: 0.20, strokeWidth: 1.6 }} />
              </div>
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] mb-3 relative" style={{ color: T4 }}>{label}</div>
              <div className="text-[36px] font-bold leading-none relative" style={{ color, letterSpacing: "-1px" }}>{value}</div>
            </div>
          ))}
        </div>

        {/* ── Segment Tabs ── */}
        <div className="flex gap-1 p-1 rounded-[18px] bg-white w-fit mb-6"
          style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)" }}>
          {[
            { label: "Pending",   count: pendingListD.length,   idx: 0, over: false },
            { label: "Completed", count: completedListD.length, idx: 1, over: false },
            { label: "Overdue",   count: overdueListD.length,   idx: 2, over: true },
          ].map(({ label, count, idx, over }) => {
            const isAct = activeTab === idx;
            return (
              <button key={label} onClick={() => setActiveTab(idx)}
                className="px-5 py-[10px] rounded-[14px] text-[12px] font-bold flex items-center gap-2 transition-all"
                style={{
                  background: isAct ? `linear-gradient(135deg, ${B1}, ${B2})` : "transparent",
                  color: isAct ? "#fff" : T4,
                  boxShadow: isAct ? "0 3px 12px rgba(0,85,255,0.32), 0 1px 3px rgba(0,85,255,0.20)" : "none",
                }}>
                {label}
                <span className="min-w-[22px] h-[22px] rounded-[7px] flex items-center justify-center px-[6px] text-[11px] font-bold"
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

        {/* ── Main Row: List (col-2) + Sidebar (col-1) ── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

          {/* Assignments list — spans 2 cols */}
          <div className="xl:col-span-2 space-y-3">
            {loading ? (
              <div className="bg-white rounded-[22px] py-16 flex flex-col items-center"
                style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                <Loader2 className="w-10 h-10 animate-spin" style={{ color: B1 }} />
                <p className="text-[13px] font-medium mt-3" style={{ color: T4 }}>Loading assignments…</p>
              </div>
            ) : desktopList.length === 0 ? (
              <div className="bg-white rounded-[26px] py-14 flex flex-col items-center text-center relative overflow-hidden px-6"
                style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                <div className="absolute -top-[60px] -right-[50px] w-[220px] h-[220px] rounded-full pointer-events-none"
                  style={{ background: "radial-gradient(circle, rgba(0,85,255,0.05) 0%, transparent 70%)" }} />
                <div className="w-[88px] h-[88px] rounded-[28px] flex items-center justify-center mb-5 relative z-10"
                  style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 6px 22px rgba(0,85,255,0.42), 0 2px 6px rgba(0,85,255,0.22), 0 0 0 10px rgba(0,85,255,0.08)" }}>
                  <FileCheck className="w-10 h-10 text-white" strokeWidth={2} />
                </div>
                <div className="text-[22px] font-bold mb-2 relative z-10" style={{ color: T1, letterSpacing: "-0.5px" }}>
                  {activeTab === 0 ? "All Caught Up!" : activeTab === 1 ? "Nothing submitted yet" : "No overdue items"}
                </div>
                <div className="text-[14px] font-normal leading-[1.6] max-w-[360px] relative z-10" style={{ color: T3 }}>
                  {activeTab === 0 ? "No pending assignments right now. New tasks will appear here when added by your teacher." :
                   activeTab === 1 ? "Once you submit an assignment, it'll show here." :
                                     "Great — nothing past its deadline. Keep it up!"}
                </div>
              </div>
            ) : (
              desktopList.map((a: any, idx: number) => {
                const mySub = getSub(a.id);
                const accent = getRowAccentD(idx);
                const tag = tagForD(a);
                const d = parseDueD(a);
                // Whole-row activation: completed → opens uploaded file; open
                // → starts submission. Inner buttons stopPropagation so they
                // keep working independently.
                const handleRowClick = () => {
                  if (mySub?.fileUrl) { window.open(mySub.fileUrl, "_blank", "noopener,noreferrer"); return; }
                  if (!mySub) { setSelectedTask(a); setInstantFeedback(null); setUploadFile(null); setStudentNote(""); setIsSubmitOpen(true); }
                };
                return (
                  <div key={a.id}
                    role="button"
                    tabIndex={0}
                    aria-label={mySub ? `View submission for ${a.title || "assignment"}` : `Submit ${a.title || "assignment"}`}
                    onClick={handleRowClick}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleRowClick(); } }}
                    className="bg-white rounded-[20px] p-5 flex items-center gap-5 relative overflow-hidden transition-all hover:-translate-y-[1px] hover:shadow-lg cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                    style={{ boxShadow: SH, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                    <div className="absolute left-0 top-0 bottom-0 w-[4px] rounded-l-[2px]" style={{ background: accent.bar }} />

                    <div className="w-[52px] h-[52px] rounded-[16px] flex items-center justify-center shrink-0"
                      style={{ background: accent.ico, boxShadow: accent.icoSh }}>
                      <FileText className="w-[22px] h-[22px] text-white" strokeWidth={2.2} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-[6px]">
                        <div className="text-[15px] font-bold truncate" style={{ color: T1, letterSpacing: "-0.2px" }}>{a.title || "Assignment"}</div>
                        <div className="px-[10px] py-[3px] rounded-full text-[10px] font-bold shrink-0 tracking-[0.02em]"
                          style={{ background: tag.bg, color: tag.color, border: `0.5px solid ${tag.border}` }}>
                          {tag.label}
                        </div>
                      </div>
                      {a.description && (
                        <div className="text-[12px] truncate mb-[6px]" style={{ color: T3 }}>{a.description}</div>
                      )}
                      <div className="flex items-center gap-4 flex-wrap">
                        {a.teacherName && (
                          <div className="flex items-center gap-[5px] text-[12px] font-medium" style={{ color: T3 }}>
                            <User className="w-[12px] h-[12px]" strokeWidth={2.3} />
                            <span className="truncate max-w-[180px]">{a.teacherName}</span>
                          </div>
                        )}
                        {d && (
                          <div className="flex items-center gap-[5px] text-[12px] font-medium" style={{ color: T3 }}>
                            <Clock className="w-[12px] h-[12px]" strokeWidth={2.3} />
                            Due {MONTHS_D[d.getMonth()]} {d.getDate()}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {mySub ? (
                        <div className="flex items-center gap-2 px-4 py-[10px] rounded-[14px]"
                          style={{ background: "rgba(0,200,83,0.08)", border: "0.5px solid rgba(0,200,83,0.22)" }}>
                          <CheckCircle2 className="w-[14px] h-[14px]" style={{ color: GREEN }} strokeWidth={2.5} />
                          <span className="text-[12px] font-bold" style={{ color: "#007830" }}>Handed In</span>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); setHintsTask(a); setHintDoubt(""); setHints([]); setHintIndex(0); setIsHintsOpen(true); }}
                            className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0 transition-transform hover:scale-105"
                            style={{ background: "rgba(255,136,0,0.10)", border: "0.5px solid rgba(255,136,0,0.22)" }}
                            title="Get AI Hints"
                            aria-label="Get AI Hints"
                          >
                            <Lightbulb className="w-4 h-4" style={{ color: ORANGE }} strokeWidth={2.2} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedTask(a); setInstantFeedback(null); setUploadFile(null); setStudentNote(""); setIsSubmitOpen(true); }}
                            className="h-10 px-5 rounded-[12px] flex items-center gap-2 text-[13px] font-bold text-white transition-transform hover:scale-[1.02]"
                            style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: SH_BTN, letterSpacing: "-0.1px" }}
                          >
                            <Upload className="w-[14px] h-[14px]" strokeWidth={2.3} /> Submit
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">

            {/* Upcoming Deadlines */}
            {!loading && upcomingD.length > 0 && (
              <div className="bg-white rounded-[22px] px-5 py-5"
                style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
                <div className="flex items-center justify-between mb-4">
                  <div className="text-[15px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Upcoming Deadlines</div>
                  <button onClick={() => setActiveTab(0)} className="text-[12px] font-bold" style={{ color: B1 }}>See all</button>
                </div>
                {upcomingD.map((x: any, i: number, arr: any[]) => {
                  const a = x.a;
                  const d: Date = x.d;
                  const days = daysUntilD(d);
                  const urgent = days <= 3;
                  const openSubmitDesktop = () => { setSelectedTask(a); setInstantFeedback(null); setUploadFile(null); setStudentNote(""); setIsSubmitOpen(true); };
                  return (
                    <div key={a.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Submit ${a.title || "assignment"}, due in ${days} days`}
                      className="flex items-center gap-3 py-3 cursor-pointer transition-colors hover:bg-[#F5F9FF] rounded-[12px] -mx-2 px-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0055FF]/40"
                      style={{ borderBottom: i < arr.length - 1 ? `0.5px solid ${SEP}` : "none" }}
                      onClick={openSubmitDesktop}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSubmitDesktop(); } }}>
                      <div className="w-[46px] h-[46px] rounded-[14px] flex flex-col items-center justify-center gap-[1px] shrink-0"
                        style={{
                          background: urgent ? "linear-gradient(135deg, #FF6600, #FFAA33)" : `linear-gradient(135deg, ${B1}, ${B2})`,
                          boxShadow: urgent ? "0 3px 10px rgba(255,102,0,0.24)" : "0 3px 10px rgba(0,85,255,0.28)"
                        }}>
                        <div className="text-[17px] font-bold text-white leading-none">{d.getDate()}</div>
                        <div className="text-[8px] font-bold uppercase tracking-[0.08em]" style={{ color: "rgba(255,255,255,0.65)" }}>{MONTHS_D[d.getMonth()]}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-bold truncate" style={{ color: T1, letterSpacing: "-0.2px" }}>{a.title || "Assignment"}</div>
                        <div className="text-[11px] mt-0.5 truncate" style={{ color: T3 }}>
                          {a.teacherName || "Teacher"}
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

            {/* Summary Dark Card */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Open reports page for term summary"
              onClick={() => navigate("/reports")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/reports"); } }}
              className="rounded-[22px] px-6 py-6 relative overflow-hidden cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              style={{
                background: "linear-gradient(140deg, #001888 0%, #0033CC 48%, #0055FF 100%)",
                boxShadow: "0 8px 30px rgba(0,51,204,0.34), 0 0 0 0.5px rgba(255,255,255,0.14)",
              }}>
              <div className="absolute -top-10 -right-7 w-[200px] h-[200px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(255,255,255,0.14) 0%, transparent 65%)" }} />
              <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
                backgroundSize: "24px 24px"
              }} />
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] mb-2 relative z-10" style={{ color: "rgba(255,255,255,0.50)" }}>Term Summary</div>
              <div className="text-[19px] font-bold mb-5 relative z-10 text-white" style={{ letterSpacing: "-0.3px" }}>Assignment Overview</div>
              <div className="grid grid-cols-3 rounded-[16px] overflow-hidden relative z-10" style={{ gap: "1px", background: "rgba(255,255,255,0.12)" }}>
                <div className="py-4 px-3 text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div className="text-[26px] font-bold text-white leading-none mb-1" style={{ letterSpacing: "-0.6px" }}>{pendingListD.length}</div>
                  <div className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.42)" }}>Pending</div>
                </div>
                <div className="py-4 px-3 text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div className="text-[26px] font-bold text-white leading-none mb-1" style={{ letterSpacing: "-0.6px" }}>{completedListD.length}</div>
                  <div className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.42)" }}>Done</div>
                </div>
                <div className="py-4 px-3 text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div className="text-[26px] font-bold text-white leading-none mb-1" style={{ letterSpacing: "-0.6px" }}>{overdueListD.length}</div>
                  <div className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: "rgba(255,255,255,0.42)" }}>Overdue</div>
                </div>
              </div>
            </div>

            {/* AI Tips Card — info-only (describes how to use the lightbulb icon). */}
            <div className="bg-white rounded-[22px] px-5 py-5 relative overflow-hidden transition-all hover:shadow-lg"
              style={{ boxShadow: SH_LG, border: "0.5px solid rgba(0,85,255,0.10)" }}>
              <div className="absolute -top-[20px] -right-[20px] w-[120px] h-[120px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(255,136,0,0.06) 0%, transparent 70%)" }} />
              <div className="flex items-center gap-2 mb-3 relative z-10">
                <div className="w-9 h-9 rounded-[12px] flex items-center justify-center"
                  style={{ background: `linear-gradient(135deg, ${ORANGE}, #FFAA33)`, boxShadow: "0 3px 10px rgba(255,136,0,0.28)" }}>
                  <Sparkles className="w-4 h-4 text-white" strokeWidth={2.3} />
                </div>
                <div className="text-[14px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>AI Hints Available</div>
              </div>
              <div className="text-[12px] leading-[1.55] font-normal relative z-10" style={{ color: T3 }}>
                Stuck on an assignment? Tap the <Lightbulb className="w-3 h-3 inline mx-[2px]" style={{ color: ORANGE }} /> bulb icon next to any task to get Socratic-style AI hints — guides you without giving the answer.
              </div>
            </div>

          </div>
        </div>
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

        {/* SUBMISSION CENTER PANEL — Bright Blue Apple UI */}
        <Sheet open={isSubmitOpen} onOpenChange={setIsSubmitOpen}>
          <SheetContent side="right" className="w-full sm:max-w-xl p-0 border-0" style={{ background: BG }}>
            <div className="h-full flex flex-col" style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}>
              {/* Hero header */}
              <div className="px-8 pt-8 pb-7 text-white text-left relative overflow-hidden"
                style={{ background: "linear-gradient(140deg, #001888 0%, #0033CC 48%, #0055FF 100%)" }}>
                <div className="absolute -top-12 -right-8 w-[240px] h-[240px] rounded-full pointer-events-none"
                  style={{ background: "radial-gradient(circle, rgba(255,255,255,0.14) 0%, transparent 65%)" }} />
                <div className="absolute inset-0 pointer-events-none" style={{
                  backgroundImage: "linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px)",
                  backgroundSize: "24px 24px"
                }} />
                <SheetHeader className="text-left relative z-10">
                  <SheetTitle className="text-white text-[30px] font-bold tracking-tight leading-none mb-2" style={{ letterSpacing: "-0.7px" }}>
                    Submit Assignment
                  </SheetTitle>
                  <SheetDescription className="font-bold uppercase tracking-[0.10em] text-[10px]" style={{ color: "rgba(255,255,255,0.55)" }}>
                    ID: {studentData?.id?.substring(0, 10)}
                  </SheetDescription>
                </SheetHeader>
              </div>

              <div className="flex-1 px-7 py-7 space-y-6 overflow-y-auto" style={{ background: BG }}>
                {/* Target task */}
                <div className="bg-white rounded-[24px] px-6 py-5"
                  style={{ boxShadow: SH, border: `0.5px solid ${BLUE_BDR}` }}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.10em] mb-2" style={{ color: T4 }}>Target Task</p>
                  <h4 className="text-[19px] font-bold" style={{ color: T1, letterSpacing: "-0.4px" }}>{selectedTask?.title}</h4>
                </div>

                {/* File upload */}
                <div className="space-y-3 text-left">
                  <label className="text-[10px] font-bold uppercase tracking-[0.10em] ml-1 block" style={{ color: T4 }}>
                    Academic Artifact (PDF/JPG)
                  </label>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full px-6 py-10 rounded-[26px] cursor-pointer flex flex-col items-center justify-center text-center transition-all hover:-translate-y-0.5 hover:shadow-lg"
                    style={{
                      background: "white",
                      border: "1.5px dashed rgba(0,85,255,0.25)",
                      boxShadow: SH,
                      transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)"
                    }}>
                    <input type="file" ref={fileInputRef} className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.txt" onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setUploadFile(file);
                      if (file && selectedTask) generateInstantFeedback(selectedTask);
                    }} />
                    {uploadFile ? (
                      <div className="flex items-center gap-3 px-4 py-3 rounded-[14px] animate-in zoom-in-95 w-full"
                        style={{ background: BG, border: `0.5px solid ${BLUE_BDR}` }}>
                        <div className="w-12 h-12 rounded-[14px] flex items-center justify-center shrink-0"
                          style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 2px 8px rgba(0,85,255,0.30)" }}>
                          <FileText className="w-5 h-5 text-white" />
                        </div>
                        <p className="text-[14px] font-bold flex-1 truncate text-left" style={{ color: T1 }}>{uploadFile.name}</p>
                        <button onClick={(e) => { e.stopPropagation(); setUploadFile(null); }} className="p-2" style={{ color: RED }} aria-label="Remove file">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-16 h-16 rounded-[18px] flex items-center justify-center"
                          style={{ background: `linear-gradient(135deg, ${B1}, ${B2})`, boxShadow: "0 4px 14px rgba(0,85,255,0.34)" }}>
                          <Upload className="w-7 h-7 text-white" strokeWidth={2.2} />
                        </div>
                        <p className="text-[15px] font-bold" style={{ color: T2, letterSpacing: "-0.2px" }}>Click to choose file</p>
                        <p className="text-[12px]" style={{ color: T3 }}>PDF, JPG, PNG, DOC up to 10 MB</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* AI Pre-Submission Feedback */}
                {(generatingFeedback || instantFeedback) && (
                  <div className="rounded-[24px] overflow-hidden"
                    style={{ boxShadow: SH, border: `0.5px solid ${BLUE_BDR}` }}>
                    <div className="px-6 py-3 flex items-center gap-2"
                      style={{ background: "linear-gradient(135deg, #001888 0%, #0033CC 50%, #0055FF 100%)" }}>
                      <Sparkles className="w-4 h-4 text-white" />
                      <span className="text-[10px] font-bold text-white uppercase tracking-[0.12em]">AI Pre-Submission Feedback</span>
                    </div>
                    {generatingFeedback ? (
                      <div className="p-5 flex items-center gap-3 bg-white">
                        <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: B1 }} />
                        <p className="text-[12px] font-semibold" style={{ color: T2 }}>Analysing your submission...</p>
                      </div>
                    ) : instantFeedback?.error ? (
                      <div className="p-5 bg-white flex items-start gap-3">
                        <Sparkles className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: RED }} />
                        <p className="text-[12px] font-semibold" style={{ color: RED }}>{instantFeedback.error}</p>
                      </div>
                    ) : instantFeedback && (
                      <div className="p-5 space-y-4 bg-white">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{instantFeedback.emoji || "✨"}</span>
                          <p className="text-[14px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>{instantFeedback.overall}</p>
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                          <div className="rounded-[16px] p-4" style={{ background: "rgba(0,200,83,0.08)", border: "0.5px solid rgba(0,200,83,0.20)" }}>
                            <p className="text-[9px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: "#007830" }}>Strengths</p>
                            {(instantFeedback.strengths || []).map((s: string, i: number) => (
                              <div key={i} className="flex items-start gap-2 mb-1">
                                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: GREEN }} />
                                <p className="text-[12px]" style={{ color: T2 }}>{s}</p>
                              </div>
                            ))}
                          </div>
                          <div className="rounded-[16px] p-4" style={{ background: "rgba(255,136,0,0.08)", border: "0.5px solid rgba(255,136,0,0.22)" }}>
                            <p className="text-[9px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: "#AA5500" }}>Room to Improve</p>
                            {(instantFeedback.improvements || []).map((s: string, i: number) => (
                              <div key={i} className="flex items-start gap-2 mb-1">
                                <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: ORANGE }} />
                                <p className="text-[12px]" style={{ color: T2 }}>{s}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                        {instantFeedback.tip && (
                          <div className="flex items-start gap-2 rounded-[14px] p-3" style={{ background: BG, border: `0.5px solid ${BLUE_BDR}` }}>
                            <Lightbulb className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: B1 }} />
                            <p className="text-[12px] italic" style={{ color: T3 }}>{instantFeedback.tip}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Teacher notes */}
                <div className="space-y-3 text-left">
                  <label className="text-[10px] font-bold uppercase tracking-[0.10em] ml-1 block" style={{ color: T4 }}>
                    Teacher Notes (Optional)
                  </label>
                  <textarea
                    rows={4}
                    value={studentNote}
                    onChange={(e) => setStudentNote(e.target.value)}
                    className="w-full p-5 rounded-[20px] text-[14px] font-medium outline-none transition-all resize-none focus:ring-2 focus:ring-[#0055FF]/30"
                    style={{
                      background: "white",
                      color: T1,
                      border: `0.5px solid ${BLUE_BDR}`,
                      boxShadow: SH,
                    }}
                    placeholder="Add any specific details for your teacher here..."
                  />
                </div>
              </div>

              {/* Submit button */}
              <div className="px-7 pt-4 pb-6" style={{ background: BG, borderTop: `0.5px solid ${SEP}` }}>
                <button
                  onClick={handleOfficialSubmission}
                  disabled={submittingFile || !uploadFile}
                  className="w-full py-5 rounded-[22px] text-[13px] font-bold uppercase tracking-[0.16em] transition-all hover:scale-[1.01] active:scale-[0.97] disabled:opacity-40 flex items-center justify-center gap-3 text-white relative overflow-hidden">
                  <span className="absolute inset-0" style={{
                    background: "linear-gradient(135deg, #001888 0%, #0033CC 50%, #0055FF 100%)",
                    boxShadow: SH_BTN
                  }} />
                  <span className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.13) 0%, transparent 52%)" }} />
                  <span className="relative z-10 flex items-center gap-3">
                    {submittingFile ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Send className="w-4 h-4" /> Submit Assignment</>}
                  </span>
                </button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
  );
};

export default AssignmentsPage;
