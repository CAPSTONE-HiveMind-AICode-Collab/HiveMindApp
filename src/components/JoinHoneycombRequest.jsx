"use client";

import { useState, useEffect } from "react";
import { useUser } from "@/lib/auth/userContext";
import { sendJoinRequest } from "@/lib/business/notificationService";
import { useSearchParams } from "next/navigation";

export default function JoinHoneycombRequest() {
  const { user } = useUser();
  const searchParams = useSearchParams();
  const [honeycombID, setHoneycombID] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const idFromUrl = searchParams.get("honeycombID") || searchParams.get("id");
    if (idFromUrl) {
      setHoneycombID(idFromUrl);
    }
  }, [searchParams]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const userName = user.displayName || user.email || "Anonymous";
      const result = await sendJoinRequest(honeycombID.trim(), user.uid, userName);
      setMessage(result.message);
      setHoneycombID("");
    } catch (err) {
      setError(err.message || "Failed to send join request");
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="glass-panel mx-auto max-w-xl">
        <span className="hero-chip">Authentication required</span>
        <h2 className="panel-title mt-5 text-2xl">Sign in to request access</h2>
        <p className="panel-subtitle mt-3">
          The join flow needs your account so the hive owner knows who is requesting entry.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-panel mx-auto max-w-xl">
      <span className="hero-chip">Access request</span>
      <h2 className="panel-title mt-5 text-2xl">Join a honeycomb</h2>
      <p className="panel-subtitle mt-3">
        Enter a honeycomb ID to request access. The owner will be notified and can approve
        your request.
      </p>

      <div className="hud-panel mt-5 border border-cyan-200/15">
        <p className="text-sm text-slate-100">
          Ask the honeycomb owner to copy and share the honeycomb ID with you.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <div>
          <label htmlFor="honeycombID" className="label-text">
            Honeycomb ID
          </label>
          <input
            id="honeycombID"
            type="text"
            value={honeycombID}
            onChange={(event) => setHoneycombID(event.target.value)}
            placeholder="Enter honeycomb ID..."
            className="input-shell font-mono"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading || !honeycombID.trim()}
          className="button-primary w-full"
        >
          {loading ? "Sending request..." : "Request access"}
        </button>
      </form>

      {message ? (
        <div className="hud-panel mt-5 border border-emerald-300/20 text-emerald-100">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="hud-panel mt-5 border border-rose-300/20 text-rose-100">{error}</div>
      ) : null}
    </div>
  );
}
