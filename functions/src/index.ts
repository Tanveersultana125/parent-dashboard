import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import OpenAI from "openai";
import axios from "axios";
const pdf = require('pdf-parse');

admin.initializeApp();

const openai = new OpenAI({ 
    apiKey: "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" 
});

export const getParentAITutor = functions.https.onCall(async (data, context) => {
    try {
        const { pdfUrl, title, description, question, type, topic, target_class, students_count } = data;

        console.log("AI Request Type:", type || "tutor");

        let pdfText = "";
        if (pdfUrl) {
            try {
                console.log("Downloading PDF:", pdfUrl);
                const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(response.data);
                const pdfData = await pdf(buffer);
                pdfText = pdfData.text.replace(/\r?\n|\r/g, " ");
            } catch (err) {
                console.warn("PDF scan failed, continuing with context only.");
            }
        }

        let systemPrompt = "You are a friendly AI Tutor for EduIntellect.";
        let userPrompt = `Context: ${description}\nText: ${pdfText}\nQuery: ${question}`;

        if (type === "calibration") {
            systemPrompt = "You are an expert Curriculum Designer for EduIntellect.";
            userPrompt = `Generate a calibrated assignment for Class: ${target_class} (${students_count} students) on Topic: ${topic || title}. Return JSON with: generated_assignment { title, description }.`;
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            response_format: { type: "json_object" }
        });

        return { status: "success", data: JSON.parse(completion.choices[0].message.content!) };

    } catch (error: any) {
        console.error("AI Function Error:", error);
        return { status: "error", message: error.message };
    }
});
