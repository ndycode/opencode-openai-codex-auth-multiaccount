import type { Message } from "@opencode-ai/sdk/v2";
import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import type { JSX } from "@opentui/solid";

import {
	createUsageAccountFingerprint,
	ensureCodexUsageAccessToken,
	fetchCodexUsage,
	getUsageLeftPercent,
	parseCodexUsagePayload,
	resolveCodexUsageAccountId,
	resolveCodexUsageActiveAccount,
} from "./lib/codex-usage.js";
import {
	formatPromptStatusText,
	resolvePromptReasoningVariant,
	type CompactQuotaStatus,
	type PromptStatusMessage,
} from "./lib/tui-status.js";
import { loadAccounts } from "./lib/storage.js";

const CACHE_KEY = "oc-codex-multi-auth:tui-status:v1";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const MIN_FETCH_INTERVAL_MS = 2 * 60 * 1000;

type StoredQuotaStatus = {
	fingerprint: string;
	fetchedAt: number;
	primaryLeftPercent: number | null;
	secondaryLeftPercent: number | null;
};

type StatusSlotInput = {
	sessionID?: string;
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

function isStoredQuotaStatus(value: unknown): value is StoredQuotaStatus {
	return (
		isRecord(value) &&
		typeof value.fingerprint === "string" &&
		typeof value.fetchedAt === "number" &&
		Number.isFinite(value.fetchedAt) &&
		isNullablePercent(value.primaryLeftPercent) &&
		isNullablePercent(value.secondaryLeftPercent)
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
		primaryLeftPercent: stored.primaryLeftPercent,
		secondaryLeftPercent: stored.secondaryLeftPercent,
		stale,
	};
}

function toPromptStatusMessage(message: Message): PromptStatusMessage {
	if (message.role === "user") {
		return {
			role: "user",
			userModel: {
				modelID: message.model.modelID,
				variant: message.model.variant,
			},
		};
	}
	return {
		role: "assistant",
		modelID: message.modelID,
		variant: message.variant,
	};
}

function resolveStatusMessages(
	api: TuiPluginApi,
	input: StatusSlotInput,
): PromptStatusMessage[] {
	if (!input.sessionID) return [];
	try {
		return api.state.session.messages(input.sessionID).map(toPromptStatusMessage);
	} catch {
		return [];
	}
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
		if (cached && now - cached.fetchedAt < MIN_FETCH_INTERVAL_MS) {
			return toCompactQuotaStatus(cached, false);
		}

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
			const stored: StoredQuotaStatus = {
				fingerprint,
				fetchedAt: now,
				primaryLeftPercent: getUsageLeftPercent(usage.primary.usedPercent) ?? null,
				secondaryLeftPercent:
					getUsageLeftPercent(usage.secondary.usedPercent) ?? null,
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

function createPromptStatus(
	api: TuiPluginApi,
	input: StatusSlotInput,
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

	refresh();
	const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
	solid.onCleanup(() => clearInterval(interval));

	const node = solid.createElement("text");
	solid.spread(
		node,
		{
			get content() {
				return formatPromptStatusText({
					variant: resolvePromptReasoningVariant({
						messages: resolveStatusMessages(api, input),
						config: api.state.config,
					}),
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
				home_prompt_right: () => createPromptStatus(api, {}, solid),
				session_prompt_right: (_ctx, props) =>
					createPromptStatus(api, { sessionID: props.session_id }, solid),
			},
		});
	},
};

export default module;
