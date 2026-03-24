"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { listenToAuthChanges, signOutUser } from "@/lib/auth/firebaseAuth";
import {
  setUserRoleForHive,
  setUserOnboardingProfile,
  HIVE_ROLES,
} from "@/lib/data/roleRepository";
import {
  buildHiveDirectoryDefaults,
  ensureHiveDirectoryMetadata,
  getHiveMemberCount,
  listHiveMemberPreview,
} from "@/lib/data/hiveRepository";
import HiveOnboardingWizard from "@/components/HiveOnboardingWizard";
import UserAvatar from "@/components/UserAvatar";

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toMillis(value) {
  const date = toDate(value);
  return date ? date.getTime() : 0;
}

function formatRelativeTime(value) {
  const timestamp = toMillis(value);
  if (!timestamp) return "just now";

  const diff = timestamp - Date.now();
  const absolute = Math.abs(diff);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units = [
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60],
  ];

  for (const [unit, step] of units) {
    if (absolute >= step || unit === "minute") {
      return formatter.format(Math.round(diff / step), unit);
    }
  }

  return "just now";
}

function getActivityMeta(lastActive) {
  const age = Date.now() - toMillis(lastActive);

  if (!age || age <= 1000 * 60 * 60 * 6) {
    return { label: "Live", tone: "live" };
  }

  if (age <= 1000 * 60 * 60 * 24 * 2) {
    return { label: "Warm", tone: "warm" };
  }

  return { label: "Quiet", tone: "quiet" };
}

function hashSeed(value) {
  return Array.from(String(value || "HiveMind")).reduce((hash, character) => {
    return (hash * 31 + character.charCodeAt(0)) % 2147483647;
  }, 7);
}

function getIdentityTheme(seed) {
  const hash = hashSeed(seed);
  const hue = hash % 360;
  const secondaryHue = (hue + 48 + (hash % 36)) % 360;
  const glowHue = (hue + 96) % 360;
  const callsigns = ["VECTOR", "AURORA", "CIRCUIT", "EMBER", "NOVA", "ATLAS"];
  const callsign = callsigns[hash % callsigns.length];

  return {
    hue,
    secondaryHue,
    glowHue,
    callsign: `${callsign}-${String(hash % 97).padStart(2, "0")}`,
  };
}

function getIdentityStyle(theme) {
  return {
    "--mission-profile-start": `hsla(${theme.hue}, 82%, 62%, 0.96)`,
    "--mission-profile-end": `hsla(${theme.secondaryHue}, 76%, 28%, 0.96)`,
    "--mission-profile-glow": `hsla(${theme.glowHue}, 90%, 68%, 0.34)`,
    "--mission-profile-accent": `hsla(${theme.hue}, 92%, 70%, 1)`,
    "--mission-profile-outline": `hsla(${theme.secondaryHue}, 82%, 72%, 0.26)`,
  };
}

function getOperatorName(user) {
  return user?.displayName || user?.email?.split("@")[0] || "Operator";
}

function getOperatorHandle(user) {
  if (user?.email) {
    return `@${user.email.split("@")[0]}`;
  }

  return "@operator";
}

function formatCount(value, label) {
  const count = Number(value || 0);
  return `${count} ${count === 1 ? label : `${label}s`}`;
}

function getHiveDescription(hive) {
  const description = String(hive?.description || "").trim();
  if (description) return description;

  return "Shared AI context, decision memory, and traceable execution for this team space.";
}

function normalizeHiveRecord(hive, memberPreview) {
  return {
    ...hive,
    description: getHiveDescription(hive),
    decisionCount: Number(hive?.decisionCount || 0),
    openTasks: Number(hive?.openTasks || 0),
    members: Array.isArray(hive?.members) ? hive.members : [],
    memberPreview: Array.isArray(memberPreview) ? memberPreview : [],
  };
}

function buildHiveSearchText(hive) {
  const memberNames = (hive.memberPreview || [])
    .map((member) => member.displayName || member.email || member.uid)
    .filter(Boolean)
    .join(" ");

  return [
    hive.name,
    hive.id,
    hive.description,
    memberNames,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

async function deleteCollectionDocs(collectionRef) {
  const snapshot = await getDocs(collectionRef);

  for (const item of snapshot.docs) {
    await deleteDoc(item.ref);
  }
}

async function deleteHiveTree(hiveId) {
  const honeycombsRef = collection(db, "Hive", hiveId, "Honeycomb");
  const honeycombsSnap = await getDocs(honeycombsRef);

  for (const honeycombDoc of honeycombsSnap.docs) {
    const honeycombId = honeycombDoc.id;
    const messagesRef = collection(db, "Hive", hiveId, "Honeycomb", honeycombId, "messages");
    const messagesSnap = await getDocs(messagesRef);

    for (const messageDoc of messagesSnap.docs) {
      const messageId = messageDoc.id;
      const threadsRef = collection(
        db,
        "Hive",
        hiveId,
        "Honeycomb",
        honeycombId,
        "messages",
        messageId,
        "Threads"
      );
      const threadsSnap = await getDocs(threadsRef);

      for (const threadDoc of threadsSnap.docs) {
        await deleteCollectionDocs(
          collection(
            db,
            "Hive",
            hiveId,
            "Honeycomb",
            honeycombId,
            "messages",
            messageId,
            "Threads",
            threadDoc.id,
            "userStatus"
          )
        );
        await deleteDoc(threadDoc.ref);
      }

      await deleteCollectionDocs(
        collection(db, "Hive", hiveId, "Honeycomb", honeycombId, "messages", messageId, "userStatus")
      );
      await deleteDoc(messageDoc.ref);
    }

    await deleteCollectionDocs(
      collection(db, "Hive", hiveId, "Honeycomb", honeycombId, "threadSummaries")
    );
    await deleteCollectionDocs(
      collection(db, "Hive", hiveId, "Honeycomb", honeycombId, "userStatus")
    );
    await deleteDoc(honeycombDoc.ref);
  }

  await Promise.all([
    deleteCollectionDocs(collection(db, "Hive", hiveId, "members")),
    deleteCollectionDocs(collection(db, "Hive", hiveId, "tasks")),
    deleteCollectionDocs(collection(db, "Hive", hiveId, "decisionRecords")),
    deleteCollectionDocs(collection(db, "Hive", hiveId, "knowledgeNectar")),
    deleteCollectionDocs(collection(db, "Hive", hiveId, "secrets")),
    deleteCollectionDocs(collection(db, "Hive", hiveId, "userStatus")),
  ]);

  await deleteDoc(doc(db, "Hive", hiveId));
}

export default function Dashboard() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [hives, setHives] = useState([]);
  const [authLoading, setAuthLoading] = useState(true);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [ambientEnabled, setAmbientEnabled] = useState(true);
  const [creatingHive, setCreatingHive] = useState(false);
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [showCreateTile, setShowCreateTile] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [notice, setNotice] = useState(null);
  const [deleteModal, setDeleteModal] = useState({ show: false, hive: null });
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingHiveId, setDeletingHiveId] = useState("");

  const deferredSearch = useDeferredValue(searchQuery);

  useEffect(() => {
    const unsubscribe = listenToAuthChanges((currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);

      if (!currentUser) {
        router.replace("/");
      }
    });

    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (!notice) return undefined;

    const timer = window.setTimeout(() => {
      setNotice(null);
    }, 2800);

    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const storedPreference = window.localStorage.getItem("dashboard-ambient-enabled");
    if (storedPreference === "off") {
      setAmbientEnabled(false);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      "dashboard-ambient-enabled",
      ambientEnabled ? "on" : "off"
    );
  }, [ambientEnabled]);

  useEffect(() => {
    if (!user?.uid) return undefined;

    let cancelled = false;

    async function fetchHives() {
      setDirectoryLoading(true);

      try {
        const hivesRef = collection(db, "Hive");
        const hiveQuery = query(hivesRef, where("members", "array-contains", user.uid));
        const snapshot = await getDocs(hiveQuery);

        const hiveList = await Promise.all(
          snapshot.docs.map(async (item) => {
            const rawHive = item.data();
            const hydratedHive = await ensureHiveDirectoryMetadata(item.id, rawHive);
            const mergedHive = normalizeHiveRecord(
              { id: item.id, ...rawHive, ...(hydratedHive || {}) },
              await listHiveMemberPreview(item.id, hydratedHive?.members || rawHive.members)
            );

            return mergedHive;
          })
        );

        if (cancelled) return;

        setHives(
          hiveList.sort((left, right) => {
            const timeDelta = toMillis(right.lastActive) - toMillis(left.lastActive);
            if (timeDelta !== 0) return timeDelta;
            return String(left.name || "").localeCompare(String(right.name || ""));
          })
        );
      } catch (error) {
        console.error("Failed to load hives:", error);
        if (!cancelled) {
          setNotice({
            tone: "error",
            text: "Could not load your hive directory right now.",
          });
        }
      } finally {
        if (!cancelled) {
          setDirectoryLoading(false);
        }
      }
    }

    fetchHives();

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  const filteredHives = useMemo(() => {
    const needle = deferredSearch.trim().toLowerCase();
    if (!needle) return hives;

    return hives.filter((hive) => buildHiveSearchText(hive).includes(needle));
  }, [deferredSearch, hives]);

  const snapshotMetrics = useMemo(() => {
    const totals = hives.reduce(
      (accumulator, hive) => {
        accumulator.decisions += Number(hive.decisionCount || 0);
        accumulator.openTasks += Number(hive.openTasks || 0);

        if (getActivityMeta(hive.lastActive).tone === "live") {
          accumulator.liveHives += 1;
        }

        return accumulator;
      },
      { decisions: 0, openTasks: 0, liveHives: 0 }
    );

    return {
      hives: hives.length,
      decisions: totals.decisions,
      openTasks: totals.openTasks,
      liveHives: totals.liveHives,
    };
  }, [hives]);

  const directorySummary = deferredSearch.trim()
    ? `${filteredHives.length} of ${hives.length} hives`
    : hives.length === 1
      ? "1 hive"
      : `${hives.length} hives`;

  const operatorName = getOperatorName(user);
  const operatorHandle = getOperatorHandle(user);
  const profileTheme = useMemo(
    () => getIdentityTheme(user?.uid || user?.email || operatorName),
    [operatorName, user?.email, user?.uid]
  );
  const profileStyle = useMemo(() => getIdentityStyle(profileTheme), [profileTheme]);
  const dashboardSignalTone =
    snapshotMetrics.liveHives > 0 ? "live" : snapshotMetrics.hives > 0 ? "warm" : "quiet";
  const ambientLabel = ambientEnabled ? "LEDs on" : "LEDs off";
  const seedEnabled = process.env.NEXT_PUBLIC_DEV_SEED === "1";

  const openCreateComposer = () => {
    setShowCreateTile(true);
  };

  const closeCreateComposer = () => {
    setShowCreateTile(false);
  };

  const createHive = async ({ hiveName, teamRole, invites = [], greeting = "" } = {}) => {
    const trimmedName = String(hiveName || "").trim();
    if (!trimmedName || !user) {
      setNotice({
        tone: "error",
        text: "Give the hive a name before creating it.",
      });
      return;
    }

    try {
      setCreatingHive(true);

      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).slice(2, 8);
      const hiveID = `${timestamp}_${randomStr}`;

      await setDoc(doc(db, "Hive", hiveID), {
        name: trimmedName,
        ownerId: user.uid,
        onboardingRole: teamRole?.label || "",
        pendingInvites: Array.isArray(invites) ? invites : [],
        aiGreeting: String(greeting || "").trim(),
        createdAt: serverTimestamp(),
        ...buildHiveDirectoryDefaults({
          ownerId: user.uid,
          members: [user.uid],
        }),
      });

      await setUserRoleForHive(hiveID, user.uid, HIVE_ROLES.OWNER, {
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL,
      });

      await setDoc(
        doc(db, "Hive", hiveID, "members", user.uid),
        {
          joinedAt: serverTimestamp(),
          hasSeenBriefing: false,
          lastActive: serverTimestamp(),
        },
        { merge: true }
      );

      await setUserOnboardingProfile(user.uid, {
        teamRoleId: teamRole?.id || "",
        teamRoleLabel: teamRole?.label || "",
        hiveName: trimmedName,
        invitedEmails: invites,
      });

      closeCreateComposer();
      router.push(`/hive/${hiveID}`);
    } catch (error) {
      console.error("Failed to create hive:", error);
      setNotice({
        tone: "error",
        text: "Hive creation failed. Please try again.",
      });
    } finally {
      setCreatingHive(false);
    }
  };

  const closeDeleteModal = () => {
    setDeleteModal({ show: false, hive: null });
    setDeleteConfirmText("");
    setDeletingHiveId("");
  };

  const openDeleteModal = (hive, event) => {
    event.stopPropagation();
    setDeleteModal({ show: true, hive });
    setDeleteConfirmText("");
  };

  const deleteHive = async () => {
    if (deleteConfirmText !== "DELETE" || !deleteModal.hive?.id) {
      setNotice({
        tone: "error",
        text: 'Type "DELETE" to confirm the removal.',
      });
      return;
    }

    try {
      setDeletingHiveId(deleteModal.hive.id);
      await deleteHiveTree(deleteModal.hive.id);

      setHives((current) => current.filter((hive) => hive.id !== deleteModal.hive.id));
      closeDeleteModal();
      setNotice({
        tone: "success",
        text: "Hive deleted successfully.",
      });
    } catch (error) {
      console.error("Failed to delete hive:", error);
      setNotice({
        tone: "error",
        text: "Could not delete the hive right now.",
      });
    }
  };

  const handleLogout = async () => {
    try {
      await signOutUser();
      setUser(null);
      router.replace("/");
    } catch (error) {
      console.error("Logout failed:", error);
      setNotice({
        tone: "error",
        text: "Logout failed. Please try again.",
      });
    }
  };

  const runDemoSeed = async () => {
    if (!user?.uid) {
      setNotice({
        tone: "error",
        text: "Sign in before seeding the demo hive.",
      });
      return;
    }

    try {
      setSeedingDemo(true);

      const response = await fetch("/api/dev/seed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user: {
            uid: user.uid,
            displayName: user.displayName || "",
            email: user.email || "",
            photoURL: user.photoURL || "",
          },
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not seed the demo hive.");
      }

      setNotice({
        tone: "success",
        text: "Demo hive ready. Opening Backend Debug...",
      });

      router.push(
        `/hive/${payload.hiveID}/honeycomb/${payload.entryHoneycombID || "backend-debug"}`
      );
    } catch (error) {
      console.error("Failed to seed demo hive:", error);
      setNotice({
        tone: "error",
        text: error?.message || "Demo seed failed. Please try again.",
      });
    } finally {
      setSeedingDemo(false);
    }
  };

  const copyHiveId = async (hiveId, event) => {
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(hiveId);
      setNotice({
        tone: "success",
        text: "Hive ID copied to clipboard.",
      });
    } catch (error) {
      console.error("Failed to copy hive ID:", error);
      setNotice({
        tone: "error",
        text: "Clipboard copy failed on this device.",
      });
    }
  };

  const toggleAmbientMode = () => {
    setAmbientEnabled((current) => !current);
  };

  if (authLoading || (directoryLoading && !hives.length)) {
    return (
      <div className="page-shell">
        <div className="page-frame">
          <div className="mission-window">
            <div className="mission-window-bar">
              <div className="mission-window-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="mission-window-pill" />
              <div className="mission-window-chevron" aria-hidden="true" />
            </div>

            <div className="mission-window-body">
              <section className="hero-panel">
                <p className="text-kicker">Mission Control</p>
                <h1 className="text-display">
                  <span className="text-gradient">Loading your hive directory</span>
                </h1>
                <p className="panel-subtitle mt-4">
                  Pulling your workspaces, activity signals, and card metrics together.
                </p>
              </section>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-frame">
        <div className="mission-window">
          <div className="mission-window-bar">
            <div className="mission-window-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="mission-window-pill" />
            <div className="mission-window-chevron" aria-hidden="true" />
          </div>

          <div className={`mission-window-body ${ambientEnabled ? "mission-ambient-on" : "mission-ambient-off"}`}>
            <header className="mission-toolbar">
              <div className="mission-brand">
                <div className="mission-brand-mark">HM</div>
                <div>
                  <div className="mission-brand-title">Hivemind</div>
                  <div className="mission-brand-subtitle">Mission Control</div>
                </div>
              </div>

              <div className="mission-toolbar-actions">
                <label className="mission-search" htmlFor="dashboard-search">
                  <span aria-hidden="true">Ctrl+K</span>
                  <input
                    id="dashboard-search"
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search hives, IDs, or members"
                  />
                </label>

                <div className="mission-profile-cluster" style={profileStyle}>
                  <button
                    type="button"
                    className="mission-profile-card"
                    onClick={toggleAmbientMode}
                    aria-pressed={ambientEnabled}
                    aria-label={`Toggle ambient lighting. ${ambientLabel}.`}
                  >
                    <span className="mission-profile-avatar">
                      <UserAvatar
                        user={user}
                        size="fill"
                        className="mission-profile-avatar-media"
                        fallbackClassName="mission-profile-avatar-core"
                        imageClassName="mission-profile-avatar-image"
                      />
                      <span
                        className={`mission-profile-led is-${dashboardSignalTone} ${
                          ambientEnabled ? "is-on" : "is-off"
                        }`}
                        aria-hidden="true"
                      />
                    </span>
                    <span className="mission-profile-copy">
                      <strong>{operatorName}</strong>
                      <span>
                        {operatorHandle} | {profileTheme.callsign}
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    className={`mission-led-toggle ${ambientEnabled ? "is-on" : "is-off"}`}
                    onClick={toggleAmbientMode}
                    aria-pressed={ambientEnabled}
                  >
                    <span className="mission-led-toggle-track" aria-hidden="true">
                      <span className="mission-led-toggle-knob" />
                    </span>
                    <span>{ambientLabel}</span>
                  </button>
                </div>
              </div>
            </header>

            {notice ? (
              <div className={`mission-notice ${notice.tone === "error" ? "is-error" : "is-success"}`}>
                {notice.text}
              </div>
            ) : null}

            <section className="mission-hero-grid">
              <div className="mission-copy">
                <p className="text-kicker">Mission Control</p>
                <h1 className="mission-title">
                  Welcome back, {operatorName}
                </h1>
                <p className="mission-intro">
                  Where dev teams think, decide, and remember. Launch spaces, preserve decisions,
                  keep AI tied to your team&apos;s context, and stop losing key work in chat history.
                </p>
              </div>

              <aside className="mission-snapshot">
                <p className="mission-snapshot-label">Snapshot</p>
                <div className="mission-snapshot-grid">
                  <div className="mission-snapshot-card">
                    <strong>{snapshotMetrics.hives}</strong>
                    <span>Hives</span>
                  </div>
                  <div className="mission-snapshot-card">
                    <strong>{snapshotMetrics.decisions}</strong>
                    <span>Decisions</span>
                  </div>
                  <div className="mission-snapshot-card">
                    <strong>{snapshotMetrics.openTasks}</strong>
                    <span>Tasks</span>
                  </div>
                </div>
                <p className="mission-snapshot-status">
                  <span
                    className={`mission-status-dot is-${dashboardSignalTone} ${
                      ambientEnabled ? "is-pulsing" : ""
                    }`}
                    aria-hidden="true"
                  />
                  {snapshotMetrics.liveHives || 0} AI-ready spaces are active now
                </p>
                <div className="mission-led-strip" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <p className="mission-snapshot-note">
                  Ambient signal: {ambientEnabled ? "interactive guidance lights are active" : "screen is in calm mode"}
                </p>

                <div className="mission-snapshot-actions">
                  <button onClick={handleLogout} className="button-ghost" type="button">
                    Log out
                  </button>
                  {seedEnabled ? (
                    <button
                      onClick={runDemoSeed}
                      className="button-secondary"
                      type="button"
                      disabled={seedingDemo}
                    >
                      {seedingDemo ? "Seeding demo..." : "Seed demo"}
                    </button>
                  ) : null}
                  <button onClick={openCreateComposer} className="button-primary" type="button">
                    + New hive
                  </button>
                </div>
              </aside>
            </section>

            <section className="mission-directory">
              <div className="mission-directory-header">
                <div>
                  <h2 className="mission-section-title">Your hive directory</h2>
                  <p className="mission-section-copy">
                    Teams, project spaces, and memory-rich workstreams that belong to you.
                  </p>
                </div>
                <span className="status-pill">{directorySummary}</span>
              </div>

              {directoryLoading && hives.length ? (
                <div className="mission-loading-inline">Refreshing directory...</div>
              ) : null}

              <div className="mission-directory-grid">
                {filteredHives.map((hive, index) => {
                  const memberCount = getHiveMemberCount(hive);
                  const activity = getActivityMeta(hive.lastActive);
                  const extraMembers = Math.max(memberCount - hive.memberPreview.length, 0);

                  return (
                    <article
                      key={hive.id}
                      className={`mission-hive-card ${ambientEnabled ? "is-animated" : "is-static"}`}
                      style={{ "--mission-card-delay": `${index * 90}ms` }}
                      onClick={() => router.push(`/hive/${hive.id}`)}
                    >
                      <div className="mission-card-sheen" aria-hidden="true" />
                      <div className="mission-hive-header">
                        <div>
                          <h3 className="mission-hive-title">{hive.name}</h3>
                          <p className="mission-hive-description">{hive.description}</p>
                        </div>
                        <span className="mission-chip">Hive</span>
                      </div>

                      <div className="mission-hive-metrics">
                        <span className={`mission-activity-pill is-${activity.tone}`}>
                          <span
                            className={`mission-status-dot is-${activity.tone} ${
                              ambientEnabled ? "is-pulsing" : ""
                            }`}
                            aria-hidden="true"
                          />
                          {activity.label}
                        </span>
                        <span>{formatCount(memberCount, "member")}</span>
                        <span>{formatCount(hive.decisionCount, "decision")}</span>
                        <span>{formatCount(hive.openTasks, "open task")}</span>
                      </div>

                      <div className="mission-hive-footer">
                        <div className="mission-hive-footer-copy">
                          <span>Last active {formatRelativeTime(hive.lastActive)}</span>
                          <span className="mission-hive-id">AI-ready memory space</span>
                        </div>

                        <div className="mission-hive-footer-actions">
                          <div className="mission-member-stack" aria-label={`${memberCount} members`}>
                            {hive.memberPreview.map((member) => {
                              const label = member.displayName || member.email || member.uid;

                              return (
                                <UserAvatar
                                  key={member.uid}
                                  name={member.displayName}
                                  email={member.email}
                                  photoURL={member.photoURL}
                                  className="mission-member-avatar"
                                  size="fill"
                                  style={getIdentityStyle(
                                    getIdentityTheme(member.uid || member.email || label)
                                  )}
                                  title={label}
                                />
                              );
                            })}
                            {extraMembers > 0 ? (
                              <span className="mission-member-avatar is-overflow">+{extraMembers}</span>
                            ) : null}
                          </div>

                          <button
                            onClick={(event) => copyHiveId(hive.id, event)}
                            className="mission-inline-button"
                            type="button"
                          >
                            Copy ID
                          </button>
                          <button
                            onClick={(event) => openDeleteModal(hive, event)}
                            className="mission-inline-button is-danger"
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}

                <article
                  className={`mission-create-card ${showCreateTile ? "is-open" : ""}`}
                  onClick={!showCreateTile ? openCreateComposer : undefined}
                >
                  {showCreateTile ? (
                    <HiveOnboardingWizard
                      open={showCreateTile}
                      user={user}
                      creating={creatingHive}
                      onClose={closeCreateComposer}
                      onCreate={createHive}
                    />
                  ) : (
                    <>
                      <div className="mission-create-plus">+</div>
                      <h3 className="mission-hive-title">Create a new hive</h3>
                      <p className="mission-hive-description">
                        Fresh decision-memory workspace with structured history, decisions, and tasks.
                      </p>
                    </>
                  )}
                </article>
              </div>

              {filteredHives.length === 0 && !showCreateTile ? (
                <div className="mission-empty-state">
                  {hives.length === 0
                    ? "You do not have any hives yet. Create one to start your first memory-aware workspace."
                    : "No hives matched that search. Try another name, ID, or teammate."}
                </div>
              ) : null}

              <div className="mission-join-strip">
                <div className="mission-join-copy">
                  <div className="mission-join-icon" aria-hidden="true">
                    -&gt;
                  </div>
                  <div>
                    <h3>Join with an access code</h3>
                    <p>Use a honeycomb ID to request entry into an existing team space.</p>
                  </div>
                </div>

                <button
                  onClick={() => router.push("/join")}
                  className="button-ghost"
                  type="button"
                >
                  Open join flow
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>

      {deleteModal.show ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
          onClick={closeDeleteModal}
        >
          <div
            className="glass-panel w-full max-w-xl border border-rose-300/20"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-4">
              <span className="hero-chip">Permanent action</span>
              <div>
                <h2 className="panel-title text-2xl text-rose-100">Delete this hive?</h2>
                <p className="panel-subtitle">
                  This removes the hive, every honeycomb inside it, and the linked directory data.
                  This action cannot be undone.
                </p>
              </div>

              <div className="hud-panel border border-rose-300/15">
                <div className="text-xs uppercase tracking-[0.2em] text-rose-100/70">Target</div>
                <div className="mt-2 text-lg font-semibold text-white">{deleteModal.hive?.name}</div>
                <div className="mt-2 break-all font-mono text-sm text-slate-300">
                  {deleteModal.hive?.id}
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="delete-confirm" className="label-text">
                  Type DELETE to confirm
                </label>
                <input
                  id="delete-confirm"
                  type="text"
                  value={deleteConfirmText}
                  onChange={(event) => setDeleteConfirmText(event.target.value)}
                  placeholder="DELETE"
                  className="input-shell font-mono"
                  autoFocus
                />
              </div>

              <div className="action-row">
                <button onClick={closeDeleteModal} className="button-ghost" type="button">
                  Cancel
                </button>
                <button
                  onClick={deleteHive}
                  disabled={deleteConfirmText !== "DELETE" || deletingHiveId === deleteModal.hive?.id}
                  className="button-danger"
                  type="button"
                >
                  {deletingHiveId === deleteModal.hive?.id ? "Deleting..." : "Delete forever"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
