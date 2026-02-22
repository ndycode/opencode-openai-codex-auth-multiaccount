#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const API_BASE = "https://api.github.com/repos/openai/codex/releases";
const REPO_URL = "https://github.com/openai/codex/releases";
const OUTPUT_DIR = join(process.cwd(), "docs", "audit");
const JSON_OUTPUT_PATH = join(OUTPUT_DIR, "codex-release-parity.json");
const MD_OUTPUT_PATH = join(OUTPUT_DIR, "codex-release-parity.md");
const MATRIX_JSON_OUTPUT_PATH = join(OUTPUT_DIR, "codex-release-parity-matrix.json");
const MATRIX_MD_OUTPUT_PATH = join(OUTPUT_DIR, "codex-release-parity-matrix.md");

const SEMANTIC_BUCKETS = [
	{
		id: "models_capabilities",
		label: "Models / Capabilities",
		status: "implemented",
		rationale:
			"Dynamic model capability sync + reasoning auto-clamp are implemented in plugin.",
		patterns: [
			/\bmodel(s)?\b/i,
			/\bcapabilit(y|ies)\b/i,
			/\breasoning\b/i,
			/\bcontext window\b/i,
		],
	},
	{
		id: "tools_schemas",
		label: "Tools / Schemas",
		status: "partial",
		rationale:
			"Schema-safe tool-argument recovery and runtime tool capability registry are implemented; full runtime tool surface parity remains runtime-dependent.",
		patterns: [
			/\btool(s)?\b/i,
			/\bschema\b/i,
			/\bjson schema\b/i,
			/\barguments?\b/i,
			/\bmcp\b/i,
		],
	},
	{
		id: "approvals_policy",
		label: "Approvals / Policy",
		status: "implemented",
		rationale:
			"Approval/policy failures are classified explicitly and no longer trigger account rotation.",
		patterns: [
			/\bapproval\b/i,
			/\bpolicy\b/i,
			/\bsandbox\b/i,
			/\bpermission\b/i,
			/\bseatbelt\b/i,
		],
	},
	{
		id: "routing_reroute",
		label: "Routing / Reroute / Retry",
		status: "partial",
		rationale:
			"Reroute logging + UI notices and route-aware retry matrix exist, but matrix remains opt-in (`legacy` default).",
		patterns: [
			/\breroute\b/i,
			/\brouting\b/i,
			/\bfallback\b/i,
			/\bretry\b/i,
			/\brate limit\b/i,
		],
	},
	{
		id: "cli_tui",
		label: "Codex CLI / TUI",
		status: "not-applicable",
		rationale:
			"Codex CLI runtime behavior/UI internals are upstream concerns; plugin can only adapt via prompts/config and runtime signals.",
		patterns: [
			/\bcli\b/i,
			/\btui\b/i,
			/\bterminal\b/i,
			/\bprompt toolkit\b/i,
			/\brust\b/i,
		],
	},
	{
		id: "auth_oauth",
		label: "Auth / OAuth",
		status: "partial",
		rationale:
			"Plugin maintains its own OAuth flow and token handling; some Codex auth changes are upstream CLI-specific.",
		patterns: [/\boauth\b/i, /\bauth\b/i, /\btoken\b/i, /\bpkce\b/i],
	},
	{
		id: "observability",
		label: "Logging / Observability",
		status: "implemented",
		rationale:
			"Structured warnings/logging added for reroute, deprecation, and failure-route diagnostics.",
		patterns: [
			/\blog(s|ging)?\b/i,
			/\btelemetry\b/i,
			/\bobservab/i,
			/\btrace\b/i,
			/\bmetrics?\b/i,
		],
	},
];

const UNKNOWN_BUCKET = {
	id: "other",
	label: "Other / Needs Review",
	status: "planned",
	rationale:
		"Release note item did not match current plugin-focused semantic buckets; manual review may still be needed.",
};

function parseVersionParts(value) {
	const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
	if (!match) return undefined;
	return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function compareVersionsAscending(a, b) {
	const aParts = parseVersionParts(a.tag) ?? [0, 0, 0];
	const bParts = parseVersionParts(b.tag) ?? [0, 0, 0];
	for (let index = 0; index < 3; index += 1) {
		if (aParts[index] !== bParts[index]) return aParts[index] - bParts[index];
	}
	const aDate = Date.parse(a.publishedAt ?? a.createdAt ?? "");
	const bDate = Date.parse(b.publishedAt ?? b.createdAt ?? "");
	if (Number.isFinite(aDate) && Number.isFinite(bDate)) return aDate - bDate;
	return a.tag.localeCompare(b.tag);
}

function normalizeRelease(raw) {
	return {
		id: raw.id,
		tag: typeof raw.tag_name === "string" ? raw.tag_name : "",
		name: typeof raw.name === "string" ? raw.name : "",
		body: typeof raw.body === "string" ? raw.body : "",
		draft: Boolean(raw.draft),
		prerelease: Boolean(raw.prerelease),
		publishedAt: typeof raw.published_at === "string" ? raw.published_at : null,
		createdAt: typeof raw.created_at === "string" ? raw.created_at : null,
		url: typeof raw.html_url === "string" ? raw.html_url : null,
	};
}

function isStableNonBetaRelease(release) {
	if (release.draft || release.prerelease) return false;
	const haystack = `${release.tag} ${release.name}`.toLowerCase();
	return !haystack.includes("beta");
}

async function fetchReleasePage(page) {
	const url = `${API_BASE}?per_page=100&page=${page}`;
	const response = await fetch(url, {
		headers: {
			Accept: "application/vnd.github+json",
			"User-Agent": "oc-chatgpt-multi-auth-release-audit",
		},
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(
			`GitHub releases request failed (${response.status} ${response.statusText}) page=${page} body=${body.slice(0, 200)}`,
		);
	}

	const json = await response.json();
	if (!Array.isArray(json)) {
		throw new Error(`Unexpected GitHub releases payload on page ${page}`);
	}
	return json;
}

async function fetchAllReleases() {
	const all = [];
	for (let page = 1; page <= 20; page += 1) {
		const items = await fetchReleasePage(page);
		if (items.length === 0) break;
		all.push(...items);
		if (items.length < 100) break;
	}
	return all;
}

function buildMarkdownReport(report) {
	const stableVersions = report.stableNonBetaVersions.join(", ");
	const recentRows = report.stableNonBeta
		.slice(-15)
		.reverse()
		.map(
			(release) =>
				`| \`${release.version}\` | ${release.publishedAt?.slice(0, 10) ?? "-"} | ${release.tag} | ${release.url ?? "-"} |`,
		)
		.join("\n");

	return [
		"# Codex Release Parity Audit (Stable Non-Beta)",
		"",
		`Generated: ${report.generatedAt}`,
		"",
		"## Source",
		"",
		`- Repo: \`openai/codex\``,
		`- Releases page: ${REPO_URL}`,
		`- API endpoint: \`${API_BASE}\``,
		"",
		"## Summary",
		"",
		`- Total release objects fetched: **${report.counts.totalFetched}**`,
		`- Stable non-beta releases: **${report.counts.stableNonBeta}**`,
		`- First stable non-beta: **${report.range.firstStableNonBeta?.version ?? "-"}** (${report.range.firstStableNonBeta?.publishedAt?.slice(0, 10) ?? "-"})`,
		`- Latest stable non-beta: **${report.range.latestStableNonBeta?.version ?? "-"}** (${report.range.latestStableNonBeta?.publishedAt?.slice(0, 10) ?? "-"})`,
		"",
		"## Stable Non-Beta Version List",
		"",
		stableVersions,
		"",
		"## Recent Stable Non-Beta Releases (Newest First)",
		"",
		"| Version | Published | Tag | Link |",
		"|---|---|---|---|",
		recentRows || "| - | - | - | - |",
		"",
		"## Notes",
		"",
		"- This artifact is generated by `npm run audit:codex:releases`.",
		"- Filtering rule: `draft=false`, `prerelease=false`, and tag/name does not contain `beta`.",
		"",
	].join("\n");
}

function normalizeReleaseVersion(release) {
	const versionMatch = `${release.tag} ${release.name}`.match(/(\d+\.\d+\.\d+)/);
	return versionMatch?.[1] ?? release.tag;
}

export function extractSemanticItems(body) {
	if (!body || typeof body !== "string") return [];

	const items = [];
	for (const rawLine of body.split(/\r?\n/)) {
		let line = rawLine.trim();
		if (!line) continue;
		if (/^#{1,6}\s+/.test(line)) {
			continue;
		}
		if (/^[-*+]\s+/.test(line)) {
			line = line.replace(/^[-*+]\s+/, "").trim();
		} else if (/^\d+\.\s+/.test(line)) {
			line = line.replace(/^\d+\.\s+/, "").trim();
		} else {
			continue;
		}

		if (!line) continue;
		if (line.startsWith("<!--")) continue;
		items.push(line);
	}

	return items;
}

export function classifySemanticItem(text) {
	const matches = [];
	for (const bucket of SEMANTIC_BUCKETS) {
		if (bucket.patterns.some((pattern) => pattern.test(text))) {
			matches.push(bucket);
		}
	}
	if (matches.length === 0) {
		return {
			bucketId: UNKNOWN_BUCKET.id,
			bucketLabel: UNKNOWN_BUCKET.label,
			status: UNKNOWN_BUCKET.status,
			rationale: UNKNOWN_BUCKET.rationale,
			text,
		};
	}

	const primary = matches[0];
	return {
		bucketId: primary.id,
		bucketLabel: primary.label,
		status: primary.status,
		rationale: primary.rationale,
		text,
		matchedBucketIds: matches.map((bucket) => bucket.id),
	};
}

function buildSemanticParityReport(baseReport) {
	const releases = baseReport.stableNonBeta.map((release) => {
		const items = extractSemanticItems(release.body);
		const classifiedItems = items.map(classifySemanticItem);
		const bucketCounts = {};
		for (const item of classifiedItems) {
			bucketCounts[item.bucketId] = (bucketCounts[item.bucketId] ?? 0) + 1;
		}
		return {
			version: release.version,
			tag: release.tag,
			name: release.name,
			publishedAt: release.publishedAt,
			url: release.url,
			itemCount: classifiedItems.length,
			bucketCounts,
			items: classifiedItems,
		};
	});

	const bucketSummaries = new Map();
	for (const bucket of [...SEMANTIC_BUCKETS, { ...UNKNOWN_BUCKET, patterns: [] }]) {
		bucketSummaries.set(bucket.id, {
			bucketId: bucket.id,
			label: bucket.label,
			status: bucket.status,
			rationale: bucket.rationale,
			releaseCount: 0,
			itemCount: 0,
			examples: [],
		});
	}

	for (const release of releases) {
		const seenInRelease = new Set();
		for (const item of release.items) {
			const summary = bucketSummaries.get(item.bucketId);
			if (!summary) continue;
			summary.itemCount += 1;
			if (!seenInRelease.has(item.bucketId)) {
				summary.releaseCount += 1;
				seenInRelease.add(item.bucketId);
			}
			if (summary.examples.length < 5) {
				summary.examples.push({
					version: release.version,
					text: item.text,
				});
			}
		}
	}

	return {
		generatedAt: new Date().toISOString(),
		source: baseReport.source,
		filters: baseReport.filters,
		counts: {
			totalFetched: baseReport.counts.totalFetched,
			stableNonBeta: baseReport.counts.stableNonBeta,
			releasesWithSemanticItems: releases.filter((release) => release.itemCount > 0).length,
			totalSemanticItems: releases.reduce((sum, release) => sum + release.itemCount, 0),
		},
		range: baseReport.range,
		stableNonBetaVersions: baseReport.stableNonBetaVersions,
		parityStatusDefinitions: {
			implemented: "Plugin-side behavior already implemented",
			partial: "Partially implemented or opt-in / runtime-dependent",
			planned: "Identified but not yet implemented",
			"not-applicable": "Codex CLI/runtime feature outside plugin scope",
			"runtime-blocked": "Would require runtime tool surface support to implement fully",
		},
		bucketSummaries: Array.from(bucketSummaries.values()),
		releases,
	};
}

function buildSemanticMarkdownReport(report) {
	const bucketRows = report.bucketSummaries
		.filter((bucket) => bucket.itemCount > 0)
		.sort((a, b) => b.itemCount - a.itemCount)
		.map(
			(bucket) =>
				`| ${bucket.label} | \`${bucket.status}\` | ${bucket.releaseCount} | ${bucket.itemCount} | ${bucket.rationale} |`,
		)
		.join("\n");

	const recentRows = report.releases
		.filter((release) => release.itemCount > 0)
		.slice(-15)
		.reverse()
		.map((release) => {
			const topBuckets = Object.entries(release.bucketCounts)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 3)
				.map(([bucketId, count]) => `${bucketId}:${count}`)
				.join(", ");
			return `| \`${release.version}\` | ${release.publishedAt?.slice(0, 10) ?? "-"} | ${release.itemCount} | ${topBuckets || "-"} | ${release.url ?? "-"} |`;
		})
		.join("\n");

	const exampleSections = report.bucketSummaries
		.filter((bucket) => bucket.examples.length > 0)
		.sort((a, b) => b.itemCount - a.itemCount)
		.slice(0, 6)
		.map((bucket) => {
			const examples = bucket.examples
				.map((example) => `- \`${example.version}\`: ${example.text}`)
				.join("\n");
			return [`### ${bucket.label} (\`${bucket.status}\`)`, "", examples].join("\n");
		})
		.join("\n\n");

	return [
		"# Codex Release Parity Matrix (Semantic, Stable Non-Beta)",
		"",
		`Generated: ${report.generatedAt}`,
		"",
		"## Scope",
		"",
		"- Source: `openai/codex` release note bodies (stable non-beta only)",
		"- Goal: plugin-relevant semantic clustering and parity status for `oc-chatgpt-multi-auth`",
		"",
		"## Summary",
		"",
		`- Total release objects fetched: **${report.counts.totalFetched}**`,
		`- Stable non-beta releases: **${report.counts.stableNonBeta}**`,
		`- Releases with semantic note items: **${report.counts.releasesWithSemanticItems}**`,
		`- Total semantic note items classified: **${report.counts.totalSemanticItems}**`,
		"",
		"## Bucket Parity Summary",
		"",
		"| Bucket | Status | Releases | Items | Rationale |",
		"|---|---|---:|---:|---|",
		bucketRows || "| - | - | - | - | - |",
		"",
		"## Recent Semantic Releases (Newest First)",
		"",
		"| Version | Published | Items | Top Buckets | Link |",
		"|---|---|---:|---|---|",
		recentRows || "| - | - | - | - | - |",
		"",
		"## Example Classified Items",
		"",
		exampleSections || "_No semantic items found in stable non-beta release bodies._",
		"",
		"## Notes",
		"",
		"- This artifact is generated by `npm run audit:codex:parity`.",
		"- Classification is heuristic and plugin-focused; review `other` bucket items manually.",
		"- `runtime-blocked` is reserved for features requiring runtime tool support (e.g., true hashline engine exposure).",
		"",
	].join("\n");
}

function buildBaseReport(stableNonBetaWithVersion, normalized) {
	return {
		generatedAt: new Date().toISOString(),
		source: {
			repository: "openai/codex",
			releasesPageUrl: REPO_URL,
			apiBaseUrl: API_BASE,
		},
		filters: {
			excludeDraft: true,
			excludePrerelease: true,
			excludeBetaTagOrName: true,
			description:
				"Stable non-beta releases only (draft=false, prerelease=false, no 'beta' in tag/name)",
		},
		counts: {
			totalFetched: normalized.length,
			stableNonBeta: stableNonBetaWithVersion.length,
		},
		range: {
			firstStableNonBeta: stableNonBetaWithVersion[0] ?? null,
			latestStableNonBeta:
				stableNonBetaWithVersion[stableNonBetaWithVersion.length - 1] ?? null,
		},
		stableNonBetaVersions: stableNonBetaWithVersion.map((release) => release.version),
		stableNonBeta: stableNonBetaWithVersion,
	};
}

async function main() {
	const semanticMode = process.argv.includes("--semantic");
	const rawReleases = await fetchAllReleases();
	const normalized = rawReleases.map(normalizeRelease);
	const stableNonBeta = normalized.filter(isStableNonBetaRelease);

	const stableNonBetaWithVersion = stableNonBeta
		.map((release) => ({
			...release,
			version: normalizeReleaseVersion(release),
		}))
		.sort(compareVersionsAscending);

	const baseReport = buildBaseReport(stableNonBetaWithVersion, normalized);

	mkdirSync(OUTPUT_DIR, { recursive: true });
	writeFileSync(JSON_OUTPUT_PATH, `${JSON.stringify(baseReport, null, "\t")}\n`, "utf8");
	writeFileSync(MD_OUTPUT_PATH, `${buildMarkdownReport(baseReport)}\n`, "utf8");

	if (semanticMode) {
		const semanticReport = buildSemanticParityReport(baseReport);
		writeFileSync(
			MATRIX_JSON_OUTPUT_PATH,
			`${JSON.stringify(semanticReport, null, "\t")}\n`,
			"utf8",
		);
		writeFileSync(
			MATRIX_MD_OUTPUT_PATH,
			`${buildSemanticMarkdownReport(semanticReport)}\n`,
			"utf8",
		);
		console.log(
			`Wrote semantic parity matrix for ${semanticReport.counts.stableNonBeta} stable non-beta releases to ${MATRIX_JSON_OUTPUT_PATH} and ${MATRIX_MD_OUTPUT_PATH}`,
		);
		return;
	}

	console.log(
		`Wrote ${baseReport.counts.stableNonBeta} stable non-beta releases to ${JSON_OUTPUT_PATH} and ${MD_OUTPUT_PATH}`,
	);
}

const isDirectExecution =
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
