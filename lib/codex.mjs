import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

// Codex instructions constants
const GITHUB_API_RELEASES = "https://api.github.com/repos/openai/codex/releases/latest";
const CACHE_DIR = join(homedir(), ".opencode", "cache");
const CACHE_FILE = join(CACHE_DIR, "codex-instructions.md");
const CACHE_METADATA_FILE = join(CACHE_DIR, "codex-instructions-meta.json");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get the latest release tag from GitHub
 * @returns {Promise<string>} Release tag name (e.g., "rust-v0.43.0")
 */
async function getLatestReleaseTag() {
	const response = await fetch(GITHUB_API_RELEASES);
	if (!response.ok) throw new Error(`Failed to fetch latest release: ${response.status}`);
	const data = await response.json();
	return data.tag_name;
}

/**
 * Fetch Codex instructions from GitHub with ETag-based caching
 * Uses HTTP conditional requests to efficiently check for updates
 * Always fetches from the latest release tag, not main branch
 * @returns {Promise<string>} Codex instructions
 */
export async function getCodexInstructions() {
	try {
		// Get the latest release tag
		const latestTag = await getLatestReleaseTag();
		const CODEX_INSTRUCTIONS_URL = `https://raw.githubusercontent.com/openai/codex/${latestTag}/codex-rs/core/gpt_5_codex_prompt.md`;

		// Load cached metadata (includes ETag and tag)
		let cachedETag = null;
		let cachedTag = null;
		if (existsSync(CACHE_METADATA_FILE)) {
			const metadata = JSON.parse(readFileSync(CACHE_METADATA_FILE, "utf8"));
			cachedETag = metadata.etag;
			cachedTag = metadata.tag;
		}

		// If tag changed, we need to fetch new instructions
		if (cachedTag !== latestTag) {
			cachedETag = null; // Force re-fetch
		}

		// Make conditional request with If-None-Match header
		const headers = {};
		if (cachedETag) {
			headers["If-None-Match"] = cachedETag;
		}

		const response = await fetch(CODEX_INSTRUCTIONS_URL, { headers });

		// 304 Not Modified - our cached version is still current
		if (response.status === 304) {
			if (existsSync(CACHE_FILE)) {
				return readFileSync(CACHE_FILE, "utf8");
			}
			// Cache file missing but GitHub says not modified - fall through to re-fetch
		}

		// 200 OK - new content or first fetch
		if (response.ok) {
			const instructions = await response.text();
			const newETag = response.headers.get("etag");

			// Create cache directory if it doesn't exist
			if (!existsSync(CACHE_DIR)) {
				mkdirSync(CACHE_DIR, { recursive: true });
			}

			// Cache the instructions with ETag and tag (verbatim from GitHub)
			writeFileSync(CACHE_FILE, instructions, "utf8");
			writeFileSync(
				CACHE_METADATA_FILE,
				JSON.stringify({
					etag: newETag,
					tag: latestTag,
					lastChecked: Date.now(),
					url: CODEX_INSTRUCTIONS_URL,
				}),
				"utf8",
			);

			return instructions;
		}

		throw new Error(`HTTP ${response.status}`);
	} catch (error) {
		console.error(
			"[openai-codex-plugin] Failed to fetch instructions from GitHub:",
			error.message,
		);

		// Try to use cached version even if stale
		if (existsSync(CACHE_FILE)) {
			console.error("[openai-codex-plugin] Using cached instructions");
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
