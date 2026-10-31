import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Puzzle Games",
  description: "3D puzzle games. Starting with the Rubik's cube.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading headers makes every page render per request so the CSP nonce applies.
  await headers();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
