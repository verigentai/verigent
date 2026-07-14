// Website derive layer for the CANONICAL test-run duration. Re-exports the backend-owned source
// (functions/lib/test-duration.ts) so pages import via "@/lib/duration" and can never restate a
// hardcoded duration. Mirrors the src/lib/dimensions.ts pattern. See docs/CANONICAL.md.
export * from "../../functions/lib/test-duration";
