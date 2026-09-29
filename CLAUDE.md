# CodeLens — rules for AI-assisted implementation

Governing documents, in priority order: `.specify/memory/constitution.md`, `docs/adr/`, `docs/architecture/database-erd.md`, then the active feature under `specs/`.

Before running or continuing `/speckit-implement`, read the "Implementation Safety Rules" section of `specs/001-github-app-onboarding/tasks.md`. In short:

- Work only on the feature branch; never push, force-push, reset --hard or clean.
- Never create or print real credentials; never call real GitHub or other external services in tests; use the fake GitHub server and local containers.
- Never add a GitHub write call or permission, and never store a user token.
- Tasks marked `[MANUAL]` and Gate G1 are for a human; stop and report instead of doing them.
- Do not change an ADR, the ERD or a spec as a side effect of code; those follow the change process in constitution Principle XV.
- Do not weaken or skip tests. Stop on failures and report the failing command and output.
