import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Shield, ArrowRight } from "lucide-react";

export default function AdminDashboard() {
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await fetch("/api/admin/users");
        if (response.ok) {
          const usersList = await response.json();
          setAdminUsers(usersList);
        } else {
          console.error("Failed to load admin users");
        }
      } catch (e) {
        console.error("Error fetching users", e);
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, []);

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

  const handleDownload = () => {
    const rows = [
      ["Name", "Email", "Contact"],
      ...adminUsers.map(u => [
        `"${u.name || 'Unknown'}"`,
        `"${u.email || 'N/A'}"`,
        `"${u.contact || 'N/A'}"`
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

  const activeCount = adminUsers.filter(u => u.status === 'active').length;

  return (
    <motion.div
      key="admin"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="space-y-8"
    >
      <div className="flex items-center gap-4 text-navy">
        <h2 className="text-2xl font-display font-black uppercase italic tracking-tighter text-navy flex items-center gap-2">
          <Shield className="w-6 h-6 text-orange" /> 
          Admin Data Core
        </h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-navy/[0.03] rounded-2xl border border-navy/10 flex flex-col items-center">
          <span className="text-[10px] font-black uppercase tracking-widest text-navy/40 mb-1">Total Users</span>
          <span className="text-2xl font-display font-black text-navy">{adminUsers.length}</span>
        </div>
        <div className="p-4 bg-navy/[0.03] rounded-2xl border border-navy/10 flex flex-col items-center">
          <span className="text-[10px] font-black uppercase tracking-widest text-navy/40 mb-1">Active Agents</span>
          <span className="text-2xl font-display font-black text-orange">{activeCount}</span>
        </div>
        <div className="p-4 bg-navy/[0.03] rounded-2xl border border-navy/10 flex flex-col items-center">
          <span className="text-[10px] font-black uppercase tracking-widest text-navy/40 mb-1">Passive Agents</span>
          <span className="text-2xl font-display font-black text-navy">{adminUsers.length - activeCount}</span>
        </div>
        <button onClick={handleDownload} className="p-4 bg-orange/10 rounded-2xl border border-orange/20 flex flex-col items-center justify-center hover:bg-orange/20 transition-all text-orange">
          <span className="text-[10px] font-black uppercase tracking-widest mb-1">Export Users</span>
          <ArrowRight className="w-6 h-6 rotate-90" />
        </button>
      </div>

      <div className="bg-white rounded-3xl border border-navy/10 overflow-hidden shadow-2xl shadow-navy/5">
        <div className="p-6 border-b border-navy/10 flex justify-between items-center bg-navy/[0.02]">
          <h3 className="text-xs font-black uppercase tracking-widest text-navy">Identity Database</h3>
        </div>
        <div className="p-6 h-[400px] overflow-y-auto">
          {loading ? (
             <div className="py-8 text-center text-navy/30 text-xs font-bold uppercase tracking-widest animate-pulse">Synchronizing Data...</div>
          ) : (
            <div className="space-y-3">
              {adminUsers.map(u => (
                <div key={u.id} className="p-4 bg-white rounded-2xl flex items-center justify-between border border-navy/10 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-navy/5 rounded-xl flex items-center justify-center">
                      <span className="text-orange font-bold font-display uppercase">{u.name?.charAt(0) || "X"}</span>
                    </div>
                    <div>
                      <p className="font-black text-sm text-navy tracking-tight">{u.name || "Unknown Agent"}</p>
                      <p className="text-[10px] font-mono tracking-tighter text-navy/50">{u.email}</p>
                      <p className="text-[10px] font-mono tracking-tighter text-navy/40">{u.contact || "No Contact Info"}</p>
                    </div>
                  </div>
                  <button onClick={() => handleDeleteUser(u.id)} className="px-4 py-3 text-red-500 bg-red-50 hover:bg-red-100 rounded-xl transition-colors text-[9px] font-black uppercase tracking-widest border border-red-500/10">
                    Purge
                  </button>
                </div>
              ))}
              {adminUsers.length === 0 && (
                <div className="text-center py-8 text-[10px] font-black uppercase tracking-widest text-navy/30">
                  No records found in database
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
