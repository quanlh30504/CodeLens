# Deployment (single EC2 instance, Docker Compose)

This is the deployment described by ADR-015: one host, Docker Compose, no managed services.
Services: `nginx`, `web`, `api`, `worker`, `postgres`, `redis`, and a one-shot `migrate`.

## Before you start

- A host with Docker and the Compose plugin, and a DNS name pointing at it. Terminate TLS in front
  of Nginx (load balancer or a certificate on the host) so the site is served over HTTPS; cookies
  are marked `Secure` when `PUBLIC_BASE_URL` starts with `https://`.
- The GitHub App registered as described in [github-app-registration.md](github-app-registration.md):
  read-only permissions only, the three subscribed events, and "Request user authorization (OAuth)
  during installation" enabled.

## Provisioning secrets

Secrets are never stored in Git, in images or in the repository. Names are in
[env.example](env.example); values live only on the host.

1. Create a directory outside the repository and the build context, for example `/etc/codelens`,
   owned by root with mode `0700`.
2. Save the GitHub App private key you downloaded from GitHub as `/etc/codelens/github-app.pem`
   with mode **`0400`**:

   ```sh
   sudo install -m 0400 -o root -g root github-app.pem /etc/codelens/github-app.pem
   ```

3. Create `/etc/codelens/codelens.env` (mode `0600`, root) with the variables from `env.example`.
   Generate `GITHUB_WEBHOOK_SECRET`, `SESSION_SECRET` and `POSTGRES_PASSWORD` as long random values
   (for example `openssl rand -base64 48`). Use the same webhook secret in the GitHub App settings.
4. Point Compose at them; the key is mounted read-only into `api` and `worker` only:

   ```sh
   export GITHUB_APP_PRIVATE_KEY_HOST_PATH=/etc/codelens/github-app.pem
   docker compose --env-file /etc/codelens/codelens.env -f deploy/docker-compose.yml up -d --build
   ```

Compose refuses to start when a required variable is missing, and the API and worker refuse to
start when a secret is missing or the GitHub App holds a permission that is not read-only and in
the allow-list (`backend/src/github/allowed-permissions.ts`).

Never put the key or any secret in `docker-compose.yml`, a Dockerfile, `deploy/env.example` or a
committed file. The repository's secret scan (`.github/workflows/secret-scan.yml`) fails the build
if private-key material is found in tracked files or in built images.

## Database migrations

The `migrate` service applies the committed migrations (`backend/prisma/migrations`) before `api`
and `worker` start. Do not change the schema by hand in production (Constitution XIV); add a
migration, review it, and redeploy.

## Rotating a secret

Secrets are read from the environment or mounted files at start, so rotating one is: update the
value on the host and the GitHub App settings, then `docker compose ... up -d` to restart `api` and
`worker`. Rotating `SESSION_SECRET` signs everyone out. A full rotation procedure is out of scope
for this feature (spec Assumptions).

## Logs and retention

Services write structured JSON logs to standard output. Logs never contain request bodies,
tokens, keys, repository content or account names.

- **Keep webhook rejection records (`webhook rejected` lines) for at least 30 days.** They hold only
  the time, the reason, the GitHub delivery id if present, and a keyed fingerprint of the sender
  address (spec US5 scenario 1). Configure the Docker logging driver or your log shipper for that
  retention, for example:

  ```yaml
  # /etc/docker/daemon.json
  { "log-driver": "local", "log-opts": { "max-size": "50m", "max-file": "30" } }
  ```

  Size `max-file` so that 30 days of rejection lines are retained, or ship logs to storage with a
  30-day minimum.
- A metrics line (counters and timing summaries only) is written once a minute.

## Redis persistence

Redis runs with append-only persistence so sessions and queued jobs survive a restart.

## Local end-to-end run with a fake GitHub

`docker compose --profile test up` also starts the fake GitHub used in automated tests. It is for
local runs only and must never run in production.
