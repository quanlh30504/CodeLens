Đúng hướng. Với yêu cầu hiện tại, tôi sẽ **chưa nhảy ngay vào code hay Spec Kit implementation**. Trước tiên nên chốt một **technical/product baseline** cho CodeLens, sau đó mới dùng Spec Kit để đặc tả từng feature.

Tôi đã đối chiếu với GitHub Marketplace/GitHub App requirements và các capability công khai của CodeRabbit. CodeRabbit hiện có PR summary, line-by-line suggestions, chat, codebase insights, issue validation, automatic/incremental review và integrations; Marketplace listing hiện có hơn 321k installs. ([GitHub][1])

---

# 1. Vision của CodeLens

Tôi đề xuất định nghĩa CodeLens như sau:

> **CodeLens is a GitHub-native AI code review platform that automatically reviews Pull Requests and Issues, understands repository-specific rules, supports configurable AI models, and provides organization-level governance through a GitHub App.**

Mục tiêu kiến trúc:

```text
                    GitHub Marketplace
                           │
                           │ Install
                           ▼
                  ┌─────────────────┐
                  │   CodeLens      │
                  │   GitHub App    │
                  └────────┬────────┘
                           │
                       Webhooks
                           │
                           ▼
                ┌─────────────────────┐
                │ CodeLens Backend    │
                │                     │
                │ Review Orchestrator │
                │ Context Engine      │
                │ Rule Engine         │
                │ Model Router        │
                │ Security Layer      │
                └──────────┬──────────┘
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
          Claude          GPT          Gemini
             │             │             │
             └─────────────┼─────────────┘
                           ▼
                    Review Findings
                           │
                           ▼
                     GitHub PR
```

---

# 2. Những chức năng CodeLens nên target

Đừng chỉ clone "AI review PR".

Nên chia thành 7 nhóm.

## A. PR Review

MVP:

* Automatic review khi PR mở
* Review khi có commit mới
* Manual `/review`
* PR summary
* Changed files analysis
* Inline comments
* Severity
* Suggested fix
* Committable suggestion
* Duplicate finding detection
* Incremental review

CodeRabbit hiện cũng quảng bá automated/incremental review, summary và line-by-line suggestions. ([GitHub][2])

---

## B. Codebase Intelligence

```text
PR
 │
 ├── changed code
 ├── related code
 ├── dependency
 ├── tests
 ├── README
 ├── architecture docs
 └── project rules
        │
        ▼
   Context Engine
```

Các chức năng:

* Understand repository structure
* Find related code
* Detect impacted modules
* Architecture violation
* Cross-file reasoning
* Ask questions about codebase

CodeRabbit hiện cũng có "deep insights" và khả năng hỏi về codebase. ([GitHub][1])

---

# 3. Issue Intelligence

Không chỉ PR.

```text
Issue
 │
 ├── summarize
 ├── classify
 ├── detect duplicate
 ├── identify affected modules
 ├── validate linked PR
 └── suggest implementation
```

Ví dụ:

```text
Issue #123
"Payment webhook sometimes creates duplicate transaction"
```

CodeLens có thể:

```text
Affected:
PaymentWebhookHandler
TransactionService
TransactionRepository

Risk:
Idempotency

Related PR:
#456
```

CodeRabbit cũng có Issue Validation đối với PR và linked issues. ([GitHub][1])

---

# 4. Rule System — đây phải là core feature

Đây là một trong những phần tôi muốn CodeLens làm **ngay từ kiến trúc ban đầu**.

Repo có thể chứa:

```text
.codelens.yml
```

Ví dụ:

```yaml
version: 1

review:
  enabled: true

  profile: backend

  severity:
    minimum: medium

  triggers:
    pull_request:
      opened: true
      synchronize: true
    issue:
      opened: true

rules:
  security: true
  performance: true
  architecture: true
  testing: true
  database: true

paths:
  include:
    - "src/**"

  exclude:
    - "**/generated/**"
    - "**/target/**"

models:
  default: claude-sonnet

  tasks:
    pr_summary: claude-haiku
    code_review: claude-sonnet
    security_review: claude-sonnet
    architecture_review: claude-opus
```

Điểm quan trọng:

> **App không được chỉ lưu configuration ở database.**

Nó phải hỗ trợ:

```text
Repository
   │
   └── .codelens.yml
```

và CodeLens đọc file đó từ repository.

Điều này giúp configuration:

```text
version controlled
reviewable
auditable
reproducible
```

Đây cũng là pattern đã được các code-review products sử dụng; CodeRabbit chẳng hạn cho phép cấu hình tool như PMD bằng repository configuration hoặc `.coderabbit.yaml`. ([CodeRabbit Documentation][3])

---

# 5. Configuration hierarchy

Tôi đề xuất CodeLens có **4 tầng config**.

```text
                    Organization
                         │
                  org default rules
                         │
                         ▼
                    Repository
                         │
                   .codelens.yml
                         │
                         ▼
                     Directory
                         │
                    local rules
                         │
                         ▼
                     PR / Issue
                         │
                  temporary override
```

Priority:

```text
PR override
    >
repository
    >
organization
    >
system default
```

Nhưng phải audit tất cả override.

---

# 6. Model configuration — nên thiết kế mạnh ngay từ đầu

Đây là điểm bạn yêu cầu rất đúng.

Không nên:

```text
Settings
└── Claude API Key
```

Mà:

```text
Model Provider
│
├── Anthropic
│     ├── API Key
│     ├── Model
│     └── Parameters
│
├── OpenAI
│     ├── API Key
│     └── Model
│
└── Google
      └── Model
```

Sau đó:

```text
Task → Model
```

Ví dụ:

| Task                  | Model              |
| --------------------- | ------------------ |
| PR summary            | Claude Haiku       |
| General review        | Claude Sonnet      |
| Architecture          | Claude Sonnet/Opus |
| Security              | Claude Sonnet      |
| Chat                  | Claude Sonnet      |
| Issue analysis        | Claude Sonnet      |
| Simple classification | Haiku              |

Anthropic hiện cung cấp nhiều dòng Claude khác nhau, nên nên xây `ModelProvider` abstraction thay vì hard-code một model name.

```text
interface ModelProvider

AnthropicProvider
OpenAIProvider
GoogleProvider
```

và:

```text
ModelRouter

Task
 ↓
ModelPolicy
 ↓
Provider
 ↓
LLM
```

---

# 7. Đặc biệt: API key của user

Tôi **không khuyên** MVP lưu raw API key trong database.

Nên:

```text
User
 │
 ▼
CodeLens UI
 │
 ▼
Secrets Manager / encrypted secret
 │
 ▼
Model Provider
```

Có 2 mode:

### Managed mode

CodeLens cung cấp model:

```text
User
 ↓
CodeLens
 ↓
Claude
```

### BYOK

Bring Your Own Key:

```text
User
 ↓
CodeLens
 ↓
User's Anthropic API Key
 ↓
Claude
```

MVP nên ưu tiên **BYOK** nếu mục tiêu là giảm chi phí vận hành.

---

# 8. Authentication

Tôi đề xuất tách:

```text
GitHub identity
```

và:

```text
CodeLens account
```

### Login

```text
Login with GitHub
       │
       ▼
GitHub OAuth
       │
       ▼
CodeLens account
```

Sau đó:

```text
CodeLens Account
│
├── GitHub installations
├── Organizations
├── Repositories
├── Model providers
├── API keys
└── Review settings
```

Không nên tự xây username/password trong MVP.

GitHub App chính là integration với GitHub; GitHub khuyến nghị GitHub Apps vì permission granular hơn OAuth Apps. ([GitHub Docs][4])

---

# 9. GitHub App permissions

MVP:

```text
Repository permissions

Contents          Read
Pull requests     Write
Issues            Write/Read
Metadata           Read
```

Webhook:

```text
pull_request
issues
issue_comment
installation
installation_repositories
```

Chưa cấp:

```text
Contents: Write
Actions: Write
Administration: Write
Workflows: Write
```

trừ khi feature thực sự cần.

GitHub yêu cầu app permissions phải được lựa chọn rõ ràng và khuyến nghị minimum permissions. ([GitHub Docs][5])

---

# 10. Nếu sau này `/fix`

Bạn có thể nâng:

```text
Contents: Write
```

nhưng phải thiết kế riêng:

```text
AI proposes fix
       │
       ▼
Human confirmation
       │
       ▼
CodeLens creates commit
```

Không để:

```text
AI
 ↓
automatic push
```

ngay từ đầu.

---

# 11. Tech stack tôi đề xuất

Đây là stack tôi chọn cho CodeLens.

## Backend

### Java 21 + Spring Boot 3

Vì bạn đã mạnh Java/backend và hệ thống này rất phù hợp với:

```text
Spring Boot
Spring Security
Spring Data
Virtual Threads
WebClient
```

Nhưng có một ngoại lệ:

**Không dùng Java cho AI orchestration nếu bạn muốn tận dụng ecosystem AI agent nhanh nhất.**

Do đó tôi sẽ cân nhắc:

```text
Backend Core: Java/Spring Boot
AI Worker: Python
```

Tuy nhiên MVP sẽ phức tạp hơn.

### Lựa chọn tôi khuyên:

**MVP: TypeScript/NestJS**

```text
Node.js
TypeScript
NestJS
```

vì GitHub App + webhook + LLM API + streaming + SDK integration rất thuận tiện.

Sau này nếu AI worker cần:

```text
Python
LangGraph
Pydantic
agent ecosystem
```

thì tách:

```text
review-worker
```

sang Python.

---

# 12. Stack đề xuất hoàn chỉnh

```text
Frontend
──────────────
Next.js
React
TypeScript
Tailwind
shadcn/ui


Backend
──────────────
NestJS
TypeScript


AI
──────────────
Anthropic Claude API
Vercel AI SDK / native Anthropic SDK
Pydantic-like schema validation → Zod


Database
──────────────
PostgreSQL


Queue
──────────────
Redis + BullMQ


GitHub
──────────────
GitHub App
Octokit


Authentication
──────────────
GitHub OAuth
Session/JWT


Secrets
──────────────
AWS Secrets Manager
or encrypted DB secret initially


Infrastructure
──────────────
AWS EC2
Docker Compose
Nginx


Observability
──────────────
OpenTelemetry
structured logs


CI/CD
──────────────
GitHub Actions
```

---

# 13. Nhưng AWS Free Tier phải rất cẩn thận

Bạn yêu cầu:

> deploy EC2 và không phát sinh thêm phí

Không thể đảm bảo tuyệt đối **"zero bill"** chỉ bằng kiến trúc, vì AWS có thể tính phí cho các dịch vụ ngoài free allowance.

AWS hiện có các free-tier/free-trial chương trình thay đổi theo account và thời điểm. Đặc biệt AWS đang có T4g free trial 750 giờ/tháng tới 31/12/2026 cho eligible accounts, bên cạnh các Free Tier hiện hành. ([Amazon Web Services][6])

Vì vậy CodeLens MVP nên:

```text
             EC2
              │
       ┌──────┼──────┐
       ▼      ▼      ▼
     Nginx  App   PostgreSQL
                    │
                  Docker
```

**Không dùng ngay:**

```text
RDS
ElastiCache
ECS
EKS
ALB
NAT Gateway
OpenSearch
CloudWatch advanced
```

vì chúng làm architecture tốt hơn nhưng không phù hợp mục tiêu free-cost MVP.

---

# 14. EC2 architecture

Một EC2:

```text
Internet
   │
   ▼
Nginx :443
   │
   ├─────────────┐
   ▼             ▼
Next.js       NestJS
                  │
                  ├── PostgreSQL
                  └── Redis
```

Docker Compose:

```text
codelens
├── nginx
├── web
├── api
├── worker
├── postgres
└── redis
```

Đây là **MVP architecture**, không phải production scale architecture.

Khi có user thật:

```text
EC2
   ↓
RDS
   ↓
ElastiCache
   ↓
SQS
```

mới tách dần.

---

# 15. Một điều cực kỳ quan trọng: không chạy Claude trên EC2

EC2 chỉ chạy:

```text
CodeLens
```

Claude chạy:

```text
Anthropic API
```

```text
EC2
 │
 ▼
Anthropic API
 │
 ▼
Claude
```

Như vậy EC2 không cần GPU.

---

# 16. Database schema nên chuẩn bị

Ngay từ đầu:

```text
users
github_installations
github_repositories

organizations

model_providers
model_credentials
model_configs

review_profiles
review_rules

review_jobs
reviews
review_findings

issues
pull_requests

usage_records
audit_logs
```

Quan trọng nhất:

```text
model_configs
```

Ví dụ:

```text
id
provider
model
task_type
temperature
max_tokens
enabled
```

và:

```text
review_profiles
```

```text
backend-java
security
performance
architecture
default
```

---

# 17. Review Engine

Tôi muốn CodeLens có architecture:

```text
ReviewRequest
      │
      ▼
ReviewOrchestrator
      │
      ├── GitHubContextProvider
      │
      ├── RepositoryRuleProvider
      │
      ├── CodeContextProvider
      │
      ├── StaticAnalysisProvider
      │
      ├── ModelRouter
      │
      └── ReviewValidator
```

LLM output **không được trực tiếp post vào GitHub**.

Phải:

```text
LLM
 ↓
Structured JSON
 ↓
Schema validation
 ↓
Finding deduplication
 ↓
Confidence filtering
 ↓
GitHub Publisher
```

---

# 18. Structured review result

Ví dụ:

```json
{
  "findings": [
    {
      "severity": "HIGH",
      "category": "SECURITY",
      "file": "PaymentService.java",
      "line": 124,
      "title": "Potential duplicate payment processing",
      "description": "...",
      "suggestion": "...",
      "confidence": 0.94
    }
  ]
}
```

Không cho model trả Markdown tự do rồi parser bằng regex.

---

# 19. Static analysis

Đây là điểm CodeLens không nên biến thành "LLM only".

Architecture:

```text
                  Review
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
      LLM        SAST         Lint
        │           │           │
        └───────────┼───────────┘
                    ▼
              Finding Engine
```

Ví dụ:

```text
Java
 ├── Checkstyle
 ├── PMD
 ├── SpotBugs
 └── Semgrep

JS/TS
 ├── ESLint
 └── Semgrep
```

CodeRabbit hiện cũng tích hợp static analysis tools; ví dụ PMD có thể được cấu hình riêng hoặc qua CodeRabbit và được skip nếu đã chạy trong GitHub workflow. ([CodeRabbit Documentation][3])

---

# 20. UI MVP

Tôi sẽ làm dashboard:

```text
CodeLens
────────────────────────────

Overview

Repositories       12
Reviews            1,284
Issues             342
Findings           2,891
Cost               $12.40


Recent Reviews

PR #128
payment-service
HIGH  2
MED   5


Model Usage

Claude Sonnet     72%
Claude Haiku      28%
```

Settings:

```text
Settings
├── GitHub
├── AI Providers
│   ├── Anthropic
│   ├── OpenAI
│   └── Gemini
├── Models
├── Review Profiles
├── Rules
├── Repositories
├── Security
└── Billing
```

---

# 21. Model configuration UI

Đây là phần bạn yêu cầu.

```text
AI Providers

Anthropic
────────────────────
API Key       **************
Connection    ✓ Connected

Models:
☑ Claude Sonnet
☑ Claude Haiku

[Save]
```

Sau đó:

```text
Task Model Routing

PR Summary             Claude Haiku
Code Review             Claude Sonnet
Security Review         Claude Sonnet
Architecture Review     Claude Sonnet
Issue Analysis          Claude Haiku
PR Chat                 Claude Sonnet
```

Sau này có:

```text
Advanced

[+] Add provider
```

---

# 22. Marketplace architecture

Ngay từ đầu phải thiết kế để sau này có thể publish.

GitHub Marketplace yêu cầu app phải có pricing plan, privacy policy, support information và các yêu cầu UX/listing; app cũng phải có Marketplace webhook để xử lý thay đổi plan. ([GitHub Docs][7])

Free version:

```text
GitHub
  ↓
Install CodeLens
  ↓
Free plan
```

Paid:

```text
GitHub Marketplace
       │
       ▼
purchase
       │
       ▼
marketplace_purchase webhook
       │
       ▼
CodeLens
       │
       ▼
Subscription updated
```

Paid Marketplace app hiện yêu cầu tối thiểu 100 GitHub App installations và publisher verification của organization. ([GitHub Docs][7])

**Vì vậy MVP chưa cần billing.**

Nhưng database phải có:

```text
plans
subscriptions
installation_plans
usage_limits
```

để sau này không phải refactor lớn.

---

# 23. Roadmap tôi đề xuất

## Phase 0 — Product/Architecture

**Hiện tại chúng ta đang ở đây.**

```text
Product requirements
Architecture
Tech stack
Security model
GitHub App model
Configuration model
```

↓

## Phase 1 — Spec Kit

```text
Constitution
     ↓
Specify
     ↓
Clarify
     ↓
Plan
     ↓
Tasks
```

↓

## Phase 2 — GitHub App MVP

```text
Install
Webhook
Authentication
PR event
```

↓

## Phase 3 — AI Review MVP

```text
PR
 ↓
Diff
 ↓
Claude
 ↓
Structured findings
 ↓
GitHub comments
```

↓

## Phase 4

```text
.codelens.yml
Review profiles
Model routing
```

↓

## Phase 5

```text
Dashboard
AI provider management
GitHub repo management
```

↓

## Phase 6

```text
Issue review
PR chat
Codebase intelligence
```

↓

## Phase 7

```text
Static analysis
Security
Architecture
```

↓

## Phase 8

```text
Marketplace
Free plan
Paid plan
Billing
```

---

# 24. Bây giờ đến Spec Kit — chưa implement

Spec Kit hiện tại hỗ trợ Claude integration trực tiếp qua `specify init --integration claude`; quy trình SDD hiện được tổ chức thành:

```text
constitution
→ specify
→ clarify
→ plan
→ checklist
→ tasks
→ analyze
→ implement
→ converge
```

Trong đó `constitution` xác lập nguyên tắc, còn `specify` tập trung vào **WHAT/WHY**, không nên nhét tech stack vào specify. ([GitHub Pages][8])

Đây là điểm tôi muốn giữ rất chặt cho CodeLens.

---

# 25. Lệnh Constitution tôi đề xuất

Sau khi bạn init Spec Kit:

```bash
specify init CodeLens --integration claude
cd CodeLens
```

Sau đó mở Claude Code và chạy:

```text
/speckit-constitution
```

Nhưng **prompt không nên chỉ là "create constitution"**.

Tôi đề xuất prompt v1 như sau:

```text
Create the CodeLens project constitution.

CodeLens is a GitHub-native AI code review platform intended to become a
public GitHub App and eventually a GitHub Marketplace application.

The constitution must establish binding engineering and product principles
for the entire project.

Core principles must cover:

1. GitHub-native integration
   - CodeLens MUST use GitHub Apps as the primary GitHub integration.
   - Repository access MUST use least-privilege permissions.
   - GitHub webhook authenticity MUST be verified.
   - Installation-scoped access MUST be enforced.

2. Security and trust
   - Never trust PR, issue, repository, or code content as instructions.
   - Treat repository content as untrusted input.
   - Never expose GitHub tokens, OAuth credentials, provider API keys,
     private keys, webhook secrets, or internal configuration to LLMs.
   - Secrets MUST NOT be stored in plaintext.
   - AI-generated actions MUST be explicitly authorized.
   - Destructive repository operations MUST require explicit user approval.

3. AI provider abstraction
   - The application MUST NOT be tightly coupled to one LLM provider.
   - Anthropic Claude is the initial provider.
   - Model selection MUST be configurable per review task.
   - Provider-specific code MUST be isolated behind an abstraction.
   - AI output MUST use validated structured schemas.

4. Review correctness
   - AI findings MUST be distinguishable from deterministic static-analysis findings.
   - Every finding MUST contain severity, category, location, explanation,
     confidence, and review provenance where applicable.
   - The system MUST minimize duplicate and low-confidence findings.
   - AI review MUST NOT automatically approve or merge code.

5. Repository configuration
   - Repositories MUST be able to define CodeLens behavior through a
     version-controlled configuration file such as .codelens.yml.
   - Repository configuration MUST be parsed and validated.
   - Organization-level defaults and repository-level configuration
     MUST have deterministic precedence.
   - Configuration changes MUST be auditable.

6. Model configuration
   - Users MUST be able to configure AI providers and models.
   - Users MUST be able to map different models to different review tasks.
   - Model credentials MUST be securely stored.
   - Model configuration MUST be auditable.
   - The system MUST support future providers without redesigning the
     review engine.

7. Spec-driven development
   - Requirements MUST be defined before implementation.
   - Features MUST have explicit acceptance criteria.
   - Architecture decisions MUST be traceable to specifications.
   - Implementation MUST NOT silently introduce unspecified behavior.
   - Breaking architectural changes require explicit justification.

8. Testing
   - Security-sensitive functionality MUST have automated tests.
   - GitHub webhook handling MUST have signature-validation tests.
   - GitHub permission behavior MUST be tested.
   - Configuration parsing MUST have positive and negative tests.
   - LLM outputs MUST be tested against structured schemas.
   - Core review logic MUST be testable without calling real LLM APIs.

9. Observability
   - Every review job MUST have a traceable identifier.
   - Review execution, model selection, latency, token usage, errors,
     and cost estimates MUST be observable without exposing secrets.
   - Failed jobs MUST be retryable safely.

10. Cost control
    - LLM calls MUST have configurable token and cost limits.
    - The system MUST avoid unnecessary duplicate model calls.
    - Expensive models MUST only be selected when configured or required.
    - The initial deployment MUST be optimized for low-cost AWS infrastructure.

11. Marketplace readiness
    - The application architecture MUST support GitHub Marketplace distribution.
    - Authentication, installation lifecycle, plan state, and webhook handling
      MUST be designed so that Marketplace billing can be added later.
    - Marketplace functionality MUST NOT compromise the security model.

12. Maintainability
    - Prefer modular, explicit, testable architecture.
    - Avoid premature microservices.
    - Keep provider integrations, GitHub integration, review orchestration,
      configuration, authentication, and persistence clearly separated.

Do not implement any application feature.
Only create or update the project constitution.

The constitution should contain:
- Core Principles
- Security and Trust Model
- Architecture Governance
- Testing Governance
- Configuration Governance
- AI Governance
- Observability and Cost Governance
- Marketplace Readiness
- Development Workflow
- Versioning and Amendment Policy

Use MUST/SHOULD language consistently.
```

Điểm này phù hợp với cách Spec Kit hiện thiết kế constitution: nó là **binding governance**, không phải feature specification. ([GitHub][9])

---

# 26. Sau khi bạn review Constitution

**Không chạy `/plan` ngay.**

Feature đầu tiên nên là:

> **CodeLens Core GitHub App + PR AI Review MVP**

Chạy:

```text
/speckit-specify
```

với prompt:

```text
Specify the first CodeLens MVP feature:

"GitHub App installation and automatic AI Pull Request review."

The goal is to allow a GitHub user or organization to install CodeLens,
grant repository permissions, and automatically receive an AI-assisted
review when a Pull Request is opened or updated.

Functional scope:

1. GitHub App installation
   - User can install CodeLens on selected repositories.
   - Installation identity must be associated with a CodeLens account.
   - The system must track GitHub installation ID and repository access.

2. Authentication
   - User can sign in to CodeLens using GitHub.
   - The application must associate the authenticated user with their
     GitHub identity.
   - Authentication state must be secure and revocable.

3. Webhooks
   - CodeLens receives pull_request webhook events.
   - Supported initial actions:
     opened
     synchronize
     reopened
   - Webhook signatures must be verified.
   - Duplicate webhook deliveries must not create duplicate review jobs.

4. Pull Request context
   - The system retrieves PR metadata, changed files, patches/diffs,
     base commit and head commit.
   - Repository content is treated as untrusted input.
   - The system must be able to read repository configuration.

5. Repository configuration
   - Support a `.codelens.yml` configuration file.
   - The configuration must define whether automatic review is enabled.
   - It must support review profile, severity threshold, path filters,
     enabled checks, and model task configuration.
   - Invalid configuration must produce a clear diagnostic.

6. AI review
   - Claude is the initial AI provider.
   - The review engine must receive structured review context.
   - The model must return structured findings.
   - Findings must be validated before being published.

7. Review result
   Each finding should contain:
   - severity
   - category
   - file
   - line or code location when available
   - title
   - explanation
   - suggested fix when available
   - confidence

8. GitHub publishing
   - CodeLens publishes a review summary.
   - CodeLens can publish inline comments for actionable findings.
   - AI review must not approve or merge the Pull Request.
   - Findings must identify that they were generated by CodeLens.

9. Reliability
   - Review jobs must be idempotent.
   - Failed jobs must be retryable.
   - A Pull Request update must not accidentally publish stale findings
     from an older commit.
   - Review results must be associated with the reviewed commit SHA.

10. Cost control
    - A review job must have configurable limits.
    - The system must avoid reviewing the same commit multiple times.
    - Token usage and model selection must be recorded.

11. Security
    - GitHub credentials and webhook secrets must never be exposed to
      the LLM.
    - Repository code must never be treated as executable instructions.
    - Only authorized installations can trigger reviews.
    - Secrets must never appear in logs.

Non-goals for this feature:
- Marketplace billing
- Paid plans
- Multi-provider model support
- PR chat
- Automatic code fixes
- Issue review
- Static analysis integrations
- Codebase-wide indexing
- Autonomous code commits

Focus on WHAT and WHY.
Do not choose implementation technologies or database schemas.
Define user stories, functional requirements, edge cases,
acceptance criteria, and measurable success criteria.
```

Đây là đúng tinh thần `/speckit.specify`: define **what/why**, còn technology và implementation architecture để `/speckit-plan` quyết định. ([GitHub][10])

---

# 27. Sau feature MVP mới chia feature tiếp

Tôi sẽ không nhét toàn bộ CodeRabbit vào một giant spec.

Nên:

```text
001-github-app-pr-review
002-repository-configuration
003-model-provider-management
004-model-task-routing
005-review-profiles
006-pr-chat
007-codebase-intelligence
008-issue-review
009-static-analysis
010-security-analysis
011-auto-fix
012-review-analytics
013-organization-governance
014-marketplace-billing
```

Mỗi feature:

```text
specify
 ↓
clarify
 ↓
plan
 ↓
checklist
 ↓
tasks
 ↓
analyze
 ↓
implement
 ↓
converge
```

Spec Kit hiện cũng khuyến nghị workflow này và có `clarify`, `checklist`, `analyze` như các quality gates khi feature có độ phức tạp/ambiguity đáng kể. ([GitHub Pages][8])

---

## Chốt baseline CodeLens v0.1

Tôi sẽ freeze architecture ban đầu như sau:

```text
┌─────────────────────────────────────────────────────┐
│                     CodeLens                        │
├─────────────────────────────────────────────────────┤
│ Frontend        Next.js + React + TypeScript       │
│ Backend         NestJS + TypeScript                │
│ AI              Anthropic Claude                   │
│ GitHub          GitHub App + Octokit               │
│ Auth            GitHub OAuth                       │
│ DB              PostgreSQL                         │
│ Queue           Redis + BullMQ                     │
│ Validation      Zod                                │
│ Deployment      Docker Compose on EC2              │
│ Proxy           Nginx                              │
│ CI/CD           GitHub Actions                     │
│ Spec            GitHub Spec Kit + Claude Code      │
└─────────────────────────────────────────────────────┘
```

**Kiến trúc quan trọng nhất:**

```text
GitHub App
    ↓
Webhook
    ↓
Review Queue
    ↓
Review Orchestrator
    ↓
Context Engine
    ↓
Rule Engine
    ↓
Model Router
    ↓
Claude
    ↓
Structured Findings
    ↓
Validator
    ↓
GitHub Review
```

và configuration:

```text
Organization settings
        ↓
.codelens.yml
        ↓
Review Profile
        ↓
Task → Model
```

Cách này vừa cho bạn **MVP đủ nhỏ để triển khai trên một EC2**, vừa không khóa kiến trúc khi sau này CodeLens cần trở thành GitHub Marketplace App. GitHub cho phép public GitHub Apps được list trên Marketplace; free app chỉ cần đáp ứng yêu cầu listing chung, còn paid plan mới cần publisher verification và tối thiểu 100 installations. ([GitHub Docs][4])

**Tôi khuyên chưa viết code ở bước này.** Hãy dùng đúng thứ tự: **freeze tech baseline → chạy Constitution → review Constitution → chạy Specify cho `001-github-app-pr-review` → review spec → rồi mới Plan**. Điều đó sẽ giúp CodeLens không bị AI agent "tự quyết" architecture trong lúc implementation.

[1]: https://github.com/marketplace/coderabbitai?utm_source=chatgpt.com "CodeRabbit · GitHub Marketplace · GitHub"
[2]: https://github.com/apps/coderabbitai?utm_source=chatgpt.com "GitHub Apps - coderabbitai · GitHub"
[3]: https://docs.coderabbit.ai/tools/pmd?utm_source=chatgpt.com "CodeRabbit Documentation - AI code reviews on pull requests, IDE, and CLI"
[4]: https://docs.github.com/en/apps/github-marketplace/github-marketplace-overview/about-github-marketplace-for-apps?utm_source=chatgpt.com "About GitHub Marketplace for apps - GitHub Docs"
[5]: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app?utm_source=chatgpt.com "Choosing permissions for a GitHub App - GitHub Docs"
[6]: https://aws.amazon.com/ec2/faqs/?utm_source=chatgpt.com "Amazon EC2 FAQs – AWS"
[7]: https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app?utm_source=chatgpt.com "Requirements for listing an app - GitHub Docs"
[8]: https://github.github.com/spec-kit/reference/agentic-sdd.html?utm_source=chatgpt.com "Agentic SDD | Spec Kit Documentation"
[9]: https://github.com/github/spec-kit/blob/main/templates/commands/constitution.md?utm_source=chatgpt.com "spec-kit/templates/commands/constitution.md at main · github/spec-kit · GitHub"
[10]: https://github.com/github/spec-kit/blob/main/docs/reference/agentic-sdd.md?utm_source=chatgpt.com "spec-kit/docs/reference/agentic-sdd.md at main · github/spec-kit · GitHub"
