"use client";

import { useState, useEffect } from "react";
import { getUserRoleForHive } from "@/lib/data/roleRepository";

export default function PermissionBadge({ hiveID, userId }) {
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hiveID || !userId) return;

    async function loadRole() {
      try {
        const userRole = await getUserRoleForHive(hiveID, userId);
        setRole(userRole);
      } catch (error) {
        console.error("Failed to load role:", error);
        setRole(null);
      } finally {
        setLoading(false);
      }
    }

    loadRole();
  }, [hiveID, userId]);

  if (loading) {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1 bg-gray-100 rounded-full text-xs">
        <span className="text-gray-600">Loading...</span>
      </span>
    );
  }

  if (!role) {
    return null;
  }

  const roleColors = {
    OWNER: "from-yellow-400 to-orange-500",
    ADMIN: "from-purple-500 to-indigo-600",
    MEMBER: "from-blue-500 to-cyan-500",
    VIEWER: "from-gray-400 to-gray-500",
  };

  const roleIcons = {
    OWNER: "👑",
    ADMIN: "⚡",
    MEMBER: "👤",
    VIEWER: "👁️",
  };

  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold shadow-md text-white bg-gradient-to-r ${roleColors[role]}`}>
      <span>{roleIcons[role]}</span>
      <span>{role}</span>
      <span className="ml-1 px-1.5 py-0.5 bg-white/20 rounded text-[10px]">IAM</span>
    </span>
  );
}
