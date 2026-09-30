import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Autoneural CRM",
  description: "Autoneural company CRM — customers, sales pipeline, WhatsApp conversations, AI voice assistance and follow-ups.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
