/**
 * OpenCode Codex Prompt Fetcher
 *
 * Fetches and caches the codex.txt system prompt from OpenCode's GitHub repository.
 * Uses ETag-based caching to efficiently track updates.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const OPENCODE_CODEX_URL =
	"https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/session/prompt/codex.txt";
const CACHE_DIR = join(homedir(), ".opencode", "cache");
const CACHE_FILE = join(CACHE_DIR, "opencode-codex.txt");
const CACHE_META_FILE = join(CACHE_DIR, "opencode-codex-meta.json");

interface CacheMeta {
	etag: string;
	lastFetch?: string; // Legacy field for backwards compatibility
	lastChecked: number; // Timestamp for rate limit protection
}

/**
 * Fetch OpenCode's codex.txt prompt with ETag-based caching
 * Uses HTTP conditional requests to efficiently check for updates
 *
 * Rate limit protection: Only checks GitHub if cache is older than 15 minutes
 * @returns The codex.txt content
 */
export async function getOpenCodeCodexPrompt(): Promise<string> {
	await mkdir(CACHE_DIR, { recursive: true });

	// Try to load cached content and metadata
	let cachedContent: string | null = null;
	let cachedMeta: CacheMeta | null = null;

	try {
		cachedContent = await readFile(CACHE_FILE, "utf-8");
		const metaContent = await readFile(CACHE_META_FILE, "utf-8");
		cachedMeta = JSON.parse(metaContent);
	} catch {
		// Cache doesn't exist or is invalid, will fetch fresh
	}

	// Rate limit protection: If cache is less than 15 minutes old, use it
	const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
	if (cachedMeta?.lastChecked && (Date.now() - cachedMeta.lastChecked) < CACHE_TTL_MS && cachedContent) {
		return cachedContent;
	}

	// Fetch from GitHub with conditional request
	const headers: Record<string, string> = {};
	if (cachedMeta?.etag) {
		headers["If-None-Match"] = cachedMeta.etag;
	}

	try {
		const response = await fetch(OPENCODE_CODEX_URL, { headers });

		// 304 Not Modified - cache is still valid
		if (response.status === 304 && cachedContent) {
			return cachedContent;
		}

		// 200 OK - new content available
		if (response.ok) {
			const content = await response.text();
			const etag = response.headers.get("etag") || "";

			// Save to cache with timestamp
			await writeFile(CACHE_FILE, content, "utf-8");
			await writeFile(
				CACHE_META_FILE,
				JSON.stringify(
					{
						etag,
						lastFetch: new Date().toISOString(), // Keep for backwards compat
						lastChecked: Date.now(),
					} satisfies CacheMeta,
					null,
					2
				),
				"utf-8"
			);

			return content;
		}

		// Fallback to cache if available
		if (cachedContent) {
			return cachedContent;
		}

		throw new Error(`Failed to fetch OpenCode codex.txt: ${response.status}`);
	} catch (error) {
		// Network error - fallback to cache
		if (cachedContent) {
			return cachedContent;
		}

		throw new Error(
			`Failed to fetch OpenCode codex.txt and no cache available: ${error}`
		);
	}
}

/**
 * Get first N characters of the cached OpenCode prompt for verification
 * @param chars Number of characters to get (default: 50)
 * @returns First N characters or null if not cached
 */
export async function getCachedPromptPrefix(chars = 50): Promise<string | null> {
	try {
		const content = await readFile(CACHE_FILE, "utf-8");
		return content.substring(0, chars);
	} catch {
		return null;
	}
}
