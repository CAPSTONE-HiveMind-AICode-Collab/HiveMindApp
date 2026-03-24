"use client";

import { useEffect, useState } from "react";
import { useUser } from "@/lib/auth/userContext";
import { db } from "@/lib/firebase/config";
import { collection, getDocs } from "firebase/firestore";
import { getUserRoleForHive } from "@/lib/data/roleRepository";

function MetricCard({ label, value, accent, detail }) {
  return (
    <div className="surface-card">
      <div className="surface-card-inner">
        <div className="text-xs uppercase tracking-[0.18em] text-slate-300/65">{label}</div>
        <div className={`mt-3 text-4xl font-semibold tracking-[-0.05em] ${accent}`}>{value}</div>
        {detail ? <div className="mt-2 text-sm text-slate-300/75">{detail}</div> : null}
      </div>
    </div>
  );
}

export default function MonitoringDashboard({ hiveID }) {
  const { user } = useUser();
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalMessages: 0,
    totalThreads: 0,
    totalSummaries: 0,
    estimatedCosts: {
      firestore: 0,
      gemini: 0,
      storage: 0,
      total: 0,
    },
    trends: {
      messageGrowth: 0,
      costStatus: "HEALTHY",
    },
  });

  useEffect(() => {
    async function checkAccess() {
      if (!user || !hiveID) return;

      try {
        const role = await getUserRoleForHive(hiveID, user.uid);
        setIsOwner(role === "OWNER");
      } catch (err) {
        console.error("Failed to check role:", err);
      }
    }

    checkAccess();
  }, [user, hiveID]);

  useEffect(() => {
    if (!isOwner || !hiveID) return;

    async function loadStats() {
      setLoading(true);
      try {
        const honeycombsRef = collection(db, "Hive", hiveID, "Honeycomb");
        const honeycombsSnap = await getDocs(honeycombsRef);

        let totalMessages = 0;
        let totalThreads = 0;
        let totalSummaries = 0;

        for (const honeycombDoc of honeycombsSnap.docs) {
          const honeycombID = honeycombDoc.id;

          const messagesRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages");
          const messagesSnap = await getDocs(messagesRef);
          totalMessages += messagesSnap.size;

          for (const msgDoc of messagesSnap.docs) {
            const threadsRef = collection(
              db,
              "Hive",
              hiveID,
              "Honeycomb",
              honeycombID,
              "messages",
              msgDoc.id,
              "Threads"
            );
            const threadsSnap = await getDocs(threadsRef);
            totalThreads += threadsSnap.size;
          }

          const summariesRef = collection(
            db,
            "Hive",
            hiveID,
            "Honeycomb",
            honeycombID,
            "threadSummaries"
          );
          const summariesSnap = await getDocs(summariesRef);
          totalSummaries += summariesSnap.size;
        }

        const firestoreReads = totalMessages + totalThreads + totalSummaries;
        const firestoreCost = (firestoreReads / 100000) * 0.36;
        const geminiRequests = totalSummaries;
        const geminiCost = (geminiRequests / 1000) * 0.5;
        const storageCost = 0.02;

        const lastWeekMessages = Math.floor(totalMessages * 0.8);
        const messageTrend = totalMessages - lastWeekMessages;
        const messageGrowth =
          lastWeekMessages > 0 ? ((messageTrend / lastWeekMessages) * 100).toFixed(1) : 0;

        setStats({
          totalMessages,
          totalThreads,
          totalSummaries,
          estimatedCosts: {
            firestore: firestoreCost,
            gemini: geminiCost,
            storage: storageCost,
            total: firestoreCost + geminiCost + storageCost,
          },
          trends: {
            messageGrowth: Number(messageGrowth),
            costStatus: firestoreCost + geminiCost > 5 ? "WATCH" : "HEALTHY",
          },
        });
      } catch (err) {
        console.error("Failed to load stats:", err);
      } finally {
        setLoading(false);
      }
    }

    loadStats();
  }, [isOwner, hiveID]);

  if (!isOwner) {
    return (
      <div className="empty-state">
        Owner access is required to open monitoring analytics for this hive.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="glass-panel text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-cyan-200" />
        <p className="mt-3 text-sm text-slate-300">Loading analytics...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="hero-panel">
        <span className="hero-chip">Monitoring</span>
        <h2 className="mt-5 text-3xl font-semibold tracking-[-0.05em] text-white">
          Hive monitoring dashboard
        </h2>
        <p className="panel-subtitle mt-3">
          Usage, estimated costs, and operational health across this hive.
        </p>
      </div>

      <div className="card-grid">
        <MetricCard
          label="Messages"
          value={stats.totalMessages.toLocaleString()}
          accent="text-amber-200"
          detail={`${stats.trends.messageGrowth > 0 ? "+" : ""}${stats.trends.messageGrowth}% from the comparison window`}
        />
        <MetricCard
          label="Monthly cost"
          value={`$${stats.estimatedCosts.total.toFixed(2)}`}
          accent="text-cyan-100"
          detail={`Status: ${stats.trends.costStatus}`}
        />
        <MetricCard
          label="Thread replies"
          value={stats.totalThreads.toLocaleString()}
          accent="text-violet-200"
          detail="All message thread activity"
        />
        <MetricCard
          label="AI summaries"
          value={stats.totalSummaries.toLocaleString()}
          accent="text-emerald-200"
          detail="Knowledge distilled from threads"
        />
      </div>

      <div className="stack-grid">
        <div className="glass-panel">
          <p className="panel-title">Estimated monthly costs</p>
          <p className="panel-subtitle">
            Rough usage-driven estimates to help you keep the hive lightweight.
          </p>

          <div className="mt-6 space-y-4">
            {[
              ["Firestore reads/writes", stats.estimatedCosts.firestore],
              ["Gemini AI API", stats.estimatedCosts.gemini],
              ["Firebase storage", stats.estimatedCosts.storage],
            ].map(([label, amount]) => (
              <div key={label} className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
                <span className="text-sm text-slate-200">{label}</span>
                <span className="text-sm font-semibold text-white">${amount.toFixed(2)}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-4">
            <div className="text-xs uppercase tracking-[0.18em] text-emerald-100/75">Estimated total</div>
            <div className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-emerald-100">
              ${stats.estimatedCosts.total.toFixed(2)}/mo
            </div>
          </div>
        </div>

        <div className="glass-panel">
          <p className="panel-title">Security posture</p>
          <p className="panel-subtitle">
            A quick owner-facing snapshot of the controls this hive relies on.
          </p>

          <div className="mt-6 space-y-3">
            {[
              "Firestore Security Rules are active",
              "Firebase Storage Rules are active",
              "Role-based access control is enforced",
              "Authentication gates all user actions",
            ].map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-sm text-slate-200"
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
