// src/app/layout.js
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { UserProvider } from "../lib/auth/userContext";
import ClientLayout from "./ClientLayout"; // your client-side wrapper for notifications
import ErrorBoundary from "@/components/ErrorBoundary";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata = {
  title: "HiveMind",
  description: "HiveMind app",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
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
