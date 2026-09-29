# Research: GitHub App Installation and Repository Onboarding

The stack (NestJS, Next.js, PostgreSQL, Redis + BullMQ, Docker Compose on EC2, GitHub App) is fixed by the ADRs and the plan input. This document records the feature-level decisions that remain. Trade-offs that favor safety over convenience are marked **[Security trade-off]** (Principle XVII).

## R1. Sign-in mechanism

- **Decision**: Use the GitHub App's own user authorization flow (user-to-server token) for sign-in. At login, read the user's stable numeric ID, profile, and the list of installations the user can access. Then discard the user token.
- **Rationale**: Keeps GitHub App as the single integration (Principle I). A user-to-server token is limited to what both the user and the app can access, and it lets CodeLens ask GitHub which installations this user may see, so GitHub stays authoritative (FR-006, FR-010).
- **Alternatives**: A separate OAuth App (a second GitHub integration, broader scopes); personal access tokens (rejected by the constitution).
- **[Security trade-off]** Not storing the user token means membership is only refreshed at sign-in (and on the "Refresh access" action), not continuously. Accepted; sessions are short (R3).

## R2. Installation initiation and callback

- **Decision**: "Install" redirects to GitHub's installation page for the app with a `state` value that is random, single-use, bound to the session, and expires in 10 minutes. The setup callback checks `state`, then confirms with a fresh user credential that the returned installation ID is in the user's accessible installations. The app is configured to request user authorization during installation, so GitHub returns a one-time `code` (optional in the contract) that the callback exchanges for a short-lived user credential, used once and discarded. If `code` is absent, the callback stores nothing and redirects through the sign-in authorization flow, then resumes; an installation is never linked without that confirmation. Only then does it fetch the installation from GitHub (app JWT), upsert it, enqueue a sync, and redirect to the installation page.
- **Rationale**: The installation ID in a callback URL is attacker-controllable. Verifying it against GitHub before linking prevents a user from attaching someone else's installation (FR-009, FR-020).
- **Alternatives**: Trusting the callback ID (insecure); waiting for the webhook only (slower, and the UI cannot show "setting up").
- **Note**: Callback and webhook both perform the same idempotent upsert, so their order does not matter (FR-030).

## R3. Sessions

- **Decision**: Opaque random session ID in an httpOnly, Secure, SameSite=Lax cookie; session data in Redis with AOF persistence; 12-hour absolute lifetime, 2-hour idle timeout. State-changing requests require a CSRF token. The browser only talks to the API through Nginx on the same origin.
- **Rationale**: No token ever reaches JavaScript (FR-034, SC-010). Redis is already in the stack (ADR-015).
- **Alternatives**: JWT in cookie (harder to revoke); database sessions (extra table and load, not needed at MVP scale).
- **[Security trade-off]** Short sessions cost some convenience (re-login) but bound how long a removed member keeps access (spec US6 scenario 3).

## R4. Authorization model and roles

- **Decision**: `AuthorizationContext` = { userId, memberships: [{organizationId, role, roleVerifiedAt}] } resolved by a guard on every request. Roles are `OWNER` and `MEMBER` and are derived from GitHub (spec FR-035 to FR-039), never from who installed the app.
  - At sign-in and on "Refresh access", the user token is used to read the user's installations and, per organization, the user's membership role (GitHub reports `admin` for organization owners; for a personal account the account holder is the owner). Results are stored with `roleVerifiedAt`.
  - Management actions (enable, disable, sync) require `roleVerifiedAt` within 10 minutes. If older, the API answers `403` with code `REAUTH_REQUIRED`; the web app sends the user through GitHub authorization again (silent when GitHub still holds their grant) and retries. The user token is used only during that exchange and is not stored.
  - Validity of a confirmation (spec FR-036): viewing uses the membership confirmed at sign-in or refresh for the life of the session (12 hours at most); management requires a confirmation no older than 10 minutes. The permission matrix is spec FR-040.
  - If GitHub is unreachable or gives no definite answer, the action is refused (`503`, `ROLE_UNVERIFIABLE`); no stored role is trusted.
  - Out-of-scope resources return `404`.
- **Rationale**: A stored or installer-based role goes stale (removed owners, delegated app managers). Re-checking on use makes GitHub the authority and bounds how long a demoted owner keeps rights to 10 minutes.
- **Required GitHub permission (to verify in a spike before implementation)**: The membership-role call is expected to need read-only "Organization members" access for the app. GitHub's public reference for the endpoint does not state the permission, so confirm against a test app. If needed, amend ADR-006 (read-only; no write added) before implementation.
- **Alternatives**: Installer-as-owner (rejected: stale and wrong for delegated managers); store the user token and refresh it (rejected: long-lived credential at rest); treat all installation-access users as managers (rejected: weak).
- **[Security trade-off]** Extra GitHub round trips and an occasional re-authorization step when managing repositories, in exchange for never acting on a stale role and never storing user tokens. A GitHub outage blocks management (fail closed) but not viewing.

## R5. Webhook authenticity

- **Decision**: Capture the raw request body, compute HMAC-SHA-256 with the webhook secret, compare to the `X-Hub-Signature-256` header in constant time, and reject before parsing on mismatch or absence. Require the event and delivery headers. Rejections are logged (delivery ID if present, source address hash, reason) without body or secrets and counted as a metric; no database row is written for rejected requests.
- **Rationale**: FR-028, SC-004. Not writing rows for rejected requests prevents storage abuse.
- **Alternatives**: Parsing first (breaks signature over raw bytes); IP allow-listing alone (not authentication).

## R6. Idempotency and ordering

- **Decision**:
  1. `webhook_deliveries.delivery_guid` is unique. Insert-or-ignore; a repeat delivery is acknowledged and not re-enqueued.
  2. Every event handler enqueues a **reconcile** job for the installation and never trusts the payload as the new state. The reconcile reads authoritative state from GitHub.
  3. BullMQ job IDs are deterministic (`reconcile:<githubInstallationId>`), so identical pending jobs collapse.
  4. A PostgreSQL advisory lock per installation serializes the write phase of reconcile and sync.
- **Rationale**: Out-of-order and duplicate events converge to the same final state (FR-029, FR-030, SC-005, SC-006).
- **Alternatives**: Event-sourced state machine per action (fragile with out-of-order delivery); trusting payload deltas (order-dependent).
- **Uninstall exception**: An `installation.deleted` event cannot be reconciled by reading GitHub (the installation is gone, and the app JWT call returns not found). The reconcile treats "not found" as authoritative removal. A suspended-state event is reconciled from the same call.

## R7. Repository sync algorithm

- **Decision**: Obtain an installation token (short-lived, held in memory only), page through the installation's repositories, then in one transaction: upsert each repository by `github_repository_id`; update name, owner, default branch, visibility; mark repositories missing from the result as `INACCESSIBLE` and set `review_enabled = false`; keep new repositories `review_enabled = false`; write `last_synced_at`. If any page fetch fails, abort before the transaction so nothing partial is stored, mark the installation `sync_status = FAILED`, and allow retry (FR-017).
- **Determinism**: Results are keyed by GitHub's stable ID, not by name, so renames update in place and repeated runs make no changes (SC-006).
- **Transfer and overlap rule** (spec FR-013, Edge Cases): GitHub gives each repository one owning account, so two installations report the same repository only transiently during a transfer. When installation B reports a repository held by installation A, the sync asks GitHub (A's installation token) whether A still has access. If not, the single `repositories` row (its GitHub ID is unique in the ERD) is reassigned to B's organization and installation with `review_enabled = false`, `enabled_at` and `enabled_by_user_id` cleared; A's audit entries stay in A's organization. If A still has access, A keeps it, B does not list it, `sync_conflict` is set and a warning is logged for operators. `sync_conflict` is never exposed through the API, so neither tenant learns about the other.
- **Alternatives**: Delete-and-reinsert (loses history and IDs); applying `installation_repositories` deltas (order-dependent). Surfacing conflicts to users was rejected because it reveals another tenant's use of the repository.

## R8. Eligibility gate for future review features

- **Decision**: A single domain function `isReviewEligible(repositoryId)` returns true only if the repository is `ACCESSIBLE`, `review_enabled`, and its installation is `ACTIVE`. It lives in the backend and reads current state on each call. Future review-processing code must call it before starting work.
- **Rationale**: FR-022, SC-008: disabling takes effect immediately because nothing is cached.
- **Alternatives**: Duplicating the checks in each consumer (drift risk); caching (delays revocation).

## R9. Secrets

- **Decision**: A `SecretProvider` interface with an environment/mounted-file implementation for the MVP. The GitHub App private key, webhook secret, client secret and session secret are supplied as environment variables or files under a root-owned, mode-0400 directory outside the build context, and are never in Git or image layers. `deploy/env.example` lists names only. A logging redaction list covers these names and `Authorization` headers.
- **Rationale**: ADR-008 and Principle XI; leaves a path to AWS Secrets Manager without touching business code.

## R10. Testing without real GitHub

- **Decision**: A small fake GitHub HTTP server in `test/fakes` implements only the calls this feature uses (app installation lookup, installation token, installation repositories, user installations, OAuth exchange). Payload builders sign fixtures with a test webhook secret. Integration tests run the real API and worker against PostgreSQL and Redis containers.
- **Rationale**: Principle XII, SC-011.

## R11. Frontend approach

- **Decision**: Next.js App Router pages fetch from the API on the server with the user's session cookie forwarded; interactive parts (toggle, retry, "setting up" polling every 3 s with a 2-minute cap) are client components calling the same-origin API. Toggles use optimistic UI that reverts on failure.
- **Alternatives**: Server-sent events or WebSocket for setup progress (unneeded complexity at MVP).

## R12. Observability

- **Decision**: pino JSON logs with `deliveryId`, `githubInstallationId`, `jobId`, `organizationId` fields; a redaction list; no webhook bodies. Counters: deliveries received/rejected/duplicate, sync duration, sync failures.
- **Rationale**: Principle XIII; a review ID does not exist yet, so the delivery and job IDs are the traceability keys for this feature.

## R13. Migrations

- **Decision**: Prisma schema with committed SQL migrations applied at deploy time; unique indexes, partial indexes and check constraints written in migration SQL where the schema language cannot express them. No manual production changes (Principle XIV).
- **Alternatives**: TypeORM migrations (also viable; Prisma chosen for typed queries and reviewable SQL).
