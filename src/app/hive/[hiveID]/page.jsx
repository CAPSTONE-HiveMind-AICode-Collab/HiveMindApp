"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { collection, doc, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { useUser } from "@/lib/auth/userContext";
import {
  getUserRoleForHive,
  listHiveMembers,
  markHiveBriefingSeen,
  setUserRoleForHive,
} from "@/lib/data/roleRepository";
import { checkPermission } from "@/lib/business/permissionService";
import { getAllUnreadCounts, updateLastSeen } from "@/lib/business/chatService";
import { subscribeToHivePresence, syncHivePresence } from "@/lib/data/presenceRepository";
import IAMAdminPanel from "@/components/IAMAdminPanel";
import PermissionBadge from "@/components/PermissionBadge";
import HiveGuard from "@/components/HiveGuard";
import DecisionMemoryPanel from "@/components/DecisionMemoryPanel";
import TaskBoard from "@/components/TaskBoard";
import WorkspaceOverviewPanel from "@/components/WorkspaceOverviewPanel";
import NewMemberBriefPanel from "@/components/NewMemberBriefPanel";
import UserAvatar from "@/components/UserAvatar";

const dashboardTabs = [
  { id: "workspace", label: "Workspace" },
  { id: "work", label: "Work" },
  { id: "admin", label: "Admin" },
];

const roleTone = {
  OWNER: "bg-amber-300/15 text-amber-100 border border-amber-200/25",
  ADMIN: "bg-violet-300/15 text-violet-100 border border-violet-200/25",
  MEMBER: "bg-sky-300/15 text-sky-100 border border-sky-200/25",
  VIEWER: "bg-slate-300/10 text-slate-100 border border-slate-200/15",
};

export default function HivePage() {
  const { hiveID } = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, loading } = useUser();
  const requestedTab = String(searchParams?.get("tab") || "");

  const [userRole, setUserRole] = useState(null);
  const [members, setMembers] = useState([]);
  const [honeycombs, setHoneycombs] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [hiveMeta, setHiveMeta] = useState(null);
  const [presenceMap, setPresenceMap] = useState({});
  const [newHoneycombName, setNewHoneycombName] = useState("");
  const [unreadCounts, setUnreadCounts] = useState({});
  const [highlightDecisionId, setHighlightDecisionId] = useState("");
  const [taskDecisionFilterId, setTaskDecisionFilterId] = useState("");
  const [showBriefing, setShowBriefing] = useState(false);
  const [activeTab, setActiveTab] = useState(
    dashboardTabs.some((tab) => tab.id === requestedTab) ? requestedTab : "workspace"
  );

  useEffect(() => {
    if (!requestedTab) return;
    if (!dashboardTabs.some((tab) => tab.id === requestedTab)) return;
    setActiveTab(requestedTab);
  }, [requestedTab]);

  useEffect(() => {
    if (!user || !hiveID) return;

    async function loadRoleAndMembers() {
      try {
        const [role, memberList] = await Promise.all([
          getUserRoleForHive(hiveID, user.uid),
          listHiveMembers(hiveID),
        ]);

        const isMember = memberList.some((member) => member.uid === user.uid);
        if (!isMember) {
          alert(
            "You do not have access to this hive. You need to request access via a honeycomb invitation."
          );
          router.push("/dashboard");
          return;
        }

        setUserRole(role || "VIEWER");
        setMembers(memberList);
        const currentMember = memberList.find((member) => member.uid === user.uid);
        setShowBriefing(Boolean(currentMember && currentMember.hasSeenBriefing === false));
      } catch (error) {
        console.error("Failed to load role/members:", error);
        setUserRole("VIEWER");
      }
    }

    loadRoleAndMembers();

    const membersRef = collection(db, "Hive", String(hiveID), "members");
    const unsubscribe = onSnapshot(membersRef, (snapshot) => {
      const memberList = snapshot.docs.map((memberDoc) => ({
        uid: memberDoc.id,
        ...memberDoc.data(),
      }));
      setMembers(memberList);
      const currentMember = memberList.find((member) => member.uid === user?.uid);
      setShowBriefing(Boolean(currentMember && currentMember.hasSeenBriefing === false));
    });

    return () => unsubscribe();
  }, [user, hiveID, router]);

  useEffect(() => {
    if (!user || !hiveID || !userRole) return;

    setUserRoleForHive(String(hiveID), user.uid, userRole, {
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL,
    }).catch((error) => {
      console.error("Failed to sync member profile avatar:", error);
    });
  }, [hiveID, user, userRole]);

  useEffect(() => {
    if (!hiveID) return;

    const hiveRef = doc(db, "Hive", String(hiveID));
    return onSnapshot(
      hiveRef,
      (snapshot) => {
        setHiveMeta(snapshot.exists() ? snapshot.data() : null);
      },
      (error) => {
        console.error("Failed to load hive metadata:", error);
      }
    );
  }, [hiveID]);

  useEffect(() => {
    if (!user || !hiveID) return;

    const honeycombRef = collection(db, "Hive", String(hiveID), "Honeycomb");
    const decisionsRef = query(
      collection(db, "Hive", String(hiveID), "decisionRecords"),
      orderBy("updatedAt", "desc")
    );
    const tasksRef = query(
      collection(db, "Hive", String(hiveID), "tasks"),
      orderBy("createdAt", "desc")
    );

    const unsubHoneycombs = onSnapshot(honeycombRef, (snapshot) => {
      const list = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      setHoneycombs(list);
    });

    const unsubDecisions = onSnapshot(
      decisionsRef,
      (snapshot) => {
        setDecisions(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      },
      (error) => {
        console.error("Error subscribing to decisions:", error);
      }
    );

    const unsubTasks = onSnapshot(
      tasksRef,
      (snapshot) => {
        setTasks(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      },
      (error) => {
        console.error("Error subscribing to tasks:", error);
      }
    );

    return () => {
      unsubHoneycombs();
      unsubDecisions();
      unsubTasks();
    };
  }, [user, hiveID]);

  useEffect(() => {
    if (!user || !hiveID) return;

    const stopPresenceSync = syncHivePresence({
      hiveID: String(hiveID),
      user,
    });

    const unsubscribe = subscribeToHivePresence(String(hiveID), (nextPresence) => {
      setPresenceMap(nextPresence || {});
    });

    return () => {
      stopPresenceSync?.();
      unsubscribe?.();
    };
  }, [user, hiveID]);

  useEffect(() => {
    if (!user || !hiveID) return;

    async function fetchUnread() {
      try {
        const counts = await getAllUnreadCounts(hiveID, user.uid);
        setUnreadCounts(counts);
      } catch (error) {
        console.error("Failed to load unread counts:", error);
      }
    }

    fetchUnread();
    const interval = setInterval(fetchUnread, 10000);
    return () => clearInterval(interval);
  }, [user, hiveID]);

  const createHoneycomb = async () => {
    if (!newHoneycombName.trim() || !user) return;

    const allowed = userRole ? checkPermission(userRole, "CREATE_HONEYCOMB") : true;
    if (!allowed) {
      alert("You do not have permission to create honeycombs in this hive.");
      return;
    }

    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const honeycombID = `${timestamp}_${randomStr}`;

    await setDoc(doc(db, "Hive", String(hiveID), "Honeycomb", honeycombID), {
      name: newHoneycombName.trim(),
      displayName: newHoneycombName.trim(),
      createdAt: new Date(),
    });

    setNewHoneycombName("");
  };

  const openHoneycomb = async (honeycombID) => {
    if (user) {
      await updateLastSeen(hiveID, honeycombID, null, user.uid);
    }
    router.push(`/hive/${hiveID}/honeycomb/${honeycombID}`);
  };

  const openSourceThread = (honeycombID, parentMessageID) => {
    if (!honeycombID || !parentMessageID) return;
    router.push(`/hive/${hiveID}/honeycomb/${honeycombID}?thread=${parentMessageID}`);
  };

  const copyHoneycombId = async (honeycombID, event) => {
    event.stopPropagation();
    await navigator.clipboard.writeText(honeycombID);
    alert("Honeycomb ID copied. Share it so people can request access.");
  };

  const enterHive = async () => {
    if (!user?.uid) return;

    try {
      await markHiveBriefingSeen(String(hiveID), user.uid);
      setShowBriefing(false);
    } catch (error) {
      console.error("Failed to mark briefing as seen:", error);
      alert("Could not close the briefing right now.");
    }
  };

  const roomNameById = useMemo(
    () =>
      Object.fromEntries(
        honeycombs.map((room) => [String(room.id), room.displayName || room.name || room.id])
      ),
    [honeycombs]
  );
  const roomStatsById = useMemo(() => {
    return Object.fromEntries(
      honeycombs.map((room) => {
        const roomId = String(room.id);
        const roomDecisions = decisions.filter(
          (decision) =>
            String(decision.honeycombID || decision.source?.honeycombID || "") === roomId
        );
        const roomTasks = tasks.filter(
          (task) => String(task.source?.honeycombID || "") === roomId
        );
        const openRoomTasks = roomTasks.filter(
          (task) => !["done", "closed", "complete", "completed", "archived"].includes(String(task.status || "").toLowerCase())
        );

        return [
          roomId,
          {
            decisions: roomDecisions.length,
            openTasks: openRoomTasks.length,
          },
        ];
      })
    );
  }, [decisions, honeycombs, tasks]);

  if (loading) {
    return (
      <div className="page-shell">
        <div className="page-frame">
          <section className="hero-panel">
            <p className="text-kicker">Hive</p>
            <h1 className="text-display">
              <span className="text-gradient">Loading access</span>
            </h1>
          </section>
        </div>
      </div>
    );
  }

  if (!user) {
    router.replace("/");
    return null;
  }

  if (userRole === null) {
    return (
      <div className="page-shell">
        <div className="page-frame">
          <section className="hero-panel">
            <p className="text-kicker">Hive</p>
            <h1 className="text-display">
              <span className="text-gradient">Checking permissions</span>
            </h1>
          </section>
        </div>
      </div>
    );
  }

  const hiveTitle = String(hiveMeta?.name || hiveID);
  const hiveSubtitle =
    String(hiveMeta?.description || "").trim() ||
    "Discussion rooms, decision memory, task execution, and AI context for this team.";
  const ownerAccess = userRole === "OWNER";

  return (
    <div className="page-shell">
      <div className="page-frame">
        <section className="workspace-shell">
          <div className="workspace-topbar">
            <div className="workspace-brand">
              <div className="workspace-brand-mark">HM</div>
              <div className="workspace-brand-copy">
                <div className="workspace-brand-path">
                  <span>{hiveTitle}</span>
                  <span>/</span>
                  <span>Dashboard</span>
                </div>
                <h1 className="workspace-brand-title">{hiveTitle}</h1>
                <p className="workspace-brand-subtitle">{hiveSubtitle}</p>
              </div>
            </div>

            <div className="workspace-topbar-actions">
              <div className="workspace-meta-strip">
                <span className="status-pill">Role: {userRole}</span>
                <span className="status-pill">{members.length} members</span>
                <span className="status-pill">{honeycombs.length} rooms</span>
              </div>

              <div className="workspace-topbar-buttons">
                <div className="workspace-user-pill">
                  <UserAvatar user={user} className="workspace-user-avatar" size="md" />
                  <div className="workspace-user-copy">
                    <strong>{user.displayName || user.email?.split("@")[0] || "User"}</strong>
                    <span>{user.email || "Signed in"}</span>
                  </div>
                </div>
                <div className="hud-panel workspace-permission-card">
                  <PermissionBadge hiveID={hiveID} userId={user.uid} />
                </div>
                <button
                  onClick={() => router.push("/dashboard")}
                  className="button-ghost"
                  type="button"
                >
                  Back
                </button>
              </div>
            </div>
          </div>

          <div className="workspace-nav">
            {dashboardTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`workspace-nav-button ${activeTab === tab.id ? "active" : ""}`}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
        </section>

        {activeTab === "workspace" ? (
          <WorkspaceOverviewPanel
            hiveID={String(hiveID)}
            hiveName={hiveTitle}
            currentUser={user}
            userRole={userRole}
            decisions={decisions}
            tasks={tasks}
            honeycombs={honeycombs}
            members={members}
            presenceMap={presenceMap}
            onOpenThread={openSourceThread}
            onOpenDecisionMemory={() => setActiveTab("work")}
            onOpenTaskBoard={() => setActiveTab("work")}
          />
        ) : null}

        {activeTab === "work" ? (
          <>
            <section className="stack-grid">
              <div className="glass-panel">
                <p className="panel-title">Create a honeycomb</p>
                <p className="panel-subtitle">
                  Start a focused conversation room inside this hive.
                </p>
                <div className="action-row mt-5">
                  <input
                    type="text"
                    value={newHoneycombName}
                    onChange={(event) => setNewHoneycombName(event.target.value)}
                    placeholder="Name the new honeycomb"
                    className="input-shell min-w-[240px] flex-1"
                  />
                  <button onClick={createHoneycomb} className="button-primary" type="button">
                    Create honeycomb
                  </button>
                </div>
              </div>

              <div className="glass-panel">
                <p className="panel-title">Member directory</p>
                <p className="panel-subtitle">
                  Everyone currently attached to this hive and the role they hold.
                </p>

                {members.length === 0 ? (
                  <div className="empty-state mt-6">No member records yet.</div>
                ) : (
                  <div className="card-grid mt-6">
                    {members.map((member) => (
                      <article key={member.uid} className="surface-card">
                        <div className="surface-card-inner">
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex min-w-0 items-center gap-4">
                              <UserAvatar
                                name={member.displayName}
                                email={member.email}
                                photoURL={member.photoURL}
                                className="workspace-member-avatar"
                                size="fill"
                              />
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-white">
                                  {member.displayName || member.email || member.uid}
                                </div>
                                {member.email ? (
                                  <div className="mt-1 truncate text-sm text-slate-300">
                                    {member.email}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            <span
                              className={`self-start rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${
                                roleTone[member.role] || roleTone.VIEWER
                              }`}
                            >
                              {member.role}
                            </span>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="glass-panel">
              <div className="chat-header">
                <div>
                  <p className="text-kicker">Channels</p>
                  <h2 className="panel-title text-2xl">Honeycomb list</h2>
                </div>
                <span className="status-pill">
                  {honeycombs.length === 1 ? "1 room" : `${honeycombs.length} rooms`}
                </span>
              </div>

              {honeycombs.length === 0 ? (
                <div className="empty-state mt-6">
                  No honeycombs yet. Create the first conversation room for this hive.
                </div>
              ) : (
                <div className="card-grid mt-6">
                  {honeycombs.map((honeycomb) => {
                    const roomLabel = honeycomb.displayName || honeycomb.name || "Untitled room";
                    const roomStats = roomStatsById[honeycomb.id] || { decisions: 0, openTasks: 0 };

                    return (
                      <article
                        key={honeycomb.id}
                        className="surface-card cursor-pointer"
                        onClick={() => openHoneycomb(honeycomb.id)}
                      >
                        <div className="surface-card-inner space-y-5">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="panel-title">{roomLabel}</p>
                              <p className="panel-subtitle">
                                Open the live chat, decisions, tasks, and AI support for this room.
                              </p>
                            </div>
                            {(unreadCounts[honeycomb.id] || 0) > 0 ? (
                              <span className="status-pill bg-rose-300/15 text-rose-100">
                                {unreadCounts[honeycomb.id]} unread
                              </span>
                            ) : null}
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <span className="status-pill">
                              {roomStats.decisions} {roomStats.decisions === 1 ? "decision" : "decisions"}
                            </span>
                            <span className="status-pill">
                              {roomStats.openTasks} open {roomStats.openTasks === 1 ? "task" : "tasks"}
                            </span>
                            <span className="status-pill">Display name only in workspace</span>
                          </div>

                          <div className="action-row">
                            <button
                              onClick={(event) => copyHoneycombId(honeycomb.id, event)}
                              className="button-secondary"
                              type="button"
                            >
                              Copy invite code
                            </button>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                openHoneycomb(honeycomb.id);
                              }}
                              className="button-primary"
                              type="button"
                            >
                              Open room
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <DecisionMemoryPanel
              hiveID={String(hiveID)}
              decisions={decisions}
              roomNameById={roomNameById}
              onOpenThread={openSourceThread}
              onOpenTasksTab={(decisionID) => {
                setHighlightDecisionId(decisionID || "");
                setTaskDecisionFilterId(decisionID || "");
                setActiveTab("work");
              }}
              highlightDecisionId={highlightDecisionId}
            />

            <TaskBoard
              hiveID={String(hiveID)}
              tasks={tasks}
              members={members}
              decisions={decisions}
              currentUser={user}
              filterDecisionId={taskDecisionFilterId}
              onClearDecisionFilter={() => setTaskDecisionFilterId("")}
              onOpenSource={openSourceThread}
              onOpenDecision={(decisionID) => {
                setTaskDecisionFilterId("");
                setHighlightDecisionId(decisionID || "");
                setActiveTab("work");
              }}
            />
          </>
        ) : null}

        {activeTab === "admin" ? (
          ownerAccess ? (
            <>
              <section className="glass-panel overflow-visible">
                <IAMAdminPanel hiveID={String(hiveID)} />
              </section>

              <section className="glass-panel overflow-visible">
                <HiveGuard hiveID={String(hiveID)} currentUserRole={userRole} />
              </section>
            </>
          ) : (
            <section className="glass-panel">
              <div className="space-y-4">
                <span className="hero-chip">Admin</span>
                <div>
                  <h2 className="panel-title text-2xl text-white">Owner controls only</h2>
                  <p className="panel-subtitle">
                    IAM administration and HiveGuard remain grouped here, but only owners can open
                    them.
                  </p>
                </div>

                <div className="hud-panel">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-300/60">
                    Your access
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <span className="status-pill">Role: {userRole}</span>
                    <span className="status-pill">Contact an owner for elevated access</span>
                  </div>
                </div>
              </div>
            </section>
          )
        ) : null}
      </div>

      {showBriefing ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/82 p-4 backdrop-blur-sm">
          <div className="mx-auto max-w-6xl pt-6">
            <NewMemberBriefPanel
              hiveID={String(hiveID)}
              hiveName={hiveTitle}
              currentUser={user}
              decisions={decisions}
              tasks={tasks}
              honeycombs={honeycombs}
              onOpenThread={openSourceThread}
              entryMode
              onEnterHive={enterHive}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
