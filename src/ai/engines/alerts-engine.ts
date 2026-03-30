import { getAlertsIntelligencePrompt } from "../prompts/alerts-prompt";

export async function generateAlertInsights(data: any): Promise<any> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("API Key missing");

  const prompt = getAlertsIntelligencePrompt(data);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ 
        model: "gpt-4.1-mini", 
        input: prompt,
        text: { format: { type: "json_object" } } 
      })
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    
    const result = await response.json();
    const output = result.output || result.text || result;
    
    if (typeof output === 'string') {
        return JSON.parse(output.replace(/```json/gi, "").replace(/```/g, "").trim());
    }
    return output;
  } catch (e) {
    console.error("Storytelling Engine Error:", e);
    return {
      alert_story: "AI is currently analyzing the trend. Initial data suggests proactive monitoring is required.",
      action_recommendation: {
        text: "Contact the subject coordinator for a detailed briefing.",
        button_label: "Request Update",
        priority: "Medium"
      }
    };
  }
}
