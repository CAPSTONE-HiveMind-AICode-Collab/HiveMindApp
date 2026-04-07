"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/auth/userContext";

import NotificationCreator from "@/components/notificationCreator";
import NotificationPrompt from "@/components/NotificationPrompt";
import NotificationsPanel from "@/components/notificationPanel";
import {
  listenToNotifications,
  pollTimeBasedNotifications,
  markNotificationRead,
} from "@/lib/business/notificationService";

import { deleteNotification } from "@/lib/data/firestoreRepository";

import { loadToxicityModel } from "@/lib/business/ToxicityService";

export default function ClientLayout({ children }) {
  const { user, loading } = useUser();
  const router = useRouter();
  const [creatorOpen, setCreatorOpen] = useState(false);

  // ---------------------------------------------------------------------
  // Toxicity Model Warm-Up (Runs on App Load)
  // ---------------------------------------------------------------------
  useEffect(() => {
    loadToxicityModel()
      .then(() => console.log("✓ Toxicity model preloaded"))
      .catch((err) => console.error("Model warm-up failed:", err));
  }, []);

  // ---------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------
  if (loading) {
    return (
      <div className="page-shell">
        <div className="page-frame">
          <div className="hero-panel">
            <p className="text-kicker">HiveMind</p>
            <h1 className="text-display">
              <span className="text-gradient">Warming up your workspace</span>
            </h1>
            <p className="panel-subtitle">
              Loading identity, notifications, and the rest of the swarm.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // JSX UI
  // ---------------------------------------------------------------------
  return (
    <div className="app-chrome">
      <div className="app-backdrop" aria-hidden="true">
        <div className="app-orb one" />
        <div className="app-orb two" />
        <div className="app-orb three" />
        <div className="app-grid" />
      </div>

      {/* Use the NotificationsPanel component */}
      <NotificationsPanel />

      {/* Notification Permission Prompt */}
      <NotificationPrompt />

      <div className="app-content">{children}</div>
    </div>
  );
}
