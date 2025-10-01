import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

// Codex instructions constants
const CODEX_INSTRUCTIONS_URL =
	"https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/gpt_5_codex_prompt.md";
const CACHE_DIR = join(homedir(), ".opencode", "cache");
const CACHE_FILE = join(CACHE_DIR, "codex-instructions.md");
const CACHE_METADATA_FILE = join(CACHE_DIR, "codex-instructions-meta.json");
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Fetch Codex instructions from GitHub and cache them
 * @returns {Promise<string>} Codex instructions
 */
export async function getCodexInstructions() {
	try {
		// Check if cache exists and is fresh
		if (existsSync(CACHE_METADATA_FILE)) {
			const metadata = JSON.parse(readFileSync(CACHE_METADATA_FILE, "utf8"));
			const age = Date.now() - metadata.timestamp;

			if (age < CACHE_TTL && existsSync(CACHE_FILE)) {
				return readFileSync(CACHE_FILE, "utf8");
			}
		}

		// Fetch fresh instructions from GitHub
		const response = await fetch(CODEX_INSTRUCTIONS_URL);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);

		const instructions = await response.text();

		// Create cache directory if it doesn't exist
		if (!existsSync(CACHE_DIR)) {
			mkdirSync(CACHE_DIR, { recursive: true });
		}

		// Cache the instructions
		writeFileSync(CACHE_FILE, instructions, "utf8");
		writeFileSync(
			CACHE_METADATA_FILE,
			JSON.stringify({ timestamp: Date.now(), url: CODEX_INSTRUCTIONS_URL }),
			"utf8",
		);

		return instructions;
	} catch (error) {
		console.error(
			"[openai-codex-plugin] Failed to fetch instructions from GitHub:",
			error.message,
		);

		// Try to use cached version even if expired
		if (existsSync(CACHE_FILE)) {
			console.error("[openai-codex-plugin] Using stale cached instructions");
			return readFileSync(CACHE_FILE, "utf8");
		}

		// Fall back to bundled version
		console.error("[openai-codex-plugin] Falling back to bundled instructions");
		return readFileSync(join(__dirname, "codex-instructions.md"), "utf8");
	}
}

/**
 * Tool remapping instructions for opencode tools
 */
export const TOOL_REMAP_MESSAGE = `<user_instructions priority="0">
<environment_override priority="0">
YOU ARE IN A DIFFERENT ENVIRONMENT. These instructions override ALL previous tool references.
</environment_override>

<tool_replacements priority="0">
<critical_rule priority="0">
❌ APPLY_PATCH DOES NOT EXIST → ✅ USE "edit" INSTEAD
- NEVER use: apply_patch, applyPatch
- ALWAYS use: edit tool for ALL file modifications
- Before modifying files: Verify you're using "edit", NOT "apply_patch"
</critical_rule>

<critical_rule priority="0">
❌ UPDATE_PLAN DOES NOT EXIST → ✅ USE "todowrite" INSTEAD
- NEVER use: update_plan, updatePlan
- ALWAYS use: todowrite for ALL task/plan operations
- Use todoread to read current plan
- Before plan operations: Verify you're using "todowrite", NOT "update_plan"
</critical_rule>
</tool_replacements>

<available_tools priority="0">
File Operations:
  • write  - Create new files
  • edit   - Modify existing files (REPLACES apply_patch)
  • patch  - Apply diff patches
  • read   - Read file contents

Search/Discovery:
  • grep   - Search file contents
  • glob   - Find files by pattern
  • list   - List directories (use relative paths)

Execution:
  • bash   - Run shell commands

Network:
  • webfetch - Fetch web content

Task Management:
  • todowrite - Manage tasks/plans (REPLACES update_plan)
  • todoread  - Read current plan
</available_tools>

<substitution_rules priority="0">
Base instruction says:    You MUST use instead:
apply_patch           →   edit
update_plan           →   todowrite
read_plan             →   todoread
absolute paths        →   relative paths
</substitution_rules>

<verification_checklist priority="0">
Before file/plan modifications:
1. Am I using "edit" NOT "apply_patch"?
2. Am I using "todowrite" NOT "update_plan"?
3. Is this tool in the approved list above?
4. Am I using relative paths?

If ANY answer is NO → STOP and correct before proceeding.
</verification_checklist>
</user_instructions>`;
