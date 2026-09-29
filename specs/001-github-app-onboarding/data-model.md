# Data Model: GitHub App Installation and Repository Onboarding

Source of truth for the baseline: [docs/architecture/database-erd.md](../../docs/architecture/database-erd.md). This document lists only the tables this feature uses and the **additive** changes it needs. Existing constraints are preserved (Constitution XIV).

## Tables used

| Table | Use in this feature |
|-------|---------------------|
| `users` | Account created at first sign-in; `github_user_id` unique |
| `organizations` | Tenant; one row per GitHub organization or personal account, `github_org_id` unique |
| `organization_members` | Links users to organizations with `OWNER` / `MEMBER` |
| `github_installations` | One row per GitHub App installation; `github_installation_id` unique |
| `repositories` | Repositories reported by an installation; `github_repository_id` and `full_name` unique |
| `audit_logs` | Installation lifecycle and enable/disable actions |
| `webhook_deliveries` | **New.** Delivery deduplication and trace |

## Baseline amendments (merged into the ERD as Amendment 1, §21; Principle XV)

The ERD already had `github_installations.status`, `account_type`, `suspended_at` and `repositories.status`. What was missing, and is now merged:

1. **New table `webhook_deliveries`** (below).
2. **`github_installations`** add: `repository_selection` (`ALL` | `SELECTED`), `sync_status` (`PENDING` | `SYNCING` | `SYNCED` | `FAILED`), `sync_error_code` (nullable, no free text from GitHub; includes `REPOSITORY_LIMIT_EXCEEDED`, set with `sync_status = SYNCED` when more than 5,000 repositories exist and only the 5,000 lowest GitHub repository IDs are stored), `last_synced_at`, `removed_at`. Allowed `status` values: `ACTIVE`, `SUSPENDED`, `REMOVED`.
3. **`repositories`** add: `review_enabled` (boolean, default false), `enabled_at`, `enabled_by_user_id` (nullable FK to `users`), `last_synced_at`, `sync_conflict` (boolean, default false; operator diagnostics only, never returned by the API). Allowed `status` values (GitHub access only): `ACCESSIBLE`, `INACCESSIBLE`. Keeping GitHub access separate from the CodeLens choice avoids overloading one column.
4. **`audit_logs.action`** new values: `GITHUB_INSTALLATION_SUSPENDED`, `GITHUB_INSTALLATION_UNSUSPENDED`, `REPOSITORY_SYNC_FAILED` (in addition to `GITHUB_INSTALLATION_ADDED`, `GITHUB_INSTALLATION_REMOVED`, `REPOSITORY_ENABLED`, `REPOSITORY_DISABLED`).
5. **`organization_members`** add: `role_verified_at` (timestamp; last time GitHub confirmed the role). Allowed `role` values for this feature: `OWNER`, `MEMBER`.
6. **`organizations`** for personal accounts: stored as rows keyed by the GitHub account ID in `github_org_id`, with a `account_type` (`ORGANIZATION` | `USER`) column. This keeps the existing unique constraint valid.

## webhook_deliveries (new)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `delivery_guid` | varchar UNIQUE | GitHub's delivery ID header |
| `event` | varchar | e.g. `installation`, `installation_repositories` |
| `action` | varchar nullable | e.g. `created`, `deleted` |
| `github_installation_id` | bigint nullable | Parsed after signature check |
| `payload_sha256` | varchar | Hash only; the body is not stored |
| `status` | varchar | `RECEIVED`, `PROCESSED`, `IGNORED`, `FAILED` |
| `error_code` | varchar nullable | Code only |
| `received_at` | timestamp | |
| `processed_at` | timestamp nullable | |

Index: `(github_installation_id, received_at)`. No payload and no secrets are stored.

## Constraints and indexes (this feature)

- Keep: `users.github_user_id`, `organizations.github_org_id`, `github_installations.github_installation_id`, `repositories.github_repository_id`, `repositories.full_name` unique; baseline indexes in ERD §17.
- Add: unique `(organization_id, user_id)` on `organization_members`.
- Add: index `repositories(installation_id, status)`.
- Add: check constraint `review_enabled = false OR status = 'ACCESSIBLE'` on `repositories`, so an inaccessible repository can never be enabled.
- Add: `repositories.organization_id` must equal the organization of `repositories.installation_id` (enforced in the write path and asserted by an integration test; a composite foreign key can enforce it if the ERD adds `(id, organization_id)` uniqueness on installations).

## State transitions

**Installation `status`**

```text
(none) --created/callback--> ACTIVE
ACTIVE --suspend--> SUSPENDED --unsuspend--> ACTIVE
ACTIVE|SUSPENDED --deleted--> REMOVED
(REMOVED is terminal; reinstall creates a new row with a new GitHub installation ID in the same organization)
```

**Installation `sync_status`**: `PENDING` → `SYNCING` → `SYNCED` | `FAILED`; a retry or a new event moves `FAILED`/`SYNCED` back to `SYNCING`.

**Repository**

```text
(none) --first reported--> ACCESSIBLE, review_enabled=false
ACCESSIBLE --owner enables--> review_enabled=true
review_enabled=true --owner disables--> review_enabled=false
ACCESSIBLE --no longer reported--> INACCESSIBLE, review_enabled=false
INACCESSIBLE --reported again--> ACCESSIBLE, review_enabled=false (must be re-enabled)
any --transferred, previous installation has no access (confirmed with GitHub)--> reassigned to the new organization and installation, ACCESSIBLE, review_enabled=false, enabled_at and enabled_by_user_id cleared
```

Installation `REMOVED` sets all its repositories to `INACCESSIBLE` and `review_enabled=false`. A `SUSPENDED` installation keeps repository flags but the eligibility function returns false.

## Display states (spec FR-041)

| Shown to user | Derived from |
|---------------|--------------|
| Setting up | `status = ACTIVE`, `sync_status` in (`PENDING`, `SYNCING`) and `last_synced_at` is null |
| Active | `status = ACTIVE`, `sync_status = SYNCED`, `sync_error_code` null (or a later `SYNCING`) |
| Active – synchronization failed | `status = ACTIVE`, `sync_status = FAILED`; reason from `sync_error_code`: `GITHUB_UNAVAILABLE`, `GITHUB_RATE_LIMITED`, `ACCESS_REVOKED`, `OTHER` |
| Active – repository limit reached | `status = ACTIVE`, `sync_status = SYNCED`, `sync_error_code = REPOSITORY_LIMIT_EXCEEDED` |
| Suspended | `status = SUSPENDED` |
| Removed | `status = REMOVED` |

Repository: *Enabled* = `ACCESSIBLE` and `review_enabled`; *Disabled* = `ACCESSIBLE` and not `review_enabled`; *No longer accessible* = `INACCESSIBLE`.

## Eligibility rule

```text
eligible = repositories.status = 'ACCESSIBLE'
       AND repositories.review_enabled
       AND github_installations.status = 'ACTIVE'
```

## Validation rules

- GitHub identifiers are numeric and stored as received; names are display data only and may change.
- `state` values in the install flow are single-use and expire after 10 minutes (held in Redis, not the database).
- Enable, disable and sync require role `OWNER` in the repository's organization, confirmed with GitHub within the last 10 minutes (`role_verified_at`).
- Error text from GitHub is never stored; only codes.
