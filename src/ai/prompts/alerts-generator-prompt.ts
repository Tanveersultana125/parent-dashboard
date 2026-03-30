export const getAlertsGeneratorPrompt = (studentData: any) => `
You are an expert Educational AI Counselor. Analyze the following COMPREHENSIVE student dataset and generate 3 to 5 highly specific, data-driven alerts for the parent.

STUDENT DATA:
${JSON.stringify(studentData, null, 2)}

YOU MUST RESPOND WITH ONLY A JSON OBJECT IN THIS EXACT FORMAT:
{
  "alerts": [
    {
      "title": "Clear concise title",
      "description": "DETAILED explanation. Mention specific dates of absence, assignment names with scores, and SPECIFIC ACADEMIC TOPICS (Concepts) from the 'concept_mastery' data.",
      "recommendation": "A specific 1-sentence action the parent should take today.",
      "needs_attention": "Specific topic or area (e.g., 'Algebra', 'Punctuality', 'Lab Work', 'Behavior in Class')",
      "category": "Academic" | "Attendance" | "Behavior",
      "priority": "Critical" | "High Priority" | "Normal" | "Good News",
      "icon": "Trophy" | "AlertCircle" | "Clock" | "Star" | "Target" | "Flame",
      "color": "indigo" | "rose" | "amber" | "emerald" | "blue" | "orange"
    }
  ]
}

SPECIFIC INSTRUCTIONS:
1. ATTENDANCE: CRITICAL ALERT REQUIRED if 'attendance_summary.percentage' is BELOW 85%. Mention the EXACT dates found in 'absent_dates'. 
2. CONCEPTS: Look at 'concept_mastery'. Flag topics with scores < 60% as "Needs Attention" and topics with scores > 85% as "Strong". Mention them by name.3. ACADEMICS: If marks are low in a test, mention the TEST NAME and the PERCENTAGE. 
4. BEHAVIOR: Use 'teacher_notes' to describe their behavioral status.
5. TONE: Be factual and data-driven. Use student's name: ${studentData.student_name}.

Do not use markdown backticks. Return raw JSON string only.
`;
