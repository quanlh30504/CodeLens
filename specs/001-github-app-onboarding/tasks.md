---

description: "Task list for Feature 001: GitHub App Installation and Repository Onboarding"
---

# Tasks: GitHub App Installation and Repository Onboarding

**Input**: Design documents from `/specs/001-github-app-onboarding/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.openapi.yaml, contracts/webhooks.md, quickstart.md

**Tests**: Included. Constitution Principle XII requires unit and integration coverage for security-sensitive and state-changing functionality, and webhook processing testable without real GitHub. Test tasks come before the implementation they cover within each story.

**Organization**: Tasks are grouped by user story. Story order follows priority and real dependencies: US1 → US2 → US5 → US6 (all P1), then US3 → US4 (both P2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 to US6 as numbered in spec.md
- File paths are relative to the repository root

## Path Conventions

Web application per plan.md: `backend/src/`, `backend/test/`, `backend/prisma/`, `frontend/src/`, `frontend/tests/`, `deploy/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Repository skeleton and the prerequisites that gate later work.

- [ ] T001 Create the layout from plan.md: `backend/`, `frontend/`, `deploy/` with `backend/src/{config,auth,tenancy,github,installations,repositories,audit,queue,observability}/`, `backend/test/{unit,integration,contract,fakes}/`
- [ ] T002 Initialize the NestJS TypeScript (strict) backend in `backend/package.json` and `backend/tsconfig.json` with Prisma, BullMQ, Octokit (app auth and webhooks), pino, zod, Jest, Supertest
- [ ] T003 [P] Initialize the Next.js (App Router) React TypeScript frontend in `frontend/package.json` and `frontend/tsconfig.json` with Playwright
- [ ] T004 [P] Configure linting and formatting for both apps in `backend/eslint.config.mjs`, `frontend/eslint.config.mjs`, `.prettierrc`
- [ ] T005 [P] Add `deploy/env.example` listing variable names only (no values): GitHub App ID, client ID, client secret, private key file path, webhook secret, session secret, database URL, Redis URL; add `.gitignore` entries for `.env*` and key files
- [ ] T006 [P] Add a secret-scanning check that fails on private-key or secret patterns, in `.github/workflows/secret-scan.yml` (supports FR-033, SC-010)
- [ ] T007 Spike (document only): with a throwaway GitHub App, confirm which read-only permission the organization-membership role call needs for a GitHub App user token; record the result in `specs/001-github-app-onboarding/research.md` under R4
- [ ] T008 Amend `docs/adr/0001-architecture.md` ADR-006 to list the read-only permission found in T007 (no write added), per Constitution Principle XV. **Blocks T071 and T086** (role verification)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Infrastructure every story needs. No user story work starts before this phase is complete.

**⚠️ CRITICAL**

### Database

- [ ] T009 Create `backend/prisma/schema.prisma` for the tables this feature uses from `docs/architecture/database-erd.md` (with Amendment 1): `users`, `organizations`, `organization_members`, `github_installations`, `repositories`, `audit_logs`, `webhook_deliveries`. Keep the baseline uniques verbatim: `users.github_user_id UNIQUE`, `organizations.github_org_id UNIQUE`, `github_installations.github_installation_id UNIQUE`, `repositories.github_repository_id UNIQUE`, `repositories.full_name UNIQUE`
- [ ] T010 Create the initial SQL migration in `backend/prisma/migrations/0001_onboarding_baseline/migration.sql` with all foreign keys from the ERD, and these constraints verbatim: `webhook_deliveries.delivery_guid UNIQUE`; `organization_members(organization_id, user_id) UNIQUE`; check `repositories: review_enabled = false OR status = 'ACCESSIBLE'`; value checks: `github_installations.status` in (`ACTIVE`,`SUSPENDED`,`REMOVED`), `github_installations.sync_status` in (`PENDING`,`SYNCING`,`SYNCED`,`FAILED`), `github_installations.repository_selection` in (`ALL`,`SELECTED`), `repositories.status` in (`ACCESSIBLE`,`INACCESSIBLE`), `organizations.account_type` in (`ORGANIZATION`,`USER`), `organization_members.role` in (`OWNER`,`MEMBER`), `webhook_deliveries.status` in (`RECEIVED`,`PROCESSED`,`IGNORED`,`FAILED`)
- [ ] T011 Add indexes in the same migration file: ERD §17 indexes for the tables above plus `repositories(installation_id, status)` and `webhook_deliveries(github_installation_id, received_at)`
- [ ] T012 [P] Write a migration test asserting each constraint in T010 and T011 rejects invalid data, in `backend/test/integration/schema-constraints.spec.ts`

### Configuration, secrets, logging

- [ ] T013 [P] Implement typed environment config with zod validation (fail fast on missing values) in `backend/src/config/config.module.ts`
- [ ] T014 [P] Implement the `SecretProvider` interface and an environment/mounted-file implementation in `backend/src/config/secret-provider.ts`; no secret value may be returned by any public method other than the one that hands it to the GitHub client and the signature verifier
- [ ] T015 [P] Implement pino structured logging with a redaction list (private key, webhook secret, client secret, session secret, `Authorization`, cookies, tokens) and correlation fields `deliveryId`, `githubInstallationId`, `jobId`, `organizationId` in `backend/src/observability/logger.ts`
- [ ] T016 [P] Unit test that redaction removes every listed secret name from log output, in `backend/test/unit/logger-redaction.spec.ts`
- [ ] T017 [P] Implement a global exception filter that returns the `Error` shape from `contracts/api.openapi.yaml` and never includes stack traces or upstream GitHub text, in `backend/src/observability/error.filter.ts`

### Sessions, authorization context, tenancy

- [ ] T018 Implement the server-side session store (opaque ID in an httpOnly, Secure, SameSite=Lax cookie named `codelens_session`; data in Redis; 12-hour absolute and 2-hour idle limits) in `backend/src/auth/session.service.ts`
- [ ] T019 [P] Implement CSRF protection for state-changing routes (`X-CSRF-Token` header) in `backend/src/auth/csrf.guard.ts`
- [ ] T020 Implement `AuthorizationContext` ({userId, memberships: [{organizationId, role, roleVerifiedAt}]}) and the guard that resolves it on every authenticated request in `backend/src/auth/authorization-context.ts` and `backend/src/auth/session.guard.ts`
- [ ] T021 Implement the tenant-scoped data-access base class whose every method requires an `AuthorizationContext` or an explicit system context, and whose out-of-scope reads return "not found", in `backend/src/tenancy/tenant-scoped.repository.ts`
- [ ] T022 [P] Unit tests for session limits, CSRF rejection and context resolution in `backend/test/unit/auth-foundation.spec.ts`

### Queue and GitHub client

- [ ] T023 Set up BullMQ queues and a worker entry point (same image as the API) with deterministic job IDs and exponential backoff (up to 5 attempts) in `backend/src/queue/queue.module.ts` and `backend/src/worker.ts`
- [ ] T024 Implement the read-only GitHub App client: app JWT creation, installation token (in memory only, never logged or persisted), get installation, list installation repositories with pagination, in `backend/src/github/github-app.client.ts`. No write method may exist on this class
- [ ] T025 [P] Implement audit logging (`audit_logs` writer; actions per data-model.md; rejects any metadata key that matches the secret redaction list) in `backend/src/audit/audit.service.ts`

### Test harness and deployment skeleton

- [ ] T026 Build the fake GitHub server implementing only the calls this feature uses (user authorization exchange, user profile, user installations, organization membership role, app installation lookup, installation token, installation repositories) with scripted failures and pagination in `backend/test/fakes/fake-github.ts`
- [ ] T027 [P] Build signed webhook payload builders and fixtures for each event in `contracts/webhooks.md` (using a test-only secret) in `backend/test/fakes/webhook-fixtures.ts`
- [ ] T028 Set up the integration-test harness starting PostgreSQL and Redis containers, applying migrations, and booting API and worker against the fake GitHub, in `backend/test/integration/harness.ts`
- [ ] T029 [P] Create `deploy/docker-compose.yml` (Nginx, web, api, worker, PostgreSQL, Redis; private key mounted read-only from a host path, not from the build context) and `deploy/nginx/default.conf` routing `/api` to the API and everything else to the web app on one origin
- [ ] T030 [P] Scaffold the typed same-origin API client (cookie-based, CSRF header, no token storage) in `frontend/src/lib/api-client.ts`

**Checkpoint**: Foundation ready. User story work can begin.

---

## Phase 3: User Story 1 - Sign in with GitHub (Priority: P1) 🎯 MVP

**Goal**: A person signs in with GitHub, gets or reuses one CodeLens account, and never handles a token.

**Independent Test**: Sign in with a new fake GitHub user, confirm an account exists and is linked to their GitHub ID; sign in again and confirm the same account; rename them on the fake and confirm the login updates.

### Tests for User Story 1

- [ ] T031 [P] [US1] Contract test for `/auth/github/login`, `/auth/github/callback`, `/auth/logout`, `/me` against `contracts/api.openapi.yaml` in `backend/test/contract/auth.contract.spec.ts`
- [ ] T032 [P] [US1] Integration test: first sign-in creates one user; second reuses it; renamed login updates the same row; denied/cancelled sign-in creates nothing and returns the error redirect; unauthenticated requests get 401 with no tenant data (US1 scenarios 1 to 5) in `backend/test/integration/sign-in.spec.ts`
- [ ] T033 [P] [US1] Integration test asserting no GitHub user token, client secret or session secret appears in any response body, header (other than the httpOnly cookie) or log line during sign-in (FR-034, SC-010) in `backend/test/integration/sign-in-secrets.spec.ts`

### Implementation for User Story 1

- [ ] T034 [US1] Implement the GitHub App user-authorization redirect with a single-use, session-bound `state` (random, expires in 10 minutes, stored in Redis) in `backend/src/auth/github-login.controller.ts`
- [ ] T035 [US1] Implement the callback: exchange the code, read the GitHub user's numeric ID and profile, upsert `users` by `github_user_id`, set `last_login_at`, create the session, then discard the user token, in `backend/src/auth/github-login.service.ts`
- [ ] T036 [US1] Implement `GET /me`, `POST /auth/logout` (revoke session server-side) in `backend/src/auth/me.controller.ts`
- [ ] T037 [P] [US1] Build the sign-in page and denied-sign-in message in `frontend/src/app/(public)/sign-in/page.tsx`
- [ ] T038 [P] [US1] Build the authenticated layout with redirect-to-sign-in for unauthenticated visitors in `frontend/src/app/(app)/layout.tsx`

**Checkpoint**: Sign-in works end to end and is independently testable.

---

## Phase 4: User Story 2 - Install the CodeLens GitHub App and see the installation (Priority: P1)

**Goal**: A signed-in user installs the app on GitHub and then sees the installation, its organization, and its repositories.

**Independent Test**: Sign in, start install, complete it on the fake GitHub selecting 3 of 5 repositories, return to CodeLens; the installation and exactly those 3 repositories appear, all disabled.

### Tests for User Story 2

- [ ] T039 [P] [US2] Contract tests for `/installations/new`, `/installations/callback`, `/installations`, `/installations/{installationId}`, `/installations/{installationId}/repositories` in `backend/test/contract/installations.contract.spec.ts`
- [ ] T040 [P] [US2] Integration test: install callback with valid state and user-accessible installation ID creates organization, installation and repositories via sync; "all" and "selected" selections; zero repositories; abandoned flow shows nothing (US2 scenarios 1 to 6) in `backend/test/integration/install-flow.spec.ts`
- [ ] T041 [P] [US2] Security test: callback with a reused, expired or other-session `state` returns 400; callback with an installation ID the fake GitHub does not list for that user returns 404 and links nothing (FR-009, research R2) in `backend/test/integration/install-callback-security.spec.ts`
- [ ] T042 [P] [US2] Integration test for repository sync: upsert by GitHub repository ID, rename in place, visibility change, missing repositories marked `INACCESSIBLE` with `review_enabled = false`, new repositories `review_enabled = false`, 10 consecutive runs produce zero changes after the first (FR-011 to FR-015, SC-006) in `backend/test/integration/repository-sync.spec.ts`
- [ ] T043 [P] [US2] Integration test: sync of a 500-repository fake completes and is fully listed in under 2 minutes; a failing page fetch leaves prior data untouched and sets `sync_status = FAILED` with an error code only (FR-017, SC-003) in `backend/test/integration/repository-sync-scale-failure.spec.ts`

### Implementation for User Story 2

- [ ] T044 [US2] Implement organization upsert keyed by `github_org_id` (personal accounts stored with `account_type = USER`) in `backend/src/tenancy/organizations.service.ts`
- [ ] T045 [US2] Implement the install redirect with single-use `state` in `backend/src/github/install/install.controller.ts`
- [ ] T046 [US2] Implement the setup callback: validate `state`, confirm with the user's fresh authorization that the installation ID is among the user's accessible installations, fetch the installation via app JWT, run `reconcileInstallation`, enqueue sync, redirect to the installation page, in `backend/src/github/install/install-callback.service.ts`
- [ ] T047 [US2] Implement `reconcileInstallation` (idempotent upsert of installation and organization from GitHub; `status` ACTIVE/SUSPENDED/REMOVED; `repository_selection`; not-found from GitHub means removal) in `backend/src/installations/reconcile.service.ts`
- [ ] T048 [US2] Implement the repository sync job: page through the installation's repositories using an in-memory installation token, then in one transaction upsert by `github_repository_id`, mark missing ones `INACCESSIBLE` with `review_enabled = false`, keep new ones `review_enabled = false`, apply the two-installation conflict rule (`sync_conflict`), set `last_synced_at`; serialize per installation with a PostgreSQL advisory lock; job ID `sync:<githubInstallationId>`, in `backend/src/repositories/sync.service.ts` and `backend/src/repositories/sync.processor.ts`
- [ ] T049 [US2] Implement `sync_status` transitions PENDING → SYNCING → SYNCED | FAILED and `sync_error_code` (codes only, never GitHub text) in `backend/src/installations/installation-sync-status.ts`
- [ ] T050 [US2] Implement the read endpoints (`GET /installations`, `GET /installations/{installationId}`, `GET /installations/{installationId}/repositories` with `q`, `state`, `cursor`, `limit`), all through the tenant-scoped repository, in `backend/src/installations/installations.controller.ts`
- [ ] T051 [US2] Write audit entry `GITHUB_INSTALLATION_ADDED` exactly once per new installation in `backend/src/installations/installation-audit.ts`
- [ ] T052 [P] [US2] Build the installations list and "Install CodeLens" action in `frontend/src/app/(app)/installations/page.tsx`
- [ ] T053 [P] [US2] Build the installation detail page (Installation → Organization → Repositories) with search, pagination, state labels, empty-list explanation and sync-failed banner in `frontend/src/app/(app)/installations/[id]/page.tsx`
- [ ] T054 [US2] Build the "setting up" state that polls every 3 seconds up to 2 minutes, then shows a timeout message with a retry action, in `frontend/src/components/installation-setup-status.tsx`

**Checkpoint**: A user can install and see repositories. This plus US1 is the demonstrable core.

---

## Phase 5: User Story 5 - Reject forged and duplicate events (Priority: P1)

**Goal**: Only authentic events are accepted, and each real event takes effect once.

**Independent Test**: Post a bad-signature fixture and see 401 with no change; post one valid fixture ten times (some concurrently) and see state equal to one delivery.

### Tests for User Story 5

- [ ] T055 [P] [US5] Contract test for `POST /webhooks/github` responses (202, 400, 401) in `backend/test/contract/webhook.contract.spec.ts`
- [ ] T056 [P] [US5] Integration test: missing, wrong, malformed and body-modified signatures all return 401, write no row in any table, and log a rejection with no body or secret (FR-028, SC-004) in `backend/test/integration/webhook-signature.spec.ts`
- [ ] T057 [P] [US5] Integration test: same delivery 10 times, and two concurrent identical deliveries, yield one installation, one repository set and one audit entry (FR-029, SC-005) in `backend/test/integration/webhook-idempotency.spec.ts`
- [ ] T058 [P] [US5] Integration test: out-of-order sequences (repositories event before installation event; deleted before created; late duplicate) converge to the fake GitHub's current state (FR-030) in `backend/test/integration/webhook-ordering.spec.ts`
- [ ] T059 [P] [US5] Integration test: event for an installation with no linked user is stored and visible only to users later verified for that account (US5 scenario 5); acknowledgement stays under 2 seconds p95 while sync work is queued (FR-031) in `backend/test/integration/webhook-unknown-installation.spec.ts`

### Implementation for User Story 5

- [ ] T060 [US5] Capture the raw request body for the webhook route in `backend/src/main.ts` and `backend/src/github/webhook/raw-body.middleware.ts`
- [ ] T061 [US5] Implement constant-time verification of `X-Hub-Signature-256` over the raw body before any parsing; reject with 401 and a metric plus structured log (reason, delivery ID if present, hashed source address; no body) in `backend/src/github/webhook/signature.guard.ts`
- [ ] T062 [US5] Implement the webhook controller: require event and delivery headers (400 otherwise), insert `webhook_deliveries` by unique `delivery_guid` (store `payload_sha256` only), return 202 for repeats, otherwise enqueue, in `backend/src/github/webhook/webhook.controller.ts`
- [ ] T063 [US5] Implement event routing per `contracts/webhooks.md`: `installation` created/deleted/suspend/unsuspend → `reconcile:<githubInstallationId>`; `installation_repositories` and `repository` events → `sync:<githubInstallationId>`; anything else → `IGNORED`. Handlers read only the installation ID from the payload, in `backend/src/github/webhook/event-router.ts`
- [ ] T064 [US5] Implement the reconcile queue processor that updates `webhook_deliveries.status` (`PROCESSED`, `FAILED` with `error_code`) and `processed_at`, in `backend/src/installations/reconcile.processor.ts`
- [ ] T065 [US5] Ensure audit entries for installation lifecycle are written on state transitions only, not per delivery, in `backend/src/installations/installation-audit.ts`

**Checkpoint**: Webhooks are authenticated, deduplicated and order-independent.

---

## Phase 6: User Story 6 - See only what I'm authorized to see (Priority: P1)

**Goal**: Users see only their own organizations' installations and repositories, with access and roles derived from GitHub.

**Independent Test**: Two users in different organizations each see only their own data, and each gets 404 when requesting the other's identifiers.

### Tests for User Story 6

- [ ] T066 [P] [US6] Cross-tenant negative suite: for every read and write route in `contracts/api.openapi.yaml`, a user of tenant A gets 404 for tenant B's identifiers, with response bodies identical to a truly missing resource (FR-020, SC-007) in `backend/test/integration/tenant-isolation.spec.ts`
- [ ] T067 [P] [US6] Integration test: membership and role are derived from GitHub at sign-in (organization owner → OWNER, other accessible users → MEMBER, personal account holder → OWNER); a user who belongs to several organizations sees each separately (US6 scenarios 1 and 4) in `backend/test/integration/membership-derivation.spec.ts`
- [ ] T068 [P] [US6] Integration test: a user removed from an organization on the fake GitHub loses access at the next confirmation (sign-in, refresh access, or management action) and not before (US6 scenario 3) in `backend/test/integration/membership-revocation.spec.ts`
- [ ] T069 [P] [US6] Unit test that no tenant-scoped repository method can be called without an `AuthorizationContext` (compile-time and runtime) in `backend/test/unit/tenant-scoped.spec.ts`
- [ ] T070 [P] [US6] Integration test that queue jobs and logs for one tenant never carry another tenant's identifiers and that sync writes only within the installation's organization in `backend/test/integration/tenant-background.spec.ts`

### Implementation for User Story 6

- [ ] T071 [US6] At sign-in, read the user's accessible installations and, per organization, the membership role from GitHub; upsert `organization_members` with `role` and `role_verified_at`; remove memberships GitHub no longer reports, in `backend/src/tenancy/membership-sync.service.ts` (uses the permission from T008)
- [ ] T072 [US6] Implement role mapping: GitHub owner → `OWNER`; other users with installation access → `MEMBER`; personal account holder → `OWNER`; any other GitHub role → `MEMBER`, in `backend/src/tenancy/role-mapper.ts`
- [ ] T073 [US6] Implement `POST /me/refresh-access` (re-authorize with GitHub, then repeat T071) in `backend/src/auth/refresh-access.controller.ts`
- [ ] T074 [US6] Apply the tenant-scoped repository and the session guard to every installation and repository route; return the same 404 for "missing" and "not yours", in `backend/src/installations/installations.controller.ts` and `backend/src/repositories/repositories.controller.ts`
- [ ] T075 [US6] Ensure the worker runs sync and reconcile under an explicit system context that is bound to the installation's organization, in `backend/src/queue/system-context.ts`
- [ ] T076 [P] [US6] Build the organization switcher and show only the caller's organizations in `frontend/src/components/organization-switcher.tsx`

**Checkpoint**: Isolation and GitHub-derived membership are enforced across all P1 stories.

---

## Phase 7: User Story 3 - Enable or disable a repository (Priority: P2)

**Goal**: An owner enables or disables CodeLens review for a repository without uninstalling the app; a disabled or ineligible repository is never processed.

**Independent Test**: As an OWNER, enable a repository (state ENABLED, audit entry), disable it (state DISABLED, app still installed), and confirm the eligibility function follows immediately; as a MEMBER, the same actions are rejected.

### Tests for User Story 3

- [ ] T077 [P] [US3] Contract tests for `PUT /repositories/{repositoryId}/review-enabled` and `POST /installations/{installationId}/sync` including 403 `REAUTH_REQUIRED` and 503 `ROLE_UNVERIFIABLE` in `backend/test/contract/management.contract.spec.ts`
- [ ] T078 [P] [US3] Integration test: new repositories are disabled; OWNER enable/disable works and is idempotent; final toggle wins; audit entries for both actions; MEMBER rejected with state unchanged (US3 scenarios 1 to 4, 9) in `backend/test/integration/enable-disable.spec.ts`
- [ ] T079 [P] [US3] Integration test for role freshness: a role confirmed more than 10 minutes ago yields `REAUTH_REQUIRED`, and after re-confirmation the change is applied; an owner demoted on GitHub is rejected at re-confirmation; GitHub unreachable refuses the request and trusts no stored role; an installer who is not a GitHub owner is rejected (FR-036 to FR-038, US3 scenarios 5 to 8, SC-012) in `backend/test/integration/role-freshness.spec.ts`
- [ ] T080 [P] [US3] Unit and integration tests for the eligibility function: eligible only when `repositories.status = 'ACCESSIBLE'` AND `review_enabled` AND installation `status = 'ACTIVE'`; false for disabled, inaccessible, suspended and removed; reads current state each call (FR-022, SC-008) in `backend/test/integration/review-eligibility.spec.ts`
- [ ] T081 [P] [US3] Test that manual sync is OWNER-only and that repeated requests collapse into one queued job (`ALREADY_QUEUED`) in `backend/test/integration/manual-sync.spec.ts`

### Implementation for User Story 3

- [ ] T082 [US3] Implement the role-freshness guard: management routes require `role_verified_at` within 10 minutes, otherwise respond 403 `REAUTH_REQUIRED`; if GitHub cannot give a definite answer respond 503 `ROLE_UNVERIFIABLE` and never fall back to the stored role, in `backend/src/auth/role-freshness.guard.ts`
- [ ] T083 [US3] Implement `PUT /repositories/{repositoryId}/review-enabled`: OWNER only; set `review_enabled`, `enabled_at`, `enabled_by_user_id`; reject enabling an `INACCESSIBLE` repository with 409; write `REPOSITORY_ENABLED` / `REPOSITORY_DISABLED` audit entries, in `backend/src/repositories/review-enabled.controller.ts` and `backend/src/repositories/review-enabled.service.ts`
- [ ] T084 [US3] Implement `POST /installations/{installationId}/sync` (OWNER only; deterministic job ID so repeats return `ALREADY_QUEUED`) in `backend/src/installations/manual-sync.controller.ts`
- [ ] T085 [US3] Implement `isReviewEligible(repositoryId)` as a single exported domain function reading current state, in `backend/src/repositories/review-eligibility.ts`, and export it for future review features
- [ ] T086 [US3] Re-confirm the caller's role with GitHub on a `REAUTH_REQUIRED` retry and update `role_verified_at`, in `backend/src/tenancy/role-reconfirm.service.ts` (uses the permission from T008)
- [ ] T087 [P] [US3] Build the enable/disable toggle with optimistic update that reverts on failure, read-only display for MEMBER, and the re-confirm-with-GitHub flow on `REAUTH_REQUIRED`, in `frontend/src/components/repository-toggle.tsx`
- [ ] T088 [P] [US3] Add the manual "Sync now" action (OWNER only) with sync status in `frontend/src/components/sync-now-button.tsx`

**Checkpoint**: Owners control which repositories are eligible; the gate is ready for future review features.

---

## Phase 8: User Story 4 - Stay consistent with GitHub after changes (Priority: P2)

**Goal**: CodeLens reflects repository changes, suspension, reinstall and uninstall from GitHub, and stops all review eligibility on uninstall or suspension.

**Independent Test**: With an enabled repository, remove it on the fake GitHub and see it inaccessible and disabled; then send `installation` deleted and see the installation removed and all repositories ineligible within 1 minute.

### Tests for User Story 4

- [ ] T089 [P] [US4] Integration test: repositories added (disabled), removed (inaccessible, disabled, history kept), renamed (same row), transferred, visibility changed (US4 scenarios 1 to 3) in `backend/test/integration/lifecycle-repositories.spec.ts`
- [ ] T090 [P] [US4] Integration test: uninstall marks installation `REMOVED`, sets `removed_at`, all repositories `INACCESSIBLE` and `review_enabled = false`, eligibility false, within 1 minute (FR-024, SC-009) in `backend/test/integration/lifecycle-uninstall.spec.ts`
- [ ] T091 [P] [US4] Integration test: suspend and unsuspend change status and eligibility, each with one audit entry (FR-025, FR-027) in `backend/test/integration/lifecycle-suspend.spec.ts`
- [ ] T092 [P] [US4] Integration test: reinstall creates a new installation row under the same organization, keeps the removed row and history, creates no duplicate organization, repositories start disabled (FR-026) in `backend/test/integration/lifecycle-reinstall.spec.ts`
- [ ] T093 [P] [US4] Integration test: missed event repaired by manual sync; two installations reporting the same repository follow the conflict rule and set `sync_conflict` (US4 scenario 7, research R7) in `backend/test/integration/lifecycle-conflict-resync.spec.ts`

### Implementation for User Story 4

- [ ] T094 [US4] Implement suspension handling in reconcile: status `SUSPENDED` with `suspended_at`, back to `ACTIVE` on unsuspend; audit `GITHUB_INSTALLATION_SUSPENDED` / `GITHUB_INSTALLATION_UNSUSPENDED` once per transition, in `backend/src/installations/reconcile.service.ts`
- [ ] T095 [US4] Implement uninstall handling in reconcile: `REMOVED`, `removed_at`, all repositories `INACCESSIBLE` and `review_enabled = false` in one transaction; audit `GITHUB_INSTALLATION_REMOVED` once, in `backend/src/installations/reconcile.service.ts`
- [ ] T096 [US4] Implement reinstall handling: match the organization by `github_org_id`, create a new `github_installations` row for the new GitHub installation ID, leave the removed row intact, in `backend/src/installations/reconcile.service.ts`
- [ ] T097 [US4] Record `REPOSITORY_SYNC_FAILED` audit entries after the last retry and expose `syncStatus` and `syncErrorCode` to the UI, in `backend/src/repositories/sync.processor.ts`
- [ ] T098 [P] [US4] Show removed and suspended installations, inaccessible repositories and the conflict flag in the UI with their states, in `frontend/src/app/(app)/installations/[id]/page.tsx` and `frontend/src/components/repository-row.tsx`

**Checkpoint**: CodeLens stays consistent with GitHub through every lifecycle change.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end validation and hardening across stories.

- [ ] T099 [P] Add Playwright journeys for sign-in, install, view repositories, enable/disable, and uninstall against the fake GitHub in `frontend/tests/e2e/onboarding.spec.ts`
- [ ] T100 [P] Add a test that fails when any response body, HTML page, or log line in the acceptance suite contains a configured secret value or private-key marker (SC-010) in `backend/test/integration/secret-leak-scan.spec.ts`
- [ ] T101 [P] Add a test that fails if the GitHub client class exposes any write method or if any test double receives a non-GET call to repository, workflow, settings, issue or pull-request endpoints (FR-032) in `backend/test/unit/github-readonly.spec.ts`
- [ ] T102 Run every scenario in `specs/001-github-app-onboarding/quickstart.md` section A and record results in `specs/001-github-app-onboarding/quickstart.md`
- [ ] T103 Add metrics counters (deliveries received, rejected, duplicate; sync duration; sync failures) and a startup log line without secret values, in `backend/src/observability/metrics.ts`
- [ ] T104 [P] Document deployment and secret provisioning (private key mounted read-only, mode 0400, outside the build context) in `deploy/README.md`
- [ ] T105 Walk through `specs/001-github-app-onboarding/checklists/requirements-quality.md` with the reviewer and record outcomes inline; fix spec gaps found before release
- [ ] T106 Run `/speckit-analyze` for cross-artifact consistency and resolve findings

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none. T007 → T008 are documentation gates.
- **Foundational (Phase 2)**: depends on T001 to T005; blocks all stories.
- **US1 (Phase 3)**: depends on Foundational.
- **US2 (Phase 4)**: depends on US1 (needs a session).
- **US5 (Phase 5)**: depends on US2 (event handlers call `reconcileInstallation` and the sync job from T047, T048).
- **US6 (Phase 6)**: depends on US1 and US2 (membership derived at sign-in, applied to installation routes); T071 also depends on T008.
- **US3 (Phase 7)**: depends on US2 and US6 (roles) and T008.
- **US4 (Phase 8)**: depends on US2 and US5 (uses reconcile and event routing).
- **Polish (Phase 9)**: depends on the stories being included.

### User Story Dependencies

- US1 → US2 → US5
- US1 + US2 → US6 → US3
- US2 + US5 → US4

### Within Each Story

- Tests first, and they MUST fail before implementation.
- Migrations and models before services; services before endpoints; endpoints before UI.

### Parallel Opportunities

- Setup: T003 to T006 together.
- Foundational: T012, T013 to T017, T019, T022, T025, T027, T029, T030 in parallel after T009 to T011 where they need the schema.
- Each story: all `[P]` test tasks together; frontend `[P]` tasks alongside backend once the contract in `contracts/api.openapi.yaml` is fixed.
- After US2: US5 and US6 can proceed in parallel; after US6: US3; US4 can run alongside US6 and US3.

### Parallel Example: User Story 2

```text
Task: "Contract tests for installation routes in backend/test/contract/installations.contract.spec.ts"      (T039)
Task: "Install-callback security test in backend/test/integration/install-callback-security.spec.ts"        (T041)
Task: "Repository sync test in backend/test/integration/repository-sync.spec.ts"                            (T042)
Task: "Installations list page in frontend/src/app/(app)/installations/page.tsx"                            (T052)
```

---

## Implementation Strategy

### MVP First

1. Phase 1 and Phase 2.
2. US1 (sign-in) then US2 (install and view). **Stop and validate**: a user can install and see repositories.
3. Add US5 before exposing the webhook endpoint publicly; do not deploy the webhook route without signature verification (T060 to T062).
4. Add US6 before any second user or organization is onboarded.

### Incremental Delivery

1. Foundation → US1 → US2 (demo).
2. US5 → US6 (security-complete read path).
3. US3 (management) after T007/T008 are done.
4. US4 (full lifecycle).
5. Polish.

### Notes

- [P] tasks touch different files and have no dependency on an unfinished task.
- Commit after each task or logical group.
- Do not merge any task that adds a GitHub write call, stores a user token, or logs a secret (Constitution II, XI).
- Any change to an ADR or the ERD goes through Principle XV before the code that depends on it.
