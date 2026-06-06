import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface EmailData {
  subject: string;
  body: string;
  senderName: string;
  senderEmail: string;
  replyTo?: string;
  headers?: string;
  links?: string;
}

export type AnalysisMode = "INBOX_SCAN" | "SINGLE_EMAIL_VIEW" | "REALTIME_ALERT";

const SYSTEM_INSTRUCTION = `
You are Mail Verifier AI, a real-time email security assistant embedded inside a mobile and web application.
You operate as part of a full system that continuously scans user emails after secure OAuth permission.
Your responsibilities include: Classifying emails, Detecting phishing patterns, Performing risk scoring, and Explaining reasoning clearly.
You do not access emails yourself. You only analyze structured email data sent to you.

GLOBAL RULES:
- Be accurate and cautious
- Do not assume missing data
- Clearly state uncertainty
- Always prioritize user safety
- Output must be structured for UI rendering
`;

export async function analyzeEmail(data: EmailData | EmailData[], mode: AnalysisMode = "SINGLE_EMAIL_VIEW") {
  let prompt = "";

  if (mode === "INBOX_SCAN") {
    const emailList = Array.isArray(data) ? data : [data];
    prompt = `
MODE: INBOX_SCAN
INPUT: A list of emails.
TASK: For EACH email return: classification (Safe, Likely Safe, Suspicious, Likely Phishing, Phishing), risk_score (0–100), severity (Low, Medium, High, Critical), short_reason (max 15 words).
OUTPUT FORMAT: JSON array of objects with keys: subject, sender, classification, risk_score, severity, short_reason.
EMAILS: ${JSON.stringify(emailList.map(e => ({ subject: e.subject, sender_name: e.senderName, sender_email: e.senderEmail, short_snippet: e.body.substring(0, 200) })))}
    `;
  } else if (mode === "REALTIME_ALERT") {
    const singleData = Array.isArray(data) ? data[0] : data;
    prompt = `
MODE: REALTIME_ALERT
INPUT: subject, sender_name, sender_email, short_snippet.
TASK: Return a short alert message.
OUTPUT: JSON object with keys: alert_type (Safe, Warning, Danger), message (max 20 words), action_hint (max 10 words).
EMAIL: ${JSON.stringify({ subject: singleData.subject, sender_name: singleData.senderName, sender_email: singleData.senderEmail, short_snippet: singleData.body.substring(0, 200) })}
    `;
  } else {
    const singleData = Array.isArray(data) ? data[0] : data;
    prompt = `
MODE: SINGLE_EMAIL_VIEW
INPUT: subject, full_body, sender_name, sender_email, reply_to, links, headers.
TASK: Perform full phishing and authenticity analysis.
EMAIL_SUBJECT: ${singleData.subject}
SENDER_NAME: ${singleData.senderName}
SENDER_EMAIL: ${singleData.senderEmail}
REPLY_TO: ${singleData.replyTo || "N/A"}
LINKS: ${singleData.links || "N/A"}
HEADERS: ${singleData.headers || "N/A"}
BODY: ${singleData.body}

RETURN FORMAT (MARKDOWN):
### 📨 Email Classification
[Result]

### 📊 Risk Score
Likelihood: X%
Severity: [Low/Medium/High/Critical]

### 🔍 Key Findings
- Max 5 bullets

### 🧠 Threat Analysis
#### Sender Identity
- Check mismatch between name and email
- Detect impersonation
#### Domain Authenticity
- Analyze domain trust signals
#### Urgency & Tactics
- Detect pressure, fear, authority manipulation
#### Links
- Evaluate link safety and mismatches
#### Content
- Detect sensitive requests or manipulation
#### Technical
- Analyze SPF, DKIM, routing if headers exist

### 🌍 Metadata Insights
- IP Address (if found)
- Estimated Location
- Observations

### ✅ Final Verdict
Clear explanation in simple terms

### 🛡️ Recommended Action
Clear next step for user
    `;
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.1,
        ...( (mode === "INBOX_SCAN" || mode === "REALTIME_ALERT") ? { responseMimeType: "application/json" } : {} )
      },
    });

    if (mode === "INBOX_SCAN" || mode === "REALTIME_ALERT") {
      return JSON.parse(response.text);
    }
    return response.text;
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return null;
  }
}
