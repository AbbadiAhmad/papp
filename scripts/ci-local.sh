#!/bin/bash
set -e

# Local CI pipeline replica — runs all checks without Docker
# Usage: npm run ci:local
#
# This script runs linting, type checking, and unit tests locally.
# E2E tests require Docker/container runtime and must run in CI or with docker-compose.

# Get the root directory (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

echo "========================================="
echo "papp Local CI Pipeline (no Docker)"
echo "========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

failed_checks=()

# Helper function to run a check
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

# 1. Lint checks
echo -e "${BLUE}=== Linting ===${NC}"
echo ""
run_check "Linting (apps/api)" "npm --workspace=@papp/api run lint"
run_check "Lint permissions" "npm run lint:permissions"
run_check "Lint locales" "npm run lint:locales"
run_check "Lint no hardcoded roles" "npm run lint:no-hardcoded-roles"
run_check "Lint manifests" "npm run lint:manifests"

# 2. TypeScript checks
echo -e "${BLUE}=== TypeScript ===${NC}"
echo ""
run_check "TypeScript (shared-types)" "npm --workspace=@papp/shared-types run build"
run_check "TypeScript (apps/api)" "npm --workspace=@papp/api run build"
run_check "TypeScript (apps/web)" "npm --workspace=@papp/web run build"

# 3. Unit tests
echo -e "${BLUE}=== Unit Tests ===${NC}"
echo ""
run_check "Unit tests (apps/api)" "npm --workspace=@papp/api run test:unit"
run_check "Frontend tests (apps/web)" "npm --workspace=@papp/web run test"

# 4. E2E tests (require Docker, skip with note)
echo -e "${BLUE}=== Integration Tests ===${NC}"
echo ""
echo -e "${YELLOW}ℹ E2E tests require Docker/container runtime — skipped in local mode${NC}"
echo -e "${YELLOW}  To run E2E tests, use: npm --workspace=@papp/api run test:e2e${NC}"
echo -e "${YELLOW}  Or let CI run them on push${NC}"
echo ""

# Summary
echo "========================================="
if [ ${#failed_checks[@]} -eq 0 ]; then
  echo -e "${GREEN}✓ All checks passed!${NC}"
  echo ""
  echo "Next steps:"
  echo "  • Push to feature branch with git push"
  echo "  • E2E tests will run in CI automatically"
  echo ""
  exit 0
else
  echo -e "${RED}✗ Failed checks:${NC}"
  for check in "${failed_checks[@]}"; do
    echo -e "  ${RED}×${NC} $check"
  done
  exit 1
fi
