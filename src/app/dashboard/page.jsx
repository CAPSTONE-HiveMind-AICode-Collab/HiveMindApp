"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase/config";
import { collection, query, where, getDocs, doc, setDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { signOutUser, listenToAuthChanges } from "@/lib/auth/firebaseAuth";

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [hives, setHives] = useState([]);
  const [newHiveName, setNewHiveName] = useState("");
  const [loading, setLoading] = useState(true);

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
    const hiveID = newHiveName.toLowerCase().replace(/\s+/g, "-");
    await setDoc(doc(db, "Hive", hiveID), {
      name: newHiveName,
      ownerId: user.uid,
      members: [user.uid],
      createdAt: new Date(),
    });
    setNewHiveName("");
    router.push(`/hive/${hiveID}`);
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

      {/* Hives List */}
      <h2 style={{ marginTop: "40px", color: "#b8860b" }}>Your Hives</h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {hives.map((hive) => (
          <li
            key={hive.id}
            onClick={() => router.push(`/hive/${hive.id}`)}
            style={{
              backgroundColor: "#fff8dc",
              marginBottom: "10px",
              padding: "12px 20px",
              borderRadius: "8px",
              boxShadow: "0 2px 5px rgba(0,0,0,0.1)",
              cursor: "pointer",
              transition: "transform 0.1s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.02)")}
            onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
          >
            {hive.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
