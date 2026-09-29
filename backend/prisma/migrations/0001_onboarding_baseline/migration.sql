-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "github_user_id" VARCHAR(64) NOT NULL,
    "login" VARCHAR(255) NOT NULL,
    "email" VARCHAR(320),
    "avatar_url" VARCHAR(2048),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "github_org_id" VARCHAR(64) NOT NULL,
    "account_type" VARCHAR(16) NOT NULL,
    "login" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255),
    "avatar_url" VARCHAR(2048),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "role_verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_installations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "github_installation_id" BIGINT NOT NULL,
    "account_type" VARCHAR(16) NOT NULL,
    "account_login" VARCHAR(255) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "repository_selection" VARCHAR(16) NOT NULL DEFAULT 'SELECTED',
    "sync_status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "sync_error_code" VARCHAR(64),
    "last_synced_at" TIMESTAMPTZ(6),
    "installed_at" TIMESTAMPTZ(6) NOT NULL,
    "suspended_at" TIMESTAMPTZ(6),
    "removed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "github_repository_id" BIGINT NOT NULL,
    "owner" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(512) NOT NULL,
    "default_branch" VARCHAR(255),
    "private" BOOLEAN NOT NULL DEFAULT true,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACCESSIBLE',
    "review_enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabled_at" TIMESTAMPTZ(6),
    "enabled_by_user_id" UUID,
    "sync_conflict" BOOLEAN NOT NULL DEFAULT false,
    "last_synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_guid" VARCHAR(64) NOT NULL,
    "event" VARCHAR(64) NOT NULL,
    "action" VARCHAR(64),
    "github_installation_id" BIGINT,
    "payload_sha256" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "error_code" VARCHAR(64),
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "resource_type" VARCHAR(64) NOT NULL,
    "resource_id" UUID,
    "metadata" JSONB,
    "ip_hash" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_github_user_id_key" ON "users"("github_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_github_org_id_key" ON "organizations"("github_org_id");

-- CreateIndex
CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "github_installations_github_installation_id_key" ON "github_installations"("github_installation_id");

-- CreateIndex
CREATE INDEX "github_installations_organization_id_idx" ON "github_installations"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_github_repository_id_key" ON "repositories"("github_repository_id");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_full_name_key" ON "repositories"("full_name");

-- CreateIndex
CREATE INDEX "repositories_organization_id_idx" ON "repositories"("organization_id");

-- CreateIndex
CREATE INDEX "repositories_installation_id_status_idx" ON "repositories"("installation_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_delivery_guid_key" ON "webhook_deliveries"("delivery_guid");

-- CreateIndex
CREATE INDEX "webhook_deliveries_github_installation_id_received_at_idx" ON "webhook_deliveries"("github_installation_id", "received_at");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "github_installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_enabled_by_user_id_fkey" FOREIGN KEY ("enabled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Constraints Prisma cannot express (ERD baseline + Amendment 1, sections 14, 16, 17)
-- ---------------------------------------------------------------------------

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_account_type_check"
  CHECK ("account_type" IN ('ORGANIZATION', 'USER'));

ALTER TABLE "organization_members"
  ADD CONSTRAINT "organization_members_role_check"
  CHECK ("role" IN ('OWNER', 'MEMBER'));

ALTER TABLE "github_installations"
  ADD CONSTRAINT "github_installations_account_type_check"
  CHECK ("account_type" IN ('ORGANIZATION', 'USER'));

ALTER TABLE "github_installations"
  ADD CONSTRAINT "github_installations_status_check"
  CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'REMOVED'));

ALTER TABLE "github_installations"
  ADD CONSTRAINT "github_installations_sync_status_check"
  CHECK ("sync_status" IN ('PENDING', 'SYNCING', 'SYNCED', 'FAILED'));

ALTER TABLE "github_installations"
  ADD CONSTRAINT "github_installations_repository_selection_check"
  CHECK ("repository_selection" IN ('ALL', 'SELECTED'));

ALTER TABLE "repositories"
  ADD CONSTRAINT "repositories_status_check"
  CHECK ("status" IN ('ACCESSIBLE', 'INACCESSIBLE'));

-- An inaccessible repository can never be enabled for review.
ALTER TABLE "repositories"
  ADD CONSTRAINT "repositories_review_enabled_requires_accessible_check"
  CHECK ("review_enabled" = false OR "status" = 'ACCESSIBLE');

ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_status_check"
  CHECK ("status" IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED'));
