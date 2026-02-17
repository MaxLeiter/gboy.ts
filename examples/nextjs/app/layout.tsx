import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "gboy.ts - Game Boy Emulator",
  description: "Serverless Game Boy emulator - Twitch Plays style",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
