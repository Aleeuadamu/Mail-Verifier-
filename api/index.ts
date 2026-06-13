import express from "express";
import { google } from "googleapis";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();

let ai: GoogleGenAI | null = null;
function getAiClient() {
  if (!ai) {
    ai = new GoogleGenAI({ 
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return ai;
}

const SYSTEM_INSTRUCTION = `
You are Mail Verifier AI, a real-time email security assistant embedded inside a mobile and web application.
You operate as part of a full system that continuously scans user emails after secure OAuth permission.
Your responsibilities include: Classifying emails, Detecting phishing patterns, Performing risk scoring, and Explaining reasoning clearly.
You do not access emails yourself. You only analyze structured email data sent to you.

GLOBAL RULES - MUST BE STRICTLY ADHERED TO:
1. NO EMOJIS: Do NOT use any emojis anywhere in your response. No icons, no emoticons. Use clean, plain text and markdown.
2. STRICTLY FACTUAL: Base your analysis strictly and solely on the actual facts, headers, links, and text content present in the received email. Absolutely no hallucinations, self-generated speculations, or unproved claims.
3. ESTABLISH UNCERTAINTY: If headers or other metadata are missing or indicate nothing, clearly state "None detected in headers" or "Analysis inconclusive due to missing technical headers" instead of fabricating IP addresses, locations, or findings.
4. CONSISTENT & PROFESSIONAL ARRANGEMENT: Ensure a highly structured, objective, analytical, and professional tone. Your outputs must be clean, neat, and formatted perfectly with standard Markdown, avoiding any conversational filler, casual language, or marketing hype.
5. USER-SAFETY DRIVEN: Focus on objective security risk assessment.
`;

const userGmailTokens: Record<string, string> = {};

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

function buildMimeMessage({
  to,
  subject,
  body,
  attachments = []
}: {
  to: string;
  subject: string;
  body: string;
  attachments?: { name: string; type: string; data: string }[];
}) {
  const boundary = "FOO_BAR_BOUNDARY";
  const nl = "\r\n";

  let header = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ""
  ].join(nl);

  let bodyPart = [
    `--${boundary}`,
    `Content-Type: text/plain; charset="utf-8"`,
    `Content-Transfer-Encoding: 7bit`,
    "",
    body,
    ""
  ].join(nl);

  let attachmentParts = attachments.map(att => {
    let base64Data = att.data;
    if (base64Data.includes(";base64,")) {
      base64Data = base64Data.split(";base64,")[1];
    }
    return [
      `--${boundary}`,
      `Content-Type: ${att.type}; name="${att.name}"`,
      `Content-Disposition: attachment; filename="${att.name}"`,
      `Content-Transfer-Encoding: base64`,
      "",
      base64Data,
      ""
    ].join(nl);
  }).join("");

  let footer = `--${boundary}--`;

  const fullMime = header + bodyPart + attachmentParts + footer;
  
  const encoded = Buffer.from(fullMime)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return encoded;
}

app.post("/api/gmail/send", async (req, res) => {
  const uid = req.headers['x-firebase-uid'] as string;
  if (!uid) return res.status(401).json({ error: "No UID provided" });

  const token = userGmailTokens[uid];
  if (!token) return res.status(401).json({ error: "No Gmail token found. Please reconnect Google account." });

  const { to, subject, body, attachments } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: "Missing required fields (to, subject, body)" });
  }

  const client = new google.auth.OAuth2();
  client.setCredentials({ access_token: token });

  const gmail = google.gmail({ version: "v1", auth: client });

  try {
    const rawMessage = buildMimeMessage({ to, subject, body, attachments });
    const response = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: rawMessage,
      },
    });

    res.json({ success: true, messageId: response.data.id });
  } catch (error: any) {
    console.error("Gmail send error:", error);
    res.status(500).json({ error: error?.message || "Failed to send email" });
  }
});

app.post("/api/auth/store-token", (req, res) => {
  const { token, uid } = req.body;
  if (!token || !uid) return res.status(400).json({ error: "Missing fields" });
  userGmailTokens[uid] = token;
  res.json({ success: true });
});

app.get("/api/gmail/messages", async (req, res) => {
  const uid = req.headers['x-firebase-uid'] as string;
  if (!uid) return res.status(401).json({ error: "No UID provided" });
  
  const token = userGmailTokens[uid];
  if (!token) return res.status(401).json({ error: "No Gmail token found. Please reconnect Google account." });
  
  const client = new google.auth.OAuth2();
  client.setCredentials({ access_token: token });
  
  const gmail = google.gmail({ version: "v1", auth: client });
  
  try {
    const maxResults = parseInt(req.query.maxResults as string) || 10;
    const q = req.query.q as string || undefined;
    const pageToken = req.query.pageToken as string || undefined;

    const response = await gmail.users.messages.list({
      userId: "me",
      maxResults,
      q,
      pageToken,
    });
    
    const messages = await Promise.all(
      (response.data.messages || []).map(async (msg) => {
        const detail = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "full",
        });
        
        const headers = detail.data.payload?.headers || [];
        const subject = headers.find((h) => h.name === "Subject")?.value || "(No Subject)";
        const from = headers.find((h) => h.name === "From")?.value || "Unknown";
        const date = headers.find((h) => h.name === "Date")?.value || "";
        
        let snippet = detail.data.snippet || "";
        
        return {
          id: msg.id,
          subject,
          from,
          date,
          snippet,
          fullData: detail.data
        };
      })
    );
    
    res.json({
      messages,
      nextPageToken: response.data.nextPageToken || null
    });
  } catch (error) {
    console.error("Gmail fetch error:", error);
    res.status(500).json({ error: "Failed to fetch emails" });
  }
});

app.post("/api/analyze", async (req, res) => {
  const { data, mode } = req.body;
  if (!data || !mode) return res.status(400).json({ error: "Missing data or mode" });

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
TASK: Perform a complete audit of the email. You must extract and analyze the following categories as exhaustively as possible based on the available data. If data for a feature is unavailable, mark it as "NOT VERIFIED" or null.
Respond ONLY with a valid JSON object matching this schema. NO Markdown formatting blocks around the JSON.
EMAIL_SUBJECT: ${singleData.subject}
SENDER_NAME: ${singleData.senderName}
SENDER_EMAIL: ${singleData.senderEmail}
REPLY_TO: ${singleData.replyTo || "N/A"}
LINKS: ${singleData.links || "N/A"}
HEADERS: ${singleData.headers || "N/A"}
BODY: ${singleData.body}

Expected JSON Schema:
{
  "email_metadata_analysis": {
    "headers_present": boolean,
    "sender_metadata_extracted": boolean,
    "message_id": string | null,
    "return_path": string | null,
    "reply_to": string | null,
    "sender_domain": string | null,
    "mail_server": string | null,
    "received_header_parsed": boolean
  },
  "location_intelligence": {
    "ip_address": string | null,
    "country": string | null,
    "region": string | null,
    "city": string | null,
    "isp": string | null,
    "asn": string | null,
    "hosting_provider": string | null,
    "vpn_detected": boolean,
    "proxy_detected": boolean,
    "datacenter_detected": boolean
  },
  "sender_identity_analysis": {
    "display_name": string | null,
    "actual_email": string | null,
    "name_domain_mismatch": boolean,
    "executive_impersonation": boolean,
    "brand_impersonation": boolean,
    "lookalike_sender": boolean,
    "spoofing_detected": boolean,
    "sender_trust_score": number
  },
  "domain_intelligence": {
    "domain_age_estimation": string | null,
    "domain_reputation": string | "NOT VERIFIED",
    "business_ownership": string | "NOT VERIFIED",
    "website_category": string | null,
    "domain_risk_score": number
  },
  "authentication_analysis": {
    "spf_validation": string | "NOT VERIFIED",
    "dkim_validation": string | "NOT VERIFIED",
    "dmarc_validation": string | "NOT VERIFIED",
    "arc_validation": string | "NOT VERIFIED",
    "domain_alignment": boolean,
    "authentication_score": number
  },
  "email_routing_analysis": {
    "route_tracing_possible": boolean,
    "hop_count": number | null,
    "route_anomaly_detected": boolean
  },
  "threat_intelligence": {
    "phishing_domain_match": boolean,
    "malware_hosting_match": boolean,
    "spam_reputation_match": boolean,
    "blacklist_match": boolean
  },
  "social_engineering_detection": {
    "urgency_tactics": boolean,
    "fear_tactics": boolean,
    "authority_impersonation": boolean,
    "credential_theft_attempt": boolean,
    "payment_fraud_attempt": boolean,
    "invoice_scam": boolean,
    "bec_detected": boolean
  },
  "ai_risk_engine": {
    "trust_score": number,
    "threat_score": number,
    "severity_score": number,
    "likelihood_score": number,
    "confidence_score": number,
    "final_risk_classification": "Safe" | "Likely Safe" | "Suspicious" | "Likely Phishing" | "Phishing"
  },
  "relationship_analysis": {
    "first_time_sender": boolean,
    "historical_trust": string | "NOT VERIFIED"
  },
  "domain_similarity_detection": {
    "typosquatting_detected": boolean,
    "homograph_attack_detected": boolean,
    "domain_similarity_score": number
  },
  "summary_markdown": string // A clear markdown summary of the findings, including Key Findings, Threat Analysis, Final Verdict, and Recommended Action.
}
    `;
  }

  try {
    const modelsToTry = ["gemini-3.5-flash", "gemini-2.5-pro", "gemini-3.1-flash-lite", "gemini-2.5-flash"];
    let responseText = "";
    let success = false;
    let lastError: any = null;

    for (const model of modelsToTry) {
      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts && !success) {
        try {
          console.log(`Analyzing email with model: ${model} (attempt ${attempts + 1}/${maxAttempts})`);
          const response = await getAiClient().models.generateContent({
            model: model,
            contents: [{ parts: [{ text: prompt }] }],
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              temperature: 0.1,
              responseMimeType: "application/json"
            },
          });
          responseText = response.text || "";
          success = true;
          console.log(`Analysis success with model: ${model}`);
        } catch (err: any) {
          attempts++;
          lastError = err;
          console.warn(`Attempt ${attempts} failed for model ${model}:`, err.message || err);
          if (attempts < maxAttempts) {
            let delay = Math.pow(2, attempts) * 500;
            if (err?.status === 429 || err?.message?.includes("429") || err?.message?.includes("RESOURCE_EXHAUSTED")) {
              delay = 15000; // wait 15 seconds on quota limit
            }
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }
      if (success) break;
    }

    if (!success) {
      throw lastError || new Error("All models failed analysis");
    }

    let cleanedText = responseText.trim();
    if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/, "").trim();
    }
    const result = JSON.parse(cleanedText);

    res.json({ result });
  } catch (error: any) {
    console.error("Gemini Analysis Error:", error);
    res.status(500).json({ error: error.message || "Analysis failed" });
  }
});

app.post("/api/chat-message", async (req, res) => {
  const { messageContext, history, question } = req.body;
  if (!question || !messageContext) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const historyText = (history || [])
    .map((h: any) => `${h.role === "user" ? "User" : "Mail Verifier AI"}: ${h.text}`)
    .join("\n\n");

  const prompt = `
YOU MUST ANSWER THE QUESTION FACTUALLY AND SECURELY BASED STRIDTLY AND SOLELY ON THIS EMAIL DETAILS AND VALUE PARSING.

EMAIL DETAILS:
- Subject: ${messageContext.subject}
- Sender Name: ${messageContext.senderName || "Unknown"}
- Sender Email: ${messageContext.senderEmail || "Unknown"}
- Body: 
${messageContext.body}

GLOBAL NO-EMOJI RULES AND CHAT BOUNDARIES:
1. NO EMOJIS: Do NOT use any emojis of any format. No star, checkmark, warnings or smiles.
2. STRICTLY FACTUAL: Base your analysis and responses strictly on the details, links, or headers contained in the email. Avoid hallucinations.
3. IN-SCOPE REMINDERS: If the user asks a question unrelated to this email or phishing/safety topics pertaining to it, politely remind them that you are locked into this specific email's secure scope.

CONVERSATION HISTORY:
${historyText || "No prior history"}

NEW USER QUESTION: ${question}
  `;

  try {
    const modelsToTry = ["gemini-3.5-flash", "gemini-2.5-pro", "gemini-3.1-flash-lite", "gemini-2.5-flash"];
    let responseText = "";
    let success = false;
    let lastError: any = null;

    for (const model of modelsToTry) {
      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts && !success) {
        try {
          const response = await getAiClient().models.generateContent({
            model: model,
            contents: prompt,
            config: {
              systemInstruction: "You are the Mail Verifier AI Q&A Assistant. You answer questions strictly, safely, and factually regarding the selected email.",
              temperature: 0.1,
            }
          });
          responseText = response.text || "";
          success = true;
          break;
        } catch (err: any) {
          attempts++;
          lastError = err;
          console.warn(`Chat attempt ${attempts} failed with model ${model}:`, err.message || err);
          if (attempts < maxAttempts) {
            let delay = Math.pow(2, attempts) * 500;
            if (err?.status === 429 || err?.message?.includes("429") || err?.message?.includes("RESOURCE_EXHAUSTED")) {
              delay = 15000;
            }
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }
      if (success) break;
    }

    if (!success) {
      throw lastError || new Error("Failed to process chat query (all models exhausted)");
    }
    res.json({ text: responseText });
  } catch (error: any) {
    console.error("Chat message error:", error);
    res.status(500).json({ error: error.message || "Failed to process chat query" });
  }
});

export default app;
