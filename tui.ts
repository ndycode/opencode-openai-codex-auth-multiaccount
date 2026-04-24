import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import type { Event } from "@opencode-ai/sdk/v2";
import type { JSX } from "@opentui/solid";

import {
	createUsageAccountFingerprint,
	ensureCodexUsageAccessToken,
	fetchCodexUsage,
	formatUsageWindowLabel,
	getUsageLeftPercent,
	hasUsageWindow,
	parseCodexUsagePayload,
	resolveCodexUsageAccountId,
	resolveCodexUsageActiveAccount,
} from "./lib/codex-usage.js";
import {
	formatPromptStatusText,
	type CompactQuotaLimit,
	type CompactQuotaStatus,
} from "./lib/tui-status.js";
import { loadAccounts } from "./lib/storage.js";

const CACHE_KEY = "oc-codex-multi-auth:tui-status:v2";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const EVENT_REFRESH_DEBOUNCE_MS = 750;

type StoredQuotaStatus = {
	fingerprint: string;
	fetchedAt: number;
	limits: CompactQuotaLimit[];
};

type SolidRuntime = Pick<
	typeof import("@opentui/solid"),
	"createElement" | "spread"
> &
	Pick<typeof import("solid-js"), "createSignal" | "onCleanup">;

let inFlightRefresh: Promise<CompactQuotaStatus> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNullablePercent(value: unknown): value is number | null {
	return (
		value === null ||
		(typeof value === "number" &&
			Number.isFinite(value) &&
			value >= 0 &&
			value <= 100)
	);
}

function isStoredQuotaLimit(value: unknown): value is CompactQuotaLimit {
	return (
		isRecord(value) &&
		typeof value.label === "string" &&
		value.label.trim().length > 0 &&
		isNullablePercent(value.leftPercent)
	);
}

function isStoredQuotaStatus(value: unknown): value is StoredQuotaStatus {
	return (
		isRecord(value) &&
		typeof value.fingerprint === "string" &&
		typeof value.fetchedAt === "number" &&
		Number.isFinite(value.fetchedAt) &&
		Array.isArray(value.limits) &&
		value.limits.every(isStoredQuotaLimit)
	);
}

function readStoredQuotaStatus(
	api: TuiPluginApi,
	fingerprint: string,
): StoredQuotaStatus | undefined {
	if (!api.kv.ready) return undefined;
	try {
		const cached = api.kv.get<unknown>(CACHE_KEY);
		return isStoredQuotaStatus(cached) && cached.fingerprint === fingerprint
			? cached
			: undefined;
	} catch {
		return undefined;
	}
}

function writeStoredQuotaStatus(
	api: TuiPluginApi,
	status: StoredQuotaStatus,
): void {
	if (!api.kv.ready) return;
	try {
		api.kv.set(CACHE_KEY, status);
	} catch {
		// The prompt status is best-effort; cache write failures should not
		// affect the OpenCode TUI.
	}
}

function toCompactQuotaStatus(
	stored: StoredQuotaStatus,
	stale: boolean,
): CompactQuotaStatus {
	return {
		type: "ready",
		limits: stored.limits,
		stale,
	};
}

function toCompactQuotaLimit(
	window: { usedPercent?: number; windowMinutes?: number },
): CompactQuotaLimit | undefined {
	if (!hasUsageWindow(window)) return undefined;
	return {
		label: formatUsageWindowLabel(window.windowMinutes),
		leftPercent: getUsageLeftPercent(window.usedPercent) ?? null,
	};
}

async function refreshQuotaStatusInner(
	api: TuiPluginApi,
): Promise<CompactQuotaStatus> {
	try {
		const storage = await loadAccounts();
		if (!storage || storage.accounts.length === 0) {
			return { type: "missing" };
		}

		const selection = resolveCodexUsageActiveAccount(storage);
		if (!selection) return { type: "missing" };
		const fingerprint = createUsageAccountFingerprint(selection.account);
		const cached = readStoredQuotaStatus(api, fingerprint);
		const now = Date.now();

		try {
			const credentials = await ensureCodexUsageAccessToken({
				storage,
				account: selection.account,
			});
			const accountId = resolveCodexUsageAccountId({
				account: selection.account,
				accessToken: credentials.accessToken,
			});
			if (!accountId) throw new Error("Missing account id");

			const payload = await fetchCodexUsage({
				accountId,
				accessToken: credentials.accessToken,
				organizationId: selection.account.organizationId,
			});
			const usage = parseCodexUsagePayload(payload);
			const limits = [
				toCompactQuotaLimit(usage.primary),
				toCompactQuotaLimit(usage.secondary),
			].filter((limit): limit is CompactQuotaLimit => Boolean(limit));
			const stored: StoredQuotaStatus = {
				fingerprint,
				fetchedAt: now,
				limits,
			};
			writeStoredQuotaStatus(api, stored);
			return toCompactQuotaStatus(stored, false);
		} catch {
			return cached ? toCompactQuotaStatus(cached, true) : { type: "unavailable" };
		}
	} catch {
		return { type: "unavailable" };
	}
}

function refreshQuotaStatus(api: TuiPluginApi): Promise<CompactQuotaStatus> {
	if (inFlightRefresh) return inFlightRefresh;
	inFlightRefresh = refreshQuotaStatusInner(api).finally(() => {
		inFlightRefresh = undefined;
	});
	return inFlightRefresh;
}

export function shouldRefreshQuotaForEvent(event: Event): boolean {
	switch (event.type) {
		case "message.updated":
			return (
				event.properties.info.role === "assistant" &&
				typeof event.properties.info.time.completed === "number"
			);
		case "message.part.updated": {
			const { part } = event.properties;
			if (part.type === "step-finish") return true;
			if (part.type !== "tool") return false;
			return (
				part.state.status === "completed" || part.state.status === "error"
			);
		}
		case "session.idle":
		case "session.error":
			return true;
		case "session.status":
			return event.properties.status.type === "idle";
		default:
			return false;
	}
}

function createPromptStatus(
	api: TuiPluginApi,
	solid: SolidRuntime,
): JSX.Element {
	const [quota, setQuota] = solid.createSignal<CompactQuotaStatus>({
		type: "loading",
	});
	const refresh = (): void => {
		void refreshQuotaStatus(api).then(setQuota, () => {
			setQuota({ type: "unavailable" });
		});
	};
	let refreshTimeout: ReturnType<typeof setTimeout> | undefined;
	const scheduleRefresh = (): void => {
		if (refreshTimeout) clearTimeout(refreshTimeout);
		refreshTimeout = setTimeout(() => {
			refreshTimeout = undefined;
			refresh();
		}, EVENT_REFRESH_DEBOUNCE_MS);
	};

	refresh();
	const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
	const disposeMessageUpdated = api.event.on("message.updated", (event) => {
		if (shouldRefreshQuotaForEvent(event)) scheduleRefresh();
	});
	const disposeMessagePartUpdated = api.event.on(
		"message.part.updated",
		(event) => {
			if (shouldRefreshQuotaForEvent(event)) scheduleRefresh();
		},
	);
	const disposeSessionIdle = api.event.on("session.idle", (event) => {
		if (shouldRefreshQuotaForEvent(event)) scheduleRefresh();
	});
	const disposeSessionStatus = api.event.on("session.status", (event) => {
		if (shouldRefreshQuotaForEvent(event)) scheduleRefresh();
	});
	const disposeSessionError = api.event.on("session.error", (event) => {
		if (shouldRefreshQuotaForEvent(event)) scheduleRefresh();
	});
	solid.onCleanup(() => {
		clearInterval(interval);
		if (refreshTimeout) clearTimeout(refreshTimeout);
		disposeMessageUpdated();
		disposeMessagePartUpdated();
		disposeSessionIdle();
		disposeSessionStatus();
		disposeSessionError();
	});

	const node = solid.createElement("text");
	solid.spread(
		node,
		{
			get content() {
				return formatPromptStatusText({
					quota: quota(),
					width: api.renderer.width,
				});
			},
			get fg() {
				const current = quota();
				return current.type === "ready"
					? api.theme.current.textMuted
					: api.theme.current.warning;
			},
			selectable: false,
			truncate: true,
			wrapMode: "none",
		},
		false,
	);
	return node;
}

const module: TuiPluginModule = {
	id: "oc-codex-multi-auth.status",
	async tui(api) {
		const [{ createElement, spread }, { createSignal, onCleanup }] =
			await Promise.all([import("@opentui/solid"), import("solid-js")]);
		const solid: SolidRuntime = {
			createElement,
			spread,
			createSignal,
			onCleanup,
		};

		api.slots.register({
			slots: {
				home_prompt_right: () => createPromptStatus(api, solid),
				session_prompt_right: () => createPromptStatus(api, solid),
			},
		});
	},
};

export default module;
