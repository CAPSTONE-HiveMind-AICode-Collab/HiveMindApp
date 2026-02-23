"use client";

import { useState, useEffect } from "react";
import { useUser } from "@/lib/auth/userContext";
import { db } from "@/lib/firebase/config";
import { 
  collection, 
  addDoc, 
  serverTimestamp, 
  onSnapshot, 
  query, 
  where, 
  deleteDoc, 
  doc 
} from "firebase/firestore";
import { listHiveMembers } from "@/lib/data/roleRepository";

export default function HiveGuard({ hiveID, currentUserRole }) {
  const { user } = useUser();
  const [secrets, setSecrets] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [revealedSecrets, setRevealedSecrets] = useState({});
  const [copiedId, setCopiedId] = useState(null);
  
  // Form State
  const [keyName, setKeyName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [visibleTo, setVisibleTo] = useState(["ADMIN", "OWNER"]); // Default restriction
  const [isProcessing, setIsProcessing] = useState(false);

  // Load Secrets & Members
  useEffect(() => {
    if (!hiveID) return;

    // 1. Listen for Secrets (Scoped to this Hive)
    const secretsRef = collection(db, "Hive", hiveID, "secrets");
    const unsubSecrets = onSnapshot(secretsRef, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      // Client-side safety: filter secrets the user shouldn't see
      // (Though Firestore Rules should handle this server-side)
      const filtered = docs.filter(s => s.visibleTo.includes(currentUserRole) || currentUserRole === "OWNER");
      setSecrets(filtered);
      setLoading(false);
    });

    // 2. Load members for the UI selector
    listHiveMembers(hiveID).then(setMembers);

    return () => unsubSecrets();
  }, [hiveID, currentUserRole]);

  const handleSaveSecret = async (e) => {
    e.preventDefault();
    if (!keyName || !secretValue) return;
    setIsProcessing(true);

    try {
      const secretsRef = collection(db, "Hive", hiveID, "secrets");
      await addDoc(secretsRef, {
        keyName: keyName.toUpperCase(),
        value: secretValue, // In a real app, you'd encrypt this before sending
        visibleTo: visibleTo,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });

      // Audit Log for Security
      await addDoc(collection(db, "auditLogs"), {
        event: "SECRET_CREATED",
        hiveId: hiveID,
        userId: user.uid,
        details: `Created secret: ${keyName.toUpperCase()}`,
        timestamp: serverTimestamp(),
      });

      setKeyName("");
      setSecretValue("");
    } catch (error) {
      alert("Security Error: " + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteSecret = async (id, name) => {
    if (!confirm(`Revoke access to ${name}?`)) return;
    await deleteDoc(doc(db, "Hive", hiveID, "secrets", id));
  };

  const toggleReveal = (id) => {
        setRevealedSecrets(prev => ({
            ...prev,
            [id]: !prev[id]
        }));
    };

  if (loading) return <div className="p-8 text-center animate-pulse">Scanning Shield...</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-800 to-indigo-900 rounded-lg p-6 text-white shadow-xl border-b-4 border-yellow-500">
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          🛡️ Hive Guard
        </h2>
        <p className="text-indigo-200 text-sm">
          Secure environment variables and credentials with Role-Based Access Control.
        </p>
      </div>

      {/* Entry Form - Only for Admins/Owners */}
      {(currentUserRole === "ADMIN" || currentUserRole === "OWNER") && (
        <div className="bg-white rounded-lg border-2 border-slate-200 p-6 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            🔑 Add New Secret
          </h3>
          <form onSubmit={handleSaveSecret} className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <input
              placeholder="VARIABLE_NAME"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              className="px-3 py-2 border-2 border-slate-200 rounded-lg focus:border-yellow-500 outline-none font-mono text-sm"
            />
            <input
              type="password"
              placeholder="••••••••"
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              className="px-3 py-2 border-2 border-slate-200 rounded-lg focus:border-yellow-500 outline-none"
            />
            <select 
              multiple 
              value={visibleTo}
              onChange={(e) => setVisibleTo(Array.from(e.target.selectedOptions, option => option.value))}
              className="px-3 py-2 border-2 border-slate-200 rounded-lg text-sm"
            >
              <option value="OWNER">OWNER Only</option>
              <option value="ADMIN">ADMINs</option>
              <option value="MEMBER">MEMBERS</option>
            </select>
            <button
              type="submit"
              disabled={isProcessing}
              className="bg-yellow-500 text-slate-900 font-bold px-4 py-2 rounded-lg hover:bg-yellow-400 transition-all disabled:opacity-50"
            >
              {isProcessing ? "Shielding..." : "Vault Secret"}
            </button>
          </form>
        </div>
      )}

      {/* Secret Vault Display */}
      <div className="bg-slate-50 rounded-lg border-2 border-slate-200 overflow-hidden">
        <div className="bg-slate-200 px-4 py-3 border-b-2 border-slate-300">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">🔐 Active Vault</h3>
        </div>
        
        <div className="divide-y divide-slate-200">
          {secrets.length === 0 ? (
            <p className="p-8 text-center text-slate-400 italic">No shielded secrets in this hive.</p>
          ) : (
            secrets.map((s) => {
              const isRevealed = !!revealedSecrets[s.id];
              const displayValue = isRevealed ? s.value : "••••••••••••";
              
              return (
                <div key={s.id} className="p-4 flex items-center justify-between bg-white hover:bg-slate-50 transition-colors">
                  <div className="flex flex-col">
                    <span className="font-mono font-bold text-indigo-900">{s.keyName}</span>
                    <div className="flex gap-1 mt-1">
                      {s.visibleTo.map(role => (
                        <span key={role} className="text-[10px] bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-bold border border-slate-200">
                          {role}
                        </span>
                      ))}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    {/* Value Container */}
                    <div className="flex items-center bg-slate-100 rounded-lg px-2 border border-slate-200">
                      <code className="px-2 py-1 text-xs text-slate-600 font-mono min-w-[120px]">
                        {displayValue}
                      </code>
                      
                      {/* Toggle Visibility */}
                      <button 
                        onClick={() => setRevealedSecrets(prev => ({ ...prev, [s.id]: !prev[s.id] }))}
                        className="p-1.5 hover:bg-slate-200 rounded text-slate-500 transition-colors"
                        title={isRevealed ? "Hide" : "Show"}
                        type="button"
                      >
                        {isRevealed ? "👁️‍🗨️" : "👁️"}
                      </button>

                      {/* Copy to Clipboard */}
                      <button 
                        onClick={() => {
                          const textToCopy = s.value;
                          const fallbackCopy = (text) => {
                            const textArea = document.createElement("textarea");
                            textArea.value = text;
                            document.body.appendChild(textArea);
                            textArea.select();
                            try {
                              document.execCommand('copy');
                              return true;
                            } catch (err) {
                              return false;
                            } finally {
                              document.body.removeChild(textArea);
                            }
                          };

                          const performCopy = async () => {
                            let success = false;
                            if (navigator.clipboard && window.isSecureContext) {
                              try {
                                await navigator.clipboard.writeText(textToCopy);
                                success = true;
                              } catch {
                                success = fallbackCopy(textToCopy);
                              }
                            } else {
                              success = fallbackCopy(textToCopy);
                            }

                            if (success) {
                              setCopiedId(s.id);
                              setTimeout(() => setCopiedId(null), 2000);
                            }
                          };

                          performCopy();
                        }}
                        className={`p-1.5 rounded transition-all duration-200 border-l border-slate-200 ml-1 ${
                          copiedId === s.id ? "bg-green-100 text-green-600" : "hover:bg-slate-200 text-slate-500"
                        }`}
                        title="Copy to clipboard"
                        type="button"
                      >
                        {copiedId === s.id ? "✅" : "📋"}
                      </button>
                    </div>

                    {/* Admin Actions */}
                    {(currentUserRole === "ADMIN" || currentUserRole === "OWNER") && (
                      <button 
                        onClick={() => handleDeleteSecret(s.id, s.keyName)}
                        className="text-slate-300 hover:text-red-500 transition-colors p-1"
                        title="Delete Secret"
                        type="button"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}