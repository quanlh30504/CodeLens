/**
 * Permissions the CodeLens GitHub App may hold for Feature 001 (spec FR-032, FR-039, SC-014).
 * Must equal the table in deploy/github-app-registration.md and ADR-006 as amended.
 * Every entry is read-only; there is deliberately no way to allow "write" or "admin".
 *
 * `members: read` (organization membership, for owner verification) is added here only after the
 * T008 spike confirms the exact permission and a human records it in ADR-006 (T009, gate G1).
 */
export const ALLOWED_PERMISSIONS: Readonly<Record<string, 'read'>> = Object.freeze({
  metadata: 'read',
});
