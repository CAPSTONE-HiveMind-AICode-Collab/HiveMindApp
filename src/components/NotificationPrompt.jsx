"use client";

import { useEffect, useState } from "react";
import {
  requestNotificationPermission,
  onMessageListener,
  saveFCMToken,
  isNotificationSupported,
  getNotificationPermission,
} from "@/lib/messaging/fcmService";
import { useUser } from "@/lib/auth/userContext";

export default function NotificationPrompt() {
  const { user } = useUser();
  const [showPrompt, setShowPrompt] = useState(false);
  const [permission, setPermission] = useState("default");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setPermission(getNotificationPermission());

      if (isNotificationSupported() && getNotificationPermission() === "default") {
        const timer = setTimeout(() => {
          setShowPrompt(true);
        }, 5000);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    const unsubscribe = onMessageListener((payload) => {
      console.log("Notification received:", payload);
    });

    return unsubscribe;
  }, [user]);

  const handleEnableNotifications = async () => {
    const token = await requestNotificationPermission();

    if (token && user) {
      await saveFCMToken(user.uid, token);
      setPermission("granted");
      setShowPrompt(false);
    } else {
      setPermission("denied");
      setShowPrompt(false);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    sessionStorage.setItem("notificationPromptDismissed", "true");
  };

  if (!showPrompt || permission !== "default") {
    return null;
  }

  return (
    <div className="notification-float fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl border border-white/10 bg-slate-950/92 p-4 shadow-2xl">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 rounded-full bg-cyan-300/12 p-3">
          <svg className="h-6 w-6 text-cyan-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </div>

        <div className="flex-1">
          <h3 className="text-lg font-bold text-white">Stay synced with HiveMind</h3>
          <p className="mt-2 text-sm text-slate-300">
            Get alerted when threads close, approvals need your attention, or key updates land in
            your hive.
          </p>

          <div className="mt-4 flex gap-2">
            <button
              onClick={handleEnableNotifications}
              className="button-primary flex-1"
              type="button"
            >
              Enable
            </button>
            <button onClick={handleDismiss} className="button-ghost" type="button">
              Not now
            </button>
          </div>
        </div>

        <button onClick={handleDismiss} className="text-slate-400 transition hover:text-white" type="button">
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  );
}
