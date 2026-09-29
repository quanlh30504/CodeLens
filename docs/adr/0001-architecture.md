# CodeLens — Architecture Decision Record

**Status:** Accepted — Architecture Baseline v0.1
**Date:** 2026-09-29
**Scope:** Initial architecture for CodeLens AI Code Review Platform
**Primary Goal:** Build a GitHub-native AI code review platform that can eventually be distributed through GitHub Marketplace.

---

# ADR-001 — Product Architecture

## Context

CodeLens is intended to provide AI-powered review capabilities similar to modern AI code-review products.

The system must support:

* GitHub repository integration
* Automatic Pull Request review
* Issue analysis
* Repository-specific rules
* `.codelens.yml` configuration
* AI model configuration
* Per-task model routing
* User authentication
* Organization/repository management
* Review history
* Review findings
* Future PR chat
* Future codebase intelligence
* Future automatic fixes
* Future GitHub Marketplace distribution

The system should initially be deployable on a single low-cost AWS EC2 instance.

## Decision

CodeLens will be implemented as a **GitHub App + SaaS backend**.

GitHub App is the primary integration mechanism.

GitHub Actions may be supported later as an optional execution/integration mechanism, but it will not be the primary architecture.

## Architecture

```text
GitHub
   │
   │ Webhook
   ▼
CodeLens GitHub App
   │
   ▼
API / Webhook Layer
   │
   ▼
Review Queue
   │
   ▼
Review Orchestrator
   │
   ├── GitHub Context Provider
   ├── Repository Configuration Provider
   ├── Rule Engine
   ├── Context Engine
   ├── Model Router
   └── Review Validator
           │
           ▼
      Claude API
           │
           ▼
    Structured Findings
           │
           ▼
     GitHub Publisher
           │
           ▼
      PR / Issue
```

## Rationale

GitHub App provides:

* installation-scoped repository access
* granular permissions
* webhook-based event delivery
* organization-level installation
* Marketplace distribution capability
* separation between GitHub identity and CodeLens infrastructure

This allows users to install CodeLens without copying a workflow into every repository.

## Consequences

### Positive

* One installation can cover multiple repositories.
* No workflow file is required for the basic integration.
* Suitable for GitHub Marketplace.
* Repository permissions are controlled by GitHub App installation.
* Backend can evolve independently from GitHub Actions.

### Negative

* Backend infrastructure is required.
* Webhook reliability must be handled.
* GitHub App authentication/token lifecycle must be implemented.
* Security boundary is more complex than a simple GitHub Action.

---

# ADR-002 — Backend Technology

## Decision

The initial backend will use:

* Node.js
* TypeScript
* NestJS

## Rationale

The CodeLens backend is primarily an integration/orchestration service involving:

* GitHub API
* GitHub webhooks
* OAuth
* LLM APIs
* asynchronous jobs
* JSON schemas
* streaming
* external APIs

TypeScript provides strong ecosystem support for these workloads while maintaining type safety.

NestJS provides:

* modular architecture
* dependency injection
* controllers/services
* guards
* validation
* testing support
* clear separation of concerns

## Alternative Considered

### Java + Spring Boot

Advantages:

* strong enterprise ecosystem
* excellent concurrency and transaction support
* strong developer familiarity

Disadvantages for the initial product:

* more implementation overhead for the AI/API integration layer
* less direct alignment with the JavaScript/TypeScript GitHub/AI SDK ecosystem

Java remains a valid future option for dedicated high-throughput services.

---

# ADR-003 — Frontend Technology

## Decision

Use:

* Next.js
* React
* TypeScript
* Tailwind CSS
* shadcn/ui

## Scope

The frontend will provide:

* GitHub login
* onboarding
* installation management
* repository management
* AI provider configuration
* model configuration
* task/model routing
* review profiles
* review history
* usage/cost information
* organization settings

---

# ADR-004 — AI Provider Architecture

## Decision

Anthropic Claude is the initial AI provider.

The application MUST expose a provider abstraction:

```text
ModelProvider
    │
    ├── AnthropicProvider
    ├── OpenAIProvider       future
    └── GoogleProvider       future
```

The application MUST NOT directly couple business logic to Anthropic-specific APIs.

## Model Routing

The system must support:

```text
Review Task
     │
     ▼
Model Policy
     │
     ▼
Provider
     │
     ▼
Model
```

Example:

```text
PR_SUMMARY          → Claude Haiku
CODE_REVIEW         → Claude Sonnet
SECURITY_REVIEW     → Claude Sonnet
ARCHITECTURE_REVIEW → configurable
ISSUE_ANALYSIS      → Claude Haiku
PR_CHAT             → Claude Sonnet
```

The exact model names must be configuration data rather than hard-coded business logic.

## Consequence

CodeLens can later support multiple providers without redesigning the review engine.

---

# ADR-005 — AI Output Contract

## Decision

LLMs MUST NOT directly produce arbitrary text that is immediately published to GitHub.

The AI layer must return validated structured output.

Example conceptual schema:

```json
{
  "findings": [
    {
      "severity": "HIGH",
      "category": "SECURITY",
      "file": "src/PaymentService.java",
      "line": 124,
      "title": "Potential duplicate payment processing",
      "description": "...",
      "suggestion": "...",
      "confidence": 0.94
    }
  ]
}
```

Pipeline:

```text
LLM
 ↓
Structured Output
 ↓
Schema Validation
 ↓
Finding Normalization
 ↓
Deduplication
 ↓
Confidence Filtering
 ↓
GitHub Publisher
```

## Rationale

This prevents malformed model output from directly affecting GitHub.

It also allows deterministic testing.

---

# ADR-006 — GitHub App Permissions

## Decision

Initial permissions follow least privilege.

Target initial permissions:

```text
Metadata          Read
Contents          Read
Pull Requests     Write
Issues            Read/Write where required
```

The following permissions are NOT granted initially:

```text
Contents          Write
Actions            Write
Workflows          Write
Administration     Write
```

They may be introduced only when a feature explicitly requires them.

## Rationale

The AI reviewer must not automatically gain the ability to:

* modify repository code
* modify workflows
* change repository settings
* execute arbitrary GitHub Actions
* merge Pull Requests

---

# ADR-007 — Repository Configuration

## Decision

CodeLens repositories may define:

```text
.codelens.yml
```

The file is version controlled and is the repository-level source of truth for review configuration.

Example:

```yaml
version: 1

review:
  enabled: true
  profile: backend

  severity:
    minimum: medium

rules:
  security: true
  performance: true
  architecture: true
  testing: true

paths:
  include:
    - "src/**"

  exclude:
    - "**/generated/**"
    - "**/target/**"

models:
  tasks:
    pr_summary: claude-haiku
    code_review: claude-sonnet
    security_review: claude-sonnet
```

## Configuration hierarchy

```text
System defaults
      ↓
Organization defaults
      ↓
Repository .codelens.yml
      ↓
Explicit runtime override
```

Higher-level configuration MUST NOT silently violate security policies defined by the organization.

---

# ADR-008 — Secrets Management

## Decision

Provider API keys, GitHub App private keys, webhook secrets, OAuth secrets and session secrets MUST NOT be stored as plaintext application data.

Initial deployment:

```text
AWS EC2
   │
   ├── environment/secrets injection
   └── encrypted persistent storage where required
```

For production evolution:

```text
AWS Secrets Manager
```

The architecture must allow migration to Secrets Manager without changing business logic.

## BYOK

CodeLens supports Bring Your Own Key.

Users can configure:

```text
Anthropic API Key
```

The application stores only an encrypted representation or secure secret reference.

Secrets MUST NEVER be:

* logged
* returned through API responses
* included in LLM prompts
* exposed to frontend JavaScript
* stored in Git

---

# ADR-009 — Authentication

## Decision

GitHub OAuth is the initial user authentication mechanism.

```text
User
 ↓
Login with GitHub
 ↓
GitHub OAuth
 ↓
CodeLens identity
```

GitHub App installation identity is separate from the CodeLens user identity.

Conceptually:

```text
User
 │
 ├── CodeLens account
 │
 └── GitHub identity
       │
       └── GitHub App installations
              │
              └── repositories
```

This distinction is required because:

* multiple users may belong to one organization
* one user may access multiple organizations
* an installation is an organization/repository authorization boundary

---

# ADR-010 — Asynchronous Review Processing

## Decision

Pull Request reviews will be processed asynchronously.

```text
GitHub Webhook
      ↓
Validate
      ↓
Persist Review Job
      ↓
Queue
      ↓
Worker
      ↓
AI Review
      ↓
Publish Result
```

Redis + BullMQ will be used initially.

## Rationale

AI review may take seconds or minutes.

Webhook handlers must not wait for LLM processing.

This also provides:

* retries
* concurrency control
* backpressure
* idempotency
* job status

---

# ADR-011 — Review Idempotency

## Decision

Every review execution is associated with:

```text
repository
pull_request
commit_sha
review_type
```

The system must prevent duplicate processing for the same logical review.

Example idempotency key:

```text
installation_id:
repository_id:
pull_request_number:
head_sha:
review_profile:
```

A new commit creates a new review context.

Old review jobs must not publish findings against a newer commit.

---

# ADR-012 — Review Model

A review consists of:

```text
Review
 ├── context
 ├── model configuration
 ├── execution metadata
 └── findings
```

Each finding is independently persisted.

This allows:

* finding history
* deduplication
* resolution tracking
* false-positive analysis
* analytics
* future model evaluation

---

# ADR-013 — AI Review Is Advisory

## Decision

AI review does not automatically:

* approve PRs
* merge PRs
* modify repository settings
* push code
* modify workflows

Initial output:

```text
Comment
Inline Review
Summary
```

Any future write operation must require an explicit feature and security review.

---

# ADR-014 — Static Analysis Separation

## Decision

Deterministic static-analysis findings and AI findings are separate concepts.

Architecture:

```text
              Review
                │
        ┌───────┴────────┐
        ▼                ▼
   AI Analysis      Static Analysis
        │                │
        └───────┬────────┘
                ▼
          Finding Engine
```

Static-analysis integrations may include:

* ESLint
* Semgrep
* PMD
* SpotBugs
* Checkstyle

depending on repository language.

The AI model must not be treated as a replacement for deterministic tooling.

---

# ADR-015 — Deployment Strategy

## Decision

MVP will use Docker Compose on one AWS EC2 instance.

Initial components:

```text
Nginx
Next.js
NestJS API
Review Worker
PostgreSQL
Redis
```

Conceptually:

```text
Internet
   │
   ▼
Nginx
   │
   ├── Web
   └── API
        │
        ├── PostgreSQL
        └── Redis
```

No Kubernetes, ECS, RDS, ElastiCache or NAT Gateway will be introduced in the initial MVP unless required.

## Rationale

The goal is to minimize infrastructure complexity and AWS cost while validating the product.

The design must allow later migration to managed services.

---

# ADR-016 — Marketplace Readiness

## Decision

CodeLens will be architected as a GitHub App from the beginning so it can later be listed on GitHub Marketplace.

Marketplace-specific billing will not be implemented in the initial MVP.

The domain model must nevertheless allow:

```text
Plan
Subscription
Installation
Usage limits
Marketplace purchase state
```

to be added later.

---

# ADR-017 — Multi-Tenant Architecture

## Decision

CodeLens is logically multi-tenant from the beginning.

Tenant boundaries:

```text
User
Organization
GitHub Installation
Repository
```

Repository data, reviews, findings, credentials and configuration must never cross tenant boundaries.

Every resource query must be scoped by an authorization context.

---

# ADR-018 — Security Boundary for Repository Content

## Decision

All GitHub repository content is considered untrusted input.

This includes:

* source code
* README
* issues
* PR descriptions
* comments
* commit messages
* configuration files
* documentation

Repository content MUST NOT automatically become system-level instructions for the AI.

The review engine must distinguish:

```text
System instructions
Developer/application policy
Review rules
Repository content
Code
Issue/PR content
```

This is especially important for prompt-injection resistance.

---

# ADR-019 — Observability

Every review job must have:

```text
review_id
job_id
repository_id
pull_request_number
commit_sha
model
provider
started_at
completed_at
status
```

Metrics should include:

```text
review latency
LLM latency
token usage
estimated cost
finding count
error count
retry count
```

Sensitive data must not be included in logs.

---

# ADR-020 — Architecture Evolution

This ADR is the architecture baseline for CodeLens v0.1.

Feature specifications created through Spec Kit may refine implementation details but must not silently contradict these architectural decisions.

If a feature requires an architectural change:

```text
Feature
 ↓
Identify conflict
 ↓
Create/update ADR
 ↓
Review
 ↓
Update Spec
 ↓
Implementation
```

The ADR repository is therefore part of the project's architecture governance.
