# GitHub App registration (Feature 001)

This document is the source for how the CodeLens GitHub App must be registered for Feature 001. It lists names and settings only; never write secret values here.

## Principle

Register the app with only the read permissions this feature needs (spec FR-032, FR-039). Write permissions that ADR-006 lists for later features (pull requests, issues) are not requested until a feature that needs them is specified.

## Permissions

The startup permission check (`backend/src/github/allowed-permissions.ts`) MUST list exactly this table. Any permission granted to the app that is not in this table, or that is `write` or `admin`, makes the API and worker refuse to start.

| Scope | Permission | Access | Why |
|-------|------------|--------|-----|
| Repository | Metadata | Read | List repositories reachable through an installation (mandatory for every GitHub App) |
| Organization | Members | Read | **Pending.** Needed to confirm whether a user is an organization owner (FR-035 to FR-038). Add only after task T008 confirms the exact permission and T009 records it in ADR-006 |

No other permission is granted for this feature. In particular: no Contents, Pull requests, Issues, Actions, Workflows or Administration access.

## Subscribed events

- `installation`
- `installation_repositories`
- `repository`

## URLs and options

| Setting | Value |
|---------|-------|
| Setup URL (post installation) | `https://<host>/api/installations/callback` |
| Request user authorization (OAuth) during installation | **Enabled** (the callback needs the one-time `code`; see `specs/001-github-app-onboarding/contracts/api.openapi.yaml`) |
| Callback URL (user sign-in) | `https://<host>/api/auth/github/callback` |
| Webhook URL | `https://<host>/api/webhooks/github` |
| Webhook active | Yes |
| Expire user authorization tokens | Yes (default) |

## Secrets to generate (names only)

Set these through the host environment or mounted files, never in Git (see `deploy/env.example`):

- `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`
- `GITHUB_APP_PRIVATE_KEY_FILE` (path to the downloaded private key, mounted read-only with mode 0400)
- `GITHUB_WEBHOOK_SECRET` (a long random value)
- `SESSION_SECRET` (a long random value)
