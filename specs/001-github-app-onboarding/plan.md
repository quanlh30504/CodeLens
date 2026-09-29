# Implementation Plan: GitHub App Installation and Repository Onboarding

**Branch**: `001-github-app-onboarding` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-github-app-onboarding/spec.md`

## Summary

Let a user sign in with GitHub, install the CodeLens GitHub App, and see the resulting installation and its repositories, then enable or disable each repository for future review. GitHub stays authoritative: every installation event and every callback triggers a **reconcile from GitHub** rather than trusting event deltas, which makes webhook handling idempotent, order-independent and safe to repeat.

Approach (details in [research.md](research.md)):

- **Sign-in** uses the GitHub App's own user authorization flow. The user token is used once at login to read identity and the installations the user can access, then discarded (never stored, never sent to the browser). The session is an opaque server-side session in an httpOnly cookie.
- **Install** redirects to GitHub with a signed, session-bound `state`. The setup callback confirms that the signed-in user can actually access the returned installation ID before it is linked (prevents claiming another tenant's installation).
- **Webhooks** are verified against the raw body with the webhook secret, deduplicated by delivery ID, persisted, acknowledged quickly, and processed by a queue worker.
- **Sync** pages through the installation's repositories using a short-lived installation token, upserts by stable GitHub repository ID inside one transaction, and marks repositories that are no longer reported as inaccessible. It is serialized per installation.
- **Eligibility gate**: one domain function decides whether a repository may be reviewed (enabled AND accessible AND installation active). Future review features must call it.
- **Tenant isolation**: every read and write goes through an authorization context that carries the user's organization memberships; out-of-scope resources answer as not found.

## Technical Context

**Language/Version**: TypeScript (strict) on the current Node.js LTS, for both backend and frontend

**Primary Dependencies**: NestJS (API, guards, validation, DI); Next.js App Router + React (web); Prisma (schema access and SQL migrations); BullMQ (job queue); Octokit libraries for GitHub App auth and webhook signature verification; pino (structured logging); zod for input schemas

**Storage**: PostgreSQL (system of record); Redis (BullMQ queues, server-side sessions)

**Testing**: Jest (unit); Supertest with real PostgreSQL and Redis containers (integration); a local fake GitHub server plus signed fixture payloads (no real GitHub); Playwright for the P1 browser journeys

**Target Platform**: Linux containers via Docker Compose on one AWS EC2 instance (Nginx, web, api, worker, PostgreSQL, Redis; ADR-015)

**Project Type**: web application (frontend + backend + worker sharing the backend codebase)

**Performance Goals**: webhook acknowledged in under 2 s p95 (spec limit 10 s, FR-031); installation and repositories visible within 30 s p95 of GitHub completing installation (SC-002); 500-repository sync under 2 min (SC-003)

**Constraints**: no write calls to GitHub in this feature; app permissions unchanged from ADR-006; secrets only via environment or mounted files outside Git; single-instance deployment; no new infrastructure beyond ADR-015

**Scale/Scope**: MVP: tens of organizations, up to a few hundred repositories per installation, low webhook rate; 4 screens (sign-in, installations, installation detail with repositories, setup-in-progress)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design (result below).*

| # | Principle | Status | How this plan complies |
|---|-----------|--------|------------------------|
| I | GitHub App First | Pass | Sign-in and installation use the GitHub App; no personal access tokens; user identity and installation identity are separate tables and separate code paths |
| II | Least Privilege | Pass | Only read calls; no permission changes; no repository, workflow, settings or merge operations. Open item on Organization Members permission is listed below |
| III | Multi-Tenant Isolation | Pass | `AuthorizationContext` required by every repository-layer method; 404 for out-of-scope resources; cross-tenant negative tests in the contract suite |
| IV | Repository Content Untrusted | Pass | This feature reads only repository metadata (names, IDs, visibility); no source or PR text is fetched or logged |
| V, VI | Provider abstraction, model routing | N/A | No AI calls in this feature; no coupling introduced |
| VII | Structured AI output | N/A | No LLM output |
| VIII | Review/Job/Finding separation | Pass | Feature adds only the eligibility gate; no review tables touched |
| IX | Idempotency | Pass | Delivery-ID dedupe plus reconcile-from-GitHub handlers; deterministic queue job IDs; per-installation lock |
| X | Repository configuration | N/A | `.codelens.yml` out of scope |
| XI | Secrets | Pass | `SecretProvider` abstraction over env/mounted files; private key never in Git; log redaction; user tokens not stored |
| XII | Testing | Pass | Fake GitHub and signed fixtures; unit + integration for authz, webhooks, sync, enable/disable |
| XIII | Observability | Pass | Structured logs keyed by delivery ID, installation ID, job ID; no payload bodies logged |
| XIV | Database integrity | Pass | Baseline constraints kept. Additive changes in [data-model.md](data-model.md) §Baseline amendments are merged into the ERD (Amendment 1) |
| XV | Architecture changes | Pass, one open item | ERD amendment merged; an ADR-006 amendment (open item 1) (read-only role verification permission) must precede implementation |
| XVI | Simplicity | Pass | Two apps and one worker process from the same backend image; no new infrastructure |
| XVII | Security over convenience | Pass | Trade-offs recorded in [research.md](research.md) (session length, token not stored, 404 vs 403) |
| XVIII | Product evolution | Pass | Nothing built ahead of need; installation/plan seams untouched |

**Open items** (item 2 is resolved; the others must be settled before the first implementation task):

1. **Role verification permission.** Spec FR-035 to FR-039 require roles to be confirmed with GitHub. This is expected to need read-only "Organization members" access, which ADR-006 does not list. Confirm the exact permission in a spike, then amend ADR-006 (read-only) before the first implementation task (Principle XV).
2. **ERD amendments**: done. Merged into `docs/architecture/database-erd.md` as Amendment 1 (§21).
3. **Reinstall behavior**: resolved. Spec FR-026 now states a reinstall is a new installation row under the same organization.

## Project Structure

### Documentation (this feature)

```text
specs/001-github-app-onboarding/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── api.openapi.yaml
│   └── webhooks.md
├── checklists/
│   └── requirements.md
└── tasks.md              # created by /speckit-tasks
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── main.ts
│   ├── config/                    # typed env config, SecretProvider
│   ├── auth/                      # GitHub sign-in, sessions, AuthorizationContext, guards
│   ├── tenancy/                   # organizations, memberships, tenant-scoped queries
│   ├── github/
│   │   ├── github-app.client.ts   # app JWT, installation tokens, read-only calls
│   │   ├── webhook/               # raw-body signature check, delivery dedupe, controller
│   │   └── install/               # install redirect, setup callback
│   ├── installations/             # installation lifecycle + reconcile
│   ├── repositories/              # sync, enable/disable, eligibility
│   ├── audit/
│   ├── queue/                     # BullMQ producers and processors
│   ├── observability/             # logging, redaction, request/job correlation
│   └── worker.ts                  # worker entry point (same image as API)
├── prisma/
│   ├── schema.prisma
│   └── migrations/                # version-controlled SQL migrations
└── test/
    ├── unit/
    ├── integration/               # Postgres + Redis containers
    ├── contract/                  # OpenAPI and webhook contract checks
    └── fakes/                     # fake GitHub server, signed payload builders

frontend/
├── src/
│   ├── app/                       # sign-in, installations, installation detail
│   ├── components/
│   └── lib/                       # typed API client (cookie-based, no tokens)
└── tests/                         # component tests, Playwright journeys

deploy/
├── docker-compose.yml
├── nginx/
└── env.example                    # names only, no values
```

**Structure Decision**: Web application layout (frontend + backend). The worker is a second entry point of the backend codebase and image, so there is one backend to build and test. `deploy/` holds the Compose definition required by ADR-015.

## Complexity Tracking

No constitution violations to justify.
