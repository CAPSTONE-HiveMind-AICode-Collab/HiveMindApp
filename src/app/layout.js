// src/app/layout.js
import "./globals.css";
import { UserProvider } from "../lib/auth/userContext";
import ClientLayout from "./ClientLayout"; // your client-side wrapper for notifications
import ErrorBoundary from "@/components/ErrorBoundary";

export const metadata = {
  title: "HiveMind",
  description: "Secure decision-memory workspace for student and software teams.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ErrorBoundary>
          <UserProvider>
            {/* Client-side wrapper for notifications and other UI */}
            <ClientLayout>{children}</ClientLayout>
          </UserProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
