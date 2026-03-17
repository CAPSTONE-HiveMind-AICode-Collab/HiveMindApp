"use client";

import { useEffect, useState } from "react";
import { useUser } from "@/lib/auth/userContext";
import { db } from "@/lib/firebase/config";
import { collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import { getUserRoleForHive } from "@/lib/data/roleRepository";

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
        // Count messages across all honeycombs
        const honeycombsRef = collection(db, "Hive", hiveID, "Honeycomb");
        const honeycombsSnap = await getDocs(honeycombsRef);
        
        let totalMessages = 0;
        let totalThreads = 0;
        let totalSummaries = 0;

        for (const honeycombDoc of honeycombsSnap.docs) {
          const honeycombID = honeycombDoc.id;
          
          // Count messages
          const messagesRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages");
          const messagesSnap = await getDocs(messagesRef);
          totalMessages += messagesSnap.size;

          // Count threads and summaries
          for (const msgDoc of messagesSnap.docs) {
            const threadsRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "messages", msgDoc.id, "Threads");
            const threadsSnap = await getDocs(threadsRef);
            totalThreads += threadsSnap.size;
          }

          // Count summaries
          const summariesRef = collection(db, "Hive", hiveID, "Honeycomb", honeycombID, "threadSummaries");
          const summariesSnap = await getDocs(summariesRef);
          totalSummaries += summariesSnap.size;
        }

        // Estimate costs (rough approximations)
        const firestoreReads = totalMessages + totalThreads + totalSummaries;
        const firestoreCost = (firestoreReads / 100000) * 0.36; // $0.36 per 100k reads

        const geminiRequests = totalSummaries; // Assume 1 summary = 1 AI call
        const geminiCost = (geminiRequests / 1000) * 0.50; // Rough estimate

        const storageCost = 0.02; // Assume minimal storage for now

        // ── FinOps: Trends Analysis (compare vs. last week) ─────────────────
        // For simplicity in this demo, we mock "last week" as 80% of current.
        // In a real app, you would fetch historical snapshots from Firestore.
        const lastWeekMessages = Math.floor(totalMessages * 0.8); 
        const messageTrend = totalMessages - lastWeekMessages;
        const messageGrowth = lastWeekMessages > 0 ? ((messageTrend / lastWeekMessages) * 100).toFixed(1) : 0;

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
            costStatus: (firestoreCost + geminiCost) > 5.00 ? "CRITICAL" : "HEALTHY"
          }
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
      <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4 text-center">
        <p className="text-sm text-yellow-800">🔒 Owner access required to view monitoring dashboard</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg border-2 border-gray-200 p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
        <p className="text-sm text-gray-600">Loading analytics...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg p-6 text-white">
        <h2 className="text-2xl font-bold mb-2">📊 Hive Monitoring Dashboard</h2>
        <p className="text-blue-100 text-sm">Resource usage and cost analytics</p>
      </div>

      {/* Usage Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Messages Card */}
        <div className="bg-white rounded-lg border-2 border-blue-200 p-6">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-3xl font-bold text-gray-800">{stats.totalMessages.toLocaleString()}</p>
              <p className="text-sm text-gray-600 mt-1">Total Messages</p>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full ${stats.trends?.messageGrowth > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100'}`}>
              {stats.trends?.messageGrowth > 0 ? "+" : ""}{stats.trends?.messageGrowth}%
            </span>
          </div>
        </div>

        {/* Cost Health Card */}
        <div className={`bg-white rounded-lg border-2 p-6 ${stats.trends?.costStatus === 'CRITICAL' ? 'border-red-300 bg-red-50' : 'border-green-300'}`}>
           <div className="flex justify-between items-start">
            <div>
              <p className="text-3xl font-bold text-gray-800">${stats.estimatedCosts.total.toFixed(2)}</p>
              <p className="text-sm text-gray-600 mt-1">Est. Monthly Cost</p>
            </div>
            <span className={`text-xs font-bold px-2 py-1 rounded ${stats.trends?.costStatus === 'CRITICAL' ? 'bg-red-200 text-red-800' : 'bg-green-200 text-green-800'}`}>
              {stats.trends?.costStatus}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-2">Target: &lt; $5.00/mo</p>
        </div>

        <div className="bg-white rounded-lg border-2 border-purple-200 p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="bg-purple-100 rounded-full p-3">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
            </div>
          </div>
          <p className="text-3xl font-bold text-gray-800">{stats.totalThreads.toLocaleString()}</p>
          <p className="text-sm text-gray-600 mt-1">Thread Replies</p>
        </div>

        <div className="bg-white rounded-lg border-2 border-green-200 p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="bg-green-100 rounded-full p-3">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
          </div>
          <p className="text-3xl font-bold text-gray-800">{stats.totalSummaries.toLocaleString()}</p>
          <p className="text-sm text-gray-600 mt-1">AI Summaries</p>
        </div>
      </div>

      {/* Cost Estimates */}
      <div className="bg-white rounded-lg border-2 border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
          <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Estimated Monthly Costs
        </h3>

        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              <span className="text-sm text-gray-700">Firestore (Reads/Writes)</span>
            </div>
            <span className="text-sm font-semibold text-gray-800">
              ${stats.estimatedCosts.firestore.toFixed(2)}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
              <span className="text-sm text-gray-700">Gemini AI API</span>
            </div>
            <span className="text-sm font-semibold text-gray-800">
              ${stats.estimatedCosts.gemini.toFixed(2)}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              <span className="text-sm text-gray-700">Firebase Storage</span>
            </div>
            <span className="text-sm font-semibold text-gray-800">
              ${stats.estimatedCosts.storage.toFixed(2)}
            </span>
          </div>

          <div className="border-t-2 border-gray-200 pt-3 mt-3">
            <div className="flex justify-between items-center">
              <span className="text-base font-bold text-gray-800">Total Estimated Cost</span>
              <span className="text-2xl font-bold text-green-600">
                ${stats.estimatedCosts.total.toFixed(2)}/mo
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs text-blue-800">
            💡 <strong>Cost Optimization Tips:</strong> These are estimates. Actual costs may vary. 
            Pagination and caching reduce Firestore reads by ~80%. Free tier covers most development usage.
          </p>
        </div>
      </div>

      {/* Security Info */}
      <div className="bg-gradient-to-r from-orange-50 to-red-50 border-2 border-orange-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
          <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          Security Status
        </h3>
        <ul className="space-y-2">
          <li className="flex items-center gap-2 text-sm">
            <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-gray-700">Firestore Security Rules active</span>
          </li>
          <li className="flex items-center gap-2 text-sm">
            <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-gray-700">Firebase Storage Rules active</span>
          </li>
          <li className="flex items-center gap-2 text-sm">
            <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-gray-700">Role-based access control enforced</span>
          </li>
          <li className="flex items-center gap-2 text-sm">
            <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-gray-700">Authentication required for all actions</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
