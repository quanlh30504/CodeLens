# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate
WORKDIR /app

FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile --filter @codelens/frontend...
COPY frontend frontend
RUN pnpm --filter @codelens/frontend build

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile --prod --filter @codelens/frontend...
COPY --from=build /app/frontend/.next frontend/.next
COPY frontend/next.config.mjs frontend/
WORKDIR /app/frontend
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
