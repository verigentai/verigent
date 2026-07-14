import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { TOTAL_COMPOSITE_DIMS } from "@/lib/dimensions";
import "./globals.css";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { RevealScript } from "@/components/reveal";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Humanist serif for pull quotes — italic gives them a real "someone said this" voice (Ant 2026-06-29).
const newsreader = Newsreader({
  variable: "--font-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Verigent · Build your agent with confidence",
  // Dim count DERIVES from the manifest (§2.10) — this literal sat stale at "26" while the battery grew to 31.
  description: `Test your AI agent across ${TOTAL_COMPOSITE_DIMS} real dimensions, find exactly where it's strong and where it breaks, and build it with confidence. Continuous, independently judged, proven on-chain.`,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* STAGING indicator (Ant 2026-07-12): an always-visible amber viewport frame + pill so
            staging can never be mistaken for prod, even mid-scroll. Baked in at BUILD time:
            verigent-deploy-staging.sh sets NEXT_PUBLIC_VG_ENV=staging before `next build`; the
            prod deploy script never sets it, so prod builds have no code path to render this. */}
        {process.env.NEXT_PUBLIC_VG_ENV === "staging" && (
          <div className="vg-env-staging" aria-hidden="true">
            <div className="vg-env-frame" />
            <div className="vg-env-pill">STAGING — isolated test environment</div>
          </div>
        )}
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
        <RevealScript />
      </body>
    </html>
  );
}
