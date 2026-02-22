import { logDebug, logWarn } from "../logger.js";
import { getNormalizedModel } from "./helpers/model-map.js";
import type { ModelCapabilitySyncMode, ReasoningConfig } from "../types.js";

const MODEL_CAPABILITIES_URL =
	"https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/models.json";
const DEFAULT_CACHE_TTL_MS = 600_000;

type ReasoningEffort = ReasoningConfig["effort"];
type CapabilitySource = "static" | "dynamic" | "dynamic_stale";

export interface ModelCapabilityRecord {
	model: string;
	supportedReasoningEfforts: ReasoningEffort[];
	defaultReasoningEffort?: ReasoningEffort;
	source: CapabilitySource;
	updatedAt: number;
}

export interface ModelCapabilitySyncOptions {
	mode?: ModelCapabilitySyncMode;
	cacheTtlMs?: number;
}

interface RawModelCapabilityEntry {
	slug?: unknown;
	display_name?: unknown;
	default_reasoning_level?: unknown;
	supported_reasoning_levels?: unknown;
}

interface DynamicCapabilityEntry {
	model: string;
	supportedReasoningEfforts: ReasoningEffort[];
	defaultReasoningEffort?: ReasoningEffort;
}

interface CapabilityCacheState {
	fetchedAt: number;
	entries: Map<string, DynamicCapabilityEntry>;
}

const EMPTY_CACHE: CapabilityCacheState = {
	fetchedAt: 0,
	entries: new Map<string, DynamicCapabilityEntry>(),
};

let capabilityCache: CapabilityCacheState = EMPTY_CACHE;
let refreshInFlight: Promise<void> | null = null;
let lastRefreshWarningAt = 0;

function isReasoningEffort(value: unknown): value is ReasoningEffort {
	return (
		value === "none" ||
		value === "minimal" ||
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh"
	);
}

function normalizeModelKey(modelName: string | undefined): string {
	const raw = (modelName ?? "").trim();
	if (!raw) return "";
	const withoutProvider = raw.includes("/") ? (raw.split("/").pop() ?? raw) : raw;
	const normalizedMapped = getNormalizedModel(withoutProvider);
	return (normalizedMapped ?? withoutProvider).trim().toLowerCase();
}

function getStaticFallbackCapability(modelName: string | undefined): ModelCapabilityRecord {
	const normalizedName = normalizeModelKey(modelName);
	const now = Date.now();
	if (!normalizedName) {
		return {
			model: "unknown",
			supportedReasoningEfforts: ["minimal", "low", "medium", "high"],
			defaultReasoningEffort: "medium",
			source: "static",
			updatedAt: now,
		};
	}

	const isGpt5Codex =
		normalizedName.includes("gpt-5-codex") && !normalizedName.includes("gpt-5.1-codex");
	const isGpt53Codex = normalizedName.includes("gpt-5.3-codex");
	const isGpt52Codex = normalizedName.includes("gpt-5.2-codex");
	const isGpt52General =
		normalizedName === "gpt-5.2" ||
		(normalizedName.startsWith("gpt-5.2") && !isGpt52Codex);
	const isCodexMax = normalizedName.includes("codex-max");
	const isCodexMini =
		normalizedName.includes("codex-mini") || normalizedName.includes("codex_mini");
	const isCodex = normalizedName.includes("codex") && !isCodexMini;
	const isLightweight =
		!isCodexMini &&
		(normalizedName.includes("nano") || normalizedName.endsWith("-mini") || normalizedName === "gpt-5-mini");
	const isGpt51General =
		(
			normalizedName === "gpt-5.1" ||
			normalizedName === "gpt-5" ||
			normalizedName.startsWith("gpt-5.1-") ||
			normalizedName.startsWith("gpt-5-")
		) &&
		!isCodex &&
		!isGpt52General &&
		!isCodexMax &&
		!isCodexMini;

	let supported: ReasoningEffort[];
	if (isCodexMini) {
		supported = ["medium", "high"];
	} else if (isGpt52General || isCodexMax || isGpt53Codex || isGpt52Codex) {
		supported = ["none", "low", "medium", "high", "xhigh"];
		if (isGpt53Codex || isGpt52Codex) {
			supported = ["low", "medium", "high", "xhigh"];
		}
	} else if (isGpt51General) {
		supported = ["none", "low", "medium", "high"];
	} else if (isCodex || isGpt5Codex) {
		supported = ["low", "medium", "high"];
	} else if (isLightweight) {
		supported = ["minimal", "low", "medium", "high"];
	} else {
		supported = ["minimal", "low", "medium", "high"];
	}

	const defaultReasoningEffort: ReasoningEffort = isCodexMini
		? "medium"
		: isGpt5Codex
			? "high"
			: isGpt53Codex || isGpt52Codex
				? "xhigh"
				: isGpt52General || isCodexMax
					? "high"
					: isLightweight
						? "minimal"
						: "medium";

	return {
		model: normalizedName,
		supportedReasoningEfforts: supported,
		defaultReasoningEffort,
		source: "static",
		updatedAt: now,
	};
}

function parseDynamicCapabilityEntry(entry: unknown): DynamicCapabilityEntry | null {
	if (!entry || typeof entry !== "object") return null;
	const raw = entry as RawModelCapabilityEntry;
	const slug =
		typeof raw.slug === "string" && raw.slug.trim()
			? raw.slug.trim()
			: typeof raw.display_name === "string" && raw.display_name.trim()
				? raw.display_name.trim()
				: "";
	if (!slug) return null;

	let supportedReasoningEfforts: ReasoningEffort[] = [];
	if (Array.isArray(raw.supported_reasoning_levels)) {
		supportedReasoningEfforts = raw.supported_reasoning_levels
			.map((level) => {
				if (!level || typeof level !== "object") return undefined;
				const effort = (level as { effort?: unknown }).effort;
				return isReasoningEffort(effort) ? effort : undefined;
			})
			.filter((effort): effort is ReasoningEffort => !!effort);
	}

	const defaultReasoningEffort = isReasoningEffort(raw.default_reasoning_level)
		? raw.default_reasoning_level
		: undefined;

	if (supportedReasoningEfforts.length === 0 && defaultReasoningEffort) {
		supportedReasoningEfforts = [defaultReasoningEffort];
	}
	if (supportedReasoningEfforts.length === 0) return null;

	return {
		model: normalizeModelKey(slug),
		supportedReasoningEfforts: Array.from(new Set(supportedReasoningEfforts)),
		defaultReasoningEffort,
	};
}

function shouldSkipNetworkRefresh(): boolean {
	return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

async function fetchAndParseCapabilities(): Promise<Map<string, DynamicCapabilityEntry>> {
	const response = await fetch(MODEL_CAPABILITIES_URL, {
		headers: { accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ${response.statusText}`);
	}
	const payload = (await response.json()) as { models?: unknown };
	if (!payload || !Array.isArray(payload.models)) {
		throw new Error("Invalid models.json payload");
	}
	const entries = new Map<string, DynamicCapabilityEntry>();
	for (const rawEntry of payload.models) {
		const parsed = parseDynamicCapabilityEntry(rawEntry);
		if (!parsed?.model) continue;
		entries.set(parsed.model, parsed);
	}
	return entries;
}

async function refreshCapabilityCache(): Promise<void> {
	const entries = await fetchAndParseCapabilities();
	capabilityCache = {
		fetchedAt: Date.now(),
		entries,
	};
	logDebug("Refreshed Codex model capabilities cache", {
		modelCount: entries.size,
		source: MODEL_CAPABILITIES_URL,
	});
}

export async function prepareModelCapabilitiesFor(
	modelName: string | undefined,
	options: ModelCapabilitySyncOptions = {},
): Promise<void> {
	const mode = options.mode ?? "off";
	if (mode === "off") return;
	if (shouldSkipNetworkRefresh()) return;

	const cacheTtlMs = Math.max(1_000, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
	const now = Date.now();
	const normalizedModel = normalizeModelKey(modelName);
	const hasEntry = normalizedModel ? capabilityCache.entries.has(normalizedModel) : false;
	const cacheFresh = capabilityCache.fetchedAt > 0 && now - capabilityCache.fetchedAt < cacheTtlMs;
	if (cacheFresh && (hasEntry || capabilityCache.entries.size > 0)) {
		return;
	}

	if (!refreshInFlight) {
		refreshInFlight = refreshCapabilityCache()
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				if (now - lastRefreshWarningAt > 60_000) {
					lastRefreshWarningAt = now;
					logWarn(`Failed to refresh Codex model capabilities cache: ${message}`);
				}
			})
			.finally(() => {
				refreshInFlight = null;
			});
	}

	await refreshInFlight;
}

function getDynamicCapability(modelName: string | undefined): ModelCapabilityRecord | null {
	const normalizedModel = normalizeModelKey(modelName);
	if (!normalizedModel) return null;
	const dynamic = capabilityCache.entries.get(normalizedModel);
	if (!dynamic) return null;
	const ageMs = Date.now() - capabilityCache.fetchedAt;
	return {
		model: dynamic.model,
		supportedReasoningEfforts: [...dynamic.supportedReasoningEfforts],
		defaultReasoningEffort: dynamic.defaultReasoningEffort,
		source: ageMs > DEFAULT_CACHE_TTL_MS ? "dynamic_stale" : "dynamic",
		updatedAt: capabilityCache.fetchedAt,
	};
}

export function getModelCapabilityRecord(
	modelName: string | undefined,
	options: ModelCapabilitySyncOptions = {},
): ModelCapabilityRecord {
	if ((options.mode ?? "off") === "off") {
		return getStaticFallbackCapability(modelName);
	}
	return getDynamicCapability(modelName) ?? getStaticFallbackCapability(modelName);
}

function findClampedEffort(
	requested: ReasoningEffort,
	supported: readonly ReasoningEffort[],
	defaultEffort?: ReasoningEffort,
): ReasoningEffort {
	if (supported.includes(requested)) return requested;

	const preferredByRequested: Record<ReasoningEffort, ReasoningEffort[]> = {
		none: ["low", "minimal", "medium", "high", "xhigh"],
		minimal: ["low", "medium", "high", "none", "xhigh"],
		low: ["minimal", "medium", "high", "none", "xhigh"],
		medium: ["high", "low", "minimal", "xhigh", "none"],
		high: ["medium", "low", "xhigh", "minimal", "none"],
		xhigh: ["high", "medium", "low", "minimal", "none"],
	};

	for (const candidate of preferredByRequested[requested]) {
		if (supported.includes(candidate)) return candidate;
	}
	if (defaultEffort && supported.includes(defaultEffort)) {
		return defaultEffort;
	}
	return supported[0] ?? requested;
}

export interface ReasoningEffortClampResult {
	effort: ReasoningEffort;
	changed: boolean;
	capability: ModelCapabilityRecord;
}

export function clampReasoningEffortForModel(
	modelName: string | undefined,
	effort: ReasoningEffort,
	options: ModelCapabilitySyncOptions = {},
): ReasoningEffortClampResult {
	const capability = getModelCapabilityRecord(modelName, options);
	const nextEffort = findClampedEffort(
		effort,
		capability.supportedReasoningEfforts,
		capability.defaultReasoningEffort,
	);
	return {
		effort: nextEffort,
		changed: nextEffort !== effort,
		capability,
	};
}

export function __resetModelCapabilitiesCacheForTests(): void {
	capabilityCache = {
		fetchedAt: 0,
		entries: new Map<string, DynamicCapabilityEntry>(),
	};
	refreshInFlight = null;
	lastRefreshWarningAt = 0;
}

export function __setModelCapabilitiesCacheForTests(records: ModelCapabilityRecord[]): void {
	const entries = new Map<string, DynamicCapabilityEntry>();
	for (const record of records) {
		const key = normalizeModelKey(record.model);
		if (!key) continue;
		entries.set(key, {
			model: key,
			supportedReasoningEfforts: [...record.supportedReasoningEfforts],
			defaultReasoningEffort: record.defaultReasoningEffort,
		});
	}
	capabilityCache = {
		fetchedAt: Date.now(),
		entries,
	};
}
