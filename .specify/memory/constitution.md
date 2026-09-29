<!--
Sync Impact Report
Version change: (unratified template) → 1.0.0
Modified principles: none (initial ratification; all 18 principles newly defined)
Added sections: Core Principles (I–XVIII), Architecture Baseline & Constraints,
  Development Workflow & Quality Gates, Governance
Removed sections: none (template placeholders replaced)
Follow-up TODOs (baseline gaps found while verifying against ADR/ERD; NOT redesigned here,
  each needs an ADR/ERD update per Principle XV before a feature relies on it):
  - ERD `repository_config_versions` fields (author_login, state, opened_at, closed_at)
    look copied from pull_requests and cannot record a config snapshot. Principle X needs
    a config version/hash that `reviews` can reference.
  - ERD `reviews` has no config-version reference, and `review_jobs` has no profile column;
    the ADR-011 idempotency key includes review profile (may be encoded in the key).
  - ADR-011 lists `review_type` in the review context; the idempotency key example does not.
  - ERD requires only "an appropriate uniqueness/index strategy" for
    `review_findings.fingerprint`; the exact strategy is undecided.
  - ADR-005 pipeline ends "Confidence Filtering"; this constitution adds a validation step.
    Confirm in the next ADR revision.
-->
# CodeLens Constitution

## Core Principles

### I. GitHub App First (NON-NEGOTIABLE)
CodeLens MUST integrate with GitHub primarily as a GitHub App (ADR-001, ADR-016). Installation
permissions are a security boundary. A user's personal GitHub token MUST NOT be the primary
application authorization mechanism. GitHub OAuth is for user login only, and user identity
stays separate from installation identity (ADR-009). GitHub Actions MAY be added later as an
optional mechanism, never as the primary architecture.

### II. Least Privilege (NON-NEGOTIABLE)
GitHub permissions MUST follow least privilege (ADR-006). The initial set is Metadata: Read,
Contents: Read, Pull Requests: Write, and Issues: Read/Write only where required. Write access
to Contents, Actions, Workflows or Administration MUST NOT be requested unless a concrete
feature requires it, and then only through the Principle XV process plus a security review.
The initial review system MUST NOT automatically modify repository files, modify GitHub Actions
workflows, modify repository settings, or merge pull requests. AI review is advisory (ADR-013).

### III. Multi-Tenant Isolation (NON-NEGOTIABLE)
Organization, installation, repository, review, finding, configuration, credential and usage
data MUST always be accessed through an authorization context (ADR-017). Every resource query
MUST be scoped by that context. No tenant data may cross organization boundaries, including in
queues, caches, logs and prompts. Cross-tenant access MUST have negative tests.

### IV. Repository Content Is Untrusted (NON-NEGOTIABLE)
Source code, READMEs, issues, PR descriptions, comments, commit messages, documentation and
repository configuration (including `.codelens.yml`) are untrusted input (ADR-018). They MUST
NOT override system-level security instructions. The prompt assembly layer MUST keep these
distinct: system instructions, application policies, review rules, repository configuration,
and repository content. Repository content MUST be passed as delimited data, never as
instructions. Repository configuration MUST NOT relax organization security policies (ADR-007).

### V. AI Provider Abstraction
Business logic MUST NOT depend on Anthropic-specific APIs. All model access goes through a
`ModelProvider` interface (ADR-004). Anthropic Claude is the initial provider. OpenAI and
Google MUST be addable by adding a provider, without redesigning the review domain.

### VI. Task-Based Model Routing
Models MUST NOT be hard-coded in review business logic. Resolution follows: review task →
model routing policy → provider → model. Tasks include PR summary, code review, security
review, architecture review, issue analysis and PR chat. Model names are configuration data
(`model_configs`, `model_task_routes`), and routing MUST NOT be ambiguous (ERD §16).

### VII. Structured AI Output (NON-NEGOTIABLE)
LLM output MUST NEVER be published directly to GitHub (ADR-005). The pipeline is: LLM →
structured output → schema validation → normalization → deduplication → validation/filtering
(including confidence filtering) → GitHub publication. Malformed output MUST be rejected or
retried, never published. Deterministic static-analysis findings stay a separate concept from
AI findings (ADR-014).

### VIII. Review / Job / Finding Separation
ReviewJob (asynchronous execution), Review (the logical review), ReviewModelRun (one model
execution for one task) and ReviewFinding (the atomic finding) MUST remain separate concepts
in code and schema (ADR-012, ERD §9–11). A retry MUST reuse or resume the existing logical
Review and MUST NOT create a duplicate.

### IX. Idempotency (NON-NEGOTIABLE)
GitHub webhooks can be delivered more than once, so webhook handling and review execution MUST
be idempotent (ADR-010, ADR-011). A review is bound to repository, pull request, commit SHA,
review type and review configuration/profile. `review_jobs.idempotency_key` MUST be unique. A
new commit creates a new review context. A stale job MUST NOT publish findings against a newer
commit; the head SHA MUST be re-checked immediately before publication.

### X. Repository Configuration
Repository review configuration is `.codelens.yml` (ADR-007), resolved as: system defaults →
organization defaults → repository file → explicit runtime override. Configuration MUST be
schema-validated, versioned and reproducible. Each review MUST record which configuration
version it used, so historical reviews stay explainable after the file changes.

### XI. Secrets (NON-NEGOTIABLE)
API keys, GitHub App private keys, webhook secrets, OAuth secrets and session secrets MUST NOT
be stored or logged as plaintext (ADR-008). Only encrypted values or secret references may be
persisted. Secrets MUST NOT be returned to frontend clients, included in prompts, written to
Git, or written to ordinary application logs or audit logs. Webhook signatures MUST be
verified before any payload is processed. Secret access MUST sit behind an abstraction that
allows later migration to AWS Secrets Manager.

### XII. Testing
Every feature MUST include appropriate automated tests. Security-sensitive and state-changing
functionality MUST have both unit and integration coverage. Webhook processing MUST be testable
without a real GitHub installation (signed fixture payloads, fake GitHub client). AI
integrations MUST be mockable behind the provider interface, and tests MUST NOT call live
model APIs by default.

### XIII. Observability
Every review execution MUST be traceable by review ID and job ID (ADR-019). Operational records
MUST include: review ID, job ID, repository, pull request, commit SHA, provider, model, task,
latency, token usage, estimated cost and status. Repository content and credentials MUST NOT be
written to logs. Logs and audit entries MUST be structured.

### XIV. Database Integrity
Migrations MUST be version controlled, and production schema MUST NOT be changed manually.
Foreign keys, uniqueness constraints and indexes from the architecture baseline (ERD §16–17)
MUST be preserved unless an ADR explicitly changes them. This includes the unique GitHub IDs,
the unique `review_jobs.idempotency_key`, and the fingerprint-based finding deduplication. GitHub
remains the source of truth for GitHub state, and the local database is a cache of it (ERD §18).

### XV. Architecture Changes
A feature specification MUST NOT silently introduce an architectural pattern that conflicts
with an ADR (ADR-020). When a feature needs an architectural change, the order is: ADR update →
specification update → plan update → implementation. Plans MUST include a check against
this constitution and the ADRs.

### XVI. Simplicity for MVP
The MVP MUST minimize operational complexity. The deployment target is a single AWS EC2
instance running Docker Compose (Nginx, Next.js, NestJS API, review worker, PostgreSQL,
Redis; ADR-015). Kubernetes, microservices, event buses and managed AWS services (ECS, RDS,
ElastiCache, NAT Gateway) MUST NOT be introduced without a documented concrete requirement
and an ADR. The design MUST still permit later migration to managed services.

### XVII. Security Over Convenience
When a convenient implementation and a safer one conflict, the specification or plan MUST
document the trade-off explicitly, and the safer option is the default unless the trade-off
is accepted in writing in that document.

### XVIII. Product Evolution
The architecture MUST preserve the ability to evolve toward GitHub Marketplace distribution,
multi-provider AI, organization-level policies, usage limits, subscriptions, advanced code
intelligence, automatic fixes and PR chat. Future functionality MUST NOT be implemented
prematurely unless the current feature requires it. Preserving the ability means keeping the
existing seams (Principles V, VI, XIV), not building unused features.

## Architecture Baseline & Constraints

The authoritative baseline is `docs/adr/0001-architecture.md` (ADR-001 to ADR-020, v0.1) and
`docs/architecture/database-erd.md`. Baseline technology choices: Node.js, TypeScript and
NestJS for the backend; Next.js, React, Tailwind CSS and shadcn/ui for the frontend; PostgreSQL;
Redis with BullMQ for asynchronous jobs; Anthropic Claude as the initial provider; GitHub OAuth
for user login. Tenant boundaries are User, Organization, GitHub Installation and Repository.
BYOK provider keys are stored only as encrypted values or secret references.

## Development Workflow & Quality Gates

- Work follows Spec Kit: specify → clarify → plan → tasks → implement.
- Every plan MUST pass a Constitution Check against Principles I–XVIII. Violations require a
  documented justification, or an ADR change under Principle XV.
- Pull requests MUST show passing automated tests. Changes touching authorization, webhooks,
  secrets, prompt assembly, publication or migrations require unit and integration tests.
- Security trade-offs (Principle XVII) are recorded in the spec or plan.

## Governance

This constitution supersedes other practices and specifications. It is subordinate to accepted
ADRs only in that it does not restate their detail. If the two conflict, the conflict MUST be
resolved by amending an ADR or this document before implementation continues.

- **Amendment**: propose the change in a pull request that updates this file, the affected
  ADR/ERD documents, and any dependent templates. Principle removals or redefinitions need
  explicit maintainer approval.
- **Versioning**: semantic versioning. MAJOR for backward-incompatible removals or
  redefinitions; MINOR for new or materially expanded principles or sections; PATCH for
  clarifications and wording.
- **Compliance**: specs, plans and pull request reviews MUST verify compliance. Unjustified
  complexity or violations block merge.

**Version**: 1.0.0 | **Ratified**: 2026-09-29 | **Last Amended**: 2026-09-29
