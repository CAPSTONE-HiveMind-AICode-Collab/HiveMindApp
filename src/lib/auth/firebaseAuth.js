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
      const { uid, displayName, email, photoURL } = firebaseUser;

      console.info("[auth] onAuthStateChanged - signed in:", { uid, email });

      try {
        // Reference to Users collection
        const userRef = doc(db, "Users", uid);
        const userSnap = await getDoc(userRef);

        await setDoc(
          userRef,
          {
            uid,
            displayName: displayName || "",
            email: email || "",
            photoURL: photoURL || "",
            ...(userSnap.exists() ? {} : { createdAt: new Date() }),
          },
          { merge: true }
        );

        // Pass user info to callback
        callback({ uid, displayName, email, photoURL });
      } catch (err) {
        console.error("Error adding user to Firestore:", err);
        callback({ uid, displayName, email, photoURL }); // still pass user info
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
