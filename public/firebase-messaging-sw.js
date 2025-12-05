// Firebase Cloud Messaging Service Worker
// Handles background push notifications

importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js");

// Initialize Firebase in service worker
firebase.initializeApp({
  apiKey: "AIzaSyCOMMqoYmKv8IgW5SrSeERqGy_Zb4HtmvI",
  authDomain: "hivemind-d23e7.firebaseapp.com",
  projectId: "hivemind-d23e7",
  storageBucket: "hivemind-d23e7.firebasestorage.app",
  messagingSenderId: "959010637075",
  appId: "1:959010637075:web:00a3ef3b6fe35b8bf646e6",
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log("Background message received:", payload);

  const notificationTitle = payload.notification?.title || "HiveMind";
  const notificationOptions = {
    body: payload.notification?.body || "You have a new notification",
    icon: payload.notification?.icon || "/logo.png",
    badge: "/badge.png",
    tag: payload.data?.hiveID || "default",
    data: payload.data,
    requireInteraction: false,
    actions: [
      {
        action: "open",
        title: "View",
      },
      {
        action: "close",
        title: "Dismiss",
      },
    ],
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener("notificationclick", (event) => {
  console.log("Notification clicked:", event);

  event.notification.close();

  if (event.action === "open" || !event.action) {
    // Open the app or focus existing tab
    const urlToOpen = event.notification.data?.url || "/dashboard";

    event.waitUntil(
      clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clientList) => {
          // Check if app is already open
          for (const client of clientList) {
            if (client.url.includes(urlToOpen) && "focus" in client) {
              return client.focus();
            }
          }
          // Open new window if not found
          if (clients.openWindow) {
            return clients.openWindow(urlToOpen);
          }
        })
    );
  }
});
