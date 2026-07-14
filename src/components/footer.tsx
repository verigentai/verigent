"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Footer() {
  const pathname = usePathname();
  // /track is a self-contained test-watching surface (Ant 2026-07-10) — no site chrome, so a forwarded
  // watch link has nowhere else to go and it reads as its own focused environment (not the marketing site).
  if (pathname.startsWith("/admin") || pathname.startsWith("/track")) return null;

  return (
    <footer>
      <div className="container">
        <div className="foot-top">
          <div className="foot-pay">
            <div className="pay-group">
              <div className="pay-label">Preferred — pay direct, lowest fees</div>
              <div className="pay-row">
                <span className="chip">
                  <span className="paymark">₿</span> Bitcoin · Lightning
                </span>
                <span className="chip">
                  <span className="paymark">◎</span> Solana
                </span>
              </div>
            </div>
            <div className="pay-group">
              <div className="pay-label">Also accepted</div>
              <div className="pay-row">
                <span className="chip paycard">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="#3a3c52">
                    <rect x="2" y="5" width="20" height="14" rx="2.5" />
                    <rect x="2" y="8.5" width="20" height="2.6" fill="#eceaf4" />
                  </svg>{" "}
                  Visa · Mastercard · Amex
                </span>
              </div>
            </div>
          </div>

          <div className="foot-col">
            <h5>Verigent</h5>
            <Link href="/why-verify">Why get verified</Link>
            <Link href="/how-it-works">How it works</Link>
            <Link href="/dimensions">Dimensions</Link>
            <Link href="/transparency">Transparency</Link>
            <Link href="/registry">The Registry</Link>
            <Link href="/get-verified">Pricing</Link>
            <Link href="/support">Support</Link>
            <Link href="/about">About</Link>
          </div>

          <div className="foot-col">
            <h5>Explore</h5>
            <a href="https://github.com/verigentai/verify" target="_blank" rel="noopener noreferrer">Open source ↗</a>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </div>

          <div className="foot-col">
            <h5>Find us</h5>
            <a href="https://x.com/Verigent_ai" target="_blank" rel="noopener noreferrer">X / Twitter</a>
            <a href="https://www.moltbook.com/u/ax7-verigent" target="_blank" rel="noopener noreferrer">MoltBook</a>
            <a href="https://thecolony.cc/u/chunky-chunk" target="_blank" rel="noopener noreferrer">The Colony</a>
            <a href="https://github.com/verigentai" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="https://dev.to/verigent" target="_blank" rel="noopener noreferrer">dev.to</a>
            <a href="https://www.npmjs.com/~verigent" target="_blank" rel="noopener noreferrer">npm</a>
          </div>
        </div>

        <div className="foot-bottom">
          <span className="copy">© 2026 Verigent · continuous trust for AI agents</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/verigent-logo.png" alt="Verigent" />
        </div>
      </div>
    </footer>
  );
}
