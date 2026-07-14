"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Nav sign-in (spec §3, decision C): the top-nav search is REPLACED by a pure owner sign-in field.
// Signed-out → "Sign in" opens an inline email → one-time code panel (owner-scoped code login, no
// handle). Signed-in → "My agents" (→ the directory) + a sign-out. Auth state comes from
// GET /api/owner/me (200 when a valid vg_owner cookie is present). Registry browse still lives at
// /registry (linked from the menu). The old mock AGENTS search array is gone.

const MENU = [
  { href: "/why-verify", label: "Why get verified", sub: "stand out from fakes" },
  { href: "/how-it-works", label: "How it works", sub: "the method, in the open" },
  { href: "/methodology", label: "Methodology", sub: "versioning & governance" },
  { href: "/transparency", label: "Transparency", sub: "verify without trusting us" },
  { href: "/dimensions", label: "Dimensions", sub: "what we test" },
  { href: "/registry", label: "The Registry", sub: "every verified agent" },
  { href: "/get-verified", label: "Pricing", sub: "from 25¢/day, continuous" },
  { href: "/contribute", label: "Contribute", sub: "help shape the standard" },
  { href: "/support", label: "Support", sub: "questions, answered" },
  // /about dropped from header nav (storied-anonymous rebuild, Ant 2026-07-08) — footer-weight
  // page now; the footer link remains.
];

// Only ONE nav affordance (Search or Sign in) is open at a time. Each box registers a close fn on
// mount; opening one closes all the rest IN THE SAME onClick — so clicking Search while Sign in is
// open explicitly closes Sign in and opens Search, instead of leaning on the outside-click mousedown
// (which raced the field's width animation and left the second click landing on nothing). Module-level
// so it works across the two independent components without lifting their state into Nav.
const navClosers = new Set<() => void>();
function closeOtherNavAffordances() { navClosers.forEach((c) => c()); }

type AuthState = "loading" | "out" | "in";

// Shared owner sign-in affordance. `variant` styles it for the top bar vs the mobile menu. When
// signed in it renders the "My agents" link + sign out; signed out it opens the email→code panel.
function SignIn({ variant, onNavigate }: { variant: "bar" | "menu"; onNavigate?: () => void }) {
  const [auth, setAuth] = useState<AuthState>("loading");
  const [panel, setPanel] = useState(false);
  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  // Opening happens on mousedown (see the button) so the panel opens BEFORE the other affordance's
  // Animate the stage swap: when email→code (or back), the field slide-fades in so the transition
  // reads as a step, not an instant relabel. Skips the first render so it doesn't fire on mount.
  const [swap, setSwap] = useState(false);
  const firstStage = useRef(true);
  useEffect(() => {
    if (firstStage.current) { firstStage.current = false; return; }
    setSwap(true);
    const t = setTimeout(() => setSwap(false), 340);
    return () => clearTimeout(t);
  }, [stage]);

  useEffect(() => {
    // Cheap auth probe — /api/owner/me is 200 only with a valid owner session. Re-probes on
    // vg-auth-changed: pages that mint a session mid-life (the /track live page signs the owner in
    // from their emailed link, Ant 2026-07-08) dispatch it so the nav flips to signed-in without a
    // reload.
    const probe = () =>
      fetch("/api/owner/me", { headers: { Accept: "application/json" }, credentials: "include" })
        .then((r) => setAuth(r.ok ? "in" : "out"))
        .catch(() => setAuth("out"));
    probe();
    window.addEventListener("vg-auth-changed", probe);
    return () => window.removeEventListener("vg-auth-changed", probe);
  }, []);

  useEffect(() => {
    if (!panel) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setPanel(false); };
    const t = window.setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDoc); };
  }, [panel]);

  // Register with the mutual-exclusion registry so opening Search closes this panel.
  useEffect(() => { const c = () => setPanel(false); navClosers.add(c); return () => { navClosers.delete(c); }; }, []);

  // Focus the field when the panel opens (or stage swaps email→code). The field is ALWAYS in the DOM
  // (so it can animate open smoothly) but only focusable/interactive while open.
  useEffect(() => { if (panel) fieldRef.current?.focus(); }, [panel, stage]);

  const requestCode = async () => {
    if (!email.includes("@")) return;
    setBusy(true); setErr("");
    try {
      // owner-scoped: email only, NO handle.
      await fetch("/api/owner/request-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      setStage("code");
    } catch { setErr("Couldn't reach the sign-in service."); }
    setBusy(false);
  };
  const verify = async () => {
    if (!code.trim()) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/owner/verify-code", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email: email.trim(), code: code.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) {
        setAuth("in"); setPanel(false); setStage("email"); setCode("");
        // Route by how many agents this owner has (Ant 2026-07-10): exactly 1 → straight to that agent's
        // report; 2+ → the My-agents list; 0 → the My-agents empty state ("set up your first agent").
        // Never just refresh the current page — take them where they want to be.
        try {
          const ar = await fetch("/api/owner/agents", { credentials: "include" });
          const ad = await ar.json().catch(() => ({}));
          const list = Array.isArray(ad?.agents) ? ad.agents : [];
          window.location.href = (list.length === 1 && list[0]?.handle) ? `/agent/${list[0].handle}` : "/agents";
        } catch {
          window.location.href = "/agents";
        }
        return;
      }
      // Only the ACTIONABLE errors get text. A wrong code just clears the field and stays on "Enter your
      // code" — the empty field + still-signed-out state is obvious enough without the noisy sentence (Ant 2026-07-10).
      if (d.error === "expired") setErr("That code expired — request a new one.");
      else if (d.error === "too_many_attempts") setErr("Too many tries — request a fresh code.");
      else { setErr(""); setCode(""); }
    } catch { setErr("Couldn't reach the sign-in service."); }
    setBusy(false);
  };
  const signOut = async () => {
    await fetch("/api/owner/logout", { method: "POST", credentials: "include" }).catch(() => {});
    setAuth("out");
    // Enforce signed-out state on BOTH surfaces in one move (security edge): a hard nav to home drops
    // any in-memory owner state (report drawer / is_owner) AND takes an owner off the gated /agents
    // directory — the client can't keep showing owner-only UI once the cookie's gone.
    const path = typeof window !== "undefined" ? window.location.pathname : "";
    if (path.startsWith("/agents") || path.startsWith("/agent/")) {
      window.location.href = "/";
    } else {
      // elsewhere, a reload re-fetches everything unauthenticated (no stale owner UI anywhere).
      window.location.reload();
    }
  };

  // JITTER FIX (Ant): while the auth probe is in flight, render an INVISIBLE fixed-width placeholder
  // instead of the signed-OUT "Sign in" button. Two wins: (1) a signed-IN user never flashes "Sign in"
  // then swaps to the cluster on the load-time probe; (2) the bar reserves space so the auth-resolve
  // swap doesn't jump. No animation — just less movement.
  if (auth === "loading") {
    return <span className={`navauth navauth-${variant} navauth-loading`} aria-hidden />;
  }

  if (auth === "in") {
    return (
      <span className={`navauth navauth-${variant} is-in`}>
        {/* Order + styling per Ant 2026-07-08: Sign out BEFORE My agents (bar reads Search · Sign out ·
            My agents · The Registry), and every pill wears the same standard background — no odd one out. */}
        <button className="navauth-out" onClick={signOut} aria-label="Sign out">Sign out</button>
        <Link className="navauth-agents" href="/agents" onClick={onNavigate}>My agents</Link>
      </span>
    );
  }

  // INLINE sign-in (no popup panel — covers no page content). Collapsed: just a "Sign in" button.
  // Clicking it reveals the email field INLINE in the bar and flips the button to "Send code" (which
  // submits). After a code is sent, the field switches to the code input and the button reads "Sign in".
  const submit = () => (stage === "email" ? requestCode() : verify());
  const primaryLabel = busy ? "…" : stage === "email" ? "Send code" : "Sign in";
  const primaryDisabled = busy || (stage === "email" ? !email.includes("@") : !code.trim());

  return (
    <div className={`navauth navauth-${variant}${panel ? " open" : ""}`} ref={ref}>
      {/* Field is ALWAYS rendered so it can animate open (CSS width/opacity). One <input> whose props
          switch by stage — no remount, so email→code is a smooth in-place swap, not a jump. The × cancel
          sits INSIDE the field on the right (Ant 2026-07-10) via a relative wrapper. */}
      <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        <input
          ref={fieldRef}
          className={`navauth-field${swap ? " navauth-swap" : ""}`}
          type={stage === "email" ? "email" : "text"}
          inputMode={stage === "email" ? "email" : "text"}
          autoCapitalize={stage === "email" ? "none" : "characters"}
          placeholder={stage === "email" ? "Enter your email" : "Enter your code"}
          value={stage === "email" ? email : code}
          onChange={(e) => (stage === "email" ? setEmail(e.target.value) : setCode(e.target.value))}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          aria-label={stage === "email" ? "Email" : "Sign-in code"}
          aria-hidden={!panel}
          tabIndex={panel ? 0 : -1}
          style={panel ? { paddingRight: 30 } : undefined}
        />
        {/* Cancel/close — back out of the code step (wrong email, no code arriving) instead of being
            stuck. Sits inside the field's right edge, only while open. */}
        {panel && (
          <button type="button" aria-label="Cancel sign-in"
            onClick={() => { setPanel(false); setStage("email"); setCode(""); setErr(""); }}
            style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", background: "none", border: 0, color: "var(--muted, #8d8fa6)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "4px 7px" }}>
            ×
          </button>
        )}
      </span>
      {/* ONE click opens (when closed) or submits (when open) — no mousedown/justOpened dance, which was
          eating the first click (the double-click bug, Ant 2026-07-10). The button sits inside `ref`, so
          the outside-click close handler never fires on it. */}
      <button className="navauth-btn" aria-expanded={panel}
        onClick={() => {
          if (!panel) { closeOtherNavAffordances(); setPanel(true); return; }
          submit();
        }}
        disabled={panel && primaryDisabled}>
        {panel ? primaryLabel : "Sign in"}
      </button>
      {err && <span className="navauth-err">{err}</span>}
    </div>
  );
}

// Nav search — a collapsed "Search" button that animates open into a field (same expand-motion as
// SignIn); submit → registry results for the query. Deliberately parallel to SignIn so the two nav
// affordances feel identical.
// Small static index of the site's own pages so the nav search covers the WEBSITE, not just the
// registry. Keywords are the terms a human would type; kept to clear nav words so agent handles/names
// fall through to the registry search rather than false-matching a page.
const SITE_PAGES: { path: string; title: string; kw: string[] }[] = [
  { path: "/how-it-works", title: "How it works", kw: ["how it works", "process", "battery", "continuous", "probe", "challenge"] },
  { path: "/methodology", title: "Methodology", kw: ["methodology", "grading", "rubric", "proof or zero", "scoring", "version"] },
  { path: "/get-verified", title: "Pricing", kw: ["pricing", "price", "cost", "wallet", "founding rate", "top up", "get verified"] },
  { path: "/why-verify", title: "Why verify", kw: ["why verify", "trust", "reputation"] },
  { path: "/registry", title: "Registry", kw: ["registry", "leaderboard", "standings", "baselines", "verified agents"] },
  { path: "/about", title: "About", kw: ["about", "team", "maker", "who runs verigent"] },
  { path: "/support", title: "Support & FAQ", kw: ["support", "faq", "help", "questions"] },
  { path: "/transparency", title: "Transparency", kw: ["transparency", "bounty", "commit reveal", "postmortem"] },
  { path: "/start", title: "Start a free test", kw: ["start", "free test", "begin", "get started"] },
];
function matchPages(term: string): { path: string; title: string }[] {
  const t = term.trim().toLowerCase();
  if (t.length < 2) return [];
  const hit = (p: (typeof SITE_PAGES)[number]) =>
    p.title.toLowerCase().includes(t) || p.kw.some((k) => k.includes(t));
  return SITE_PAGES.filter(hit).slice(0, 5).map((p) => ({ path: p.path, title: p.title }));
}

function SearchBox({ variant, onNavigate }: { variant: "bar" | "menu"; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const justOpened = useRef(false); // open on mousedown, swallow the following click (see SignIn)
  const pageResults = matchPages(q);

  useEffect(() => {
    if (!open) return;
    fieldRef.current?.focus();
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const t = window.setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDoc); };
  }, [open]);

  // Register with the mutual-exclusion registry so opening Sign in closes this box.
  useEffect(() => { const c = () => setOpen(false); navClosers.add(c); return () => { navClosers.delete(c); }; }, []);

  const goto = (path: string) => { onNavigate?.(); window.location.href = path; };
  const go = () => {
    const term = q.trim();
    if (!term) { goto("/registry"); return; }
    // Enter jumps to the best page match if there is one, else searches the registry.
    goto(pageResults.length ? pageResults[0].path : `/registry?q=${encodeURIComponent(term)}`);
  };

  return (
    <div className={`navauth navsearch navauth-${variant}${open ? " open" : ""}`} ref={ref}>
      <input
        ref={fieldRef}
        className="navauth-field"
        type="search"
        placeholder="Search website and registry…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") go(); }}
        aria-label="Search website and registry"
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
      />
      <button className="navauth-btn" aria-expanded={open}
        onMouseDown={(e) => { if (!open) { e.preventDefault(); closeOtherNavAffordances(); setOpen(true); justOpened.current = true; } }}
        onClick={() => {
          if (justOpened.current) { justOpened.current = false; return; } // swallow the open-click
          if (!open) { closeOtherNavAffordances(); setOpen(true); return; } // keyboard open
          go();
        }}>
        {open ? "Go" : "Search"}
      </button>
      {open && q.trim().length >= 2 && (
        <div className="navsearch-results" role="listbox">
          {pageResults.map((r) => (
            <button key={r.path} className="nsr-item" role="option"
              onMouseDown={(e) => { e.preventDefault(); goto(r.path); }}>
              <span className="nsr-kind">Page</span>{r.title}
            </button>
          ))}
          <button className="nsr-item nsr-registry"
            onMouseDown={(e) => { e.preventDefault(); goto(`/registry?q=${encodeURIComponent(q.trim())}`); }}>
            <span className="nsr-kind">Registry</span>Search agents for &ldquo;{q.trim()}&rdquo;
          </button>
        </div>
      )}
    </div>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("nav-open", open);
    return () => document.body.classList.remove("nav-open");
  }, [open]);

  // public chrome only — admin has its own shell; /track is a self-contained test-watching surface
  // (Ant 2026-07-10): no nav, so it's clearly not the website and a forwarded link has nowhere else to go.
  if (pathname.startsWith("/admin") || pathname.startsWith("/track")) return null;

  const close = () => setOpen(false);

  return (
    <>
      <div className={`top${compact ? " compact" : ""}`}>
        <Link className="logo" href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/verigent-logo.png" alt="Verigent" />
          <span className="beta-tag">BETA</span>
        </Link>
        <div className="right">
          <SearchBox variant="bar" />
          <SignIn variant="bar" />
          <Link className="nav-reg" href="/registry">The Registry</Link>
          <Link className="cta-sm" href="/start">
            Get verified
          </Link>
          <button
            className={`burger${open ? " is-open" : ""}`}
            onClick={() => setOpen((o) => !o)}
            aria-label="Menu"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>
      </div>

      <div className={`menu${open ? " open" : ""}`}>
        <div className="inner">
          <div className="menu-actions">
            <SearchBox variant="menu" onNavigate={close} />
            <SignIn variant="menu" onNavigate={close} />
            <Link className="cta-sm" href="/start" onClick={close}>
              Get verified
            </Link>
          </div>
          <nav>
            {MENU.map((m) => (
              <Link key={m.href} href={m.href} onClick={close}>
                {m.label} <small>{m.sub}</small>
              </Link>
            ))}
          </nav>
          <div className="side">
            <Link className="menu-getverified" href="/start" onClick={close}>
              Get verified →
            </Link>
            <h4>Explore</h4>
            <a href="https://github.com/verigentai" target="_blank" rel="noopener noreferrer">
              Open source ↗
            </a>
            <Link href="/terms" onClick={close}>
              Terms
            </Link>
            <Link href="/privacy" onClick={close}>
              Privacy
            </Link>
            <h4 className="side-sub">Socials</h4>
            <a href="https://x.com/Verigent_ai" target="_blank" rel="noopener noreferrer">
              X / Twitter
            </a>
            <a href="https://www.moltbook.com/u/ax7-verigent" target="_blank" rel="noopener noreferrer">
              MoltBook
            </a>
            <a href="https://thecolony.cc/u/chunky-chunk" target="_blank" rel="noopener noreferrer">
              The Colony
            </a>
            <a href="https://github.com/verigentai" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <a href="https://dev.to/verigent" target="_blank" rel="noopener noreferrer">
              dev.to
            </a>
            <a href="https://www.npmjs.com/~verigent" target="_blank" rel="noopener noreferrer">
              npm
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
