"use client";

// Internal email editor (staging — behind Cloudflare Access). Loads lifecycle templates from D1,
// edit subject/body/CTA inline, Save persists, "Send to my inbox" renders + emails the real thing.
// Once locked, the live senders read these rows. Not linked in nav.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Tpl = { id: string; phase: string; label: string; trigger: string; timing: string; status: string; subject: string; body: string[]; cta: string };

const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  live: { label: "Built", bg: "rgba(34,197,94,.15)", fg: "#22c55e" },
  new: { label: "To build", bg: "rgba(122,95,192,.20)", fg: "#9a7fe0" },
  rework: { label: "Copy/schedule changing", bg: "rgba(245,158,11,.15)", fg: "#f59e0b" },
};

// Admin-native palette (matches the rest of the dashboard: #32333f cards, #3d3f4e borders, mono
// uppercase labels) — NOT the website look. Redesigned to sit inside the admin shell at any width
// down to mobile (Ant 2026-07-06).
const field: React.CSSProperties = { width: "100%", background: "#2a2b37", border: "1px solid #3d3f4e", borderRadius: 6, color: "#e6e6ee", padding: "9px 12px", fontSize: 14, fontFamily: "inherit", lineHeight: 1.5, boxSizing: "border-box" };
// custom-chevron select style — inset from the right edge (matching the left pad) instead of native-jammed.
const selectChevron: React.CSSProperties = {
  appearance: "none", WebkitAppearance: "none", cursor: "pointer", paddingRight: 34,
  background: "#2a2b37 url(\"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='12'%20height='12'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%238d8fa6'%20stroke-width='2.5'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='m6%209%206%206%206-6'/%3E%3C/svg%3E\") no-repeat right 12px center",
};
const lbl: React.CSSProperties = { fontFamily: "monospace", fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "#8d8fa6", display: "block", margin: "0 0 6px" };
const card: React.CSSProperties = { background: "#32333f", border: "1px solid #3d3f4e", borderRadius: 8, padding: 16, minWidth: 0 };
const cardH: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#a6a8ba", margin: "0 0 12px", textTransform: "uppercase", letterSpacing: 1 };

export function EmailEditor({ embedded = false }: { embedded?: boolean } = {}) {
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [sel, setSel] = useState("");
  const [draft, setDraft] = useState({ subject: "", body: "", cta: "" });
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [headerColor, setHeaderColor] = useState("#4c4674");
  const [dirty, setDirty] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Responsive to the editor's OWN container width (inline styles can't do @media, and this must fit
  // inside the admin shell at any width incl. TABLET — the old fixed 270px + 300px grid columns
  // overflowed and got trimmed). ResizeObserver → two breakpoints: below ~900px the editor+preview
  // stack; below ~680px the template list stacks on top too. Everything else flows in one column.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const [w, setW] = useState(1200);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => { for (const e of entries) setW(e.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const stackPanes = w < 820;    // editor and preview stack vertically (admin-native, one breakpoint)

  useEffect(() => {
    fetch("/api/email-templates").then((r) => {
      // Admin-gated data → gate the standalone /email-preview route too: an unauthenticated visitor
      // gets bounced to the admin login instead of an empty editor shell (2026-07-11). Inside the
      // admin shell the user is already authed, so this 401 branch never fires there.
      if (r.status === 401) { router.push("/admin/login"); return null; }
      return r.json();
    }).then((d) => {
      if (!d) return;
      const t: Tpl[] = d.templates || [];
      setTpls(t);
      setHeaderColor(d.settings?.header_color || "#4c4674");
      setLoading(false);
      if (t.length) pick(t[0]);
    }).catch(() => { setLoading(false); setMsg("Couldn't load templates."); });
  }, []);

  function saveColor(c: string) {
    setHeaderColor(c);
    fetch("/api/email-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ setting: "header_color", value: c }) });
  }

  function pick(t: Tpl) {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (dirty) void save();            // flush this template's pending edits before switching away
    setSel(t.id);
    setDraft({ subject: t.subject, body: (t.body || []).join("\n\n"), cta: t.cta || "" });
    setDirty(false);
    setMsg("");
  }

  // Any field edit flags the draft dirty; the debounced effect below auto-saves it.
  const edit = (patch: Partial<typeof draft>) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); };

  const cur = tpls.find((t) => t.id === sel);
  const paras = draft.body.split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
  const phases = Array.from(new Set(tpls.map((t) => t.phase)));

  async function save() {
    setMsg("Saving…");
    try {
      const r = await fetch("/api/email-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: sel, subject: draft.subject, body: paras, cta: draft.cta }) });
      const d = await r.json().catch(() => ({} as any));
      if (r.ok && d.ok) {
        setTpls((p) => p.map((t) => t.id === sel ? { ...t, subject: draft.subject, body: paras, cta: draft.cta } : t));
        setDirty(false);
        setMsg("Saved ✓");
        return true;
      }
      setMsg("Save failed: " + (d.error || `HTTP ${r.status}`));
      return false;
    } catch {
      // The old version had no catch — a thrown fetch/JSON error left "Saving…" stuck forever.
      setMsg("Save failed — couldn't reach the server (your text is safe; it retries on the next edit).");
      return false;
    }
  }

  // Debounced auto-save — persists ~0.9s after the last keystroke, so there's no Save button to remember.
  useEffect(() => {
    if (!dirty || !sel) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void save(); }, 900);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [draft, dirty, sel]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendTest() {
    setMsg("Saving + sending…");
    if (!(await save())) return;
    const r = await fetch("/api/email-send-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: sel }) });
    const d = await r.json();
    setMsg(d.ok ? `Sent to ${d.sent_to} ✓ — check your inbox` : "Send failed: " + (d.error || ""));
  }

  const stMeta = cur ? (STATUS_META[cur.status] || STATUS_META.new) : STATUS_META.new;

  return (
    <div ref={rootRef} style={{ minHeight: embedded ? "auto" : "100vh", background: embedded ? "transparent" : "var(--bg)", color: "var(--text)", padding: embedded ? "4px 0 40px" : "210px 16px 64px", maxWidth: "100%", overflowX: "hidden" }}>
      <div style={{ maxWidth: embedded ? "none" : 1180, margin: "0 auto", minWidth: 0 }}>
        {/* admin-native header (not a website hero) */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
          <h3 style={{ ...cardH, margin: 0 }}>Lifecycle Emails</h3>
          <span style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "#6f7187" }}>{tpls.length} templates · auto-saves</span>
        </div>
        <p style={{ color: "#8d8fa6", fontSize: 13, margin: "0 0 18px" }}>
          Every email a customer gets. Edit inline — it auto-saves. “Send to my inbox” renders the real thing. These become the live emails.
        </p>

        {loading ? <p style={{ color: "#8d8fa6" }}>Loading…</p> : (
          <>
            {/* template picker — compact grouped dropdown, fully responsive */}
            <div style={{ ...card, marginBottom: 16 }}>
              <label style={lbl}>Template</label>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <select value={sel} onChange={(e) => { const t = tpls.find((x) => x.id === e.target.value); if (t) pick(t); }}
                  style={{ ...field, ...selectChevron, flex: "1 1 240px" }}>
                  {phases.map((ph) => (
                    <optgroup key={ph} label={ph}>
                      {tpls.filter((m) => m.phase === ph).map((m) => (
                        <option key={m.id} value={m.id}>{m.label} — {(STATUS_META[m.status] || STATUS_META.new).label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {cur && <span style={{ padding: "3px 10px", borderRadius: 99, background: stMeta.bg, color: stMeta.fg, fontWeight: 600, fontSize: 12, flexShrink: 0 }}>{stMeta.label}</span>}
              </div>
              {cur && (
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 12, fontSize: 12.5, color: "#8d8fa6" }}>
                  <span><b style={{ color: "#c4c5d2" }}>When:</b> {cur.timing}</span>
                  <span><b style={{ color: "#c4c5d2" }}>Trigger:</b> {cur.trigger}</span>
                </div>
              )}
            </div>

            {/* editor + preview */}
            {cur && (
              <div style={{ display: "grid", gridTemplateColumns: stackPanes ? "1fr" : "minmax(300px, 400px) minmax(0, 1fr)", gap: 16, alignItems: "start", minWidth: 0 }}>
                {/* edit card */}
                <div style={card}>
                  <h3 style={cardH}>Edit</h3>
                  <label style={lbl}>Subject</label>
                  <input style={{ ...field, marginBottom: 16 }} value={draft.subject} onChange={(e) => edit({ subject: e.target.value })} />

                  <label style={lbl}>Body — one paragraph per blank line · <span style={{ textTransform: "none", letterSpacing: 0 }}>&lt;strong&gt; allowed</span></label>
                  <textarea style={{ ...field, minHeight: 220, marginBottom: 16, resize: "vertical" }} value={draft.body} onChange={(e) => edit({ body: e.target.value })} />

                  <label style={lbl}>Button text (blank = no button)</label>
                  <input style={{ ...field, marginBottom: 18 }} value={draft.cta} onChange={(e) => edit({ cta: e.target.value })} />

                  <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <button onClick={sendTest} style={{ padding: "9px 18px", background: "#b9a8ee", color: "#2a2b37", border: "none", borderRadius: 6, fontWeight: 600, fontSize: 13.5, cursor: "pointer" }}>Send to my inbox →</button>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: dirty ? "#f59e0b" : "#4ade80" }}>
                      {dirty ? "Auto-saving…" : "Saved ✓"}
                    </span>
                    {msg && <span style={{ fontSize: 12.5, color: "#c9bbf0" }}>{msg}</span>}
                  </div>
                </div>

                {/* live preview card — realistic inbox view inside an admin card */}
                <div style={card}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap" }}>
                    <h3 style={{ ...cardH, margin: 0 }}>What the customer receives</h3>
                    <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                      <span style={{ ...lbl, margin: 0 }}>Header</span>
                      <input type="color" value={headerColor} onChange={(e) => saveColor(e.target.value)} style={{ width: 30, height: 26, border: "none", background: "none", cursor: "pointer", padding: 0 }} />
                      <input value={headerColor} onChange={(e) => saveColor(e.target.value)} style={{ ...field, width: 96, fontFamily: "monospace", padding: "5px 8px", fontSize: 12 }} />
                    </div>
                  </div>
                  {/* inbox backdrop — white, exactly as the customer sees it (locked light, dark-mode-proof) */}
                  <div style={{ background: "#ffffff", borderRadius: 10, padding: stackPanes ? "16px 12px" : "24px 20px", border: "1px solid #3d3f4e", maxHeight: stackPanes ? 560 : "calc(100vh - 260px)", overflowY: "auto", minWidth: 0 }}>
                    {/* the email at its true 560px width */}
                    <div style={{ width: "100%", maxWidth: 560, margin: "0 auto", background: "#fff", color: "#1c1c28", borderRadius: 14, overflow: "hidden", border: "1px solid #ededf3" }}>
                      {/* inbox meta line */}
                      <div style={{ padding: "16px 30px 12px", borderBottom: "1px solid #efeff4" }}>
                        <div style={{ color: "#1a1a22", fontWeight: 700, fontSize: 14 }}>Verigent</div>
                        <div style={{ color: "#1c1c28", fontSize: 17, fontWeight: 600, margin: "4px 0 2px", lineHeight: 1.3 }}>{draft.subject || "(no subject)"}</div>
                        <div style={{ color: "#9298ad", fontSize: 12 }}>to you · just now</div>
                      </div>
                      {/* header bar (matches renderLifecycleEmail) */}
                      <div style={{ background: headerColor, padding: "22px 44px" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/verigent-logo.png" alt="Verigent" height={12} style={{ height: 12, display: "block" }} />
                      </div>
                      {/* body — matches the real ~80px top spacing */}
                      <div style={{ padding: "64px 44px 40px" }}>
                        {paras.map((p, i) => p.trim() === "{{SCORECARD}}" ? (
                          <div key={i} style={{ margin: "6px 0 20px", border: "1px solid #e6e4f0", borderRadius: 12, background: "#faf9fd", padding: "18px 20px" }}>
                            <div style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "#8a86a8", fontWeight: 700 }}>Atlas · verification</div>
                            <div style={{ fontSize: 34, fontWeight: 800, color: "#1c1c28", lineHeight: 1, margin: "5px 0 2px" }}>84<span style={{ fontSize: 13, fontWeight: 700, color: "#7a5fc0", marginLeft: 8 }}>V4 · Master</span></div>
                            <div style={{ fontSize: 11, letterSpacing: ".05em", textTransform: "uppercase", color: "#c0392b", fontWeight: 800, margin: "14px 0 2px" }}>Weakest right now — fix these</div>
                            {([["Security", 41], ["Tool Use", 52], ["Context Handling", 58]] as [string, number][]).map(([d, s]) => (
                              <div key={d} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 14 }}>
                                <span style={{ color: "#3a3a48" }}>{d}</span>
                                <span style={{ color: "#c0392b", fontWeight: 800 }}>{s}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p key={i} style={{ fontSize: 15, lineHeight: 1.65, margin: "0 0 18px", color: "#2a2b37" }} dangerouslySetInnerHTML={{ __html: p }} />
                        ))}
                        {draft.cta && <a style={{ display: "inline-block", margin: "12px 0", padding: "13px 30px", background: "#7a5fc0", color: "#fff", borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: "none" }}>{draft.cta} →</a>}
                        <hr style={{ border: "none", borderTop: "1px solid #e2e2ec", margin: "32px 0 14px" }} />
                        <p style={{ fontSize: 11.5, color: "#94a3b8", margin: 0 }}>Verigent — independent verification for AI agents.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default EmailEditor;
