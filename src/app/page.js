"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listenToAuthChanges, signInWithGoogle } from "@/lib/auth/firebaseAuth";

const landingStats = [
  { value: "Trusted", label: "Decision memory" },
  { value: "Scoped", label: "Role-aware AI" },
  { value: "Live", label: "Threads and handoff" },
];

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const unsubscribe = listenToAuthChanges((currentUser) => {
      setUser(currentUser || null);
      setAuthChecked(true);
    });

    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    setSigningIn(true);
    setAuthError("");

    try {
      await signInWithGoogle();
    } catch (error) {
      console.error("Sign in failed:", error);
      setAuthError("Google sign-in did not complete. Please try again.");
      setSigningIn(false);
    }
  };

  useEffect(() => {
    if (authChecked && user) {
      router.replace("/dashboard");
    }
  }, [authChecked, user, router]);

  if (!authChecked) {
    return (
      <div className="page-shell">
        <div className="page-frame">
          <section className="hero-panel">
            <p className="text-kicker">HiveMind</p>
            <h1 className="text-display">
              <span className="text-gradient">Syncing your swarm</span>
            </h1>
            <p className="panel-subtitle">
              Checking your session and preparing the workspace.
            </p>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-frame">
        <section className="hero-panel">
          <div className="eyebrow-grid">
            <span className="hero-chip">Collaborative AI command center</span>
            <div className="stack-grid items-start">
              <div className="space-y-6">
                <div>
                  <p className="text-kicker">Built for shared intelligence</p>
                  <h1 className="text-display">
                    <span className="text-gradient">A secure workspace where decisions do not get lost.</span>
                  </h1>
                </div>

                <p className="max-w-2xl text-lg leading-8 text-slate-200/85">
                  HiveMind turns team discussion into trusted decision memory with role-aware AI,
                  searchable context, and a faster way to onboard new members.
                </p>

                {!user ? (
                  <div className="action-row">
                    <button
                      onClick={handleSignIn}
                      className="button-primary"
                      disabled={signingIn}
                      type="button"
                    >
                      {signingIn ? "Opening Google..." : "Enter with Google"}
                    </button>
                    <span className="status-pill">Secure collaboration, memory, and AI</span>
                  </div>
                ) : (
                  <div className="action-row">
                    <span className="status-pill">Redirecting to dashboard</span>
                  </div>
                )}

                {authError ? (
                  <div className="hud-panel max-w-xl border border-rose-300/20 text-rose-100">
                    {authError}
                  </div>
                ) : null}
              </div>

              <div className="glass-panel">
                <p className="text-kicker">What the UI is built around</p>
                <div className="stats-grid mt-5">
                  {landingStats.map((stat) => (
                    <div key={stat.label} className="metric-card">
                      <div className="metric-value text-gradient">{stat.value}</div>
                      <div className="mt-2 text-sm uppercase tracking-[0.2em] text-slate-300/70">
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="divider-line my-5" />

                <div className="space-y-4">
                  <div className="surface-card">
                    <div className="surface-card-inner">
                      <p className="panel-title">Conversational by default</p>
                      <p className="panel-subtitle">
                        Ask AI inside the right team context instead of starting from scratch.
                      </p>
                    </div>
                  </div>

                  <div className="surface-card">
                    <div className="surface-card-inner">
                      <p className="panel-title">Structured when it matters</p>
                      <p className="panel-subtitle">
                        Promote discussion into threads, summaries, and decision memory without leaving the flow.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
