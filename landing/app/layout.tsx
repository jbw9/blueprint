import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { THEME_SCRIPT } from "../../app/lib/client/theme";
import "./globals.css";

// Here, not on each page: the share image (opengraph-image.png) belongs to this segment and is made absolute with this segment's base.
export const metadata: Metadata = { metadataBase: new URL("https://blpr.dev") };

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme is set on <html> by the script below, before React loads: the app's, so a reader's choice there holds here.
    <html lang="en" className={`${inter.variable} ${mono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/* Browser extensions stamp attributes on <body> before React loads. */}
      <body className="h-full overflow-hidden" suppressHydrationWarning>{children}</body>
    </html>
  );
}
