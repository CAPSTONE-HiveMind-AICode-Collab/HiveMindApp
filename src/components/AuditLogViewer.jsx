"use client";

import { useEffect, useState } from "react";
import { collection, query, orderBy, limit as fbLimit, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

function normalizeAuditLog(docSnap) {
  const data = docSnap.data();
  const rawTimestamp = data.timestamp?.toDate?.() || data.timestamp || null;
  const event = data.event || data.action || "UNKNOWN_EVENT";
  const hiveRef = data.hiveId || data.hiveID || data.details?.hiveId || data.details?.hiveID || null;
  const details =
    typeof data.details === "string"
      ? data.details
      : data.details && typeof data.details === "object"
      ? Object.entries(data.details)
          .map(([key, value]) => `${key}: ${String(value)}`)
          .join(" | ")
      : "";

  return {
    id: docSnap.id,
    event,
    hiveRef,
    timestamp: rawTimestamp,
    details,
    targetUserEmail: data.targetUserEmail || data.targetUserName || data.targetUserId || data.targetUserID || "",
    oldRole: data.oldRole || data.details?.oldRole || "",
    newRole: data.newRole || data.details?.newRole || "",
    success: data.success,
  };
}

function formatTimestamp(timestamp) {
  if (!timestamp) return "Unknown";
  return new Date(timestamp).toLocaleString();
}

function getEventTone(event) {
  if (!event || typeof event !== "string") return "border-cyan-300/20 bg-cyan-300/10 text-cyan-100";
  if (event.includes("DENIED") || event.includes("FAILED") || event.includes("BANNED")) {
    return "border-rose-300/20 bg-rose-300/10 text-rose-100";
  }
  if (event.includes("CREATED") || event.includes("ADDED")) {
    return "border-emerald-300/20 bg-emerald-300/10 text-emerald-100";
  }
  if (event.includes("DELETED") || event.includes("REMOVED")) {
    return "border-violet-300/20 bg-violet-300/10 text-violet-100";
  }
  if (event.includes("CHANGED") || event.includes("UPDATED")) {
    return "border-amber-300/20 bg-amber-300/10 text-amber-100";
  }
  return "border-cyan-300/20 bg-cyan-300/10 text-cyan-100";
}

export default function AuditLogViewer({ hiveID = null, limit = 50 }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    async function loadLogs() {
      setLoading(true);
      setError("");

      try {
        const auditRef = collection(db, "auditLogs");
        const q = query(auditRef, orderBy("timestamp", "desc"), fbLimit(150));
        const snapshot = await getDocs(q);

        let auditLogs = snapshot.docs.map(normalizeAuditLog);

        if (filter === "security") {
          const securityEvents = [
            "ACCESS_DENIED",
            "LOGIN_FAILED",
            "UNAUTHORIZED_ACCESS",
            "MEMBER_BANNED",
            "ROLE_CHANGED",
            "PERMISSION_DENIED",
          ];
          auditLogs = auditLogs.filter((log) => securityEvents.includes(log.event));
        } else if (filter === "hive" && hiveID) {
          auditLogs = auditLogs.filter((log) => log.hiveRef === hiveID);
        }

        setLogs(auditLogs.slice(0, limit));
      } catch (err) {
        console.error("Failed to load audit logs:", err);
        setLogs([]);
        setError(err.message || "Could not load audit logs.");
      } finally {
        setLoading(false);
      }
    }

    loadLogs();
  }, [hiveID, limit, filter]);

  if (loading) {
    return (
      <div className="glass-panel text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-cyan-200" />
        <p className="mt-3 text-sm text-slate-300">Loading audit logs...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="hero-panel">
        <span className="hero-chip">Audit</span>
        <h2 className="mt-5 text-3xl font-semibold tracking-[-0.05em] text-white">
          Audit trail
        </h2>
        <p className="panel-subtitle mt-3">
          Review role changes, access events, and hive activity in one consistent log.
        </p>
      </div>

      <div className="glass-panel">
        <div className="flex flex-wrap gap-2">
          {[
            ["all", "All events"],
            ["security", "Security only"],
            ...(hiveID ? [["hive", "This hive"]] : []),
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`tab-button ${filter === value ? "active" : ""}`}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="mt-6 space-y-3">
          {logs.length === 0 ? (
            <div className="empty-state">No audit logs matched the current filter.</div>
          ) : (
            logs.map((log) => (
              <article
                key={log.id}
                className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-cyan-300/20 hover:bg-white/[0.07]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${getEventTone(log.event)}`}
                      >
                        {log.event.replace(/_/g, " ")}
                      </span>
                      {log.hiveRef ? (
                        <span className="text-xs uppercase tracking-[0.16em] text-slate-400">
                          Hive: {log.hiveRef}
                        </span>
                      ) : null}
                    </div>

                    {log.targetUserEmail ? (
                      <p className="mt-3 text-sm text-slate-200">
                        <span className="font-semibold text-white">Target:</span> {log.targetUserEmail}
                      </p>
                    ) : null}

                    {log.oldRole && log.newRole ? (
                      <p className="mt-2 text-sm text-slate-300">
                        <span className="font-semibold text-white">Role change:</span> {log.oldRole} to {log.newRole}
                      </p>
                    ) : null}

                    {log.details ? (
                      <p className="mt-2 text-sm text-slate-300">{log.details}</p>
                    ) : null}
                  </div>

                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                    {formatTimestamp(log.timestamp)}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
