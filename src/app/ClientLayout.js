"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/auth/userContext";
import NotificationCreator from "@/components/notificationCreator";
import {
  listenToNotifications,
  pollTimeBasedNotifications,
  markNotificationRead,
} from "@/lib/business/notificationService";
import { deleteNotification } from "@/lib/data/firestoreRepository"; // Make sure this exists

export default function ClientLayout({ children }) {
  const { user, loading } = useUser();
  const router = useRouter();
  const [notifications, setNotifications] = useState([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);

  // Helper: format timestamps
  const formatTimestamp = (ts) => {
    if (!ts) return "No date";
    if (ts.seconds) return new Date(ts.seconds * 1000).toLocaleString();
    return new Date(ts).toLocaleString();
  };

  // ---------------- Real-time listener for all notifications ----------------
  useEffect(() => {
    if (!user) return;

    const unsubscribe = listenToNotifications(user.uid, (allNotifs) => {
      const now = new Date();

      // Show THREAD_CLOSED immediately, TIME_BASED only if due
      const visible = allNotifs.filter((n) => {
        if (n.type === "THREAD_CLOSED") return true;
        if (n.type !== "TIME_BASED") return true;
        if (!n.notifyAt) return true;
        return new Date(n.notifyAt) <= now;
      });

      const sorted = visible.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setNotifications(sorted);
    });

    return () => unsubscribe?.();
  }, [user]);

  // ---------------- Poll for TIME_BASED notifications as backup ----------------
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(async () => {
      try {
        const due = await pollTimeBasedNotifications(user.uid);
        if (due.length > 0) {
          setNotifications((prev) => {
            const merged = [...prev];
            for (const n of due) {
              if (!merged.some((m) => m.id === n.id)) merged.unshift(n);
            }
            return merged.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          });
        }
      } catch (err) {
        console.error("Failed to poll TIME_BASED notifications:", err);
      }
    }, 30000); // every 30s

    return () => clearInterval(interval);
  }, [user]);

  // ---------------- Mark notification as read ----------------
  const handleMarkRead = async (notif) => {
    if (!user) return;
    try {
      await markNotificationRead(user.uid, notif.id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
      );

      // Navigate if THREAD_CLOSED
      if (notif.type === "THREAD_CLOSED") {
        const { hiveID, honeycombID, threadID } = notif;
        if (hiveID && honeycombID && threadID) {
          router.push(`/hive/${hiveID}/honeycomb/${honeycombID}?thread=${threadID}`);
        }
      }
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
    }
  };

  // ---------------- Delete notification ----------------
  const handleDeleteNotification = async (notifID) => {
    if (!user) return;
    try {
      await deleteNotification(user.uid, notifID); // Firestore delete
      setNotifications((prev) => prev.filter((n) => n.id !== notifID)); // remove from UI
    } catch (err) {
      console.error("Failed to delete notification:", err);
    }
  };

  if (loading) return <p>Loading user info...</p>;

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="relative min-h-screen">
      {/* Notification Bell */}
      <div className="fixed top-4 right-4 z-50">
        <div className="relative">
          <button
            className="p-2 bg-white rounded-full shadow hover:bg-gray-100"
            onClick={() => setPanelOpen((prev) => !prev)}
          >
            🔔
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full text-xs w-5 h-5 flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          {/* Notification Panel */}
          {panelOpen && (
            <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-300 rounded shadow-lg overflow-hidden z-50">
              {/* Create Notification Button */}
              <div
                className="px-4 py-2 border-b border-gray-200 hover:bg-gray-100 cursor-pointer text-blue-600 font-semibold"
                onClick={() => setCreatorOpen((prev) => !prev)}
              >
                Create Notification
              </div>

              {/* Notification List */}
              {notifications.length === 0 ? (
                <p className="px-4 py-2 text-gray-500 text-sm">No notifications</p>
              ) : (
                notifications.map((notif) => (
                  <div
                    key={notif.id}
                    className={`px-4 py-2 border-b border-gray-200 hover:bg-gray-100 cursor-pointer flex justify-between items-center ${
                      notif.read ? "opacity-60" : "font-semibold"
                    }`}
                  >
                    {/* Notification text */}
                    <div
                      className="flex-1 mr-2"
                      onClick={() => handleMarkRead(notif)}
                    >
                      <p className="text-sm text-gray-800">{notif.message}</p>
                      <small className="text-gray-400 text-xs">
                        {formatTimestamp(notif.timestamp)}
                      </small>
                    </div>

                    {/* Delete button */}
                    <button
                      className="flex-shrink-0 text-red-500 hover:text-red-700 text-sm p-1 ml-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteNotification(notif.id);
                      }}
                    >
                      ✖
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Notification Creator */}
      {creatorOpen && (
        <div className="fixed top-20 right-4 z-50">
          <NotificationCreator
            hiveID={null}
            honeycombID={null}
            threadID={null}
            onClose={() => setCreatorOpen(false)}
          />
        </div>
      )}

      {/* Render children */}
      <div>{children}</div>
    </div>
  );
}
