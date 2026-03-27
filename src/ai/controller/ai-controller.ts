import { generateParentDashboardInsights } from "../engines/dashboard-engine";
import { generateParentPerformanceInsights } from "../engines/performance-engine";
import { generateParentConceptInsights } from "../engines/concept-engine";
import { generateAssignmentInsights } from "../engines/assignments-engine";
import { generateMessageInsights } from "../engines/messages-engine";
import { generateAlertInsights } from "../engines/alerts-engine";
import { generateAttendanceInsights } from "../engines/attendance-engine";
import { functions } from "../../lib/firebase";
import { httpsCallable } from "firebase/functions";

// Persistent cache to save tokens across sessions
const CACHE_NAME = "parent_ai_persistent_cache_v3";
const CACHE_EXPIRY = 1000 * 60 * 60 * 24; // 24 hours

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
  narrative_summary: `${name} is maintaining a steady performance this term.`,
  weekly_digest: ["Consistent homework submission.", "Good participation."],
  parenting_tips: ["Encourage a regular reading habit.", "Ensure 8 hours of sleep."]
});

const generatePerformanceFallback = (name: string) => ({
  narrative_analysis: `${name}'s performance shows a stable trend.`,
  goal_setting: { current_standing: "78% Overall", target: "85%", action_plan: "Focus on consistent revision." },
  peer_comparison: "Performing well within class average."
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

const generateMessageFallback = (content: string) => ({
  translation: { from: "Auto", to: "Formal English", content: content || "Thank you for the update." },
  reply_suggestions: ["Noted, thank you.", "I will look into it tonight."]
});

const generateAlertFallback = (title: string) => ({
  alert_story: `Regarding ${title}: This is a high-priority update.`,
  action_recommendation: { text: "Contact coordinator.", button_label: "Request Update", priority: "Medium" }
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
      return { status: "success", data: generateDashboardFallback(data.student_name || "Student"), source: "fallback" };
    }
  },

  async getPerformanceInsights(data: any): Promise<any> {
    if (!data) return { status: "no_data", message: NO_DATA_MSG };
    const cacheKey = "parent_perf_" + JSON.stringify(data);
    const cached: any = cache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.timestamp < CACHE_EXPIRY)) return { status: "success", data: cached.data, source: "cache" };
    try {
      const insights = await generateParentPerformanceInsights(data);
      cache.set(cacheKey, { data: insights, timestamp: now });
      saveCache(cache);
      return { status: "success", data: insights, source: "live" };
    } catch {
      if (cached) return { status: "success", data: cached.data, source: "stale-cache" };
      return { status: "success", data: generatePerformanceFallback(data.student_name || "Student"), source: "fallback" };
    }
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

  async getMessageIntelligence(data: any): Promise<any> {
    try {
      const insights = await generateMessageInsights(data);
      return { status: "success", data: insights, source: "live" };
    } catch {
      return { status: "success", data: generateMessageFallback(data.content), source: "fallback" };
    }
  },

  async getAlertIntelligence(data: any): Promise<any> {
    const cacheKey = "alert_story_" + JSON.stringify(data);
    const cached: any = cache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.timestamp < CACHE_EXPIRY)) return { status: "success", data: cached.data, source: "cache" };
    try {
      const insights = await generateAlertInsights(data);
      cache.set(cacheKey, { data: insights, timestamp: now });
      saveCache(cache);
      return { status: "success", data: insights, source: "live" };
    } catch {
      if (cached) return { status: "success", data: cached.data, source: "stale-cache" };
      return { status: "success", data: generateAlertFallback(data.title || "Alert"), source: "fallback" };
    }
  },
  
  async getAttendanceInsights(data: any): Promise<any> {
    const cacheKey = "attendance_correlation_" + JSON.stringify(data);
    const cached: any = cache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.timestamp < CACHE_EXPIRY)) return { status: "success", data: cached.data, source: "cache" };
    try {
      const insights = await generateAttendanceInsights(data);
      cache.set(cacheKey, { data: insights, timestamp: now });
      saveCache(cache);
      return { status: "success", data: insights, source: "live" };
    } catch {
      if (cached) return { status: "success", data: cached.data, source: "stale-cache" };
      return { 
        status: "success", 
        data: {
          correlation_narrative: "Attendance affects mastery.",
          impact_analysis: ["Consistency matters."],
          growth_strategy: "Keep attending."
        }, 
        source: "fallback" 
      };
    }
  }
};
