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
  console.warn("WARNING: APP_URL must be set in environment variables. Falling back to permissive CORS for development.");
}

let allowedOrigin: string | boolean = true;
if (process.env.APP_URL) {
  allowedOrigin = process.env.APP_URL;
  if (typeof allowedOrigin === 'string' && allowedOrigin.endsWith('/')) {
    allowedOrigin = allowedOrigin.slice(0, -1);
  }
}


app.use(cors({
  origin: allowedOrigin,
  credentials: true
}));

app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000, // Limit each IP to 10000 requests per `window` (here, per 15 minutes)
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: "Too many requests, please try again later." });
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: "Too many authentication requests, please try again later." });
  }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: "Too many login attempts. Please try again in 15 minutes." });
  }
});

app.use("/api/", apiLimiter);

import crypto from "crypto";

// Use a static fallback secret so serverless instances don't invalidate each other's sessions
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'mailverifier_fallback_secret_123'],
  maxAge: 24 * 60 * 60 * 1000, // 1 day default
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
3. ESTABLISH UNCERTAINTY & ANALYZE CONTENT: You will be given pre-verified technical data. Do not invent technical values (like IPs or DKIM) — use only the verified data provided. However, you MUST deeply analyze the EMAIL BODY content to detect social engineering, urgency tactics, and tone. Do not just output "Safe" statically; provide a unique analysis based on the actual message content.
4. CONSISTENT & PROFESSIONAL ARRANGEMENT: Ensure a highly structured, objective, analytical, and professional tone. Your outputs must be clean, neat, and formatted perfectly with standard Markdown, avoiding any conversational filler, casual language, or marketing hype.
5. USER-SAFETY DRIVEN: Focus on objective security risk assessment.
`;


// SSE for real-time alerts
const clients = new Map<string, any>();

app.get("/api/sse", (req, res) => {
  const uid = req.session?.userId || req.query.uid as string;
  if (!uid) return res.status(401).send("Unauthorized");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  clients.set(uid, res);

  req.on("close", () => {
    clients.delete(uid);
  });
});

export function sendRealtimeAlert(uid: string, alertData: any) {
  const client = clients.get(uid);
  if (client) {
    client.write(`data: ${JSON.stringify(alertData)}\n\n`);
  }
}

// Start Gmail Watch
app.post("/api/gmail/watch", async (req, res) => {
  const uid = req.session?.userId || req.headers['x-firebase-uid'] as string;
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  const token = await getValidToken(uid);
  if (!token) return res.status(401).json({ error: "No valid Gmail token" });

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ access_token: token });
  const gmail = google.gmail({ version: "v1", auth });

  try {
    const topicName = process.env.PUBSUB_TOPIC_NAME || "projects/ai-studio-mailverifier/topics/gmail-push";
    const watchRes = await gmail.users.watch({
      userId: "me",
      requestBody: {
        topicName,
        labelIds: ["INBOX"],
      }
    });
    
    await dbService.updateUser(uid, { gmailHistoryId: watchRes.data.historyId } as any);
    res.json({ success: true, historyId: watchRes.data.historyId });
  } catch (err: any) {
    console.error("Failed to start Gmail watch:", err);
    // Ignore error if topic doesn't exist, just return success so frontend doesn't break
    res.json({ success: false, error: err.message });
  }
});

// Pub/Sub Webhook for Gmail Push Notifications
app.post("/api/gmail/webhook", async (req, res) => {
  try {
    const message = req.body.message;
    if (!message || !message.data) {
      return res.status(400).send("Bad Request");
    }

    const data = JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'));
    const emailAddress = data.emailAddress;
    const newHistoryId = data.historyId;

    if (!emailAddress) return res.status(200).send("OK");

    const user = await dbService.getUserByEmail(emailAddress);
    if (!user) return res.status(200).send("User not found");

    const token = await getValidToken(user.id);
    if (!token) return res.status(200).send("OK");

    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({ access_token: token });
    const gmail = google.gmail({ version: "v1", auth });
    
    // In db, we would store startHistoryId for the user, but we will just fetch the latest history
    // Since we can't reliably know the old historyId without adding it to the db, let's assume we added it.
    const oldHistoryId = (user as any).gmailHistoryId || Math.max(0, parseInt(newHistoryId) - 100).toString();
    
    const historyRes = await gmail.users.history.list({
      userId: "me",
      startHistoryId: oldHistoryId,
      historyTypes: ["messageAdded"]
    });

    if (historyRes.data.history) {
      for (const historyItem of historyRes.data.history) {
        if (historyItem.messagesAdded) {
          for (const msgAdded of historyItem.messagesAdded) {
            const msg = await gmail.users.messages.get({
              userId: "me",
              id: msgAdded.message!.id!,
              format: "full"
            });
            
            // Extract basic fields
            const headers = msg.data.payload?.headers || [];
            const getHeader = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";
            
            const emailData = {
              subject: getHeader("subject"),
              senderName: getHeader("from").split("<")[0].trim() || getHeader("from"),
              senderEmail: getHeader("from").match(/<([^>]+)>/)?.[1] || getHeader("from"),
              body: msg.data.snippet || "",
              headers: JSON.stringify(headers)
            };

            // Run analysis
            const aiData = await analyzeEmailHelper(emailData, "SINGLE_EMAIL_VIEW", user.id);
            if (aiData?.ai_risk_engine?.final_risk_classification && 
                ["Suspicious", "Likely Phishing", "Phishing"].includes(aiData.ai_risk_engine.final_risk_classification)) {
              
              sendRealtimeAlert(user.id, {
                type: "THREAT_DETECTED",
                message: `Suspicious email received from ${emailData.senderEmail}`,
                classification: aiData.ai_risk_engine.final_risk_classification
              });
            }
          }
        }
      }
    }

    await dbService.updateUser(user.id, { gmailHistoryId: newHistoryId } as any);
    res.status(200).send("OK");
  } catch (err: any) {
    console.error("Webhook error:", err);
    res.status(200).send("OK"); // Acknowledge pub/sub to prevent retries
  }
});

// Cron Endpoint to renew watches
app.get("/api/cron/renew-watches", async (req, res) => {
  const users = await dbService.getAllUsers();
  for (const user of users) {
    const token = await getValidToken(user.id);
    if (token) {
      try {
        const auth = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET
        );
        auth.setCredentials({ access_token: token });
        const gmail = google.gmail({ version: "v1", auth });
        const topicName = process.env.PUBSUB_TOPIC_NAME || "projects/ai-studio-mailverifier/topics/gmail-push";
        const watchRes = await gmail.users.watch({
          userId: "me",
          requestBody: {
            topicName,
            labelIds: ["INBOX"],
          }
        });
        await dbService.updateUser(user.id, { gmailHistoryId: watchRes.data.historyId } as any);
      } catch(e) {
        // ignore
      }
    }
  }
  res.send("Watches renewed");
});

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

    // Generate verification token
    const token = crypto.randomBytes(32).toString("hex");
    await dbService.updateUser(user.id, { verificationToken: token, isVerified: false });
    console.log("\n\n=== ACTION REQUIRED ===\nPlease verify your email by opening this link:");
    console.log(`http://localhost:3000/api/auth/verify?token=${token}&email=${encodeURIComponent(email)}`);
    console.log("=======================\n\n");
    res.json({ success: true, message: "Please check your email to verify your account before logging in." });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to register user" });
  }
});

app.get("/api/auth/verify", async (req, res) => {
  const { email, token } = req.query;
  if (!email || !token || typeof email !== 'string' || typeof token !== 'string') {
    return res.status(400).send("Invalid verification link.");
  }
  try {
    const user = await dbService.getUserByEmail(email);
    if (!user) {
      return res.status(400).send("User not found.");
    }
    if (user.isVerified) {
      return res.send("Account already verified. You can now log in.");
    }
    if (user.verificationToken !== token) {
      return res.status(400).send("Invalid verification token.");
    }
    await dbService.updateUser(user.id, { isVerified: true, verificationToken: undefined });
    res.send("Email verified successfully! You can now log in.");
  } catch (error) {
    res.status(500).send("Failed to verify email.");
  }
});
app.post("/api/auth/login", loginLimiter, async (req, res) => {
  const { email, password, rememberMe } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const user = await dbService.getUserByEmail(email);
    if (!user) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      return res.status(403).json({ error: "Account is temporarily locked due to too many failed attempts. Try again later." });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      const attempts = (user.failedLoginAttempts || 0) + 1;
      let lockedUntil = null;
      if (attempts >= 5) {
        lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      }
      await dbService.updateUser(user.id, { failedLoginAttempts: attempts, lockedUntil });
      return res.status(400).json({ error: "Invalid email or password" });
    }

    if (user.isVerified === false) {
      return res.status(403).json({ error: "Please verify your email address before logging in." });
    }

    // Reset failed attempts on success
    if (user.failedLoginAttempts! > 0) {
      await dbService.updateUser(user.id, { failedLoginAttempts: 0, lockedUntil: null });
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
  const userId = req.session?.userId || req.headers['x-firebase-uid'] as string;
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
  const userId = req.session?.userId || req.headers['x-firebase-uid'] as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { subscription } = req.body;
  if (!subscription) return res.status(400).json({ error: "Missing subscription data" });

  const updatedUser = await dbService.updateUserSubscription(userId, subscription);
  if (!updatedUser) return res.status(404).json({ error: "User not found" });

  res.json({ success: true, subscription: updatedUser.subscription });
});

// Admin management endpoints
app.get("/api/admin/users", async (req, res) => {
  const currentUid = req.session?.userId || req.headers['x-firebase-uid'] as string;
  if (!currentUid) return res.status(401).json({ error: "Unauthorized" });
  const requestingUser = await dbService.getUserById(currentUid);
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
  const currentUid = req.session?.userId || req.headers['x-firebase-uid'] as string;
  if (!currentUid) return res.status(401).json({ error: "Unauthorized" });
  const requestingUser = await dbService.getUserById(currentUid);
  if (!requestingUser?.isAdmin) return res.status(403).json({ error: "Forbidden" });

  const { id } = req.params;
  const deleted = await dbService.deleteUser(id);
  if (!deleted) {
    return res.status(404).json({ error: "User not found" });
  }
  res.json({ success: true });
});

app.post("/api/admin/users/:id/subscription", async (req, res) => {
  const currentUid = req.session?.userId || req.headers['x-firebase-uid'] as string;
  if (!currentUid) return res.status(401).json({ error: "Unauthorized" });
  const requestingUser = await dbService.getUserById(currentUid);
  if (!requestingUser?.isAdmin) return res.status(403).json({ error: "Forbidden" });

  const { id } = req.params;
  const { subscription } = req.body;
  if (!subscription) return res.status(400).json({ error: "Missing subscription data" });

  const updatedUser = await dbService.updateUserSubscription(id, subscription);
  if (!updatedUser) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json({ success: true, subscription: updatedUser.subscription });
});

app.get("/api/auth/google/url", (req, res) => {
  const userId = req.session?.userId || req.headers['x-firebase-uid'] as string || req.query.uid as string;
  const isLoginFlow = !userId;

  // Construct Redirect URI
  let appUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`) as string;
  if (appUrl.endsWith("/")) {
    appUrl = appUrl.slice(0, -1);
  }
  // Use /api/auth/callback to align with GOOGLE_API_SETUP.md and solve redirect_uri_mismatch
  const redirectUri = `${appUrl}/api/auth/callback`;

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ error: "Google OAuth credentials are not configured on the server." });
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  const scope = [
    "https://www.googleapis.com/auth/gmail.modify",
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

  let appUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`) as string;
  if (appUrl.endsWith("/")) {
    appUrl = appUrl.slice(0, -1);
  }
  // Determine path to match the current request path (either /auth/callback or /api/auth/callback)
  const pathUsed = req.path.includes("/api/") ? "/api/auth/callback" : "/auth/callback";
  const redirectUri = `${appUrl}${pathUsed}`;

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).send("Google OAuth credentials are not configured on the server.");
  }

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
        subscription: existingUser.subscription,
        isAdmin: existingUser.isAdmin
      };
    } else {
      finalUserId = targetUserId;
      const existingUser = await dbService.getUserById(finalUserId);
      if (existingUser) {
        safeUser = {
          id: existingUser.id,
          email: existingUser.email,
          name: existingUser.name,
          subscription: existingUser.subscription,
          isAdmin: existingUser.isAdmin
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
            .card { background: #121F42; padding: 40px; border-radius: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); max-width: 420px; border: 1px solid rgba(255, 136, 0, 0.2); }
            h2 { color: #FF8800; margin-top: 0; text-transform: uppercase; font-style: italic; }
            p { font-size: 14px; opacity: 0.8; line-height: 1.6; }
            .spinner { border: 4px solid rgba(255,255,255,0.1); width: 36px; height: 36px; border-radius: 50%; border-left-color: #FF8800; animation: spin 1s linear infinite; margin: 20px auto; }
            .btn { display: inline-block; margin-top: 20px; background: #FF8800; color: #0A1128; text-decoration: none; padding: 12px 28px; border-radius: 14px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; font-size: 12px; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Bridge Established</h2>
            <p>Your Google account has been successfully authenticated. Redirecting to Mail Verifier AI...</p>
            <div class="spinner"></div>
            <a href="/" class="btn">Click Here If Not Redirected</a>
            <script>
              const payload = {
                type: 'OAUTH_AUTH_SUCCESS',
                token: '${tokens?.access_token || ""}',
                uid: '${finalUserId}',
                user: ${safeUser ? JSON.stringify(safeUser) : 'null'}
              };
              if (window.opener) {
                try {
                  window.opener.postMessage(payload, '*');
                } catch(e) { console.error(e); }
                setTimeout(() => {
                  try { window.close(); } catch(e) {}
                  window.location.href = '/';
                }, 1000);
              } else {
                setTimeout(() => {
                  window.location.href = '/';
                }, 800);
              }
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
  attachments = [],
  inReplyTo = "",
  references = ""
}: {
  to: string;
  subject: string;
  body: string;
  attachments?: { name: string; type: string; data: string }[];
  inReplyTo?: string;
  references?: string;
}) {
  const boundary = "FOO_BAR_BOUNDARY";
  const nl = "\r\n";

  let headerArr = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`
  ];
  if (inReplyTo) {
    headerArr.push(`In-Reply-To: ${inReplyTo}`);
  }
  if (references) {
    headerArr.push(`References: ${references}`);
  }
  headerArr.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  headerArr.push("");
  headerArr.push("");
  let header = headerArr.join(nl);

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

app.post("/api/gmail/mark-read", async (req, res) => {
  const uid = req.session?.userId || req.headers['x-firebase-uid'] as string;
  if (!uid) return res.status(401).json({ error: "No UID provided" });
  
  const { messageId } = req.body;
  if (!messageId) return res.status(400).json({ error: "Missing messageId" });

  const token = await getGmailTokenForUser(uid);
  if (!token) return res.status(401).json({ error: "No Gmail token found." });

  const client = new google.auth.OAuth2();
  client.setCredentials({ access_token: token });
  const gmail = google.gmail({ version: "v1", auth: client });

  try {
    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        removeLabelIds: ["UNREAD"],
      },
    });
    res.json({ success: true });
  } catch (error: any) {
    // Ignore or log softly if scope is insufficient
    if (error?.message?.includes("insufficient authentication scopes")) {
      console.log("mark-read skipped due to insufficient scopes (user needs to re-auth)");
    } else {
      console.error("Gmail mark-read error:", error?.message);
    }
    res.status(500).json({ error: error?.message || "Failed to mark as read" });
  }
});

app.post("/api/gmail/send", async (req, res) => {
  const uid = req.session?.userId || req.headers['x-firebase-uid'] as string;
  if (!uid) return res.status(401).json({ error: "No UID provided" });

  const token = await getGmailTokenForUser(uid);
  if (!token) return res.status(401).json({ error: "No Gmail token found. Please reconnect Google account." });

  const { to, subject, body, attachments, replyToMessageId } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: "Missing required fields (to, subject, body)" });
  }

  const client = new google.auth.OAuth2();
  client.setCredentials({ access_token: token });

  const gmail = google.gmail({ version: "v1", auth: client });

  try {
    let inReplyTo = "";
    let references = "";
    let threadId = "";
    if (replyToMessageId) {
      try {
        const origMsg = await gmail.users.messages.get({ userId: "me", id: replyToMessageId, format: "metadata", metadataHeaders: ["Message-ID", "References"] });
        const headers = origMsg.data.payload?.headers || [];
        const msgIdHeader = headers.find(h => h.name.toLowerCase() === "message-id");
        const refsHeader = headers.find(h => h.name.toLowerCase() === "references");
        if (msgIdHeader && msgIdHeader.value) {
          inReplyTo = msgIdHeader.value;
          references = refsHeader && refsHeader.value ? refsHeader.value + " " + inReplyTo : inReplyTo;
        }
        if (origMsg.data.threadId) {
          threadId = origMsg.data.threadId;
        }
      } catch (e) {
        console.warn("Could not fetch original message for threading", e);
      }
    }
    const rawMessage = buildMimeMessage({ to, subject, body, attachments, inReplyTo, references });
    const response = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: rawMessage,
        ...(threadId ? { threadId } : {})
      },
    });

    res.json({ success: true, messageId: response.data.id });
  } catch (error: any) {
    console.error("Gmail send error:", error);
    res.status(500).json({ error: error?.message || "Failed to send email" });
  }
});

app.post("/api/auth/store-token", async (req, res) => {
  const uid = req.session?.userId || req.headers['x-firebase-uid'] as string;
  const { token } = req.body;
  if (!token || !uid) return res.status(400).json({ error: "Missing fields or unauthorized" });
  userGmailTokens[uid] = token;
  await dbService.saveGmailToken(uid, token);
  res.json({ success: true });
});

const messagesCache: Record<string, any> = {};

app.get("/api/gmail/messages", async (req, res) => {
  const uid = req.session?.userId || req.headers['x-firebase-uid'] as string;
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


async function resolveTechnicalData(headersStr: string) {
  const verified = {
    spf: "NOT VERIFIED",
    dkim: "NOT VERIFIED",
    dmarc: "NOT VERIFIED",
    ip: "NOT VERIFIED",
    country: "NOT VERIFIED",
    city: "NOT VERIFIED",
    isp: "NOT VERIFIED",
    asn: "NOT VERIFIED",
    hosting_provider: "NOT VERIFIED",
    vpn_detected: false,
    proxy_detected: false,
    domain_reputation: "NOT VERIFIED"
  };
  if (!headersStr) return verified;

  const spfMatch = headersStr.match(/spf=(pass|fail|softfail|neutral|none)/i);
  if (spfMatch) verified.spf = spfMatch[1].toUpperCase();

  const dkimMatch = headersStr.match(/dkim=(pass|fail|neutral|none)/i);
  if (dkimMatch) verified.dkim = dkimMatch[1].toUpperCase();

  const dmarcMatch = headersStr.match(/dmarc=(pass|fail)/i);
  if (dmarcMatch) verified.dmarc = dmarcMatch[1].toUpperCase();

  const ipMatch = headersStr.match(/\[([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\]/);
  if (ipMatch) {
    verified.ip = ipMatch[1];
    try {
      // Free IP geolocation API
      const geoRes = await fetch(`http://ip-api.com/json/${verified.ip}?fields=status,country,city,isp,as,hosting,proxy`);
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        if (geoData.status === "success") {
          verified.country = geoData.country || "NOT VERIFIED";
          verified.city = geoData.city || "NOT VERIFIED";
          verified.isp = geoData.isp || "NOT VERIFIED";
          verified.asn = geoData.as || "NOT VERIFIED";
          verified.hosting_provider = geoData.hosting ? "Hosting/Datacenter" : "NOT VERIFIED";
          verified.vpn_detected = !!geoData.proxy;
          verified.proxy_detected = !!geoData.proxy;
        }
      }
    } catch (e) {
      console.warn("Failed to fetch IP geo data", e);
    }
  }
  return verified;
}

async function analyzeEmailHelper(data: any, mode: string, uid: string) {
  let prompt = "";

  if (mode === "INBOX_SCAN") {
    const emailList = Array.isArray(data) ? data : [data];
    prompt = `MODE: INBOX_SCAN
INPUT: A list of emails.
TASK: For EACH email return: classification (Safe, Likely Safe, Suspicious, Likely Phishing, Phishing), risk_score (0–100), severity (Low, Medium, High, Critical), short_reason (max 15 words).
OUTPUT FORMAT: JSON array of objects with keys: subject, sender, classification, risk_score, severity, short_reason.
EMAILS: ${JSON.stringify(emailList.map(e => ({ subject: e.subject, sender_name: e.senderName, sender_email: e.senderEmail, short_snippet: e.body.substring(0, 200) })))}`;
  } else if (mode === "REALTIME_ALERT") {
    const singleData = Array.isArray(data) ? data[0] : data;
    prompt = `MODE: REALTIME_ALERT
INPUT: subject, sender_name, sender_email, short_snippet.
TASK: Return a short alert message.
OUTPUT: JSON object with keys: alert_type (Safe, Warning, Danger), message (max 20 words), action_hint (max 10 words).
EMAIL: ${JSON.stringify({ subject: singleData.subject, sender_name: singleData.senderName, sender_email: singleData.senderEmail, short_snippet: singleData.body.substring(0, 200) })}`;
  } else {
    const singleData = Array.isArray(data) ? data[0] : data;
    const technicalData = await resolveTechnicalData(singleData.headers || "");
    prompt = `MODE: SINGLE_EMAIL_VIEW
INPUT: subject, full_body, sender_name, sender_email, reply_to, links, headers.
VERIFIED_TECHNICAL_DATA: ${JSON.stringify(technicalData)}
TASK: Perform a complete, highly accurate audit of the email. You will be given pre-verified technical data in VERIFIED_TECHNICAL_DATA.
CRITICAL: Do NOT invent, guess, or hallucinate any technical values (like SPF, DKIM, IPs, locations, ISPs, VPNs, or Threat Intel). You MUST ONLY summarize the verified data provided. If a specific data point says "NOT VERIFIED" or is not provided, you MUST output "NOT VERIFIED" for that field. 
CRITICAL: For the content analysis (urgency tactics, credential theft, typosquatting), you MUST deeply analyze the BODY content and subject of the specific email provided. Do not use static responses. Base your threat and risk scores on actual detected text patterns in the BODY.

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
    "ip_address": string | "NOT VERIFIED",
    "country": string | "NOT VERIFIED",
    "region": string | "NOT VERIFIED",
    "city": string | "NOT VERIFIED",
    "isp": string | "NOT VERIFIED",
    "asn": string | "NOT VERIFIED",
    "hosting_provider": string | "NOT VERIFIED",
    "vpn_detected": boolean | "NOT VERIFIED",
    "proxy_detected": boolean | "NOT VERIFIED",
    "datacenter_detected": boolean | "NOT VERIFIED"
  },
  "sender_identity_analysis": {
    "display_name": string | null,
    "actual_email": string | null,
    "name_domain_mismatch": boolean,
    "executive_impersonation": boolean,
    "brand_impersonation": boolean,
    "new_domain_detected": boolean
  },
  "authentication_analysis": {
    "spf_record": string | "NOT VERIFIED",
    "dkim_signature": string | "NOT VERIFIED",
    "dmarc_policy": string | "NOT VERIFIED",
    "domain_alignment": boolean | "NOT VERIFIED"
  },
  "link_and_content_analysis": {
    "suspicious_links_detected": boolean | "NOT VERIFIED",
    "url_shortener_used": boolean | "NOT VERIFIED",
    "homograph_attack_detected": boolean | "NOT VERIFIED",
    "domain_similarity_score": number | "NOT VERIFIED"
  },
  "email_routing_analysis": {
    "route_tracing_possible": boolean,
    "hop_count": number | null,
    "route_anomaly_detected": boolean
  },
  "threat_intelligence": {
    "phishing_domain_match": boolean | "NOT VERIFIED",
    "malware_hosting_match": boolean | "NOT VERIFIED",
    "spam_reputation_match": boolean | "NOT VERIFIED",
    "blacklist_match": boolean | "NOT VERIFIED"
  },
  "social_engineering_detection": {
    "urgency_tactics": boolean | "NOT VERIFIED",
    "fear_tactics": boolean | "NOT VERIFIED",
    "authority_impersonation": boolean | "NOT VERIFIED",
    "credential_theft_attempt": boolean | "NOT VERIFIED",
    "payment_fraud_attempt": boolean | "NOT VERIFIED",
    "invoice_scam": boolean | "NOT VERIFIED",
    "bec_detected": boolean | "NOT VERIFIED"
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
  "summary_markdown": "string"
}
`;
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const modelsToTry = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-8b",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
  ];

  let success = false;
  let responseText = "";
  let lastError = null;

  for (const model of modelsToTry) {
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      try {
        const response = await ai.models.generateContent({
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
        break;
      } catch (err: any) {
        attempts++;
        lastError = err;
        if (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }
    if (success) break;
  }

  if (!success) {
    throw new Error("All AI models failed");
  }

  return JSON.parse(responseText.trim().replace(/^\s*```json/m, "").replace(/```\s*$/m, ""));
}

app.post("/api/analyze", async (req, res) => {
  const uid = req.session?.userId || req.headers['x-firebase-uid'] as string;
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  const { data, mode } = req.body;
  if (!data || !mode) return res.status(400).json({ error: "Missing data or mode" });

  try {
    const result = await analyzeEmailHelper(data, mode, uid);
    res.json({ result });
  } catch(e: any) {
    res.status(500).json({ error: "AI Analysis failed" });
  }
});


app.post("/api/chat-message", async (req, res) => {
  const uid = req.session?.userId || req.headers['x-firebase-uid'] as string;
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
    const modelsToTry = ["gemini-3.6-flash", "gemini-3.1-pro-preview"];
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
