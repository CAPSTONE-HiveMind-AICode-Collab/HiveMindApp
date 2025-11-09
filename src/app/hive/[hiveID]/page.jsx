"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, doc, setDoc } from "firebase/firestore";
import { listenToAuthChanges } from "@/lib/auth/firebaseAuth";

export default function HivePage() {
  const { hiveID } = useParams();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [honeycombs, setHoneycombs] = useState([]);
  const [newHoneycombName, setNewHoneycombName] = useState("");

  // Listen to auth changes
  useEffect(() => {
    const unsubscribe = listenToAuthChanges((currentUser) => {
      setUser(currentUser);
      setLoading(false);
      if (!currentUser) router.replace("/"); // redirect if not signed in
    });
    return () => unsubscribe();
  }, [router]);

  // Fetch honeycombs for this hive
  useEffect(() => {
    if (!user) return;

    async function fetchHoneycombs() {
      const honeycombRef = collection(db, "Hive", hiveID, "Honeycomb");
      const snapshot = await getDocs(honeycombRef);
      const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setHoneycombs(list);
    }

    fetchHoneycombs();
  }, [user, hiveID]);

  const createHoneycomb = async () => {
    if (!newHoneycombName || !user) return;
    const honeycombID = newHoneycombName.toLowerCase().replace(/\s+/g, "-");
    await setDoc(doc(db, "Hive", hiveID, "Honeycomb", honeycombID), {
      name: newHoneycombName,
      ownerId: user.uid,
      createdAt: new Date(),
    });
    setNewHoneycombName("");
    // Refresh honeycombs list
    setHoneycombs([...honeycombs, { id: honeycombID, name: newHoneycombName }]);
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

      {/* Honeycombs List */}
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
            }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.02)")}
            onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
            onClick={() => router.push(`/hive/${hiveID}/honeycomb/${honeycomb.id}`)} // placeholder for future chatroom
          >
            {honeycomb.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
