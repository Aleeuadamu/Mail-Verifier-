import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import {
  Shield,
  ArrowRight,
  Check,
  X,
  RefreshCw,
  FileWarning,
  CheckCircle2,
  XCircle,
  Trash2,
  Search,
  Eye,
  AlertTriangle,
  Users,
  ExternalLink,
  Clock
} from "lucide-react";

export interface CommunityReportAdmin {
  id: string;
  senderDisplayName: string;
  senderEmail: string;
  subject: string;
  recipientEmail?: string;
  dateReceived?: string;
  emailProvider?: string;
  bodyExcerpt?: string;
  suspiciousUrls?: string[];
  headers?: string;
  screenshotUrl?: string;
  reasons: string[];
  userNotes?: string;
  redFlagsObserved?: string[];
  targetBrand?: string;
  isAnonymous?: boolean;
  submittedByUserId?: string;
  submittedByUserEmail?: string;
  status: "pending_review" | "approved" | "rejected";
  moderationNotes?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  createdAt: string;
  updatedAt?: string;
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<"users" | "reports">("users");
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [reports, setReports] = useState<CommunityReportAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);

  // Reports moderation state
  const [reportFilter, setReportFilter] = useState<"all" | "pending_review" | "approved" | "rejected">("all");
  const [reportSearch, setReportSearch] = useState("");
  const [inspectReport, setInspectReport] = useState<CommunityReportAdmin | null>(null);
  const [moderationActionLoading, setModerationActionLoading] = useState(false);

  const fetchUsers = async () => {
    try {
      const meRes = await fetch("/api/auth/me");
      if (meRes.ok) {
        const meData = await meRes.json();
        if (meData?.user?.isAdmin) {
          setIsAuthorized(true);
        } else {
          setLoading(false);
          return;
        }
      }

      const response = await fetch("/api/admin/users");
      if (response.ok) {
        const usersList = await response.json();
        setAdminUsers(usersList);
      }
    } catch (e) {
      console.error("Error fetching users", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchReports = async () => {
    setReportsLoading(true);
    try {
      const res = await fetch("/api/admin/reports");
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
      }
    } catch (e) {
      console.error("Error fetching reports", e);
    } finally {
      setReportsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchReports();
  }, []);

  if (loading) {
    return (
      <div className="p-8 flex justify-center text-navy/50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange"></div>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="p-8 text-center bg-white rounded-3xl border border-navy/10 mt-8">
        <h2 className="text-xl font-black text-navy uppercase tracking-widest mb-4">Access Denied</h2>
        <p className="text-navy/60 font-medium">You do not have administrative privileges.</p>
      </div>
    );
  }

  const handleDeleteUser = async (id: string) => {
    if (confirm("Delete this user?")) {
      try {
        const response = await fetch(`/api/admin/users/${id}`, {
          method: "DELETE"
        });
        if (response.ok) {
          setAdminUsers(adminUsers.filter(u => u.id !== id));
        } else {
          alert("Failed to delete user");
        }
      } catch (e) {
        console.error("Error deleting user", e);
      }
    }
  };

  const toggleUserSubscription = async (user: any) => {
    const isPremium = user.subscription && user.subscription.plan !== "free";
    const action = isPremium ? "downgrade to free" : "upgrade to premium";
    
    if (confirm(`Are you sure you want to ${action} for ${user.email}?`)) {
       try {
         const newSub = { 
           ...user.subscription, 
           plan: isPremium ? "free" : "pro",
           currentPeriodEnd: isPremium ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
         };
         const response = await fetch(`/api/admin/users/${user.id}/subscription`, {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ subscription: newSub })
         });
         
         if (response.ok) {
           const updated = await response.json();
           setAdminUsers(adminUsers.map(u => u.id === user.id ? { ...u, subscription: updated.subscription, status: updated.subscription.plan === "free" ? "inactive" : "active" } : u));
         } else {
           alert("Failed to update subscription");
         }
       } catch (e) {
         console.error("Error updating subscription", e);
       }
    }
  };

  const handleDownload = () => {
    if (!confirm("Are you sure you want to download the users' details?")) {
      return;
    }
    const rows = [
      ["Name", "Email", "Contact", "Plan"],
      ...adminUsers.map(u => [
        `"${u.name || 'Unknown'}"`,
        `"${u.email || 'N/A'}"`,
        `"${u.contact || 'N/A'}"`,
        `"${u.subscription?.plan || 'free'}"`
      ])
    ];
    const csvContent = "data:text/csv;charset=utf-8," + encodeURIComponent(rows.map(e => e.join(",")).join("\n"));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", csvContent);
    downloadAnchorNode.setAttribute("download", "users.csv");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  // Report Moderation Actions
  const handleModerateReport = async (id: string, status: "approved" | "rejected") => {
    let moderationNotes = "";
    if (status === "rejected") {
      const reason = prompt("Enter optional moderation note for rejection:", "Insufficient evidence or duplicate submission.");
      if (reason === null) return;
      moderationNotes = reason;
    } else {
      if (!confirm(`Are you sure you want to APPROVE and PUBLISH this report to the public community directory?`)) {
        return;
      }
    }

    setModerationActionLoading(true);
    try {
      const res = await fetch(`/api/admin/reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, moderationNotes })
      });
      if (res.ok) {
        const json = await res.json();
        setReports(reports.map(r => r.id === id ? json.report : r));
        if (inspectReport?.id === id) {
          setInspectReport(json.report);
        }
      } else {
        alert("Failed to update report status.");
      }
    } catch (e) {
      console.error("Error moderating report", e);
      alert("Error contacting server.");
    } finally {
      setModerationActionLoading(false);
    }
  };

  const handleDeleteReport = async (id: string) => {
    if (!confirm("Are you sure you want to PERMANENTLY delete this report from the database?")) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/reports/${id}`, { method: "DELETE" });
      if (res.ok) {
        setReports(reports.filter(r => r.id !== id));
        if (inspectReport?.id === id) setInspectReport(null);
      } else {
        alert("Failed to delete report.");
      }
    } catch (e) {
      console.error("Error deleting report", e);
    }
  };

  const pendingCount = reports.filter(r => r.status === "pending_review").length;
  const approvedCount = reports.filter(r => r.status === "approved").length;
  const rejectedCount = reports.filter(r => r.status === "rejected").length;

  const filteredReports = reports.filter(r => {
    if (reportFilter !== "all" && r.status !== reportFilter) return false;
    if (reportSearch.trim()) {
      const q = reportSearch.toLowerCase().trim();
      const matchEmail = r.senderEmail?.toLowerCase().includes(q);
      const matchName = r.senderDisplayName?.toLowerCase().includes(q);
      const matchSubject = r.subject?.toLowerCase().includes(q);
      const matchBrand = r.targetBrand?.toLowerCase().includes(q);
      if (!matchEmail && !matchName && !matchSubject && !matchBrand) return false;
    }
    return true;
  });

  const activeCount = adminUsers.filter(u => u.status === 'active').length;
  const freeCount = adminUsers.filter(u => !u.subscription || u.subscription.plan === 'free').length;
  const paidCount = adminUsers.filter(u => u.subscription && u.subscription.plan !== 'free').length;

  return (
    <motion.div
      key="admin"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="space-y-8"
    >
      {/* Top Header & Tab Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-navy/10 pb-6">
        <div>
          <h2 className="text-2xl font-display font-black uppercase italic tracking-tighter text-navy flex items-center gap-2">
            <Shield className="w-6 h-6 text-orange" /> 
            Admin Operations Core
          </h2>
          <p className="text-xs text-navy/50 font-medium mt-1">
            Privileged controls for user account management and community threat reports moderation.
          </p>
        </div>

        {/* Tab Controls */}
        <div className="flex bg-navy/[0.04] p-1.5 rounded-2xl border border-navy/10">
          <button
            onClick={() => setActiveTab("users")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "users" ? "bg-white text-navy shadow-sm" : "text-navy/50 hover:text-navy"
            }`}
          >
            <Users className="w-4 h-4" />
            User Accounts ({adminUsers.length})
          </button>
          <button
            onClick={() => setActiveTab("reports")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer relative ${
              activeTab === "reports" ? "bg-white text-navy shadow-sm" : "text-navy/50 hover:text-navy"
            }`}
          >
            <FileWarning className="w-4 h-4 text-orange" />
            Community Reports
            {pendingCount > 0 && (
              <span className="bg-red-500 text-white text-[9px] px-2 py-0.5 rounded-full font-black animate-pulse">
                {pendingCount} Pending
              </span>
            )}
          </button>
        </div>
      </div>

      {/* TAB 1: USERS MANAGEMENT */}
      {activeTab === "users" && (
        <div className="space-y-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-navy/[0.03] rounded-2xl border border-navy/10 flex flex-col items-center">
              <span className="text-[10px] font-black uppercase tracking-widest text-navy/40 mb-1">Total Users</span>
              <span className="text-2xl font-display font-black text-navy">{adminUsers.length}</span>
            </div>
            <div className="p-4 bg-navy/[0.03] rounded-2xl border border-navy/10 flex flex-col items-center">
              <span className="text-[10px] font-black uppercase tracking-widest text-navy/40 mb-1">Paid Users</span>
              <span className="text-2xl font-display font-black text-orange">{paidCount}</span>
            </div>
            <div className="p-4 bg-navy/[0.03] rounded-2xl border border-navy/10 flex flex-col items-center">
              <span className="text-[10px] font-black uppercase tracking-widest text-navy/40 mb-1">Free Users</span>
              <span className="text-2xl font-display font-black text-navy">{freeCount}</span>
            </div>
            <button onClick={handleDownload} className="p-4 bg-orange/10 rounded-2xl border border-orange/20 flex flex-col items-center justify-center hover:bg-orange/20 transition-all text-orange cursor-pointer">
              <span className="text-[10px] font-black uppercase tracking-widest mb-1">Export Users</span>
              <ArrowRight className="w-6 h-6 rotate-90" />
            </button>
          </div>

          <div className="bg-white rounded-3xl border border-navy/10 overflow-hidden shadow-2xl shadow-navy/5">
            <div className="p-6 border-b border-navy/10 flex justify-between items-center bg-navy/[0.02]">
              <h3 className="text-xs font-black uppercase tracking-widest text-navy">Identity Database</h3>
            </div>
            <div className="p-6 h-[400px] overflow-y-auto">
              <div className="space-y-3">
                {adminUsers.map(u => (
                  <div key={u.id} className="p-4 bg-white rounded-2xl flex items-center justify-between border border-navy/10 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-navy/5 rounded-xl flex items-center justify-center">
                        <span className="text-orange font-bold font-display uppercase">{u.name?.charAt(0) || "X"}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-black text-sm text-navy tracking-tight">{u.name || "Unknown Agent"}</p>
                          <span className={`px-2 py-0.5 text-[8px] font-black uppercase tracking-widest rounded-full ${!u.subscription || u.subscription.plan === 'free' ? 'bg-navy/10 text-navy' : 'bg-orange/10 text-orange'}`}>
                            {!u.subscription || u.subscription.plan === 'free' ? 'FREE' : 'PAID'}
                          </span>
                        </div>
                        <p className="text-[10px] font-mono tracking-tighter text-navy/50">{u.email}</p>
                        <p className="text-[10px] font-mono tracking-tighter text-navy/40">{u.contact || "No Contact Info"}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => toggleUserSubscription(u)} className="px-4 py-3 text-orange bg-orange/10 hover:bg-orange/20 rounded-xl transition-colors text-[9px] font-black uppercase tracking-widest border border-orange/20 cursor-pointer">
                        {(!u.subscription || u.subscription.plan === 'free') ? "Upgrade" : "Downgrade"}
                      </button>
                      <button onClick={() => handleDeleteUser(u.id)} className="px-4 py-3 text-red-500 bg-red-50 hover:bg-red-100 rounded-xl transition-colors text-[9px] font-black uppercase tracking-widest border border-red-500/10 cursor-pointer">
                        Purge
                      </button>
                    </div>
                  </div>
                ))}
                {adminUsers.length === 0 && (
                  <div className="text-center py-8 text-[10px] font-black uppercase tracking-widest text-navy/30">
                    No records found in database
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-navy/10 overflow-hidden shadow-2xl shadow-navy/5">
            <div className="p-6 border-b border-navy/10 flex justify-between items-center bg-navy/[0.02]">
              <h3 className="text-xs font-black uppercase tracking-widest text-navy">Live Transactions (All Users)</h3>
            </div>
            <div className="p-6 h-[300px] overflow-y-auto">
              <div className="space-y-3">
                {(() => {
                  const allInvoices = adminUsers.flatMap(u => (u.subscription?.invoices || []).map(inv => ({ ...inv, userEmail: u.email, userName: u.name })));
                  allInvoices.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                  
                  if (allInvoices.length === 0) {
                    return (
                      <div className="text-center py-8 text-[10px] font-black uppercase tracking-widest text-navy/30">
                        No transactions found
                      </div>
                    );
                  }

                  return allInvoices.map((inv, idx) => (
                    <div key={idx} className="p-4 bg-white rounded-2xl flex items-center justify-between border border-navy/10 shadow-sm">
                      <div>
                        <p className="font-black text-sm text-navy tracking-tight">{inv.amount}</p>
                        <p className="text-[10px] font-mono tracking-tighter text-navy/50">{inv.userName} ({inv.userEmail})</p>
                        <p className="text-[10px] font-mono tracking-tighter text-navy/40">Ref: {inv.id}</p>
                      </div>
                      <div className="text-right">
                        <span className="px-2 py-0.5 text-[8px] font-black uppercase tracking-widest rounded-full bg-green-500/10 text-green-600">
                          {inv.status}
                        </span>
                        <p className="text-[10px] font-mono tracking-tighter text-navy/40 mt-1">{inv.date}</p>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: COMMUNITY REPORTS MODERATION */}
      {activeTab === "reports" && (
        <div className="space-y-6">
          {/* Moderation Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-navy/[0.03] rounded-2xl border border-navy/10 flex flex-col items-center">
              <span className="text-[10px] font-black uppercase tracking-widest text-navy/40 mb-1">Total Submissions</span>
              <span className="text-2xl font-display font-black text-navy">{reports.length}</span>
            </div>
            <div className="p-4 bg-amber-500/10 rounded-2xl border border-amber-500/20 flex flex-col items-center">
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-700 mb-1">Pending Review</span>
              <span className="text-2xl font-display font-black text-amber-600">{pendingCount}</span>
            </div>
            <div className="p-4 bg-green-500/10 rounded-2xl border border-green-500/20 flex flex-col items-center">
              <span className="text-[10px] font-black uppercase tracking-widest text-green-700 mb-1">Approved & Public</span>
              <span className="text-2xl font-display font-black text-green-600">{approvedCount}</span>
            </div>
            <div className="p-4 bg-red-500/10 rounded-2xl border border-red-500/20 flex flex-col items-center">
              <span className="text-[10px] font-black uppercase tracking-widest text-red-700 mb-1">Rejected</span>
              <span className="text-2xl font-display font-black text-red-600">{rejectedCount}</span>
            </div>
          </div>

          {/* Filtering & Search Controls */}
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-2xl border border-navy/10">
            <div className="flex flex-wrap gap-2 w-full md:w-auto">
              {(["all", "pending_review", "approved", "rejected"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setReportFilter(tab)}
                  className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                    reportFilter === tab
                      ? "bg-navy text-white shadow-sm"
                      : "bg-navy/[0.04] text-navy/60 hover:text-navy hover:bg-navy/[0.08]"
                  }`}
                >
                  {tab === "all" ? `All (${reports.length})` :
                   tab === "pending_review" ? `Pending (${pendingCount})` :
                   tab === "approved" ? `Approved (${approvedCount})` : `Rejected (${rejectedCount})`}
                </button>
              ))}
            </div>

            <div className="relative w-full md:w-72">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-navy/40" />
              <input
                type="text"
                value={reportSearch}
                onChange={e => setReportSearch(e.target.value)}
                placeholder="Filter by sender, subject, brand..."
                className="w-full pl-9 pr-4 py-2 bg-navy/[0.03] border border-navy/10 rounded-xl text-xs font-medium text-navy placeholder:text-navy/40 focus:outline-none focus:border-orange"
              />
            </div>
          </div>

          {/* Reports Moderation List */}
          <div className="bg-white rounded-3xl border border-navy/10 overflow-hidden shadow-2xl shadow-navy/5">
            <div className="p-6 border-b border-navy/10 flex justify-between items-center bg-navy/[0.02]">
              <h3 className="text-xs font-black uppercase tracking-widest text-navy">
                Community Reports Moderation Queue ({filteredReports.length})
              </h3>
              <button
                onClick={fetchReports}
                className="flex items-center gap-1.5 text-xs font-bold text-orange hover:text-orange/80 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${reportsLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>

            <div className="divide-y divide-navy/5">
              {filteredReports.map(rep => (
                <div key={rep.id} className="p-5 hover:bg-navy/[0.01] transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                        rep.status === "approved" ? "bg-green-100 text-green-700 border border-green-200" :
                        rep.status === "pending_review" ? "bg-amber-100 text-amber-800 border border-amber-200 animate-pulse" :
                        "bg-red-100 text-red-700 border border-red-200"
                      }`}>
                        {rep.status === "pending_review" ? "Pending Admin Review" : rep.status.toUpperCase()}
                      </span>

                      {rep.targetBrand && (
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest bg-navy/5 text-navy border border-navy/10">
                          Target: {rep.targetBrand}
                        </span>
                      )}

                      <span className="text-[10px] font-mono text-navy/40">
                        {new Date(rep.createdAt).toLocaleString()}
                      </span>
                    </div>

                    <h4 className="font-display font-black text-sm text-navy truncate">
                      {rep.subject}
                    </h4>

                    <p className="text-xs font-mono text-navy/70 truncate">
                      <span className="font-bold text-navy">{rep.senderDisplayName || "Unknown"}</span> &lt;{rep.senderEmail}&gt;
                    </p>

                    <div className="flex flex-wrap gap-1 pt-1">
                      {rep.reasons?.map((reason, idx) => (
                        <span key={idx} className="px-2 py-0.5 bg-orange/10 text-orange rounded text-[9px] font-bold">
                          {reason}
                        </span>
                      ))}
                    </div>

                    {rep.userNotes && (
                      <p className="text-xs text-navy/60 italic line-clamp-1 mt-1 bg-navy/[0.02] p-2 rounded-lg border border-navy/5">
                        "{rep.userNotes}"
                      </p>
                    )}
                  </div>

                  {/* Moderation Controls */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setInspectReport(rep)}
                      className="px-3.5 py-2.5 bg-navy/5 hover:bg-navy/10 text-navy rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Inspect Evidence
                    </button>

                    {rep.status !== "approved" && (
                      <button
                        onClick={() => handleModerateReport(rep.id, "approved")}
                        disabled={moderationActionLoading}
                        className="px-3.5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                        title="Approve and Publish to Public Database"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Approve
                      </button>
                    )}

                    {rep.status !== "rejected" && (
                      <button
                        onClick={() => handleModerateReport(rep.id, "rejected")}
                        disabled={moderationActionLoading}
                        className="px-3.5 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                        title="Reject report"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Reject
                      </button>
                    )}

                    <button
                      onClick={() => handleDeleteReport(rep.id)}
                      className="p-2.5 text-navy/40 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors cursor-pointer"
                      title="Permanently Delete Report"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}

              {filteredReports.length === 0 && (
                <div className="py-12 text-center text-navy/40 text-xs font-bold uppercase tracking-widest">
                  No community reports matching current filter
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* INSPECT REPORT MODAL */}
      {inspectReport && (
        <div className="fixed inset-0 bg-navy/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full border border-navy/10 shadow-2xl overflow-hidden my-8 animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="p-6 bg-navy text-white flex justify-between items-start">
              <div>
                <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                  inspectReport.status === "approved" ? "bg-green-500/20 text-green-300 border border-green-500/30" :
                  inspectReport.status === "pending_review" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" :
                  "bg-red-500/20 text-red-300 border border-red-500/30"
                }`}>
                  Status: {inspectReport.status.toUpperCase()}
                </span>
                <h3 className="text-lg font-display font-black uppercase italic tracking-tight text-white mt-2">
                  {inspectReport.subject}
                </h3>
                <p className="text-xs font-mono text-white/70">
                  {inspectReport.senderDisplayName} &lt;{inspectReport.senderEmail}&gt;
                </p>
              </div>
              <button
                onClick={() => setInspectReport(null)}
                className="text-white/60 hover:text-white p-2 rounded-xl hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto text-xs text-navy">
              {/* Submission Metadata */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-3.5 bg-navy/[0.02] rounded-2xl border border-navy/5 font-mono text-[10px]">
                <div>
                  <span className="text-navy/40 uppercase block">Submitted</span>
                  <span className="font-bold text-navy">{new Date(inspectReport.createdAt).toLocaleDateString()}</span>
                </div>
                <div>
                  <span className="text-navy/40 uppercase block">Provider</span>
                  <span className="font-bold text-navy">{inspectReport.emailProvider || "Gmail"}</span>
                </div>
                <div>
                  <span className="text-navy/40 uppercase block">Submitter</span>
                  <span className="font-bold text-navy">{inspectReport.isAnonymous ? "Anonymous User" : (inspectReport.submittedByUserEmail || "Registered User")}</span>
                </div>
                {inspectReport.targetBrand && (
                  <div>
                    <span className="text-navy/40 uppercase block">Impersonated Brand</span>
                    <span className="font-bold text-orange">{inspectReport.targetBrand}</span>
                  </div>
                )}
                {inspectReport.reviewedBy && (
                  <div>
                    <span className="text-navy/40 uppercase block">Reviewed By</span>
                    <span className="font-bold text-navy">{inspectReport.reviewedBy}</span>
                  </div>
                )}
              </div>

              {/* Reasons */}
              <div>
                <h5 className="text-[10px] font-black uppercase tracking-wider text-navy/40 mb-1.5">Reporting Categories</h5>
                <div className="flex flex-wrap gap-1.5">
                  {inspectReport.reasons.map((r, i) => (
                    <span key={i} className="px-2.5 py-1 bg-red-50 text-red-700 rounded-lg text-xs font-bold border border-red-200">
                      {r}
                    </span>
                  ))}
                </div>
              </div>

              {/* Uploaded Screenshot Evidence */}
              {inspectReport.screenshotUrl && (
                <div>
                  <h5 className="text-[10px] font-black uppercase tracking-wider text-navy/40 mb-1.5 flex items-center gap-1.5">
                    <span>Uploaded Evidence Screenshot</span>
                    <span className="text-[9px] font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">Required Proof</span>
                  </h5>
                  <div className="rounded-2xl overflow-hidden border border-navy/10 bg-black/5 flex items-center justify-center max-h-60 p-1">
                    <img
                      src={inspectReport.screenshotUrl}
                      alt="Submitted Evidence Screenshot"
                      className="max-h-56 w-auto object-contain rounded-xl"
                    />
                  </div>
                </div>
              )}

              {/* User Notes */}
              {inspectReport.userNotes && (
                <div>
                  <h5 className="text-[10px] font-black uppercase tracking-wider text-navy/40 mb-1.5">User Observations & Testimony</h5>
                  <p className="bg-navy/[0.02] p-4 rounded-2xl border border-navy/10 leading-relaxed font-medium">
                    {inspectReport.userNotes}
                  </p>
                </div>
              )}

              {/* Body Excerpt */}
              {inspectReport.bodyExcerpt && (
                <div>
                  <h5 className="text-[10px] font-black uppercase tracking-wider text-navy/40 mb-1.5">Reported Message Excerpt</h5>
                  <div className="bg-navy/[0.02] p-4 rounded-2xl border border-navy/10 font-mono text-[11px] leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {inspectReport.bodyExcerpt}
                  </div>
                </div>
              )}

              {/* Suspicious URLs */}
              {inspectReport.suspiciousUrls && inspectReport.suspiciousUrls.length > 0 && (
                <div>
                  <h5 className="text-[10px] font-black uppercase tracking-wider text-navy/40 mb-1.5">Extracted Suspicious URLs</h5>
                  <div className="space-y-1.5">
                    {inspectReport.suspiciousUrls.map((url, i) => (
                      <div key={i} className="p-2.5 bg-red-50 text-red-800 rounded-xl font-mono text-[11px] break-all border border-red-200 flex items-center justify-between">
                        <span>{url}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Raw Headers */}
              {inspectReport.headers && (
                <div>
                  <h5 className="text-[10px] font-black uppercase tracking-wider text-navy/40 mb-1.5">Technical Headers</h5>
                  <div className="bg-navy/5 p-3 rounded-2xl font-mono text-[10px] text-navy/70 whitespace-pre-wrap max-h-36 overflow-y-auto">
                    {inspectReport.headers}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="p-4 bg-navy/[0.02] border-t border-navy/10 flex justify-between items-center">
              <button
                onClick={() => handleDeleteReport(inspectReport.id)}
                className="text-red-500 hover:text-red-700 text-xs font-black uppercase tracking-wider flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Report
              </button>

              <div className="flex gap-2">
                {inspectReport.status !== "approved" && (
                  <button
                    onClick={() => handleModerateReport(inspectReport.id, "approved")}
                    className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Approve & Publish
                  </button>
                )}
                {inspectReport.status !== "rejected" && (
                  <button
                    onClick={() => handleModerateReport(inspectReport.id, "rejected")}
                    className="px-5 py-2.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <XCircle className="w-4 h-4" />
                    Reject
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
