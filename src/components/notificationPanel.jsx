"use client";

import { useEffect, useState, useRef } from "react";
import { useUser } from "@/lib/auth/userContext";
import { useRouter } from "next/navigation";
import {
  pollTimeBasedNotifications,
  markNotificationRead,
  listenToNotifications,
} from "@/lib/business/notificationService";
import { deleteNotification } from "@/lib/data/firestoreRepository"; // Make sure this exists

export default function NotificationsPanel() {
  const { user } = useUser();
  const router = useRouter();
  const [notifications, setNotifications] = useState([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const audioRef = useRef(null);
  const prevCount = useRef(0);

  const togglePanel = () => setPanelOpen((prev) => !prev);
  const closePanel = () => setPanelOpen(false);

  const normalizeTimestamp = (ts) => {
    if (!ts) return new Date(0);
    if (typeof ts?.toDate === "function") return ts.toDate();
    if (ts?.seconds) return new Date(ts.seconds * 1000);
    if (typeof ts === "string") return new Date(ts);
    return ts instanceof Date ? ts : new Date(ts);
  };

  const normalizeNotifyAt = (ts) => {
    if (!ts) return null;
    if (typeof ts?.toDate === "function") return ts.toDate();
    if (ts?.seconds) return new Date(ts.seconds * 1000);
    if (typeof ts === "string") return new Date(ts);
    return ts instanceof Date ? ts : new Date(ts);
  };

  useEffect(() => {
    if (!user) return;

    const unsubscribe = listenToNotifications(user.uid, (allNotifs) => {
      const now = new Date();
      const visibleNotifs = allNotifs.filter((n) => {
        if (n.type === "THREAD_CLOSED") return true;
        if (n.type !== "TIME_BASED") return true;
        if (!n.notifyAt) return true;
        const notifyAtDate = normalizeNotifyAt(n.notifyAt);
        return notifyAtDate <= now;
      });

      const sorted = visibleNotifs.sort(
        (a, b) => normalizeTimestamp(b.timestamp) - normalizeTimestamp(a.timestamp)
      );

      setNotifications(sorted);
    });

    const interval = setInterval(async () => {
      const dueNotifs = await pollTimeBasedNotifications(user.uid);
      if (dueNotifs.length > 0) {
        setNotifications((prev) => {
          const merged = [...prev];
          for (const n of dueNotifs) {
            if (!merged.some((m) => m.id === n.id)) merged.unshift(n);
          }
          return merged.sort(
            (a, b) => normalizeTimestamp(b.timestamp) - normalizeTimestamp(a.timestamp)
          );
        });
      }
    }, 30000);

    return () => {
      clearInterval(interval);
      unsubscribe?.();
    };
  }, [user]);

  useEffect(() => {
    if (notifications.length > prevCount.current) {
      audioRef.current?.play().catch(() => {});
    }
    prevCount.current = notifications.length;
  }, [notifications]);

  const handleNotificationClick = async (notif) => {
    await markNotificationRead(user.uid, notif.id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
    );

    if (notif.type === "THREAD_CLOSED") {
      const { hiveID, honeycombID, threadID } = notif;
      if (hiveID && honeycombID && threadID) {
        router.push(`/hive/${hiveID}/honeycomb/${honeycombID}?thread=${threadID}`);
      }
    }
  };

  const handleDeleteNotification = async (notifID) => {
    try {
      await deleteNotification(user.uid, notifID); // remove from Firestore
      setNotifications((prev) => prev.filter((n) => n.id !== notifID)); // remove from UI
    } catch (err) {
      console.error("Failed to delete notification:", err);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="fixed top-4 right-4 z-50">
      <button
        className="p-2 bg-white rounded-full shadow hover:bg-gray-100 relative"
        onClick={togglePanel}
      >
        🔔
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full text-xs w-5 h-5 flex items-center justify-center animate-pulse">
            {unreadCount}
          </span>
        )}
      </button>

      {panelOpen && (
        <div className="mt-2 w-80 max-h-96 overflow-y-auto bg-white border border-gray-300 shadow-lg rounded-lg animate-fade-in">
          <div className="flex justify-between items-center p-2 border-b border-gray-200">
            <h3 className="font-bold text-lg">Notifications</h3>
            <button
              className="text-gray-500 hover:text-gray-800 text-sm"
              onClick={closePanel}
            >
              ✖
            </button>
          </div>

          {notifications.length === 0 ? (
            <p className="p-2 text-gray-500 text-sm">No notifications</p>
          ) : (
            <ul>
              {notifications.map((notif) => (
                <li
                  key={notif.id}
                  className={`p-2 border-b border-gray-200 cursor-pointer hover:bg-gray-100 transition flex justify-between items-center ${
                    notif.read ? "opacity-60" : "font-semibold"
                  }`}
                >
                  <div
                    className="flex-1"
                    onClick={() => handleNotificationClick(notif)}
                  >
                    <p className="text-sm">{notif.message}</p>
                    <small className="text-gray-400 text-xs">
                      {normalizeTimestamp(notif.timestamp).toLocaleString()} {" • "}
                      <span className="uppercase text-[10px]">{notif.type}</span>
                    </small>
                  </div>
                  <button
                    className="ml-2 text-red-500 text-xs hover:text-red-700"
                    onClick={() => handleDeleteNotification(notif.id)}
                  >
                    ✖
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <audio ref={audioRef} src="/notification.mp3" preload="auto" />
    </div>
  );
}
