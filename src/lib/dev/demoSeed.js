import admin from "firebase-admin";
import {
  Timestamp,
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { adminDb, isFirebaseAdminConfigured } from "@/lib/firebase/firebaseAdmin";

const HIVE_ID = "demo-backend-api";

const ROOM_IDS = {
  backendDebug: "backend-debug",
  sprintPlanning: "sprint-12-planning",
  architecture: "architecture-decisions",
};

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function shiftDate(base, { days = 0, hours = 0, minutes = 0 } = {}) {
  return new Date(
    base.getTime() + ((((days * 24) + hours) * 60) + minutes) * 60 * 1000
  );
}

function normalizeUser(input) {
  if (!input || typeof input !== "object") return null;

  const uid = String(input.uid || "").trim();
  if (!uid) return null;

  return {
    uid,
    displayName: String(input.displayName || "").trim(),
    email: String(input.email || "").trim(),
    photoURL: String(input.photoURL || "").trim(),
  };
}

function buildTeam(currentUser, now) {
  const user = normalizeUser(currentUser);
  const founderName = user?.displayName || "Kamal Singh";
  const founderEmail = user?.email || "kamal@demo.hivemind.local";

  return [
    {
      key: "founder",
      uid: user?.uid || "demo-founder",
      displayName: founderName,
      email: founderEmail,
      photoURL: user?.photoURL || "",
      memberRole: "OWNER",
      appRole: "founder",
      teamRoleLabel: "Founder",
      joinedAt: shiftDate(now, { days: -28 }),
      lastActive: shiftDate(now, { hours: -1 }),
      hasSeenBriefing: false,
    },
    {
      key: "lead_dev",
      uid: "demo-lead-dev",
      displayName: "kamal2",
      email: "kamal2@demo.hivemind.local",
      photoURL: "",
      memberRole: "ADMIN",
      appRole: "lead_dev",
      teamRoleLabel: "Lead Dev",
      joinedAt: shiftDate(now, { days: -26 }),
      lastActive: shiftDate(now, { hours: -3 }),
      hasSeenBriefing: true,
    },
    {
      key: "team_member_1",
      uid: "demo-dev-3",
      displayName: "Dev 3",
      email: "dev3@demo.hivemind.local",
      photoURL: "",
      memberRole: "MEMBER",
      appRole: "team_member",
      teamRoleLabel: "Team Member",
      joinedAt: shiftDate(now, { days: -22 }),
      lastActive: shiftDate(now, { hours: -6 }),
      hasSeenBriefing: true,
    },
    {
      key: "team_member_2",
      uid: "demo-dev-4",
      displayName: "Dev 4",
      email: "dev4@demo.hivemind.local",
      photoURL: "",
      memberRole: "MEMBER",
      appRole: "team_member",
      teamRoleLabel: "Team Member",
      joinedAt: shiftDate(now, { days: -19 }),
      lastActive: shiftDate(now, { days: -4 }),
      hasSeenBriefing: true,
    },
  ];
}

function buildRooms(now, ownerId) {
  return [
    {
      id: ROOM_IDS.backendDebug,
      name: "Backend Debug",
      description: "Prod incidents, auth failures, and backend investigation threads.",
      createdAt: shiftDate(now, { days: -6 }),
      ownerId,
    },
    {
      id: ROOM_IDS.sprintPlanning,
      name: "Sprint 12 Planning",
      description: "Launch sequencing, resourcing, and delivery decisions.",
      createdAt: shiftDate(now, { days: -5 }),
      ownerId,
    },
    {
      id: ROOM_IDS.architecture,
      name: "Architecture Decisions",
      description: "Long-lived technical choices and operating principles.",
      createdAt: shiftDate(now, { days: -15 }),
      ownerId,
    },
  ];
}

function buildDecisions(team, now) {
  const byKey = Object.fromEntries(team.map((member) => [member.key, member]));

  return [
    {
      id: "decision-1",
      title: "Chose Supabase over MongoDB",
      summary:
        "The team selected Supabase for auth, realtime subscriptions, and row-level security so backend work could ship faster with fewer custom primitives.",
      rationale:
        "Supabase offers built-in auth, real-time subscriptions, and row-level security out of the box. MongoDB required more custom setup for our use case.",
      decision:
        "Use Supabase as the primary backend platform instead of MongoDB for the initial product launch.",
      category: "Architecture",
      tags: ["architecture", "database", "supabase"],
      honeycombID: ROOM_IDS.architecture,
      parentMessageID: "arch-msg-01",
      authorKey: "founder",
      createdAt: shiftDate(now, { days: -5 }),
      linkedTaskIds: ["task-5"],
      author: byKey.founder,
    },
    {
      id: "decision-2",
      title: "Increase Redis maxPoolSize to 50",
      summary:
        "A prior auth-service incident was traced to Redis connection pool exhaustion, and increasing the pool size to 50 resolved the 502s quickly.",
      rationale:
        "Connection pool exhaustion was causing 502s on the auth service. Increasing from default 10 to 50 resolved it in under 10 minutes.",
      decision:
        "Keep Redis maxPoolSize at 50 for auth-service traffic until a broader load test suggests otherwise.",
      category: "Infra",
      tags: ["infra", "redis", "incident", "502"],
      honeycombID: ROOM_IDS.backendDebug,
      parentMessageID: "redis-pool-fix",
      authorKey: "lead_dev",
      createdAt: shiftDate(now, { days: -3 }),
      linkedTaskIds: ["task-3"],
      author: byKey.lead_dev,
    },
    {
      id: "decision-3",
      title: "Use JWT over session tokens",
      summary:
        "Authentication will stay stateless so services can scale horizontally without session coordination between instances.",
      rationale:
        "JWTs are stateless and work better with our distributed architecture. Session tokens require shared state between instances which complicates scaling.",
      decision:
        "Use JWTs for API authentication instead of server-side session tokens.",
      category: "Auth",
      tags: ["auth", "jwt", "security"],
      honeycombID: ROOM_IDS.architecture,
      parentMessageID: "arch-msg-02",
      authorKey: "team_member_1",
      createdAt: shiftDate(now, { days: -7 }),
      linkedTaskIds: ["task-4"],
      author: byKey.team_member_1,
    },
    {
      id: "decision-4",
      title: "Defer mobile app to v2",
      summary:
        "Mobile was intentionally pushed out of the current launch window so the team can stabilize the web product first.",
      rationale:
        "Web product needs stability before mobile. Team bandwidth is insufficient to maintain two platforms simultaneously.",
      decision:
        "Do not scope mobile app work into the current release. Revisit after the web product is stable.",
      category: "Product",
      tags: ["product", "mobile", "scope"],
      honeycombID: ROOM_IDS.sprintPlanning,
      parentMessageID: "plan-msg-01",
      authorKey: "founder",
      createdAt: shiftDate(now, { days: -7, hours: -2 }),
      linkedTaskIds: [],
      author: byKey.founder,
    },
    {
      id: "decision-5",
      title: "Rate limiter stress test required before launch",
      summary:
        "After confirming Redis was not the current bottleneck, the team required a 10x rate-limiter stress test and monitoring before launch.",
      rationale:
        "Recent 502s exposed the rate limiter as a weak point. Must stress test to 10x expected load before going live.",
      decision:
        "Block launch until the auth-service rate limiter has been stress tested to 10x expected load in staging.",
      category: "Backend",
      tags: ["backend", "rate-limiter", "launch", "incident"],
      honeycombID: ROOM_IDS.backendDebug,
      parentMessageID: "msg-17",
      authorKey: "lead_dev",
      createdAt: shiftDate(now, { days: -2 }),
      linkedTaskIds: ["task-1", "task-3"],
      author: byKey.lead_dev,
    },
    {
      id: "decision-6",
      title: "Use React Query for data fetching",
      summary:
        "Frontend data access will use React Query to centralize caching, background refreshes, and loading-state handling.",
      rationale:
        "React Query handles caching, background refetching, and loading states better than raw useEffect patterns.",
      decision:
        "Use React Query as the default client-side data fetching layer.",
      category: "Frontend",
      tags: ["frontend", "react-query", "web"],
      honeycombID: ROOM_IDS.architecture,
      parentMessageID: "arch-msg-03",
      authorKey: "team_member_1",
      createdAt: shiftDate(now, { days: -14 }),
      linkedTaskIds: [],
      author: byKey.team_member_1,
    },
    {
      id: "decision-7",
      title: "All API endpoints require authentication",
      summary:
        "The backend will not expose public API routes without an explicit exception approved by the team.",
      rationale:
        "No public endpoints. Every route requires a valid JWT. Exceptions require explicit team approval.",
      decision: "Require authentication on every API endpoint by default.",
      category: "Auth",
      tags: ["auth", "security", "api"],
      honeycombID: ROOM_IDS.architecture,
      parentMessageID: "arch-msg-04",
      authorKey: "founder",
      createdAt: shiftDate(now, { days: -14, hours: -4 }),
      linkedTaskIds: ["task-2"],
      author: byKey.founder,
    },
    {
      id: "decision-8",
      title: "Error budgets: max 0.1% downtime per month",
      summary:
        "The team formalized an uptime target and agreed that incidents breaching it trigger a post-mortem.",
      rationale:
        "Sets the reliability target for the team. Incidents exceeding this trigger a mandatory post-mortem.",
      decision:
        "Maintain a monthly downtime budget of 0.1% and require a post-mortem if the budget is exceeded.",
      category: "Infra",
      tags: ["infra", "reliability", "slo"],
      honeycombID: ROOM_IDS.architecture,
      parentMessageID: "arch-msg-05",
      authorKey: "lead_dev",
      createdAt: shiftDate(now, { days: -21 }),
      linkedTaskIds: [],
      author: byKey.lead_dev,
    },
  ];
}

function buildMessages(team, decisions, now) {
  const byKey = Object.fromEntries(team.map((member) => [member.key, member]));
  const decisionTwo = decisions.find((entry) => entry.id === "decision-2");
  const conversationStart = shiftDate(now, { days: -2, hours: -5 });

  const backend = [
    ["msg-01", "founder", "Seeing fresh 502 spikes on the auth service after the latest burst test. Can someone jump into this now?", 0],
    ["msg-02", "lead_dev", "On it. Grafana shows latency climbing right before the gateway flips to 502 responses.", 5],
    ["msg-03", "team_member_1", "Redis client count spiked earlier, but the pool cap already looks higher than last week.", 10],
    ["msg-04", "team_member_2", "I am seeing queue time blow up right after the rate limiter starts sampling burst traffic.", 15],
    ["msg-05", "founder", "Can we confirm whether anything in auth changed besides docs and the CORS cleanup?", 21],
    ["msg-06", "lead_dev", "Latest deploy only touched docs and the auth endpoint headers. No Redis config drift from what I can see.", 27],
    ["msg-07", "team_member_1", "Reproducing locally with the same burst profile now. I will paste the trace in a second.", 34],
  ].map(([id, authorKey, text, minutes]) => ({
    id,
    senderId: byKey[authorKey].uid,
    sender: byKey[authorKey].displayName,
    text,
    timestamp: shiftDate(conversationStart, { minutes }),
  }));

  backend.push({
    id: "msg-08",
    senderId: byKey.lead_dev.uid,
    sender: byKey.lead_dev.displayName,
    text:
      "Here is the stack trace from the failing worker:\n```bash\nError: connect ETIMEDOUT 10.0.5.24:6379\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1637:16)\n    at RedisPool.acquire (/srv/auth/cache/pool.js:71:13)\n    at async AuthRateLimiter.consume (/srv/auth/rateLimiter.js:118:21)\n    at async POST (/srv/auth/routes/login.js:44:7)\n```",
    timestamp: shiftDate(conversationStart, { minutes: 39 }),
  });

  [
    ["msg-09", "founder", "This smells close to the incident from earlier this week. Did we already decide a pool-size baseline for Redis?", 46],
    ["msg-10", "team_member_1", "Burst traffic is saturating the rate-limiter bucket before cache warmup finishes. Redis is slow, but not clearly the main bottleneck.", 52],
    ["msg-11", "lead_dev", "Confirmed from config: maxPoolSize is already 50 in staging and prod, so the old fix is still in place.", 58],
    ["msg-12", "founder", "Okay, so the past Redis change helped once but it is not the current lever. We need the actual launch blocker called out clearly.", 64],
    ["msg-13", "team_member_1", "Can Hive AI compare this against the earlier 502 incident and point us at the most likely difference?", 70],
  ].forEach(([id, authorKey, text, minutes]) => {
    backend.push({
      id,
      senderId: byKey[authorKey].uid,
      sender: byKey[authorKey].displayName,
      text,
      timestamp: shiftDate(conversationStart, { minutes }),
    });
  });

  backend.push({
    id: "msg-14",
    senderId: "AI",
    sender: "Hive AI",
    text:
      `Your team hit a similar auth-service 502 before. The past fix was raising Redis maxPoolSize to 50, but your current config already matches that decision, so the stronger signal here is rate-limiter saturation during burst traffic.\n\nCitation: [${decisionTwo?.title || "Increase Redis maxPoolSize to 50"} | ${ROOM_IDS.backendDebug} | ${decisionTwo?.parentMessageID || "redis-pool-fix"}]`,
    timestamp: shiftDate(conversationStart, { minutes: 76 }),
  });

  [
    ["msg-15", "lead_dev", "I dropped the limiter threshold temporarily in staging and can reproduce the same 502 pattern almost immediately.", 83],
    ["msg-16", "founder", "That confirms it. Redis is not the real blocker now; the auth-service rate limiter is folding under burst traffic.", 90],
    ["msg-18", "team_member_1", "I will wire the staging dashboard and keep a note of the limiter thresholds we use during the test.", 103],
    ["msg-19", "team_member_2", "I can review JWT expiry while traffic is calm so auth changes stay consistent with the security decisions.", 108],
    ["msg-20", "founder", "Perfect. I am moving the follow-ups to Sprint 12 Planning and keeping this incident thread as the reference point.", 114],
  ].forEach(([id, authorKey, text, minutes]) => {
    backend.push({
      id,
      senderId: byKey[authorKey].uid,
      sender: byKey[authorKey].displayName,
      text,
      timestamp: shiftDate(conversationStart, { minutes }),
    });
  });

  backend.splice(16, 0, {
    id: "msg-17",
    senderId: byKey.lead_dev.uid,
    sender: byKey.lead_dev.displayName,
    text: "Decision: we do not launch until the auth-service rate limiter survives a 10x load test, and we add Redis monitoring in staging so any 502 regression is visible immediately.",
    timestamp: shiftDate(conversationStart, { minutes: 97 }),
    linkedTaskIds: ["task-1", "task-3"],
  });

  const sources = [
    ["architecture", "arch-msg-01", "founder", "Decision: choose Supabase over MongoDB so auth, realtime subscriptions, and row-level security come bundled for launch.", { days: -5, hours: -2 }],
    ["architecture", "arch-msg-02", "team_member_1", "Decision: JWT beats session tokens for this distributed setup because we do not want shared session state between instances.", { days: -7, hours: -1 }],
    ["architecture", "arch-msg-03", "team_member_1", "Decision: use React Query as the default data-fetching layer so caching and refetching are centralized.", { days: -14, hours: -2 }],
    ["architecture", "arch-msg-04", "founder", "Decision: every API endpoint requires authentication unless the team approves an explicit exception.", { days: -14, hours: -5 }],
    ["architecture", "arch-msg-05", "lead_dev", "Decision: our error budget is max 0.1% downtime per month, and any breach triggers a post-mortem.", { days: -21, hours: -3 }],
    ["sprintPlanning", "plan-msg-01", "founder", "Decision: defer the mobile app to v2 so the team can stabilize the web experience before splitting focus.", { days: -7, hours: -4 }],
  ].map(([roomKey, id, authorKey, text, offset]) => ({
    roomId: ROOM_IDS[roomKey],
    id,
    senderId: byKey[authorKey].uid,
    sender: byKey[authorKey].displayName,
    text,
    timestamp: shiftDate(now, offset),
  }));

  return { backend, sources };
}

function buildTasks(team, now) {
  const byKey = Object.fromEntries(team.map((member) => [member.key, member]));

  return [
    {
      id: "task-1",
      title: "Stress test rate limiter to 10x load",
      description:
        "Run burst-traffic scenarios in staging and capture p95 latency, limiter rejection rates, and auth-service recovery behavior.",
      status: "doing",
      priority: "high",
      dueAt: shiftDate(now, { days: 1 }),
      assignees: [byKey.lead_dev.uid],
      linkedDecisionId: "decision-5",
      linkedDecisionTitle: "Rate limiter stress test required before launch",
      createdBy: byKey.lead_dev.uid,
      createdAt: shiftDate(now, { days: -2 }),
      source: {
        hiveID: HIVE_ID,
        honeycombID: ROOM_IDS.backendDebug,
        messageID: "msg-17",
        threadID: "",
        decisionID: "decision-5",
      },
      sourcePreview: {
        parentMessageText:
          "Decision: we do not launch until the auth-service rate limiter survives a 10x load test...",
        decisionTitle: "Rate limiter stress test required before launch",
        decisionSummary:
          "Block launch until the auth-service rate limiter has been stress tested to 10x expected load in staging.",
      },
    },
    {
      id: "task-2",
      title: "Write API documentation",
      description:
        "Document auth flows, protected routes, request limits, and onboarding notes for internal consumers before beta access expands.",
      status: "todo",
      priority: "medium",
      dueAt: shiftDate(now, { days: -2 }),
      assignees: [byKey.lead_dev.uid],
      linkedDecisionId: "decision-7",
      linkedDecisionTitle: "All API endpoints require authentication",
      createdBy: byKey.founder.uid,
      createdAt: shiftDate(now, { days: -4 }),
      aiBlocked: true,
      source: {
        hiveID: HIVE_ID,
        honeycombID: ROOM_IDS.architecture,
        messageID: "arch-msg-04",
        threadID: "",
        decisionID: "decision-7",
      },
      sourcePreview: {
        parentMessageText:
          "Decision: every API endpoint requires authentication unless the team approves an explicit exception.",
        decisionTitle: "All API endpoints require authentication",
        decisionSummary: "Require authentication on every API endpoint by default.",
      },
    },
    {
      id: "task-3",
      title: "Set up Redis monitoring dashboard",
      description:
        "Track Redis pool usage, auth-service latency, error counts, and limiter saturation in one staging dashboard.",
      status: "doing",
      priority: "high",
      dueAt: shiftDate(now, { days: 3 }),
      assignees: [byKey.team_member_1.uid],
      linkedDecisionId: "decision-2",
      linkedDecisionTitle: "Increase Redis maxPoolSize to 50",
      createdBy: byKey.lead_dev.uid,
      createdAt: shiftDate(now, { days: -3 }),
      source: {
        hiveID: HIVE_ID,
        honeycombID: ROOM_IDS.backendDebug,
        messageID: "msg-17",
        threadID: "",
        decisionID: "decision-5",
      },
      sourcePreview: {
        parentMessageText:
          "Decision: we do not launch until the auth-service rate limiter survives a 10x load test...",
        decisionTitle: "Increase Redis maxPoolSize to 50",
        decisionSummary:
          "Keep Redis maxPoolSize at 50 for auth-service traffic until a broader load test suggests otherwise.",
      },
    },
    {
      id: "task-4",
      title: "Review JWT expiry policy",
      description:
        "Validate token lifetime, refresh behavior, and revocation expectations against the current auth-service rollout.",
      status: "todo",
      priority: "medium",
      dueAt: shiftDate(now, { days: 5 }),
      assignees: [byKey.team_member_2.uid],
      linkedDecisionId: "decision-3",
      linkedDecisionTitle: "Use JWT over session tokens",
      createdBy: byKey.team_member_1.uid,
      createdAt: shiftDate(now, { days: -5 }),
      source: {
        hiveID: HIVE_ID,
        honeycombID: ROOM_IDS.architecture,
        messageID: "arch-msg-02",
        threadID: "",
        decisionID: "decision-3",
      },
      sourcePreview: {
        parentMessageText:
          "Decision: JWT beats session tokens for this distributed setup because we do not want shared session state between instances.",
        decisionTitle: "Use JWT over session tokens",
        decisionSummary:
          "Use JWTs for API authentication instead of server-side session tokens.",
      },
    },
    {
      id: "task-5",
      title: "Deploy to staging",
      description:
        "Ship the latest auth-service and dashboard changes to staging for launch-readiness review.",
      status: "done",
      priority: "high",
      dueAt: shiftDate(now, { days: -1 }),
      assignees: [byKey.founder.uid],
      linkedDecisionId: "decision-1",
      linkedDecisionTitle: "Chose Supabase over MongoDB",
      createdBy: byKey.founder.uid,
      createdAt: shiftDate(now, { days: -6 }),
      source: {
        hiveID: HIVE_ID,
        honeycombID: ROOM_IDS.sprintPlanning,
        messageID: "plan-msg-01",
        threadID: "",
        decisionID: "decision-4",
      },
      sourcePreview: {
        parentMessageText:
          "Decision: defer the mobile app to v2 so the team can stabilize the web experience before splitting focus.",
        decisionTitle: "Chose Supabase over MongoDB",
        decisionSummary:
          "Use Supabase as the primary backend platform instead of MongoDB for the initial product launch.",
      },
    },
    {
      id: "task-6",
      title: "Fix CORS headers on auth endpoint",
      description:
        "Normalize the allow-origin header and verify preflight behavior across the login and token-refresh routes.",
      status: "done",
      priority: "medium",
      dueAt: shiftDate(now, { days: -2 }),
      assignees: [byKey.team_member_1.uid],
      linkedDecisionId: "",
      linkedDecisionTitle: "",
      createdBy: byKey.team_member_1.uid,
      createdAt: shiftDate(now, { days: -3 }),
      source: {
        hiveID: HIVE_ID,
        honeycombID: ROOM_IDS.backendDebug,
        messageID: "msg-06",
        threadID: "",
        decisionID: "",
      },
      sourcePreview: {
        parentMessageText:
          "Latest deploy only touched docs and the auth endpoint headers. No Redis config drift from what I can see.",
        decisionTitle: "",
        decisionSummary: "",
      },
    },
  ];
}

function buildThread(team, now) {
  const byKey = Object.fromEntries(team.map((member) => [member.key, member]));
  const start = shiftDate(now, { days: -2, hours: -4, minutes: -44 });

  return {
    parentMessageID: "msg-08",
    threadID: "thread-redis-investigation",
    messages: [
      {
        id: "thread-msg-01",
        text: "Compared the trace with the old incident. Pool size is already 50, so the limiter path is the better lead.",
        sender: byKey.team_member_1.displayName,
        senderId: byKey.team_member_1.uid,
        timestamp: shiftDate(start, { minutes: 2 }),
        status: "closed",
      },
      {
        id: "thread-msg-02",
        text: "Closing this subthread. We have enough evidence that Redis config is not the release blocker.",
        sender: byKey.lead_dev.displayName,
        senderId: byKey.lead_dev.uid,
        timestamp: shiftDate(start, { minutes: 9 }),
        status: "closed",
      },
    ],
    summary: {
      parentMessageID: "msg-08",
      threadID: "thread-redis-investigation",
      summaryText:
        "Title: Redis trace investigation\n\nSummary:\n- Compared the new stack trace against the earlier Redis incident\n- Confirmed maxPoolSize is already 50 in the current environment\n- Agreed the rate limiter is the stronger suspect for the latest 502s\n\nFollow-ups:\n- Focus launch readiness on rate-limiter stress testing\n- Add Redis visibility in staging",
      generatedAt: shiftDate(start, { minutes: 12 }),
      closedByUserId: byKey.lead_dev.uid,
      closedByUserName: byKey.lead_dev.displayName,
    },
  };
}

function createWriter(useAdmin) {
  const toTimestamp = (value) =>
    useAdmin
      ? admin.firestore.Timestamp.fromDate(value)
      : Timestamp.fromDate(value);

  const nowValue = () =>
    useAdmin
      ? admin.firestore.FieldValue.serverTimestamp()
      : serverTimestamp();

  const write = async (segments, payload, options = {}) => {
    if (useAdmin) {
      return adminDb.doc(segments.join("/")).set(payload, options);
    }

    return setDoc(doc(db, ...segments), payload, options);
  };

  return { toTimestamp, nowValue, write };
}

export async function seedDemoHive(currentUser) {
  const useAdmin = Boolean(isFirebaseAdminConfigured && adminDb);
  const writer = createWriter(useAdmin);
  const now = new Date();
  const team = buildTeam(currentUser, now);
  const rooms = buildRooms(now, team[0].uid);
  const decisions = buildDecisions(team, now);
  const tasks = buildTasks(team, now);
  const messages = buildMessages(team, decisions, now);
  const thread = buildThread(team, now);
  const memberIds = unique(team.map((member) => member.uid));
  const openTaskCount = tasks.filter((task) => task.status !== "done").length;

  await writer.write(
    ["Hive", HIVE_ID],
    {
      name: "Backend API",
      description:
        "Production API workspace for auth reliability, launch readiness, and architecture memory.",
      ownerId: team[0].uid,
      members: memberIds,
      decisionCount: decisions.length,
      openTasks: openTaskCount,
      onboardingRole: team[0].teamRoleLabel,
      aiGreeting:
        "Hive AI is tracking backend incidents, launch blockers, and architectural decisions for this team.",
      createdAt: writer.toTimestamp(shiftDate(now, { days: -30 })),
      lastActive: writer.toTimestamp(shiftDate(now, { hours: -2 })),
    },
    { merge: true }
  );

  await Promise.all(
    team.map((member) =>
      Promise.all([
        writer.write(
          ["Users", member.uid],
          {
            uid: member.uid,
            displayName: member.displayName,
            email: member.email,
            photoURL: member.photoURL,
            role: member.appRole,
            hives: [HIVE_ID],
            lastSeen: writer.toTimestamp(member.lastActive),
            onboarding: {
              teamRoleId: member.appRole,
              teamRoleLabel: member.teamRoleLabel,
              hiveName: "Backend API",
              invitedEmails: [],
              updatedAt: writer.nowValue(),
            },
            createdAt: writer.toTimestamp(member.joinedAt),
          },
          { merge: true }
        ),
        writer.write(
          ["Hive", HIVE_ID, "members", member.uid],
          {
            role: member.memberRole,
            displayName: member.displayName,
            email: member.email,
            photoURL: member.photoURL,
            joinedAt: writer.toTimestamp(member.joinedAt),
            hasSeenBriefing: member.hasSeenBriefing,
            lastActive: writer.toTimestamp(member.lastActive),
          },
          { merge: true }
        ),
      ])
    )
  );

  await Promise.all(
    rooms.map((room) =>
      writer.write(
        ["Hive", HIVE_ID, "Honeycomb", room.id],
        {
          name: room.name,
          displayName: room.name,
          description: room.description,
          createdAt: writer.toTimestamp(room.createdAt),
          ownerId: room.ownerId,
        },
        { merge: true }
      )
    )
  );

  await Promise.all(
    messages.backend.map((message) =>
      writer.write(
        ["Hive", HIVE_ID, "Honeycomb", ROOM_IDS.backendDebug, "messages", message.id],
        {
          type: "text",
          text: message.text,
          sender: message.sender,
          senderId: message.senderId,
          attachment: null,
          linkedTaskIds: message.linkedTaskIds || [],
          timestamp: writer.toTimestamp(message.timestamp),
        },
        { merge: true }
      )
    )
  );

  await Promise.all(
    messages.sources.map((message) =>
      writer.write(
        ["Hive", HIVE_ID, "Honeycomb", message.roomId, "messages", message.id],
        {
          type: "text",
          text: message.text,
          sender: message.sender,
          senderId: message.senderId,
          attachment: null,
          timestamp: writer.toTimestamp(message.timestamp),
        },
        { merge: true }
      )
    )
  );

  await Promise.all(
    thread.messages.map((threadMessage) =>
      writer.write(
        [
          "Hive",
          HIVE_ID,
          "Honeycomb",
          ROOM_IDS.backendDebug,
          "messages",
          thread.parentMessageID,
          "Threads",
          threadMessage.id,
        ],
        {
          text: threadMessage.text,
          sender: threadMessage.sender,
          senderId: threadMessage.senderId,
          timestamp: writer.toTimestamp(threadMessage.timestamp),
          status: threadMessage.status,
        },
        { merge: true }
      )
    )
  );

  await writer.write(
    [
      "Hive",
      HIVE_ID,
      "Honeycomb",
      ROOM_IDS.backendDebug,
      "threadSummaries",
      thread.threadID,
    ],
    {
      parentMessageID: thread.summary.parentMessageID,
      threadID: thread.summary.threadID,
      summaryText: thread.summary.summaryText,
      generatedAt: writer.toTimestamp(thread.summary.generatedAt),
      closedByUserId: thread.summary.closedByUserId,
      closedByUserName: thread.summary.closedByUserName,
    },
    { merge: true }
  );

  await Promise.all(
    decisions.map((decision) =>
      writer.write(
        ["Hive", HIVE_ID, "decisionRecords", decision.id],
        {
          title: decision.title,
          summary: decision.summary,
          rationale: decision.rationale,
          decision: decision.decision,
          category: decision.category,
          status: "active",
          tags: decision.tags,
          risks: [],
          linkedFiles: [],
          linkedTaskIds: decision.linkedTaskIds,
          actionItems: [],
          supersedesDecisionId: "",
          supersededByDecisionId: "",
          ownerUserId: decision.author.uid,
          ownerDisplayName: decision.author.displayName,
          createdByUserId: decision.author.uid,
          createdByDisplayName: decision.author.displayName,
          generatedBy: "seed",
          source: {
            hiveID: HIVE_ID,
            honeycombID: decision.honeycombID,
            parentMessageID: decision.parentMessageID,
            threadID: "",
          },
          rawSummaryText: "",
          closedAt: writer.toTimestamp(decision.createdAt),
          hiveID: HIVE_ID,
          honeycombID: decision.honeycombID,
          parentMessageID: decision.parentMessageID,
          threadID: "",
          createdAt: writer.toTimestamp(decision.createdAt),
          updatedAt: writer.toTimestamp(decision.createdAt),
        },
        { merge: true }
      )
    )
  );

  await Promise.all(
    tasks.map((task) =>
      writer.write(
        ["Hive", HIVE_ID, "tasks", task.id],
        {
          title: task.title,
          description: task.description,
          checklist: [],
          status: task.status,
          priority: task.priority,
          blockReason: task.blockReason || "",
          aiBlocked: Boolean(task.aiBlocked),
          assignees: task.assignees,
          dueAt: writer.toTimestamp(task.dueAt),
          createdBy: task.createdBy,
          createdAt: writer.toTimestamp(task.createdAt),
          updatedAt: writer.toTimestamp(task.createdAt),
          linkedDecisionId: task.linkedDecisionId,
          linkedDecisionTitle: task.linkedDecisionTitle,
          linkedFiles: [],
          sourcePreview: task.sourcePreview,
          source: task.source,
        },
        { merge: true }
      )
    )
  );

  return {
    success: true,
    message: "Demo hive seeded successfully.",
    hiveID: HIVE_ID,
    entryHoneycombID: ROOM_IDS.backendDebug,
    seeded: {
      members: team.length,
      rooms: rooms.length,
      decisions: decisions.length,
      tasks: tasks.length,
      backendMessages: messages.backend.length,
    },
    mode: useAdmin ? "firebase-admin" : "client-firestore-fallback",
  };
}
