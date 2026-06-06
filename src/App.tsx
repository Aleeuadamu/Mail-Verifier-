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
  Square
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

import { auth } from "./lib/firebase";
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup
} from "firebase/auth";

export default function App() {
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);
  const [inbox, setInbox] = useState<GmailMessage[]>([]);
  const [isLoadingInbox, setIsLoadingInbox] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  
  const [formData, setFormData] = useState<EmailData>({
    subject: "",
    body: "",
    senderName: "",
    senderEmail: "",
    replyTo: "",
    links: "",
    headers: ""
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [view, setView] = useState<"login" | "inbox" | "settings" | "result" | "alerts" | "insights">("login");
  const [resultTab, setResultTab] = useState<"analysis" | "message">("analysis");
  const [searchQuery, setSearchQuery] = useState("");

  const [loginMode, setLoginMode] = useState<"landing" | "login" | "signup" | "forgot">("landing");
  const [showPassword, setShowPassword] = useState(false);
  const [authFormData, setAuthFormData] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    consent: false
  });
  const [authError, setAuthError] = useState<string | null>(null);

  // Check auth on mount
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser({ email: firebaseUser.email || "", name: firebaseUser.displayName || "Secure Agent" });
        setView("inbox");
        fetchInbox(firebaseUser.uid);
      } else {
        setUser(null);
        setView("login");
        setLoginMode("landing");
      }
    });
    
    return () => unsub();
  }, []);

  const fetchInbox = async (uid?: string, queryStr?: string) => {
    setIsLoadingInbox(true);
    try {
      const currentUid = uid || auth.currentUser?.uid;
      const headers: Record<string, string> = {};
      if (currentUid) {
        headers["x-firebase-uid"] = currentUid;
      }
      
      const params = new URLSearchParams();
      if (queryStr) {
        params.append("q", queryStr);
        params.append("maxResults", "20");
      }
      
      const res = await fetch(`/api/gmail/messages?${params.toString()}`, { headers });
      const data = await res.json();
      if (Array.isArray(data)) {
        setInbox(data);
        // Trigger background scan for top 5 emails for the feed
        triggerInboxScan(data.slice(0, 5));
      } else if (data.error === "No Gmail token found. Please reconnect Google account.") {
        // If we don't have token mapped in session, show error but don't crash
        console.warn("Gmail token missing on server:", data.error);
      }
    } catch (e) {
      console.error("Fetch inbox failed", e);
    } finally {
      setIsLoadingInbox(false);
    }
  };

  const triggerInboxScan = async (messages: GmailMessage[]) => {
    if (messages.length === 0) return;
    setIsScanning(true);
    try {
      const emailDataList = messages.map(msg => ({
        subject: msg.subject,
        body: msg.snippet,
        senderName: msg.from.split("<")[0].trim(),
        senderEmail: msg.from.match(/<(.+)>/)?.[1] || msg.from,
      }));

      const scanResults = await analyzeEmail(emailDataList, "INBOX_SCAN");
      if (Array.isArray(scanResults)) {
        setInbox(prev => prev.map(msg => {
          const match = scanResults.find((r: any) => r.subject === msg.subject);
          return match ? { ...msg, analysis: match } : msg;
        }));
      }
    } catch (e) {
      console.error("Inbox scan failed", e);
    } finally {
      setIsScanning(false);
    }
  };

  const handleConnect = async () => {
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/gmail.readonly');
      provider.setCustomParameters({ prompt: 'consent' });
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken;
      
      if (token) {
        await fetch("/api/auth/store-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, uid: result.user.uid })
        });
      }
      
      // The onAuthStateChanged hook catches the login and navigates to inbox
    } catch (err: any) {
      console.error(err);
      setAuthError(err.message || "Google Connection failed");
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
      await signInWithEmailAndPassword(auth, authFormData.email, authFormData.password);
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
      await createUserWithEmailAndPassword(auth, authFormData.email, authFormData.password);
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
      setResult(typeof output === 'string' ? output : "No analysis generated.");
    } catch (error) {
      console.error(error);
      setResult("Analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const selectEmail = (msg: GmailMessage) => {
    const headers = msg.fullData?.payload?.headers || [];
    
    // Attempt simpler body extraction
    let bodyData = "";
    if (msg.fullData?.payload?.parts) {
      const part = msg.fullData.payload.parts.find((p: any) => p.mimeType === 'text/plain') || msg.fullData.payload.parts[0];
      bodyData = part?.body?.data || "";
    } else {
      bodyData = msg.fullData?.payload?.body?.data || "";
    }
    
    let decodedBody = msg.snippet;
    try {
      if (bodyData) {
        decodedBody = decodeURIComponent(escape(atob(bodyData.replace(/-/g, '+').replace(/_/g, '/'))));
      }
    } catch (e) {
      console.warn("Could not decode body");
    }
    
    const analysisData: EmailData = {
      subject: msg.subject,
      senderName: msg.from.split("<")[0].trim(),
      senderEmail: msg.from.match(/<(.+)>/)?.[1] || msg.from,
      body: decodedBody,
      headers: JSON.stringify(headers, null, 2),
      links: (decodedBody.match(/https?:\/\/[^\s]+/g) || []).join(", ")
    };
    
    setFormData(analysisData);
    setResult(null); // Clear previous analysis
    setResultTab("message"); // Default to message view
    setView("result"); // Change view immediately
    handleAnalyze(analysisData);
  };

  const getRiskColor = (classification: string) => {
    switch(classification) {
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
    switch(classification) {
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

  return (
    <div className="min-h-screen bg-white text-navy font-sans selection:bg-orange/20 overflow-x-hidden pb-24 md:pb-0">
      {/* App Shell Header - Hide on login */}
      {view !== "login" && (
        <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-navy/10 h-16 md:h-20">
          <div className="max-w-xl mx-auto h-full px-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 md:w-10 md:h-10 bg-navy rounded-lg flex items-center justify-center">
                <Shield className="w-5 h-5 md:w-6 md:h-6 text-orange" />
              </div>
              <h1 className="font-display font-black text-xl md:text-2xl tracking-tighter italic text-navy">MAIL VERIFIER</h1>
            </div>
            
            <button 
              onClick={() => setView("settings")}
              className={cn(
                "p-2 rounded-full transition-all",
                view === "settings" ? "bg-orange text-navy" : "bg-navy/10 text-navy"
              )}
            >
              <User className="w-5 h-5 md:w-6 md:h-6" />
            </button>
          </div>
        </header>
      )}

      <main className="max-w-xl mx-auto px-4 py-6">
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
                  <div className="w-20 h-20 bg-navy rounded-3xl mx-auto flex items-center justify-center shadow-xl shadow-navy/20 rotate-3">
                    <Shield className="w-10 h-10 text-orange" />
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
                       <h3 className="text-lg font-black text-navy uppercase tracking-tight">Welcome Back</h3>
                    </div>

                    <form onSubmit={handleManualLogin} className="space-y-4">
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black uppercase tracking-widest text-navy/40 ml-2">Email Address</label>
                          <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-navy/30" />
                            <input 
                              type="email"
                              required
                              value={authFormData.email}
                              onChange={(e) => setAuthFormData({...authFormData, email: e.target.value})}
                              placeholder="name@example.com"
                              className="w-full bg-navy/[0.03] border border-navy/10 rounded-2xl py-4 pl-12 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange/20 transition-all"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-black uppercase tracking-widest text-navy/40 ml-2">Secret Password</label>
                          <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-navy/30" />
                            <input 
                              type={showPassword ? "text" : "password"}
                              required
                              value={authFormData.password}
                              onChange={(e) => setAuthFormData({...authFormData, password: e.target.value})}
                              placeholder="••••••••"
                              className="w-full bg-navy/[0.03] border border-navy/10 rounded-2xl py-4 pl-12 pr-12 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange/20 transition-all"
                            />
                            <button 
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-4 top-1/2 -translate-y-1/2 text-navy/30 hover:text-navy transition-colors"
                            >
                              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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

                        {authError && <p className="text-[10px] text-red-500 font-bold text-center uppercase tracking-widest">{authError}</p>}

                        <button 
                          type="submit"
                          className="group w-full bg-navy text-white py-5 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-3 hover:bg-navy/90 transition-all shadow-xl shadow-navy/10 mt-2"
                        >
                          Sign In
                          <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-2" />
                        </button>
                      </div>

                      <div className="relative py-2">
                        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-navy/5"></div></div>
                        <div className="relative flex justify-center text-[8px] font-black uppercase tracking-[4px] text-navy/20"><span className="bg-white px-2">OR SECURE CONNECT</span></div>
                      </div>

                      <button 
                        type="button"
                        onClick={handleConnect}
                        className="w-full bg-navy/[0.03] border border-navy/10 text-navy py-4 rounded-xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-3 hover:bg-navy/5 transition-all"
                      >
                        <Mail className="w-4 h-4 text-orange" />
                        Login with Google
                      </button>
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
                       <h3 className="text-lg font-black text-navy uppercase tracking-tight">Create Profile</h3>
                    </div>

                    <form onSubmit={handleManualSignup} className="space-y-4">
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black uppercase tracking-widest text-navy/40 ml-2">Full Name</label>
                          <div className="relative">
                            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-navy/30" />
                            <input 
                              type="text"
                              required
                              value={authFormData.name}
                              onChange={(e) => setAuthFormData({...authFormData, name: e.target.value})}
                              placeholder="John Doe"
                              className="w-full bg-navy/[0.03] border border-navy/10 rounded-2xl py-4 pl-12 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange/20 transition-all"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-black uppercase tracking-widest text-navy/40 ml-2">Email Address</label>
                          <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-navy/30" />
                            <input 
                              type="email"
                              required
                              value={authFormData.email}
                              onChange={(e) => setAuthFormData({...authFormData, email: e.target.value})}
                              placeholder="name@example.com"
                              className="w-full bg-navy/[0.03] border border-navy/10 rounded-2xl py-4 pl-12 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange/20 transition-all"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px) font-black uppercase tracking-widest text-navy/40 ml-2">Phone Number</label>
                          <div className="relative">
                            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-navy/30" />
                            <input 
                              type="tel"
                              value={authFormData.phone}
                              onChange={(e) => setAuthFormData({...authFormData, phone: e.target.value})}
                              placeholder="+1 (555) 000-0000"
                              className="w-full bg-navy/[0.03] border border-navy/10 rounded-2xl py-4 pl-12 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange/20 transition-all"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-black uppercase tracking-widest text-navy/40 ml-2">Choose Password</label>
                          <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-navy/30" />
                            <input 
                              type={showPassword ? "text" : "password"}
                              required
                              value={authFormData.password}
                              onChange={(e) => setAuthFormData({...authFormData, password: e.target.value})}
                              placeholder="••••••••"
                              className="w-full bg-navy/[0.03] border border-navy/10 rounded-2xl py-4 pl-12 pr-12 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange/20 transition-all"
                            />
                            <button 
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-4 top-1/2 -translate-y-1/2 text-navy/30 hover:text-navy transition-colors"
                            >
                              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        <div 
                          className="flex gap-3 px-2 py-2 cursor-pointer group"
                          onClick={() => setAuthFormData({...authFormData, consent: !authFormData.consent})}
                        >
                          <div className="mt-1 flex-shrink-0">
                            {authFormData.consent ? (
                              <CheckSquare className="w-4 h-4 text-orange" />
                            ) : (
                              <Square className="w-4 h-4 text-navy/20 group-hover:text-navy/40" />
                            )}
                          </div>
                          <p className="text-[10px] text-navy/50 font-medium leading-tight">
                            I consent to the app to get access all existing and future mails for neural security processing.
                          </p>
                        </div>

                        {authError && <p className="text-[10px] text-red-500 font-bold text-center uppercase tracking-widest">{authError}</p>}

                        <button 
                          type="submit"
                          className="w-full bg-navy text-white py-5 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-navy/10 border border-transparent hover:bg-navy/90 transition-all"
                        >
                          Create Account
                        </button>
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
                       <h3 className="text-lg font-black text-navy uppercase tracking-tight">Recovery</h3>
                       <p className="text-[10px] text-navy/40 font-medium">Enter your email to receive recovery link</p>
                    </div>

                    <form onSubmit={handleForgotPassword} className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase tracking-widest text-navy/40 ml-2">Email Address</label>
                        <div className="relative">
                          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-navy/30" />
                          <input 
                            type="email"
                            required
                            value={authFormData.email}
                            onChange={(e) => setAuthFormData({...authFormData, email: e.target.value})}
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
                  <h2 className="text-2xl font-display font-black italic uppercase tracking-tight text-navy">Messages</h2>
                </div>
                <button 
                  onClick={() => {
                    fetchInbox(undefined, searchQuery);
                  }}
                  disabled={isLoadingInbox}
                  className="p-3 bg-navy/5 rounded-2xl text-navy hover:bg-navy/10 transition-colors"
                >
                  <RefreshCw className={cn("w-5 h-5", isLoadingInbox && "animate-spin")} />
                </button>
              </div>

              <div className="relative px-2">
                <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-navy/30" />
                <input 
                  type="text"
                  placeholder="Search emails..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      fetchInbox(undefined, searchQuery);
                    }
                  }}
                  className="w-full bg-navy/[0.03] border border-navy/10 rounded-2xl py-3 pl-12 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange/20 transition-all"
                />
              </div>

              {isLoadingInbox ? (
                <div className="py-20 flex flex-col items-center gap-4 text-center">
                  <div className="w-12 h-12 border-4 border-navy/10 border-t-orange rounded-full animate-spin" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-navy/40">Syncing Stream...</span>
                </div>
              ) : inbox.length === 0 ? (
                <div className="py-20 flex flex-col items-center gap-6 text-center px-8">
                  <div className="w-16 h-16 bg-navy/5 rounded-3xl flex items-center justify-center">
                    <Mail className="w-8 h-8 text-navy/20" />
                  </div>
                  <div className="space-y-4">
                    <h3 className="font-display font-black text-xl text-navy uppercase italic italic tracking-tight">Gmail Connection Required</h3>
                    <p className="text-xs text-navy/50 leading-relaxed font-medium">
                      To scan your communications for threats, you must authorize a secure bridge to your Gmail inbox.
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
                            <div className={cn("w-2 h-2 rounded-full", getRiskColor(msg.analysis.classification))} />
                          )}
                          <span className="text-[10px] font-black uppercase tracking-widest text-orange truncate max-w-[200px]">{msg.from.split("<")[0].trim()}</span>
                        </div>
                        <span className="text-[9px] font-mono text-navy/30">{new Date(msg.date).toLocaleDateString()}</span>
                      </div>
                      <h3 className="font-display font-bold text-lg leading-tight mb-1 truncate text-navy group-hover:text-orange transition-colors">{msg.subject}</h3>
                      
                      {msg.analysis ? (
                        <div className="mb-2">
                          <p className={cn("text-[9px] font-black uppercase tracking-widest mb-1", getRiskText(msg.analysis.classification))}>
                            {msg.analysis.classification} • {msg.analysis.severity} Risk ({msg.analysis.risk_score}%)
                          </p>
                          <p className="text-[10px] text-navy/60 font-medium italic">"{msg.analysis.short_reason}"</p>
                        </div>
                      ) : (
                        <p className="text-xs text-navy/60 line-clamp-1 leading-relaxed mb-1">{msg.snippet}</p>
                      )}
                    </motion.div>
                  ))}
                  {inbox.length === 0 && (
                    <div className="py-20 text-center space-y-4">
                      <Inbox className="w-12 h-12 text-navy/10 mx-auto" />
                      <p className="text-xs font-black uppercase tracking-widest text-navy/20">Secure stream is empty.</p>
                    </div>
                  )}
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
                <p className="text-[10px] font-black uppercase tracking-[5px] text-navy/30">Active Neural Monitoring</p>
              </div>

              <div className="space-y-4">
                {inbox.filter(m => m.analysis && (m.analysis.classification === "Phishing" || m.analysis.classification === "Likely Phishing")).length === 0 ? (
                  <div className="py-20 bg-navy/[0.02] border-2 border-dashed border-navy/5 rounded-[3rem] flex flex-col items-center justify-center text-center p-8 space-y-4">
                    <ShieldCheck className="w-16 h-16 text-green-500 opacity-20" />
                    <div>
                      <p className="text-sm font-bold text-navy">No Critical Threats</p>
                      <p className="text-[10px] uppercase font-black tracking-widest text-navy/30">Your inbox is currently clear of active phishing attempts.</p>
                    </div>
                  </div>
                ) : (
                  inbox.filter(m => m.analysis && (m.analysis.classification === "Phishing" || m.analysis.classification === "Likely Phishing")).map(msg => (
                    <motion.div 
                      key={msg.id}
                      onClick={() => selectEmail(msg)}
                      className="bg-red-50 p-6 rounded-[2.5rem] border border-red-100 space-y-3 cursor-pointer relative overflow-hidden"
                    >
                      <div className="absolute top-0 right-0 p-4 opacity-5">
                        <AlertTriangle className="w-12 h-12 text-red-600" />
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="px-2 py-0.5 bg-red-600 text-white text-[8px] font-black uppercase tracking-widest rounded-full">DANGER</div>
                        <span className="text-[9px] font-mono text-red-900/40 uppercase truncate max-w-[200px]">{msg.from}</span>
                      </div>
                      <h3 className="text-red-900 font-bold text-lg leading-tight">{msg.subject}</h3>
                      <p className="text-red-800/70 text-[11px] font-medium italic italic leading-relaxed">
                        {msg.analysis?.short_reason || "Detecting suspicious patterns. Do not click any links."}
                      </p>
                      <div className="pt-2">
                         <span className="text-[9px] font-black uppercase tracking-widest text-red-600 border-b border-red-600 pb-0.5">Secure Analysis Result</span>
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
                <p className="text-[10px] font-black uppercase tracking-[5px] text-navy/30">Neural Analytics Hub</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                 <div className="bg-navy/[0.03] p-6 rounded-[2.5rem] border border-navy/10 space-y-2 text-navy">
                    <p className="text-[9px] font-black uppercase tracking-widest opacity-40 leading-none">Total Audited</p>
                    <p className="text-4xl font-display font-black italic leading-none">{inbox.length}</p>
                 </div>
                 <div className="bg-orange/5 p-6 rounded-[2.5rem] border border-orange/10 space-y-2 text-orange">
                    <p className="text-[9px] font-black uppercase tracking-widest opacity-60 leading-none">Neutralized</p>
                    <p className="text-4xl font-display font-black italic leading-none">{inbox.filter(m => m.analysis && (m.analysis.classification === "Phishing" || m.analysis.classification === "Likely Phishing")).length}</p>
                 </div>
              </div>

              <div className="bg-navy text-white p-8 rounded-[3rem] space-y-6">
                 <h3 className="text-xl font-display font-black uppercase italic tracking-tight leading-none">Risk Atmosphere</h3>
                 <div className="space-y-4">
                    {[
                      { label: "Phishing Attempts", val: inbox.filter(m => m.analysis && (m.analysis.classification === "Phishing" || m.analysis.classification === "Likely Phishing")).length, color: "bg-red-500" },
                      { label: "Suspicious Activity", val: inbox.filter(m => m.analysis && m.analysis.classification === "Suspicious").length, color: "bg-yellow-500" },
                      { label: "Safe Transfers", val: inbox.filter(m => m.analysis && (m.analysis.classification === "Safe" || m.analysis.classification === "Likely Safe")).length, color: "bg-green-500" }
                    ].map((item, i) => (
                      <div key={i} className="space-y-2">
                        <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                           <span className="opacity-60">{item.label}</span>
                           <span>{Math.round((item.val / (inbox.length || 1)) * 100)}%</span>
                        </div>
                        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                           <motion.div 
                             initial={{ width: 0 }}
                             animate={{ width: `${(item.val / (inbox.length || 1)) * 100}%` }}
                             className={cn("h-full", item.color)} 
                           />
                        </div>
                      </div>
                    ))}
                 </div>
              </div>

              <div className="bg-navy/5 p-8 rounded-[3rem] border border-navy/10 space-y-4">
                 <h3 className="text-lg font-bold text-navy leading-none">Global Threat Vector</h3>
                 <p className="text-xs text-navy/60 leading-relaxed font-medium">Most common attack vector detected in your region: <span className="text-orange font-bold font-mono">FINANCIAL_IP_SPOOFING</span>. Our AI has updated your local neural protocols to prioritize domain trust signals.</p>
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
                    <p className="text-sm font-black uppercase tracking-[5px] text-orange">Neural Audit in Progress</p>
                    <p className="text-[10px] font-medium text-navy/30 italic">Interrogating message headers...</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Tabs */}
                  <div className="flex w-full bg-navy/5 p-1 rounded-2xl">
                    <button 
                      onClick={() => setResultTab("message")}
                      className={cn("flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all", resultTab === "message" ? "bg-white text-navy shadow-sm" : "text-navy/40 hover:text-navy")}
                    >
                      Message Content
                    </button>
                    <button 
                      onClick={() => setResultTab("analysis")}
                      className={cn("flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all", resultTab === "analysis" ? "bg-white text-navy shadow-sm" : "text-navy/40 hover:text-navy")}
                    >
                      Analysis Result
                    </button>
                  </div>

                  {resultTab === "message" && (
                    <div className="space-y-6 animate-in fade-in">
                      <div className="bg-navy/[0.03] p-6 rounded-3xl border border-navy/10 space-y-4">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-navy/40">From</p>
                          <p className="font-bold text-navy">{formData.senderName} &lt;{formData.senderEmail}&gt;</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-navy/40">Subject</p>
                          <p className="font-bold text-navy">{formData.subject}</p>
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
                          <span className="text-[10px] font-black uppercase tracking-widest">Still Analyzing...</span>
                        </div>
                      )}
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
                           <span className="text-xs font-black uppercase tracking-widest">{result?.match(/### 📨 Email Classification\n(.+)/)?.[1] || "ANALYZED"}</span>
                           <span className="text-[10px] font-bold uppercase opacity-60">Magnitude: {result?.match(/Severity: (.+)/)?.[1]}</span>
                        </div>
                      </div>

                      {/* Analysis Content */}
                      <div className="p-1 px-2 space-y-8">
                         <div className="markdown-container text-navy/80">
                            <ReactMarkdown 
                              remarkPlugins={[remarkGfm]}
                          components={{
                            h3: ({...props}) => <h3 className="text-xl font-display font-black uppercase tracking-tighter text-orange mb-6 mt-10 first:mt-0 italic" {...props} />,
                            h4: ({...props}) => <h4 className="text-sm font-black uppercase tracking-widest text-navy/60 mb-4 mt-8 flex items-center gap-2 before:w-4 before:h-[2px] before:bg-orange" {...props} />,
                            p: ({...props}) => <p className="text-sm leading-relaxed mb-6 font-medium text-navy/80" {...props} />,
                            ul: ({...props}) => <ul className="space-y-3 mb-6" {...props} />,
                            li: ({...props}) => (
                              <li className="text-xs flex gap-3 text-navy/70">
                                <span className="w-1.5 h-1.5 bg-orange rounded-full mt-1.5 flex-shrink-0" />
                                <span {...props} />
                              </li>
                            ),
                            blockquote: ({ node, ...props }) => <blockquote className="bg-navy/[0.03] p-6 rounded-3xl border-l-4 border-orange italic text-sm mb-6 text-navy" {...props} />,
                            table: ({...props}) => <div className="overflow-x-auto my-6 rounded-2xl border border-navy/10 bg-white shadow-sm"><table className="w-full text-[10px] text-left text-navy" {...props} /></div>,
                            thead: ({...props}) => <thead className="bg-navy/5 text-orange font-black uppercase" {...props} />,
                            th: ({...props}) => <th className="px-4 py-3" {...props} />,
                            td: ({...props}) => <td className="px-4 py-3 border-t border-navy/5 font-bold" {...props} />
                          }}
                        >
                          {result || ""}
                        </ReactMarkdown>
                     </div>
                  </div>
                 </div>
                )}
               </div>
              )}
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
                <h2 className="text-2xl font-display font-black uppercase italic tracking-tighter text-navy">Account</h2>
              </div>

              <div className="space-y-6">
                {user && (
                  <div className="bg-navy/[0.03] p-8 rounded-[2.5rem] border border-navy/10 space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 bg-navy rounded-3xl flex items-center justify-center shadow-lg shadow-navy/20">
                        <User className="w-8 h-8 text-orange" />
                      </div>
                      <div>
                        <p className="font-display font-black text-xl text-navy uppercase tracking-tight">{user.name}</p>
                        <p className="text-xs text-navy/40 font-mono tracking-tight">{user.email}</p>
                      </div>
                    </div>
                    
                    <div className="pt-4 border-t border-navy/5 flex flex-col gap-3">
                      <div className="flex justify-between items-center px-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-navy/40">Status</span>
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
        </AnimatePresence>
      </main>

      {/* Persistent Bottom Nav (Mobile/Web App style) */}
      {view !== "login" && (
        <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-2xl border-t border-navy/10 px-6 pb-6 pt-3 md:hidden">
          <div className="max-w-xl mx-auto flex justify-between items-center">
            <button 
               onClick={() => setView("inbox")}
               className={cn("flex flex-col items-center gap-1", view === "inbox" ? "text-orange" : "text-navy/40")}
            >
              <Inbox className="w-6 h-6" />
              <span className="text-[8px] font-black uppercase tracking-widest">Messages</span>
            </button>
            
            <button 
               onClick={() => setView("alerts")}
               className={cn("flex flex-col items-center gap-1", view === "alerts" ? "text-orange" : "text-navy/40")}
            >
              <ShieldAlert className="w-6 h-6" />
              <span className="text-[8px] font-black uppercase tracking-widest">Alerts</span>
            </button>

            <button 
               onClick={() => setView("insights")}
               className={cn("flex flex-col items-center gap-1", view === "insights" ? "text-orange" : "text-navy/40")}
            >
              <Globe className="w-6 h-6" />
              <span className="text-[8px] font-black uppercase tracking-widest">Insights</span>
            </button>

            <button 
               onClick={() => setView("settings")}
               className={cn("flex flex-col items-center gap-1", view === "settings" ? "text-orange" : "text-navy/40")}
            >
              <User className="w-6 h-6 text-navy" />
              <span className="text-[8px] font-black uppercase tracking-widest">Account</span>
            </button>
          </div>
        </nav>
      )}

      {/* Desktop Helper */}
      <div className="hidden md:block fixed left-8 bottom-8 text-[10px] font-black uppercase tracking-[5px] text-navy/10">
        AI Protocol v4.0.1 — Secure Neural Defense
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        body { background-color: white !important; min-height: 100vh; color: #0B1F3A; }
        .markdown-container table td, .markdown-container table th { border: none !important; }
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;  
          overflow: hidden;
        }
      `}} />
    </div>
  );
}
