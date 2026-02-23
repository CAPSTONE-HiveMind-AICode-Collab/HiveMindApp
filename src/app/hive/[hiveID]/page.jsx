"use client";
import { getUserRoleForHive, listHiveMembers } from "@/lib/data/roleRepository";
import { checkPermission } from "@/lib/business/permissionService";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, doc, setDoc, onSnapshot } from "firebase/firestore";
import { useUser } from "@/lib/auth/userContext";
import { getAllUnreadCounts, updateLastSeen } from "@/lib/business/chatService";
import MonitoringDashboard from "@/components/MonitoringDashboard";
import AuditLogViewer from "@/components/AuditLogViewer";
import IAMAdminPanel from "@/components/IAMAdminPanel";
import PermissionBadge from "@/components/PermissionBadge";
import HiveGuard from "@/components/HiveGuard";

export default function HivePage() {
  const { hiveID } = useParams();
  const router = useRouter();
  const { user, loading } = useUser();
  const [userRole, setUserRole] = useState(null);
  const [members, setMembers] = useState([]);
  const [honeycombs, setHoneycombs] = useState([]);
  const [newHoneycombName, setNewHoneycombName] = useState("");
  const [unreadCounts, setUnreadCounts] = useState({});
  const [activeTab, setActiveTab] = useState("honeycombs"); // honeycombs, monitoring, audit

  // Fetch honeycombs for this hive
  useEffect(() => {
    if (!user || !userRole) return;

    async function fetchHoneycombs() {
      try {
        const honeycombRef = collection(db, "Hive", hiveID, "Honeycomb");
        const snapshot = await getDocs(honeycombRef);
        const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setHoneycombs(list);
      } catch (err) {
        console.error("Error fetching honeycombs:", err);
      }
    }

    fetchHoneycombs();
  }, [user, hiveID, userRole]);

  // Fetch unread counts for each honeycomb
  useEffect(() => {
    if (!user || !hiveID) return;

    async function fetchUnread() {
      const counts = await getAllUnreadCounts(hiveID, user.uid);
      setUnreadCounts(counts);
    }

    fetchUnread();

    const interval = setInterval(fetchUnread, 10000);
    return () => clearInterval(interval);
  }, [user, hiveID]);

  // Load user role and hive members
  useEffect(() => {
    if (!user || !hiveID) return;

    async function loadRoleAndMembers() {
      try {
        const [role, memberList] = await Promise.all([
          getUserRoleForHive(hiveID, user.uid),
          listHiveMembers(hiveID),
        ]);
        
        // Check if user is a member of this hive
        const isMember = memberList.some(m => m.uid === user.uid);
        
        if (!isMember) {
          // User is not a member - show access denied
          alert("You don't have access to this hive. You need to request access via a honeycomb invitation.");
          router.push("/dashboard");
          return;
        }
        
        setUserRole(role);
        setMembers(memberList);
      } catch (err) {
        console.error("Failed to load role/members:", err);
        setUserRole("VIEWER"); // Default to viewer on error
      }
    }

    loadRoleAndMembers();
    
    // Set up real-time listener for members changes
    const membersRef = collection(db, "Hive", hiveID, "members");
    const unsubscribe = onSnapshot(membersRef, (snapshot) => {
      const memberList = snapshot.docs.map(doc => ({
        uid: doc.id,
        ...doc.data()
      }));
      setMembers(memberList);
    });

    return () => unsubscribe();
  }, [user, hiveID, router]);

  // Create new Honeycomb
  const createHoneycomb = async () => {
    if (!newHoneycombName || !user) return;

    const allowed = userRole ? checkPermission(userRole, "CREATE_HONEYCOMB") : true;
    if (!allowed) {
      alert("You don't have permission to create honeycombs in this hive.");
      return;
    }

    // Generate unique ID: timestamp + random string
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const honeycombID = `${timestamp}_${randomStr}`;
    
    await setDoc(doc(db, "Hive", hiveID, "Honeycomb", honeycombID), {
      name: newHoneycombName,
      createdAt: new Date(),
    });

    setNewHoneycombName("");
    setHoneycombs([...honeycombs, { id: honeycombID, name: newHoneycombName }]);
  };

  // Click handler: go to honeycomb and update lastSeen
  const openHoneycomb = async (honeycombID) => {
    if (user) {
      await updateLastSeen(hiveID, honeycombID, null, user.uid);
    }
    router.push(`/hive/${hiveID}/honeycomb/${honeycombID}`);
  };

  // Loading / Auth
  if (loading) return <p style={{ textAlign: "center" }}>Loading user info...</p>;
  if (!user) {
    router.replace("/");
    return null;
  }
  
  // Still loading role
  if (userRole === null) {
    return <p style={{ textAlign: "center" }}>Loading user info...</p>;
  }

  return (
    <div
      style={{
        backgroundColor: "#fffbee",
        minHeight: "100vh",
        padding: "40px",
        fontFamily: "'Segoe UI', sans-serif",
        color: "#333",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ color: "#d4af37" }}>🐝 Hive: {hiveID}</h1>
        <button
          onClick={() => router.push("/dashboard")}
          style={{
            backgroundColor: "#d4af37",
            border: "none",
            padding: "8px 16px",
            borderRadius: "5px",
            cursor: "pointer",
            color: "#fff",
            fontWeight: "bold",
          }}
        >
          Back to Dashboard
        </button>
      </div>

      <div style={{ marginTop: "8px", fontSize: "0.9rem", display: "flex", alignItems: "center", gap: "10px" }}>
        <span>Your role in this hive: <strong>{userRole || "loading..."}</strong></span>
        {user && <PermissionBadge hiveID={hiveID} userId={user.uid} />}
      </div>

      {/* Tabs for OWNER */}
      {userRole === "OWNER" && (
        <div style={{ marginTop: "20px", display: "flex", gap: "10px", borderBottom: "2px solid #d4af37" }}>
          <button
            onClick={() => setActiveTab("honeycombs")}
            style={{
              padding: "10px 20px",
              border: "none",
              backgroundColor: activeTab === "honeycombs" ? "#d4af37" : "transparent",
              color: activeTab === "honeycombs" ? "#fff" : "#d4af37",
              fontWeight: "bold",
              cursor: "pointer",
              borderRadius: "5px 5px 0 0",
            }}
          >
            🐝 Honeycombs
          </button>
          <button
            onClick={() => setActiveTab("monitoring")}
            style={{
              padding: "10px 20px",
              border: "none",
              backgroundColor: activeTab === "monitoring" ? "#d4af37" : "transparent",
              color: activeTab === "monitoring" ? "#fff" : "#d4af37",
              fontWeight: "bold",
              cursor: "pointer",
              borderRadius: "5px 5px 0 0",
            }}
          >
            📊 Monitoring
          </button>
          <button
            onClick={() => setActiveTab("audit")}
            style={{
              padding: "10px 20px",
              border: "none",
              backgroundColor: activeTab === "audit" ? "#d4af37" : "transparent",
              color: activeTab === "audit" ? "#fff" : "#d4af37",
              fontWeight: "bold",
              cursor: "pointer",
              borderRadius: "5px 5px 0 0",
            }}
          >
            🔍 Audit Logs
          </button>
          <button
            onClick={() => setActiveTab("iam")}
            style={{
              padding: "10px 20px",
              border: "none",
              backgroundColor: activeTab === "iam" ? "#d4af37" : "transparent",
              color: activeTab === "iam" ? "#fff" : "#d4af37",
              fontWeight: "bold",
              cursor: "pointer",
              borderRadius: "5px 5px 0 0",
            }}
          >
            🔐 IAM Admin
          </button>
          <button
            onClick={() => setActiveTab("HiveGuard")}
            style={{
              padding: "10px 20px",
              border: "none",
              backgroundColor: activeTab === "HiveGuard" ? "#d4af37" : "transparent",
              color: activeTab === "HiveGuard" ? "#fff" : "#d4af37",
              fontWeight: "bold",
              cursor: "pointer",
              borderRadius: "5px 5px 0 0",
            }}
          >
            🔐 HiveGuard
          </button>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === "honeycombs" && (
        <>
          {/* Create Honeycomb */}
          <div style={{ marginTop: "30px" }}>
            <input
              type="text"
              value={newHoneycombName}
              onChange={(e) => setNewHoneycombName(e.target.value)}
              placeholder="New Honeycomb Name"
              style={{
                padding: "8px",
                borderRadius: "5px",
                border: "1px solid #d4af37",
                width: "250px",
                marginRight: "10px",
              }}
            />
            <button
              onClick={createHoneycomb}
              style={{
                backgroundColor: "#d4af37",
                border: "none",
                padding: "8px 16px",
                borderRadius: "5px",
                cursor: "pointer",
                color: "#fff",
                fontWeight: "bold",
              }}
            >
              Create Honeycomb
            </button>
          </div>

          {/* Honeycomb List */}
          <h2 style={{ marginTop: "40px", color: "#b8860b" }}>Honeycombs</h2>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {honeycombs.map((honeycomb) => (
              <li
                key={honeycomb.id}
                style={{
                  backgroundColor: "#fff8dc",
                  marginBottom: "10px",
                  padding: "12px 20px",
                  borderRadius: "8px",
                  boxShadow: "0 2px 5px rgba(0,0,0,0.1)",
                  cursor: "pointer",
                  transition: "transform 0.1s",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.02)")}
                onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
              >
                <div onClick={() => openHoneycomb(honeycomb.id)} style={{ flex: 1 }}>
                  <div style={{ fontWeight: "bold" }}>{honeycomb.name}</div>
                  <div style={{ fontSize: "10px", color: "#888", fontFamily: "monospace", marginTop: "4px" }}>
                    ID: {honeycomb.id}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  {unreadCounts[honeycomb.id] > 0 && (
                    <span
                      style={{
                        backgroundColor: "#d9534f",
                        color: "#fff",
                        borderRadius: "12px",
                        padding: "4px 8px",
                        fontSize: "12px",
                        fontWeight: "bold",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                      }}
                    >
                      {unreadCounts[honeycomb.id]}
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(honeycomb.id);
                      alert("Honeycomb ID copied! Share this with others to let them request access.");
                    }}
                    style={{
                      backgroundColor: "#4CAF50",
                      border: "none",
                      padding: "6px 12px",
                      borderRadius: "5px",
                      cursor: "pointer",
                      color: "#fff",
                      fontSize: "11px",
                      fontWeight: "bold",
                    }}
                  >
                    📋 Copy ID
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {/* SetupInterface: Members & roles */}
          <div style={{ marginTop: "30px" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: "bold", marginBottom: "8px" }}>
              Members & roles
            </h2>
            {members.length === 0 ? (
              <p style={{ fontSize: "0.85rem" }}>No member records yet.</p>
            ) : (
              <div style={{ display: "grid", gap: "12px", marginTop: "12px" }}>
                {members.map((m) => (
                  <div
                    key={m.uid}
                    style={{
                      padding: "12px 16px",
                      background: "linear-gradient(135deg, #f5f7fa 0%, #e3eaf1 100%)",
                      borderRadius: "8px",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: "0.9rem",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div
                        style={{
                          width: "40px",
                          height: "40px",
                          borderRadius: "50%",
                          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "white",
                          fontWeight: "bold",
                          fontSize: "1.2rem",
                        }}
                      >
                        {(m.displayName || m.email || "?")[0].toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: "600", color: "#2d3748" }}>
                          {m.displayName || m.email || m.uid}
                        </div>
                        <div style={{ fontSize: "0.8rem", color: "#718096", marginTop: "2px" }}>
                          {m.email && m.displayName ? m.email : ""}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        padding: "6px 14px",
                        borderRadius: "20px",
                        fontWeight: "bold",
                        fontSize: "0.75rem",
                        background:
                          m.role === "OWNER"
                            ? "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)"
                            : m.role === "ADMIN"
                            ? "linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)"
                            : m.role === "MEMBER"
                            ? "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)"
                            : "linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)",
                        color: "white",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
                      }}
                    >
                      {m.role === "OWNER" ? "👑 " : m.role === "ADMIN" ? "⚡ " : m.role === "MEMBER" ? "👤 " : "👁️ "}
                      {m.role}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === "monitoring" && userRole === "OWNER" && (
        <div style={{ marginTop: "30px" }}>
          <MonitoringDashboard hiveID={hiveID} />
        </div>
      )}

      {activeTab === "audit" && userRole === "OWNER" && (
        <div style={{ marginTop: "30px" }}>
          <AuditLogViewer hiveID={hiveID} limit={100} />
        </div>
      )}

      {activeTab === "iam" && userRole === "OWNER" && (
        <div style={{ marginTop: "30px" }}>
          <IAMAdminPanel hiveID={hiveID} />
        </div>
      )}

      {activeTab === "HiveGuard" && userRole === "OWNER" && (
        <div style={{ marginTop: "30px" }}>
          <HiveGuard hiveID={hiveID} currentUserRole={userRole} />
        </div>
      )}
    </div>
  );
}