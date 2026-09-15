# syntax=docker/dockerfile:1
# Build context is the monorepo root (see docker-compose.yml: context: .), because npm
# workspaces need the root package.json/package-lock.json + sibling packages present.

FROM node:22-alpine AS base
WORKDIR /repo

# ---- deps: install the full workspace so npm can hoist/link correctly ----
FROM base AS deps
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN npm install --workspaces --include-workspace-root

# ---- build: compile shared-types then the api ----
FROM deps AS build
COPY packages/shared-types packages/shared-types
COPY apps/api apps/api
RUN npm run build --workspace=@papp/shared-types
RUN npm run --workspace=@papp/api prisma:generate
RUN npm run build --workspace=@papp/api

# ---- runtime: only what's needed to run the compiled server ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo

COPY --from=build /repo/package.json /repo/package-lock.json* ./
COPY --from=build /repo/tsconfig.base.json ./
COPY --from=build /repo/packages/shared-types/package.json packages/shared-types/package.json
COPY --from=build /repo/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /repo/apps/api/package.json apps/api/package.json
RUN npm install --workspaces --include-workspace-root --omit=dev --ignore-scripts

COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/prisma apps/api/prisma
# `prisma generate`'s output is hoisted to the workspace root by npm, not
# apps/api/node_modules — copy it from where it actually landed.
COPY --from=build /repo/node_modules/.prisma node_modules/.prisma

WORKDIR /repo/apps/api
EXPOSE 3000
CMD ["node", "dist/main.js"]
