import { useEffect, useState } from "react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs } from "firebase/firestore";
import { useUser } from "@/lib/auth/userContext";
import { scheduleTimeBasedNotification } from "@/lib/business/notificationService";

export default function NotificationCreator({ hiveID, honeycombID, threadID, onClose }) {
  const { user } = useUser();
  const [message, setMessage] = useState("");
  const [notifyAt, setNotifyAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [targetUser, setTargetUser] = useState("");
  const [users, setUsers] = useState([]);

  // Fetch all users from Firestore
  useEffect(() => {
    const fetchUsers = async () => {
      const usersCol = collection(db, "Users");
      const snapshot = await getDocs(usersCol);
      const usersList = snapshot.docs.map(doc => ({
        uid: doc.id,
        displayName: doc.data().displayName,
      }));
      setUsers(usersList);
    };
    fetchUsers();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!message || !notifyAt || !targetUser) return;

    setLoading(true);
    setSuccess("");

    try {
      const notifyDate = new Date(notifyAt);
      const targetUID = users.find(u => u.displayName === targetUser)?.uid;
      if (!targetUID) throw new Error("User not found");

      await scheduleTimeBasedNotification(
        hiveID,
        honeycombID,
        threadID,
        [targetUID],
        message,
        notifyDate
      );

      setMessage("");
      setNotifyAt("");
      setSuccess("Reminder created!");
    } catch (err) {
      console.error("Failed to create notification:", err);
      setSuccess("Error creating reminder.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 text-gray-900 bg-white border rounded-lg shadow-sm mb-4 w-80">
      <div className="flex justify-between items-center mb-2">
        <h4 className="font-bold">Create Reminder</h4>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-lg font-bold"
          >
            ✕
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <input
          type="text"
          placeholder="Notification message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="border rounded p-2 focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />

        <input
          type="datetime-local"
          value={notifyAt}
          onChange={(e) => setNotifyAt(e.target.value)}
          className="border rounded p-2 focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />

        <select
          value={targetUser}
          onChange={(e) => setTargetUser(e.target.value)}
          className="border rounded p-2 focus:outline-none focus:ring-2 focus:ring-yellow-400"
        >
          <option value="">Select user</option>
          {users.map(u => (
            <option key={u.uid} value={u.displayName}>
              {u.displayName}
            </option>
          ))}
        </select>

        <button
          type="submit"
          className="bg-yellow-400 text-white px-4 py-2 rounded hover:bg-yellow-500 disabled:opacity-50"
          disabled={loading}
        >
          {loading ? "Creating..." : "Set Reminder"}
        </button>
        {success && <p className="text-sm text-green-600">{success}</p>}
      </form>
    </div>
  );
}
