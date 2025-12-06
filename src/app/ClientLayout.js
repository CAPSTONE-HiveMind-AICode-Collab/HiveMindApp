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
  if (loading) return <p>Loading user info...</p>;

  // ---------------------------------------------------------------------
  // JSX UI
  // ---------------------------------------------------------------------
  return (
    <div className="relative min-h-screen">
      {/* Use the NotificationsPanel component */}
      <NotificationsPanel />

      {/* Notification Permission Prompt */}
      <NotificationPrompt />

      <div>{children}</div>
    </div>
  );
}
