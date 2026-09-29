# Feature Specification: GitHub App Installation and Repository Onboarding

**Feature Branch**: `001-github-app-onboarding`

**Created**: 2026-09-29

**Status**: Draft

**Input**: User description: "Create Feature 001: GitHub App Installation and Repository Onboarding. A GitHub user or organization administrator must be able to install the CodeLens GitHub App, select which repositories CodeLens can access, and then see the installation and its repositories in CodeLens, enabling or disabling each repository for review."

## Clarifications

### Session 2026-09-29

- Q: How long is data kept for removed installations and repositories that are no longer accessible? → A: Kept indefinitely in the MVP; any deletion policy belongs to a later feature.
- Q: How many repositories per installation are supported before the system behaves differently? → A: Fully supported up to 5,000; above that the first 5,000 (lowest GitHub repository identifiers) are synchronized and the user is clearly warned.
- Q: Who may perform which action? → A: The FR-040 matrix: signed-in users may start installation and refresh access; MEMBER may view; only OWNER may enable, disable or re-synchronize.
- Q: How long does a GitHub role confirmation stay valid? → A: For viewing, until the session ends (at most 12 hours) or access is refreshed; for management, 10 minutes.
- Q: What happens when two installations report the same repository? → A: Only during transfers: GitHub is asked whether the current holder still has access; the repository moves only if it does not, is reset to disabled, and neither tenant learns about the other.
- Q: Which states are shown for installations and repositories? → A: The FR-041 list, with fixed reason categories for failed synchronization.
- Q: What is out of scope among the remaining edge topics? → A: In-progress review work at ineligibility (future review feature) and secret rotation (later operational feature); both recorded in Assumptions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign in with GitHub (Priority: P1)

A person opens CodeLens and signs in with their GitHub identity. CodeLens creates an account on first sign-in, or recognizes the existing account on later sign-ins, and links it permanently to that GitHub identity. The person never has to create or paste a personal access token.

**Why this priority**: Every other capability depends on knowing who the user is. Nothing else can be shown or authorized without it.

**Independent Test**: Sign in with a GitHub identity that has never used CodeLens, confirm an account exists and is linked to that identity; sign out and in again and confirm the same account is used.

**Acceptance Scenarios**:

1. **Given** a GitHub user with no CodeLens account, **When** they complete GitHub sign-in, **Then** a CodeLens account is created and linked to their GitHub identity and they land in CodeLens as an authenticated user.
2. **Given** a GitHub user who already has a CodeLens account, **When** they sign in again, **Then** they access the same account and no duplicate account is created.
3. **Given** a GitHub user who renamed their GitHub username since last sign-in, **When** they sign in, **Then** they still access the same account and the displayed username is updated.
4. **Given** a user who cancels or denies the GitHub sign-in, **When** they return to CodeLens, **Then** they remain signed out, see a message that sign-in was cancelled with a way to try again, and no account is created.
5. **Given** an unauthenticated visitor, **When** they request any installation or repository page, **Then** they are asked to sign in and no tenant data is shown.
6. **Given** a signed-in user, **When** they sign out, **Then** their session ends on the server, any later request with that session is treated as signed out, and signing in again returns them to the same account.

---

### User Story 2 - Install the CodeLens GitHub App and see the installation (Priority: P1)

A signed-in user starts installation of the CodeLens GitHub App from CodeLens. They are taken to GitHub, choose the account or organization to install on, and choose which repositories CodeLens may access. After GitHub completes the installation, the user returns to CodeLens and sees the installation, the account or organization it belongs to, and its repositories, without manual steps.

**Why this priority**: This is the core onboarding value: connecting GitHub to CodeLens and making the granted access visible.

**Independent Test**: From a signed-in session, start installation, complete it on GitHub selecting a subset of repositories, and confirm the installation, its account, and exactly the selected repositories appear in CodeLens.

**Acceptance Scenarios**:

1. **Given** a signed-in user with no installations, **When** they choose to install the app, **Then** they are sent to GitHub's installation flow for the CodeLens GitHub App.
2. **Given** GitHub has completed an installation on an account or organization, **When** CodeLens receives the authentic installation event, **Then** the installation is recorded with its account or organization, and the user who initiated it can see it.
3. **Given** an installation with "selected repositories" access, **When** repository synchronization completes, **Then** CodeLens lists exactly the repositories GitHub reports as accessible, each showing its name, visibility (public or private) and state.
4. **Given** an installation with "all repositories" access, **When** synchronization completes, **Then** every repository GitHub reports for that installation is listed.
5. **Given** the user returns from GitHub before synchronization has finished, **When** they view the installation page, **Then** they see the installation in the *Setting up* state with the message that repositories are being imported from GitHub; the page updates by itself when synchronization ends; if it has not ended within 2 minutes, the page says setup is taking longer than expected and offers to check again (and, for an OWNER, to retry synchronization).
6. **Given** the user abandons the GitHub installation flow, **When** they return to CodeLens, **Then** no installation is shown and they can start again.
7. **Given** a person returns to CodeLens claiming an installation that GitHub does not list as accessible to them, **When** the return is processed, **Then** nothing is linked, the installation is not revealed, and they see a message that it could not be confirmed.
8. **Given** the return from GitHub arrives without user confirmation, **When** it is processed, **Then** the user is asked to confirm with GitHub and, once confirmed, the installation is linked and shown; if they decline, nothing is linked.
9. **Given** an OWNER wants CodeLens to access another repository, **When** they look for a way to add it, **Then** CodeLens offers only a link to the installation's settings on GitHub; CodeLens itself has no control that grants or widens access (FR-006).
10. **Given** a MEMBER or OWNER, **When** they open CodeLens, **Then** they see their installations grouped by organization, and from an installation its repositories, each with its state and an enable/disable control that is usable for an OWNER and shown as unavailable, with an explanation, for a MEMBER (FR-019, FR-040).

---

### User Story 3 - Enable or disable a repository (Priority: P2)

For each repository visible to an installation, a user whom GitHub confirms as an owner of the organization (OWNER) can enable or disable CodeLens review without uninstalling the GitHub App. Newly synchronized repositories start disabled until someone enables them. A disabled repository is never processed for review.

**Why this priority**: Gives the user control over which repositories participate. It depends on P1 stories but is the main day-to-day action.

**Independent Test**: With an installation containing repositories, enable one, verify its state shows enabled; disable it, verify it shows disabled and that the GitHub App remains installed.

**Acceptance Scenarios**:

1. **Given** a newly synchronized repository, **When** the user views it, **Then** its state is "disabled".
2. **Given** a disabled repository, **When** an OWNER enables it, **Then** its state becomes "enabled" and the change is recorded in an audit trail with who and when.
3. **Given** an enabled repository, **When** an OWNER disables it, **Then** its state becomes "disabled", the GitHub App remains installed, and no further review processing is started for it.
4. **Given** a MEMBER (not an owner according to GitHub), **When** they attempt to change a repository's state, **Then** the change is rejected and the state is unchanged.
5. **Given** a user who is no longer an owner on GitHub but whose last confirmation is recent, **When** the confirmation reaches its 10-minute limit and they retry, **Then** the request is rejected and they are treated as MEMBER.
6. **Given** an OWNER whose last confirmation is older than 10 minutes, **When** they enable a repository, **Then** they are asked to re-confirm with GitHub and, once confirmed, the change is applied.
7. **Given** GitHub is unreachable during confirmation, **When** an OWNER tries to change a repository's state, **Then** the change is refused with a retry message and the state is unchanged.
8. **Given** the person who installed the app is not a GitHub owner of the organization (for example, an approved app manager), **When** they try to change a repository's state, **Then** the change is rejected.
9. **Given** the user toggles the same repository repeatedly, **When** the final action is submitted, **Then** the resulting state matches that final action.
10. **Given** a MEMBER, **When** they request a re-synchronization, **Then** it is refused; and **Given** an OWNER who requests re-synchronization several times while one is pending, **Then** exactly one synchronization runs (FR-016).

---

### User Story 4 - Stay consistent with GitHub after changes (Priority: P2)

When the account owner changes access on GitHub (adds or removes repositories from the installation, renames or transfers repositories, suspends or unsuspends the app, or uninstalls it), CodeLens reflects the change. GitHub remains the source of truth. Uninstalling revokes the CodeLens installation state and stops all review processing for its repositories.

**Why this priority**: Prevents CodeLens from acting on access that GitHub no longer grants. It is a safety requirement, but is exercised after initial onboarding.

**Independent Test**: With an installed and enabled repository, remove it from the installation on GitHub, then uninstall the app, and confirm CodeLens shows the repository as no longer accessible and then the installation as removed, with no review work accepted.

**Acceptance Scenarios**:

1. **Given** an installation, **When** GitHub reports repositories were added, **Then** they appear in CodeLens as disabled.
2. **Given** an installation, **When** GitHub reports repositories were removed from it, **Then** those repositories show as no longer accessible, are treated as disabled, and their history is retained.
3. **Given** a repository was renamed on GitHub, **When** the change is synchronized, **Then** the same repository record is shown under its new name, not as a new repository.
4. **Given** an active installation with enabled repositories, **When** the app is uninstalled on GitHub, **Then** the installation is shown as removed, all of its repositories are treated as disabled and inaccessible, no repository is eligible for review, and exactly one audit entry records the removal.
5. **Given** the app is suspended on GitHub, **When** CodeLens is notified, **Then** the installation is shown as suspended, no repository is eligible for review until it is unsuspended, and each change is recorded once in the audit trail.
6. **Given** a previously uninstalled account, **When** the app is installed again, **Then** the account appears under the same organization as a new active installation, the earlier removed installation and its history remain visible as removed, no duplicate organization is created, and all repositories start disabled.
7. **Given** CodeLens missed an event, **When** a user or the system triggers a manual re-synchronization, **Then** repositories and installation state match what GitHub currently reports.
8. **Given** an enabled repository is transferred on GitHub to another account where CodeLens is installed, **When** synchronization runs for both installations, **Then** the repository appears only under the new tenant, disabled, with none of the former tenant's settings, and it no longer appears in the former tenant's list (FR-013).
9. **Given** GitHub is unavailable during synchronization, **When** all automatic retries fail, **Then** the installation shows *Active – synchronization failed* with the reason *GitHub unavailable*, the previous repository list is unchanged, and an OWNER can retry (FR-017).

---

### User Story 5 - Reject forged and duplicate events (Priority: P1)

CodeLens accepts installation events only if they are authentic, and processes each real event once, even if GitHub delivers it several times.

**Why this priority**: A forged event could grant or revoke tenant access; duplicate handling protects data integrity. Both are constitutional requirements (Principles IX and XI).

**Independent Test**: Send an event with a missing or wrong signature and confirm it is rejected with no state change; send the same valid event twice and confirm the resulting state equals a single delivery.

**Acceptance Scenarios**:

1. **Given** an event with an invalid or missing signature, **When** it is received, **Then** it is rejected, nothing is changed, and the rejection is recorded without the payload contents or any secrets. The rejection record holds only the time, the reason, the delivery identifier if present and a non-reversible fingerprint of the sender's network address, and it is kept for at least 30 days.
2. **Given** a valid event that was already processed, **When** GitHub delivers it again, **Then** it is acknowledged, no duplicate installations, repositories or audit entries result, and state is unchanged.
3. **Given** two deliveries of the same event arrive at nearly the same time, **When** both are processed, **Then** exactly one installation and one set of repositories exist afterwards.
4. **Given** events arrive out of order (for example, repository changes before the installation is created), **When** they are processed, **Then** the final state matches GitHub's current state and no data is lost.
5. **Given** an authentic event for an installation CodeLens has never seen and no user has claimed, **When** it is received, **Then** it is recorded, no user can see it yet, and it becomes visible to a user only after GitHub confirms that user can access that installation (at their next sign-in or access refresh).
6. **Given** a valid event whose synchronization takes longer than 10 seconds, **When** it is received, **Then** the delivery is acknowledged within 10 seconds and the synchronization completes afterwards (FR-031).

---

### User Story 6 - See only what I'm authorized to see (Priority: P1)

Users see only installations and repositories that belong to organizations they are authorized for. Two different organizations' data never mix.

**Why this priority**: Tenant isolation is a non-negotiable constitutional principle; a leak here is a security incident.

**Independent Test**: With two users belonging to different organizations, confirm each sees only their own installations and repositories, and that requesting the other's data by identifier is refused.

**Acceptance Scenarios**:

1. **Given** users A and B in different organizations, **When** each opens the installation list, **Then** each sees only their own organization's installations.
2. **Given** user A knows the identifier of an installation or repository in user B's organization, **When** A requests it directly, **Then** access is refused and the response does not reveal whether it exists.
3. **Given** a user who is removed from an organization on GitHub, **When** their access is next confirmed with GitHub (at sign-in, when they refresh access, or before a management action), **Then** they no longer see that organization's installations or repositories.
4. **Given** a user who belongs to several organizations, **When** they view CodeLens, **Then** they can view each of their organizations separately and see no data from other organizations.

---

### Edge Cases

- A user installs the app on their personal account (not an organization): the personal account is treated as its own tenant context.
- The person who installs is not an owner or administrator of the target organization: GitHub controls whether the installation proceeds (for example, by requesting owner approval); CodeLens shows nothing until GitHub confirms the installation. Once installed, that person is OWNER only if GitHub reports them as an owner.
- An installation covers zero repositories: the installation is shown with an empty repository list, a message that no repositories were selected on GitHub, and a link to the installation's settings on GitHub.
- An installation covers more than 5,000 repositories: only the 5,000 with the lowest GitHub repository identifiers are synchronized, the same 5,000 on every run, and the installation page shows a warning stating the limit and that others are not shown. Repositories previously recorded but outside that set are treated as no longer accessible.
- A repository is transferred to another owner: if CodeLens is installed for the new owner and GitHub reports the repository there, it moves to the new owner's tenant, starts disabled and carries none of the former tenant's settings; it leaves the former tenant's repository list, and the former tenant keeps only its own audit entries about it. If CodeLens is not installed for the new owner, the former tenant sees it as no longer accessible.
- The same repository is reported by two installations at once (possible only briefly during a transfer): CodeLens asks GitHub whether the installation that currently holds it still has access. If not, the repository moves as for a transfer. If it does, the current holder keeps it, the other installation does not list it, and the case is recorded for operators only. Neither tenant is told anything about the other.
- Synchronization fails part-way (GitHub unavailable or rate-limited): already-known data is preserved, the installation shows a synchronization problem with a retry option, and a later run converges to the correct state.
- A private repository becomes public or the reverse: its visibility is updated on next synchronization.
- The user's GitHub sign-in expires while using the page: they are asked to sign in again and lose no server-side state.
- An event references a repository or installation that has been deleted on GitHub: the local record is marked removed, not left active.

## Requirements *(mandatory)*

### Functional Requirements

**Identity and account**

- **FR-001**: Users MUST be able to sign in with their GitHub identity, without providing a personal access token or any other long-lived GitHub credential.
- **FR-002**: On first sign-in the system MUST create a CodeLens account linked to the GitHub user's stable numeric identity; on later sign-ins it MUST reuse that account regardless of username changes.
- **FR-003**: The system MUST treat the user's GitHub identity and a GitHub App installation as separate concepts: signing in MUST NOT grant access to any installation, and holding an installation MUST NOT authenticate any user.
- **FR-004**: Unauthenticated visitors MUST NOT be able to view any installation, organization or repository data.

**Installation**

- **FR-005**: A signed-in user MUST be able to start installation of the CodeLens GitHub App from within CodeLens. When the user returns from GitHub, the system MUST NOT link the installation to anyone until GitHub confirms that this user can access it; if that confirmation is not already available on return, the user MUST be asked to confirm with GitHub and the installation MUST remain unlinked until they do.
- **FR-006**: Repository selection and permission grants MUST happen only in GitHub's own installation flow. CodeLens MUST NOT offer its own way to grant or widen repository access, and GitHub MUST remain the authority for which repositories and permissions are granted.
- **FR-007**: After installation, the system MUST receive the GitHub installation event, verify its authenticity, and persist the installation together with its account or organization, account type, status and installation time.
- **FR-008**: The system MUST associate each installation with exactly one CodeLens organization (tenant context), created on demand from the GitHub account or organization that owns the installation.
- **FR-009**: The GitHub installation identifier MUST be treated as an authorization boundary: all repository data and repository operations reached through an installation MUST be scoped to that installation's organization. Requests made by users are authorized by organization membership (FR-010, FR-040); work triggered by GitHub events or synchronization is authorized by the installation identifier. Both MUST resolve to the same single organization, and neither may reach data of another organization.
- **FR-010**: The system MUST record which users may view and manage each organization, and MUST only show an installation to users who are members of the owning organization. A user becomes a member only when GitHub confirms that user can access the installation; an installation whose event arrived before any such confirmation is invisible to everyone until then. A user's role MUST be derived from GitHub (see FR-035 to FR-038), never self-declared and never inferred from who performed the installation.

**Repository synchronization**

- **FR-011**: The system MUST synchronize the repositories accessible to each installation from GitHub, recording for each its stable GitHub identifier, owner, name, default branch and visibility. The system MUST support up to 5,000 repositories per installation; beyond that it MUST synchronize the 5,000 with the lowest GitHub repository identifiers (the same set on every run) and MUST warn the user that the limit was reached.
- **FR-012**: Repository synchronization MUST be idempotent and safe to repeat: running it any number of times against unchanged GitHub state MUST produce the same result with no duplicates.
- **FR-013**: A repository MUST belong to exactly one organization and one installation at any time. A repository moves to another installation only when GitHub confirms the previous installation no longer has access (see Edge Cases on transfer); a move resets its CodeLens state to disabled and never exposes the former tenant's settings or history to the new tenant.
- **FR-014**: Synchronization MUST reflect additions, removals, renames and visibility changes reported by GitHub; removed repositories MUST be marked inaccessible rather than deleted, so their history is preserved. Such records are kept indefinitely in this release; no automatic deletion occurs.
- **FR-015**: Newly discovered repositories MUST start in the disabled state.
- **FR-016**: The system MUST provide a way to re-run synchronization on demand for an installation, limited to users holding the OWNER role (FR-035).
- **FR-017**: A synchronization failure MUST NOT corrupt or erase previously synchronized data. The system MUST retry failed synchronization automatically at least 3 times with increasing delay; if it still fails, the installation MUST show a failed synchronization state with one of the reason categories in FR-041 (never raw GitHub text), and OWNER users MUST be able to retry at any time.

**Visibility**

- **FR-018**: Members of the owning organization (OWNER or MEMBER) MUST be able to see, for each installation: the installation and its status, the owning account or organization, the list of accessible repositories, and each repository's state (for example enabled, disabled, no longer accessible). The repository list MUST be searchable by name and filterable by state.
- **FR-019**: The interface MUST present the hierarchy Installation → Organization → Repositories → Enable/Disable CodeLens.
- **FR-040**: Permitted actions MUST follow this matrix and no other rule:

  | Action | Visitor (signed out) | Signed-in user, not a member | MEMBER | OWNER |
  |--------|----------------------|------------------------------|--------|-------|
  | Sign in | Yes | – | – | – |
  | Start installation on GitHub | No | Yes | Yes | Yes |
  | Refresh access from GitHub | No | Yes | Yes | Yes |
  | View installations, organization, repositories and states | No | No | Yes | Yes |
  | Enable or disable a repository | No | No | No | Yes |
  | Re-run synchronization | No | No | No | Yes |

  MEMBER users MUST see management controls as unavailable, with the explanation that only organization owners can change them.
- **FR-041**: Each installation MUST be shown in exactly one of these states: *Setting up* (confirmed, first synchronization not finished); *Active*; *Active – synchronization failed*, with one reason category (GitHub unavailable, GitHub rate limit, access revoked, other); *Active – repository limit reached* (FR-011); *Suspended*; *Removed*. Allowed transitions: Setting up → Active (or its failed/limit variants); Active ↔ Suspended; Active or Suspended → Removed. Removed is final; a reinstall is a new installation (FR-026). Each repository MUST be shown as *Enabled*, *Disabled* or *No longer accessible*.
- **FR-020**: Users MUST NOT be able to see, or infer the existence of, installations or repositories belonging to organizations they are not authorized for. This applies to lists, detail pages, search results, counts, error messages, audit views and any other user-visible output; a request for another organization's resource MUST receive the same response as a request for a resource that does not exist.

**Enable and disable**

- **FR-021**: Users holding the OWNER role (FR-035) MUST be able to enable or disable CodeLens review for each accessible repository without uninstalling the GitHub App. Users holding the MEMBER role MUST be able to view but not change repository state.
- **FR-022**: The system MUST expose a single review-eligibility rule: a repository is eligible for review only if it is accessible, enabled, and belongs to an active (not suspended or removed) installation. The rule MUST be evaluated against current state on every use so a change takes effect on the next evaluation. Any future feature that starts review work MUST apply this rule; this feature does not itself perform review processing.
- **FR-023**: Every enable and disable action MUST be recorded in an audit trail with the acting user, repository, action and time.

**Lifecycle**

- **FR-024**: When GitHub reports the app uninstalled, the system MUST mark the installation as removed, treat all its repositories as disabled and inaccessible, and stop accepting review processing for them, while retaining historical records indefinitely (no automatic deletion in this release).
- **FR-025**: When GitHub reports the app suspended or unsuspended, the system MUST reflect that status and MUST NOT accept review processing while suspended.
- **FR-026**: When the app is reinstalled on an account that was previously uninstalled, GitHub treats it as a new installation with a new identifier. The system MUST record it as a new active installation under the same organization (tenant context), MUST NOT create a duplicate organization, MUST keep the earlier removed installation and its history as removed, and MUST start all repositories disabled.
- **FR-027**: The system MUST record installation lifecycle changes (installed, suspended, unsuspended, removed) in the audit trail.

**Webhook integrity**

- **FR-028**: The system MUST verify the authenticity of every incoming GitHub event before processing it. An event is authentic only if it carries proof, made with the secret shared between GitHub and CodeLens, that GitHub sent it and that its content has not been changed. Events with missing, malformed or non-matching proof MUST be rejected without changing any state. The response to a rejected event MUST only state that it was not accepted, with no further detail; authentic events, including repeats, MUST all receive the same acknowledgement.
- **FR-029**: The system MUST process each GitHub event delivery at most once in effect; repeated deliveries of the same event MUST NOT create duplicate data or duplicate audit entries. Two deliveries are the same event when they carry the same GitHub delivery identifier (GitHub reuses it when it redelivers). Distinct deliveries with identical content are each processed, but because every result is read from GitHub (FR-030), they cause no additional change.
- **FR-030**: The system MUST produce the correct final state when events arrive out of order or late, using GitHub as the authoritative source when an event and stored state disagree.
- **FR-031**: The system MUST acknowledge every event delivery within 10 seconds (GitHub's delivery timeout); longer work such as full repository synchronization MUST happen after the acknowledgement and MUST NOT delay it.

**Permissions and secrets**

- **FR-032**: For this feature the CodeLens GitHub App MUST be registered with, and this feature MUST use, only the read permissions it needs (repository metadata and installation data, plus the read-only permission for role verification in FR-039). Write permissions that the architecture baseline lists for later features (for example on pull requests or issues) MUST NOT be requested until a feature that needs them is specified. This feature MUST NOT perform any write operation on repositories, workflows, settings, issues or pull requests.
- **FR-033**: GitHub App private keys, webhook secrets, OAuth secrets and session secrets MUST NOT be stored as plaintext application data, exposed to any frontend client, written to logs or audit entries, or stored in source control.
- **FR-034**: Any short-lived credentials the system obtains from GitHub to read installation data MUST be used only by the server and MUST NOT be returned to the browser.

**Roles and owner verification**

- **FR-035**: The system MUST assign one of two roles per organization: OWNER, for a user whom GitHub reports as an owner of the GitHub organization (or, for a personal account, the account holder); and MEMBER, for any other user whom GitHub reports as able to access the installation. Only OWNER may enable or disable repositories or trigger synchronization.
- **FR-036**: A user's access and role MUST come from GitHub's answer about that specific user, never from who installed the app; the installer is OWNER only if GitHub also reports them as an owner. A confirmation from GitHub is valid for viewing until the user's session ends (at most 12 hours) or they refresh access, and for management actions only within the 10-minute limit of FR-037. Outside these limits it MUST be obtained from GitHub again.
- **FR-037**: Before accepting an enable, disable or synchronization request, the system MUST have confirmed the user's OWNER role with GitHub within the last 10 minutes. If the confirmation is older, the user MUST be asked to re-confirm with GitHub (CodeLens itself asks for nothing beyond GitHub's own confirmation step), and the request MUST NOT take effect until confirmation succeeds. The 10-minute limit bounds how long an owner removed on GitHub can still change CodeLens settings, without requiring a GitHub check on every action.
- **FR-038**: If GitHub cannot be reached, or does not return a definite answer, the system MUST refuse the management request and tell the user to retry; it MUST NOT fall back to a previously stored role. A user GitHub reports as no longer an owner MUST lose OWNER rights at the next confirmation, and a user no longer able to access the installation MUST lose access to it.
- **FR-039**: Verifying roles MUST use read-only access to GitHub. If it needs a GitHub permission not already in the architecture baseline, that permission MUST first be recorded there (Constitution Principle XV) and MUST NOT include any write access.

### Key Entities *(include if feature involves data)*

- **User**: A person with a CodeLens account, identified permanently by their GitHub user identity. Has a display name, email and avatar that may change.
- **Organization**: The tenant (also called tenant context or organization/tenant in this feature's documents). Represents a GitHub organization or personal account that owns repositories. All data in this feature is scoped to exactly one Organization.
- **Organization Membership**: Links a User to an Organization with a role (OWNER or MEMBER) that determines whether they may view or manage it, and the time GitHub last confirmed that role.
- **GitHub Installation**: A record that the CodeLens GitHub App is installed on an account, identified by GitHub's installation identifier. Has a status (active, suspended, removed), account type and installation time. Belongs to one Organization. Distinct from a User.
- **Repository**: A GitHub repository accessible through an installation, identified by GitHub's stable repository identifier. Has owner, name, default branch, visibility and a CodeLens state (enabled, disabled, no longer accessible). Belongs to exactly one Organization and one Installation.
- **Webhook Delivery Record**: A record of each GitHub event delivery received, used to recognize repeats and to trace what was accepted or rejected. Contains no secrets. *(Added to the ERD baseline in Amendment 1.)*
- **Audit Entry**: A record of a sensitive action (installation added, suspended, removed; repository enabled or disabled) with actor, target and time. Contains no secret values.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can go from first visit to seeing their installed repositories in CodeLens in under 5 minutes, without creating or pasting any access token.
- **SC-002**: After GitHub completes an installation, the installation and its repositories are visible in CodeLens within 30 seconds in at least 95% of installations and within 2 minutes in 99%, measured over installations of up to 500 repositories while GitHub is operating normally (product target for onboarding responsiveness).
- **SC-003**: For an installation with up to 500 repositories, synchronization completes and the full list is visible within 2 minutes. For an installation with more than 5,000 repositories, exactly 5,000 are listed, the same ones on repeated runs, with a visible limit warning.
- **SC-004**: 100% of event deliveries with a missing or invalid signature are rejected with no change to stored data.
- **SC-005**: Delivering the same valid event 10 times results in state identical to delivering it once, with zero duplicate installations, repositories or audit entries.
- **SC-006**: Running repository synchronization repeatedly (at least 10 times in a row) against unchanged GitHub state produces zero changes after the first run.
- **SC-007**: In tests with at least two tenants, 0% of requests by one tenant's users return another tenant's installations or repositories, including direct-identifier requests.
- **SC-008**: Disabling a repository takes effect on the next eligibility evaluation: once the user has received confirmation that it is disabled, every later evaluation for that repository returns not eligible.
- **SC-009**: Within 1 minute of GitHub reporting an uninstall, the installation shows as removed and 100% of its repositories are ineligible for review processing.
- **SC-010**: No secret value (private key, webhook secret, OAuth secret, session secret, installation credential, or the user's GitHub credential obtained at sign-in or installation) appears in any browser-delivered content or application log during the acceptance tests.
- **SC-011**: The feature works end to end in an automated test environment without a real GitHub installation, using simulated signed events.
- **SC-012**: In tests with a simulated GitHub, 100% of enable, disable and synchronization requests from a user GitHub reports as not an owner are rejected, and 100% of such requests made while GitHub confirmation is unavailable are refused.
- **SC-013**: Scanning the source repository and every built deployment artifact finds no private key or other secret value.
- **SC-014**: Every permission requested by the registered CodeLens GitHub App is read-only and is listed in the architecture baseline (FR-032, FR-039).

## Assumptions

- Any GitHub user can sign in; being a member of an organization in CodeLens is derived from what GitHub reports about the user's membership, and GitHub remains the authority.
- The personal GitHub account of a user who installs the app on themselves is treated as an Organization (tenant) with that user as OWNER, confirmed with GitHub like any other.
- Roles are only OWNER and MEMBER. GitHub organization owners are OWNER; the exact treatment of other GitHub roles (for example billing managers or custom roles) is MEMBER for now and may evolve. Finer-grained roles are out of scope.
- Confirming roles with GitHub needs read access to organization membership. This may require one additional read-only GitHub App permission that the architecture baseline (ADR-006) does not yet list; recording it there is a prerequisite for this feature, not a change to this specification.
- Repositories start disabled by default to follow least privilege and avoid unexpected review activity after installation.
- The CodeLens GitHub App is registered on GitHub for this feature with the minimum read permissions in FR-032; registering the app and later adding permissions is done outside this specification, following the architecture-change process.
- Repositories that stop being accessible are kept with history and marked, not deleted. Any retention or deletion policy for removed installations and inaccessible repositories is defined by a later feature.
- GitHub gives each repository a single owning account, so it is normally reported by only one CodeLens installation; overlap is a transient transfer case handled as in Edge Cases.
- Review processing itself does not exist yet; this feature only provides the eligibility rule (FR-022) that future review features must honor.
- Out of scope: AI code review, `.codelens.yml` parsing, AI provider configuration, model routing, billing, automatic code fixes, PR comments, PR approval, and any repository write operation.
- Out of scope for this feature and owned by the future review feature: what happens to review work already running when a repository becomes ineligible. That feature MUST re-apply the eligibility rule (FR-022) before publishing any result.
- Out of scope: rotating or revoking secrets (private key, webhook secret, OAuth and session secrets). This feature only requires that each secret can be replaced through configuration without changing the application; a rotation procedure is a later operational feature.
- Users have a modern web browser and a stable internet connection.

### Architecture baseline alignment

This spec follows ADR-001, 006, 008, 009, 017 and 020. The data it needs is defined in the ERD, including Amendment 1 (`docs/architecture/database-erd.md` §21). No ADR is contradicted; the read-only permission for role verification (FR-039) is added to ADR-006 before implementation.
