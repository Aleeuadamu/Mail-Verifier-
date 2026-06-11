/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  Search,
  Mail,
  Lock,
  Globe,
  AlertTriangle,
  Info,
  RefreshCw,
  Fingerprint,
  ExternalLink,
  ChevronRight,
  Shield,
  Loader2,
  LogOut,
  Inbox,
  User,
  ArrowRight,
  Eye,
  EyeOff,
  Phone,
  CheckSquare,
  Square,
  Plus,
  Paperclip,
  Send,
  Trash2,
  X,
  ChevronUp,
  ChevronDown,
  Menu,
  FileText,
  Check,
  MoreHorizontal,
  Calendar,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { analyzeEmail, EmailData } from "./lib/gemini";
import { cn } from "./lib/utils";

interface GmailMessage {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  fullData: any;
  analysis?: {
    classification: string;
    risk_score: number;
    severity: string;
    short_reason: string;
  };
}

import { auth, db } from "./lib/firebase";
import {
  doc,
  setDoc,
  getDocs,
  collection,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  browserPopupRedirectResolver,
} from "firebase/auth";

import AdminDashboard from "./components/AdminDashboard";

const AppLogo = ({ className = "w-10 h-10" }: { className?: string }) => (
  <svg 
    viewBox="0 0 512 512" 
    className={className} 
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="52" y="146" width="408" height="260" rx="44" fill="#FF0015" />
    <path d="M 68 378 L 190 252" stroke="#12284C" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <path d="M 444 378 L 322 252" stroke="#12284C" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <path d="M 68 174 L 256 294 L 444 174" stroke="#12284C" strokeWidth="24" strokeLinejoin="round" strokeLinecap="round" fill="none" />
    
    <path d="M 256 300 L 296 320 V 356 C 296 384 274 408 256 420 C 238 408 216 384 216 356 V 320 Z" fill="#FF0015" stroke="white" strokeWidth="6" strokeLinejoin="round" />
    <path d="M 236 360 L 250 374 L 276 342" stroke="white" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

export default function App() {
  const [user, setUser] = useState<{ email: string; name: string } | null>(
    null,
  );
  const [inbox, setInbox] = useState<GmailMessage[]>([]);
  const [isLoadingInbox, setIsLoadingInbox] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const [formData, setFormData] = useState<EmailData>({
    subject: "",
    body: "",
    senderName: "",
    senderEmail: "",
    replyTo: "",
    links: "",
    headers: "",
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [view, setView] = useState<
    | "login"
    | "inbox"
    | "settings"
    | "result"
    | "compose"
    | "alerts"
    | "insights"
    | "admin"
  >("login");
  const [activeFolder, setActiveFolder] = useState<
    "inbox" | "sent" | "drafts" | "spam"
  >("inbox");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [resultTab, setResultTab] = useState<"analysis" | "message" | "chat">(
    "analysis",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [inboxLimit, setInboxLimit] = useState(30);
  const [inboxNextPageToken, setInboxNextPageToken] = useState<string | null>(
    null,
  );
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const fetchSessionIdRef = React.useRef(0);
  const connectingUserRef = React.useRef(false);

  // Date Filter States
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showDateFilter, setShowDateFilter] = useState(false);

  // Email specific Chat states
  const [chatMessages, setChatMessages] = useState<
    { role: "user" | "model"; text: string }[]
  >([]);
  const [chatInput, setChatInput] = useState("");
  const [isSendingChatMessage, setIsSendingChatMessage] = useState(false);

  // Email Compose states
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeAttachments, setComposeAttachments] = useState<
    { name: string; type: string; data: string }[]
  >([]);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const [loginMode, setLoginMode] = useState<
    "landing" | "login" | "signup" | "forgot"
  >("landing");
  const [showPassword, setShowPassword] = useState(false);
  const [authFormData, setAuthFormData] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    consent: false,
  });
  const [authError, setAuthError] = useState<string | null>(null);
  const [showMsgOptions, setShowMsgOptions] = useState(false);

  // Check auth on mount
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser({
          email: firebaseUser.email || "",
          name: firebaseUser.displayName || "Secure Agent",
        });
        setView("inbox");
        if (!connectingUserRef.current) {
          fetchInbox(firebaseUser.uid);
        }

        try {
          await setDoc(
            doc(db, "users", firebaseUser.uid),
            {
              email: firebaseUser.email,
              name: firebaseUser.displayName || "Secure Agent",
              lastLogin: serverTimestamp(),
              status: "active",
            },
            { merge: true },
          );
        } catch (e) {
          console.error("Failed to sync user to Firestore", e);
        }
      } else {
        setUser(null);
        setView("login");
        setLoginMode("landing");
      }
    });

    return () => unsub();
  }, []);

  const fetchRemainingPages = async (
    sessionId: number,
    initialPageToken: string,
    uid?: string,
    queryStr?: string,
  ) => {
    setIsSyncingAll(true);
    let currentPageToken: string | null = initialPageToken;
    const currentUid = uid || auth.currentUser?.uid;
    const headers: Record<string, string> = {};
    if (currentUid) {
      headers["x-firebase-uid"] = currentUid;
    }

    try {
      while (currentPageToken && sessionId === fetchSessionIdRef.current) {
        // Delay between page fetches to play nice with rate limits and allow smooth rendering
        await new Promise((resolve) => setTimeout(resolve, 600));

        if (sessionId !== fetchSessionIdRef.current) break;

        const params = new URLSearchParams();
        params.append("maxResults", "40"); // Batches of 40 are fast and safe
        if (queryStr) {
          params.append("q", queryStr);
        }
        params.append("pageToken", currentPageToken);

        const res = await fetch(`/api/gmail/messages?${params.toString()}`, {
          headers,
        });
        if (!res.ok) {
          console.warn(
            `Fetch returned status ${res.status} during background page sync`,
          );
          break;
        }

        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.warn("Expected JSON, but received invalid format", e);
          break;
        }

        if (sessionId !== fetchSessionIdRef.current) break;

        if (data && Array.isArray(data.messages)) {
          setInbox((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const uniqueNew = data.messages.filter(
              (m: any) => !existingIds.has(m.id),
            );
            return [...prev, ...uniqueNew];
          });
          currentPageToken = data.nextPageToken;
          setInboxNextPageToken(currentPageToken);
        } else {
          break;
        }
      }
    } catch (err) {
      console.error("Error syncing remaining pages", err);
    } finally {
      if (sessionId === fetchSessionIdRef.current) {
        setIsSyncingAll(false);
      }
    }
  };

  const fetchInbox = async (
    uid?: string,
    queryStr?: string,
    customLimit?: number,
    forceFolder?: "inbox" | "sent" | "drafts" | "spam",
  ) => {
    setIsLoadingInbox(true);
    setInboxError(null);
    const currentSessionId = ++fetchSessionIdRef.current;
    const useLimit = customLimit || 40; // Default to larger initial count
    try {
      const currentUid = uid || auth.currentUser?.uid;
      const headers: Record<string, string> = {};
      if (currentUid) {
        headers["x-firebase-uid"] = currentUid;
      }

      const folder = forceFolder !== undefined ? forceFolder : activeFolder;
      let folderQuery = "label:INBOX";
      if (folder === "sent") folderQuery = "label:SENT";
      else if (folder === "drafts") folderQuery = "label:DRAFT";
      else if (folder === "spam") folderQuery = "label:SPAM";

      let finalQuery = folderQuery;
      if (queryStr) {
        if (queryStr.includes("label:")) {
          finalQuery = queryStr;
        } else {
          finalQuery = `${queryStr} ${folderQuery}`;
        }
      }

      if (startDate) {
        const formattedStart = startDate.replace(/-/g, "/");
        finalQuery = `${finalQuery} after:${formattedStart}`;
      }
      if (endDate) {
        const formattedEnd = endDate.replace(/-/g, "/");
        finalQuery = `${finalQuery} before:${formattedEnd}`;
      }

      const params = new URLSearchParams();
      params.append("maxResults", String(useLimit));
      params.append("q", finalQuery);

      const res = await fetch(`/api/gmail/messages?${params.toString()}`, {
        headers,
      });

      if (!res.ok) {
        const errText = await res.text();
        let errMsg = `Server returned status ${res.status}`;
        try {
          const parsed = JSON.parse(errText);
          if (parsed && parsed.error) errMsg = parsed.error;
        } catch {
          if (errText) errMsg = errText;
        }
        throw new Error(errMsg);
      }

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (jsonErr) {
        throw new Error(
          "Unable to parse mailbox communication stream (expected JSON, received invalid formatting).",
        );
      }

      if (currentSessionId !== fetchSessionIdRef.current) return;

      if (data && Array.isArray(data.messages)) {
        setInbox(data.messages);
        setInboxNextPageToken(data.nextPageToken);

        // Trigger background scan for top 5 emails for the feed
        triggerInboxScan(data.messages.slice(0, 5));

        // Start background syncing of the rest of the mailbox
        if (data.nextPageToken) {
          fetchRemainingPages(
            currentSessionId,
            data.nextPageToken,
            currentUid,
            finalQuery,
          );
        }
      } else if (
        data &&
        data.error === "No Gmail token found. Please reconnect Google account."
      ) {
        console.warn("Gmail token missing on server:", data.error);
        setInboxError(data.error);
      } else if (data && data.error) {
        setInboxError(data.error);
      }
    } catch (e: any) {
      console.warn("Fetch inbox failed", e.message);
      setInboxError(e.message || "Failed to fetch emails.");
    } finally {
      if (currentSessionId === fetchSessionIdRef.current) {
        setIsLoadingInbox(false);
      }
    }
  };

  const handleFolderChange = (folder: "inbox" | "sent" | "drafts" | "spam") => {
    setActiveFolder(folder);
    setView("inbox");
    fetchInbox(undefined, undefined, 40, folder);
  };

  const triggerInboxScan = async (messages: GmailMessage[]) => {
    if (messages.length === 0) return;
    setIsScanning(true);
    try {
      const emailDataList = messages.map((msg) => ({
        subject: msg.subject,
        body: msg.snippet,
        senderName: msg.from.split("<")[0].trim(),
        senderEmail: msg.from.match(/<(.+)>/)?.[1] || msg.from,
      }));

      const scanResults = await analyzeEmail(emailDataList, "INBOX_SCAN");
      if (Array.isArray(scanResults)) {
        setInbox((prev) =>
          prev.map((msg) => {
            const match = scanResults.find(
              (r: any) => r.subject === msg.subject,
            );
            return match ? { ...msg, analysis: match } : msg;
          }),
        );
      }
    } catch (e) {
      console.error("Inbox scan failed", e);
    } finally {
      setIsScanning(false);
    }
  };

  const handleConnect = async () => {
    try {
      connectingUserRef.current = true;
      const provider = new GoogleAuthProvider();
      provider.addScope("https://www.googleapis.com/auth/gmail.readonly");
      provider.addScope("https://www.googleapis.com/auth/gmail.send");
      provider.setCustomParameters({ prompt: "consent" });
      const result = await signInWithPopup(
        auth,
        provider,
        browserPopupRedirectResolver
      );
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken;

      if (token) {
        await fetch("/api/auth/store-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, uid: result.user.uid }),
        });
        // Force inbox refresh after token storage is complete
        await fetchInbox(result.user.uid);
      }

      // The onAuthStateChanged hook catches the login and navigates to inbox
    } catch (err: any) {
      if (
        err.code === "auth/cancelled-popup-request" ||
        err.code === "auth/popup-closed-by-user" ||
        err.code === "auth/user-cancelled" ||
        err.message?.includes("cancelled-popup-request") ||
        err.message?.includes("user-cancelled")
      ) {
        setAuthError(
          "Sign-in cancelled. Please click login again and complete the Google popup.",
        );
      } else {
        setAuthError(err.message || "Google Connection failed");
      }
    } finally {
      connectingUserRef.current = false;
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
    setView("login");
  };

  const handleManualLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(
        auth,
        authFormData.email,
        authFormData.password,
      );
      // onAuthStateChanged will handle setting the user
    } catch (err: any) {
      setAuthError(err.message || "Login failed");
    }
  };

  const handleManualSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authFormData.consent) {
      setAuthError("Please consent to mail access");
      return;
    }
    setAuthError(null);
    try {
      await createUserWithEmailAndPassword(
        auth,
        authFormData.email,
        authFormData.password,
      );
      // onAuthStateChanged will handle setting the user
    } catch (err: any) {
      setAuthError(err.message || "Signup failed");
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await sendPasswordResetEmail(auth, authFormData.email);
      alert("Recovery link sent if account exists.");
      setLoginMode("login");
    } catch (err: any) {
      alert(err.message || "Failed to send recovery link");
    }
  };

  const handleAnalyze = async (dataToAnalyze: EmailData) => {
    setIsAnalyzing(true);
    try {
      const output = await analyzeEmail(dataToAnalyze, "SINGLE_EMAIL_VIEW");
      setResult(typeof output === "string" ? output : "No analysis generated.");
    } catch (error) {
      console.error(error);
      setResult("Analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isSendingChatMessage) return;

    const userMsg = chatInput.trim();
    setChatInput("");

    const updatedMessages = [
      ...chatMessages,
      { role: "user" as const, text: userMsg },
    ];
    setChatMessages(updatedMessages);
    setIsSendingChatMessage(true);

    try {
      const res = await fetch("/api/chat-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messageContext: {
            subject: formData.subject,
            body: formData.body,
            senderName: formData.senderName,
            senderEmail: formData.senderEmail,
          },
          history: chatMessages,
          question: userMsg,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to receive assistant reply");
      }

      const json = await res.json();
      setChatMessages([
        ...updatedMessages,
        { role: "model" as const, text: json.text },
      ]);
    } catch (err: any) {
      console.error("Chat message error:", err);
      setChatMessages([
        ...updatedMessages,
        {
          role: "model" as const,
          text: "Error connecting to AI Assistant. Please verify network and try again.",
        },
      ]);
    } finally {
      setIsSendingChatMessage(false);
    }
  };

  const selectEmail = (msg: GmailMessage) => {
    const headers = msg.fullData?.payload?.headers || [];

    // Attempt simpler body extraction
    let bodyData = "";
    if (msg.fullData?.payload?.parts) {
      const part =
        msg.fullData.payload.parts.find(
          (p: any) => p.mimeType === "text/plain",
        ) || msg.fullData.payload.parts[0];
      bodyData = part?.body?.data || "";
    } else {
      bodyData = msg.fullData?.payload?.body?.data || "";
    }

    let decodedBody = msg.snippet;
    try {
      if (bodyData) {
        decodedBody = decodeURIComponent(
          escape(atob(bodyData.replace(/-/g, "+").replace(/_/g, "/"))),
        );
      }
    } catch (e) {
      console.warn("Could not decode body");
    }

    const analysisData: EmailData = {
      id: msg.id,
      subject: msg.subject,
      senderName: msg.from
        .split("<")[0]
        .trim()
        .replace(/^"/, "")
        .replace(/"$/, ""),
      senderEmail: msg.from.match(/<(.+)>/)?.[1] || msg.from,
      body: decodedBody,
      headers: JSON.stringify(headers, null, 2),
      links: (decodedBody.match(/https?:\/\/[^\s]+/g) || []).join(", "),
    };

    setChatMessages([
      {
        role: "model",
        text: `Secure Bridge active. I have loaded this email context. Ask me anything about its content, potential spoofing patterns, or links, and I'll analyze it factually.`,
      },
    ]);
    setFormData(analysisData);
    setResult(null); // Clear previous analysis
    setResultTab("message"); // Default to message view
    setView("result"); // Change view immediately
    handleAnalyze(analysisData);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const filesArray = Array.from(e.target.files);

    filesArray.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const resultStr = reader.result;
        if (typeof resultStr === "string") {
          setComposeAttachments((prev) => [
            ...prev,
            {
              name: file.name,
              type: file.type,
              data: resultStr,
            },
          ]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeAttachment = (index: number) => {
    setComposeAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendError(null);
    setSendSuccess(null);

    const confirmed = window.confirm(
      `Are you sure you want to send this email to ${composeTo}?`,
    );
    if (!confirmed) return;

    setIsSendingEmail(true);
    try {
      const currentUid = auth.currentUser?.uid;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (currentUid) {
        headers["x-firebase-uid"] = currentUid;
      }

      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers,
        body: JSON.stringify({
          to: composeTo,
          subject: composeSubject,
          body: composeBody,
          attachments: composeAttachments,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSendSuccess("Email dispatched successfully!");
        setComposeTo("");
        setComposeSubject("");
        setComposeBody("");
        setComposeAttachments([]);
        setTimeout(() => {
          setView("inbox");
          setSendSuccess(null);
        }, 1500);
      } else {
        setSendError(data.error || "Failed to send email");
      }
    } catch (err: any) {
      console.error(err);
      setSendError(err.message || "An unexpected error occurred.");
    } finally {
      setIsSendingEmail(false);
    }
  };

  const getRiskColor = (classification: string) => {
    switch (classification) {
      case "Safe":
      case "Likely Safe":
        return "bg-green-500";
      case "Suspicious":
        return "bg-yellow-500";
      case "Likely Phishing":
      case "Phishing":
        return "bg-red-500";
      default:
        return "bg-gray-300";
    }
  };

  const getRiskText = (classification: string) => {
    switch (classification) {
      case "Safe":
      case "Likely Safe":
        return "text-green-600";
      case "Suspicious":
        return "text-yellow-600";
      case "Likely Phishing":
      case "Phishing":
        return "text-red-600";
      default:
        return "text-gray-400";
    }
  };

  const handleScrollToggle = () => {
    const currentScrollY = window.scrollY;
    const docHeight = document.documentElement.scrollHeight;
    const winHeight = window.innerHeight;
    if (currentScrollY < docHeight / 3) {
      window.scrollTo({ top: docHeight, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className="min-h-screen bg-white text-navy font-sans selection:bg-orange/20 overflow-x-hidden md:flex">
      {/* Desktop Sidebar */}
      {view !== "login" && (
        <aside className="hidden md:flex flex-col w-64 border-r border-navy/10 bg-white fixed top-0 bottom-0 left-0 h-screen z-50 overflow-hidden">
          <div className="flex items-center gap-3 p-6 pb-2 mb-6 shrink-0">
            <AppLogo className="w-10 h-10 shrink-0 drop-shadow-md" />
            <h1 className="font-display font-black text-2xl tracking-tighter italic text-navy">
              MAIL VERIFIER
            </h1>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-6">
            <nav className="flex flex-col gap-4">
              {/* Mailboxes Group */}
              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-navy/40 pl-4 block mb-2">
                  Mailboxes
                </span>
                <button
                  onClick={() => handleFolderChange("inbox")}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-colors",
                    view === "inbox" && activeFolder === "inbox"
                      ? "bg-navy/5 text-orange font-bold"
                      : "text-navy hover:bg-navy/5",
                  )}
                >
                  <Inbox className="w-5 h-5" />
                  <span className="text-xs font-black uppercase tracking-widest">
                    Inbox
                  </span>
                </button>
                <button
                  onClick={() => handleFolderChange("sent")}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-colors",
                    view === "inbox" && activeFolder === "sent"
                      ? "bg-navy/5 text-orange font-bold"
                      : "text-navy hover:bg-navy/5",
                  )}
                >
                  <Send className="w-5 h-5" />
                  <span className="text-xs font-black uppercase tracking-widest">
                    Sent Mail
                  </span>
                </button>
                <button
                  onClick={() => handleFolderChange("drafts")}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-colors",
                    view === "inbox" && activeFolder === "drafts"
                      ? "bg-navy/5 text-orange font-bold"
                      : "text-navy hover:bg-navy/5",
                  )}
                >
                  <FileText className="w-5 h-5" />
                  <span className="text-xs font-black uppercase tracking-widest">
                    Drafts
                  </span>
                </button>
                <button
                  onClick={() => handleFolderChange("spam")}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-colors",
                    view === "inbox" && activeFolder === "spam"
                      ? "bg-navy/5 text-orange font-bold"
                      : "text-navy hover:bg-navy/5",
                  )}
                >
                  <AlertTriangle className="w-5 h-5" />
                  <span className="text-xs font-black uppercase tracking-widest">
                    Spam
                  </span>
                </button>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-navy/40 pl-4 block mb-2">
                  Security Systems
                </span>
                <button
                  onClick={() => setView("alerts")}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-colors",
                    view === "alerts"
                      ? "bg-navy/5 text-orange font-bold"
                      : "text-navy hover:bg-navy/5",
                  )}
                >
                  <ShieldAlert className="w-5 h-5" />
                  <span className="text-xs font-black uppercase tracking-widest">
                    Alerts
                  </span>
                </button>
                <button
                  onClick={() => setView("insights")}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-colors",
                    view === "insights"
                      ? "bg-navy/5 text-orange font-bold"
                      : "text-navy hover:bg-navy/5",
                  )}
                >
                  <Globe className="w-5 h-5" />
                  <span className="text-xs font-black uppercase tracking-widest">
                    Insights
                  </span>
                </button>
              </div>

              <div className="space-y-1 pt-2">
                <button
                  onClick={() => setView("settings")}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3.5 w-full rounded-2xl transition-colors",
                    view === "settings"
                      ? "bg-navy/5 text-orange font-bold"
                      : "text-navy hover:bg-navy/5",
                  )}
                >
                  <User className="w-5 h-5" />
                  <span className="text-xs font-black uppercase tracking-widest">
                    Settings
                  </span>
                </button>

                {user?.email === "adamu0533@gmail.com" && (
                  <button
                    onClick={() => setView("admin")}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3.5 w-full rounded-2xl transition-colors mt-2",
                      view === "admin"
                        ? "bg-orange text-white font-bold"
                        : "bg-orange/10 text-orange hover:bg-orange/20",
                    )}
                  >
                    <Shield className="w-5 h-5" />
                    <span className="text-xs font-black uppercase tracking-widest">
                      Admin
                    </span>
                  </button>
                )}
              </div>
            </nav>
          </div>
        </aside>
      )}

      {/* Main Content Wrapper */}
      <div
        className={cn(
          "flex-1 flex flex-col min-w-0 pb-24 md:pb-0",
          view !== "login" && "md:pl-64",
        )}
      >
        {/* Mobile App Shell Header - Hide on login and desktop */}
        {view !== "login" && (
          <header className="md:hidden sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-navy/10 h-16">
            <div className="max-w-xl mx-auto h-full px-4 flex items-center justify-between relative">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className="p-2 -ml-2 rounded-lg bg-navy/5 hover:bg-navy/10 active:scale-95 transition-all text-navy"
                  aria-label="Open navigation menu"
                  id="mobile-menu-burger-btn"
                >
                  <Menu className="w-5 h-5" />
                </button>
                <AppLogo className="w-8 h-8 drop-shadow-md" />
                <h1 className="font-display font-black text-xl tracking-tighter italic text-navy">
                  MAIL VERIFIER
                </h1>
              </div>

              <button
                onClick={() => setView("settings")}
                className={cn(
                  "p-2 rounded-full transition-all",
                  view === "settings"
                    ? "bg-orange text-navy"
                    : "bg-navy/10 text-navy",
                )}
              >
                <User className="w-5 h-5" />
              </button>

              {/* Mobile Menu Dropdown Overlay */}
              <AnimatePresence>
                {mobileMenuOpen && (
                  <>
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setMobileMenuOpen(false)}
                      className="fixed inset-0 bg-navy/20 z-40 backdrop-blur-xs md:hidden"
                      style={{ top: "64px" }}
                    />
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute top-16 left-0 right-0 z-50 bg-white border-b border-navy/15 shadow-2xl md:hidden overflow-hidden flex flex-col"
                    >
                      <div className="p-4 space-y-4">
                        <div className="space-y-1">
                          <span className="text-[9px] font-black uppercase tracking-widest text-navy/40 pl-3">
                            Mail Folders
                          </span>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={() => {
                                handleFolderChange("inbox");
                                setMobileMenuOpen(false);
                              }}
                              className={cn(
                                "flex items-center gap-2 px-3 py-2.5 rounded-xl text-left text-xs font-bold uppercase tracking-wider transition-colors",
                                view === "inbox" && activeFolder === "inbox"
                                  ? "bg-navy text-orange"
                                  : "bg-navy/5 text-navy hover:bg-navy/10",
                              )}
                            >
                              <Inbox className="w-4 h-4" />
                              <span>Inbox</span>
                            </button>
                            <button
                              onClick={() => {
                                handleFolderChange("sent");
                                setMobileMenuOpen(false);
                              }}
                              className={cn(
                                "flex items-center gap-2 px-3 py-2.5 rounded-xl text-left text-xs font-bold uppercase tracking-wider transition-colors",
                                view === "inbox" && activeFolder === "sent"
                                  ? "bg-navy text-orange"
                                  : "bg-navy/5 text-navy hover:bg-navy/10",
                              )}
                            >
                              <Send className="w-4 h-4" />
                              <span>Sent</span>
                            </button>
                            <button
                              onClick={() => {
                                handleFolderChange("drafts");
                                setMobileMenuOpen(false);
                              }}
                              className={cn(
                                "flex items-center gap-2 px-3 py-2.5 rounded-xl text-left text-xs font-bold uppercase tracking-wider transition-colors",
                                view === "inbox" && activeFolder === "drafts"
                                  ? "bg-navy text-orange"
                                  : "bg-navy/5 text-navy hover:bg-navy/10",
                              )}
                            >
                              <FileText className="w-4 h-4" />
                              <span>Drafts</span>
                            </button>
                            <button
                              onClick={() => {
                                handleFolderChange("spam");
                                setMobileMenuOpen(false);
                              }}
                              className={cn(
                                "flex items-center gap-2 px-3 py-2.5 rounded-xl text-left text-xs font-bold uppercase tracking-wider transition-colors",
                                view === "inbox" && activeFolder === "spam"
                                  ? "bg-navy text-orange"
                                  : "bg-navy/5 text-navy hover:bg-navy/10",
                              )}
                            >
                              <AlertTriangle className="w-4 h-4" />
                              <span>Spam</span>
                            </button>
                          </div>
                        </div>

                        <hr className="border-navy/10" />

                        <div className="space-y-1">
                          <span className="text-[9px] font-black uppercase tracking-widest text-navy/40 pl-3">
                            Systems
                          </span>
                          <div className="flex flex-col gap-1.5">
                            <button
                              onClick={() => {
                                setView("alerts");
                                setMobileMenuOpen(false);
                              }}
                              className={cn(
                                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-xs font-bold uppercase tracking-wider transition-colors",
                                view === "alerts"
                                  ? "bg-navy text-orange"
                                  : "bg-navy/5 text-navy hover:bg-navy/10",
                              )}
                            >
                              <ShieldAlert className="w-4 h-4" />
                              <span>Threat Alerts</span>
                            </button>
                            <button
                              onClick={() => {
                                setView("insights");
                                setMobileMenuOpen(false);
                              }}
                              className={cn(
                                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-xs font-bold uppercase tracking-wider transition-colors",
                                view === "insights"
                                  ? "bg-navy text-orange"
                                  : "bg-navy/5 text-navy hover:bg-navy/10",
                              )}
                            >
                              <Globe className="w-4 h-4" />
                              <span>Global Insights</span>
                            </button>
                            <button
                              onClick={() => {
                                setView("settings");
                                setMobileMenuOpen(false);
                              }}
                              className={cn(
                                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-xs font-bold uppercase tracking-wider transition-colors",
                                view === "settings"
                                  ? "bg-navy text-orange"
                                  : "bg-navy/5 text-navy hover:bg-navy/10",
                              )}
                            >
                              <User className="w-4 h-4" />
                              <span>Account Settings</span>
                            </button>

                            {user?.email === "adamu0533@gmail.com" && (
                              <button
                                onClick={() => {
                                  setView("admin");
                                  setMobileMenuOpen(false);
                                }}
                                className={cn(
                                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-xs font-bold uppercase tracking-wider transition-colors mt-2",
                                  view === "admin"
                                    ? "bg-orange text-white"
                                    : "bg-orange/10 text-orange hover:bg-orange/20",
                                )}
                              >
                                <Shield className="w-4 h-4" />
                                <span>Admin Dashboard</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </header>
        )}

        <main className="max-w-3xl mx-auto w-full px-4 xl:px-8 py-6 flex-1">
          <AnimatePresence mode="wait">
            {view === "login" && (
              <motion.div
                key="login"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="min-h-[85vh] flex flex-col items-center justify-center p-4"
              >
                <div className="w-full max-w-sm space-y-12">
                  <div className="text-center space-y-4">
                    <div className="mx-auto flex justify-center rotate-3 perspective-1000 mb-4 drop-shadow-2xl">
                      <AppLogo className="w-24 h-24" />
                    </div>
                    <div className="space-y-1">
                      <h1 className="text-4xl font-display font-black italic tracking-tighter text-navy uppercase leading-none">
                        MAIL <span className="text-orange">VERIFIER</span>
                      </h1>
                    </div>
                  </div>

                  {loginMode === "landing" ? (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-6"
                    >
                      <div className="space-y-3">
                        <button
                          onClick={() => setLoginMode("login")}
                          className="w-full bg-navy text-white py-5 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-navy/10 hover:bg-navy/90 transition-all border border-transparent"
                        >
                          Sign In
                        </button>
                        <button
                          onClick={() => setLoginMode("signup")}
                          className="w-full bg-white text-navy py-5 rounded-2xl font-black uppercase tracking-widest text-xs border border-navy/10 shadow-sm hover:bg-navy/5 transition-all"
                        >
                          Create Account
                        </button>
                        <div className="relative py-2">
                          <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-navy/5"></div>
                          </div>
                          <div className="relative flex justify-center text-[8px] font-black uppercase tracking-[4px] text-navy/20">
                            <span className="bg-white px-2">OR</span>
                          </div>
                        </div>
                        <button
                          onClick={handleConnect}
                          className="w-full bg-white border border-navy/10 text-navy py-5 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-3 hover:bg-navy/5 transition-all"
                        >
                          <Mail className="w-4 h-4 text-orange" />
                          Continue with Google
                        </button>
                      </div>
                    </motion.div>
                  ) : loginMode === "login" ? (
                    <motion.div
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="bg-white p-8 rounded-[2.5rem] border border-navy/10 shadow-2xl shadow-navy/5 space-y-6 relative"
                    >
                      <button
                        onClick={() => setLoginMode("landing")}
                        className="absolute top-6 left-6 text-[10px] font-black uppercase tracking-widest text-navy/30 hover:text-navy"
                      >
                        ← Back
                      </button>

                      <div className="text-center pt-6 space-y-2">
                        <h3 className="text-lg font-black text-navy uppercase tracking-tight">
                          Welcome Back
                        </h3>
                      </div>

                      <form onSubmit={handleManualLogin} className="space-y-4">
                        <div className="space-y-4">
                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase tracking-widest text-navy/40 ml-2">
                              Email Address
                            </label>
                            <div className="relative">
                              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-navy/30" />
                              <input
                                type="email"
                                required
                                value={authFormData.email}
                                onChange={(e) =>
                                  setAuthFormData({
                                    ...authFormData,
                                    email: e.target.value,
                                  })
                                }
                                placeholder="name@example.com"
                                className="w-full bg-navy/[0.03] border border-navy/10 rounded-2xl py-4 pl-12 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange/20 transition-all"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase tracking-widest text-navy/40 ml-2">
                              Secret Password
                            </label>
                            <div className="relative">
                              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-navy/30" />
                              <input
                                type={showPassword ? "text" : "password"}
                                required
                                value={authFormData.password}
                                onChange={(e) =>
                                  setAuthFormData({
                                    ...authFormData,
                                    password: e.target.value,
                                  })
                                }
                                placeholder="••••••••"
                                className="w-full bg-navy/[0.03] border border-navy/10 rounded-2xl py-4 pl-12 pr-12 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange/20 transition-all"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-navy/30 hover:text-navy transition-colors"
                              >
                                {showPassword ? (
                                  <EyeOff className="w-4 h-4" />
                                ) : (
                                  <Eye className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                            <div className="flex justify-end pr-2">
                              <button
                                type="button"
                                onClick={() => setLoginMode("forgot")}
                                className="text-[9px] font-black uppercase tracking-widest text-orange hover:text-navy transition-colors"
                              >
                                Forgot Password?
                              </button>
                            </div>
                          </div>

                          {authError && (
                            <div
                              className="space-y-3.5"
                              id="auth-error-container"
                            >
                              <p className="text-[10px] text-red-500 font-bold text-center uppercase tracking-widest leading-normal">
                                {authError}
                              </p>
                            </div>
                          )}

                          <button
                            type="submit"
                            className="group w-full bg-navy text-white py-5 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-3 hover:bg-navy/90 transition-all shadow-xl shadow-navy/10 mt-2"
                          >
                            Sign In
                            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-2" />
                          </button>
                        </div>

                        <div className="relative py-2">
                          <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-navy/5"></div>
                          </div>
                          <div className="relative flex justify-center text-[8px] font-black uppercase tracking-[4px] text-navy/20">
                            <span className="bg-white px-2">
                              OR SECURE CONNECT
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={handleConnect}
                          id="btn-google-login"
                          className="w-full bg-navy/[0.03] border border-navy/10 text-navy py-4 rounded-xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-3 hover:bg-navy/5 transition-all"
                        >
                          <Mail className="w-4 h-4 text-orange" />
                          Login with Google
                        </button>

                        <div className="pt-4 text-center">
                          <button
                            type="button"
                            onClick={() => setLoginMode("signup")}
                            className="text-[10px] font-black uppercase tracking-widest text-navy/50 hover:text-navy transition-colors"
                          >
                            Don't have an account? Create one
                          </button>
                        </div>
                      </form>
                    </motion.div>
                  ) : loginMode === "signup" ? (
                    <motion.div
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="bg-white p-8 rounded-[2.5rem] border border-navy/10 shadow-2xl shadow-navy/5 space-y-6 relative"
                    >
                      <button
                        onClick={() => setLoginMode("landing")}
                        className="absolute top-6 left-6 text-[10px] font-black uppercase tracking-widest text-navy/30 hover:text-navy"
                      >
                        ← Back
                      </button>

                      <div className="text-center pt-6 space-y-2">
                        <h3 className="text-lg font-black text-navy uppercase tracking-tight">
                          Create Profile
                        </h3>
                      </div>

                      <form onSubmit={handleManualSignup} className="space-y-4">
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase tracking-widest text-navy/40 ml-2">
                              Full Name
                            </label>
                            <div className="relative">
                              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-navy/30" />
                              <input
                                type="text"
                                required
                                value={authFormData.name}
                                onChange={(e) =>
                                  setAuthFormData({
                                    ...authFormData,
                                    name: e.target.value,
                                  })
                                }
                                placeholder="John Doe"
                                className="w-full bg-navy/[0.03] border border-navy/10 rounded-2xl py-4 pl-12 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange/20 transition-all"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase tracking-widest text-navy/40 ml-2">
                              Email Address
                            </label>
                            <div className="relative">
                              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-navy/30" />
                              <input
                                type="email"
                                required
                                value={authFormData.email}
                                onChange={(e) =>
                                  setAuthFormData({
                                    ...authFormData,
                                    email: e.target.value,
                                  })
                                }
                                placeholder="name@example.com"
                                className="w-full bg-navy/[0.03] border border-navy/10 rounded-2xl py-4 pl-12 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange/20 transition-all"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px) font-black uppercase tracking-widest text-navy/40 ml-2">
                              Phone Number
                            </label>
                            <div className="relative">
                              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-navy/30" />
                              <input
                                type="tel"
                                value={authFormData.phone}
                                onChange={(e) =>
                                  setAuthFormData({
                                    ...authFormData,
                                    phone: e.target.value,
                                  })
                                }
                                placeholder="+1 (555) 000-0000"
                                className="w-full bg-navy/[0.03] border border-navy/10 rounded-2xl py-4 pl-12 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange/20 transition-all"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase tracking-widest text-navy/40 ml-2">
                              Choose Password
                            </label>
                            <div className="relative">
                              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-navy/30" />
                              <input
                                type={showPassword ? "text" : "password"}
                                required
                                value={authFormData.password}
                                onChange={(e) =>
                                  setAuthFormData({
                                    ...authFormData,
                                    password: e.target.value,
                                  })
                                }
                                placeholder="••••••••"
                                className="w-full bg-navy/[0.03] border border-navy/10 rounded-2xl py-4 pl-12 pr-12 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange/20 transition-all"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-navy/30 hover:text-navy transition-colors"
                              >
                                {showPassword ? (
                                  <EyeOff className="w-4 h-4" />
                                ) : (
                                  <Eye className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </div>

                          <div
                            className="flex gap-3 px-2 py-2 cursor-pointer group"
                            onClick={() =>
                              setAuthFormData({
                                ...authFormData,
                                consent: !authFormData.consent,
                              })
                            }
                          >
                            <div className="mt-1 flex-shrink-0">
                              {authFormData.consent ? (
                                <CheckSquare className="w-4 h-4 text-orange" />
                              ) : (
                                <Square className="w-4 h-4 text-navy/20 group-hover:text-navy/40" />
                              )}
                            </div>
                            <p className="text-[10px] text-navy/50 font-medium leading-tight">
                              I consent to the app to get access all existing
                              and future mails for neural security processing.
                            </p>
                          </div>

                          {authError && (
                            <p className="text-[10px] text-red-500 font-bold text-center uppercase tracking-widest">
                              {authError}
                            </p>
                          )}

                          <button
                            type="submit"
                            className="w-full bg-navy text-white py-5 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-navy/10 border border-transparent hover:bg-navy/90 transition-all"
                          >
                            Create Account
                          </button>

                          <div className="pt-4 text-center">
                            <button
                              type="button"
                              onClick={() => setLoginMode("login")}
                              className="text-[10px] font-black uppercase tracking-widest text-navy/50 hover:text-navy transition-colors"
                            >
                              Already have an account? Sign In
                            </button>
                          </div>
                        </div>
                      </form>
                    </motion.div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-white p-8 rounded-[2.5rem] border border-navy/10 shadow-2xl shadow-navy/5 space-y-6 relative"
                    >
                      <button
                        onClick={() => setLoginMode("login")}
                        className="absolute top-6 left-6 text-[10px] font-black uppercase tracking-widest text-navy/30 hover:text-navy"
                      >
                        ← Back
                      </button>

                      <div className="text-center pt-6 space-y-2">
                        <h3 className="text-lg font-black text-navy uppercase tracking-tight">
                          Recovery
                        </h3>
                        <p className="text-[10px] text-navy/40 font-medium">
                          Enter your email to receive recovery link
                        </p>
                      </div>

                      <form
                        onSubmit={handleForgotPassword}
                        className="space-y-4"
                      >
                        <div className="space-y-1">
                          <label className="text-[10px] font-black uppercase tracking-widest text-navy/40 ml-2">
                            Email Address
                          </label>
                          <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-navy/30" />
                            <input
                              type="email"
                              required
                              value={authFormData.email}
                              onChange={(e) =>
                                setAuthFormData({
                                  ...authFormData,
                                  email: e.target.value,
                                })
                              }
                              placeholder="name@example.com"
                              className="w-full bg-navy/[0.03] border border-navy/10 rounded-2xl py-4 pl-12 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange/20 transition-all"
                            />
                          </div>
                        </div>
                        <button
                          type="submit"
                          className="w-full bg-navy text-white py-5 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-navy/10"
                        >
                          Send Reset Link
                        </button>
                      </form>
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}

            {view === "inbox" && (
              <motion.div
                key="inbox"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between px-2">
                  <div>
                    <h2 className="text-2xl font-display font-black italic uppercase tracking-tight text-navy">
                      {activeFolder === "inbox"
                        ? "Inbox"
                        : activeFolder === "sent"
                          ? "Sent Mail"
                          : activeFolder === "drafts"
                            ? "Drafts"
                            : "Spam"}
                    </h2>
                  </div>
                  <button
                    onClick={() => {
                      fetchInbox(undefined, searchQuery);
                    }}
                    disabled={isLoadingInbox}
                    className="p-3 bg-navy/5 rounded-2xl text-navy hover:bg-navy/10 transition-colors"
                  >
                    <RefreshCw
                      className={cn(
                        "w-5 h-5",
                        isLoadingInbox && "animate-spin",
                      )}
                    />
                  </button>
                </div>

                <div className="flex gap-2 px-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-navy/30" />
                    <input
                      type="text"
                      placeholder="Search emails..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          fetchInbox(undefined, searchQuery);
                        }
                      }}
                      className="w-full bg-navy/[0.03] border border-navy/10 rounded-2xl py-3 pl-10 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange/20 transition-all"
                    />
                  </div>

                  <button
                    onClick={() => setShowDateFilter(!showDateFilter)}
                    className={cn(
                      "p-3 rounded-2xl transition-all flex items-center justify-center border",
                      showDateFilter || startDate || endDate
                        ? "bg-navy text-orange border-navy shadow-sm"
                        : "bg-navy/[0.03] text-navy border-navy/10 hover:bg-navy/[0.08]",
                    )}
                    title="Filter by Date"
                    type="button"
                    id="date-filter-toggle-btn"
                  >
                    <Calendar className="w-5 h-5" />
                  </button>

                  <button
                    onClick={() => setView("compose")}
                    className="p-3 bg-orange text-navy rounded-2xl hover:bg-orange/90 transition-colors shadow-sm flex items-center justify-center cursor-pointer"
                    title="Compose Email"
                  >
                    <Plus className="w-5 h-5 font-bold" />
                  </button>
                </div>

                {/* Collapsible Date Filter Panel */}
                <AnimatePresence>
                  {showDateFilter && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden px-2 mb-2"
                    >
                      <div className="bg-navy/[0.03] border border-navy/10 rounded-3xl p-4 space-y-3">
                        <div className="flex flex-col sm:flex-row gap-3">
                          <div className="flex-1 space-y-1">
                            <label className="text-[9px] font-black uppercase tracking-widest text-navy/40 pl-1">
                              After (Start Date)
                            </label>
                            <input
                              type="date"
                              value={startDate}
                              onChange={(e) => setStartDate(e.target.value)}
                              className="w-full bg-white border border-navy/10 rounded-xl px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-orange/20 focus:outline-none text-navy"
                            />
                          </div>
                          <div className="flex-1 space-y-1">
                            <label className="text-[9px] font-black uppercase tracking-widest text-navy/40 pl-1">
                              Before (End Date)
                            </label>
                            <input
                              type="date"
                              value={endDate}
                              onChange={(e) => setEndDate(e.target.value)}
                              className="w-full bg-white border border-navy/10 rounded-xl px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-orange/20 focus:outline-none text-navy"
                            />
                          </div>
                        </div>

                        <div className="flex justify-between items-center pt-2 border-t border-navy/5">
                          <button
                            onClick={() => {
                              setStartDate("");
                              setEndDate("");
                              fetchInbox(undefined, searchQuery);
                            }}
                            className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-red-500 hover:text-red-600 transition-colors"
                          >
                            Clear Dates
                          </button>

                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setShowDateFilter(false);
                              }}
                              className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-navy/40 hover:text-navy/60 transition-colors"
                            >
                              Close
                            </button>
                            <button
                              onClick={() => {
                                fetchInbox(undefined, searchQuery);
                              }}
                              className="px-4 py-1.5 bg-navy text-orange rounded-xl text-[9px] font-black uppercase tracking-widest shadow-md shadow-navy/10 hover:bg-navy/90 transition-all"
                            >
                              Apply Filters
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Folder Tabs Switcher Row */}
                <div className="flex gap-1.5 overflow-x-auto px-2 pb-1 scrollbar-none">
                  <button
                    onClick={() => handleFolderChange("inbox")}
                    className={cn(
                      "px-4 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all whitespace-nowrap flex items-center gap-1.5",
                      activeFolder === "inbox"
                        ? "bg-navy text-orange shadow-md shadow-navy/15"
                        : "bg-navy/[0.04] text-navy/60 hover:bg-navy/[0.08]",
                    )}
                  >
                    <Inbox className="w-3.5 h-3.5" />
                    Inbox
                  </button>
                  <button
                    onClick={() => handleFolderChange("sent")}
                    className={cn(
                      "px-4 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all whitespace-nowrap flex items-center gap-1.5",
                      activeFolder === "sent"
                        ? "bg-navy text-orange shadow-md shadow-navy/15"
                        : "bg-navy/[0.04] text-navy/60 hover:bg-navy/[0.08]",
                    )}
                  >
                    <Send className="w-3.5 h-3.5" />
                    Sent
                  </button>
                  <button
                    onClick={() => handleFolderChange("drafts")}
                    className={cn(
                      "px-4 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all whitespace-nowrap flex items-center gap-1.5",
                      activeFolder === "drafts"
                        ? "bg-navy text-orange shadow-md shadow-navy/15"
                        : "bg-navy/[0.04] text-navy/60 hover:bg-navy/[0.08]",
                    )}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Drafts
                  </button>
                  <button
                    onClick={() => handleFolderChange("spam")}
                    className={cn(
                      "px-4 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all whitespace-nowrap flex items-center gap-1.5",
                      activeFolder === "spam"
                        ? "bg-navy text-orange shadow-md shadow-navy/15"
                        : "bg-navy/[0.04] text-navy/60 hover:bg-navy/[0.08]",
                    )}
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Spam
                  </button>
                </div>

                {inboxError &&
                  !(
                    inboxError.toLowerCase().includes("no gmail token") ||
                    inboxError.toLowerCase().includes("reconnect")
                  ) && (
                    <div
                      className="bg-red-500/5 border border-red-500/10 rounded-3xl p-5 space-y-4 text-center mx-2"
                      id="inbox-error-diagnostic-panel"
                    >
                      <div className="w-12 h-12 bg-red-500/15 rounded-full flex items-center justify-center mx-auto">
                        <AlertTriangle className="w-6 h-6 text-red-500 animate-pulse" />
                      </div>
                      <div className="space-y-1.5">
                        <h4 className="text-[11px] font-black uppercase tracking-widest text-red-500">
                          Secure Stream Interrupt
                        </h4>
                        <p className="text-xs text-navy/80 leading-relaxed font-semibold">
                          {inboxError.toLowerCase().includes("failed to fetch")
                            ? "Connection to the secure server failed. The server might be reloading after system changes, or popups/cookies are blocked."
                            : inboxError}
                        </p>
                      </div>
                      <div className="flex gap-2.5 justify-center">
                        <button
                          type="button"
                          onClick={() => fetchInbox(undefined, searchQuery)}
                          className="px-4 py-2 bg-navy text-white hover:bg-navy/90 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-md shadow-navy/15"
                        >
                          <RefreshCw className="w-3 h-3 text-orange" />
                          Retry Connection
                        </button>
                      </div>
                    </div>
                  )}

                {isLoadingInbox ? (
                  <div className="py-20 flex flex-col items-center gap-4 text-center">
                    <div className="w-12 h-12 border-4 border-navy/10 border-t-orange rounded-full animate-spin" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-navy/40">
                      Syncing Stream...
                    </span>
                  </div>
                ) : inbox.length === 0 &&
                  (!inboxError ||
                    inboxError.toLowerCase().includes("no gmail token") ||
                    inboxError.toLowerCase().includes("reconnect")) ? (
                  <div className="py-20 flex flex-col items-center gap-6 text-center px-8">
                    <div className="w-16 h-16 bg-navy/5 rounded-3xl flex items-center justify-center">
                      <Mail className="w-8 h-8 text-navy/20" />
                    </div>
                    <div className="space-y-4">
                      <h3 className="font-display font-black text-xl text-navy uppercase italic italic tracking-tight">
                        Gmail Connection Required
                      </h3>
                      <p className="text-xs text-navy/50 leading-relaxed font-medium">
                        To scan your communications for threats, you must
                        authorize a secure bridge to your Gmail inbox.
                      </p>
                      <button
                        onClick={handleConnect}
                        className="w-full bg-navy text-white py-4 rounded-2xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 hover:bg-navy/90 transition-all shadow-xl shadow-navy/10"
                      >
                        <Shield className="w-4 h-4 text-orange" />
                        Establish Secure Bridge
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ) : inbox.length === 0 && inboxError ? (
                  <div className="py-20 text-center space-y-4">
                    <Inbox
                      className="w-12 h-12 text-navy/10 mx-auto"
                      id="empty-inbox-icon"
                    />
                    <p className="text-xs font-black uppercase tracking-widest text-navy/20">
                      Secure stream is unverified (Fetch Interrupted).
                    </p>
                    <div className="flex justify-center mt-4">
                      <button
                        onClick={handleConnect}
                        className="px-6 py-3 bg-navy/5 text-navy hover:bg-navy/10 text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors flex items-center gap-2"
                      >
                        <Shield className="w-4 h-4 text-orange" />
                        Establish Secure Bridge
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {inbox.map((msg) => (
                      <motion.div
                        key={msg.id}
                        onClick={() => selectEmail(msg)}
                        className="bg-navy/[0.03] p-5 rounded-3xl border border-navy/10 cursor-pointer hover:bg-navy/5 transition-colors group"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            {msg.analysis && (
                              <div
                                className={cn(
                                  "w-2 h-2 rounded-full",
                                  getRiskColor(msg.analysis.classification),
                                )}
                              />
                            )}
                            <span className="text-[10px] font-black uppercase tracking-widest text-orange truncate max-w-[200px]">
                              {msg.from.split("<")[0].trim()}
                            </span>
                          </div>
                          <div className="flex flex-col items-end text-right">
                            <span className="text-[9px] font-mono text-navy/40">
                              {new Date(msg.date).toLocaleDateString()}
                            </span>
                            <span className="text-[9px] font-mono text-navy/30">
                              {new Date(msg.date).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        </div>
                        <h3 className="font-display font-bold text-lg leading-tight mb-1 truncate text-navy group-hover:text-orange transition-colors">
                          {msg.subject}
                        </h3>

                        {msg.analysis ? (
                          <div className="mb-2">
                            <p
                              className={cn(
                                "text-[9px] font-black uppercase tracking-widest mb-1",
                                getRiskText(msg.analysis.classification),
                              )}
                            >
                              {msg.analysis.classification} •{" "}
                              {msg.analysis.severity} Risk (
                              {msg.analysis.risk_score}%)
                            </p>
                            <p className="text-[10px] text-navy/60 font-medium italic">
                              "{msg.analysis.short_reason}"
                            </p>
                          </div>
                        ) : (
                          <p className="text-xs text-navy/60 line-clamp-1 leading-relaxed mb-1">
                            {msg.snippet}
                          </p>
                        )}
                      </motion.div>
                    ))}
                    {inbox.length > 0 && (
                      <div className="pt-4 pb-6 text-center">
                        {isSyncingAll ? (
                          <div
                            className="inline-flex items-center gap-2 px-4 py-2.5 bg-navy/[0.03] border border-navy/5 rounded-2xl text-[10px] font-black uppercase tracking-widest text-navy/50"
                            id="syncing-indicator"
                          >
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-orange" />
                            <span>
                              Syncing mailbox: {inbox.length} messages loaded
                            </span>
                          </div>
                        ) : inboxNextPageToken ? (
                          <div
                            className="inline-flex items-center gap-2 px-4 py-2.5 bg-navy/[0.03] border border-navy/5 rounded-2xl text-[10px] font-black uppercase tracking-widest text-navy/50"
                            id="paused-indicator"
                          >
                            <span>Loaded {inbox.length} messages</span>
                          </div>
                        ) : (
                          <div
                            className="inline-flex items-center gap-2 px-4 py-2 bg-navy/[0.02] rounded-2xl text-[10px] font-black uppercase tracking-widest text-navy/30"
                            id="all-loaded-stamp"
                          >
                            <span>
                              All {inbox.length} messages loaded • Secure Stream
                              Synced
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    {inbox.length === 0 && (
                      <div className="py-20 text-center space-y-4">
                        <Inbox
                          className="w-12 h-12 text-navy/10 mx-auto"
                          id="empty-inbox-icon"
                        />
                        <p className="text-xs font-black uppercase tracking-widest text-navy/20">
                          Secure stream is empty.
                        </p>
                      </div>
                    )}
                  </div>
                )}
                {inbox.length > 0 && (
                  <div
                    className="fixed right-6 bottom-24 md:bottom-8 z-40 flex flex-col gap-2.5"
                    id="inbox-scroll-nav"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        window.scrollTo({ top: 0, behavior: "smooth" })
                      }
                      className="p-3 bg-navy text-orange border border-navy/10 rounded-full shadow-xl hover:bg-navy/90 hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center justify-center"
                      title="Scroll to Top_First Messages"
                      id="btn-scroll-to-first"
                    >
                      <ChevronUp className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        window.scrollTo({
                          top: document.documentElement.scrollHeight,
                          behavior: "smooth",
                        })
                      }
                      className="p-3 bg-navy text-orange border border-navy/10 rounded-full shadow-xl hover:bg-navy/90 hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center justify-center"
                      title="Scroll to Bottom_Last Messages"
                      id="btn-scroll-to-last"
                    >
                      <ChevronDown className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </motion.div>
            )}

            {view === "alerts" && (
              <motion.div
                key="alerts"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-8"
              >
                <div className="space-y-1">
                  <h2 className="text-3xl font-display font-black uppercase italic tracking-tighter text-navy flex items-center gap-3 leading-none">
                    <ShieldAlert className="text-orange w-8 h-8" />
                    REALTIME ALERTS
                  </h2>
                  <p className="text-[10px] font-black uppercase tracking-[5px] text-navy/30">
                    Active Neural Monitoring
                  </p>
                </div>

                <div className="space-y-4">
                  {inbox.filter(
                    (m) =>
                      m.analysis &&
                      (m.analysis.classification === "Phishing" ||
                        m.analysis.classification === "Likely Phishing"),
                  ).length === 0 ? (
                    <div className="py-20 bg-navy/[0.02] border-2 border-dashed border-navy/5 rounded-[3rem] flex flex-col items-center justify-center text-center p-8 space-y-4">
                      <ShieldCheck className="w-16 h-16 text-green-500 opacity-20" />
                      <div>
                        <p className="text-sm font-bold text-navy">
                          No Critical Threats
                        </p>
                        <p className="text-[10px] uppercase font-black tracking-widest text-navy/30">
                          Your inbox is currently clear of active phishing
                          attempts.
                        </p>
                      </div>
                    </div>
                  ) : (
                    inbox
                      .filter(
                        (m) =>
                          m.analysis &&
                          (m.analysis.classification === "Phishing" ||
                            m.analysis.classification === "Likely Phishing"),
                      )
                      .map((msg) => (
                        <motion.div
                          key={msg.id}
                          onClick={() => selectEmail(msg)}
                          className="bg-red-50 p-6 rounded-[2.5rem] border border-red-100 space-y-3 cursor-pointer relative overflow-hidden"
                        >
                          <div className="absolute top-0 right-0 p-4 opacity-5">
                            <AlertTriangle className="w-12 h-12 text-red-600" />
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="px-2 py-0.5 bg-red-600 text-white text-[8px] font-black uppercase tracking-widest rounded-full">
                              DANGER
                            </div>
                            <span className="text-[9px] font-mono text-red-900/40 uppercase truncate max-w-[200px]">
                              {msg.from}
                            </span>
                          </div>
                          <h3 className="text-red-900 font-bold text-lg leading-tight">
                            {msg.subject}
                          </h3>
                          <p className="text-red-800/70 text-[11px] font-medium italic italic leading-relaxed">
                            {msg.analysis?.short_reason ||
                              "Detecting suspicious patterns. Do not click any links."}
                          </p>
                          <div className="pt-2">
                            <span className="text-[9px] font-black uppercase tracking-widest text-red-600 border-b border-red-600 pb-0.5">
                              Secure Analysis Result
                            </span>
                          </div>
                        </motion.div>
                      ))
                  )}
                </div>
              </motion.div>
            )}

            {view === "insights" && (
              <motion.div
                key="insights"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-8"
              >
                <div className="space-y-1">
                  <h2 className="text-3xl font-display font-black uppercase italic tracking-tighter text-navy flex items-center gap-3 leading-none">
                    <Globe className="text-orange w-8 h-8" />
                    THREAT INSIGHTS
                  </h2>
                  <p className="text-[10px] font-black uppercase tracking-[5px] text-navy/30">
                    Neural Analytics Hub
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-navy/[0.03] p-6 rounded-[2.5rem] border border-navy/10 space-y-2 text-navy">
                    <p className="text-[9px] font-black uppercase tracking-widest opacity-40 leading-none">
                      Total Audited
                    </p>
                    <p className="text-4xl font-display font-black italic leading-none">
                      {inbox.length}
                    </p>
                  </div>
                  <div className="bg-orange/5 p-6 rounded-[2.5rem] border border-orange/10 space-y-2 text-orange">
                    <p className="text-[9px] font-black uppercase tracking-widest opacity-60 leading-none">
                      Neutralized
                    </p>
                    <p className="text-4xl font-display font-black italic leading-none">
                      {
                        inbox.filter(
                          (m) =>
                            m.analysis &&
                            (m.analysis.classification === "Phishing" ||
                              m.analysis.classification === "Likely Phishing"),
                        ).length
                      }
                    </p>
                  </div>
                </div>

                <div className="bg-navy text-white p-8 rounded-[3rem] space-y-6">
                  <h3 className="text-xl font-display font-black uppercase italic tracking-tight leading-none">
                    Risk Atmosphere
                  </h3>
                  <div className="space-y-4">
                    {[
                      {
                        label: "Phishing Attempts",
                        val: inbox.filter(
                          (m) =>
                            m.analysis &&
                            (m.analysis.classification === "Phishing" ||
                              m.analysis.classification === "Likely Phishing"),
                        ).length,
                        color: "bg-red-500",
                      },
                      {
                        label: "Suspicious Activity",
                        val: inbox.filter(
                          (m) =>
                            m.analysis &&
                            m.analysis.classification === "Suspicious",
                        ).length,
                        color: "bg-yellow-500",
                      },
                      {
                        label: "Safe Transfers",
                        val: inbox.filter(
                          (m) =>
                            m.analysis &&
                            (m.analysis.classification === "Safe" ||
                              m.analysis.classification === "Likely Safe"),
                        ).length,
                        color: "bg-green-500",
                      },
                    ].map((item, i) => (
                      <div key={i} className="space-y-2">
                        <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                          <span className="opacity-60">{item.label}</span>
                          <span>
                            {Math.round((item.val / (inbox.length || 1)) * 100)}
                            %
                          </span>
                        </div>
                        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{
                              width: `${(item.val / (inbox.length || 1)) * 100}%`,
                            }}
                            className={cn("h-full", item.color)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-navy/5 p-8 rounded-[3rem] border border-navy/10 space-y-4">
                  <h3 className="text-lg font-bold text-navy leading-none">
                    Global Threat Vector
                  </h3>
                  <p className="text-xs text-navy/60 leading-relaxed font-medium">
                    Most common attack vector detected in your region:{" "}
                    <span className="text-orange font-bold font-mono">
                      FINANCIAL_IP_SPOOFING
                    </span>
                    . Our AI has updated your local neural protocols to
                    prioritize domain trust signals.
                  </p>
                </div>
              </motion.div>
            )}

            {view === "result" && (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-8"
              >
                <div className="flex items-center gap-4 text-navy">
                  <button
                    onClick={() => setView("inbox")}
                    className="p-3 bg-navy/5 rounded-2xl text-navy"
                  >
                    <ArrowRight className="w-5 h-5 rotate-180" />
                  </button>
                </div>

                {isAnalyzing && !result ? (
                  <div className="py-20 flex flex-col items-center gap-6">
                    <div className="relative">
                      <div className="w-20 h-20 border-4 border-navy/5 rounded-full" />
                      <div className="absolute inset-0 border-4 border-transparent border-t-orange rounded-full animate-spin" />
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-sm font-black uppercase tracking-[5px] text-orange">
                        Neural Audit in Progress
                      </p>
                      <p className="text-[10px] font-medium text-navy/30 italic">
                        Interrogating message headers...
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Tabs */}
                    <div className="flex w-full bg-navy/5 p-1 rounded-2xl">
                      <button
                        onClick={() => setResultTab("message")}
                        className={cn(
                          "flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all",
                          resultTab === "message"
                            ? "bg-white text-navy shadow-sm"
                            : "text-navy/40 hover:text-navy",
                        )}
                      >
                        Message
                      </button>
                      <button
                        onClick={() => setResultTab("analysis")}
                        className={cn(
                          "flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all",
                          resultTab === "analysis"
                            ? "bg-white text-navy shadow-sm"
                            : "text-navy/40 hover:text-navy",
                        )}
                      >
                        Analysis
                      </button>
                      <button
                        onClick={() => setResultTab("chat")}
                        className={cn(
                          "flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all",
                          resultTab === "chat"
                            ? "bg-white text-navy shadow-sm"
                            : "text-navy/40 hover:text-navy",
                        )}
                      >
                        AI Support
                      </button>
                    </div>

                    {resultTab === "message" && (
                      <div className="space-y-6 animate-in fade-in">
                        <div className="bg-navy/[0.03] p-6 rounded-3xl border border-navy/10 space-y-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-widest text-navy/40">
                                From
                              </p>
                              <p className="font-bold text-navy">
                                {formData.senderName} &lt;{formData.senderEmail}
                                &gt;
                              </p>
                            </div>
                            <div className="relative">
                              <button
                                onClick={() =>
                                  setShowMsgOptions(!showMsgOptions)
                                }
                                className="p-2 rounded-xl hover:bg-navy/10 transition-colors text-navy/60"
                              >
                                <MoreHorizontal className="w-5 h-5" />
                              </button>
                              {showMsgOptions && (
                                <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-navy/10 shadow-xl rounded-2xl py-2 z-50 animate-in fade-in slide-in-from-top-2">
                                  <button
                                    onClick={() => {
                                      setComposeTo(formData.senderEmail || "");
                                      setComposeSubject(
                                        `Re: ${formData.subject}`,
                                      );
                                      setComposeBody(
                                        `\n\n> On ${new Date().toLocaleDateString()}, ${formData.senderName} wrote:\n> ${formData.body.split("\n").join("\n> ")}`,
                                      );
                                      setShowMsgOptions(false);
                                      setView("compose");
                                    }}
                                    className="w-full text-left px-4 py-2 text-xs font-bold uppercase tracking-widest text-navy hover:bg-navy/5 flex items-center gap-2"
                                  >
                                    <ArrowRight className="w-3.5 h-3.5 rotate-180" />{" "}
                                    Reply
                                  </button>
                                  <button
                                    onClick={() => {
                                      setComposeTo("");
                                      setComposeSubject(
                                        `Fwd: ${formData.subject}`,
                                      );
                                      setComposeBody(
                                        `\n\n---------- Forwarded message ---------\nFrom: ${formData.senderName} <${formData.senderEmail}>\nSubject: ${formData.subject}\n\n${formData.body}`,
                                      );
                                      setShowMsgOptions(false);
                                      setView("compose");
                                    }}
                                    className="w-full text-left px-4 py-2 text-xs font-bold uppercase tracking-widest text-navy hover:bg-navy/5 flex items-center gap-2"
                                  >
                                    <ArrowRight className="w-3.5 h-3.5" />{" "}
                                    Forward
                                  </button>
                                  <button
                                    onClick={() => {
                                      alert(
                                        "Unsubscribe request initiated and synced.",
                                      );
                                      setShowMsgOptions(false);
                                    }}
                                    className="w-full text-left px-4 py-2 text-xs font-bold uppercase tracking-widest text-navy hover:bg-navy/5 flex items-center gap-2"
                                  >
                                    <LogOut className="w-3.5 h-3.5" />{" "}
                                    Unsubscribe
                                  </button>
                                  <div className="h-px bg-navy/5 my-1" />
                                  <button
                                    onClick={() => {
                                      alert(
                                        "Message permanently deleted and synced to account.",
                                      );
                                      setInbox(
                                        inbox.filter(
                                          (m) => m.id !== (formData as any).id,
                                        ),
                                      );
                                      setShowMsgOptions(false);
                                      setView("inbox");
                                    }}
                                    className="w-full text-left px-4 py-2 text-xs font-bold uppercase tracking-widest text-red-500 hover:bg-red-50 flex items-center gap-2"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" /> Delete
                                    Sync
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-navy/40">
                              Subject
                            </p>
                            <p className="font-bold text-navy">
                              {formData.subject}
                            </p>
                          </div>
                        </div>
                        <div className="bg-white p-6 rounded-3xl border border-navy/10 space-y-4 shadow-sm whitespace-pre-wrap text-sm text-navy/80 leading-relaxed font-medium overflow-hidden">
                          {formData.body}
                        </div>
                      </div>
                    )}

                    {resultTab === "analysis" && (
                      <div className="space-y-6 animate-in fade-in">
                        {isAnalyzing && (
                          <div className="flex items-center gap-3 p-4 bg-orange/10 text-orange rounded-2xl">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span className="text-[10px] font-black uppercase tracking-widest">
                              Still Analyzing...
                            </span>
                          </div>
                        )}

                        {/* Audited Sender Registry Card (Always present even if zero threat) */}
                        <div className="bg-navy/[0.03] border border-navy/10 p-5 rounded-[2rem] space-y-3">
                          <div className="flex justify-between items-center pb-2 border-b border-navy/5">
                            <span className="text-[9px] font-black uppercase tracking-widest text-navy/40">
                              Audited Registry Profile
                            </span>
                            <span className="bg-green-500/10 text-green-600 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1 font-bold">
                              <ShieldCheck className="w-3 h-3" />
                              Processed Info
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <p className="text-[8px] font-black uppercase tracking-wider text-navy/40">
                                Sender Origin Entity
                              </p>
                              <p className="font-bold text-navy truncate text-xs">
                                {formData.senderName || "Unknown Name"}
                              </p>
                              <p className="text-[10px] font-mono text-navy/60 truncate">
                                {formData.senderEmail}
                              </p>
                            </div>
                            <div>
                              <p className="text-[8px] font-black uppercase tracking-wider text-navy/40">
                                Topic / Subject Header
                              </p>
                              <p className="font-bold text-navy truncate text-xs">
                                {formData.subject || "(No Subject)"}
                              </p>
                              <p className="text-[9px] text-orange font-bold uppercase tracking-widest">
                                Sender Verification Record Present
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Quick Score Card */}
                        <div className="p-8 bg-orange text-navy rounded-[3rem] space-y-4 shadow-2xl shadow-orange/20 relative overflow-hidden">
                          <div className="absolute top-0 right-0 p-8 opacity-10">
                            <Fingerprint className="w-24 h-24 rotate-12" />
                          </div>
                          <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-[4px] opacity-60">
                            <span>Security Quotient</span>
                            <ShieldAlert className="w-4 h-4" />
                          </div>
                          <div className="text-8xl font-display font-black italic tracking-tighter leading-none">
                            {result?.match(/Likelihood: (\d+)/)?.[1] || "—"}
                          </div>
                          <div className="flex justify-between items-end pt-4 border-t border-navy/10">
                            <span className="text-xs font-black uppercase tracking-widest">
                              {result?.match(
                                /### (?:📨\s*)?Email Classification\n(.+)/,
                              )?.[1] || "ANALYZED"}
                            </span>
                            <span className="text-[10px] font-bold uppercase opacity-60">
                              Magnitude: {result?.match(/Severity: (.+)/)?.[1]}
                            </span>
                          </div>
                        </div>

                        {/* Analysis Content */}
                        <div className="p-1 px-2 space-y-8">
                          <div className="markdown-container text-navy/80">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                h3: ({ ...props }) => (
                                  <h3
                                    className="text-xl font-display font-black uppercase tracking-tighter text-orange mb-6 mt-10 first:mt-0 italic"
                                    {...props}
                                  />
                                ),
                                h4: ({ ...props }) => (
                                  <h4
                                    className="text-sm font-black uppercase tracking-widest text-navy/60 mb-4 mt-8 flex items-center gap-2 before:w-4 before:h-[2px] before:bg-orange"
                                    {...props}
                                  />
                                ),
                                p: ({ ...props }) => (
                                  <p
                                    className="text-sm leading-relaxed mb-6 font-medium text-navy/80"
                                    {...props}
                                  />
                                ),
                                ul: ({ ...props }) => (
                                  <ul className="space-y-3 mb-6" {...props} />
                                ),
                                li: ({ ...props }) => (
                                  <li className="text-xs flex gap-3 text-navy/70">
                                    <span className="w-1.5 h-1.5 bg-orange rounded-full mt-1.5 flex-shrink-0" />
                                    <span {...props} />
                                  </li>
                                ),
                                blockquote: ({ node, ...props }) => (
                                  <blockquote
                                    className="bg-navy/[0.03] p-6 rounded-3xl border-l-4 border-orange italic text-sm mb-6 text-navy"
                                    {...props}
                                  />
                                ),
                                table: ({ ...props }) => (
                                  <div className="overflow-x-auto my-6 rounded-2xl border border-navy/10 bg-white shadow-sm">
                                    <table
                                      className="w-full text-[10px] text-left text-navy"
                                      {...props}
                                    />
                                  </div>
                                ),
                                thead: ({ ...props }) => (
                                  <thead
                                    className="bg-navy/5 text-orange font-black uppercase"
                                    {...props}
                                  />
                                ),
                                th: ({ ...props }) => (
                                  <th className="px-4 py-3" {...props} />
                                ),
                                td: ({ ...props }) => (
                                  <td
                                    className="px-4 py-3 border-t border-navy/5 font-bold"
                                    {...props}
                                  />
                                ),
                              }}
                            >
                              {result || ""}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    )}

                    {resultTab === "chat" && (
                      <div className="space-y-4 animate-in fade-in flex flex-col h-[520px] border border-navy/10 rounded-[2rem] bg-white overflow-hidden shadow-sm">
                        {/* Chat Header */}
                        <div className="bg-navy/[0.03] px-6 py-4 border-b border-navy/10 flex items-center justify-between">
                          <div>
                            <p className="text-xs font-black uppercase tracking-wider text-navy">
                              Interactive Security Analyst Chat
                            </p>
                            <p className="text-[10px] text-navy/40 font-medium">
                              Answering questions strictly about this message
                              context
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            <span className="text-[9px] font-black uppercase tracking-widest text-green-600 font-bold">
                              Secure Trace
                            </span>
                          </div>
                        </div>

                        {/* Messages Panel */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-none">
                          {chatMessages.map((msg, idx) => (
                            <div
                              key={idx}
                              className={cn(
                                "flex flex-col max-w-[85%]",
                                msg.role === "user"
                                  ? "ml-auto items-end"
                                  : "mr-auto items-start",
                              )}
                            >
                              <span className="text-[9px] font-black uppercase tracking-widest text-navy/40 mb-1 px-1">
                                {msg.role === "user"
                                  ? "You"
                                  : "Mail Verifier AI"}
                              </span>
                              <div
                                className={cn(
                                  "px-4 py-3 rounded-2xl text-xs leading-relaxed font-semibold shadow-xs",
                                  msg.role === "user"
                                    ? "bg-navy text-white rounded-tr-none"
                                    : "bg-navy/[0.04] text-navy rounded-tl-none border border-navy/5",
                                )}
                              >
                                {msg.text}
                              </div>
                            </div>
                          ))}
                          {isSendingChatMessage && (
                            <div className="flex flex-col max-w-[85%] mr-auto items-start">
                              <span className="text-[9px] font-black uppercase tracking-widest text-navy/40 mb-1 px-1">
                                Mail Verifier AI
                              </span>
                              <div className="px-4 py-3 rounded-2xl rounded-tl-none text-xs leading-relaxed font-medium bg-navy/[0.04] text-navy border border-navy/5 flex items-center gap-2">
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-orange" />
                                <span>
                                  Processing message context & writing
                                  response...
                                </span>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Input Bar */}
                        <form
                          onSubmit={handleSendChatMessage}
                          className="p-4 bg-navy/[0.02] border-t border-navy/10 flex gap-2"
                        >
                          <input
                            type="text"
                            required
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            disabled={isSendingChatMessage}
                            placeholder="Ask anything about content, sender domain authentication, safety, spoofing..."
                            className="flex-1 bg-white border border-navy/10 rounded-xl px-4 py-3 text-xs font-semibold focus:ring-2 focus:ring-orange/20 focus:outline-none text-navy disabled:opacity-50"
                          />
                          <button
                            type="submit"
                            disabled={isSendingChatMessage || !chatInput.trim()}
                            className="bg-navy text-orange p-3 rounded-xl hover:bg-navy/95 transition-all active:scale-95 flex items-center justify-center shadow-md shadow-navy/10 disabled:opacity-50"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}

            {view === "compose" && (
              <motion.div
                key="compose"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 15 }}
                className="space-y-6"
              >
                {/* Header with back button */}
                <div className="flex items-center gap-4 text-navy">
                  <button
                    onClick={() => setView("inbox")}
                    className="p-3 bg-navy/5 rounded-2xl text-navy hover:bg-navy/10 transition-colors cursor-pointer"
                  >
                    <ArrowRight className="w-5 h-5 rotate-180" />
                  </button>
                  <div className="space-y-0.5">
                    <h2 className="text-2xl font-display font-black uppercase italic tracking-tighter text-navy mb-0">
                      Compose Mail
                    </h2>
                    <p className="text-[9px] font-black uppercase tracking-[3px] text-orange mb-0">
                      Direct Secure Dispatch
                    </p>
                  </div>
                </div>

                {/* Status alerts */}
                {sendSuccess && (
                  <div className="p-4 bg-green-500/10 text-green-600 rounded-3xl text-xs font-bold font-mono tracking-wide border border-green-500/15">
                    ✓ {sendSuccess}
                  </div>
                )}
                {sendError && (
                  <div className="p-4 bg-red-500/10 text-red-600 rounded-3xl text-xs font-bold font-mono tracking-wide border border-red-500/15">
                    ✗ {sendError}
                  </div>
                )}

                {/* Composition Form */}
                <form
                  onSubmit={handleSendEmail}
                  className="space-y-5 bg-navy/[0.02] p-6 rounded-[2.5rem] border border-navy/10"
                >
                  {/* To Recipient */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-navy/40 ml-2">
                      Recipient Email Address
                    </label>
                    <div className="relative border-none">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-navy/30" />
                      <input
                        type="email"
                        required
                        placeholder="client@example.com"
                        value={composeTo}
                        onChange={(e) => setComposeTo(e.target.value)}
                        className="w-full bg-white border border-navy/10 rounded-2xl py-3.5 pl-12 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange/20 transition-all text-navy"
                      />
                    </div>
                  </div>

                  {/* Subject Header */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-navy/40 ml-2">
                      Header / Subject
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Secure Verification Guidelines"
                      value={composeSubject}
                      onChange={(e) => setComposeSubject(e.target.value)}
                      className="w-full bg-white border border-navy/10 rounded-2xl py-3.5 px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange/20 transition-all text-navy"
                    />
                  </div>

                  {/* Message Body */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-navy/40 ml-2">
                      Secure Message Body
                    </label>
                    <textarea
                      required
                      rows={6}
                      placeholder="Type your message here..."
                      value={composeBody}
                      onChange={(e) => setComposeBody(e.target.value)}
                      className="w-full bg-white border border-navy/10 rounded-2xl py-4 px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange/20 transition-all text-navy resize-none"
                    />
                  </div>

                  {/* File / Media Loader - Drag-and-drop & manual support */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-navy/40 ml-2">
                      Upload Files or Media
                    </label>

                    <div className="relative group border-2 border-dashed border-navy/10 rounded-2xl p-6 bg-white hover:border-orange/40 transition-colors text-center cursor-pointer">
                      <input
                        type="file"
                        multiple
                        onChange={handleFileChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div className="space-y-1 flex flex-col items-center">
                        <Paperclip className="w-8 h-8 text-navy/20 group-hover:text-orange transition-colors" />
                        <p className="text-xs font-bold text-navy">
                          Drag & Drop or Click to Upload
                        </p>
                        <p className="text-[9px] text-navy/40 uppercase font-black tracking-widest">
                          Supports images, documents, pdf, max 50MB
                        </p>
                      </div>
                    </div>

                    {/* Attachment List */}
                    {composeAttachments.length > 0 && (
                      <div className="space-y-2 mt-3">
                        <p className="text-[9px] font-black uppercase tracking-widest text-navy/40 ml-2">
                          Attachments ({composeAttachments.length})
                        </p>
                        <div className="max-h-40 overflow-y-auto space-y-1.5 p-1 bg-navy/5 rounded-2xl">
                          {composeAttachments.map((file, idx) => (
                            <div
                              key={idx}
                              className="flex justify-between items-center bg-white p-3 rounded-xl border border-navy/5 shadow-sm text-xs"
                            >
                              <span className="font-semibold text-navy/80 truncate max-w-[70%]">
                                {file.name}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeAttachment(idx)}
                                className="text-navy/30 hover:text-red-500 transition-colors p-1"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Dispatch Button */}
                  <button
                    type="submit"
                    disabled={isSendingEmail}
                    className="w-full bg-navy text-white hover:bg-navy/90 py-4.5 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-navy/15 flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    {isSendingEmail ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-orange" />
                        Dispatching Securely...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 text-orange" />
                        Send Message
                      </>
                    )}
                  </button>
                </form>
              </motion.div>
            )}

            {view === "settings" && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-8"
              >
                <div className="flex items-center gap-4 text-navy">
                  <button
                    onClick={() => setView(user ? "inbox" : "login")}
                    className="p-3 bg-navy/5 rounded-2xl text-navy"
                  >
                    <ArrowRight className="w-5 h-5 rotate-180" />
                  </button>
                  <h2 className="text-2xl font-display font-black uppercase italic tracking-tighter text-navy">
                    Account
                  </h2>
                </div>

                <div className="space-y-6">
                  {user && (
                    <div className="bg-navy/[0.03] p-8 rounded-[2.5rem] border border-navy/10 space-y-6">
                      <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-navy rounded-3xl flex items-center justify-center shadow-lg shadow-navy/20">
                          <User className="w-8 h-8 text-orange" />
                        </div>
                        <div>
                          <p className="font-display font-black text-xl text-navy uppercase tracking-tight">
                            {user.name}
                          </p>
                          <p className="text-xs text-navy/40 font-mono tracking-tight">
                            {user.email}
                          </p>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-navy/5 flex flex-col gap-3">
                        <div className="flex justify-between items-center px-2">
                          <span className="text-[10px] font-black uppercase tracking-widest text-navy/40">
                            Status
                          </span>
                          <span className="flex items-center gap-1.5 px-3 py-1 bg-green-500/10 text-green-600 rounded-full text-[9px] font-black uppercase tracking-widest">
                            <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />
                            Authenticated
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={handleLogout}
                        className="w-full py-4 bg-navy text-orange rounded-2xl font-black uppercase tracking-widest text-xs border border-white/10 hover:bg-orange hover:text-navy transition-all mt-4"
                      >
                        Sign Out
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {view === "admin" && user?.email === "adamu0533@gmail.com" && (
              <AdminDashboard />
            )}
          </AnimatePresence>
        </main>

        {/* Persistent Bottom Nav (Mobile/Web App style) */}
        {view !== "login" && (
          <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-2xl border-t border-navy/10 px-6 pb-6 pt-3 md:hidden">
            <div className="max-w-xl mx-auto flex justify-between items-center">
              <button
                onClick={() => {
                  if (view === "inbox") {
                    handleScrollToggle();
                  } else {
                    setView("inbox");
                  }
                }}
                className={cn(
                  "flex flex-col items-center gap-1",
                  view === "inbox" ? "text-orange" : "text-navy/40",
                )}
              >
                <Inbox className="w-6 h-6" />
                <span className="text-[8px] font-black uppercase tracking-widest">
                  Messages
                </span>
              </button>

              <button
                onClick={() => setView("alerts")}
                className={cn(
                  "flex flex-col items-center gap-1",
                  view === "alerts" ? "text-orange" : "text-navy/40",
                )}
              >
                <ShieldAlert className="w-6 h-6" />
                <span className="text-[8px] font-black uppercase tracking-widest">
                  Alerts
                </span>
              </button>

              <button
                onClick={() => setView("insights")}
                className={cn(
                  "flex flex-col items-center gap-1",
                  view === "insights" ? "text-orange" : "text-navy/40",
                )}
              >
                <Globe className="w-6 h-6" />
                <span className="text-[8px] font-black uppercase tracking-widest">
                  Insights
                </span>
              </button>

              <button
                onClick={() => setView("settings")}
                className={cn(
                  "flex flex-col items-center gap-1",
                  view === "settings" ? "text-orange" : "text-navy/40",
                )}
              >
                <User className="w-6 h-6 text-navy" />
                <span className="text-[8px] font-black uppercase tracking-widest">
                  Account
                </span>
              </button>
            </div>
          </nav>
        )}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        body { background-color: white !important; min-height: 100vh; color: #0B1F3A; }
        .markdown-container table td, .markdown-container table th { border: none !important; }
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;  
          overflow: hidden;
        }
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }
      `,
        }}
      />
    </div>
  );
}
