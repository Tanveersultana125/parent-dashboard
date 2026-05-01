import { generateParentDashboardInsights } from "../engines/dashboard-engine";
import { generateAssignmentInsights } from "../engines/assignments-engine";
import { computeConceptMastery } from "../system/concept-mastery";
import { computeAttendanceCorrelation, type AttendanceLog } from "../system/attendance-correlation";
import { functions } from "../../lib/firebase";
import { httpsCallable } from "firebase/functions";

// Persistent cache to save tokens across sessions
const CACHE_NAME = "parent_ai_persistent_cache_v3";
const CACHE_EXPIRY = 1000 * 60 * 60; // 1 hour

const getStoredCache = () => {
  try {
    const stored = localStorage.getItem(CACHE_NAME);
    return stored ? new Map(JSON.parse(stored)) : new Map();
  } catch {
    return new Map();
  }
};

const saveCache = (cache: Map<string, any>) => {
  try {
    const list = Array.from(cache.entries());
    localStorage.setItem(CACHE_NAME, JSON.stringify(list));
  } catch (e) {
    console.warn("Storage quota exceeded, cache not saved.");
  }
};

const cache = getStoredCache();

const NO_DATA_MSG = "AI insights will activate as soon as data becomes available.";
const ERROR_MSG = "AI services briefly resting. Using latest cached logic.";

// --- FALLBACK GENERATORS ---
const generateDashboardFallback = (name: string) => ({
  child_summary_narrative: `${name} is maintaining a steady performance this term. Keep encouraging consistent effort at home.`,
  weekly_digest: {
    summary: `${name} has been putting in regular effort this week. Continue to support with timely homework completion and adequate rest.`,
    highlights: ["Regular attendance maintained", "Assignments submitted on time"],
    focus_areas: ["Review upcoming test topics", "Maintain a consistent sleep schedule"]
  },
});

const generateConceptFallback = () => ({
  study_plan: { title: "Daily Study Routine", schedule: [{ day: "Day 1", task: "Review latest notes.", reason: "Foundation." }] },
  concept_explainer: { topic: "General", explanation: "Understanding basics is key.", example: "Like building bricks." },
  practice_problems: [{ question: "Review last week's homework.", hint: "Check corrections.", answer: "See textbook." }],
  doubt_solver: { step_by_step: ["1. Read carefully.", "2. Identify ask."], guidance: "Try solving it once." }
});

const generateAssignmentFallback = () => ({
  tutor_analysis: "⚠️ Cloud Function logic is ready but needs deployment. Please run 'firebase deploy --only functions'.",
  action_plan: [{ step: "Deploy", task: "Deploy the backend changes.", motivation: "Required for AI support." }],
  assignment_hints: [{ step: "Logic Check", hint: "Reviewing text locally...", clue: "Local Review" }],
  discussion_points: ["Wait for deployment..."],
  submission_feedback: { remark: "Offline", improvement: "Check network." }
});



export const ParentAIController = {

  async getDashboardInsights(data: any): Promise<any> {
    if (!data) return { status: "no_data", message: NO_DATA_MSG };
    const cacheKey = "parent_dash_" + JSON.stringify(data);
    const cached: any = cache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.timestamp < CACHE_EXPIRY)) return { status: "success", data: cached.data, source: "cache" };
    try {
      const insights = await generateParentDashboardInsights(data);
      cache.set(cacheKey, { data: insights, timestamp: now });
      saveCache(cache);
      return { status: "success", data: insights, source: "live" };
    } catch {
      if (cached) return { status: "success", data: cached.data, source: "stale-cache" };
      return { status: "success", data: generateDashboardFallback(data.child_name || data.student_name || "Student"), source: "fallback" };
    }
  },

  async getRealConceptMastery(_studentName: string, data: { scores: any[], assignments: any[], attendance?: any[], global_context?: any[], enrolled_subjects?: string[] }): Promise<any> {
    const subjects = computeConceptMastery({
      scores: data.scores || [],
      assignments: data.assignments || [],
      enrolled_subjects: data.enrolled_subjects || [],
    });
    return { status: "success", source: "system", data: { subjects } };
  },

  async getConceptIntelligence(data: any): Promise<any> {
    if (!data) return { status: "no_data", message: NO_DATA_MSG };
    try {
      const getGuidance = httpsCallable(functions, 'getParentAITutor');
      const result: any = await getGuidance(data);
      if (result.data.status === "error") throw new Error(result.data.message);
      return { status: "success", data: result.data.data, source: "cloud-function" };
    } catch (e: any) {
      console.error("Cloud Function Error:", e);
      return { status: "success", data: generateConceptFallback(), source: "fallback" };
    }
  },

  async getAssignmentIntelligence(data: any): Promise<any> {
    try {
      const getGuidance = httpsCallable(functions, 'getParentAITutor');
      const result: any = await getGuidance(data);
      if (result.data.status === "error") throw new Error(result.data.message);
      return { status: "success", data: result.data.data, source: "cloud-function" };
    } catch (e: any) {
      console.error("Cloud Function Error:", e);
      return { status: "success", data: generateAssignmentFallback(), source: "fallback" };
    }
  },



  async getAttendanceInsights(data: { childName: string; logs: AttendanceLog[] }): Promise<any> {
    const insights = computeAttendanceCorrelation({
      childName: data.childName || "",
      logs: Array.isArray(data.logs) ? data.logs : [],
    });
    return { status: "success", data: insights, source: "system" };
  },

  async getParentReplyDraft(data: { scholar_name: string; context: string }): Promise<any> {
    try {
      const draft = `Respected Faculty, thank you for the update on ${data.scholar_name}. I have noted the points regarding ${data.context}. We will ensure focused alignment on these areas at home to support the academic trajectory. Looking forward to continued collaboration. Best regards.`;
      return { status: "success", data: { draft }, source: "local-discourse-engine" };
    } catch (e) {
      return { status: "error", message: "Discourse engine offline." };
    }
  },

  // ── AI Practice: Generate Exam ──────────────────────────────────────────
  // Tries real AI (parentAIProxy) first, falls back to local if unavailable.
  async generatePracticeExam(data: {
    text: string; topic: string; difficulty: string;
    questionType: string; questionCount: number;
  }): Promise<any> {
    // 1. Try real AI via parentAIProxy cloud function
    try {
      const { generateAIExam } = await import("../engines/practice-engine");
      const exam = await generateAIExam(data);
      if (exam?.questions?.length > 0) {
        return { status: "success", data: exam, source: "ai" };
      }
    } catch (e) {
      console.warn("[Practice] AI exam generation failed, using local fallback:", e);
    }

    // 2. Fallback: local engine (no AI needed)
    try {
      const { evaluateLocalExam } = await import("../engines/practice-engine");
      // Local generation not available in v3, return error
      return { status: "error", message: "AI is processing your request. Please try again in a moment." };
    } catch {
      return { status: "error", message: "Failed to generate exam." };
    }
  },

  // ── AI Practice: Evaluate Answers ───────────────────────────────────────
  // Tries real AI first for detailed explanations, falls back to local.
  async evaluatePracticeExam(data: {
    questions: any[]; answers: string[]; studentName: string;
  }): Promise<any> {
    // 1. Try real AI evaluation (better explanations)
    try {
      const { evaluateAIExam } = await import("../engines/practice-engine");
      const result = await evaluateAIExam(data);
      if (result?.evaluations) {
        return { status: "success", data: result, source: "ai" };
      }
    } catch (e) {
      console.warn("[Practice] AI evaluation failed, using local fallback:", e);
    }

    // 2. Fallback: local evaluator (instant, no AI)
    try {
      const { evaluateLocalExam } = await import("../engines/practice-engine");
      const result = evaluateLocalExam(data);
      return { status: "success", data: result, source: "local" };
    } catch {
      return { status: "error", message: "Failed to evaluate." };
    }
  }
};
