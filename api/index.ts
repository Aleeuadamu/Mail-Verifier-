import express from "express";
import { google } from "googleapis";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import cookieSession from "cookie-session";
import bcrypt from "bcryptjs";
import { dbService } from "./db.js";

dotenv.config();

import cors from "cors";
import rateLimit from "express-rate-limit";

const app = express();

app.set('trust proxy', 1);

if (!process.env.APP_URL) {
  throw new Error("APP_URL must be set in environment variables");
}

app.use(cors({
  origin: process.env.APP_URL,
  credentials: true
}));

app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", apiLimiter);

import crypto from "crypto";

app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')],
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  secure: true,
  sameSite: 'none',
  httpOnly: true,
}));

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

const oauth2ClientShared = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  // Not passing redirectUri here since it's only needed for generating auth URL and exchanging code
);

const userGmailTokens: Record<string, any> = {};

async function getGmailTokenForUser(uid: string): Promise<string | null> {
  let tokenData = userGmailTokens[uid];
  if (!tokenData) {
    tokenData = await dbService.getGmailToken(uid);
    if (tokenData) {
      userGmailTokens[uid] = tokenData;
    }
  }

  if (!tokenData) return null;

  if (tokenData.expiry_date && Date.now() >= tokenData.expiry_date - 60000) {
    if (tokenData.refresh_token) {
      try {
        oauth2ClientShared.setCredentials({
          refresh_token: tokenData.refresh_token
        });
        const { credentials } = await oauth2ClientShared.refreshAccessToken();
        tokenData = {
          ...tokenData,
          access_token: credentials.access_token!,
          expiry_date: credentials.expiry_date || null
        };
        userGmailTokens[uid] = tokenData;
        await dbService.saveGmailToken(uid, tokenData);
      } catch (e: any) {
        console.error("Failed to refresh Gmail access token:", e.message);
        return null; // Return null if refresh fails
      }
    } else {
      // Token expired and no refresh token
      return null;
    }
  }

  return tokenData.access_token;
}
const SYSTEM_INSTRUCTION = `You are Mail Verifier AI, a real-time email security assistant embedded inside a mobile and web application.
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

// Custom Local Auth routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", env: process.env.VERCEL ? "vercel" : "local" });
});

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: "Email, password, and name are required" });
  }

  try {
    const existingUser = await dbService.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: "An account with this email already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = await dbService.createUser(email, passwordHash, name);
    req.session!.userId = user.id;

    res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, subscription: user.subscription } });
  } catch (error: any) {
    console.error("Registration error:", error);
    res.status(500).json({ error: error?.message || "Failed to register user" });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const user = await dbService.getUserByEmail(email);
    if (!user) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    req.session!.userId = user.id;

    res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, subscription: user.subscription } });
  } catch (error: any) {
    console.error("Login error:", error);
    res.status(500).json({ error: error?.message || "Failed to login" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session = null;
  res.json({ success: true });
});

app.get("/api/auth/me", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) {
    return res.json({ user: null });
  }

  const user = await dbService.getUserById(userId);
  if (!user) {
    req.session = null;
    return res.json({ user: null });
  }

  res.json({ user: { id: user.id, email: user.email, name: user.name, subscription: user.subscription, isAdmin: user.isAdmin } });
});

app.post("/api/auth/subscription", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { subscription } = req.body;
  if (!subscription) return res.status(400).json({ error: "Missing subscription data" });

  const updatedUser = await dbService.updateUserSubscription(userId, subscription);
  if (!updatedUser) return res.status(404).json({ error: "User not found" });

  res.json({ success: true, subscription: updatedUser.subscription });
});

// Admin management endpoints
app.get("/api/admin/users", async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: "Unauthorized" });
  const requestingUser = await dbService.getUserById(req.session.userId);
  if (!requestingUser?.isAdmin) return res.status(403).json({ error: "Forbidden" });

  const users = await dbService.getAllUsers();
  const safeUsers = users.map(u => ({
    id: u.id,
    email: u.email,
    name: u.name,
    subscription: u.subscription,
    status: u.subscription ? "active" : "inactive"
  }));
  res.json(safeUsers);
});

app.delete("/api/admin/users/:id", async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: "Unauthorized" });
  const requestingUser = await dbService.getUserById(req.session.userId);
  if (!requestingUser?.isAdmin) return res.status(403).json({ error: "Forbidden" });

  const { id } = req.params;
  const deleted = await dbService.deleteUser(id);
  if (!deleted) {
    return res.status(404).json({ error: "User not found" });
  }
  res.json({ success: true });
});

app.get("/api/auth/google/url", (req, res) => {
  const userId = req.session?.userId || req.query.uid as string;
  const isLoginFlow = !userId;

  // Construct Redirect URI
  let appUrl = process.env.APP_URL as string;
  if (appUrl.endsWith("/")) {
    appUrl = appUrl.slice(0, -1);
  }
  // Use /api/auth/callback to align with GOOGLE_API_SETUP.md and solve redirect_uri_mismatch
  const redirectUri = `${appUrl}/api/auth/callback`;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  const scope = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ];

  const stateNonce = crypto.randomBytes(16).toString('hex');
  req.session!.oauthState = stateNonce;
  req.session!.oauthTargetUserId = userId;
  req.session!.oauthIsLoginFlow = isLoginFlow;

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope,
    prompt: "consent",
    state: stateNonce
  });

  res.json({ url: authUrl });
});

app.get(["/auth/callback", "/auth/callback/", "/api/auth/callback", "/api/auth/callback/"], async (req, res) => {
  const { code, state } = req.query;
  if (!code) {
    return res.status(400).send("No authentication code received.");
  }

  if (!state || state !== req.session?.oauthState) {
    return res.status(400).send("Invalid state parameter (CSRF detected).");
  }

  let appUrl = process.env.APP_URL as string;
  if (appUrl.endsWith("/")) {
    appUrl = appUrl.slice(0, -1);
  }
  // Determine path to match the current request path (either /auth/callback or /api/auth/callback)
  const pathUsed = req.path.includes("/api/") ? "/api/auth/callback" : "/auth/callback";
  const redirectUri = `${appUrl}${pathUsed}`;

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );

    const { tokens } = await oauth2Client.getToken(code as string);
    oauth2Client.setCredentials(tokens);

    let finalUserId: string | null = null;
    let safeUser: any = null;

    const isLoginFlow = req.session?.oauthIsLoginFlow;
    let targetUserId = req.session?.oauthTargetUserId;

    // Fetch user info from Google
    let email = "";
    let name = "Secure Agent";
    try {
      const oauth = google.oauth2({
        auth: oauth2Client,
        version: "v2"
      });
      const userInfo = await oauth.userinfo.get();
      email = userInfo.data.email || "";
      name = userInfo.data.name || "Secure Agent";
    } catch (e) {
      console.error("Failed to get Google user info in callback:", e);
    }

    if (isLoginFlow || !targetUserId) {
      if (!email) {
        return res.status(400).send("Failed to retrieve your email address from Google. Please try again.");
      }
      // Check if user already exists in db by email
      let existingUser = await dbService.getUserByEmail(email);
      if (!existingUser) {
        // Create user if not registered yet
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash("google-auth-pwd-" + Math.random().toString(36), salt);
        existingUser = await dbService.createUser(email, passwordHash, name);
      }
      finalUserId = existingUser.id;
      safeUser = {
        id: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
        subscription: existingUser.subscription
      };
    } else {
      finalUserId = targetUserId;
      const existingUser = await dbService.getUserById(finalUserId);
      if (existingUser) {
        safeUser = {
          id: existingUser.id,
          email: existingUser.email,
          name: existingUser.name,
          subscription: existingUser.subscription
        };
      }
    }

    if (!finalUserId) {
      return res.status(400).send("No valid user session or ID found. Please try connecting again.");
    }

    // Set the cookie session to log them in securely
    req.session!.userId = finalUserId;

    if (tokens && tokens.access_token) {
      const tokenData = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date
      };
      await dbService.saveGmailToken(finalUserId, tokenData);
      
      // Also store in userGmailTokens in memory to avoid reading from disk on every route call
      userGmailTokens[finalUserId] = tokenData;
    }

    res.send(`
      <html>
        <head>
          <title>Google Account Connected</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #0A1128; color: #FFFFFF; margin: 0; text-align: center; }
            .card { background: #121F42; padding: 40px; border-radius: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); max-width: 400px; border: 1px solid rgba(255, 136, 0, 0.2); }
            h2 { color: #FF8800; margin-top: 0; text-transform: uppercase; font-style: italic; }
            p { font-size: 14px; opacity: 0.8; line-height: 1.6; }
            .spinner { border: 4px solid rgba(255,255,255,0.1); width: 36px; height: 36px; border-radius: 50%; border-left-color: #FF8800; animation: spin 1s linear infinite; margin: 20px auto; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Bridge Established</h2>
            <p>Your Google account has been safely connected. Finalizing secure mail channels...</p>
            <div class="spinner"></div>
            <script>
              setTimeout(() => {
                if (window.opener) {
                  window.opener.postMessage({ 
                    type: 'OAUTH_AUTH_SUCCESS', 
                    token: '${tokens?.access_token || ""}', 
                    uid: '${finalUserId}',
                    user: ${safeUser ? JSON.stringify(safeUser) : 'null'}
                  }, '${appUrl}');
                  window.close();
                } else {
                  window.location.href = '/';
                }
              }, 1500);
            </script>
          </div>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error("Google Auth Callback Error:", error);
    res.status(500).send("Failed to exchange Google authentication code: " + (error.message || error));
  }
});

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
  const uid = req.session?.userId;
  if (!uid) return res.status(401).json({ error: "No UID provided" });

  const token = await getGmailTokenForUser(uid);
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

app.post("/api/auth/store-token", async (req, res) => {
  const uid = req.session?.userId;
  const { token } = req.body;
  if (!token || !uid) return res.status(400).json({ error: "Missing fields or unauthorized" });
  userGmailTokens[uid] = token;
  await dbService.saveGmailToken(uid, token);
  res.json({ success: true });
});

const messagesCache: Record<string, any> = {};

app.get("/api/gmail/messages", async (req, res) => {
  const uid = req.session?.userId;
  if (!uid) return res.status(401).json({ error: "No UID provided" });
  
  const token = await getGmailTokenForUser(uid);
  if (!token) return res.status(401).json({ error: "No Gmail token found. Please reconnect Google account." });
  
  const client = new google.auth.OAuth2();
  client.setCredentials({ access_token: token });
  
  const gmail = google.gmail({ version: "v1", auth: client });
  
  try {
    const maxResults = Math.min(parseInt(req.query.maxResults as string) || 10, 25);
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
        const cacheKey = `${uid}_${msg.id}`;
        if (messagesCache[cacheKey]) {
          return messagesCache[cacheKey];
        }

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
        
        const parsedMsg = {
          id: msg.id,
          subject,
          from,
          date,
          snippet,
          fullData: detail.data
        };
        messagesCache[cacheKey] = parsedMsg;
        return parsedMsg;
      })
    );
    
    res.json({
      messages,
      nextPageToken: response.data.nextPageToken || null
    });
  } catch (error: any) {
    console.error("Gmail fetch error:", error);
    const errStr = (error?.message || "").toLowerCase();
    if (
      errStr.includes("invalid_grant") || 
      errStr.includes("invalid credentials") || 
      errStr.includes("invalid key") || 
      error?.code === 401 || 
      error?.status === 401
    ) {
      return res.status(401).json({ error: "No Gmail token found. Please reconnect Google account." });
    }
    res.status(500).json({ error: "Failed to fetch emails" });
  }
});

app.post("/api/analyze", async (req, res) => {
  const uid = req.session?.userId;
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

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
  const uid = req.session?.userId;
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

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
