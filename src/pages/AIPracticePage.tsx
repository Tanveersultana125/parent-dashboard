import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Loader2, Upload, Plus, Sparkles, Bell, FileText, Image as ImageIcon, MessageSquare, HardDrive, ChevronLeft, BarChart3 } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { ParentAIController } from "../ai/controller/ai-controller";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot, addDoc, serverTimestamp,
} from "firebase/firestore";
import { toast } from "sonner";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg: "#F5F6FA", white: "#fff", ink: "#0B1F3A", ink2: "#475569", ink3: "#94a3b8",
  bdr: "#e2e8f0", s1: "#f1f5f9", s2: "#e2e8f0",
  blue: "#3B5BDB", blBg: "#EDF2FF",
  pur: "#6741D9", plBg: "#F3F0FF", plBdr: "#D0BFFF",
  grn: "#16a34a", glBg: "#f0fdf4",
  red: "#dc2626", rlBg: "#fef2f2",
  amb: "#d97706", alBg: "#fffbeb",
  tea: "#0891b2", tlBg: "#ecfeff",
};

// ── Types ─────────────────────────────────────────────────────────────────────
type View = "home" | "upload" | "configure" | "exam" | "results";

interface Question {
  questionNo: number;
  type: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
}

const DIFFICULTIES = ["Easy", "Medium", "Hard"];
const Q_TYPES = [
  { id: "mcq", label: "MCQ" },
  { id: "fill_blank", label: "Fill Blanks" },
  { id: "true_false", label: "True / False" },
  { id: "short_answer", label: "Short Answer" },
  { id: "mix", label: "Mix" },
];
const Q_COUNTS = [5, 10, 15, 20];
const TIME_LIMITS = [
  { val: 0, label: "No limit" },
  { val: 10, label: "10 min" },
  { val: 15, label: "15 min" },
  { val: 20, label: "20 min" },
  { val: 30, label: "30 min" },
];

// ── Heatmap helpers ───────────────────────────────────────────────────────────
// Use LOCAL date string (not UTC) to avoid timezone shift issues
const toLocalDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const getMonday = (d: Date) => {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
};

const getWeeks = (practiceDates: Set<string>) => {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 182); // ~26 weeks back (6 months for mobile)
  const monday = getMonday(start);
  const weeks: { date: Date; level: number }[][] = [];
  const current = new Date(monday);

  while (current <= today) {
    const week: { date: Date; level: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const dateStr = toLocalDateStr(current);
      const count = practiceDates.has(dateStr) ? 1 : 0;
      week.push({ date: new Date(current), level: count });
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
};

const getStreak = (practiceDates: Set<string>) => {
  let streak = 0;
  const d = new Date();
  while (true) {
    const str = toLocalDateStr(d);
    if (practiceDates.has(str)) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
};

// ── Main component ────────────────────────────────────────────────────────────
const AIPracticePage = () => {
  const { studentData } = useAuth();
  const isMobile = useIsMobile();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── State ───────────────────────────────────────────────────────────────
  const [view, setView] = useState<View>("home");

  // Upload
  const [file, setFile] = useState<File | null>(null);
  const [extractedText, setExtractedText] = useState("");
  const [extractedTopics, setExtractedTopics] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [pageCount, setPageCount] = useState(0);

  // Configure
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("Medium");
  const [questionType, setQuestionType] = useState("mcq");
  const [questionCount, setQuestionCount] = useState(10);
  const [timeLimit, setTimeLimit] = useState(15);

  // Exam
  const [generating, setGenerating] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [examTitle, setExamTitle] = useState("");
  const [answers, setAnswers] = useState<string[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [timerSec, setTimerSec] = useState(0);
  const timerRef = useRef<any>(null);

  // Results
  const [evaluating, setEvaluating] = useState(false);
  const [result, setResult] = useState<any>(null);

  // History + calendar
  const [attempts, setAttempts] = useState<any[]>([]);
  const [practiceDates, setPracticeDates] = useState<Set<string>>(new Set());
  const [documents, setDocuments] = useState<any[]>([]);

  const studentId = studentData?.studentId || studentData?.id || "";
  const studentName = studentData?.name || studentData?.studentName || "Student";

  // ── Firebase listeners ──────────────────────────────────────────────────
  useEffect(() => {
    if (!studentId) return;

    // Attempts (for calendar + history)
    // No orderBy — avoids composite index requirement. Sort client-side.
    const qAttempts = query(
      collection(db, "practice_attempts"),
      where("studentId", "==", studentId),
    );
    const unsub1 = onSnapshot(qAttempts, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() as any }));
      // Sort client-side (newest first)
      data.sort((a, b) => (b.submittedAt?.toMillis?.() || 0) - (a.submittedAt?.toMillis?.() || 0));
      setAttempts(data);

      // Build practice dates set using LOCAL date strings
      const dates = new Set<string>();
      data.forEach(a => {
        const ts = a.submittedAt?.toDate?.();
        if (ts) dates.add(toLocalDateStr(ts));
      });
      setPracticeDates(dates);
    }, (err) => {
      console.error("[Practice] Attempts listener error:", err);
    });

    // Documents (uploaded syllabi)
    // No orderBy — avoids composite index requirement. Sort client-side.
    const qDocs = query(
      collection(db, "practice_documents"),
      where("studentId", "==", studentId),
    );
    const unsub2 = onSnapshot(qDocs, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() as any }));
      docs.sort((a, b) => (b.uploadedAt?.toMillis?.() || 0) - (a.uploadedAt?.toMillis?.() || 0));
      setDocuments(docs);
    }, (err) => {
      console.error("[Practice] Documents listener error:", err);
    });

    return () => { unsub1(); unsub2(); };
  }, [studentId]);

  // Timer
  useEffect(() => {
    if (view === "exam" && timeLimit > 0) {
      setTimerSec(timeLimit * 60);
      timerRef.current = setInterval(() => {
        setTimerSec(prev => {
          if (prev <= 1) { clearInterval(timerRef.current); handleSubmitExam(); return 0; }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timerRef.current);
    }
  }, [view, timeLimit]);

  // ── PDF extraction ──────────────────────────────────────────────────────
  const extractPDF = async (f: File) => {
    const buf = await f.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item: any) => item.str).join(" ") + "\n\n";
    }
    return { text: text.trim(), pages: pdf.numPages };
  };

  const handleFileUpload = async (f: File) => {
    if (f.type !== "application/pdf") { toast.error("Only PDF files are supported."); return; }
    if (f.size > 20 * 1024 * 1024) { toast.error("File must be under 20 MB."); return; }
    setFile(f);
    setExtracting(true);
    try {
      const { text, pages } = await extractPDF(f);
      setExtractedText(text);
      setPageCount(pages);
      // Extract topics (simple: split by common headings/lines)
      const lines = text.split("\n").filter(l => l.trim().length > 3 && l.trim().length < 100);
      const topics = lines
        .filter(l => /^[A-Z]/.test(l.trim()) && !l.includes("  "))
        .slice(0, 15)
        .map(l => l.trim());
      setExtractedTopics(topics.length > 0 ? topics : ["General Topics"]);
      setTopic(topics[0] || "General Topics");

      // Save document to Firebase
      await addDoc(collection(db, "practice_documents"), {
        studentId, fileName: f.name, fileSize: f.size,
        extractedText: text.slice(0, 50000), // limit storage
        extractedTopics: topics,
        pageCount: pages,
        uploadedAt: serverTimestamp(),
      });

      setView("configure");
    } catch (e) {
      console.error(e);
      toast.error("Could not read PDF. Try a different file.");
    }
    setExtracting(false);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFileUpload(f);
  }, []);

  // Use previously uploaded document
  const useDocument = (doc: any) => {
    setExtractedText(doc.extractedText || "");
    setExtractedTopics(doc.extractedTopics || ["General Topics"]);
    setTopic(doc.extractedTopics?.[0] || "General Topics");
    setPageCount(doc.pageCount || 0);
    setFile(null); // no file object, but we have text
    setView("configure");
  };

  // ── Generate exam ───────────────────────────────────────────────────────
  const handleGenerateExam = async () => {
    if (!extractedText) { toast.error("No document text available."); return; }
    setGenerating(true);
    try {
      const res = await ParentAIController.generatePracticeExam({
        text: extractedText, topic, difficulty, questionType, questionCount,
      });
      if (res.status === "success" && res.data?.questions?.length > 0) {
        setQuestions(res.data.questions);
        setExamTitle(res.data.title || `${topic} Practice`);
        setAnswers(new Array(res.data.questions.length).fill(""));
        setCurrentQ(0);
        setView("exam");
      } else {
        toast.error("Could not generate questions. Try again.");
      }
    } catch { toast.error("AI error. Please retry."); }
    setGenerating(false);
  };

  // ── Submit exam ─────────────────────────────────────────────────────────
  const handleSubmitExam = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setView("results");
    setEvaluating(true);
    try {
      const res = await ParentAIController.evaluatePracticeExam({
        questions, answers, studentName,
      });
      const evalData = res.data || { score: 0, total: questions.length, percentage: 0, grade: "-", evaluations: [], weakTopics: [], encouragement: "" };

      // Save attempt to Firebase
      await addDoc(collection(db, "practice_attempts"), {
        studentId, studentName,
        examTitle, topic, difficulty, questionType,
        questionCount: questions.length,
        questions, answers,
        score: evalData.score, total: evalData.total,
        percentage: evalData.percentage, grade: evalData.grade,
        evaluations: evalData.evaluations || [],
        weakTopics: evalData.weakTopics || [],
        timeTaken: timeLimit > 0 ? (timeLimit * 60 - timerSec) : 0,
        submittedAt: serverTimestamp(),
      });

      setResult(evalData);
    } catch {
      setResult({ score: 0, total: questions.length, percentage: 0, grade: "-", evaluations: [], weakTopics: [], encouragement: "Evaluation failed. Your attempt was saved." });
    }
    setEvaluating(false);
  };

  // ── Reset for new exam ──────────────────────────────────────────────────
  const handleNewExam = () => {
    setView("home"); setFile(null); setExtractedText(""); setQuestions([]);
    setAnswers([]); setResult(null); setCurrentQ(0); setTimerSec(0);
  };

  const handleRetry = () => {
    setAnswers(new Array(questions.length).fill(""));
    setCurrentQ(0); setResult(null); setView("exam");
  };

  // ── Computed ────────────────────────────────────────────────────────────
  const streak = useMemo(() => getStreak(practiceDates), [practiceDates]);
  const weeks = useMemo(() => getWeeks(practiceDates), [practiceDates]);
  const bestScore = useMemo(() => {
    if (attempts.length === 0) return 0;
    return Math.max(...attempts.map(a => a.percentage || 0));
  }, [attempts]);

  // ── Shared styles ───────────────────────────────────────────────────────
  const card: React.CSSProperties = { background: C.white, border: `1px solid ${C.bdr}`, borderRadius: 18, overflow: "hidden" };
  const btnPrimary: React.CSSProperties = {
    width: "100%", padding: 14, borderRadius: 14, background: C.pur,
    border: "none", color: "#fff", fontSize: 14, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit",
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  /* ═══════════════════════════════════════════════════════════════
     MOBILE — Navy + Cream Premium UI (HOME view)
     ═══════════════════════════════════════════════════════════════ */
  if (view === "home" && isMobile) {
    // Navy/Cream theme constants
    const NAVY = "#28396C", NAVY2 = "#1E2D57", NAVY3 = "#334880", NAVY4 = "#3D5494";
    const CREAM = "#FDFAF4", CREAM2 = "#F5EFE2", CREAM3 = "#EDE5D4";
    const GREEN = "#2EBC71", GREEN2 = "#1E9A5A";
    const ORANGE = "#F59C2A", GOLD = "#F5C542";
    const T1 = "#1A2340", T3 = "#8892B0", T4 = "#C0C8DC";
    const SEP = "rgba(40,57,108,0.07)";
    const NAVY_BDR = "rgba(40,57,108,0.13)";
    const SH = "0 0 0 0.5px rgba(40,57,108,0.06), 0 2px 8px rgba(40,57,108,0.06), 0 10px 28px rgba(40,57,108,0.08)";
    const SH_LG = "0 0 0 0.5px rgba(40,57,108,0.08), 0 4px 18px rgba(40,57,108,0.09), 0 24px 56px rgba(40,57,108,0.13)";

    // Build flat heatmap cells from weeks (18 cols x 6 rows = 108 cells)
    const flatDays = weeks.flat();
    const recentDays = flatDays.slice(-108);
    const todayStr = toLocalDateStr(new Date());

    return (
      <div className="animate-in fade-in duration-500 -mx-3 -mt-3 md:mx-0 md:mt-0"
        style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: CREAM, minHeight: "100vh" }}>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 pt-3">
          <div className="flex items-center gap-[6px]">
            <div className="w-[6px] h-[6px] rounded-full animate-pulse" style={{ background: GREEN, boxShadow: "0 0 0 2px rgba(46,188,113,0.2)" }} />
            <span className="text-[15px] font-bold tracking-[0.02em]" style={{ color: NAVY }}>EduIntellect</span>
          </div>
          <div className="flex items-center gap-[9px]">
            <div className="w-[34px] h-[34px] rounded-full bg-white flex items-center justify-center relative"
              style={{ boxShadow: "0 1px 4px rgba(40,57,108,0.1), 0 3px 10px rgba(40,57,108,0.06)" }}>
              <Bell className="w-[17px] h-[17px]" style={{ color: "#4A5578" }} strokeWidth={1.8} />
              <span className="absolute top-[1px] right-[1px] w-2 h-2 rounded-full" style={{ background: "#E85555", border: "1.5px solid white" }} />
            </div>
            <div className="w-[34px] h-[34px] rounded-full flex items-center justify-center text-[13px] font-bold text-white"
              style={{ background: `linear-gradient(140deg, ${NAVY2}, ${NAVY4})`, boxShadow: "0 2px 8px rgba(40,57,108,0.28)" }}>
              {studentName?.[0]?.toUpperCase() || "S"}
            </div>
          </div>
        </div>

        {/* ── AI Hero Card ── */}
        <div className="mx-[18px] mt-[18px] rounded-[26px] p-[22px] pb-6 relative overflow-hidden"
          style={{ background: `linear-gradient(140deg, ${NAVY} 0%, ${NAVY3} 60%, #4A5DB8 100%)`, boxShadow: SH_LG }}>
          <div className="absolute -top-[50px] -right-[30px] w-[200px] h-[200px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(255,255,255,0.09) 0%, transparent 65%)" }} />
          <div className="absolute -bottom-[40px] -left-[10px] w-[150px] h-[150px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(91,111,212,0.2) 0%, transparent 65%)" }} />
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.016) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.016) 1px, transparent 1px)",
            backgroundSize: "26px 26px"
          }} />

          <div className="relative z-10">
            <div className="inline-flex items-center gap-[6px] px-3 py-[5px] rounded-full mb-4 text-[10px] font-bold text-white tracking-[0.04em]"
              style={{ background: "rgba(255,255,255,0.14)", border: "0.5px solid rgba(255,255,255,0.22)", backdropFilter: "blur(8px)" }}>
              <Sparkles className="w-3 h-3" />
              AI POWERED · USP Feature
            </div>
            <h1 className="text-[30px] font-bold text-white leading-[1.12] mb-2" style={{ letterSpacing: "-0.8px" }}>
              AI Practice<br />Exams
            </h1>
            <p className="text-[13px] font-normal leading-[1.5] mb-[22px]" style={{ color: "rgba(255,255,255,0.55)" }}>
              Upload syllabus, take AI exams,<br />learn from mistakes.
            </p>

            {/* Stat chips */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: "🔥", val: `${streak}d`, label: "Streak" },
                { icon: <BarChart3 className="w-[22px] h-[22px]" style={{ color: "rgba(255,255,255,0.75)" }} strokeWidth={2} />, val: `${attempts.length}`, label: "Exams" },
                { icon: "⭐", val: bestScore > 0 ? `${bestScore}%` : "—", label: "Best" },
              ].map(({ icon, val, label }) => (
                <div key={label} className="rounded-[18px] py-[14px] px-[10px] flex flex-col items-center gap-[6px] active:opacity-70 transition"
                  style={{ background: "rgba(255,255,255,0.1)", border: "0.5px solid rgba(255,255,255,0.16)", backdropFilter: "blur(8px)" }}>
                  <div className="text-[24px] leading-none flex items-center justify-center h-6">
                    {typeof icon === "string" ? icon : icon}
                  </div>
                  <div className="text-[20px] font-bold text-white leading-none" style={{ letterSpacing: "-0.5px" }}>{val}</div>
                  <div className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.45)" }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Streak Banner ── */}
        <div className="mx-[18px] mt-3 flex items-center gap-[14px] rounded-[18px] px-[18px] py-[14px]"
          style={{ background: "linear-gradient(135deg, rgba(245,197,66,0.08), rgba(245,197,66,0.04))", border: "0.5px solid rgba(245,197,66,0.2)" }}>
          <div className="w-11 h-11 rounded-[14px] flex items-center justify-center text-[22px] shrink-0"
            style={{ background: "rgba(245,197,66,0.12)", border: "0.5px solid rgba(245,197,66,0.22)" }}>
            🔥
          </div>
          <div className="flex-1">
            <div className="text-[15px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>Practice Streak</div>
            <div className="text-[12px] mt-[2px]" style={{ color: T3 }}>
              {streak > 0 ? `Keep the fire going!` : "Start today to build your streak!"}
            </div>
          </div>
          <div className="text-[24px] font-bold shrink-0" style={{ color: GOLD, letterSpacing: "-0.5px" }}>{streak}d</div>
        </div>

        {/* ── Practice Calendar ── */}
        <div className="mx-[18px] mt-4 bg-white rounded-[22px] px-5 py-[18px]" style={{ boxShadow: SH, border: "0.5px solid rgba(40,57,108,0.06)" }}>
          <div className="mb-[6px]">
            <div className="text-[16px] font-bold" style={{ color: T1, letterSpacing: "-0.3px" }}>Practice Calendar</div>
            <div className="text-[12px] mt-[2px]" style={{ color: T3 }}>{practiceDates.size} days practiced this year</div>
          </div>

          {/* Heatmap 18×6 grid */}
          <div className="grid gap-1 mt-4" style={{ gridTemplateColumns: "repeat(18, 1fr)" }}>
            {recentDays.map((day, idx) => {
              const dateStr = toLocalDateStr(day.date);
              const isToday = dateStr === todayStr;
              const isFuture = day.date > new Date();
              let bg = CREAM3;
              if (day.level > 0) bg = NAVY;
              const cellStyle: React.CSSProperties = {
                aspectRatio: "1",
                borderRadius: 3,
                background: isFuture ? "transparent" : bg,
                opacity: isFuture ? 0.2 : 1,
              };
              if (isToday) {
                cellStyle.boxShadow = `0 0 0 2px rgba(40,57,108,0.3), 0 0 0 4px rgba(40,57,108,0.1)`;
                cellStyle.borderRadius = 4;
                cellStyle.background = NAVY;
              }
              return <div key={idx} style={cellStyle} title={day.date.toLocaleDateString()} />;
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-[5px] mt-3 pt-3" style={{ borderTop: `0.5px solid ${SEP}` }}>
            <span className="text-[10px] font-medium" style={{ color: T4 }}>Less</span>
            <div className="flex gap-[3px]">
              {[CREAM3, "rgba(40,57,108,0.15)", "rgba(40,57,108,0.3)", "rgba(40,57,108,0.5)", NAVY].map((c, i) => (
                <div key={i} className="w-3 h-3 rounded-[3px]" style={{ background: c }} />
              ))}
            </div>
            <span className="text-[10px] font-medium" style={{ color: T4 }}>More</span>
          </div>
        </div>

        {/* ── New Practice Exam Button ── */}
        <button onClick={() => setView("upload")}
          className="mx-[18px] mt-4 w-[calc(100%-36px)] rounded-[18px] py-[17px] flex items-center justify-center gap-[9px] text-[15px] font-bold text-white active:scale-[0.97] transition-transform relative overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${NAVY}, ${NAVY2})`, boxShadow: "0 6px 24px rgba(40,57,108,0.28), 0 2px 8px rgba(0,0,0,0.1)", letterSpacing: "-0.1px" }}>
          <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 55%)" }} />
          <Plus className="relative z-10 w-[18px] h-[18px]" strokeWidth={2.2} />
          <span className="relative z-10">New Practice Exam</span>
        </button>

        {/* ── Your Documents (if any) ── */}
        {documents.length > 0 && (
          <>
            <div className="flex items-center gap-2 px-5 pt-[18px] text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: "rgba(40,57,108,0.35)" }}>
              Your Documents
              <div className="flex-1 h-[0.5px]" style={{ background: NAVY_BDR }} />
            </div>
            <div className="mx-[18px] mt-[10px] flex flex-col gap-[9px]">
              {documents.slice(0, 3).map(doc => (
                <div key={doc.id} onClick={() => useDocument(doc)}
                  className="bg-white rounded-[18px] px-4 py-[14px] flex items-center gap-[13px] active:scale-[0.97] transition-transform cursor-pointer"
                  style={{ boxShadow: SH, border: "0.5px solid rgba(40,57,108,0.06)" }}>
                  <div className="w-[42px] h-[42px] rounded-[13px] flex items-center justify-center shrink-0"
                    style={{ background: "rgba(91,111,212,0.10)", border: "0.5px solid rgba(91,111,212,0.20)" }}>
                    <FileText className="w-5 h-5" style={{ color: "#5B6FD4" }} strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-bold truncate" style={{ color: T1, letterSpacing: "-0.2px" }}>{doc.fileName}</div>
                    <div className="text-[11px] mt-[2px]" style={{ color: T3 }}>{doc.pageCount || 0} pages · {doc.extractedTopics?.length || 0} topics</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Recent Exams ── */}
        {attempts.length > 0 && (
          <>
            <div className="flex items-center gap-2 px-5 pt-[18px] text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: "rgba(40,57,108,0.35)" }}>
              Recent Exams
              <div className="flex-1 h-[0.5px]" style={{ background: NAVY_BDR }} />
            </div>
            <div className="mx-[18px] mt-[10px] flex flex-col gap-[9px]">
              {attempts.slice(0, 5).map(a => {
                const pct = a.percentage || 0;
                const passed = pct >= 80;
                const review = pct >= 50 && pct < 80;
                const iconBg = passed ? "rgba(46,188,113,0.10)" : review ? "rgba(245,156,42,0.10)" : "rgba(232,85,85,0.10)";
                const iconBdr = passed ? "rgba(46,188,113,0.20)" : review ? "rgba(245,156,42,0.20)" : "rgba(232,85,85,0.20)";
                const iconColor = passed ? GREEN : review ? ORANGE : "#E85555";
                const chipText = passed ? "Passed" : review ? "Review" : "Retry";
                const pctColor = passed ? GREEN2 : review ? ORANGE : "#E85555";
                return (
                  <div key={a.id} className="bg-white rounded-[18px] px-4 py-[14px] flex items-center gap-[13px] active:scale-[0.97] transition-transform"
                    style={{ boxShadow: SH, border: "0.5px solid rgba(40,57,108,0.06)" }}>
                    <div className="w-[42px] h-[42px] rounded-[13px] flex items-center justify-center shrink-0"
                      style={{ background: iconBg, border: `0.5px solid ${iconBdr}` }}>
                      <BarChart3 className="w-5 h-5" style={{ color: iconColor }} strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-bold truncate" style={{ color: T1, letterSpacing: "-0.2px" }}>{a.examTitle || a.topic || "Practice"}</div>
                      <div className="text-[11px] mt-[2px]" style={{ color: T3 }}>
                        {a.submittedAt?.toDate?.().toLocaleDateString(undefined, { month: "short", day: "numeric" }) || "—"} · {a.total || questionCount} questions
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-[3px]">
                      <div className="text-[17px] font-bold" style={{ color: pctColor, letterSpacing: "-0.4px" }}>{pct}%</div>
                      <div className="px-[9px] py-[3px] rounded-full text-[10px] font-bold"
                        style={{ background: iconBg, color: iconColor, border: `0.5px solid ${iconBdr}` }}>
                        {chipText}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {attempts.length === 0 && documents.length === 0 && (
          <div className="mx-[18px] mt-5 mb-2 text-center py-6">
            <p className="text-[13px]" style={{ color: T3 }}>No exams yet. Tap <strong style={{ color: NAVY }}>New Practice Exam</strong> to begin!</p>
          </div>
        )}

        <div className="h-6" />
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     MOBILE — Navy + Cream Premium UI (UPLOAD view)
     ═══════════════════════════════════════════════════════════════ */
  if (view === "upload" && isMobile) {
    const NAVY = "#28396C", NAVY2 = "#1E2D57";
    const CREAM = "#FDFAF4", CREAM2 = "#F5EFE2", CREAM3 = "#EDE5D4";
    const T1 = "#1A2340", T3 = "#8892B0", T4 = "#C0C8DC";
    const NAVY_BDR = "rgba(40,57,108,0.13)";
    const SH = "0 0 0 0.5px rgba(40,57,108,0.06), 0 2px 8px rgba(40,57,108,0.06), 0 10px 28px rgba(40,57,108,0.08)";

    return (
      <div className="animate-in fade-in duration-500 -mx-3 -mt-3 md:mx-0 md:mt-0"
        style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: CREAM, minHeight: "100vh" }}>

        {/* Back */}
        <div className="flex items-center gap-[6px] px-5 pt-[14px] w-fit cursor-pointer active:opacity-60" onClick={() => setView("home")}>
          <ChevronLeft className="w-[18px] h-[18px]" style={{ color: NAVY }} strokeWidth={2.2} />
          <span className="text-[14px] font-semibold" style={{ color: NAVY, letterSpacing: "-0.1px" }}>Back</span>
        </div>

        {/* Header */}
        <div className="px-5 pt-[18px]">
          <h2 className="text-[24px] font-bold" style={{ color: T1, letterSpacing: "-0.5px" }}>Upload Syllabus</h2>
          <p className="text-[13px] mt-1 font-normal" style={{ color: T3 }}>Upload a PDF of your chapter, notes, or syllabus.</p>
        </div>

        {/* Drop Zone */}
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="mx-[18px] mt-5 rounded-[24px] px-6 py-12 flex flex-col items-center gap-[14px] cursor-pointer active:scale-[0.98] transition-transform relative overflow-hidden"
          style={{
            border: "2px dashed rgba(40,57,108,0.22)",
            background: "linear-gradient(135deg, rgba(40,57,108,0.025), rgba(40,57,108,0.01))",
          }}>
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-[200px] h-[160px] pointer-events-none"
            style={{ background: "radial-gradient(ellipse, rgba(40,57,108,0.04) 0%, transparent 70%)" }} />
          {extracting ? (
            <Loader2 className="w-10 h-10 animate-spin" style={{ color: NAVY }} />
          ) : (
            <div className="w-20 h-20 rounded-[26px] flex items-center justify-center mb-1"
              style={{ background: `linear-gradient(140deg, ${CREAM2}, ${CREAM3})`, border: `0.5px solid ${NAVY_BDR}`, boxShadow: "0 4px 18px rgba(40,57,108,0.08), 0 0 0 6px rgba(40,57,108,0.04)" }}>
              <Upload className="w-9 h-9" style={{ color: NAVY, opacity: 0.55 }} strokeWidth={1.6} />
            </div>
          )}
          <div className="text-[16px] font-bold" style={{ color: NAVY, letterSpacing: "-0.2px" }}>
            {extracting ? "Reading PDF..." : "Drop PDF here"}
          </div>
          <div className="text-[13px] text-center leading-[1.55]" style={{ color: T3 }}>or tap to browse your files</div>
          <div className="text-[11px] font-semibold" style={{ color: T4 }}>Max 20 MB · PDF, DOC, DOCX</div>
          <input ref={fileInputRef} type="file" accept="application/pdf" style={{ display: "none" }}
            onChange={e => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); }} />
        </div>

        {/* Upload Options Grid */}
        <div className="grid grid-cols-2 gap-[10px] mx-[18px] mt-4">
          {[
            { icon: FileText, color: "#E85555", bg: "rgba(232,85,85,0.1)", bdr: "rgba(232,85,85,0.2)", label: "PDF File", sub: "Chapter or notes", action: () => fileInputRef.current?.click() },
            { icon: ImageIcon, color: "#5B6FD4", bg: "rgba(91,111,212,0.10)", bdr: "rgba(91,111,212,0.20)", label: "Scan Photo", sub: "Camera or gallery", action: () => toast.info("Photo scan coming soon") },
            { icon: MessageSquare, color: "#2EBC71", bg: "rgba(46,188,113,0.10)", bdr: "rgba(46,188,113,0.20)", label: "Type Topic", sub: "Enter manually", action: () => toast.info("Type topic coming soon") },
            { icon: HardDrive, color: "#F59C2A", bg: "rgba(245,156,42,0.10)", bdr: "rgba(245,156,42,0.20)", label: "From Drive", sub: "Google Drive", action: () => toast.info("Google Drive coming soon") },
          ].map(({ icon: Icon, color, bg, bdr, label, sub, action }) => (
            <div key={label} onClick={action}
              className="bg-white rounded-[18px] px-[14px] py-4 flex flex-col items-center gap-[9px] cursor-pointer active:scale-[0.95] transition-transform"
              style={{ boxShadow: SH, border: "0.5px solid rgba(40,57,108,0.06)" }}>
              <div className="w-[42px] h-[42px] rounded-[14px] flex items-center justify-center"
                style={{ background: bg, border: `0.5px solid ${bdr}` }}>
                <Icon className="w-[22px] h-[22px]" style={{ color }} strokeWidth={2} />
              </div>
              <div className="text-[13px] font-bold text-center" style={{ color: T1, letterSpacing: "-0.2px" }}>{label}</div>
              <div className="text-[11px] text-center font-normal" style={{ color: T3 }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Format Pills */}
        <div className="flex flex-wrap gap-[7px] mx-[18px] mt-4">
          {[
            { label: "PDF", color: "#E85555", bg: "rgba(232,85,85,0.1)", bdr: "rgba(232,85,85,0.2)" },
            { label: "DOCX", color: "#5B6FD4", bg: "rgba(91,111,212,0.10)", bdr: "rgba(91,111,212,0.20)" },
            { label: "JPG / PNG", color: "#1E9A5A", bg: "rgba(46,188,113,0.10)", bdr: "rgba(46,188,113,0.20)" },
            { label: "TXT", color: NAVY, bg: "rgba(40,57,108,0.08)", bdr: NAVY_BDR },
          ].map(({ label, color, bg, bdr }) => (
            <div key={label} className="flex items-center gap-[5px] px-3 py-[6px] rounded-full text-[11px] font-bold"
              style={{ background: bg, color, border: `0.5px solid ${bdr}` }}>
              <FileText className="w-3 h-3" strokeWidth={2.2} />
              {label}
            </div>
          ))}
        </div>

        {/* Previously uploaded docs */}
        {documents.length > 0 && (
          <>
            <div className="px-5 pt-5 text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: "rgba(40,57,108,0.5)" }}>
              Or use a saved document
            </div>
            <div className="mx-[18px] mt-[10px] flex flex-col gap-[9px]">
              {documents.map(doc => (
                <div key={doc.id} onClick={() => useDocument(doc)}
                  className="bg-white rounded-[18px] px-4 py-[14px] flex items-center gap-[13px] cursor-pointer active:scale-[0.97] transition-transform"
                  style={{ boxShadow: SH, border: "0.5px solid rgba(40,57,108,0.06)" }}>
                  <div className="w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0"
                    style={{ background: "rgba(91,111,212,0.10)", border: "0.5px solid rgba(91,111,212,0.20)" }}>
                    <FileText className="w-[18px] h-[18px]" style={{ color: "#5B6FD4" }} strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold truncate" style={{ color: T1 }}>{doc.fileName}</div>
                    <div className="text-[11px] mt-[2px]" style={{ color: T3 }}>{doc.extractedTopics?.length || 0} topics extracted</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Upload Button */}
        <button onClick={() => fileInputRef.current?.click()} disabled={extracting}
          className="mx-[18px] mt-4 mb-4 w-[calc(100%-36px)] rounded-[18px] py-[17px] flex items-center justify-center gap-[9px] text-[15px] font-bold text-white active:scale-[0.97] disabled:opacity-60 transition-transform relative overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${NAVY}, ${NAVY2})`, boxShadow: "0 6px 24px rgba(40,57,108,0.28)" }}>
          <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 55%)" }} />
          {extracting ? (
            <><Loader2 className="relative z-10 w-[18px] h-[18px] animate-spin" /><span className="relative z-10">Reading PDF...</span></>
          ) : (
            <><Upload className="relative z-10 w-[18px] h-[18px]" strokeWidth={2.2} /><span className="relative z-10">Upload &amp; Generate Exam</span></>
          )}
        </button>

        <div className="h-4" />
      </div>
    );
  }

  // ── HOME VIEW (Desktop) ──────────────────────────────────────────────────
  if (view === "home") return (
    <div style={{ minHeight: "100vh", background: C.bg }}>
      {/* Hero */}
      <div style={{ background: "linear-gradient(145deg, #1e1b4b 0%, #312e81 50%, #4c1d95 100%)", padding: "28px 20px 24px", borderRadius: "0 0 28px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <div style={{ padding: "5px 12px", borderRadius: 20, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.18)", fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.8)", display: "flex", alignItems: "center", gap: 5 }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round"><path d="M5 1L6.5 4H9L7 6L7.8 9L5 7.5L2.2 9L3 6L1 4H3.5Z" /></svg>
            AI POWERED
          </div>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>USP Feature</span>
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#fff", lineHeight: 1.15, marginBottom: 6 }}>
          AI Practice<br />Exams
        </h1>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
          Upload syllabus, take AI exams, learn from mistakes.
        </p>

        {/* Stats row */}
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          {[
            { label: "Streak", val: `${streak}d`, icon: "🔥" },
            { label: "Exams", val: `${attempts.length}`, icon: "📝" },
            { label: "Best", val: bestScore > 0 ? `${bestScore}%` : "—", icon: "⭐" },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, padding: "10px 8px", borderRadius: 14, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", textAlign: "center" }}>
              <p style={{ fontSize: 16, marginBottom: 2 }}>{s.icon}</p>
              <p style={{ fontSize: 16, fontWeight: 700, color: "#fff", margin: 0 }}>{s.val}</p>
              <p style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", marginTop: 2, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "16px 16px 100px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* ── GitHub-style Heatmap Calendar ──────────────────────────── */}
        <div style={card}>
          <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.s2}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: C.ink, margin: 0 }}>Practice Calendar</p>
              <p style={{ fontSize: 11, color: C.ink3, marginTop: 2 }}>{practiceDates.size} days practiced this year</p>
            </div>
            {streak > 0 && (
              <div style={{ padding: "4px 10px", borderRadius: 20, background: "#fef3c7", fontSize: 11, fontWeight: 600, color: "#92400e" }}>
                🔥 {streak} day streak
              </div>
            )}
          </div>
          <div style={{ padding: "12px 16px", overflowX: "auto" }}>
            <div style={{ display: "flex", gap: 2, minWidth: 700 }}>
              {weeks.map((week, wi) => (
                <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {week.map((day, di) => {
                    const today = new Date();
                    const isToday = day.date.toDateString() === today.toDateString();
                    const isFuture = day.date > today;
                    return (
                      <div
                        key={di}
                        title={day.date.toLocaleDateString()}
                        style={{
                          width: 12, height: 12, borderRadius: 3,
                          background: isFuture ? "transparent"
                            : day.level > 0 ? "#22c55e"
                            : "#e2e8f0",
                          border: isToday ? "2px solid #6741D9" : "none",
                          opacity: isFuture ? 0.2 : 1,
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 10, color: C.ink3 }}>
              Less
              <div style={{ width: 10, height: 10, borderRadius: 2, background: "#e2e8f0" }} />
              <div style={{ width: 10, height: 10, borderRadius: 2, background: "#86efac" }} />
              <div style={{ width: 10, height: 10, borderRadius: 2, background: "#22c55e" }} />
              <div style={{ width: 10, height: 10, borderRadius: 2, background: "#15803d" }} />
              More
            </div>
          </div>
        </div>

        {/* ── New Practice Exam Button ──────────────────────────────── */}
        <button onClick={() => setView("upload")} style={btnPrimary}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
            <line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" />
          </svg>
          New Practice Exam
        </button>

        {/* ── Previously Uploaded Documents ─────────────────────────── */}
        {documents.length > 0 && (
          <div style={card}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.s2}` }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: C.ink, margin: 0 }}>Your Documents</p>
              <p style={{ fontSize: 11, color: C.ink3, marginTop: 2 }}>Tap to practice from a saved syllabus</p>
            </div>
            {documents.map((doc, i) => (
              <div key={doc.id} onClick={() => useDocument(doc)} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
                borderBottom: i < documents.length - 1 ? `1px solid ${C.s2}` : "none",
                cursor: "pointer",
              }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: C.plBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={C.pur} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="2" width="10" height="12" rx="1.5" /><line x1="5.5" y1="6" x2="10.5" y2="6" /><line x1="5.5" y1="8.5" x2="9" y2="8.5" />
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: C.ink, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.fileName}</p>
                  <p style={{ fontSize: 10, color: C.ink3, marginTop: 2 }}>{doc.pageCount || 0} pages · {doc.extractedTopics?.length || 0} topics</p>
                </div>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={C.ink3} strokeWidth="1.5" strokeLinecap="round"><polyline points="5,3 9,6.5 5,10" /></svg>
              </div>
            ))}
          </div>
        )}

        {/* ── Recent Attempts ──────────────────────────────────────── */}
        {attempts.length > 0 && (
          <div style={card}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.s2}` }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: C.ink, margin: 0 }}>Recent Attempts</p>
            </div>
            {attempts.slice(0, 5).map((a, i) => {
              const scoreColor = (a.percentage || 0) >= 80 ? C.grn : (a.percentage || 0) >= 50 ? C.amb : C.red;
              return (
                <div key={a.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
                  borderBottom: i < Math.min(attempts.length, 5) - 1 ? `1px solid ${C.s2}` : "none",
                }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: `${scoreColor}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: scoreColor }}>
                    {a.grade || "-"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: C.ink, margin: 0 }}>{a.examTitle || a.topic || "Practice"}</p>
                    <p style={{ fontSize: 10, color: C.ink3, marginTop: 2 }}>
                      {a.score}/{a.total} · {a.difficulty} · {a.submittedAt?.toDate?.().toLocaleDateString() || ""}
                    </p>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: scoreColor }}>{a.percentage || 0}%</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  // ── UPLOAD VIEW ───────────────────────────────────────────────────────────
  if (view === "upload") return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: "20px 16px 100px" }}>
      <button onClick={() => setView("home")} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", marginBottom: 20, fontSize: 13, color: C.pur, fontWeight: 500 }}>
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={C.pur} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><polyline points="8,2 3,6.5 8,11" /></svg>
        Back
      </button>

      <h2 style={{ fontSize: 22, fontWeight: 700, color: C.ink, marginBottom: 6 }}>Upload Syllabus</h2>
      <p style={{ fontSize: 13, color: C.ink3, marginBottom: 20 }}>Upload a PDF of your chapter, notes, or syllabus.</p>

      {/* Dropzone */}
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${C.plBdr}`, borderRadius: 18, padding: "40px 20px",
          background: C.plBg, display: "flex", flexDirection: "column",
          alignItems: "center", gap: 10, cursor: "pointer", textAlign: "center",
        }}
      >
        {extracting ? (
          <Loader2 style={{ width: 32, height: 32, color: C.pur }} className="animate-spin" />
        ) : (
          <div style={{ width: 52, height: 52, borderRadius: 16, background: `${C.pur}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.pur} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="3" width="16" height="18" rx="2" /><line x1="8" y1="9" x2="16" y2="9" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="8" y1="15" x2="12" y2="15" />
            </svg>
          </div>
        )}
        <p style={{ fontSize: 14, fontWeight: 600, color: C.pur }}>{extracting ? "Reading PDF..." : "Drop PDF here"}</p>
        <p style={{ fontSize: 12, color: C.pur, opacity: 0.6 }}>or tap to browse · Max 20 MB</p>
        <input ref={fileInputRef} type="file" accept="application/pdf" style={{ display: "none" }}
          onChange={e => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); }} />
      </div>

      {/* Previously uploaded */}
      {documents.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: C.ink3, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Or use a saved document</p>
          {documents.map(doc => (
            <div key={doc.id} onClick={() => useDocument(doc)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
              background: C.white, border: `1px solid ${C.bdr}`, borderRadius: 14,
              cursor: "pointer", marginBottom: 8,
            }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: C.plBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke={C.pur} strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="2" width="10" height="12" rx="1.5" /><line x1="5.5" y1="6" x2="10.5" y2="6" /></svg>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: C.ink, margin: 0 }}>{doc.fileName}</p>
                <p style={{ fontSize: 10, color: C.ink3, marginTop: 2 }}>{doc.extractedTopics?.length || 0} topics extracted</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── CONFIGURE VIEW ────────────────────────────────────────────────────────
  if (view === "configure") return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: "20px 16px 100px" }}>
      <button onClick={() => setView("upload")} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", marginBottom: 20, fontSize: 13, color: C.pur, fontWeight: 500 }}>
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={C.pur} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><polyline points="8,2 3,6.5 8,11" /></svg>
        Back
      </button>

      <h2 style={{ fontSize: 22, fontWeight: 700, color: C.ink, marginBottom: 6 }}>Configure Exam</h2>
      <p style={{ fontSize: 13, color: C.ink3, marginBottom: 20 }}>
        {file?.name || "Saved document"} · {pageCount} pages · {extractedTopics.length} topics found
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Topic */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: C.ink3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Topic</p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {extractedTopics.map(t => (
              <button key={t} onClick={() => setTopic(t)} style={{
                padding: "8px 14px", borderRadius: 20,
                background: topic === t ? C.pur : C.white,
                color: topic === t ? "#fff" : C.ink2,
                border: topic === t ? "none" : `1px solid ${C.bdr}`,
                fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
              }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Difficulty */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: C.ink3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Difficulty</p>
          <div style={{ display: "flex", gap: 8 }}>
            {DIFFICULTIES.map(d => (
              <button key={d} onClick={() => setDifficulty(d)} style={{
                flex: 1, padding: "10px 0", borderRadius: 12,
                background: difficulty === d ? (d === "Easy" ? C.grn : d === "Medium" ? C.amb : C.red) : C.white,
                color: difficulty === d ? "#fff" : C.ink2,
                border: difficulty === d ? "none" : `1px solid ${C.bdr}`,
                fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}>
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* Question Type */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: C.ink3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Question Type</p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Q_TYPES.map(q => (
              <button key={q.id} onClick={() => setQuestionType(q.id)} style={{
                padding: "8px 14px", borderRadius: 20,
                background: questionType === q.id ? C.blue : C.white,
                color: questionType === q.id ? "#fff" : C.ink2,
                border: questionType === q.id ? "none" : `1px solid ${C.bdr}`,
                fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
              }}>
                {q.label}
              </button>
            ))}
          </div>
        </div>

        {/* Question Count */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: C.ink3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Number of Questions</p>
          <div style={{ display: "flex", gap: 8 }}>
            {Q_COUNTS.map(n => (
              <button key={n} onClick={() => setQuestionCount(n)} style={{
                flex: 1, padding: "10px 0", borderRadius: 12,
                background: questionCount === n ? C.ink : C.white,
                color: questionCount === n ? "#fff" : C.ink2,
                border: questionCount === n ? "none" : `1px solid ${C.bdr}`,
                fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}>
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Time Limit */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: C.ink3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Time Limit</p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {TIME_LIMITS.map(t => (
              <button key={t.val} onClick={() => setTimeLimit(t.val)} style={{
                padding: "8px 14px", borderRadius: 20,
                background: timeLimit === t.val ? C.tea : C.white,
                color: timeLimit === t.val ? "#fff" : C.ink2,
                border: timeLimit === t.val ? "none" : `1px solid ${C.bdr}`,
                fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
              }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Generate button */}
        <button onClick={handleGenerateExam} disabled={generating} style={{ ...btnPrimary, opacity: generating ? 0.7 : 1 }}>
          {generating ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"><path d="M8 2L9.8 6.5H14L10.7 9.2L11.8 14L8 11.5L4.2 14L5.3 9.2L2 6.5H6.2Z" /></svg>
          )}
          {generating ? "Generating..." : "Generate Exam"}
        </button>
      </div>
    </div>
  );

  // ── EXAM VIEW ─────────────────────────────────────────────────────────────
  if (view === "exam") {
    const q = questions[currentQ];
    const timerStr = timeLimit > 0 ? `${Math.floor(timerSec / 60)}:${String(timerSec % 60).padStart(2, "0")}` : "";
    const answered = answers.filter(a => a !== "").length;

    return (
      <div style={{ minHeight: "100vh", background: C.bg }}>
        {/* Exam header */}
        <div style={{ background: C.ink, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>{examTitle}</p>
            <p style={{ fontSize: 13, color: "#fff", fontWeight: 600, marginTop: 2 }}>
              Q {currentQ + 1} of {questions.length}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {timerStr && (
              <div style={{ padding: "6px 12px", borderRadius: 20, background: timerSec < 60 ? "rgba(220,38,38,0.3)" : "rgba(255,255,255,0.1)", fontSize: 13, fontWeight: 600, color: timerSec < 60 ? "#fca5a5" : "#fff" }}>
                ⏱ {timerStr}
              </div>
            )}
            <div style={{ padding: "6px 12px", borderRadius: 20, background: "rgba(255,255,255,0.1)", fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>
              {answered}/{questions.length}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 4, background: C.s2 }}>
          <div style={{ height: "100%", background: C.pur, width: `${((currentQ + 1) / questions.length) * 100}%`, transition: "width 0.3s", borderRadius: "0 2px 2px 0" }} />
        </div>

        <div style={{ padding: "20px 16px 120px" }}>
          {q && (
            <>
              {/* Question type badge */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                <span style={{ padding: "4px 10px", borderRadius: 20, background: C.plBg, fontSize: 10, fontWeight: 600, color: C.pur, textTransform: "uppercase" }}>{q.type.replace("_", " ")}</span>
                <span style={{ fontSize: 11, color: C.ink3 }}>{difficulty}</span>
              </div>

              {/* Question text */}
              <p style={{ fontSize: 16, fontWeight: 600, color: C.ink, lineHeight: 1.5, marginBottom: 20 }}>
                {q.questionText}
              </p>

              {/* Answer area */}
              {(q.type === "mcq" || q.type === "true_false") && q.options.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {q.options.map((opt, oi) => {
                    const selected = answers[currentQ] === opt;
                    return (
                      <button key={oi} onClick={() => {
                        const newAns = [...answers]; newAns[currentQ] = opt; setAnswers(newAns);
                      }} style={{
                        padding: "14px 16px", borderRadius: 14, textAlign: "left",
                        background: selected ? C.pur : C.white,
                        color: selected ? "#fff" : C.ink,
                        border: selected ? "2px solid " + C.pur : `1.5px solid ${C.bdr}`,
                        fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
                        display: "flex", alignItems: "center", gap: 10,
                        transition: "all 0.15s",
                      }}>
                        <span style={{
                          width: 28, height: 28, borderRadius: 8,
                          background: selected ? "rgba(255,255,255,0.2)" : C.s1,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 12, fontWeight: 700, flexShrink: 0,
                          color: selected ? "#fff" : C.ink3,
                        }}>
                          {String.fromCharCode(65 + oi)}
                        </span>
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}

              {(q.type === "fill_blank" || q.type === "short_answer") && (
                <textarea
                  value={answers[currentQ] || ""}
                  onChange={e => { const newAns = [...answers]; newAns[currentQ] = e.target.value; setAnswers(newAns); }}
                  placeholder={q.type === "fill_blank" ? "Type your answer..." : "Write your answer (2-3 sentences)..."}
                  rows={q.type === "short_answer" ? 4 : 2}
                  style={{
                    width: "100%", padding: "14px 16px", borderRadius: 14,
                    border: `1.5px solid ${C.bdr}`, background: C.white,
                    fontSize: 14, color: C.ink, fontFamily: "inherit",
                    outline: "none", resize: "none",
                  }}
                />
              )}
            </>
          )}

          {/* Navigation */}
          <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
            {currentQ > 0 && (
              <button onClick={() => setCurrentQ(currentQ - 1)} style={{
                flex: 1, padding: 14, borderRadius: 14,
                background: C.white, border: `1.5px solid ${C.bdr}`,
                color: C.ink2, fontSize: 14, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
              }}>
                ← Previous
              </button>
            )}
            {currentQ < questions.length - 1 ? (
              <button onClick={() => setCurrentQ(currentQ + 1)} style={{
                flex: 1, padding: 14, borderRadius: 14,
                background: C.pur, border: "none", color: "#fff",
                fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}>
                Next →
              </button>
            ) : (
              <button onClick={handleSubmitExam} style={{
                flex: 1, padding: 14, borderRadius: 14,
                background: C.grn, border: "none", color: "#fff",
                fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}>
                ✓ Submit Exam
              </button>
            )}
          </div>

          {/* Question dots */}
          <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
            {questions.map((_, i) => (
              <div key={i} onClick={() => setCurrentQ(i)} style={{
                width: 24, height: 24, borderRadius: 6,
                background: i === currentQ ? C.pur : answers[i] ? C.grn : C.s2,
                color: i === currentQ || answers[i] ? "#fff" : C.ink3,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 600, cursor: "pointer",
              }}>
                {i + 1}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── RESULTS VIEW ──────────────────────────────────────────────────────────
  if (view === "results") {
    const scoreColor = result ? ((result.percentage || 0) >= 80 ? C.grn : (result.percentage || 0) >= 50 ? C.amb : C.red) : C.ink3;

    return (
      <div style={{ minHeight: "100vh", background: C.bg }}>
        {/* Score hero */}
        <div style={{
          background: evaluating ? C.ink : `linear-gradient(145deg, ${scoreColor}cc, ${scoreColor})`,
          padding: "32px 20px", textAlign: "center",
          borderRadius: "0 0 28px 28px",
        }}>
          {evaluating ? (
            <>
              <Loader2 style={{ width: 40, height: 40, color: "#fff", margin: "0 auto 12px" }} className="animate-spin" />
              <p style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>AI is evaluating your answers...</p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 6 }}>This may take a few seconds</p>
            </>
          ) : result ? (
            <>
              <p style={{ fontSize: 52, fontWeight: 800, color: "#fff", margin: "0 0 4px" }}>{result.percentage || 0}%</p>
              <p style={{ fontSize: 18, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>
                {result.score}/{result.total} correct · Grade {result.grade}
              </p>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: 8, lineHeight: 1.5 }}>
                {result.encouragement || "Keep practicing to improve!"}
              </p>
            </>
          ) : null}
        </div>

        {result && !evaluating && (
          <div style={{ padding: "16px 16px 100px", display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Weak topics */}
            {result.weakTopics?.length > 0 && (
              <div style={{ ...card, padding: "14px 16px" }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: C.red, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>⚠ Weak Areas</p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {result.weakTopics.map((t: string, i: number) => (
                    <span key={i} style={{ padding: "5px 12px", borderRadius: 20, background: C.rlBg, color: C.red, fontSize: 12, fontWeight: 500 }}>{t}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Per-question breakdown */}
            <p style={{ fontSize: 12, fontWeight: 600, color: C.ink3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Question Breakdown</p>
            {(result.evaluations || []).map((ev: any, i: number) => {
              const q = questions[i];
              if (!q) return null;
              return (
                <div key={i} style={{
                  ...card, padding: "14px 16px",
                  borderLeft: `4px solid ${ev.correct ? C.grn : C.red}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 8,
                      background: ev.correct ? C.glBg : C.rlBg,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {ev.correct ? (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={C.grn} strokeWidth="2" strokeLinecap="round"><polyline points="2,7 5.5,11 12,3" /></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={C.red} strokeWidth="2" strokeLinecap="round"><line x1="3" y1="3" x2="11" y2="11" /><line x1="11" y1="3" x2="3" y2="11" /></svg>
                      )}
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: ev.correct ? C.grn : C.red }}>
                      Q{q.questionNo} — {ev.correct ? "Correct" : "Wrong"}
                    </span>
                  </div>

                  <p style={{ fontSize: 13, fontWeight: 500, color: C.ink, lineHeight: 1.5, marginBottom: 8 }}>{q.questionText}</p>

                  {!ev.correct && (
                    <>
                      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                        <div style={{ flex: 1, padding: "8px 10px", borderRadius: 10, background: C.rlBg }}>
                          <p style={{ fontSize: 9, fontWeight: 600, color: C.red, textTransform: "uppercase", marginBottom: 2 }}>Your answer</p>
                          <p style={{ fontSize: 12, color: C.red, margin: 0 }}>{ev.studentAnswer || "—"}</p>
                        </div>
                        <div style={{ flex: 1, padding: "8px 10px", borderRadius: 10, background: C.glBg }}>
                          <p style={{ fontSize: 9, fontWeight: 600, color: C.grn, textTransform: "uppercase", marginBottom: 2 }}>Correct answer</p>
                          <p style={{ fontSize: 12, color: C.grn, margin: 0 }}>{ev.correctAnswer || q.correctAnswer}</p>
                        </div>
                      </div>
                      {ev.explanation && (
                        <div style={{ padding: "10px 12px", borderRadius: 10, background: C.blBg, marginTop: 4 }}>
                          <p style={{ fontSize: 10, fontWeight: 600, color: C.blue, marginBottom: 4, textTransform: "uppercase" }}>💡 Why?</p>
                          <p style={{ fontSize: 12, color: "#1e40af", lineHeight: 1.5, margin: 0 }}>{ev.explanation}</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={handleRetry} style={{
                flex: 1, padding: 14, borderRadius: 14,
                background: C.white, border: `1.5px solid ${C.bdr}`,
                color: C.ink2, fontSize: 14, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
              }}>
                🔄 Try Again
              </button>
              <button onClick={handleNewExam} style={{
                flex: 1, padding: 14, borderRadius: 14,
                background: C.pur, border: "none", color: "#fff",
                fontSize: 14, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
              }}>
                ✨ New Exam
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
};

export default AIPracticePage;