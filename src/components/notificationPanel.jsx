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
import { deleteNotification } from "@/lib/data/firestoreRepository";

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
      const visibleNotifs = allNotifs.filter((notif) => {
        if (notif.type === "THREAD_CLOSED") return true;
        if (notif.type !== "TIME_BASED") return true;
        if (!notif.notifyAt) return true;
        const notifyAtDate = normalizeNotifyAt(notif.notifyAt);
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
          for (const notif of dueNotifs) {
            if (!merged.some((existing) => existing.id === notif.id)) merged.unshift(notif);
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
      prev.map((item) => (item.id === notif.id ? { ...item, read: true } : item))
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
      await deleteNotification(user.uid, notifID);
      setNotifications((prev) => prev.filter((item) => item.id !== notifID));
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
        prev.map((item) =>
          item.id === notif.id ? { ...item, status: "approved", read: true } : item
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
        prev.map((item) =>
          item.id === notif.id ? { ...item, status: "denied", read: true } : item
        )
      );
    } catch (err) {
      console.error("Error denying join request:", err);
      alert("Failed to deny request");
    } finally {
      setProcessing((prev) => ({ ...prev, [notif.id]: false }));
    }
  };

  const unreadCount = notifications.filter((item) => !item.read).length;

  return (
    <div className="notification-float fixed right-4 top-20 z-[99999]">
      <button
        className="relative rounded-full border border-cyan-300/30 bg-slate-950/70 p-4 shadow-2xl shadow-slate-950/35 transition-all hover:scale-105 hover:border-cyan-200/50 hover:bg-slate-900/85"
        onClick={togglePanel}
        type="button"
      >
        <span className="text-2xl font-semibold text-cyan-100">N</span>
        {unreadCount > 0 ? (
          <span className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-slate-950 bg-rose-500 text-sm font-bold text-white shadow-lg">
            {unreadCount}
          </span>
        ) : null}
      </button>

      {panelOpen ? (
        <div
          className="z-[99999] mt-3 max-h-[650px] w-[420px] overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/90 shadow-2xl"
          style={{ maxHeight: "650px" }}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-slate-950/95 p-4">
            <h3 className="text-xl font-bold text-white">Notifications</h3>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full text-2xl font-bold text-slate-400 transition-all hover:bg-white/10 hover:text-white"
              onClick={closePanel}
              type="button"
            >
              x
            </button>
          </div>

          {notifications.length === 0 ? (
            <p className="p-6 text-center text-base text-slate-400">No notifications</p>
          ) : (
            <ul>
              {notifications.map((notif) => (
                <li
                  key={notif.id}
                  className={`border-b border-white/8 p-4 transition-colors ${
                    notif.read ? "bg-slate-950/30 opacity-70" : "bg-white/5 font-semibold"
                  }`}
                >
                  {notif.type === "JOIN_REQUEST" && notif.status === "pending" ? (
                    <div className="space-y-3">
                      <div>
                        <p className="text-base text-white">{notif.message}</p>
                        <small className="text-xs text-slate-400">
                          {normalizeTimestamp(notif.timestamp).toLocaleString()} {" • "}
                          <span className="text-[11px] font-bold uppercase text-cyan-100">
                            {notif.type}
                          </span>
                        </small>
                      </div>

                      <div className="flex items-center gap-2">
                        <select
                          value={selectedRole[notif.id] || "MEMBER"}
                          onChange={(event) =>
                            setSelectedRole((prev) => ({
                              ...prev,
                              [notif.id]: event.target.value,
                            }))
                          }
                          className="select-shell text-sm"
                          disabled={processing[notif.id]}
                        >
                          <option value="VIEWER">VIEWER</option>
                          <option value="MEMBER">MEMBER</option>
                          <option value="ADMIN">ADMIN</option>
                        </select>

                        <button
                          onClick={() => handleApproveJoinRequest(notif)}
                          disabled={processing[notif.id]}
                          className="button-primary text-sm"
                          type="button"
                        >
                          Approve
                        </button>

                        <button
                          onClick={() => handleDenyJoinRequest(notif)}
                          disabled={processing[notif.id]}
                          className="button-danger text-sm"
                          type="button"
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between rounded-xl p-2 transition hover:bg-white/6">
                      <div
                        className="flex-1 cursor-pointer"
                        onClick={() => handleNotificationClick(notif)}
                      >
                        <p className="text-base text-white">{notif.message}</p>
                        <small className="text-xs text-slate-400">
                          {normalizeTimestamp(notif.timestamp).toLocaleString()} {" • "}
                          <span className="text-[11px] font-bold uppercase text-cyan-100">
                            {notif.type}
                          </span>
                          {notif.status && notif.status !== "pending" ? (
                            <span className="ml-1 text-[11px] font-semibold text-slate-300">
                              ({notif.status})
                            </span>
                          ) : null}
                        </small>
                      </div>
                      <button
                        className="ml-3 flex h-8 w-8 items-center justify-center rounded-full text-lg font-bold text-rose-200 transition-all hover:bg-rose-500/10 hover:text-rose-100"
                        onClick={() => handleDeleteNotification(notif.id)}
                        type="button"
                      >
                        x
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <audio ref={audioRef} src="/notification.mp3" preload="auto" />
    </div>
  );
}
