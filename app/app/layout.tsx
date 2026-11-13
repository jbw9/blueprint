import type { Metadata } from "next";
import localFont from "next/font/local";
import { THEME_SCRIPT } from "@/lib/client/theme";
import "./globals.css";

// Kept here rather than fetched from Google at build time: a build that could not reach Google failed.
const sans = localFont({
  variable: "--font-sans",
  src: [
    { path: "./fonts/ibm-plex-sans-400.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-sans-500.woff2", weight: "500" },
    { path: "./fonts/ibm-plex-sans-600.woff2", weight: "600" },
  ],
  display: "swap",
});

const mono = localFont({
  variable: "--font-mono",
  src: [
    { path: "./fonts/ibm-plex-mono-400.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-500.woff2", weight: "500" },
    { path: "./fonts/ibm-plex-mono-600.woff2", weight: "600" },
  ],
  display: "swap",
});

const display = localFont({
  variable: "--font-display",
  src: [
    { path: "./fonts/zilla-slab-300.woff2", weight: "300" },
    { path: "./fonts/zilla-slab-400.woff2", weight: "400" },
  ],
  display: "swap",
});

export const metadata: Metadata = {
  // A published export is one blueprint, and its tab says which.
  title: process.env.NEXT_PUBLIC_STATIC_BLUEPRINT ?? "Blueprint",
  description:
    "See what an agent actually changed in your codebase — and what the analysis could not prove.",
  // A published export is the landing page's framed demo, so search sends people to the landing page instead.
  ...(process.env.NEXT_PUBLIC_STATIC_BLUEPRINT && { robots: { index: false, follow: false } }),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme is set on <html> by the script below, before React loads.
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/* Browser extensions stamp attributes on <body> before React loads. */}
      <body className="h-full overflow-hidden" suppressHydrationWarning>{children}</body>
    </html>
  );
}
