"use client";

import { useState, useEffect } from "react";
import { useUser } from "@/lib/auth/userContext";
import { db } from "@/lib/firebase/config";
import { collection, addDoc, serverTimestamp, onSnapshot, deleteDoc, doc } from "firebase/firestore";

export default function HiveGuard({ hiveID, currentUserRole }) {
  const { user } = useUser();
  const [secrets, setSecrets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [revealedSecrets, setRevealedSecrets] = useState({});
  const [copiedId, setCopiedId] = useState(null);
  const [keyName, setKeyName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [visibleTo, setVisibleTo] = useState(["ADMIN", "OWNER"]);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (!hiveID) return;

    const secretsRef = collection(db, "Hive", hiveID, "secrets");
    const unsubscribe = onSnapshot(secretsRef, (snapshot) => {
      const docs = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      const filtered = docs.filter(
        (secret) => secret.visibleTo.includes(currentUserRole) || currentUserRole === "OWNER"
      );
      setSecrets(filtered);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [hiveID, currentUserRole]);

  const handleSaveSecret = async (event) => {
    event.preventDefault();
    if (!keyName || !secretValue) return;
    setIsProcessing(true);

    try {
      const secretsRef = collection(db, "Hive", hiveID, "secrets");
      await addDoc(secretsRef, {
        keyName: keyName.toUpperCase(),
        value: secretValue,
        visibleTo,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });

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
      alert(`Security error: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteSecret = async (id, name) => {
    if (!confirm(`Revoke access to ${name}?`)) return;
    await deleteDoc(doc(db, "Hive", hiveID, "secrets", id));
  };

  const copySecret = async (secret) => {
    const textToCopy = secret.value;
    const fallbackCopy = (text) => {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        return true;
      } catch {
        return false;
      } finally {
        document.body.removeChild(textArea);
      }
    };

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
      setCopiedId(secret.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  if (loading) {
    return (
      <div className="glass-panel text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-cyan-200" />
        <p className="mt-3 text-sm text-slate-300">Scanning vault...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="hero-panel">
        <span className="hero-chip">HiveGuard</span>
        <h2 className="mt-5 text-3xl font-semibold tracking-[-0.05em] text-white">
          Secret vault
        </h2>
        <p className="panel-subtitle mt-3">
          Store shared secrets and control which roles are allowed to reveal them.
        </p>
      </div>

      {(currentUserRole === "ADMIN" || currentUserRole === "OWNER") ? (
        <div className="glass-panel">
          <p className="panel-title">Add new secret</p>
          <p className="panel-subtitle">
            Restrict visibility by role before saving the secret into this hive's vault.
          </p>

          <form onSubmit={handleSaveSecret} className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_220px]">
            <input
              placeholder="VARIABLE_NAME"
              value={keyName}
              onChange={(event) => setKeyName(event.target.value)}
              className="input-shell font-mono text-sm"
            />
            <input
              type="password"
              placeholder="Secret value"
              value={secretValue}
              onChange={(event) => setSecretValue(event.target.value)}
              className="input-shell"
            />
            <select
              multiple
              value={visibleTo}
              onChange={(event) =>
                setVisibleTo(Array.from(event.target.selectedOptions, (option) => option.value))
              }
              className="select-shell min-h-[120px]"
            >
              <option value="OWNER">OWNER only</option>
              <option value="ADMIN">ADMIN</option>
              <option value="MEMBER">MEMBER</option>
            </select>
            <button type="submit" disabled={isProcessing} className="button-primary">
              {isProcessing ? "Saving..." : "Save secret"}
            </button>
          </form>
        </div>
      ) : null}

      <div className="glass-panel">
        <div className="chat-header">
          <div>
            <p className="text-kicker">Vault</p>
            <h3 className="panel-title text-2xl">Active secrets</h3>
          </div>
          <span className="status-pill">{secrets.length} secrets</span>
        </div>

        <div className="mt-6 space-y-3">
          {secrets.length === 0 ? (
            <div className="empty-state">No protected secrets are stored in this hive yet.</div>
          ) : (
            secrets.map((secret) => {
              const isRevealed = !!revealedSecrets[secret.id];
              const displayValue = isRevealed ? secret.value : "••••••••••••";

              return (
                <article
                  key={secret.id}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:bg-white/[0.07]"
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-semibold text-cyan-100">
                        {secret.keyName}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {secret.visibleTo.map((role) => (
                          <span
                            key={role}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-200"
                          >
                            {role}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <code className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-xs text-slate-100">
                        {displayValue}
                      </code>

                      <button
                        onClick={() =>
                          setRevealedSecrets((prev) => ({ ...prev, [secret.id]: !prev[secret.id] }))
                        }
                        className="button-ghost text-sm"
                        title={isRevealed ? "Hide" : "Reveal"}
                        type="button"
                      >
                        {isRevealed ? "Hide" : "Reveal"}
                      </button>

                      <button
                        onClick={() => copySecret(secret)}
                        className={`button-ghost text-sm ${copiedId === secret.id ? "border-emerald-300/25 text-emerald-100" : ""}`}
                        title="Copy to clipboard"
                        type="button"
                      >
                        {copiedId === secret.id ? "Copied" : "Copy"}
                      </button>

                      {(currentUserRole === "ADMIN" || currentUserRole === "OWNER") ? (
                        <button
                          onClick={() => handleDeleteSecret(secret.id, secret.keyName)}
                          className="button-danger text-sm"
                          type="button"
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
