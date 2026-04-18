import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  CheckCircle2, CircleDashed, AlertCircle, Loader2, Lightbulb,
  Sparkles, CalendarDays, BookOpenText, FlaskConical,
  HelpCircle, ChevronRight, Camera, Send, Eye, RefreshCw,
  ClipboardList, Zap, Clock, Sun, Moon, Bell, RotateCw, Image as ImageIcon
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { ParentAIController } from "../ai/controller/ai-controller";
import { useIsMobile } from "@/hooks/use-mobile";

import { callAI } from "../ai/utils/callAI";

// ── Feature tabs ─────────────────────────────────────────────────────────────
type FeatureTab = "strengths" | "study-plan" | "explainer" | "practice" | "doubt";

const FEATURE_TABS: { key: FeatureTab; label: string; icon: any; color: string }[] = [
  { key: "strengths",  label: "Strengths",   icon: CheckCircle2,  color: "from-emerald-500 to-teal-500"   },
  { key: "study-plan", label: "Study Plan",  icon: CalendarDays,  color: "from-indigo-500 to-violet-500"  },
  { key: "explainer",  label: "Explain",     icon: BookOpenText,  color: "from-sky-500 to-cyan-500"       },
  { key: "practice",   label: "Practice",    icon: FlaskConical,  color: "from-amber-500 to-orange-500"   },
  { key: "doubt",      label: "Doubt Solver",icon: HelpCircle,    color: "from-rose-500 to-pink-500"      },
];

// ── Slot helper ──────────────────────────────────────────────────────────────
const SLOTS = [
  { icon: Sun,  label: "Morning",   time: "7:00 – 8:00 AM",  color: "bg-amber-50 border-amber-200",    dot: "bg-amber-400"   },
  { icon: Clock, label: "Afternoon", time: "2:00 – 3:00 PM",  color: "bg-sky-50 border-sky-200",        dot: "bg-sky-400"     },
  { icon: Moon,  label: "Evening",   time: "7:00 – 8:00 PM",  color: "bg-violet-50 border-violet-200",  dot: "bg-violet-400"  },
];

// ── Rule-based fallbacks ─────────────────────────────────────────────────────
function makeStudyPlanFallback(weak: string[], subject: string): any {
  const topics = weak.length > 0 ? weak : [subject, "General Revision"];
  return {
    today: SLOTS.map((s, i) => ({
      slot: s.label, time: s.time,
      topic: topics[i % topics.length] || "Revision",
      activity: i === 0 ? "Read notes and highlight key points" : i === 1 ? "Solve 10 practice problems" : "Quick recall quiz",
      duration: "45 min", reason: "Consistent spaced repetition improves retention."
    })),
    tomorrow: SLOTS.map((s, i) => ({
      slot: s.label, time: s.time,
      topic: topics[(i + 1) % topics.length] || "Review",
      activity: i === 0 ? "Review yesterday's notes" : i === 1 ? "Attempt past-paper questions" : "Teach it back to yourself",
      duration: "40 min", reason: "Active recall is the most effective study method."
    }))
  };
}

function makeExplanationFallback(topic: string): any {
  return {
    simple_explanation: `${topic} is a fundamental concept in your curriculum. It forms the building block for more advanced topics ahead.`,
    real_world_example: `Think of it like everyday objects around you — once you notice the pattern, it appears everywhere!`,
    emoji: "💡",
    remember_points: [
      `${topic} has a clear definition — always start from there.`,
      "Practice applying it in different scenarios to build confidence.",
      "Connect it to something you already know for better retention."
    ]
  };
}

function makePracticeFallback(topic: string): any {
  return {
    questions: [
      { question: `What is the main idea behind ${topic}?`, options: ["A. It describes a process", "B. It is a type of material", "C. It is a historical event", "D. It is a mathematical formula"], correct: "A", explanation: "Understanding the core idea first helps with everything else." },
      { question: `Which of the following is an example related to ${topic}?`, options: ["A. Water cycle", "B. Cell division", "C. Both A and B", "D. Neither"], correct: "C", explanation: "Many natural phenomena share similar patterns." },
      { question: `${topic} is most closely related to which subject area?`, options: ["A. Science", "B. Mathematics", "C. Social Studies", "D. Depends on context"], correct: "D", explanation: "Concepts often span multiple subjects." },
      { question: `If you wanted to demonstrate ${topic}, you would:`, options: ["A. Draw a diagram", "B. Conduct an experiment", "C. Write a definition", "D. All of the above"], correct: "D", explanation: "Multiple approaches reinforce learning." },
      { question: `The best way to remember ${topic} is to:`, options: ["A. Read once", "B. Memorize the definition", "C. Practice with examples", "D. Skip it"], correct: "C", explanation: "Practice is always more effective than passive reading." },
    ]
  };
}

function makeDoubtFallback(doubt: string): any {
  return {
    hints: [
      `Read the question again carefully: "${doubt.substring(0, 60)}..." — what is it really asking?`,
      "Identify the key words or numbers in the problem. What do they represent?",
      "Think about which formula or concept applies here. Have you seen something similar before?",
      "Try working backwards from what the answer should look like.",
      "Almost there! Write out each step one at a time and check if it makes sense."
    ]
  };
}

// ── Main Component ────────────────────────────────────────────────────────────
const ConceptStrengthsPage = () => {
  const { studentData } = useAuth();
  const isMobile = useIsMobile();

  // ── Firestore data ──
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [allScores, setAllScores] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [activeSubject, setActiveSubject] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  // ── Feature state ──
  const [activeFeature, setActiveFeature] = useState<FeatureTab>("strengths");

  // Study Plan
  const [studyPlan, setStudyPlan] = useState<any>(null);
  const [generatingPlan, setGeneratingPlan] = useState(false);

  // Concept Explainer
  const [explainTopic, setExplainTopic] = useState("");
  const [explanation, setExplanation] = useState<any>(null);
  const [generatingExplanation, setGeneratingExplanation] = useState(false);

  // Practice Problems
  const [practiceTopic, setPracticeTopic] = useState("");
  const [questions, setQuestions] = useState<any[]>([]);
  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [revealedAnswers, setRevealedAnswers] = useState<Set<number>>(new Set());

  // Doubt Solver
  const [doubtText, setDoubtText] = useState("");
  const [doubtImageB64, setDoubtImageB64] = useState<string | null>(null);
  const [doubtImagePreview, setDoubtImagePreview] = useState<string | null>(null);
  const [doubtHints, setDoubtHints] = useState<string[]>([]);
  const [hintIndex, setHintIndex] = useState(0);
  const [generatingDoubt, setGeneratingDoubt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Firestore listeners ──────────────────────────────────────────────────
  useEffect(() => {
    if (!studentData?.id || !studentData?.schoolId) return;
    const schoolId = studentData.schoolId;
    setLoading(true);
    const studentEmail = studentData.email?.toLowerCase() || "";

    let snap1Cache: any = null, snap2Cache: any = null;
    let assignUnsub: (() => void) | null = null;

    const subscribeAssignments = (classIds: string[]) => {
      if (assignUnsub) { assignUnsub(); assignUnsub = null; }
      if (classIds.length === 0) { setLoading(false); return; }
      assignUnsub = onSnapshot(
        query(
          collection(db, "assignments"),
          where("schoolId", "==", schoolId),
          where("classId", "in", classIds.slice(0, 10)),
        ),
        (snap) => { setAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() } as any))); setLoading(false); }
      );
    };

    const mergeEnrollments = () => {
      const enrollMap = new Map();
      [...(snap1Cache?.docs || []), ...(snap2Cache?.docs || [])].forEach((d: any) => {
        if (!enrollMap.has(d.id)) enrollMap.set(d.id, { id: d.id, ...d.data() });
      });
      const data = Array.from(enrollMap.values()) as any[];
      const filtered = data.filter((en: any) => (en.subject || en.className || "").toLowerCase() !== "general");
      const sorted = filtered.sort((a: any, b: any) => (a.subject || "").localeCompare(b.subject || ""));
      setEnrollments(sorted);
      setActiveSubject(prev => prev || (sorted[0]?.subject || sorted[0]?.className || ""));
      const classIds = [...new Set([...(snap1Cache?.docs || []), ...(snap2Cache?.docs || [])].map((d: any) => d.data().classId).filter(Boolean))] as string[];
      subscribeAssignments(classIds);
    };

    const u1 = onSnapshot(query(collection(db, "enrollments"), where("schoolId", "==", schoolId), where("studentId", "==", studentData.id)), s => { snap1Cache = s; mergeEnrollments(); });
    const u2 = studentEmail ? onSnapshot(query(collection(db, "enrollments"), where("schoolId", "==", schoolId), where("studentEmail", "==", studentEmail)), s => { snap2Cache = s; mergeEnrollments(); }) : () => {};

    let s1: any = null, s2: any = null, g1: any = null, g2: any = null;
    const processScores = () => {
      const combined = [...(s1?.docs || []), ...(s2?.docs || [])].map(d => ({ id: d.id, ...d.data() as any }));
      const gb = [...(g1?.docs || []), ...(g2?.docs || [])].map(d => {
        const data = d.data();
        return { id: d.id, ...data, testName: data.columnName || "Class Assessment", score: data.mark, maxScore: data.maxMarks || 100, type: "gradebook" };
      });
      setAllScores(Array.from(new Map([...combined, ...gb].map(d => [d.id, d])).values()));
    };

    const u3 = onSnapshot(query(collection(db, "test_scores"), where("schoolId", "==", schoolId), where("studentId", "==", studentData.id)), snap => { s1 = snap; processScores(); });
    const u4 = studentEmail ? onSnapshot(query(collection(db, "test_scores"), where("schoolId", "==", schoolId), where("studentEmail", "==", studentEmail)), snap => { s2 = snap; processScores(); }) : () => {};
    const u5 = onSnapshot(query(collection(db, "gradebook_scores"), where("schoolId", "==", schoolId), where("studentId", "==", studentData.id)), snap => { g1 = snap; processScores(); });
    const u6 = studentEmail ? onSnapshot(query(collection(db, "gradebook_scores"), where("schoolId", "==", schoolId), where("studentEmail", "==", studentEmail)), snap => { g2 = snap; processScores(); }) : () => {};

    let a1: any = null, a2: any = null;
    const processAtt = () => setAttendance(Array.from(new Map([...(a1?.docs || []), ...(a2?.docs || [])].map(d => [d.id, { id: d.id, ...d.data() as any }])).values()));
    const u7 = onSnapshot(query(collection(db, "attendance"), where("schoolId", "==", schoolId), where("studentId", "==", studentData.id)), snap => { a1 = snap; processAtt(); });
    const u8 = studentEmail ? onSnapshot(query(collection(db, "attendance"), where("schoolId", "==", schoolId), where("studentEmail", "==", studentEmail)), snap => { a2 = snap; processAtt(); }) : () => {};

    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); u8(); if (assignUnsub) assignUnsub(); };
  }, [studentData?.id, studentData?.schoolId]);

  useEffect(() => {
    const fetchAI = async () => {
      if (enrollments.length > 0 && !aiAnalysis && !analyzing) {
        setAnalyzing(true);
        try {
          const context = { scores: allScores, assignments, attendance, enrolled_subjects: Array.from(new Set(enrollments.map(e => e.subject || e.className || "General"))) };
          const result = await ParentAIController.getRealConceptMastery(studentData?.name || "Student", context);
          if (result.status === "success") setAiAnalysis(result.data);
        } finally { setAnalyzing(false); }
      }
    };
    fetchAI();
  }, [enrollments, allScores, assignments, attendance]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const studentName = studentData?.name?.split(" ")[0] || "Student";

  const getLocalMasteryData = () => {
    const subjectScores = allScores.filter(s => {
      if (!activeSubject) return true;
      const sub = (s.subject || s.className || "General").toLowerCase();
      const active = activeSubject.toLowerCase();
      return sub === active || sub.includes(active) || active.includes(sub) || sub === "general";
    });
    const strong: { title: string; pct: number }[] = [];
    const developing: { title: string; pct: number }[] = [];
    const attention: { title: string; pct: number }[] = [];
    subjectScores.forEach(s => {
      const pct = s.percentage ?? (s.maxScore ? (s.score / s.maxScore * 100) : 0);
      const item = { title: s.testName || s.title || "Assessment", pct: Math.round(pct) };
      if (pct >= 85) strong.push(item);
      else if (pct >= 70) developing.push(item);
      else attention.push(item);
    });
    return { strong, developing, attention };
  };

  const currentData = getLocalMasteryData();
  const weakTopics = currentData.attention.map(a => a.title);

  const getChartData = () => {
    if (allScores.length === 0) return [];
    const dates = allScores.map(s => {
      const d = s.timestamp?.toDate ? s.timestamp.toDate() : new Date(s.timestamp || s.createdAt || Date.now());
      return d.getTime();
    }).filter(t => !isNaN(t));
    if (dates.length === 0) dates.push(Date.now());
    const minD = new Date(Math.min(...dates));
    const maxD = new Date();
    let startD = new Date(minD.getFullYear(), minD.getMonth(), 1);
    const endD = new Date(maxD.getFullYear(), maxD.getMonth(), 1);
    const diff = (endD.getFullYear() - startD.getFullYear()) * 12 + (endD.getMonth() - startD.getMonth());
    if (diff > 11) startD = new Date(endD.getFullYear(), endD.getMonth() - 11, 1);
    else if (diff === 0) startD = new Date(endD.getFullYear(), endD.getMonth() - 3, 1);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const displayMonths: any[] = [];
    let curr = new Date(startD);
    while (curr <= endD) {
      displayMonths.push({ name: monthNames[curr.getMonth()], index: curr.getMonth(), year: curr.getFullYear() });
      curr.setMonth(curr.getMonth() + 1);
    }
    const subjectList = enrollments.map(e => e.subject || e.className || "General");
    return displayMonths.map(m => {
      const entry: any = { month: m.name };
      subjectList.forEach(sub => {
        const subScores = allScores.filter(s => {
          const sDate = s.timestamp?.toDate ? s.timestamp.toDate() : new Date(s.timestamp || s.createdAt || Date.now());
          const scoreSub = (s.subject || s.className || "General").toLowerCase();
          const activeSub = sub.toLowerCase();
          return sDate.getMonth() === m.index && sDate.getFullYear() === m.year &&
            (scoreSub.includes(activeSub) || activeSub.includes(scoreSub) || scoreSub === "general");
        });
        entry[sub] = subScores.length > 0 ? Math.round(subScores.reduce((a, s) => a + (s.percentage ?? (s.maxScore ? s.score / s.maxScore * 100 : 0)), 0) / subScores.length) : null;
      });
      return entry;
    });
  };

  const chartData = getChartData();
  const subjectList = enrollments.map(e => e.subject || e.className || "General");
  const lineColors = ["#16a34a", "#1e3a8a", "#ef4444", "#f59e0b", "#8b5cf6"];
  const recommendedFocus = currentData.attention[0]?.title
    ? `Spend extra time on ${currentData.attention[0].title.toLowerCase()} and practice problems.`
    : aiAnalysis?.recommended_focus || null;

  // ── AI Feature Handlers ───────────────────────────────────────────────────
  const handleGeneratePlan = async () => {
    setGeneratingPlan(true);
    try {
      const prompt = `Generate a 2-day study plan for a school student named ${studentName}.
Subject focus: ${activeSubject || "General"}
Weak topics: ${weakTopics.slice(0, 4).join(", ") || "General revision"}
Return JSON with keys "today" and "tomorrow", each an array of 3 objects with: slot ("Morning"/"Afternoon"/"Evening"), time, topic, activity, duration, reason.`;
      const result = await callAI(prompt);
      setStudyPlan(result);
    } catch {
      setStudyPlan(makeStudyPlanFallback(weakTopics, activeSubject));
    } finally { setGeneratingPlan(false); }
  };

  const handleExplain = async (topicOverride?: string) => {
    const topic = topicOverride || explainTopic.trim();
    if (!topic) return;
    setExplainTopic(topic);
    setGeneratingExplanation(true);
    setExplanation(null);
    try {
      const prompt = `Explain "${topic}" to a school student (age 10-16) in very simple language.
Use a real-world example they can relate to.
Return JSON: { simple_explanation: "...", real_world_example: "...", emoji: "one emoji", remember_points: ["point1", "point2", "point3"] }`;
      const result = await callAI(prompt);
      setExplanation(result);
    } catch {
      setExplanation(makeExplanationFallback(topic));
    } finally { setGeneratingExplanation(false); }
  };

  const handleGenerateQuestions = async () => {
    const topic = practiceTopic.trim() || activeSubject || "General";
    setGeneratingQuestions(true);
    setQuestions([]);
    setSelectedAnswers({});
    setRevealedAnswers(new Set());
    try {
      const prompt = `Generate exactly 5 multiple-choice questions about "${topic}" for a school student.
Make questions progressively harder (easy → medium → hard).
Return JSON: { questions: [{ question: "...", options: ["A. ...", "B. ...", "C. ...", "D. ..."], correct: "A", explanation: "..." }] }`;
      const result = await callAI(prompt);
      setQuestions(result.questions || []);
    } catch {
      setQuestions(makePracticeFallback(topic).questions);
    } finally { setGeneratingQuestions(false); }
  };

  const handleDoubtSubmit = async () => {
    if (!doubtText.trim() && !doubtImageB64) return;
    setGeneratingDoubt(true);
    setDoubtHints([]);
    setHintIndex(0);
    try {
      if (doubtImageB64) {
        const prompt = `This student has a homework or exam question. Guide them step by step WITHOUT directly solving it. Use the Socratic method — ask leading questions and give progressive hints. Format as numbered hints (1. ... 2. ... 3. ... 4. ... 5. ...)`;
        const text = await callAI(prompt, { jsonMode: false, imageBase64: doubtImageB64 });
        const hints = text.split(/\n+/).filter((l: string) => /^\d+\./.test(l.trim())).map((l: string) => l.replace(/^\d+\.\s*/, ""));
        setDoubtHints(hints.length > 0 ? hints : [text]);
      } else {
        const prompt = `A school student has this doubt: "${doubtText}"
Guide them step by step WITHOUT giving the final answer. Use progressive hints (Socratic method).
Return JSON: { hints: ["hint1 (gentle nudge)", "hint2", "hint3", "hint4", "hint5 (near solution)"] }`;
        const result = await callAI(prompt);
        setDoubtHints(result.hints || []);
      }
    } catch {
      setDoubtHints(makeDoubtFallback(doubtText).hints);
    } finally { setGeneratingDoubt(false); }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reject files > 4MB — OpenAI token limit and network protection
    const MAX_SIZE_MB = 4;
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast.error(`Image too large. Please upload a photo under ${MAX_SIZE_MB}MB.`);
      e.target.value = "";
      return;
    }
    // Only allow image types
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files are supported.");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      setDoubtImagePreview(result);
      setDoubtImageB64(result.split(",")[1]);
      setDoubtText("");
    };
    reader.readAsDataURL(file);
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-[70vh] flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-3" />
        <p className="text-xs text-slate-400 font-semibold">Loading concept data...</p>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     MOBILE — Navy + Cream Premium UI
     ═══════════════════════════════════════════════════════════════ */
  if (isMobile) {
    const NAVY = "#28396C", NAVY2 = "#1E2D57", NAVY4 = "#3D5494";
    const CREAM = "#FDFAF4", CREAM2 = "#F5EFE2", CREAM3 = "#EDE5D4";
    const GREEN = "#2EBC71", GREEN2 = "#1E9A5A";
    const ORANGE = "#F59C2A";
    const RED = "#E85555";
    const INDIGO = "#5B6FD4";
    const TEAL = "#2AACBC";
    const PINK = "#E85599";
    const T1 = "#1A2340", T2 = "#4A5578", T3 = "#8892B0", T4 = "#C0C8DC";
    const SEP = "rgba(40,57,108,0.07)";
    const NAVY_BDR = "rgba(40,57,108,0.13)";
    const SH = "0 0 0 0.5px rgba(40,57,108,0.06), 0 2px 8px rgba(40,57,108,0.06), 0 10px 28px rgba(40,57,108,0.08)";

    const tabStyles: Record<FeatureTab, { gradient: string; icon: any; label: string }> = {
      "strengths": { gradient: `linear-gradient(135deg, ${GREEN2}, ${GREEN})`, icon: CheckCircle2, label: "Strengths" },
      "study-plan": { gradient: `linear-gradient(135deg, ${INDIGO}, #4A5CC8)`, icon: CalendarDays, label: "Study Plan" },
      "explainer": { gradient: `linear-gradient(135deg, ${TEAL}, #1A8A9A)`, icon: BookOpenText, label: "Explain" },
      "practice": { gradient: `linear-gradient(135deg, ${ORANGE}, #E88A15)`, icon: FlaskConical, label: "Practice" },
      "doubt": { gradient: `linear-gradient(135deg, ${PINK}, #C03070)`, icon: HelpCircle, label: "Doubt Solver" },
    };

    return (
      <div className="animate-in fade-in duration-500 -mx-3 -mt-3 md:mx-0 md:mt-0"
        style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", background: CREAM, minHeight: "100vh" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-3">
          <div className="flex items-center gap-[6px]">
            <div className="w-[6px] h-[6px] rounded-full animate-pulse" style={{ background: GREEN, boxShadow: "0 0 0 2px rgba(46,188,113,0.2)" }} />
            <span className="text-[15px] font-bold tracking-[0.02em]" style={{ color: NAVY }}>EduIntellect</span>
          </div>
          <div className="flex items-center gap-[9px]">
            <div className="w-[34px] h-[34px] rounded-full bg-white flex items-center justify-center relative"
              style={{ boxShadow: "0 1px 4px rgba(40,57,108,0.1), 0 3px 10px rgba(40,57,108,0.06)" }}>
              <Bell className="w-[17px] h-[17px]" style={{ color: "#4A5578" }} strokeWidth={1.8} />
              <span className="absolute top-[1px] right-[1px] w-2 h-2 rounded-full" style={{ background: RED, border: "1.5px solid white" }} />
            </div>
            <div className="w-[34px] h-[34px] rounded-full flex items-center justify-center text-[13px] font-bold text-white"
              style={{ background: `linear-gradient(140deg, ${NAVY2}, ${NAVY4})`, boxShadow: "0 2px 8px rgba(40,57,108,0.28)" }}>
              {studentName?.[0]?.toUpperCase() || "S"}
            </div>
          </div>
        </div>

        {/* Page Head */}
        <div className="px-5 pt-4">
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] mb-1" style={{ color: "rgba(40,57,108,0.4)" }}>Parent Dashboard</div>
          <div className="text-[23px] font-bold" style={{ color: T1, letterSpacing: "-0.5px" }}>Concept Strengths</div>
          <div className="text-[12px] mt-[3px] font-normal" style={{ color: T3 }}>
            AI-powered learning tools for <strong style={{ color: NAVY, fontWeight: 600 }}>{studentName}</strong>
          </div>
        </div>

        {/* Horizontal Tabs */}
        <div className="pt-[14px] overflow-hidden">
          <div className="flex gap-2 px-5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {FEATURE_TABS.map(tab => {
              const ts = tabStyles[tab.key];
              const Icon = ts.icon;
              const isActive = activeFeature === tab.key;
              return (
                <button key={tab.key} onClick={() => setActiveFeature(tab.key)}
                  className="flex items-center gap-[6px] px-[14px] py-[9px] rounded-[14px] text-[12px] font-bold whitespace-nowrap shrink-0 active:scale-95 transition-transform"
                  style={isActive ? {
                    background: ts.gradient, color: "#fff",
                    border: "0.5px solid transparent",
                    boxShadow: "0 3px 12px rgba(40,57,108,0.22)"
                  } : {
                    background: "#fff", color: T2,
                    border: "0.5px solid rgba(40,57,108,0.08)",
                    boxShadow: "0 1px 4px rgba(40,57,108,0.05)"
                  }}>
                  <Icon className="w-[13px] h-[13px]" strokeWidth={isActive ? 2 : 2.2} />
                  {ts.label}
                </button>
              );
            })}
          </div>
        </div>

        {analyzing && (
          <div className="mx-[18px] mt-3 flex items-center gap-2 px-4 py-2 rounded-[12px]" style={{ background: "rgba(91,111,212,0.08)", border: "0.5px solid rgba(91,111,212,0.18)" }}>
            <Loader2 className="w-[14px] h-[14px] animate-spin" style={{ color: INDIGO }} />
            <span className="text-[11px] font-bold" style={{ color: INDIGO }}>AI syncing...</span>
          </div>
        )}

        {/* ═══ TAB 1: STRENGTHS ═══ */}
        {activeFeature === "strengths" && (
          <>
            {/* Teacher Filter Pills */}
            {enrollments.length > 0 && (
              <div className="flex gap-2 px-5 pt-[14px] flex-wrap">
                {enrollments.map(en => {
                  const name = en.subject || en.className || "General";
                  const isActive = activeSubject === name;
                  return (
                    <button key={en.id || name} onClick={() => setActiveSubject(name)}
                      className="px-[14px] py-[7px] rounded-full text-[12px] font-bold active:scale-95 transition-transform"
                      style={isActive ? {
                        background: NAVY, color: "#fff",
                        boxShadow: "0 3px 10px rgba(40,57,108,0.25)"
                      } : {
                        background: "#fff", color: T2,
                        border: `0.5px solid ${SEP}`,
                        boxShadow: "0 1px 4px rgba(40,57,108,0.05)"
                      }}>
                      {name}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Strong Card */}
            {currentData.strong.length > 0 && (
              <div className="mx-[18px] mt-4 bg-white rounded-[20px] px-[18px] py-4" style={{ boxShadow: SH, border: "0.5px solid rgba(40,57,108,0.06)" }}>
                <div className="flex items-center justify-between mb-[14px]">
                  <div className="flex items-center gap-[9px]">
                    <div className="w-8 h-8 rounded-[10px] flex items-center justify-center" style={{ background: "rgba(46,188,113,0.10)", border: "0.5px solid rgba(46,188,113,0.20)" }}>
                      <CheckCircle2 className="w-4 h-4" style={{ color: GREEN }} strokeWidth={2.5} />
                    </div>
                    <span className="text-[15px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>Strong</span>
                  </div>
                  <span className="text-[15px] font-bold" style={{ color: GREEN2, letterSpacing: "-0.2px" }}>{currentData.strong.length}</span>
                </div>
                {currentData.strong.slice(0, 5).map((item, i) => (
                  <div key={i} className={i < currentData.strong.slice(0, 5).length - 1 ? "mb-3" : ""}>
                    <div className="flex items-center justify-between mb-[6px]">
                      <span className="text-[13px] font-medium" style={{ color: T2 }}>{item.title}</span>
                      <span className="text-[13px] font-bold" style={{ color: GREEN2 }}>{item.pct}%</span>
                    </div>
                    <div className="h-[6px] rounded overflow-hidden" style={{ background: CREAM3 }}>
                      <div className="h-full rounded" style={{ width: `${item.pct}%`, background: `linear-gradient(90deg, ${GREEN2}, ${GREEN})`, transition: "width 1s cubic-bezier(0.4,0,0.2,1)" }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Developing Card */}
            {currentData.developing.length > 0 && (
              <div className="mx-[18px] mt-3 bg-white rounded-[20px] px-[18px] py-4" style={{ boxShadow: SH, border: "0.5px solid rgba(40,57,108,0.06)" }}>
                <div className="flex items-center justify-between mb-[14px]">
                  <div className="flex items-center gap-[9px]">
                    <div className="w-8 h-8 rounded-[10px] flex items-center justify-center" style={{ background: "rgba(245,156,42,0.10)", border: "0.5px solid rgba(245,156,42,0.20)" }}>
                      <CircleDashed className="w-4 h-4" style={{ color: ORANGE }} strokeWidth={2.5} />
                    </div>
                    <span className="text-[15px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>Developing</span>
                  </div>
                  <span className="text-[15px] font-bold" style={{ color: ORANGE, letterSpacing: "-0.2px" }}>{currentData.developing.length}</span>
                </div>
                {currentData.developing.slice(0, 5).map((item, i) => (
                  <div key={i} className={i < currentData.developing.slice(0, 5).length - 1 ? "mb-3" : ""}>
                    <div className="flex items-center justify-between mb-[6px]">
                      <span className="text-[13px] font-medium" style={{ color: T2 }}>{item.title}</span>
                      <span className="text-[13px] font-bold" style={{ color: ORANGE }}>{item.pct}%</span>
                    </div>
                    <div className="h-[6px] rounded overflow-hidden" style={{ background: CREAM3 }}>
                      <div className="h-full rounded" style={{ width: `${item.pct}%`, background: `linear-gradient(90deg, #C87A10, ${ORANGE})`, transition: "width 1s cubic-bezier(0.4,0,0.2,1)" }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Needs Work Card */}
            {currentData.attention.length > 0 && (
              <div className="mx-[18px] mt-3 bg-white rounded-[20px] px-[18px] py-4" style={{ boxShadow: SH, border: "0.5px solid rgba(40,57,108,0.06)" }}>
                <div className="flex items-center justify-between mb-[14px]">
                  <div className="flex items-center gap-[9px]">
                    <div className="w-8 h-8 rounded-[10px] flex items-center justify-center" style={{ background: "rgba(232,85,85,0.09)", border: "0.5px solid rgba(232,85,85,0.18)" }}>
                      <AlertCircle className="w-4 h-4" style={{ color: RED }} strokeWidth={2.5} />
                    </div>
                    <span className="text-[15px] font-bold" style={{ color: T1, letterSpacing: "-0.2px" }}>Needs Work</span>
                  </div>
                  <span className="text-[15px] font-bold" style={{ color: RED, letterSpacing: "-0.2px" }}>{currentData.attention.length}</span>
                </div>
                {currentData.attention.slice(0, 5).map((item, i) => (
                  <div key={i} className={i < currentData.attention.slice(0, 5).length - 1 ? "mb-3" : ""}>
                    <div className="flex items-center justify-between mb-[6px]">
                      <span className="text-[13px] font-medium" style={{ color: T2 }}>{item.title}</span>
                      <span className="text-[13px] font-bold" style={{ color: RED }}>{item.pct}%</span>
                    </div>
                    <div className="h-[6px] rounded overflow-hidden" style={{ background: CREAM3 }}>
                      <div className="h-full rounded" style={{ width: `${item.pct}%`, background: `linear-gradient(90deg, #B82020, ${RED})`, transition: "width 1s cubic-bezier(0.4,0,0.2,1)" }} />
                    </div>
                  </div>
                ))}
                {recommendedFocus && (
                  <div className="mt-[14px] px-[14px] py-3 rounded-[14px] flex items-start gap-[9px]"
                    style={{ background: "linear-gradient(135deg, #FFFBEE, #FFF8E0)", border: "0.5px solid rgba(245,156,42,0.2)" }}>
                    <Lightbulb className="w-4 h-4 shrink-0 mt-[1px]" style={{ color: "#C07A10" }} strokeWidth={2} />
                    <div>
                      <div className="text-[12px] font-bold mb-[3px]" style={{ color: "#C07A10" }}>Recommended Focus</div>
                      <div className="text-[11px] leading-[1.55]" style={{ color: "rgba(0,0,0,0.45)" }}>{recommendedFocus}</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {currentData.strong.length === 0 && currentData.developing.length === 0 && currentData.attention.length === 0 && (
              <div className="mx-[18px] mt-5 text-center py-8">
                <p className="text-[13px]" style={{ color: T3 }}>No assessment data yet.</p>
              </div>
            )}

            {/* Chart */}
            {chartData.length > 0 && subjectList.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-5 pt-[18px] text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: "rgba(40,57,108,0.35)" }}>
                  Mastery Progress
                  <div className="flex-1 h-[0.5px]" style={{ background: NAVY_BDR }} />
                </div>
                <div className="mx-[18px] mt-3 bg-white rounded-[20px] p-[18px]" style={{ boxShadow: SH, border: "0.5px solid rgba(40,57,108,0.06)" }}>
                  <div className="text-[15px] font-bold mb-4" style={{ color: T1, letterSpacing: "-0.3px" }}>Concept Mastery Progress</div>
                  <div style={{ height: 180 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={CREAM3} />
                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: T4 }} />
                        <YAxis tick={{ fontSize: 10, fill: T4 }} domain={[0, 100]} />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${NAVY_BDR}`, fontFamily: "DM Sans" }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        {subjectList.slice(0, 3).map((sub, i) => (
                          <Line key={sub} type="monotone" dataKey={sub} stroke={[GREEN, TEAL, RED, ORANGE, INDIGO][i]} strokeWidth={2.5} dot={{ r: 4, strokeWidth: 2, fill: "#fff" }} connectNulls />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ═══ TAB 2: STUDY PLAN ═══ */}
        {activeFeature === "study-plan" && (
          <>
            <div className="mx-[18px] mt-[18px] bg-white rounded-[22px] p-5" style={{ boxShadow: SH, border: "0.5px solid rgba(40,57,108,0.06)" }}>
              <div className="flex items-start gap-[14px] mb-[18px]">
                <div className="w-[46px] h-[46px] rounded-[15px] flex items-center justify-center shrink-0"
                  style={{ background: "rgba(91,111,212,0.10)", border: "0.5px solid rgba(91,111,212,0.20)" }}>
                  <CalendarDays className="w-[22px] h-[22px]" style={{ color: INDIGO }} strokeWidth={2} />
                </div>
                <div>
                  <div className="text-[16px] font-bold mb-1" style={{ color: T1, letterSpacing: "-0.3px" }}>AI Study Plan Maker</div>
                  <div className="text-[12px] leading-[1.5]" style={{ color: T3 }}>
                    Based on {studentName}'s weak topics — personalised schedule for today &amp; tomorrow.
                  </div>
                </div>
              </div>

              {weakTopics.length > 0 && (
                <>
                  <div className="text-[9px] font-bold uppercase tracking-[0.09em] mb-2" style={{ color: T4 }}>Weak Topics Detected</div>
                  <div className="flex flex-wrap gap-[7px] mb-4">
                    {weakTopics.slice(0, 4).map((t, i) => (
                      <div key={i} className="px-3 py-[6px] rounded-full text-[12px] font-bold"
                        style={{ background: i === 0 ? "rgba(232,85,85,0.09)" : "rgba(245,156,42,0.10)",
                                 color: i === 0 ? RED : "#C07A10",
                                 border: `0.5px solid ${i === 0 ? "rgba(232,85,85,0.18)" : "rgba(245,156,42,0.20)"}` }}>
                        {t}
                      </div>
                    ))}
                  </div>
                </>
              )}

              <button onClick={handleGeneratePlan} disabled={generatingPlan}
                className="w-full py-[15px] rounded-[16px] flex items-center justify-center gap-2 text-[15px] font-bold text-white disabled:opacity-60 active:scale-[0.97] transition-transform relative overflow-hidden"
                style={{ background: `linear-gradient(135deg, ${INDIGO}, #4A5CC8)`, boxShadow: "0 5px 20px rgba(91,111,212,0.3)" }}>
                <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 55%)" }} />
                {generatingPlan ? <Loader2 className="relative z-10 w-4 h-4 animate-spin" /> : <Sparkles className="relative z-10 w-4 h-4" strokeWidth={2.2} />}
                <span className="relative z-10">{generatingPlan ? "Generating..." : studyPlan ? "Regenerate Plan" : "Generate Today's Plan"}</span>
              </button>
            </div>

            {/* Today's Plan */}
            {studyPlan?.today && (
              <>
                <div className="flex items-center gap-2 px-5 pt-[18px] text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: "rgba(40,57,108,0.35)" }}>
                  Today's Plan
                  <div className="flex-1 h-[0.5px]" style={{ background: NAVY_BDR }} />
                </div>
                <div className="mx-[18px] mt-3 bg-white rounded-[20px] px-[18px] py-4 flex flex-col gap-3" style={{ boxShadow: SH, border: "0.5px solid rgba(40,57,108,0.06)" }}>
                  {studyPlan.today.map((slot: any, i: number) => {
                    const isFirst = i === 0, isLast = i === studyPlan.today.length - 1;
                    const priority = isFirst ? "High" : isLast ? "Low" : "Med";
                    const pColor = priority === "High" ? RED : priority === "Med" ? ORANGE : GREEN;
                    const pBg = priority === "High" ? "rgba(232,85,85,0.09)" : priority === "Med" ? "rgba(245,156,42,0.10)" : "rgba(46,188,113,0.10)";
                    const pBdr = priority === "High" ? "rgba(232,85,85,0.18)" : priority === "Med" ? "rgba(245,156,42,0.20)" : "rgba(46,188,113,0.20)";
                    return (
                      <div key={i} className="flex items-center gap-3 px-3 py-[10px] rounded-[13px]"
                        style={{ background: CREAM2, border: `0.5px solid ${SEP}` }}>
                        <div className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0"
                          style={{ background: pBg, border: `0.5px solid ${pBdr}` }}>
                          <Clock className="w-[14px] h-[14px]" style={{ color: pColor }} strokeWidth={2.2} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-bold" style={{ color: T1 }}>{slot.topic} — {slot.activity?.split(" ").slice(0, 3).join(" ")}</div>
                          <div className="text-[11px] mt-[1px]" style={{ color: T3 }}>{slot.time} · {slot.duration}</div>
                        </div>
                        <div className="text-[11px] font-bold px-[9px] py-1 rounded-full"
                          style={{ background: pBg, color: pColor, border: `0.5px solid ${pBdr}` }}>
                          {priority}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* ═══ TAB 3: EXPLAINER ═══ */}
        {activeFeature === "explainer" && (
          <>
            <div className="mx-[18px] mt-[18px] bg-white rounded-[22px] p-5" style={{ boxShadow: SH, border: "0.5px solid rgba(40,57,108,0.06)" }}>
              <div className="flex items-start gap-[14px] mb-[18px]">
                <div className="w-[46px] h-[46px] rounded-[15px] flex items-center justify-center shrink-0"
                  style={{ background: "rgba(42,172,188,0.10)", border: "0.5px solid rgba(42,172,188,0.20)" }}>
                  <BookOpenText className="w-[22px] h-[22px]" style={{ color: TEAL }} strokeWidth={2} />
                </div>
                <div>
                  <div className="text-[16px] font-bold mb-1" style={{ color: T1, letterSpacing: "-0.3px" }}>24/7 Concept Explainer</div>
                  <div className="text-[12px] leading-[1.5]" style={{ color: T3 }}>
                    Type any concept — AI explains it in simple language with a real-world example.
                  </div>
                </div>
              </div>

              <div className="relative mb-[14px]">
                <input type="text" value={explainTopic} onChange={e => setExplainTopic(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleExplain()}
                  placeholder="e.g. Photosynthesis, Fractions, Newton's Law..."
                  className="w-full py-[13px] pl-4 pr-[50px] rounded-[14px] text-[13px] font-normal outline-none"
                  style={{ background: CREAM2, border: `0.5px solid ${SEP}`, color: T1, fontFamily: "DM Sans, sans-serif" }} />
                <button onClick={() => handleExplain()} disabled={generatingExplanation}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-[34px] h-[34px] rounded-[11px] flex items-center justify-center disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${TEAL}, #1A8A9A)` }}>
                  {generatingExplanation ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Send className="w-[14px] h-[14px] text-white" strokeWidth={2.5} />}
                </button>
              </div>

              {weakTopics.length > 0 && (
                <div className="mt-3">
                  <div className="text-[9px] font-bold uppercase tracking-[0.09em] mb-2" style={{ color: T4 }}>Quick Picks — Your Weak Topics</div>
                  <div className="flex flex-wrap gap-[7px]">
                    {weakTopics.slice(0, 3).map((t, i) => (
                      <button key={i} onClick={() => handleExplain(t)}
                        className="px-3 py-[6px] rounded-full text-[12px] font-bold active:scale-95 transition-transform"
                        style={{ background: i === 0 ? "rgba(232,85,85,0.09)" : "rgba(245,156,42,0.10)",
                                 color: i === 0 ? RED : "#C07A10",
                                 border: `0.5px solid ${i === 0 ? "rgba(232,85,85,0.18)" : "rgba(245,156,42,0.20)"}` }}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Explanation Result */}
            {explanation && (
              <div className="mx-[18px] mt-3 bg-white rounded-[22px] p-5" style={{ boxShadow: SH, border: "0.5px solid rgba(40,57,108,0.06)" }}>
                <div className="flex items-start gap-2 mb-3">
                  <span className="text-[22px]">{explanation.emoji || "💡"}</span>
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.09em]" style={{ color: TEAL }}>Simple Explanation</div>
                    <p className="text-[13px] leading-[1.6] mt-1" style={{ color: T1 }}>{explanation.simple_explanation}</p>
                  </div>
                </div>
                {explanation.real_world_example && (
                  <div className="mt-3 px-[14px] py-3 rounded-[14px]" style={{ background: CREAM2, border: `0.5px solid ${SEP}` }}>
                    <div className="text-[9px] font-bold uppercase tracking-[0.09em] mb-1" style={{ color: T3 }}>Real-world Example</div>
                    <p className="text-[12px] leading-[1.55]" style={{ color: T2 }}>{explanation.real_world_example}</p>
                  </div>
                )}
                {explanation.remember_points?.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[9px] font-bold uppercase tracking-[0.09em] mb-2" style={{ color: T3 }}>Remember</div>
                    {explanation.remember_points.map((p: string, i: number) => (
                      <div key={i} className="flex items-start gap-2 mb-2 last:mb-0">
                        <div className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-[1px]"
                          style={{ background: TEAL }}>{i + 1}</div>
                        <p className="text-[12px] leading-[1.55]" style={{ color: T2 }}>{p}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ═══ TAB 4: PRACTICE ═══ */}
        {activeFeature === "practice" && (
          <>
            <div className="mx-[18px] mt-[18px] bg-white rounded-[22px] p-5" style={{ boxShadow: SH, border: "0.5px solid rgba(40,57,108,0.06)" }}>
              <div className="flex items-start gap-[14px] mb-[18px]">
                <div className="w-[46px] h-[46px] rounded-[15px] flex items-center justify-center shrink-0"
                  style={{ background: "rgba(245,156,42,0.10)", border: "0.5px solid rgba(245,156,42,0.20)" }}>
                  <FlaskConical className="w-[22px] h-[22px]" style={{ color: ORANGE }} strokeWidth={2} />
                </div>
                <div>
                  <div className="text-[16px] font-bold mb-1" style={{ color: T1, letterSpacing: "-0.3px" }}>Practice Problem Generator</div>
                  <div className="text-[12px] leading-[1.5]" style={{ color: T3 }}>
                    AI generates 5 dynamic questions on any topic — with answers you can reveal one at a time.
                  </div>
                </div>
              </div>
              <div className="flex gap-[10px] items-center">
                <input type="text" value={practiceTopic} onChange={e => setPracticeTopic(e.target.value)}
                  placeholder={`Topic (e.g. ${activeSubject || "Islamic Read"})`}
                  className="flex-1 py-[13px] px-4 rounded-[14px] text-[13px] outline-none"
                  style={{ background: CREAM2, border: `0.5px solid ${SEP}`, color: T1, fontFamily: "DM Sans, sans-serif" }} />
                <button onClick={handleGenerateQuestions} disabled={generatingQuestions}
                  className="py-[13px] px-4 rounded-[14px] text-[13px] font-bold text-white flex items-center gap-[6px] shrink-0 whitespace-nowrap disabled:opacity-60 active:scale-95 transition-transform"
                  style={{ background: `linear-gradient(135deg, ${ORANGE}, #E88A15)`, boxShadow: "0 4px 14px rgba(245,156,42,0.28)" }}>
                  {generatingQuestions ? <Loader2 className="w-[14px] h-[14px] animate-spin" /> : <RefreshCw className="w-[14px] h-[14px]" strokeWidth={2.2} />}
                  Generate
                </button>
              </div>
            </div>

            {/* Questions */}
            {questions.length > 0 && (
              <div className="mx-[18px] mt-3 flex flex-col gap-3">
                {questions.map((q: any, qi: number) => {
                  const selected = selectedAnswers[qi];
                  const revealed = revealedAnswers.has(qi);
                  return (
                    <div key={qi} className="bg-white rounded-[18px] p-4" style={{ boxShadow: SH, border: "0.5px solid rgba(40,57,108,0.06)" }}>
                      <div className="flex items-start gap-2 mb-3">
                        <div className="w-6 h-6 rounded-[8px] flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                          style={{ background: `linear-gradient(135deg, ${ORANGE}, #E88A15)` }}>{qi + 1}</div>
                        <p className="text-[13px] font-semibold leading-[1.5]" style={{ color: T1 }}>{q.question}</p>
                      </div>
                      <div className="flex flex-col gap-[6px]">
                        {q.options?.map((opt: string, oi: number) => {
                          const letter = opt.charAt(0);
                          const isSelected = selected === letter;
                          const isCorrect = revealed && letter === q.correct;
                          const isWrong = revealed && isSelected && letter !== q.correct;
                          return (
                            <button key={oi} onClick={() => setSelectedAnswers({ ...selectedAnswers, [qi]: letter })} disabled={revealed}
                              className="text-left px-3 py-[10px] rounded-[10px] text-[12px] font-medium transition-colors"
                              style={{
                                background: isCorrect ? "rgba(46,188,113,0.12)" : isWrong ? "rgba(232,85,85,0.12)" : isSelected ? "rgba(245,156,42,0.10)" : CREAM2,
                                color: isCorrect ? GREEN2 : isWrong ? RED : T2,
                                border: `0.5px solid ${isCorrect ? "rgba(46,188,113,0.25)" : isWrong ? "rgba(232,85,85,0.25)" : isSelected ? "rgba(245,156,42,0.25)" : SEP}`,
                              }}>
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                      {!revealed && selected && (
                        <button onClick={() => setRevealedAnswers(new Set([...revealedAnswers, qi]))}
                          className="mt-3 w-full py-[10px] rounded-[12px] text-[12px] font-bold flex items-center justify-center gap-2"
                          style={{ background: CREAM2, color: T2, border: `0.5px solid ${SEP}` }}>
                          <Eye className="w-[13px] h-[13px]" /> Reveal Answer
                        </button>
                      )}
                      {revealed && q.explanation && (
                        <div className="mt-3 px-3 py-[10px] rounded-[10px]" style={{ background: "rgba(42,172,188,0.06)", border: "0.5px solid rgba(42,172,188,0.15)" }}>
                          <div className="text-[10px] font-bold uppercase tracking-[0.08em] mb-1" style={{ color: TEAL }}>Explanation</div>
                          <p className="text-[12px] leading-[1.5]" style={{ color: T2 }}>{q.explanation}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ═══ TAB 5: DOUBT SOLVER ═══ */}
        {activeFeature === "doubt" && (
          <>
            <div className="mx-[18px] mt-[18px] bg-white rounded-[22px] p-5" style={{ boxShadow: SH, border: "0.5px solid rgba(40,57,108,0.06)" }}>
              <div className="flex items-start gap-[14px] mb-[18px]">
                <div className="w-[46px] h-[46px] rounded-[15px] flex items-center justify-center shrink-0"
                  style={{ background: "rgba(232,85,153,0.10)", border: "0.5px solid rgba(232,85,153,0.20)" }}>
                  <HelpCircle className="w-[22px] h-[22px]" style={{ color: PINK }} strokeWidth={2} />
                </div>
                <div>
                  <div className="text-[16px] font-bold mb-1" style={{ color: T1, letterSpacing: "-0.3px" }}>AI Doubt Solver</div>
                  <div className="text-[12px] leading-[1.5]" style={{ color: T3 }}>
                    Type your doubt OR upload a photo. AI guides step by step — teaches, doesn't just answer.
                  </div>
                </div>
              </div>

              {doubtImagePreview && (
                <div className="mb-3 relative rounded-[14px] overflow-hidden" style={{ border: `0.5px solid ${SEP}` }}>
                  <img src={doubtImagePreview} alt="Doubt" className="w-full h-auto max-h-52 object-cover" />
                  <button onClick={() => { setDoubtImagePreview(""); setDoubtImageB64(""); }}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white text-xs font-bold">×</button>
                </div>
              )}

              <textarea value={doubtText} onChange={e => setDoubtText(e.target.value)}
                placeholder="Type your doubt here... e.g. 'I don't understand how to solve simultaneous equations'"
                className="w-full py-[13px] px-4 rounded-[14px] text-[13px] outline-none resize-none min-h-[90px] leading-[1.6]"
                style={{ background: CREAM2, border: `0.5px solid ${SEP}`, color: T1, fontFamily: "DM Sans, sans-serif" }} />

              <div className="flex gap-[10px] mt-3">
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                <button onClick={() => fileInputRef.current?.click()}
                  className="flex-1 py-[13px] rounded-[14px] text-[13px] font-bold flex items-center justify-center gap-[7px] active:scale-95 transition-transform"
                  style={{ background: CREAM2, color: T2, border: `0.5px solid ${SEP}` }}>
                  <Camera className="w-[15px] h-[15px]" strokeWidth={2} />
                  Upload Photo
                </button>
                <button onClick={handleDoubtSubmit} disabled={generatingDoubt || (!doubtText.trim() && !doubtImageB64)}
                  className="flex-1 py-[13px] rounded-[14px] text-[13px] font-bold text-white flex items-center justify-center gap-[7px] disabled:opacity-50 active:scale-95 transition-transform"
                  style={{ background: `linear-gradient(135deg, ${PINK}, #C03070)`, boxShadow: "0 4px 14px rgba(232,85,153,0.28)" }}>
                  {generatingDoubt ? <Loader2 className="w-[15px] h-[15px] animate-spin" /> : <Zap className="w-[15px] h-[15px]" strokeWidth={2.2} />}
                  Get Help
                </button>
              </div>
            </div>

            {/* Hints */}
            {doubtHints.length > 0 && (
              <div className="mx-[18px] mt-3 flex flex-col gap-[10px]">
                {doubtHints.slice(0, hintIndex + 1).map((hint, i) => (
                  <div key={i} className="bg-white rounded-[18px] p-4 flex items-start gap-3" style={{ boxShadow: SH, border: "0.5px solid rgba(40,57,108,0.06)" }}>
                    <div className="w-7 h-7 rounded-[9px] flex items-center justify-center shrink-0 text-[12px] font-bold text-white"
                      style={{ background: `linear-gradient(135deg, ${PINK}, #C03070)` }}>{i + 1}</div>
                    <p className="text-[13px] leading-[1.55]" style={{ color: T2 }}>{hint}</p>
                  </div>
                ))}
                {hintIndex < doubtHints.length - 1 && (
                  <button onClick={() => setHintIndex(hintIndex + 1)}
                    className="mx-auto mt-2 px-4 py-2 rounded-full text-[12px] font-bold flex items-center gap-2"
                    style={{ background: "rgba(232,85,153,0.10)", color: PINK, border: `0.5px solid rgba(232,85,153,0.20)` }}>
                    <ChevronRight className="w-[13px] h-[13px]" />
                    Next Hint ({hintIndex + 2}/{doubtHints.length})
                  </button>
                )}
              </div>
            )}
          </>
        )}

        <div className="h-6" />
      </div>
    );
  }

  // ── Render (Desktop) ──────────────────────────────────────────────────────
  return (
    <div className="animate-in fade-in duration-500 pb-28">

      {/* ── Page Header ── */}
      <div className="mb-6">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.25em] mb-1">Parent Dashboard</p>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Concept Strengths</h1>
        <p className="text-sm text-slate-500 mt-1">AI-powered learning tools for <span className="font-bold text-slate-800">{studentName}</span></p>
      </div>

      {/* ── Feature Tabs ── */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-6 scrollbar-hide">
        {FEATURE_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeFeature === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveFeature(tab.key)}
              className={`flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all ${
                isActive
                  ? `bg-gradient-to-r ${tab.color} text-white shadow-md`
                  : "bg-white border border-slate-100 text-slate-500 hover:border-slate-200"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
        {analyzing && (
          <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-indigo-50 rounded-2xl border border-indigo-100">
            <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
            <span className="text-xs font-bold text-indigo-600">AI syncing...</span>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 1: STRENGTHS (existing)
      ══════════════════════════════════════════════════════════════════════ */}
      {activeFeature === "strengths" && (
        <>
          {/* Subject filter tabs */}
          <div className="flex flex-wrap gap-2 mb-6">
            {enrollments.map((en) => {
              const name = en.subject || en.className || "General";
              const isActive = activeSubject === name;
              return (
                <button key={en.id} onClick={() => setActiveSubject(name)}
                  className={`px-4 py-2 rounded-full text-xs font-bold border transition-all ${
                    isActive ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                  }`}>
                  {name}
                </button>
              );
            })}
          </div>

          {/* 3-column mastery grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
            {[
              { label: "Strong", icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-50", bar: "bg-emerald-500", items: currentData.strong },
              { label: "Developing", icon: CircleDashed, color: "text-amber-500", bg: "bg-amber-50", bar: "bg-amber-400", items: currentData.developing },
              { label: "Needs Work", icon: AlertCircle, color: "text-rose-500", bg: "bg-rose-50", bar: "bg-rose-500", items: currentData.attention },
            ].map(({ label, icon: Icon, color, bg, bar, items }) => (
              <div key={label} className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Icon className={`w-5 h-5 ${color}`} />
                  <h3 className="text-sm font-bold text-slate-800">{label}</h3>
                  <span className={`ml-auto text-xs font-black px-2 py-0.5 rounded-full ${bg} ${color}`}>{items.length}</span>
                </div>
                <div className="space-y-3">
                  {items.length === 0 ? (
                    <p className="text-xs text-slate-300 py-6 text-center">No data yet</p>
                  ) : items.map((c, i) => (
                    <div key={i} className="bg-slate-50 rounded-xl p-3.5">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-slate-700 truncate pr-2">{c.title}</p>
                        <span className={`text-xs font-bold ${color}`}>{c.pct}%</span>
                      </div>
                      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div className={`h-full ${bar} rounded-full`} style={{ width: `${c.pct}%` }} />
                      </div>
                    </div>
                  ))}
                  {label === "Needs Work" && recommendedFocus && (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 mt-2">
                      <div className="flex items-center gap-2 mb-1">
                        <Lightbulb className="w-4 h-4 text-amber-500" />
                        <p className="text-xs font-bold text-slate-700">Recommended Focus</p>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">{recommendedFocus}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Trend chart */}
          <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
            <h3 className="text-sm font-bold text-slate-800 mb-5">Concept Mastery Progress</h3>
            {chartData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-slate-300 text-xs">No score data yet</div>
            ) : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 20, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} domain={[50, 100]} />
                    <Tooltip contentStyle={{ borderRadius: "12px", border: "1px solid #f1f5f9", fontSize: 12 }} formatter={(v: any, n: string) => [`${v}%`, n]} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 16 }} />
                    {subjectList.slice(0, 5).map((sub, i) => (
                      <Line key={i} type="monotone" dataKey={sub} stroke={lineColors[i % lineColors.length]} strokeWidth={2}
                        dot={{ r: 4, fill: lineColors[i % lineColors.length], strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 6, strokeWidth: 0 }} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 2: AI STUDY PLAN MAKER
      ══════════════════════════════════════════════════════════════════════ */}
      {activeFeature === "study-plan" && (
        <div className="space-y-5">

          {/* Generate card */}
          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center">
                <CalendarDays className="w-4 h-4 text-indigo-600" />
              </div>
              <h2 className="text-sm font-bold text-slate-800">AI Study Plan Maker</h2>
            </div>
            <p className="text-xs text-slate-400 mb-4 ml-10">Based on {studentName}'s weak topics — personalised schedule for today & tomorrow.</p>

            {weakTopics.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider w-full mb-1">Weak topics detected:</span>
                {weakTopics.slice(0, 5).map((t, i) => (
                  <span key={i} className="text-[11px] font-semibold px-2.5 py-1 bg-rose-50 text-rose-600 rounded-full border border-rose-100">{t}</span>
                ))}
              </div>
            )}

            <button
              onClick={handleGeneratePlan}
              disabled={generatingPlan}
              className="w-full h-11 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60 active:scale-95 transition-all"
            >
              {generatingPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generatingPlan ? "Generating Plan..." : "Generate Today's Plan"}
            </button>
          </div>

          {/* Plan result */}
          {studyPlan && (
            <>
              {[{ key: "today", label: "Today", color: "from-indigo-500 to-violet-500" }, { key: "tomorrow", label: "Tomorrow", color: "from-sky-500 to-cyan-500" }].map(({ key, label, color }) => (
                <div key={key} className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
                  <div className={`bg-gradient-to-r ${color} px-5 py-3 flex items-center gap-2`}>
                    <CalendarDays className="w-4 h-4 text-white" />
                    <h3 className="text-sm font-bold text-white">{label}'s Schedule</h3>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {(studyPlan[key] || []).map((slot: any, i: number) => {
                      const S = SLOTS[i % SLOTS.length];
                      return (
                        <div key={i} className="p-4 flex gap-4 items-start">
                          <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${S.dot}`} style={{ marginTop: 6 }} />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{slot.slot || S.label}</span>
                              <span className="text-[10px] font-semibold text-slate-300">{slot.time || S.time}</span>
                              <span className="ml-auto text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">{slot.duration}</span>
                            </div>
                            <p className="text-sm font-bold text-slate-800 mt-1">{slot.topic}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{slot.activity}</p>
                            {slot.reason && <p className="text-[10px] text-slate-400 mt-1 italic">{slot.reason}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 3: CONCEPT EXPLAINER
      ══════════════════════════════════════════════════════════════════════ */}
      {activeFeature === "explainer" && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-xl bg-sky-100 flex items-center justify-center">
                <BookOpenText className="w-4 h-4 text-sky-600" />
              </div>
              <h2 className="text-sm font-bold text-slate-800">24/7 Concept Explainer</h2>
            </div>
            <p className="text-xs text-slate-400 mb-4 ml-10">Type any concept — AI explains it in simple language with a real-world example.</p>

            <div className="flex gap-2 mb-4">
              <input
                value={explainTopic}
                onChange={e => setExplainTopic(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleExplain()}
                placeholder="e.g. Photosynthesis, Fractions, Newton's Laws..."
                className="flex-1 h-11 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
              <button
                onClick={() => handleExplain()}
                disabled={generatingExplanation || !explainTopic.trim()}
                className="w-11 h-11 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-500 flex items-center justify-center text-white disabled:opacity-50 active:scale-95 transition-all"
              >
                {generatingExplanation ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>

            {/* Quick picks from weak topics */}
            {weakTopics.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Quick picks — your weak topics:</p>
                <div className="flex flex-wrap gap-2">
                  {weakTopics.slice(0, 6).map((t, i) => (
                    <button key={i} onClick={() => handleExplain(t)}
                      className="text-[11px] font-bold px-3 py-1.5 bg-sky-50 text-sky-700 rounded-full border border-sky-100 hover:bg-sky-100 transition-all active:scale-95">
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Explanation result */}
          {generatingExplanation && (
            <div className="flex items-center gap-3 p-5 bg-sky-50 rounded-2xl border border-sky-100">
              <Loader2 className="w-5 h-5 text-sky-500 animate-spin flex-shrink-0" />
              <p className="text-sm text-sky-700 font-medium">Explaining "{explainTopic}"...</p>
            </div>
          )}

          {explanation && !generatingExplanation && (
            <div className="space-y-4">
              {/* Simple explanation */}
              <div className="rounded-2xl overflow-hidden shadow-sm" style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)" }}>
                <div className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-2xl">{explanation.emoji || "💡"}</span>
                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Simple Explanation</span>
                  </div>
                  <p className="text-sm text-slate-200 leading-relaxed">{explanation.simple_explanation}</p>
                </div>
              </div>

              {/* Real-world example */}
              <div className="bg-sky-50 border border-sky-100 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-sky-600" />
                  <span className="text-xs font-bold text-sky-700 uppercase tracking-wider">Real-World Example</span>
                </div>
                <p className="text-sm text-slate-700 leading-relaxed">{explanation.real_world_example}</p>
              </div>

              {/* Remember points */}
              <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <ClipboardList className="w-4 h-4 text-violet-600" />
                  <span className="text-xs font-bold text-violet-700 uppercase tracking-wider">Remember These 3 Points</span>
                </div>
                <div className="space-y-2">
                  {(explanation.remember_points || []).map((point: string, i: number) => (
                    <div key={i} className="flex gap-3 items-start">
                      <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[9px] font-black text-violet-700">{i + 1}</span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{point}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 4: PRACTICE PROBLEM GENERATOR
      ══════════════════════════════════════════════════════════════════════ */}
      {activeFeature === "practice" && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center">
                <FlaskConical className="w-4 h-4 text-amber-600" />
              </div>
              <h2 className="text-sm font-bold text-slate-800">Practice Problem Generator</h2>
            </div>
            <p className="text-xs text-slate-400 mb-4 ml-10">AI generates 5 dynamic questions on any topic — with answers you can reveal one at a time.</p>

            <div className="flex gap-2 mb-4">
              <input
                value={practiceTopic}
                onChange={e => setPracticeTopic(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleGenerateQuestions()}
                placeholder={`Topic (e.g. ${activeSubject || "Fractions"})`}
                className="flex-1 h-11 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
              <button
                onClick={handleGenerateQuestions}
                disabled={generatingQuestions}
                className="h-11 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 flex items-center justify-center gap-2 text-white text-sm font-bold disabled:opacity-50 active:scale-95 transition-all"
              >
                {generatingQuestions ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {generatingQuestions ? "Generating..." : "Generate"}
              </button>
            </div>
          </div>

          {/* Questions */}
          {generatingQuestions && (
            <div className="flex items-center gap-3 p-5 bg-amber-50 rounded-2xl border border-amber-100">
              <Loader2 className="w-5 h-5 text-amber-500 animate-spin flex-shrink-0" />
              <p className="text-sm text-amber-700 font-medium">Generating 5 questions...</p>
            </div>
          )}

          {questions.length > 0 && !generatingQuestions && (
            <div className="space-y-4">
              {questions.map((q, qi) => {
                const selected = selectedAnswers[qi];
                const revealed = revealedAnswers.has(qi);
                const isCorrect = selected === q.correct;
                return (
                  <div key={qi} className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-start gap-3 mb-4">
                      <span className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 text-xs font-black flex items-center justify-center flex-shrink-0">{qi + 1}</span>
                      <p className="text-sm font-semibold text-slate-800 leading-relaxed">{q.question}</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                      {(q.options || []).map((opt: string, oi: number) => {
                        const optKey = opt.charAt(0);
                        const isSelected = selected === optKey;
                        const isCorrectOpt = q.correct === optKey;
                        let optStyle = "border-slate-100 bg-slate-50 text-slate-700";
                        if (selected) {
                          if (isCorrectOpt) optStyle = "border-emerald-300 bg-emerald-50 text-emerald-700";
                          else if (isSelected) optStyle = "border-rose-300 bg-rose-50 text-rose-700";
                        }
                        return (
                          <button key={oi} onClick={() => !selected && setSelectedAnswers(prev => ({ ...prev, [qi]: optKey }))}
                            className={`text-left px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all ${optStyle} ${!selected ? "hover:border-slate-200 active:scale-95" : ""}`}>
                            {opt}
                          </button>
                        );
                      })}
                    </div>

                    {selected && (
                      <div className={`rounded-xl p-3 ${isCorrect ? "bg-emerald-50 border border-emerald-100" : "bg-rose-50 border border-rose-100"}`}>
                        <p className={`text-xs font-bold ${isCorrect ? "text-emerald-700" : "text-rose-700"}`}>
                          {isCorrect ? "✓ Correct!" : `✗ Incorrect — correct answer is ${q.correct}`}
                        </p>
                      </div>
                    )}

                    {!selected && (
                      <button onClick={() => {
                        setRevealedAnswers(prev => new Set([...prev, qi]));
                        setSelectedAnswers(prev => ({ ...prev, [qi]: q.correct }));
                      }} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-all mt-1">
                        <Eye className="w-3.5 h-3.5" />
                        Reveal answer
                      </button>
                    )}

                    {(selected || revealed) && q.explanation && (
                      <p className="text-xs text-slate-500 italic mt-2 leading-relaxed">{q.explanation}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 5: AI DOUBT SOLVER
      ══════════════════════════════════════════════════════════════════════ */}
      {activeFeature === "doubt" && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-xl bg-rose-100 flex items-center justify-center">
                <HelpCircle className="w-4 h-4 text-rose-600" />
              </div>
              <h2 className="text-sm font-bold text-slate-800">AI Doubt Solver</h2>
            </div>
            <p className="text-xs text-slate-400 mb-4 ml-10">Type your doubt OR upload a photo. AI guides step by step — teaches, doesn't just answer.</p>

            {/* Image preview */}
            {doubtImagePreview && (
              <div className="mb-4 relative">
                <img src={doubtImagePreview} alt="Doubt" className="w-full max-h-48 object-contain rounded-xl border border-slate-100 bg-slate-50" />
                <button onClick={() => { setDoubtImagePreview(null); setDoubtImageB64(null); }}
                  className="absolute top-2 right-2 w-7 h-7 bg-white rounded-full border border-slate-200 flex items-center justify-center text-slate-400 hover:text-rose-500 text-xs font-bold shadow-sm">✕</button>
              </div>
            )}

            {/* Text input */}
            {!doubtImagePreview && (
              <textarea
                value={doubtText}
                onChange={e => setDoubtText(e.target.value)}
                placeholder="Type your doubt here... e.g. 'I don't understand how to solve simultaneous equations'"
                rows={3}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-300 resize-none mb-3"
              />
            )}

            <div className="flex gap-2">
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageUpload} className="hidden" />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 h-11 px-4 rounded-xl border border-slate-200 text-slate-500 text-xs font-bold hover:border-slate-300 transition-all active:scale-95"
              >
                <Camera className="w-4 h-4" />
                Upload Photo
              </button>
              <button
                onClick={handleDoubtSubmit}
                disabled={generatingDoubt || (!doubtText.trim() && !doubtImageB64)}
                className="flex-1 h-11 rounded-xl bg-gradient-to-r from-rose-500 to-pink-500 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-all"
              >
                {generatingDoubt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {generatingDoubt ? "Thinking..." : "Get Step-by-Step Help"}
              </button>
            </div>
          </div>

          {/* Hints result */}
          {generatingDoubt && (
            <div className="flex items-center gap-3 p-5 bg-rose-50 rounded-2xl border border-rose-100">
              <Loader2 className="w-5 h-5 text-rose-500 animate-spin flex-shrink-0" />
              <p className="text-sm text-rose-700 font-medium">Preparing your hints...</p>
            </div>
          )}

          {doubtHints.length > 0 && !generatingDoubt && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <Sparkles className="w-4 h-4 text-rose-500" />
                <p className="text-xs font-bold text-slate-600">Hints revealed: {Math.min(hintIndex + 1, doubtHints.length)} / {doubtHints.length}</p>
              </div>

              {doubtHints.slice(0, hintIndex + 1).map((hint, i) => (
                <div key={i} className={`rounded-2xl p-4 border ${i === hintIndex ? "bg-rose-50 border-rose-100" : "bg-slate-50 border-slate-100"}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-black ${i === hintIndex ? "bg-rose-500 text-white" : "bg-slate-200 text-slate-500"}`}>
                      {i + 1}
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed">{hint}</p>
                  </div>
                </div>
              ))}

              {hintIndex < doubtHints.length - 1 ? (
                <button
                  onClick={() => setHintIndex(prev => prev + 1)}
                  className="w-full h-11 rounded-2xl border-2 border-dashed border-rose-200 text-rose-500 text-sm font-bold flex items-center justify-center gap-2 hover:border-rose-300 hover:bg-rose-50 transition-all active:scale-95"
                >
                  <ChevronRight className="w-4 h-4" />
                  Next Hint
                </button>
              ) : (
                <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-4 text-center">
                  <p className="text-sm font-bold text-emerald-700">All hints revealed! Did that help?</p>
                  <button onClick={() => { setDoubtHints([]); setHintIndex(0); setDoubtText(""); setDoubtImagePreview(null); setDoubtImageB64(null); }}
                    className="mt-2 text-xs text-emerald-600 font-semibold underline">Ask another doubt</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
};

export default ConceptStrengthsPage;
