# syntax=docker/dockerfile:1
# Build context is the monorepo root (see docker-compose.yml: context: .).

FROM node:22-alpine AS base
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN npm install --workspaces --include-workspace-root

FROM deps AS build
COPY packages/shared-types packages/shared-types
COPY apps/web apps/web
# Root DECISIONS.md D78: Vite's `import.meta.glob('../../../../../modules/*/
# frontend/routes.tsx', ...)` (apps/web/src/shared/modules/discovery.ts) is
# what bundles every module's frontend routes/menu into the SPA at build
# time — this Dockerfile never copied `modules/` into the build context at
# all (the same gap root A23/apps/api/Dockerfile had, fixed there but missed
# here), so a real docker-compose build always shipped a frontend with ZERO
# module routes, regardless of what was installed on the backend — a fresh
# `POST /modules/install` succeeding server-side never made its page
# reachable (404) until this was fixed.
COPY modules modules
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build --workspace=@papp/shared-types
RUN npm run build --workspace=@papp/web

FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
