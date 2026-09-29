# Quickstart: Validating Feature 001

Run guide for proving the feature end to end. It contains no implementation code. Contracts: [contracts/api.openapi.yaml](contracts/api.openapi.yaml), [contracts/webhooks.md](contracts/webhooks.md). Entities: [data-model.md](data-model.md).

## Prerequisites

- Docker with Compose; Node.js LTS; a package manager available in the repo
- No GitHub account, real installation or GitHub App is needed for automated validation

## A. Automated validation (no real GitHub)

1. Start the local stack: PostgreSQL, Redis, the fake GitHub server, API and worker (`deploy/docker-compose.yml`, test profile).
2. Apply migrations from `backend/prisma/migrations`.
3. Run the backend unit, integration and contract suites.
4. Run the frontend component tests and the Playwright journeys against the stack.

**Expected outcomes** (spec success criteria in brackets):

| Scenario | Expected |
|----------|----------|
| Sign in with a new fake GitHub user, then sign in again | One account, same ID both times [US1] |
| Complete a fake installation with 3 of 5 repositories | Installation and exactly 3 repositories visible, all disabled [US2, SC-002] |
| Send a fixture with a bad or missing signature | `401`, no rows changed, rejection logged without body [SC-004] |
| Send the same signed fixture 10 times (some concurrently) | State equals one delivery; no duplicate rows or audit entries [SC-005] |
| Run sync 10 times against unchanged fake GitHub | No changes after the first run [SC-006] |
| Enable, then disable a repository | State follows the final action; audit entries recorded; eligibility false immediately after disable [SC-008] |
| Remove a repository on the fake GitHub, then sync | Repository INACCESSIBLE and disabled; row kept |
| Deliver `installation` `deleted` | Installation REMOVED, all repositories ineligible within 1 minute [SC-009] |
| Two users in different organizations request each other's IDs | `404` in both directions [SC-007] |
| MEMBER calls enable or sync | `403`; state unchanged |
| Search API responses, HTML and logs for secret values | None found [SC-010] |

## B. Manual validation against real GitHub (optional, staging)

1. Register a GitHub App with only the read permissions this feature needs (repository metadata, plus the read-only membership permission confirmed in the T007 spike); and do not grant Pull requests or Issues write yet. Set the webhook URL to `https://<host>/api/webhooks/github` and choose a webhook secret.
2. Provide the app ID, client ID/secret, private key file, webhook secret and session secret through the environment or mounted files on the host (never in Git). `deploy/env.example` lists the names.
3. Start the stack with `docker compose up` on the host, open the site, sign in, choose Install, select two repositories on GitHub.
4. Confirm the installation and both repositories appear; enable one; remove the other on GitHub and confirm it becomes inaccessible; uninstall the app and confirm the installation shows removed.

## C. Regression guard for future features

Any future review feature must call the eligibility gate before doing work. Its tests must include: disabled, inaccessible, suspended and removed cases all return not eligible.
