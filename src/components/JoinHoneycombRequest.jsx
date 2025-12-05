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

  // Pre-fill honeycomb ID from URL parameter
  useEffect(() => {
    const idFromUrl = searchParams.get("honeycombID") || searchParams.get("id");
    if (idFromUrl) {
      setHoneycombID(idFromUrl);
    }
  }, [searchParams]);

  const handleSubmit = async (e) => {
    e.preventDefault();
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
      <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-md mt-8">
        <p className="text-gray-600">Please log in to join a honeycomb</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-md mt-8">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">Join a Honeycomb</h2>
      <p className="text-gray-600 mb-4">
        Enter a honeycomb ID to request access. The owner will be notified and can approve your request.
      </p>
      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          💡 <strong>Tip:</strong> Ask the honeycomb owner to copy and share the honeycomb ID with you.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="honeycombID" className="block text-sm font-medium text-gray-700 mb-2">
            Honeycomb ID
          </label>
          <input
            id="honeycombID"
            type="text"
            value={honeycombID}
            onChange={(e) => setHoneycombID(e.target.value)}
            placeholder="Enter honeycomb ID..."
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 bg-white"
            required
            style={{ color: '#000', backgroundColor: '#fff' }}
          />
        </div>

        <button
          type="submit"
          disabled={loading || !honeycombID.trim()}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
        >
          {loading ? "Sending Request..." : "Request to Join"}
        </button>
      </form>

      {message && (
        <div className="mt-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded-lg">
          {message}
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg">
          {error}
        </div>
      )}
    </div>
  );
}

