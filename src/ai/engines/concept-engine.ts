import { getConceptIntelligencePrompt, getMasteryAnalysisPrompt } from "../prompts/concept-prompt";

async function callOpenAI(prompt: string): Promise<any> {
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI API Key not configured.");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: "gpt-4o-mini", // Use standard model
            messages: [
                { role: "system", content: "You are EduIntellect AI, a cognitive analysis engine." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" }
        })
    });

    if (!response.ok) throw new Error(`OpenAI API Error: ${response.status}`);
    const result = await response.json();
    let content = result.choices[0].message.content;
    content = content.replace(/```json/gi, "").replace(/```/g, "").trim();
    return JSON.parse(content);
}

// ── NEW: MATHEMATICAL FALLBACK LOGIC ──
function getMathematicalFallback(data: any) {
    const scores = data.scores || [];
    const subjectsMap = new Map();

    // Group by subject and calculate average performance
    scores.forEach((s: any) => {
        const sub = s.subject || "General";
        if (!subjectsMap.has(sub)) subjectsMap.set(sub, { total: 0, count: 0, topics: [] });
        const curr = subjectsMap.get(sub);
        curr.total += (s.percentage || 0);
        curr.count += 1;
        if (s.testName) curr.topics.push({ name: s.testName, score: s.percentage || 0 });
    });

    const analysis: any = { subjects: [] };

    subjectsMap.forEach((val, sub) => {
        const avg = Math.round(val.total / val.count);
        const subjectAnalysis: any = {
            subject: sub,
            overall_mastery: avg,
            mastery_pillars: { strong: [], developing: [], attention_required: [] }
        };

        // Categorize topics based on score thresholds
        val.topics.forEach((t: any) => {
            if (t.score >= 80) subjectAnalysis.mastery_pillars.strong.push(t.name);
            else if (t.score >= 55) subjectAnalysis.mastery_pillars.developing.push(t.name);
            else subjectAnalysis.mastery_pillars.attention_required.push(t.name);
        });

        analysis.subjects.push(subjectAnalysis);
    });

    return { status: "success", source: "fallback", data: analysis };
}

export async function generateParentConceptInsights(data: any): Promise<any> {
    try {
        const prompt = getConceptIntelligencePrompt(data);
        return await callOpenAI(prompt);
    } catch (e) {
        console.info("AI Insights Engine: Transitioning to Mathematical Mastery logic (API Unavailable).", e);
        return null;
    }
}

export async function analyzeConceptMastery(studentName: string, data: { scores: any[], assignments: any[], attendance?: any[], enrolled_subjects?: string[] }): Promise<any> {
    try {
        const prompt = getMasteryAnalysisPrompt(studentName, data);
        const aiResult = await callOpenAI(prompt);
        return { status: "success", source: "ai", data: aiResult };
    } catch (e) {
        console.info("AI Mastery Analysis: Transitioning to Mathematical Fallback Model (API 403 Engaged).", e);
        // Engagement of fallback logic to prevent dashboard crash/errors for parents
        return getMathematicalFallback(data);
    }
}
