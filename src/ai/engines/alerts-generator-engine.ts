import { getAlertsGeneratorPrompt } from "../prompts/alerts-generator-prompt";

export async function generateNewStudentAlerts(studentContext: any): Promise<any[]> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI Engine offline (Missing API Key)");

  const prompt = getAlertsGeneratorPrompt(studentContext);

  try {
     const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini", 
        input: prompt,
        text: { format: { type: "json_object" } }
      })
    });

    if (!response.ok) throw new Error(`Pulse analysis failed: ${response.status}`);
    
    const result = await response.json();
    const output = result.output || result.text || result;
    
    let parsed: any;
    if (typeof output === 'string') {
        const cleanText = output.replace(/```json/gi, "").replace(/```/g, "").trim();
        parsed = JSON.parse(cleanText);
    } else {
        parsed = output;
    }
    
    // Most robust recovery: look for any array that might be the alerts list
    let finalAlerts: any[] = [];
    if (parsed.alerts && Array.isArray(parsed.alerts)) {
        finalAlerts = parsed.alerts;
    } else if (parsed.notifications && Array.isArray(parsed.notifications)) {
        finalAlerts = parsed.notifications;
    } else if (Array.isArray(parsed)) {
        finalAlerts = parsed;
    } else {
        // Find the first array in the object
        const firstArr = Object.values(parsed).find(v => Array.isArray(v)) as any[];
        if (firstArr) finalAlerts = firstArr;
    }
    
    // Final check for empty fields (ensure defaults)
    return finalAlerts.map(a => ({
        ...a,
        title: a.title || "Academic Update",
        description: a.description || "The academic AI brain is currently analyzing latest scholar trends.",
        recommendation: a.recommendation || "",
        category: a.category || "General",
        priority: a.priority || "Normal",
        icon: a.icon || "AlertCircle",
        color: a.color || "indigo"
    }));

  } catch (e) {
    console.error("Alert generation error:", e);
    return [];
  }
}
