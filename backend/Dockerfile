# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate
WORKDIR /app

FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# The schema must exist before install because the backend runs `prisma generate` after install.
COPY backend/prisma backend/prisma
RUN pnpm install --frozen-lockfile --filter @codelens/backend...
COPY backend backend
RUN pnpm --filter @codelens/backend build \
 && pnpm --filter @codelens/backend exec tsc -p tsconfig.fakes.json

# API and worker image. It keeps the installed dependencies (including the Prisma CLI used by the
# migrate service) and contains no secret: keys are mounted at run time.
FROM build AS runtime
ENV NODE_ENV=production
WORKDIR /app/backend
USER node
CMD ["node", "dist/main.js"]

# Test-only image target: runs the fake GitHub used by the `test` compose profile.
FROM build AS fake-github
WORKDIR /app/backend
USER node
CMD ["node", "dist-fakes/test/fakes/serve.js"]
