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

## Implementation Safety Rules

These rules are binding for `/speckit-implement` and for anyone implementing this feature. They come from the constitution (Principles II, XI, XII, XIV, XV) and take precedence over convenience.

### Start conditions (Gate G0). Confirm all are true before the first task (these are checks, not tasks)

- Current branch is `001-github-app-onboarding` and the working tree is clean (`git status` shows nothing).
- Every item in `checklists/requirements.md` and `checklists/requirements-quality.md` is `[x]` (both currently are).
- The last `/speckit-analyze` run reported no CRITICAL or HIGH findings.
- Docker, Node.js 22 and pnpm 10 are available (`docker compose version`, `node -v`, `pnpm -v`).

### Forbidden actions (never, for any task)

- Never run `git push`, `git push --force`, `git reset --hard`, `git clean`, or delete or rewrite branches. Commits on the current branch are allowed.
- Never create, write or print a real credential: no real GitHub App private key, client secret, webhook secret, session secret or token, in any file, log, test or commit. Tests generate throwaway keys and secrets at run time and keep them in memory or in git-ignored temp paths.
- Never create a `.env` file with real values. Only `deploy/env.example` (names only) is committed.
- Never call the real GitHub API, the real Anthropic API, or any external service other than the package registry. All tests use the fake GitHub server (`backend/test/fakes/`) and local containers.
- Never add a GitHub write call, a `write`/`admin` permission, or storage of a user token (FR-032, FR-034). If a task seems to require one, stop.
- Never run commands with `sudo`, install global packages, run `docker system prune`, or touch files outside this repository (including `~/.ssh`, `~/.config`, other projects).
- Never change an ADR, the ERD or the spec as a side effect of a code task. Such changes follow Principle XV and are separate, reviewed commits (see T009).
- Never weaken, skip, delete or loosen a test, threshold or check to make it pass.

### Manual tasks and gates

- Tasks marked `[MANUAL]` need a human or real GitHub access. The agent MUST NOT execute or tick them. It skips them and continues only with tasks that do not depend on them.
- **Gate G1 (T008, T009)**: no work on T077 (role derivation), T092 (role re-confirmation) or the final permission allow-list (T027) may start until a human has marked T008 and T009 done. When the agent reaches such a task first, it stops and reports "blocked by G1". US1 and US2 are not blocked.
- **Gate G2 (before enabling the webhook route)**: T067 to T070 (raw body, signature check, controller, routing) are implemented together and their tests T063 to T066 pass before the route is reachable from the API entry point.
- **Gate G3 (before any deployment)**: T036 CI is green, T110 documentation exists, and T111 and T112 are done by a human.

### Per-task rules

- Do the tasks in order. Tasks marked `[P]` may be done in any order but never in the same file at the same time.
- Write the test task of a story first and see it fail, then implement (the test tasks precede the implementation tasks in each story).
- A task is done only when: its files exist at the stated paths, its tests pass, `pnpm -r lint` and `pnpm -r build` pass, and every FR/SC tag on the task is actually covered. Only then tick it `[X]`.
- If a task is ambiguous, conflicts with `spec.md`, `plan.md`, `data-model.md`, `contracts/` or the constitution, or needs a decision not written down, stop and ask. Do not invent behavior.
- If a task is too large for one reviewable commit, split it into several commits under the same task ID; do not renumber tasks.
- When a command or test fails, stop the phase, report the failing command and output, and fix the cause. Do not continue to the next task with a failing suite.

### Phase exit criteria (run before moving on; commit at each)

| After | Must pass | Commit message |
|-------|-----------|----------------|
| Phase 1 (except MANUAL tasks) | `pnpm -r lint`, `pnpm -r build` | `chore(001): repository skeleton` |
| Phase 2 | above plus `test:unit` and `test:integration` (schema constraints, redaction, session, CSRF) | `feat(001): foundation` |
| Phase 3 (US1) | above plus US1 contract and integration tests | `feat(001): GitHub sign-in` |
| Phase 4 (US2) | above plus US2 tests | `feat(001): installation and repository sync` |
| Phase 5 (US5) | above plus webhook tests | `feat(001): webhook authenticity and idempotency` |
| Phase 6 (US6) | above plus tenant isolation tests | `feat(001): tenant isolation and membership` |
| Phase 7 (US3) | above plus management tests (after G1) | `feat(001): enable, disable and sync controls` |
| Phase 8 (US4) | above plus lifecycle tests | `feat(001): installation lifecycle` |
| Phase 9 | all suites plus `test:e2e` and the quickstart section A run | `chore(001): polish and validation` |

End every commit message with the attribution line required in this environment.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Repository skeleton and the prerequisites that gate later work.

- [ ] T001 Before any other file is created, add the repository hygiene files at the root: `.gitignore` (at least `node_modules/`, `dist/`, `.next/`, `coverage/`, `.env*` except `deploy/env.example`, `*.pem`, `*.key`, `*.p12`, `secrets/`, `*.log`, `.DS_Store`), `.dockerignore` (same plus `.git/`), and `.nvmrc` containing `22`; commit them alone. This prevents secrets and build output from ever being committed (Constitution XI)
- [ ] T002 Create the layout from plan.md: `backend/`, `frontend/`, `deploy/` with `backend/src/{config,auth,tenancy,github,installations,repositories,audit,queue,observability}/`, `backend/test/{unit,integration,contract,fakes}/`
- [ ] T003 Initialize the NestJS TypeScript (strict) backend on Node.js 22 LTS with pnpm 10 (record `"engines"` and `packageManager` in `package.json`, commit the lockfile, add a root `pnpm-workspace.yaml` for `backend` and `frontend`) in `backend/package.json` and `backend/tsconfig.json` with Prisma, BullMQ, Octokit (app auth and webhooks), pino, zod, Jest, Supertest; define these scripts and no others as the project's verification commands: `lint`, `build`, `test:unit`, `test:contract`, `test:integration` (all run from the repository root with `pnpm -r <script>`; integration tests use containers only, never a real GitHub or real credentials)
- [ ] T004 [P] Initialize the Next.js (App Router) React TypeScript frontend on the same Node.js 22 LTS and pnpm workspace, with the same script names (`lint`, `build`, `test:unit`, `test:e2e`) in `frontend/package.json` and `frontend/tsconfig.json` with Playwright
- [ ] T005 [P] Configure linting and formatting for both apps in `backend/eslint.config.mjs`, `frontend/eslint.config.mjs`, `.prettierrc`
- [ ] T006 [P] Add `deploy/env.example` listing variable names only (no values): GitHub App ID, client ID, client secret, private key file path, webhook secret, session secret, database URL, Redis URL; add `.gitignore` entries for `.env*` and key files
- [ ] T007 [P] Add a secret-scanning check that fails on private-key or secret patterns, in `.github/workflows/secret-scan.yml` (supports FR-033, SC-010); scan both the repository and built images (SC-013)
- [ ] T008 [MANUAL] Spike (document only): with a throwaway GitHub App, confirm which read-only permission the organization-membership role call needs for a GitHub App user token; record the result in `specs/001-github-app-onboarding/research.md` under R4
- [ ] T009 [MANUAL] Amend `docs/adr/0001-architecture.md` ADR-006 to list the read-only permission found in T008 (no write added), and state in ADR-006 that the write permissions it lists (pull requests, issues) are requested only when the feature that needs them is specified, per Constitution Principles II and XV. **Blocks T077 and T092** (role verification) Only a human may mark T008 and T009 done; the agent may prepare a draft for T009 but MUST stop and wait for review
- [ ] T010 [P] Document the GitHub App registration in `deploy/github-app-registration.md`: read-only permissions only (repository metadata plus the membership permission found in T008; no pull request, issue or contents write), subscribed events (`installation`, `installation_repositories`, `repository`), setup URL `/api/installations/callback` with "Request user authorization (OAuth) during installation" enabled, webhook URL `/api/webhooks/github`, and the secrets to generate (names only). The membership permission is added once T008 confirms it; everything else can be written now (FR-032, FR-039); include the exact permission table that `backend/src/github/allowed-permissions.ts` (startup check) must match

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Infrastructure every story needs. No user story work starts before this phase is complete.

**⚠️ CRITICAL**

### Database

- [ ] T011 Create `backend/prisma/schema.prisma` for the tables this feature uses from `docs/architecture/database-erd.md` (with Amendment 1): `users`, `organizations`, `organization_members`, `github_installations`, `repositories`, `audit_logs`, `webhook_deliveries`. Keep the baseline uniques verbatim: `users.github_user_id UNIQUE`, `organizations.github_org_id UNIQUE`, `github_installations.github_installation_id UNIQUE`, `repositories.github_repository_id UNIQUE`, `repositories.full_name UNIQUE`
- [ ] T012 Create the initial SQL migration in `backend/prisma/migrations/0001_onboarding_baseline/migration.sql` with all foreign keys from the ERD, and these constraints verbatim: `webhook_deliveries.delivery_guid UNIQUE`; `organization_members(organization_id, user_id) UNIQUE`; check `repositories: review_enabled = false OR status = 'ACCESSIBLE'`; value checks: `github_installations.status` in (`ACTIVE`,`SUSPENDED`,`REMOVED`), `github_installations.sync_status` in (`PENDING`,`SYNCING`,`SYNCED`,`FAILED`), `github_installations.repository_selection` in (`ALL`,`SELECTED`), `repositories.status` in (`ACCESSIBLE`,`INACCESSIBLE`), `organizations.account_type` in (`ORGANIZATION`,`USER`), `organization_members.role` in (`OWNER`,`MEMBER`), `webhook_deliveries.status` in (`RECEIVED`,`PROCESSED`,`IGNORED`,`FAILED`)
- [ ] T013 Add indexes in the same migration file: ERD §17 indexes for the tables above plus `repositories(installation_id, status)` and `webhook_deliveries(github_installation_id, received_at)`
- [ ] T014 [P] Write a migration test asserting each constraint in T012 and T013 rejects invalid data, in `backend/test/integration/schema-constraints.spec.ts`

### Configuration, secrets, logging

- [ ] T015 [P] Implement typed environment config with zod validation (fail fast on missing values) in `backend/src/config/config.module.ts`
- [ ] T016 [P] Implement the `SecretProvider` interface and an environment/mounted-file implementation in `backend/src/config/secret-provider.ts`; no secret value may be returned by any public method other than the one that hands it to the GitHub client and the signature verifier; no secret is ever written in plaintext to the database, logs or audit entries (FR-033)
- [ ] T017 [P] Implement pino structured logging with a redaction list (private key, webhook secret, client secret, session secret, `Authorization`, cookies, tokens) and correlation fields `deliveryId`, `githubInstallationId`, `jobId`, `organizationId` in `backend/src/observability/logger.ts`
- [ ] T018 [P] Unit test that redaction removes every listed secret name from log output, in `backend/test/unit/logger-redaction.spec.ts`
- [ ] T019 [P] Implement a global exception filter that returns the `Error` shape from `contracts/api.openapi.yaml` and never includes stack traces or upstream GitHub text, in `backend/src/observability/error.filter.ts`

### Sessions, authorization context, tenancy

- [ ] T020 Implement the server-side session store (opaque ID in an httpOnly, Secure, SameSite=Lax cookie named `codelens_session`; data in Redis; 12-hour absolute and 2-hour idle limits) in `backend/src/auth/session.service.ts` [FR-036]
- [ ] T021 [P] Implement CSRF protection for state-changing routes (`X-CSRF-Token` header) in `backend/src/auth/csrf.guard.ts`
- [ ] T022 Implement `AuthorizationContext` ({userId, memberships: [{organizationId, role, roleVerifiedAt}]}) and the guard that resolves it on every authenticated request in `backend/src/auth/authorization-context.ts` and `backend/src/auth/session.guard.ts` [FR-009, FR-010]
- [ ] T023 Implement the tenant-scoped data-access base class whose every method requires an `AuthorizationContext` or an explicit system context, and whose out-of-scope reads return "not found", in `backend/src/tenancy/tenant-scoped.repository.ts` [FR-009, FR-020]
- [ ] T024 [P] Unit tests for session limits, CSRF rejection and context resolution in `backend/test/unit/auth-foundation.spec.ts`

### Queue and GitHub client

- [ ] T025 Set up BullMQ queues and a worker entry point (same image as the API) with deterministic job IDs and exponential backoff (up to 5 attempts) in `backend/src/queue/queue.module.ts` and `backend/src/worker.ts`
- [ ] T026 Implement the read-only GitHub App client: app JWT creation, installation token (in memory only, never logged or persisted), get installation, list installation repositories with pagination, in `backend/src/github/github-app.client.ts`. No write method may exist on this class
- [ ] T027 Implement a startup permission check: on API and worker start, read the app's own granted permissions from GitHub with the app JWT and refuse to start (with a log line naming the offending permission, no secrets) if any permission is `write`/`admin` or is not in the allow-list `backend/src/github/allowed-permissions.ts`, which mirrors ADR-006 as amended by T009, in `backend/src/github/permission-check.ts` [FR-032, FR-039, SC-014]
- [ ] T028 [P] Unit and integration tests for the startup permission check against the fake GitHub (T030): read-only allowed set starts; any write permission, or a permission missing from the allow-list, stops startup; the allow-list contains no write entry, in `backend/test/integration/app-permissions.spec.ts` [SC-014]
- [ ] T029 [P] Implement audit logging (`audit_logs` writer; actions per data-model.md; rejects any metadata key that matches the secret redaction list) in `backend/src/audit/audit.service.ts` [FR-023, FR-027]

### Test harness and deployment skeleton

- [ ] T030 Build the fake GitHub server implementing only the calls this feature uses (user authorization exchange, including the one-time code returned on installation return, and a mode that omits it, user profile, user installations, organization membership role, app installation lookup, the app's own granted permissions (configurable per test), installation token, installation repositories) with scripted failures and pagination in `backend/test/fakes/fake-github.ts`
- [ ] T031 [P] Build signed webhook payload builders and fixtures for each event in `contracts/webhooks.md` (using a test-only secret) in `backend/test/fakes/webhook-fixtures.ts`
- [ ] T032 Set up the integration-test harness starting PostgreSQL and Redis containers, applying migrations, and booting API and worker against the fake GitHub, in `backend/test/integration/harness.ts`
- [ ] T033 [P] Create `deploy/docker-compose.yml` (Nginx, web, api, worker, PostgreSQL, Redis; private key mounted read-only from a host path, not from the build context) and `deploy/nginx/default.conf` routing `/api` to the API and everything else to the web app on one origin; add a `test` profile that also starts the fake GitHub server from T030; configure Redis with append-only persistence (AOF) so sessions survive a restart
- [ ] T034 [P] Scaffold the typed same-origin API client (cookie-based, CSRF header, no token storage) in `frontend/src/lib/api-client.ts`
- [ ] T035 Add a migration step to the deploy definition that applies `backend/prisma/migrations` before the API and worker start, in `deploy/docker-compose.yml` (Constitution XIV: no manual schema changes)
- [ ] T036 [P] Add a CI workflow that runs lint, unit, contract and integration suites on every push and pull request in `.github/workflows/ci.yml`

**Checkpoint**: Foundation ready. User story work can begin.

---

## Phase 3: User Story 1 - Sign in with GitHub (Priority: P1) 🎯 MVP

**Goal**: A person signs in with GitHub, gets or reuses one CodeLens account, and never handles a token.

**Independent Test**: Sign in with a new fake GitHub user, confirm an account exists and is linked to their GitHub ID; sign in again and confirm the same account; rename them on the fake and confirm the login updates.

### Tests for User Story 1

- [ ] T037 [P] [US1] Contract test for `/auth/github/login`, `/auth/github/callback`, `/auth/logout`, `/me` against `contracts/api.openapi.yaml` in `backend/test/contract/auth.contract.spec.ts` [FR-001, FR-004]
- [ ] T038 [P] [US1] Integration test: first sign-in creates one user; second reuses it; renamed login updates the same row; denied/cancelled sign-in creates nothing and returns the error redirect; unauthenticated requests get 401 with no tenant data (US1 scenarios 1 to 5) in `backend/test/integration/sign-in.spec.ts`; a session that expires while the user is on a page redirects to sign-in with no server-side state lost (Edge Case) [FR-001, FR-002, FR-004]; sign-out ends the session on the server, a reused session cookie is treated as signed out, and signing in again returns the same account (US1 scenario 6)
- [ ] T039 [P] [US1] Integration test asserting no GitHub user token, client secret or session secret appears in any response body, header (other than the httpOnly cookie) or log line during sign-in (FR-034, SC-010) in `backend/test/integration/sign-in-secrets.spec.ts`

### Implementation for User Story 1

- [ ] T040 [US1] Implement the GitHub App user-authorization redirect with a single-use, session-bound `state` (random, expires in 10 minutes, stored in Redis) in `backend/src/auth/github-login.controller.ts` [FR-001]
- [ ] T041 [US1] Implement the callback: exchange the code, read the GitHub user's numeric ID and profile, upsert `users` by `github_user_id`, set `last_login_at`, create the session, then discard the user token, in `backend/src/auth/github-login.service.ts` [FR-001, FR-002, FR-003]
- [ ] T042 [US1] Implement `GET /me`, `POST /auth/logout` (revoke session server-side) in `backend/src/auth/me.controller.ts` [FR-004]
- [ ] T043 [P] [US1] Build the sign-in page and denied-sign-in message in `frontend/src/app/(public)/sign-in/page.tsx`; the cancelled-sign-in message offers a way to try again (US1 scenario 4)
- [ ] T044 [P] [US1] Build the authenticated layout with redirect-to-sign-in for unauthenticated visitors in `frontend/src/app/(app)/layout.tsx` [FR-004]

**Checkpoint**: Sign-in works end to end and is independently testable.

---

## Phase 4: User Story 2 - Install the CodeLens GitHub App and see the installation (Priority: P1)

**Goal**: A signed-in user installs the app on GitHub and then sees the installation, its organization, and its repositories.

**Independent Test**: Sign in, start install, complete it on the fake GitHub selecting 3 of 5 repositories, return to CodeLens; the installation and exactly those 3 repositories appear, all disabled.

### Tests for User Story 2

- [ ] T045 [P] [US2] Contract tests for `/installations/new`, `/installations/callback`, `/installations`, `/installations/{installationId}`, `/installations/{installationId}/repositories` in `backend/test/contract/installations.contract.spec.ts` [FR-005, FR-018]
- [ ] T046 [P] [US2] Integration test: install callback with valid state and user-accessible installation ID creates organization, installation and repositories via sync; "all" and "selected" selections; zero repositories; abandoned flow shows nothing (US2 scenarios 1 to 6) in `backend/test/integration/install-flow.spec.ts`; the installing user sees the installation right after the callback (US2 scenario 2, requires T052); after the install callback the installation and repositories are visible within 30 seconds (SC-002) in the fake environment
- [ ] T047 [P] [US2] Security test: callback with a reused, expired or other-session `state` returns 400; callback with an installation ID the fake GitHub does not list for that user returns 404, links nothing and does not reveal the installation; callback without `code` links nothing until the user completes the authorization redirect, and a declined authorization links nothing (FR-005, FR-009, US2 scenarios 7 and 8) in `backend/test/integration/install-callback-security.spec.ts`
- [ ] T048 [P] [US2] Integration test for repository sync: upsert by GitHub repository ID, rename in place, visibility change, missing repositories marked `INACCESSIBLE` with `review_enabled = false`, new repositories `review_enabled = false`, 10 consecutive runs produce zero changes after the first (FR-011 to FR-015, SC-006) in `backend/test/integration/repository-sync.spec.ts`
- [ ] T049 [P] [US2] Integration test: sync of a 500-repository fake completes and is fully listed in under 2 minutes; a failing page fetch leaves prior data untouched and sets `sync_status = FAILED` with an error code only (FR-017, SC-003) in `backend/test/integration/repository-sync-scale-failure.spec.ts`; a transient failure is retried at least 3 times with increasing delay before the FAILED state is shown, and an OWNER retry afterwards succeeds (FR-017); an installation with more than 5,000 repositories synchronizes exactly the 5,000 lowest GitHub repository IDs on every run, records `sync_error_code = REPOSITORY_LIMIT_EXCEEDED` while `sync_status = SYNCED`, and repositories outside the set are marked `INACCESSIBLE` (FR-011)

### Implementation for User Story 2

- [ ] T050 [US2] Implement organization upsert keyed by `github_org_id` (personal accounts stored with `account_type = USER`) in `backend/src/tenancy/organizations.service.ts` [FR-008]
- [ ] T051 [US2] Implement the install redirect with single-use `state` in `backend/src/github/install/install.controller.ts` [FR-005]
- [ ] T052 [US2] Implement access derivation: after sign-in and after the install callback, read the installations the user can access from GitHub (no extra permission needed), insert `organization_members` rows with role `MEMBER` for those installations' organizations only when no row exists (never change an existing `role` or `role_verified_at`), and remove memberships GitHub no longer reports, in `backend/src/tenancy/membership-sync.service.ts`; call it from the sign-in callback (T041) and from T053 [FR-010, FR-036]
- [ ] T053 [US2] Implement the setup callback per `contracts/api.openapi.yaml`: validate `state`; if the optional `code` is present, exchange it for a short-lived user credential (used once, never stored or logged); if absent, redirect through the sign-in authorization flow and resume with the same `state` (nothing linked yet); confirm the installation ID is among the user's accessible installations, fetch the installation via app JWT, run `reconcileInstallation`, run access derivation (T052), enqueue sync, redirect to the installation page, in `backend/src/github/install/install-callback.service.ts` (FR-005, FR-009)
- [ ] T054 [US2] Implement `reconcileInstallation` (idempotent upsert of installation and organization from GitHub; `status` ACTIVE/SUSPENDED/REMOVED; `repository_selection`; not-found from GitHub means removal) in `backend/src/installations/reconcile.service.ts` [FR-007, FR-008]
- [ ] T055 [US2] Implement the repository sync job: page through the installation's repositories using an in-memory installation token, then in one transaction upsert by `github_repository_id`, mark missing ones `INACCESSIBLE` with `review_enabled = false`, keep new ones `review_enabled = false`, apply the transfer and overlap rule from research R7 (ask GitHub whether the holding installation still has access; if not, reassign the row to the new organization and installation with `review_enabled = false` and enable fields cleared; if so, keep it, set `sync_conflict` and log for operators only), set `last_synced_at`; serialize per installation with a PostgreSQL advisory lock; job ID `sync:<githubInstallationId>`, in `backend/src/repositories/sync.service.ts` and `backend/src/repositories/sync.processor.ts`; enforce the 5,000-repository limit by keeping the lowest GitHub repository IDs and setting `sync_error_code = REPOSITORY_LIMIT_EXCEEDED` (FR-011) [FR-011 to FR-015]
- [ ] T056 [US2] Implement `sync_status` transitions PENDING → SYNCING → SYNCED | FAILED and `sync_error_code` (codes only, never GitHub text) in `backend/src/installations/installation-sync-status.ts`; the only allowed `sync_error_code` values are `GITHUB_UNAVAILABLE`, `GITHUB_RATE_LIMITED`, `ACCESS_REVOKED`, `OTHER` (sync failed) and `REPOSITORY_LIMIT_EXCEEDED` (with `sync_status = SYNCED`) [FR-017, FR-041]
- [ ] T057 [US2] Implement the read endpoints (`GET /installations`, `GET /installations/{installationId}`, `GET /installations/{installationId}/repositories` with `q`, `state`, `cursor`, `limit`), all through the tenant-scoped repository and the session guard, with the same 404 for "missing" and "not yours", in `backend/src/installations/installations.controller.ts`; compute `displayState` per data-model.md §Display states and never return `sync_conflict` (FR-041) [FR-018, FR-020]
- [ ] T058 [US2] Write installation lifecycle audit entries (`GITHUB_INSTALLATION_ADDED` here; suspended/unsuspended/removed are added by T100 and T101) once per state transition and never once per delivery, in `backend/src/installations/installation-audit.ts` [FR-027]
- [ ] T059 [P] [US2] Build the installations list and "Install CodeLens" action in `frontend/src/app/(app)/installations/page.tsx` [FR-005, FR-019]
- [ ] T060 [P] [US2] Build the installation detail page (Installation → Organization → Repositories) with search, pagination, state labels, empty-list explanation and sync-failed banner in `frontend/src/app/(app)/installations/[id]/page.tsx`; show a limit warning when `sync_error_code = REPOSITORY_LIMIT_EXCEEDED`; show installation states from `displayState` with the four failure reason categories; for zero repositories show "no repositories were selected on GitHub" with a link to the installation settings on GitHub; offer only a GitHub link for adding repositories (FR-006, FR-041) [FR-018, FR-019]
- [ ] T061 [US2] Build the "setting up" state that polls every 3 seconds up to 2 minutes, then shows a timeout message with a retry action, in `frontend/src/components/installation-setup-status.tsx`; the message says repositories are being imported from GitHub; the timeout message says setup is taking longer than expected, with "check again" for everyone and "retry synchronization" for OWNER (US2 scenario 5)

**Checkpoint**: A user can install and see repositories. This plus US1 is the demonstrable core.

---

## Phase 5: User Story 5 - Reject forged and duplicate events (Priority: P1)

**Goal**: Only authentic events are accepted, and each real event takes effect once.

**Independent Test**: Post a bad-signature fixture and see 401 with no change; post one valid fixture ten times (some concurrently) and see state equal to one delivery.

### Tests for User Story 5

- [ ] T062 [P] [US5] Contract test for `POST /webhooks/github` responses (202, 400, 401) in `backend/test/contract/webhook.contract.spec.ts`
- [ ] T063 [P] [US5] Integration test: missing, wrong, malformed and body-modified signatures all return 401, write no row in any table, and log a rejection with no body or secret (FR-028, SC-004) in `backend/test/integration/webhook-signature.spec.ts`; the response body for every rejection is identical and contains no detail beyond "not accepted"; the rejection log record holds only time, reason, delivery ID if present and a hashed source address (FR-028, US5 scenario 1)
- [ ] T064 [P] [US5] Integration test: same delivery 10 times, and two concurrent identical deliveries, yield one installation, one repository set and one audit entry (FR-029, SC-005) in `backend/test/integration/webhook-idempotency.spec.ts`; two distinct deliveries with identical content both reach PROCESSED but cause no second change (FR-029)
- [ ] T065 [P] [US5] Integration test: out-of-order sequences (repositories event before installation event; deleted before created; late duplicate) converge to the fake GitHub's current state (FR-030) in `backend/test/integration/webhook-ordering.spec.ts`
- [ ] T066 [P] [US5] Integration test: event for an installation with no linked user is recorded but invisible to everyone until GitHub confirms a user can access that installation at sign-in or access refresh (FR-010, US5 scenario 5); acknowledgement stays under 2 seconds p95 while sync work is queued (FR-031) in `backend/test/integration/webhook-unknown-installation.spec.ts`

### Implementation for User Story 5

- [ ] T067 [US5] Capture the raw request body for the webhook route in `backend/src/main.ts` and `backend/src/github/webhook/raw-body.middleware.ts`
- [ ] T068 [US5] Implement constant-time verification of `X-Hub-Signature-256` over the raw body before any parsing; reject with 401 and a metric plus structured log (reason, delivery ID if present, hashed source address; no body) in `backend/src/github/webhook/signature.guard.ts`
- [ ] T069 [US5] Implement the webhook controller: require event and delivery headers (400 otherwise), insert `webhook_deliveries` by unique `delivery_guid` (store `payload_sha256` only), return 202 for repeats, otherwise enqueue, in `backend/src/github/webhook/webhook.controller.ts` [FR-028, FR-029, FR-031]
- [ ] T070 [US5] Implement event routing per `contracts/webhooks.md`: `installation` created/deleted/suspend/unsuspend → `reconcile:<githubInstallationId>`; `installation_repositories` and `repository` events → `sync:<githubInstallationId>`; anything else → `IGNORED`. Handlers read only the installation ID from the payload, in `backend/src/github/webhook/event-router.ts` [FR-030]
- [ ] T071 [US5] Implement the reconcile queue processor that updates `webhook_deliveries.status` (`PROCESSED`, `FAILED` with `error_code`) and `processed_at`, in `backend/src/installations/reconcile.processor.ts`

**Checkpoint**: Webhooks are authenticated, deduplicated and order-independent.

---

## Phase 6: User Story 6 - See only what I'm authorized to see (Priority: P1)

**Goal**: Users see only their own organizations' installations and repositories, with access and roles derived from GitHub.

**Independent Test**: Two users in different organizations each see only their own data, and each gets 404 when requesting the other's identifiers.

### Tests for User Story 6

- [ ] T072 [P] [US6] Cross-tenant negative suite: for every read and write route in `contracts/api.openapi.yaml`, a user of tenant A gets 404 for tenant B's identifiers, with response bodies identical to a truly missing resource (FR-020, SC-007) in `backend/test/integration/tenant-isolation.spec.ts`; add a matrix test asserting every cell of spec FR-040 for visitor, signed-in non-member, MEMBER and OWNER; error messages, counts, search results and audit views for another organization's resource are identical to those for a non-existent resource (FR-020)
- [ ] T073 [P] [US6] Integration test: membership and role are derived from GitHub at sign-in and on refresh (organization owner → OWNER, other accessible users → MEMBER, personal account holder → OWNER); a user who belongs to several organizations sees each separately (US6 scenarios 1 and 4) in `backend/test/integration/membership-derivation.spec.ts`; access derivation (T052) run after the install callback never demotes an existing OWNER or resets `role_verified_at` [FR-010, FR-035, FR-036]
- [ ] T074 [P] [US6] Integration test: a user removed from an organization on the fake GitHub loses access at the next confirmation (sign-in, refresh access, or management action) and not before (US6 scenario 3) in `backend/test/integration/membership-revocation.spec.ts`
- [ ] T075 [P] [US6] Unit test that no tenant-scoped repository method can be called without an `AuthorizationContext` (compile-time and runtime) in `backend/test/unit/tenant-scoped.spec.ts`
- [ ] T076 [P] [US6] Integration test that queue jobs and logs for one tenant never carry another tenant's identifiers and that sync writes only within the installation's organization in `backend/test/integration/tenant-background.spec.ts`; user requests are authorized only by membership and worker jobs only by installation, and both resolve to one organization (FR-009)

### Implementation for User Story 6

- [ ] T077 [US6] Add role derivation to `backend/src/tenancy/role-sync.service.ts`: per organization read the membership role from GitHub, set `OWNER` (organization owner, or personal account holder) or `MEMBER` (any other role), and store `role_verified_at`; extend the sign-in and refresh flows to call it (uses the permission from T009). Until this task exists all members are `MEMBER` (view-only), which does not block US1 or US2 [FR-035, FR-036]
- [ ] T078 [US6] Implement role mapping: GitHub owner → `OWNER`; other users with installation access → `MEMBER`; personal account holder → `OWNER`; any other GitHub role → `MEMBER`, in `backend/src/tenancy/role-mapper.ts` [FR-035]
- [ ] T079 [US6] Implement `POST /me/refresh-access` (re-authorize with GitHub, then repeat T077) in `backend/src/auth/refresh-access.controller.ts`
- [ ] T080 [US6] Ensure the worker runs sync and reconcile under an explicit system context that is bound to the installation's organization, in `backend/src/queue/system-context.ts`
- [ ] T081 [P] [US6] Build the organization switcher and show only the caller's organizations in `frontend/src/components/organization-switcher.tsx` [FR-020]
- [ ] T082 [P] [US6] Add a "Refresh access" action to the installations page that calls `POST /me/refresh-access` and shows the updated installations and roles, in `frontend/src/components/refresh-access-button.tsx` (US6 scenario 3, FR-038)

**Checkpoint**: Isolation and GitHub-derived membership are enforced across all P1 stories.

---

## Phase 7: User Story 3 - Enable or disable a repository (Priority: P2)

**Goal**: An owner enables or disables CodeLens review for a repository without uninstalling the app; a disabled or ineligible repository is never processed.

**Independent Test**: As an OWNER, enable a repository (state ENABLED, audit entry), disable it (state DISABLED, app still installed), and confirm the eligibility function follows immediately; as a MEMBER, the same actions are rejected.

### Tests for User Story 3

- [ ] T083 [P] [US3] Contract tests for `PUT /repositories/{repositoryId}/review-enabled` and `POST /installations/{installationId}/sync` including 403 `REAUTH_REQUIRED` and 503 `ROLE_UNVERIFIABLE` in `backend/test/contract/management.contract.spec.ts`
- [ ] T084 [P] [US3] Integration test: new repositories are disabled; OWNER enable/disable works and is idempotent; final toggle wins; audit entries for both actions; MEMBER rejected with state unchanged (US3 scenarios 1 to 4, 9) in `backend/test/integration/enable-disable.spec.ts` [FR-015, FR-021, FR-023]
- [ ] T085 [P] [US3] Integration test for role freshness: a role confirmed more than 10 minutes ago yields `REAUTH_REQUIRED`, and after re-confirmation the change is applied; an owner demoted on GitHub is rejected at re-confirmation; GitHub unreachable refuses the request and trusts no stored role; an installer who is not a GitHub owner is rejected (FR-036 to FR-038, US3 scenarios 5 to 8, SC-012) in `backend/test/integration/role-freshness.spec.ts` [FR-035 to FR-038]
- [ ] T086 [P] [US3] Unit and integration tests for the eligibility function: eligible only when `repositories.status = 'ACCESSIBLE'` AND `review_enabled` AND installation `status = 'ACTIVE'`; false for disabled, inaccessible, suspended and removed; reads current state each call (FR-022, SC-008) in `backend/test/integration/review-eligibility.spec.ts`; after a disable, every later evaluation returns not eligible (SC-008); all future review features must call this function (FR-022)
- [ ] T087 [P] [US3] Test that manual sync is OWNER-only and that repeated requests collapse into one queued job (`ALREADY_QUEUED`) in `backend/test/integration/manual-sync.spec.ts`

### Implementation for User Story 3

- [ ] T088 [US3] Implement the role-freshness guard: management routes require `role_verified_at` within 10 minutes, otherwise respond 403 `REAUTH_REQUIRED`; if GitHub cannot give a definite answer respond 503 `ROLE_UNVERIFIABLE` and never fall back to the stored role, in `backend/src/auth/role-freshness.guard.ts` [FR-037, FR-038]
- [ ] T089 [US3] Implement `PUT /repositories/{repositoryId}/review-enabled`: OWNER only; set `review_enabled`, `enabled_at`, `enabled_by_user_id`; reject enabling an `INACCESSIBLE` repository with 409; write `REPOSITORY_ENABLED` / `REPOSITORY_DISABLED` audit entries, in `backend/src/repositories/review-enabled.controller.ts` and `backend/src/repositories/review-enabled.service.ts` [FR-021, FR-023]
- [ ] T090 [US3] Implement `POST /installations/{installationId}/sync` (OWNER only; deterministic job ID so repeats return `ALREADY_QUEUED`) in `backend/src/installations/manual-sync.controller.ts` [FR-016]
- [ ] T091 [US3] Implement `isReviewEligible(repositoryId)` as a single exported domain function reading current state, in `backend/src/repositories/review-eligibility.ts`, and export it for future review features
- [ ] T092 [US3] Re-confirm the caller's role with GitHub on a `REAUTH_REQUIRED` retry and update `role_verified_at`, in `backend/src/tenancy/role-reconfirm.service.ts` (uses the permission from T009) [FR-037]
- [ ] T093 [P] [US3] Build the enable/disable toggle with optimistic update that reverts on failure, for MEMBER the control is shown as unavailable with the explanation that only organization owners can change it (FR-040), and the re-confirm-with-GitHub flow on `REAUTH_REQUIRED`, in `frontend/src/components/repository-toggle.tsx`
- [ ] T094 [P] [US3] Add the manual "Sync now" action (OWNER only) with sync status in `frontend/src/components/sync-now-button.tsx` [FR-016]

**Checkpoint**: Owners control which repositories are eligible; the gate is ready for future review features.

---

## Phase 8: User Story 4 - Stay consistent with GitHub after changes (Priority: P2)

**Goal**: CodeLens reflects repository changes, suspension, reinstall and uninstall from GitHub, and stops all review eligibility on uninstall or suspension.

**Independent Test**: With an enabled repository, remove it on the fake GitHub and see it inaccessible and disabled; then send `installation` deleted and see the installation removed and all repositories ineligible within 1 minute.

### Tests for User Story 4

- [ ] T095 [P] [US4] Integration test: repositories added (disabled), removed (inaccessible, disabled, history kept), renamed (same row), transferred to another account with CodeLens installed (moves to the new tenant, disabled, former settings cleared, gone from the former tenant's list; US4 scenario 8), transferred to an account without CodeLens (inaccessible for the former tenant), visibility changed (US4 scenarios 1 to 3) in `backend/test/integration/lifecycle-repositories.spec.ts`; a `repository` `deleted` event marks the repository inaccessible and disabled (Edge Case) [FR-013, FR-014]
- [ ] T096 [P] [US4] Integration test: uninstall marks installation `REMOVED`, sets `removed_at`, all repositories `INACCESSIBLE` and `review_enabled = false`, eligibility false, within 1 minute (FR-024, SC-009) in `backend/test/integration/lifecycle-uninstall.spec.ts`
- [ ] T097 [P] [US4] Integration test: suspend and unsuspend change status and eligibility, each with one audit entry (FR-025, FR-027) in `backend/test/integration/lifecycle-suspend.spec.ts`
- [ ] T098 [P] [US4] Integration test: reinstall creates a new installation row under the same organization, keeps the removed row and history, creates no duplicate organization, repositories start disabled (FR-026) in `backend/test/integration/lifecycle-reinstall.spec.ts`
- [ ] T099 [P] [US4] Integration test: missed event repaired by manual sync; two installations reporting the same repository while the holder still has access: holder keeps it, `sync_conflict` set, and no API response for either tenant reveals the other (US4 scenario 7, research R7) in `backend/test/integration/lifecycle-conflict-resync.spec.ts`

### Implementation for User Story 4

- [ ] T100 [US4] Implement suspension handling in reconcile: status `SUSPENDED` with `suspended_at`, back to `ACTIVE` on unsuspend; audit `GITHUB_INSTALLATION_SUSPENDED` / `GITHUB_INSTALLATION_UNSUSPENDED` once per transition, in `backend/src/installations/reconcile.service.ts` [FR-025, FR-027]
- [ ] T101 [US4] Implement uninstall handling in reconcile: `REMOVED`, `removed_at`, all repositories `INACCESSIBLE` and `review_enabled = false` in one transaction; audit `GITHUB_INSTALLATION_REMOVED` once, in `backend/src/installations/reconcile.service.ts` [FR-024, FR-027]
- [ ] T102 [US4] Implement reinstall handling: match the organization by `github_org_id`, create a new `github_installations` row for the new GitHub installation ID, leave the removed row intact, in `backend/src/installations/reconcile.service.ts` [FR-026]
- [ ] T103 [US4] Record `REPOSITORY_SYNC_FAILED` audit entries after the last retry and expose `syncStatus` and `syncErrorCode` to the UI, in `backend/src/repositories/sync.processor.ts`; after automatic retries are exhausted show the failed state with a reason category and no GitHub text (FR-017)
- [ ] T104 [P] [US4] Show removed and suspended installations and inaccessible repositories in the UI with their states from `displayState`, in `frontend/src/app/(app)/installations/[id]/page.tsx` and `frontend/src/components/repository-row.tsx`

**Checkpoint**: CodeLens stays consistent with GitHub through every lifecycle change.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end validation and hardening across stories.

- [ ] T105 [P] Add Playwright journeys for sign-in, install, view repositories, enable/disable, and uninstall against the fake GitHub in `frontend/tests/e2e/onboarding.spec.ts`; include a timed first-visit-to-repositories run that must finish in under 5 minutes (SC-001)
- [ ] T106 [P] Add a test that fails when any response body, HTML page, or log line in the acceptance suite contains a configured secret value or private-key marker (SC-010) in `backend/test/integration/secret-leak-scan.spec.ts`
- [ ] T107 [P] Add a test that fails if the GitHub client class exposes any write method or if any test double receives a non-GET call to repository, workflow, settings, issue or pull-request endpoints (FR-032) in `backend/test/unit/github-readonly.spec.ts`; also assert the API exposes no route or UI action that grants or widens repository access other than redirecting to GitHub's installation page (FR-006)
- [ ] T108 Run every scenario in `specs/001-github-app-onboarding/quickstart.md` section A and record results in `specs/001-github-app-onboarding/quickstart.md`
- [ ] T109 Add metrics counters (deliveries received, rejected, duplicate; sync duration; sync failures) and a startup log line without secret values, in `backend/src/observability/metrics.ts`
- [ ] T110 [P] Document deployment and secret provisioning (private key mounted read-only, mode 0400, outside the build context) in `deploy/README.md`; state the log retention of at least 30 days for webhook rejection records (US5 scenario 1)
- [ ] T111 [MANUAL] Walk through `specs/001-github-app-onboarding/checklists/requirements-quality.md` with the reviewer and record outcomes inline; fix spec gaps found before release
- [ ] T112 [MANUAL] Run `/speckit-analyze` for cross-artifact consistency and resolve findings

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none. T008 → T009 and T010 are documentation gates (T010 lists the membership permission once T008 confirms it; the rest of it does not wait for T008).
- **Foundational (Phase 2)**: depends on T002 to T006; blocks all stories.
- **US1 (Phase 3)**: depends on Foundational.
- **US2 (Phase 4)**: depends on US1 (needs a session). It does not depend on T008/T009: access derivation (T052) needs no extra GitHub permission.
- **US5 (Phase 5)**: depends on US2 (event handlers call `reconcileInstallation` and the sync job from T054, T055).
- **US6 (Phase 6)**: depends on US1 and US2 (builds on T052); role derivation T077 also depends on T009.
- **US3 (Phase 7)**: depends on US2 and US6 (roles) and T009.
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

- Setup: T004 to T007 together.
- Foundational: T014, T015 to T019, T021, T024, T029, T031, T033, T034 in parallel after T011 to T013 where they need the schema.
- Each story: all `[P]` test tasks together; frontend `[P]` tasks alongside backend once the contract in `contracts/api.openapi.yaml` is fixed.
- After US2: US5 and US6 can proceed in parallel; after US6: US3; US4 can run alongside US6 and US3.

### Parallel Example: User Story 2

```text
Task: "Contract tests for installation routes in backend/test/contract/installations.contract.spec.ts"      (T045)
Task: "Install-callback security test in backend/test/integration/install-callback-security.spec.ts"        (T047)
Task: "Repository sync test in backend/test/integration/repository-sync.spec.ts"                            (T048)
Task: "Installations list page in frontend/src/app/(app)/installations/page.tsx"                            (T059)
```

---

## Implementation Strategy

### MVP First

1. Phase 1 and Phase 2.
2. US1 (sign-in) then US2 (install and view). **Stop and validate**: a user can install and see repositories. The MVP does not wait for the permission spike (T008/T009).
3. Add US5 before exposing the webhook endpoint publicly; do not deploy the webhook route without signature verification (T067 to T069).
4. Add US6 before any second user or organization is onboarded.

### Incremental Delivery

1. Foundation → US1 → US2 (demo).
2. US5 → US6 (security-complete read path).
3. US3 (management) after T008/T009 are done.
4. US4 (full lifecycle).
5. Polish.

### Notes

- [P] tasks touch different files and have no dependency on an unfinished task.
- Commit after each task or logical group.
- Do not merge any task that adds a GitHub write call, stores a user token, or logs a secret (Constitution II, XI).
- Any change to an ADR or the ERD goes through Principle XV before the code that depends on it.
