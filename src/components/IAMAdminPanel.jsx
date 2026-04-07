"use client";

import { useState, useEffect } from "react";
import { useUser } from "@/lib/auth/userContext";
import { listHiveMembers, setUserRoleForHive } from "@/lib/data/roleRepository";
import { syncHiveDirectoryMetrics } from "@/lib/data/hiveRepository";
import { db } from "@/lib/firebase/config";
import UserAvatar from "@/components/UserAvatar";
import {
  doc,
  deleteDoc,
  collection,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";

const rolePill = {
  OWNER: "border-amber-300/20 bg-amber-300/10 text-amber-100",
  ADMIN: "border-violet-300/20 bg-violet-300/10 text-violet-100",
  MEMBER: "border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
  VIEWER: "border-slate-300/20 bg-slate-300/10 text-slate-100",
};

export default function IAMAdminPanel({ hiveID }) {
  const { user } = useUser();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMember, setSelectedMember] = useState(null);
  const [newRole, setNewRole] = useState("");
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!hiveID) return;

    async function loadMembers() {
      try {
        const memberList = await listHiveMembers(hiveID);
        setMembers(memberList);
      } catch (error) {
        console.error("Failed to load members:", error);
      } finally {
        setLoading(false);
      }
    }

    loadMembers();
  }, [hiveID]);

  const handleAssignRole = async () => {
    if (!selectedMember || !newRole) {
      setMessage({ type: "error", text: "Please select a member and role." });
      return;
    }

    if (newRole === "OWNER") {
      const confirmOwner = confirm(
        `Transfer OWNER role to ${selectedMember.displayName || selectedMember.email}?`
      );
      if (!confirmOwner) return;
    }

    setProcessing(true);
    setMessage(null);

    try {
      await setUserRoleForHive(hiveID, selectedMember.uid, newRole, {
        displayName: selectedMember.displayName,
        email: selectedMember.email,
        photoURL: selectedMember.photoURL,
      });

      await addDoc(collection(db, "auditLogs"), {
        event: "ROLE_CHANGED",
        hiveId: hiveID,
        userId: user.uid,
        targetUserId: selectedMember.uid,
        targetUserEmail: selectedMember.email,
        oldRole: selectedMember.role,
        newRole,
        timestamp: serverTimestamp(),
        details: `Role changed from ${selectedMember.role} to ${newRole}`,
      });

      setMessage({
        type: "success",
        text: `${newRole} assigned to ${selectedMember.displayName || selectedMember.email}.`,
      });

      const memberList = await listHiveMembers(hiveID);
      setMembers(memberList);
      setSelectedMember(null);
      setNewRole("");
    } catch (error) {
      setMessage({ type: "error", text: `Failed: ${error.message}` });
    } finally {
      setProcessing(false);
    }
  };

  const handleRevokeAccess = async (member) => {
    if (!confirm(`Remove ${member.displayName || member.email} from this hive?`)) {
      return;
    }

    setProcessing(true);
    setMessage(null);

    try {
      const memberRef = doc(db, "Hive", hiveID, "members", member.uid);
      await deleteDoc(memberRef);
      await syncHiveDirectoryMetrics(hiveID, { touchLastActive: true });

      await addDoc(collection(db, "auditLogs"), {
        hiveId: hiveID,
        event: "MEMBER_REMOVED",
        userId: user.uid,
        targetUserId: member.uid,
        targetUserEmail: member.displayName || member.email,
        details: `User ${member.displayName || member.email} was removed from the hive`,
        timestamp: serverTimestamp(),
      });

      setMessage({
        type: "success",
        text: `${member.displayName || member.email} has been removed from the hive.`,
      });

      const memberList = await listHiveMembers(hiveID);
      setMembers(memberList);
    } catch (error) {
      setMessage({ type: "error", text: `Failed: ${error.message}` });
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-panel text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-cyan-200" />
        <p className="mt-3 text-sm text-slate-300">Loading IAM controls...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="hero-panel">
        <span className="hero-chip">IAM</span>
        <h2 className="mt-5 text-3xl font-semibold tracking-[-0.05em] text-white">
          Identity and access admin
        </h2>
        <p className="panel-subtitle mt-3">
          Assign roles, remove access, and track permission changes through the audit trail.
        </p>
      </div>

      {message ? (
        <div
          className={`rounded-2xl border p-4 text-sm ${
            message.type === "success"
              ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
              : "border-rose-300/20 bg-rose-300/10 text-rose-100"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <div className="glass-panel">
        <p className="panel-title">Assign role</p>
        <p className="panel-subtitle">
          Change a member's role. OWNER assignment remains a deliberate confirmation step.
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_220px]">
          <select
            value={selectedMember?.uid || ""}
            onChange={(event) => {
              const member = members.find((item) => item.uid === event.target.value);
              setSelectedMember(member || null);
            }}
            className="select-shell"
            disabled={processing}
          >
            <option value="">Choose member</option>
            {members
              .filter((member) => member.role !== "OWNER")
              .map((member) => (
                <option key={member.uid} value={member.uid}>
                  {member.displayName || member.email} ({member.role})
                </option>
              ))}
          </select>

          <select
            value={newRole}
            onChange={(event) => setNewRole(event.target.value)}
            className="select-shell"
            disabled={processing}
          >
            <option value="">Choose role</option>
            <option value="OWNER">OWNER</option>
            <option value="ADMIN">ADMIN</option>
            <option value="MEMBER">MEMBER</option>
            <option value="VIEWER">VIEWER</option>
          </select>

          <button
            onClick={handleAssignRole}
            disabled={processing || !selectedMember || !newRole}
            className="button-primary"
            type="button"
          >
            {processing ? "Processing..." : "Assign role"}
          </button>
        </div>

        <div className="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm text-cyan-100">
          Role enforcement still happens in Firestore security rules. This panel is only the UI for
          valid changes.
        </div>
      </div>

      <div className="glass-panel">
        <div className="chat-header">
          <div>
            <p className="text-kicker">Members</p>
            <h3 className="panel-title text-2xl">Member management</h3>
          </div>
          <span className="status-pill">{members.length} members</span>
        </div>

        <div className="mt-6 space-y-3">
          {members.length === 0 ? (
            <div className="empty-state">No members found.</div>
          ) : (
            members.map((member) => (
              <article
                key={member.uid}
                className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:bg-white/[0.07]"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 items-center gap-4">
                    <UserAvatar
                      name={member.displayName}
                      email={member.email}
                      photoURL={member.photoURL}
                      className="workspace-member-avatar"
                      size="fill"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-white">
                        {member.displayName || "Unknown User"}
                      </p>
                      <p className="mt-1 truncate text-sm text-slate-300">{member.email}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${
                        rolePill[member.role] || rolePill.VIEWER
                      }`}
                    >
                      {member.role}
                    </span>

                    {member.uid !== user?.uid && member.role !== "OWNER" ? (
                      <button
                        onClick={() => handleRevokeAccess(member)}
                        disabled={processing}
                        className="button-danger text-sm"
                        type="button"
                      >
                        Remove access
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
