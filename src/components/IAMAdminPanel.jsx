"use client";

import { useState, useEffect } from "react";
import { useUser } from "@/lib/auth/userContext";
import { listHiveMembers, setUserRoleForHive } from "@/lib/data/roleRepository";
import { db } from "@/lib/firebase/config";
import { doc, deleteDoc, collection, addDoc, serverTimestamp, updateDoc, getDoc } from "firebase/firestore";

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
      setMessage({ type: "error", text: "Please select a member and role" });
      return;
    }

    // Special confirmation for OWNER role assignment
    if (newRole === "OWNER") {
      const confirmOwner = confirm(
        `⚠️ CRITICAL ACTION: You are about to transfer OWNER role to ${selectedMember.displayName || selectedMember.email}.\n\n` +
        `This will give them full control over the hive, including the ability to manage all roles and remove members.\n\n` +
        `Are you absolutely sure you want to proceed?`
      );
      
      if (!confirmOwner) {
        return;
      }
    }

    setProcessing(true);
    setMessage(null);

    try {
      // Update role in Firestore
      await setUserRoleForHive(hiveID, selectedMember.uid, newRole, {
        displayName: selectedMember.displayName,
        email: selectedMember.email,
      });

      // Log the role change to audit logs
      const auditRef = collection(db, "auditLogs");
      await addDoc(auditRef, {
        event: "ROLE_CHANGED",
        hiveId: hiveID,
        userId: user.uid,
        targetUserId: selectedMember.uid,
        targetUserEmail: selectedMember.email,
        oldRole: selectedMember.role,
        newRole: newRole,
        timestamp: serverTimestamp(),
        details: `Role changed from ${selectedMember.role} to ${newRole}`,
      });

      setMessage({
        type: "success",
        text: `✅ Role ${newRole} assigned to ${selectedMember.displayName || selectedMember.email}`,
      });

      // Reload members
      const memberList = await listHiveMembers(hiveID);
      setMembers(memberList);
      setSelectedMember(null);
      setNewRole("");
    } catch (error) {
      setMessage({ type: "error", text: `❌ Failed: ${error.message}` });
    } finally {
      setProcessing(false);
    }
  };

  const handleRevokeAccess = async (member) => {
    if (!confirm(`Remove ${member.displayName || member.email} from this hive? They will lose all access.`)) {
      return;
    }

    setProcessing(true);
    setMessage(null);

    try {
      // Remove member from members subcollection
      const memberRef = doc(db, "Hive", hiveID, "members", member.uid);
      await deleteDoc(memberRef);
      
      // Remove from hive members array
      const hiveRef = doc(db, "Hive", hiveID);
      const hiveSnap = await getDoc(hiveRef);
      if (hiveSnap.exists()) {
        const hiveData = hiveSnap.data();
        const currentMembers = hiveData.members || [];
        const updatedMembers = currentMembers.filter(uid => uid !== member.uid);
        await updateDoc(hiveRef, {
          members: updatedMembers
        });
      }

      // Log the kick to audit logs
      const auditRef = collection(db, "auditLogs");
      await addDoc(auditRef, {
        hiveID: hiveID,
        action: "USER_KICKED",
        performedBy: user.uid,
        targetUserID: member.uid,
        targetUserName: member.displayName || member.email,
        targetUserRole: member.role,
        details: `User ${member.displayName || member.email} was removed from the hive`,
        timestamp: serverTimestamp(),
      });

      setMessage({
        type: "success",
        text: `✅ ${member.displayName || member.email} has been removed from the hive`,
      });

      // Reload members
      const memberList = await listHiveMembers(hiveID);
      setMembers(memberList);
    } catch (error) {
      setMessage({ type: "error", text: `❌ Failed: ${error.message}` });
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg border-2 border-gray-200 p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
        <p className="text-sm text-gray-600">Loading IAM controls...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-lg p-6 text-white">
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          🔐 IAM Admin Panel
        </h2>
        <p className="text-indigo-100 text-sm">
          Role management with audit logging and Firestore security rules
        </p>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`p-4 rounded-lg border-2 ${
            message.type === "success"
              ? "bg-green-50 border-green-300 text-green-800"
              : "bg-red-50 border-red-300 text-red-800"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Assign Role Section */}
      <div className="bg-white rounded-lg border-2 border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
          ⚡ Assign Role
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Select Member */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Select Member</label>
            <select
              value={selectedMember?.uid || ""}
              onChange={(e) => {
                const member = members.find((m) => m.uid === e.target.value);
                setSelectedMember(member);
              }}
              className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
              disabled={processing}
            >
              <option value="">-- Choose member --</option>
              {members.filter(member => member.role !== "OWNER").map((member) => (
                <option key={member.uid} value={member.uid}>
                  {member.displayName || member.email} ({member.role})
                </option>
              ))}
            </select>
          </div>

          {/* Select Role */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Assign Role</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
              disabled={processing}
            >
              <option value="">-- Choose role --</option>
              <option value="OWNER">👑 OWNER</option>
              <option value="ADMIN">⚡ ADMIN</option>
              <option value="MEMBER">👤 MEMBER</option>
              <option value="VIEWER">👁️ VIEWER</option>
            </select>
          </div>

          {/* Assign Button */}
          <div className="flex items-end">
            <button
              onClick={handleAssignRole}
              disabled={processing || !selectedMember || !newRole}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-2 rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {processing ? "Processing..." : "Assign Role"}
            </button>
          </div>
        </div>

        <div className="mt-3 bg-indigo-50 border border-indigo-200 rounded p-3">
          <p className="text-xs text-indigo-800">
            🛡️ <strong>Security Enforcement:</strong> Roles enforced by Firestore Security Rules
            and validated on every database request. All changes are logged to audit trail.
          </p>
          <p className="text-xs text-indigo-800 mt-1">
            👑 <strong>Owner Protection:</strong> The hive owner cannot be modified or removed to maintain security.
          </p>
        </div>
      </div>

      {/* Member List */}
      <div className="bg-white rounded-lg border-2 border-gray-200 overflow-hidden">
        <div className="bg-gradient-to-r from-gray-100 to-gray-200 px-4 py-3 border-b-2 border-gray-300">
          <h3 className="text-lg font-bold text-gray-800">👥 Member Management ({members.length})</h3>
        </div>

        <div className="divide-y divide-gray-200">
          {members.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>No members found</p>
            </div>
          ) : (
            members.map((member) => (
              <div
                key={member.uid}
                className="p-4 hover:bg-gray-50 transition-colors flex items-center justify-between"
              >
                <div className="flex-1">
                  <p className="font-semibold text-gray-800">
                    {member.displayName || "Unknown User"}
                  </p>
                  <p className="text-sm text-gray-500">{member.email}</p>
                </div>

                <div className="flex items-center gap-3">
                  {/* Role Badge */}
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold ${
                      member.role === "OWNER"
                        ? "bg-yellow-100 text-yellow-800"
                        : member.role === "ADMIN"
                        ? "bg-purple-100 text-purple-800"
                        : member.role === "MEMBER"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {member.role === "OWNER" && "👑 "}
                    {member.role === "ADMIN" && "⚡ "}
                    {member.role === "MEMBER" && "👤 "}
                    {member.role === "VIEWER" && "👁️ "}
                    {member.role}
                  </span>

                  {/* Kick User Button */}
                  {member.uid !== user?.uid && member.role !== "OWNER" && (
                    <button
                      onClick={() => handleRevokeAccess(member)}
                      disabled={processing}
                      className="px-3 py-1 bg-red-100 text-red-700 rounded-lg text-xs font-semibold hover:bg-red-200 disabled:opacity-50 transition-colors"
                    >
                      🚫 Kick
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Security Info */}
      <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
          🛡️ Security Features
        </h3>
        <ul className="space-y-2">
          <li className="flex items-start gap-2 text-sm">
            <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-gray-700">
              <strong>Firestore Security Rules:</strong> Role-based access control validated server-side
            </span>
          </li>
          <li className="flex items-start gap-2 text-sm">
            <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-gray-700">
              <strong>Database-Level Protection:</strong> Unauthorized access blocked before reaching client
            </span>
          </li>
          <li className="flex items-start gap-2 text-sm">
            <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-gray-700">
              <strong>Audit Logging:</strong> All role changes tracked automatically
            </span>
          </li>
          <li className="flex items-start gap-2 text-sm">
            <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-gray-700">
              <strong>Zero Trust Model:</strong> Every database request validated against security rules
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
