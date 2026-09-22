#!/bin/bash
set -e

# Local CI pipeline replica — mirrors .github/workflows/ci.yml job-for-job,
# including the Docker-backed Tier 2 suites (backend integration/e2e,
# frontend Playwright) that the original version of this script skipped.
#
# Usage:
#   npm run ci:local            # full pipeline, same jobs as ci.yml
#   npm run ci:local -- --fast  # skip Docker/Postgres-backed jobs (lint+build+unit only)
#
# Spins up a THROWAWAY Postgres container on a non-default host port
# (5433) so it never collides with a docker-compose dev stack already
# running on 5432 — mirrors ci.yml's `postgres:16-alpine` service
# container (same user/password/db: papp/papp/papp). Always removed on
# exit via a trap, success or failure.
#
# force-password-change.spec.ts is skipped automatically when `psql` is
# not found on PATH (its fixture-reset shells out to it directly) — this
# only affects machines without a local psql client; ubuntu-latest CI
# runners ship postgresql-client preinstalled, so ci.yml runs it for real.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

FAST=false
for arg in "$@"; do
  if [ "$arg" = "--fast" ]; then
    FAST=true
  fi
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PG_CONTAINER="papp-ci-local-pg"
PG_PORT="5433"
DATABASE_URL="postgresql://papp:papp@localhost:${PG_PORT}/papp?schema=public"
JWT_SECRET="ci-only-not-a-real-secret-see-env-example"

failed_checks=()
pg_started=false

echo "========================================="
echo "papp Local CI Pipeline"
if [ "$FAST" = true ]; then
  echo "(--fast: lint/build/unit only, no Docker/Postgres jobs)"
fi
echo "========================================="
echo ""

cleanup() {
  if [ "$pg_started" = true ]; then
    echo ""
    echo -e "${YELLOW}→ Removing throwaway Postgres container (${PG_CONTAINER})${NC}"
    docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

run_check() {
  local name=$1
  local cmd=$2

  echo -e "${YELLOW}→ ${name}${NC}"
  if eval "$cmd"; then
    echo -e "${GREEN}✓ ${name} passed${NC}"
    echo ""
  else
    echo -e "${RED}✗ ${name} failed${NC}"
    echo ""
    failed_checks+=("$name")
  fi
}

start_postgres() {
  if [ "$pg_started" = true ]; then
    return
  fi
  echo -e "${BLUE}=== Starting throwaway Postgres (Tier 2 jobs) ===${NC}"
  echo ""
  if ! command -v docker >/dev/null 2>&1; then
    echo -e "${RED}✗ docker not found — cannot run Docker/Postgres-backed jobs. Use --fast to skip them.${NC}"
    exit 1
  fi
  docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$PG_CONTAINER" \
    -e POSTGRES_USER=papp -e POSTGRES_PASSWORD=papp -e POSTGRES_DB=papp \
    -p "${PG_PORT}:5432" postgres:16-alpine >/dev/null
  pg_started=true

  echo -n "  waiting for Postgres to accept connections"
  for _ in $(seq 1 30); do
    if docker exec "$PG_CONTAINER" pg_isready -U papp -d papp >/dev/null 2>&1; then
      echo " — ready"
      echo ""
      return
    fi
    echo -n "."
    sleep 1
  done
  echo ""
  echo -e "${RED}✗ Postgres did not become ready in time${NC}"
  exit 1
}

# ---------------------------------------------------------------------
# 1. Lint (docs/TESTING_STRATEGY.md §8 pipeline order: lint -> typecheck
#    -> build), matching ci.yml's `build` + `static-analysis` jobs.
# ---------------------------------------------------------------------
echo -e "${BLUE}=== Linting ===${NC}"
echo ""
run_check "Lint (all workspaces)" "npm run lint"
run_check "Typecheck scripts/" "npm run typecheck:scripts"
run_check "Lint permissions" "npm run lint:permissions"
run_check "Lint locales" "npm run lint:locales"
run_check "Lint no hardcoded roles" "npm run lint:no-hardcoded-roles"
run_check "Lint no module-specific platform code" "npm run lint:no-module-specific-platform-code"

# ---------------------------------------------------------------------
# 2. Build / typecheck (ci.yml's `build` job runs Prisma generate first).
# ---------------------------------------------------------------------
echo -e "${BLUE}=== Build / typecheck ===${NC}"
echo ""
run_check "Generate Prisma client" "npm run --workspace=@papp/api prisma:generate"
run_check "Build (all workspaces)" "npm run build"

# ---------------------------------------------------------------------
# 3. Backend unit tests (Tier 1 — no DB/Docker/browser needed).
#    Calls jest directly (via npx, cwd apps/api) rather than through
#    `npm run test:unit` — apps/api/package.json's own script text is
#    `NODE_OPTIONS=--experimental-vm-modules jest ...`, POSIX inline-env
#    syntax that fails when npm invokes it via cmd.exe on Windows
#    (`'NODE_OPTIONS' is not recognized...`). Exporting the var in THIS
#    shell first and calling jest without the inline prefix sidesteps
#    that; ci.yml's Linux runners parse the original npm script fine,
#    so apps/api/package.json itself is left unchanged.
# ---------------------------------------------------------------------
echo -e "${BLUE}=== Unit Tests ===${NC}"
echo ""
export NODE_OPTIONS="--experimental-vm-modules"
run_check "Backend unit tests" "(cd apps/api && npx jest --config test/jest.unit.config.ts)"
run_check "Backend coverage gate" "(cd apps/api && npx jest --config test/jest.unit.config.ts --coverage)"
run_check "Frontend unit tests" "npm run test --workspace=@papp/web"

if [ "$FAST" = true ]; then
  echo -e "${YELLOW}ℹ --fast: skipping backend integration/e2e + frontend Playwright (Tier 2)${NC}"
  echo ""
else
  # ---------------------------------------------------------------------
  # 4. Backend integration + e2e (Tier 2 — real Postgres via Testcontainers
  #    and the jest.integration/e2e suites; DATABASE_URL below is the
  #    defensive-baseline connection ci.yml's own `services: postgres:`
  #    block provides — some specs override it themselves via
  #    Testcontainers, same as in CI).
  # ---------------------------------------------------------------------
  start_postgres
  echo -e "${BLUE}=== Backend Integration/E2E Tests (Tier 2) ===${NC}"
  echo ""
  export DATABASE_URL
  export JWT_SECRET
  export NODE_OPTIONS="--experimental-vm-modules"
  run_check "Backend integration tests" "(cd apps/api && npx jest --config test/jest.integration.config.ts)"
  run_check "Build @papp/shared-types + @papp/api (for e2e self-heal)" "npm run build --workspace=@papp/shared-types && npm run build --workspace=@papp/api"
  run_check "Backend e2e tests" "(cd apps/api && npx jest --config test/jest.e2e.config.ts)"

  # ---------------------------------------------------------------------
  # 5. Frontend Playwright e2e (Tier 2 — real api + real Postgres + real
  #    served web bundle). Ports offset from the dev-stack defaults
  #    (3000/5173) so a running `docker-compose up` dev stack is never
  #    disturbed.
  # ---------------------------------------------------------------------
  echo -e "${BLUE}=== Frontend E2E Tests (Playwright, Tier 2) ===${NC}"
  echo ""
  export PW_API_PORT="${PW_API_PORT:-3101}"
  export PW_WEB_PORT="${PW_WEB_PORT:-5174}"
  export CI=true
  # `npx --prefix apps/web ...` only changes where npx resolves the
  # binary/node_modules from — NOT the working directory Playwright
  # resolves `playwright.config.ts`'s relative `testDir` against, which
  # is still the shell's real cwd. Without a real `cd`, Playwright silently
  # falls back to config discovery from repo root and picks up every
  # *.spec.ts under apps/api/test + modules/**/test as "tests" (Jest
  # specs, incompatible with the Playwright test runner). A real `cd` is
  # required, not just `--prefix`.
  if [ -z "$SKIP_PLAYWRIGHT_INSTALL" ]; then
    run_check "Install Playwright browsers" "(cd apps/web && npx playwright install chromium)"
  fi

  PW_GREP_INVERT=""
  if ! command -v psql >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ psql not found on PATH — skipping force-password-change.spec.ts locally.${NC}"
    echo -e "${YELLOW}  Its support/db.ts fixture-reset shells out to psql directly; ubuntu-latest CI${NC}"
    echo -e "${YELLOW}  runners ship postgresql-client preinstalled, so this only affects machines${NC}"
    echo -e "${YELLOW}  (like this one) without a local psql client — verified against real${NC}"
    echo -e "${YELLOW}  Postgres separately, not a real gap in the spec itself.${NC}"
    echo ""
    PW_GREP_INVERT='--grep-invert="Force password change"'
  fi
  run_check "Playwright e2e (apps/web)" "(cd apps/web && npx playwright test --retries=0 $PW_GREP_INVERT)"
fi

# ---------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------
echo "========================================="
if [ ${#failed_checks[@]} -eq 0 ]; then
  echo -e "${GREEN}✓ All checks passed!${NC}"
  echo ""
  exit 0
else
  echo -e "${RED}✗ Failed checks:${NC}"
  for check in "${failed_checks[@]}"; do
    echo -e "  ${RED}×${NC} $check"
  done
  exit 1
fi
