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
      
      // Show prompt if supported and not yet decided
      if (isNotificationSupported() && getNotificationPermission() === "default") {
        // Wait 5 seconds before showing prompt (better UX)
        const timer = setTimeout(() => {
          setShowPrompt(true);
        }, 5000);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    // Listen for foreground messages
    const unsubscribe = onMessageListener((payload) => {
      console.log("Notification received:", payload);
      // You can add custom notification handling here
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
    // Remember dismissal for this session
    sessionStorage.setItem("notificationPromptDismissed", "true");
  };

  if (!showPrompt || permission !== "default") {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-white rounded-lg shadow-2xl border-2 border-blue-200 p-4 animate-slide-up">
      <div className="flex items-start gap-3">
        <div className="bg-blue-100 rounded-full p-2 flex-shrink-0">
          <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </div>

        <div className="flex-1">
          <h3 className="text-lg font-bold text-gray-800 mb-1">
            🐝 Stay Updated with HiveMind
          </h3>
          <p className="text-sm text-gray-600 mb-3">
            Get instant notifications when you're mentioned in threads, when discussions are closed, or when important updates happen in your hives.
          </p>

          <div className="flex gap-2">
            <button
              onClick={handleEnableNotifications}
              className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-2 rounded-lg font-semibold hover:from-blue-700 hover:to-indigo-700 transition-all"
            >
              Enable Notifications
            </button>
            <button
              onClick={handleDismiss}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
            >
              Not Now
            </button>
          </div>
        </div>

        <button
          onClick={handleDismiss}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  );
}
