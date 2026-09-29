# Webhook Contract: GitHub to CodeLens

Endpoint: `POST /api/webhooks/github` (see [api.openapi.yaml](api.openapi.yaml)).

## Authenticity

1. Read the **raw** request body.
2. Compute HMAC-SHA-256 of the raw body with the webhook secret; compare with `X-Hub-Signature-256` (`sha256=<hex>`) in constant time.
3. Missing header, wrong format or mismatch → `401`, no parsing, no state change. Log: reason, delivery ID if present, hashed source address. Never log the body, header value or secret.
4. Only after a valid signature: require `X-GitHub-Event` and `X-GitHub-Delivery`; otherwise `400`.

## Deduplication

Insert `X-GitHub-Delivery` into `webhook_deliveries` (unique). If it already exists → respond `202` and do nothing else.

## Events handled

| Event / action | Effect |
|----------------|--------|
| `installation` / `created` | Enqueue `reconcile` for the installation (upsert installation and organization, then sync). Audit `GITHUB_INSTALLATION_ADDED` once |
| `installation` / `deleted` | Enqueue `reconcile`; a not-found answer from GitHub is treated as removal. Installation `REMOVED`, repositories inaccessible and disabled. Audit `GITHUB_INSTALLATION_REMOVED` once |
| `installation` / `suspend`, `unsuspend` | Reconcile status. Audit suspended/unsuspended once per transition |
| `installation_repositories` / `added`, `removed` | Enqueue `sync` for the installation |
| `repository` / `renamed`, `transferred`, `publicized`, `privatized`, `deleted` | Enqueue `sync` for the installation |
| Any other event | Recorded as `IGNORED`; `202` |

Handlers never copy state from the payload. The payload supplies only the installation ID used to reconcile against GitHub.

## Response and timing

- `202` for any accepted or repeated delivery, within the GitHub timeout (target under 2 s p95, hard limit 10 s).
- All GitHub API calls and database writes beyond the delivery record happen in the worker.

## Queue jobs

| Job | Job ID | Concurrency |
|-----|--------|-------------|
| `reconcile-installation` | `reconcile:<githubInstallationId>` | One write phase per installation (advisory lock) |
| `sync-repositories` | `sync:<githubInstallationId>` | Same lock |

Failed jobs retry with exponential backoff (up to 5 attempts); after the last attempt the installation `sync_status` is `FAILED` with an error code.

## Test fixtures

Signed fixtures for each event above, plus: bad signature, missing signature, duplicate delivery, two concurrent duplicates, out-of-order (repositories event before installation event), and deleted-before-created.
