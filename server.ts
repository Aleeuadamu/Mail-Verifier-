import express from "express";
import path from "path";
import { google } from "googleapis";
import cookieSession from "cookie-session";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

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
// Remove cookie-session since we rely on Firebase auth

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
  
  // Base64url encode
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

// Gmail Endpoints
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
        
        // Basic snippet for the body
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
TASK: Perform full phishing and authenticity analysis. You MUST extract and display sender information, contact alignments, and validated origins clearly, EVEN IF there is no threat at all detected. The sender info is critical metadata that must always be present.
EMAIL_SUBJECT: ${singleData.subject}
SENDER_NAME: ${singleData.senderName}
SENDER_EMAIL: ${singleData.senderEmail}
REPLY_TO: ${singleData.replyTo || "N/A"}
LINKS: ${singleData.links || "N/A"}
HEADERS: ${singleData.headers || "N/A"}
BODY: ${singleData.body}

RETURN FORMAT (MARKDOWN):
### Email Classification
[Result]

### Risk Score
Likelihood: X%
Severity: [Low/Medium/High/Critical]

### Audited Sender Identity Profile
- **Sender Name**: ${singleData.senderName || "Unknown"}
- **Sender Email**: ${singleData.senderEmail || "Unknown"}
- **Declared Return Path / Reply-to Alignment**: ${singleData.replyTo || "Same as Sender"}
- **Security Check Status**: Verified / Warning of any issues

### Key Findings
- Max 5 bullets

### Threat Analysis
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

### Metadata Insights
- IP Address (if found)
- Estimated Location
- Observations

### Final Verdict
Clear explanation in simple terms

### Recommended Action
Clear next step for user
    `;
  }

  try {
    const modelsToTry = ["gemini-1.5-flash", "gemini-2.5-flash", "gemini-flash-latest"];
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
              ...( (mode === "INBOX_SCAN" || mode === "REALTIME_ALERT") ? { responseMimeType: "application/json" } : {} )
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
            const delay = Math.pow(2, attempts) * 500;
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }
      if (success) break;
    }

    if (!success) {
      throw lastError || new Error("All models failed analysis");
    }

    let result;
    if (mode === "INBOX_SCAN" || mode === "REALTIME_ALERT") {
      let cleanedText = responseText.trim();
      if (cleanedText.startsWith("```")) {
        cleanedText = cleanedText.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/, "").trim();
      }
      result = JSON.parse(cleanedText);
    } else {
      result = responseText;
    }
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
    const modelsToTry = ["gemini-1.5-flash", "gemini-2.5-flash", "gemini-flash-latest"];
    let responseText = "";
    let success = false;
    let lastError: any = null;

    for (const model of modelsToTry) {
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
        lastError = err;
        console.warn(`Chat attempt failed with model ${model}`);
      }
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

// Start Server with Vite
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    try {
      const viteModule = await import("vite");
      const vite = await viteModule.createServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.warn("Vite not found, skipping dev middleware");
    }
  } else {
    // Check if we are running in a Vercel serverless environment
    // Vercel handles static files on its own, so we only need Express for `/api`
    if (!process.env.VERCEL) {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  // Only start listening if NOT in a serverless environment (like Vercel)
  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();

export default app;
