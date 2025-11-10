import { auth, provider, db } from "@/lib/firebase/config";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";

/**
 * Listen to auth changes and ensure the user exists in Firestore
 * @param {function} callback - called with user object or null
 */
export function listenToAuthChanges(callback) {
  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      const { uid, displayName, email } = firebaseUser;

      try {
        // Reference to Users collection
        const userRef = doc(db, "Users", uid);
        const userSnap = await getDoc(userRef);

        // If user does not exist, create it
        if (!userSnap.exists()) {
          await setDoc(userRef, {
            uid,
            displayName: displayName || "",
            email: email || "",
            createdAt: new Date(),
          });
        }

        // Pass user info to callback
        callback({ uid, displayName, email });
      } catch (err) {
        console.error("Error adding user to Firestore:", err);
        callback({ uid, displayName, email }); // still pass user info
      }
    } else {
      callback(null);
    }
  });
}

export function signInWithGoogle() {
  return signInWithPopup(auth, provider);
}

export function signOutUser() {
  return signOut(auth);
}
