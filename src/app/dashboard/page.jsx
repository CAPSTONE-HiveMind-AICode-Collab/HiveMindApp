"use client";
import { setUserRoleForHive, HIVE_ROLES } from "@/lib/data/roleRepository";
import { useEffect, useState } from "react";
import { db } from "@/lib/firebase/config";
import { collection, query, where, getDocs, doc, setDoc, getDoc, deleteDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { signOutUser, listenToAuthChanges } from "@/lib/auth/firebaseAuth";

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [hives, setHives] = useState([]);
  const [newHiveName, setNewHiveName] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleteModal, setDeleteModal] = useState({ show: false, hive: null });
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // Listen to auth changes
  useEffect(() => {
    const unsubscribe = listenToAuthChanges((currentUser) => {
      setUser(currentUser);
      setLoading(false);
      if (!currentUser) {
        router.replace("/"); // redirect to login page if signed out
      }
    });

    return () => unsubscribe();
  }, [router]);

  // Fetch Hives after user is loaded
  useEffect(() => {
    if (!user) return;

    async function fetchHives() {
      const hivesRef = collection(db, "Hive");
      const q = query(hivesRef, where("members", "array-contains", user.uid));
      const snapshot = await getDocs(q);
      const hiveList = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setHives(hiveList);
    }
    fetchHives();
  }, [user]);

  const createHive = async () => {
    if (!newHiveName || !user) return;
    
    // Generate unique ID: timestamp + random string
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const hiveID = `${timestamp}_${randomStr}`;
    
    await setDoc(doc(db, "Hive", hiveID), {
      name: newHiveName,
      ownerId: user.uid,
      members: [user.uid],
      createdAt: new Date(),
    });

    
    // NEW: add owner to members subcollection with OWNER role
    await setUserRoleForHive(hiveID, user.uid, HIVE_ROLES.OWNER, {
      displayName: user.displayName,
      email: user.email,
    });

    setNewHiveName("");
    router.push(`/hive/${hiveID}`);
  };

  const deleteHive = async () => {
    if (deleteConfirmText !== "DELETE") {
      alert("Please type DELETE to confirm");
      return;
    }

    try {
      const hiveId = deleteModal.hive.id;
      
      // Delete all honeycombs and their messages
      const honeycombsRef = collection(db, "Hive", hiveId, "Honeycomb");
      const honeycombsSnap = await getDocs(honeycombsRef);
      
      for (const honeycombDoc of honeycombsSnap.docs) {
        const messagesRef = collection(db, "Hive", hiveId, "Honeycomb", honeycombDoc.id, "messages");
        const messagesSnap = await getDocs(messagesRef);
        
        // Delete all messages and their threads
        for (const msgDoc of messagesSnap.docs) {
          const threadsRef = collection(db, "Hive", hiveId, "Honeycomb", honeycombDoc.id, "messages", msgDoc.id, "Threads");
          const threadsSnap = await getDocs(threadsRef);
          for (const threadDoc of threadsSnap.docs) {
            await deleteDoc(doc(db, "Hive", hiveId, "Honeycomb", honeycombDoc.id, "messages", msgDoc.id, "Threads", threadDoc.id));
          }
          await deleteDoc(doc(db, "Hive", hiveId, "Honeycomb", honeycombDoc.id, "messages", msgDoc.id));
        }
        
        await deleteDoc(doc(db, "Hive", hiveId, "Honeycomb", honeycombDoc.id));
      }
      
      // Delete the hive document
      await deleteDoc(doc(db, "Hive", hiveId));
      
      // Update local state
      setHives(hives.filter(h => h.id !== hiveId));
      setDeleteModal({ show: false, hive: null });
      setDeleteConfirmText("");
      
      alert("Hive deleted successfully!");
    } catch (error) {
      console.error("Failed to delete hive:", error);
      alert("Error deleting hive. Please try again.");
    }
  };

  const openDeleteModal = (hive, e) => {
    e.stopPropagation();
    setDeleteModal({ show: true, hive });
    setDeleteConfirmText("");
  };

  const closeDeleteModal = () => {
    setDeleteModal({ show: false, hive: null });
    setDeleteConfirmText("");
  };

  const handleLogout = async () => {
    try {
      await signOutUser();
      setUser(null);
      router.replace("/");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  if (loading) return <p style={{ textAlign: "center" }}>Loading...</p>;

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
      {user && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ color: "#d4af37" }}>🐝 Welcome, {user.displayName}</h1>
          <button
            onClick={handleLogout}
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
            Logout
          </button>
        </div>
      )}

      {/* Create Hive */}
      <div style={{ marginTop: "30px" }}>
        <input
          type="text"
          value={newHiveName}
          onChange={(e) => setNewHiveName(e.target.value)}
          placeholder="New Hive Name"
          style={{
            padding: "8px",
            borderRadius: "5px",
            border: "1px solid #d4af37",
            width: "250px",
            marginRight: "10px",
          }}
        />
        <button
          onClick={createHive}
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
          Create Hive
        </button>
      </div>

      {/* Join Honeycomb Section */}
      <div style={{ marginTop: "30px" }}>
        <button
          onClick={() => router.push('/join')}
          style={{
            backgroundColor: "#4CAF50",
            border: "none",
            padding: "10px 20px",
            borderRadius: "5px",
            cursor: "pointer",
            color: "#fff",
            fontWeight: "bold",
            fontSize: "16px",
          }}
        >
          🔗 Join a Honeycomb
        </button>
        <p style={{ fontSize: "12px", color: "#666", marginTop: "8px" }}>
          Request access to a honeycomb using its ID
        </p>
      </div>

      {/* Hives List */}
      <h2 style={{ marginTop: "40px", color: "#b8860b" }}>Your Hives</h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {hives.map((hive) => (
          <li
            key={hive.id}
            style={{
              backgroundColor: "#fff8dc",
              marginBottom: "10px",
              padding: "12px 20px",
              borderRadius: "8px",
              boxShadow: "0 2px 5px rgba(0,0,0,0.1)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              transition: "transform 0.1s",
            }}
          >
            <div
              onClick={() => router.push(`/hive/${hive.id}`)}
              style={{ cursor: "pointer", flex: 1 }}
              onMouseEnter={(e) => (e.currentTarget.parentElement.style.transform = "scale(1.02)")}
              onMouseLeave={(e) => (e.currentTarget.parentElement.style.transform = "scale(1)")}
            >
              <div style={{ fontWeight: "bold", marginBottom: "4px" }}>{hive.name}</div>
              <div style={{ fontSize: "11px", color: "#666", fontFamily: "monospace" }}>
                ID: {hive.id}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(hive.id);
                alert("Hive ID copied to clipboard!");
              }}
              style={{
                backgroundColor: "#4CAF50",
                border: "none",
                padding: "6px 12px",
                borderRadius: "5px",
                cursor: "pointer",
                color: "#fff",
                fontSize: "12px",
                fontWeight: "bold",
                marginLeft: "10px",
              }}
            >
              📋 Copy ID
            </button>
            <button
              onClick={(e) => openDeleteModal(hive, e)}
              style={{
                backgroundColor: "#f44336",
                border: "none",
                padding: "6px 12px",
                borderRadius: "5px",
                cursor: "pointer",
                color: "#fff",
                fontSize: "12px",
                fontWeight: "bold",
                marginLeft: "8px",
              }}
            >
              🗑️ Delete
            </button>
          </li>
        ))}
      </ul>

      {/* Delete Confirmation Modal */}
      {deleteModal.show && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000,
          }}
          onClick={closeDeleteModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: "#fff",
              borderRadius: "12px",
              padding: "30px",
              maxWidth: "500px",
              width: "90%",
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            }}
          >
            <div style={{ textAlign: "center", marginBottom: "20px" }}>
              <div style={{ fontSize: "48px", marginBottom: "10px" }}>⚠️</div>
              <h2 style={{ color: "#d32f2f", margin: "0 0 10px 0" }}>Delete Hive</h2>
              <p style={{ color: "#666", fontSize: "14px", margin: 0 }}>
                This action cannot be undone!
              </p>
            </div>

            <div
              style={{
                backgroundColor: "#fff3cd",
                border: "2px solid #ffc107",
                borderRadius: "8px",
                padding: "15px",
                marginBottom: "20px",
              }}
            >
              <p style={{ margin: "0 0 10px 0", fontWeight: "bold", color: "#856404" }}>
                You are about to permanently delete:
              </p>
              <p style={{ margin: "0 0 5px 0", fontSize: "16px", fontWeight: "bold" }}>
                📦 {deleteModal.hive?.name}
              </p>
              <p style={{ margin: "0", fontSize: "12px", color: "#856404", fontFamily: "monospace" }}>
                ID: {deleteModal.hive?.id}
              </p>
            </div>

            <div
              style={{
                backgroundColor: "#ffebee",
                border: "1px solid #ef5350",
                borderRadius: "8px",
                padding: "12px",
                marginBottom: "20px",
              }}
            >
              <p style={{ margin: "0 0 8px 0", fontWeight: "bold", color: "#c62828", fontSize: "14px" }}>
                ⚡ This will delete:
              </p>
              <ul style={{ margin: 0, paddingLeft: "20px", color: "#c62828", fontSize: "13px" }}>
                <li>All honeycombs in this hive</li>
                <li>All messages and conversations</li>
                <li>All threads and AI summaries</li>
                <li>All member access and permissions</li>
              </ul>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label
                style={{
                  display: "block",
                  marginBottom: "8px",
                  fontWeight: "bold",
                  color: "#333",
                  fontSize: "14px",
                }}
              >
                Type <span style={{ color: "#d32f2f", fontFamily: "monospace" }}>DELETE</span> to confirm:
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="Type DELETE here"
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: "6px",
                  border: "2px solid #ddd",
                  fontSize: "16px",
                  fontFamily: "monospace",
                  boxSizing: "border-box",
                }}
                autoFocus
              />
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={closeDeleteModal}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "6px",
                  border: "2px solid #ddd",
                  backgroundColor: "#fff",
                  cursor: "pointer",
                  fontWeight: "bold",
                  fontSize: "14px",
                }}
              >
                Cancel
              </button>
              <button
                onClick={deleteHive}
                disabled={deleteConfirmText !== "DELETE"}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "6px",
                  border: "none",
                  backgroundColor: deleteConfirmText === "DELETE" ? "#d32f2f" : "#ccc",
                  color: "#fff",
                  cursor: deleteConfirmText === "DELETE" ? "pointer" : "not-allowed",
                  fontWeight: "bold",
                  fontSize: "14px",
                }}
              >
                🗑️ Delete Forever
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
