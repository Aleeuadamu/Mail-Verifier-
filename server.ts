import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { google } from "googleapis";
import cookieSession from "cookie-session";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";

dotenv.config();

const app = express();
const PORT = 3000;

const userGmailTokens: Record<string, string> = {};

app.use(express.json());
// Remove cookie-session since we rely on Firebase auth

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

    const response = await gmail.users.messages.list({
      userId: "me",
      maxResults,
      q,
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
    
    res.json(messages);
  } catch (error) {
    console.error("Gmail fetch error:", error);
    res.status(500).json({ error: "Failed to fetch emails" });
  }
});

// Start Server with Vite
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
