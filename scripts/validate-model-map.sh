#!/bin/bash

# Simple Model Map Validation Script
# Tests that OpenCode correctly uses models from config

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${HOME}/.opencode/logs/codex-plugin"

echo -e "${BLUE}════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Model Map Validation${NC}"
echo -e "${BLUE}════════════════════════════════════════════${NC}"
echo ""

# Test 1: Model that IS in the config (should work)
echo -e "${YELLOW}Test 1: Model IN config (gpt-5.1-codex-low)${NC}"
rm -rf "${LOG_DIR}"/*

cd "${REPO_DIR}"
if ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "say hello" --model="openai/gpt-5.1-codex-low" > /dev/null 2>&1; then
    # Check the log - find the one for gpt-5.1-codex-low specifically
    log_file=$(find "${LOG_DIR}" -name "*-after-transform.json" -exec grep -l "gpt-5.1-codex-low" {} \; | head -n 1)

    if [ -f "${log_file}" ]; then
        original=$(jq -r '.originalModel // "N/A"' "${log_file}")
        normalized=$(jq -r '.normalizedModel // "N/A"' "${log_file}")

        echo -e "  Original:   ${original}"
        echo -e "  Normalized: ${normalized}"

        if [ "${normalized}" == "gpt-5.1-codex" ]; then
            echo -e "  ${GREEN}✓ PASS - Correctly normalized to gpt-5.1-codex${NC}"
        else
            echo -e "  ${RED}✗ FAIL - Expected gpt-5.1-codex, got ${normalized}${NC}"
            exit 1
        fi
    else
        echo -e "  ${RED}✗ FAIL - No log file found${NC}"
        exit 1
    fi
else
    echo -e "  ${RED}✗ FAIL - Command failed${NC}"
    exit 1
fi

echo ""

# Test 2: Model that is NOT in the config (should error or use fallback)
echo -e "${YELLOW}Test 2: Model NOT in config (fake-model-xyz)${NC}"
rm -rf "${LOG_DIR}"/*

if ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "write test" --model="openai/fake-model-xyz" > /dev/null 2>&1; then
    log_file=$(find "${LOG_DIR}" -name "*-after-transform.json" | head -n 1)

    if [ -f "${log_file}" ]; then
        original=$(jq -r '.originalModel // "N/A"' "${log_file}")
        normalized=$(jq -r '.normalizedModel // "N/A"' "${log_file}")

        echo -e "  Original:   ${original}"
        echo -e "  Normalized: ${normalized}"
        echo -e "  ${GREEN}✓ Command succeeded (using fallback: ${normalized})${NC}"
    else
        echo -e "  ${YELLOW}⚠ No log file (expected - model not in config)${NC}"
    fi
else
    echo -e "  ${YELLOW}⚠ Command failed (expected - model not in config)${NC}"
fi

echo ""

# Test 3: Verify config location
echo -e "${YELLOW}Test 3: Verify config file location${NC}"
if [ -f "${REPO_DIR}/opencode.json" ]; then
    plugin_path=$(jq -r '.plugin[0]' "${REPO_DIR}/opencode.json")
    model_count=$(jq '.provider.openai.models | length' "${REPO_DIR}/opencode.json")

    echo -e "  Config file:  ${REPO_DIR}/opencode.json"
    echo -e "  Plugin path:  ${plugin_path}"
    echo -e "  Models defined: ${model_count}"
    echo -e "  ${GREEN}✓ Config file found and valid${NC}"
else
    echo -e "  ${RED}✗ No opencode.json in repo directory${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  All validation tests passed!${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
