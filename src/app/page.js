"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listenToAuthChanges, signInWithGoogle } from "@/lib/auth/firebaseAuth";

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const unsubscribe = listenToAuthChanges((currentUser) => {
      setUser(currentUser || null); // set user to null explicitly if not signed in
      setAuthChecked(true); // auth state has been determined
    });

    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
      // Auth listener will handle redirect
    } catch (error) {
      console.error("Sign in failed:", error);
    }
  };

  // Redirect only after auth has been checked and user exists
  useEffect(() => {
    if (authChecked && user) {
      router.replace("/dashboard");
    }
  }, [authChecked, user, router]);

  if (!authChecked) return <p>Loading...</p>;

  return (
    <div style={{ textAlign: "center", marginTop: "50px" }}>
      {!user ? (
        <>
          <h1>Welcome to HiveMind!</h1>
          <button onClick={handleSignIn} className="bg-yellow-400 px-6 py-3 rounded-xl font-semibold shadow-md hover:bg-yellow-500 border border-yellow-700"
          >Sign in with Google</button>
        </>
      ) : (
        <p>Redirecting to your dashboard...</p>
      )}
    </div>
  );
}
