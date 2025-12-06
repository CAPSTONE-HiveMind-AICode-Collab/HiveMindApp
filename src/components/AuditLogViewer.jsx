"use client";

import { useEffect, useState } from "react";
import { collection, query, where, orderBy, limit as fbLimit, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

export default function AuditLogViewer({ hiveID = null, limit = 50 }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all, security, hive

  useEffect(() => {
    async function loadLogs() {
      setLoading(true);
      try {
        const auditRef = collection(db, "auditLogs");
        let q;

        // Simple query without complex indexes - filter client-side instead
        q = query(
          auditRef,
          orderBy("timestamp", "desc"),
          fbLimit(100)
        );

        const snapshot = await getDocs(q);
        let auditLogs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          timestamp: doc.data().timestamp?.toDate?.() || doc.data().timestamp
        }));

        // Apply client-side filters
        if (filter === "security") {
          const securityEvents = [
            "ACCESS_DENIED",
            "LOGIN_FAILED", 
            "UNAUTHORIZED_ACCESS",
            "MEMBER_BANNED",
            "ROLE_CHANGED"
          ];
          auditLogs = auditLogs.filter(log => log.event && securityEvents.includes(log.event));
        } else if (filter === "hive" && hiveID) {
          auditLogs = auditLogs.filter(log => log.hiveId === hiveID);
        }

        // Limit results after filtering
        auditLogs = auditLogs.slice(0, limit);
        
        setLogs(auditLogs);
      } catch (err) {
        console.error("Failed to load audit logs:", err);
        setLogs([]);
      } finally {
        setLoading(false);
      }
    }

    loadLogs();
  }, [hiveID, limit, filter]);

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return "Unknown";
    return new Date(timestamp).toLocaleString();
  };

  const getEventIcon = (event) => {
    if (!event || typeof event !== 'string') return "📝";
    if (event.includes("LOGIN")) return "🔐";
    if (event.includes("HIVE")) return "🏠";
    if (event.includes("MEMBER")) return "👤";
    if (event.includes("FILE")) return "📎";
    if (event.includes("MESSAGE")) return "💬";
    if (event.includes("DENIED") || event.includes("FAILED")) return "🚫";
    return "📝";
  };

  const getEventColor = (event) => {
    if (!event || typeof event !== 'string') return "text-blue-600 bg-blue-50 border-blue-200";
    if (event.includes("DENIED") || event.includes("FAILED") || event.includes("BANNED")) 
      return "text-red-600 bg-red-50 border-red-200";
    if (event.includes("CREATED") || event.includes("ADDED")) 
      return "text-green-600 bg-green-50 border-green-200";
    if (event.includes("DELETED") || event.includes("REMOVED")) 
      return "text-purple-600 bg-purple-50 border-purple-200";
    if (event.includes("CHANGED") || event.includes("UPDATED")) 
      return "text-orange-600 bg-orange-50 border-orange-200";
    return "text-blue-600 bg-blue-50 border-blue-200";
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg border-2 border-gray-200 p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
        <p className="text-sm text-gray-600">Loading audit logs...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter Buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => setFilter("all")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            filter === "all"
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          All Events
        </button>
        <button
          onClick={() => setFilter("security")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            filter === "security"
              ? "bg-red-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Security Only
        </button>
        {hiveID && (
          <button
            onClick={() => setFilter("hive")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === "hive"
                ? "bg-green-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            This Hive
          </button>
        )}
      </div>

      {/* Audit Log List */}
      <div className="bg-white rounded-lg border-2 border-gray-200 overflow-hidden">
        <div className="bg-gradient-to-r from-gray-100 to-gray-200 px-4 py-3 border-b-2 border-gray-300">
          <h3 className="text-lg font-bold text-gray-800">📋 Audit Log ({logs.length} entries)</h3>
        </div>

        <div className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
          {logs.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>No audit logs found</p>
            </div>
          ) : (
            logs.map((log, idx) => (
              <div key={log.id || idx} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xl">{getEventIcon(log.event)}</span>
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${getEventColor(
                          log.event
                        )}`}
                      >
                        {log.event ? log.event.replace(/_/g, " ") : "UNKNOWN EVENT"}
                      </span>
                    </div>

                    <div className="text-sm space-y-1">
                      {log.targetUserEmail && (
                        <p className="text-gray-700">
                          <span className="font-medium">Target:</span> {log.targetUserEmail}
                        </p>
                      )}
                      {log.oldRole && log.newRole && (
                        <p className="text-gray-700">
                          <span className="font-medium">Role Change:</span> {log.oldRole} → {log.newRole}
                        </p>
                      )}
                      {log.details && (
                        <p className="text-gray-600 text-xs">{log.details}</p>
                      )}
                      <p className="text-gray-500 text-xs">
                        {formatTimestamp(log.timestamp)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
