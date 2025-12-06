"use client";

import { useEffect, useState, useRef } from "react";
import { useUser } from "@/lib/auth/userContext";
import { useRouter } from "next/navigation";
import {
  pollTimeBasedNotifications,
  markNotificationRead,
  listenToNotifications,
  approveJoinRequest,
  denyJoinRequest,
} from "@/lib/business/notificationService";
import { deleteNotification } from "@/lib/data/firestoreRepository"; // Make sure this exists

export default function NotificationsPanel() {
  const { user } = useUser();
  const router = useRouter();
  const [notifications, setNotifications] = useState([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState({});
  const [processing, setProcessing] = useState({});
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

  const handleApproveJoinRequest = async (notif) => {
    const role = selectedRole[notif.id] || "MEMBER";
    setProcessing((prev) => ({ ...prev, [notif.id]: true }));

    try {
      await approveJoinRequest(
        notif.id,
        user.uid,
        notif.honeycombID,
        notif.hiveID,
        notif.requestingUserID,
        notif.requestingUserName,
        role
      );
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notif.id ? { ...n, status: "approved", read: true } : n
        )
      );
    } catch (err) {
      console.error("Error approving join request:", err);
      alert("Failed to approve request");
    } finally {
      setProcessing((prev) => ({ ...prev, [notif.id]: false }));
    }
  };

  const handleDenyJoinRequest = async (notif) => {
    setProcessing((prev) => ({ ...prev, [notif.id]: true }));

    try {
      await denyJoinRequest(
        notif.id,
        user.uid,
        notif.requestingUserID,
        notif.honeycombID,
        notif.hiveID
      );
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notif.id ? { ...n, status: "denied", read: true } : n
        )
      );
    } catch (err) {
      console.error("Error denying join request:", err);
      alert("Failed to deny request");
    } finally {
      setProcessing((prev) => ({ ...prev, [notif.id]: false }));
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="fixed top-20 right-4 z-[99999]">
      <button
        className="p-4 bg-gradient-to-r from-blue-500 to-blue-600 rounded-full shadow-2xl hover:from-blue-600 hover:to-blue-700 relative border-2 border-blue-300 transition-all transform hover:scale-110"
        onClick={togglePanel}
      >
        <span className="text-2xl">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full text-sm w-8 h-8 flex items-center justify-center animate-pulse font-bold shadow-lg border-2 border-white">
            {unreadCount}
          </span>
        )}
      </button>

      {panelOpen && (
        <div 
          className="mt-3 w-[420px] max-h-[650px] overflow-y-auto bg-white border-2 border-gray-400 shadow-2xl rounded-xl z-[99999]" 
          style={{ maxHeight: '650px' }}
        >
          <div className="flex justify-between items-center p-4 border-b-2 border-gray-300 bg-gradient-to-r from-blue-50 to-blue-100 sticky top-0 z-10">
            <h3 className="font-bold text-xl text-gray-900">🔔 Notifications</h3>
            <button
              className="text-gray-600 hover:text-gray-900 text-2xl font-bold hover:bg-gray-200 rounded-full w-8 h-8 flex items-center justify-center transition-all"
              onClick={closePanel}
            >
              ✖
            </button>
          </div>

          {notifications.length === 0 ? (
            <p className="p-6 text-gray-500 text-base text-center">No notifications</p>
          ) : (
            <ul>
              {notifications.map((notif) => (
                <li
                  key={notif.id}
                  className={`p-4 border-b border-gray-200 hover:bg-blue-50 transition-colors ${
                    notif.read ? "opacity-60 bg-gray-50" : "font-semibold bg-white"
                  }`}
                >
                  {notif.type === "JOIN_REQUEST" && notif.status === "pending" ? (
                    <div className="space-y-3">
                      <div>
                        <p className="text-base text-gray-900">{notif.message}</p>
                        <small className="text-gray-500 text-xs">
                          {normalizeTimestamp(notif.timestamp).toLocaleString()} {" • "}
                          <span className="uppercase text-[11px] font-bold text-blue-600">{notif.type}</span>
                        </small>
                      </div>

                      <div className="flex items-center gap-2">
                        <select
                          value={selectedRole[notif.id] || "MEMBER"}
                          onChange={(e) =>
                            setSelectedRole((prev) => ({
                              ...prev,
                              [notif.id]: e.target.value,
                            }))
                          }
                          className="text-sm border-2 border-gray-300 rounded-lg px-3 py-2 font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                          disabled={processing[notif.id]}
                        >
                          <option value="VIEWER">👁️ VIEWER</option>
                          <option value="MEMBER">👤 MEMBER</option>
                          <option value="ADMIN">⚡ ADMIN</option>
                        </select>

                        <button
                          onClick={() => handleApproveJoinRequest(notif)}
                          disabled={processing[notif.id]}
                          className="text-sm bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-400 font-semibold shadow-md transition-all"
                        >
                          ✓ Approve
                        </button>

                        <button
                          onClick={() => handleDenyJoinRequest(notif)}
                          disabled={processing[notif.id]}
                          className="text-sm bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:bg-gray-400 font-semibold shadow-md transition-all"
                        >
                          ✗ Deny
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-between items-center cursor-pointer hover:bg-blue-100 transition p-2 rounded-lg">
                      <div
                        className="flex-1"
                        onClick={() => handleNotificationClick(notif)}
                      >
                        <p className="text-base text-gray-900">{notif.message}</p>
                        <small className="text-gray-500 text-xs">
                          {normalizeTimestamp(notif.timestamp).toLocaleString()} {" • "}
                          <span className="uppercase text-[11px] font-bold text-blue-600">{notif.type}</span>
                          {notif.status && notif.status !== "pending" && (
                            <span className="ml-1 text-[11px] text-gray-600 font-semibold">
                              ({notif.status})
                            </span>
                          )}
                        </small>
                      </div>
                      <button
                        className="ml-3 text-red-600 text-lg hover:text-red-800 hover:bg-red-100 rounded-full w-8 h-8 flex items-center justify-center transition-all font-bold"
                        onClick={() => handleDeleteNotification(notif.id)}
                      >
                        ✖
                      </button>
                    </div>
                  )}
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
