const HASHLINE_RUNTIME_SIGNAL_PATTERN =
	/(hashline|line[_-]?hash|anchor[_-]?insert|hash[-_ ]?verified|hespa)/i;
const HASHLINE_SCHEMA_SIGNAL_PATTERN =
	/(hashline|line[_-]?hash|expected[_-]?hash|anchor|insert[_-]?mode)/i;

type EditStrategy =
	| "hashline-like"
	| "edit"
	| "patch"
	| "apply_patch"
	| "replace"
	| "none";

export interface RuntimeToolCapabilities {
	hasHashlineToolName: boolean;
	hasHashlineSignals: boolean;
	hasHashlineCapabilities: boolean;
	hasGenericEdit: boolean;
	hasPatch: boolean;
	hasApplyPatch: boolean;
	hasReplace: boolean;
	hasTaskDelegation: boolean;
	supportsBackgroundDelegation: boolean;
	hasUpdatePlan: boolean;
	hasTodoWrite: boolean;
	primaryEditStrategy: EditStrategy;
}

export interface RuntimeToolManifestSnapshot {
	names: string[];
	requiredParametersByTool: Record<string, string[]>;
	capabilities: RuntimeToolCapabilities;
}

const EMPTY_CAPABILITIES: RuntimeToolCapabilities = {
	hasHashlineToolName: false,
	hasHashlineSignals: false,
	hasHashlineCapabilities: false,
	hasGenericEdit: false,
	hasPatch: false,
	hasApplyPatch: false,
	hasReplace: false,
	hasTaskDelegation: false,
	supportsBackgroundDelegation: false,
	hasUpdatePlan: false,
	hasTodoWrite: false,
	primaryEditStrategy: "none",
};

function hasHashlineSchemaSignal(parameters: unknown): boolean {
	if (!parameters || typeof parameters !== "object") return false;
	try {
		return HASHLINE_SCHEMA_SIGNAL_PATTERN.test(JSON.stringify(parameters));
	} catch {
		return false;
	}
}

function extractRequiredParameterNames(parameters: unknown): string[] {
	if (!parameters || typeof parameters !== "object") return [];
	const schema = parameters as {
		type?: unknown;
		required?: unknown;
		properties?: unknown;
	};
	const required = Array.isArray(schema.required)
		? schema.required
				.filter(
					(value): value is string =>
						typeof value === "string" && value.trim().length > 0,
				)
				.map((value) => value.trim())
		: [];
	if (required.length > 0) {
		return Array.from(new Set(required));
	}

	if (
		schema.type !== "object" ||
		!schema.properties ||
		typeof schema.properties !== "object"
	) {
		return [];
	}

	const inferredRequired = Object.entries(schema.properties as Record<string, unknown>)
		.filter(([, property]) => {
			if (!property || typeof property !== "object") return false;
			return (property as { required?: unknown }).required === true;
		})
		.map(([name]) => name.trim())
		.filter(Boolean);
	return Array.from(new Set(inferredRequired));
}

function normalizeToolName(name: string): string {
	return name.trim();
}

function isName(name: string, ...variants: string[]): boolean {
	const lower = name.toLowerCase();
	return variants.some((variant) => lower === variant);
}

function isTaskDelegationToolName(name: string): boolean {
	const lower = name.toLowerCase();
	return (
		lower === "delegate_task" ||
		lower === "delegatetask" ||
		lower === "run_task" ||
		lower === "task" ||
		lower === "spawn_agent"
	);
}

function mergeCapabilityFlags(
	capabilities: RuntimeToolCapabilities,
	name: string,
	description: unknown,
	parameters: unknown,
): void {
	const normalizedName = name.toLowerCase();
	const required = extractRequiredParameterNames(parameters);

	if (HASHLINE_RUNTIME_SIGNAL_PATTERN.test(name)) {
		capabilities.hasHashlineToolName = true;
	}
	if (
		typeof description === "string" &&
		HASHLINE_RUNTIME_SIGNAL_PATTERN.test(description)
	) {
		capabilities.hasHashlineSignals = true;
	}
	if (hasHashlineSchemaSignal(parameters)) {
		capabilities.hasHashlineSignals = true;
	}

	if (isName(normalizedName, "edit")) capabilities.hasGenericEdit = true;
	if (isName(normalizedName, "patch")) capabilities.hasPatch = true;
	if (isName(normalizedName, "replace")) capabilities.hasReplace = true;
	if (isName(normalizedName, "apply_patch", "applypatch")) {
		capabilities.hasApplyPatch = true;
	}
	if (isName(normalizedName, "update_plan", "updateplan")) {
		capabilities.hasUpdatePlan = true;
	}
	if (isName(normalizedName, "todowrite")) {
		capabilities.hasTodoWrite = true;
	}

	if (isTaskDelegationToolName(normalizedName)) {
		capabilities.hasTaskDelegation = true;
		if (
			required.some(
				(param) =>
					param === "run_in_background" || param === "runInBackground",
			)
		) {
			capabilities.supportsBackgroundDelegation = true;
		}
	}
}

function computePrimaryEditStrategy(
	capabilities: RuntimeToolCapabilities,
): RuntimeToolCapabilities["primaryEditStrategy"] {
	if (capabilities.hasHashlineCapabilities) return "hashline-like";
	if (capabilities.hasGenericEdit) return "edit";
	if (capabilities.hasPatch) return "patch";
	if (capabilities.hasApplyPatch) return "apply_patch";
	if (capabilities.hasReplace) return "replace";
	return "none";
}

function mergeToolDefinition(
	names: string[],
	requiredParametersByTool: Record<string, string[]>,
	capabilities: RuntimeToolCapabilities,
	name: unknown,
	description: unknown,
	parameters: unknown,
): void {
	if (typeof name !== "string" || !name.trim()) return;
	const normalizedName = normalizeToolName(name);
	names.push(normalizedName);
	mergeCapabilityFlags(capabilities, normalizedName, description, parameters);

	const required = extractRequiredParameterNames(parameters);
	if (required.length === 0) return;
	const existing = requiredParametersByTool[normalizedName] ?? [];
	requiredParametersByTool[normalizedName] = Array.from(new Set([...existing, ...required]));
}

export function analyzeRuntimeToolCapabilities(
	tools: unknown,
): RuntimeToolManifestSnapshot {
	if (!Array.isArray(tools)) {
		return {
			names: [],
			requiredParametersByTool: {},
			capabilities: { ...EMPTY_CAPABILITIES },
		};
	}

	const names: string[] = [];
	const requiredParametersByTool: Record<string, string[]> = {};
	const capabilities: RuntimeToolCapabilities = { ...EMPTY_CAPABILITIES };

	for (const tool of tools) {
		if (!tool || typeof tool !== "object") continue;

		const directName = (tool as { name?: unknown }).name;
		const directDescription = (tool as { description?: unknown }).description;
		const directParameters = (tool as { parameters?: unknown }).parameters;
		mergeToolDefinition(
			names,
			requiredParametersByTool,
			capabilities,
			directName,
			directDescription,
			directParameters,
		);

		if (
			typeof directName === "string" &&
			directName.trim() &&
			directDescription !== undefined
		) {
			continue;
		}

		const functionDef = (tool as { function?: unknown }).function;
		if (!functionDef || typeof functionDef !== "object") continue;
		const functionName = (functionDef as { name?: unknown }).name;
		const functionDescription = (functionDef as { description?: unknown }).description;
		const functionParameters = (functionDef as { parameters?: unknown }).parameters;
		mergeToolDefinition(
			names,
			requiredParametersByTool,
			capabilities,
			functionName,
			functionDescription,
			functionParameters,
		);
	}

	capabilities.hasHashlineCapabilities =
		capabilities.hasHashlineToolName || capabilities.hasHashlineSignals;
	capabilities.primaryEditStrategy = computePrimaryEditStrategy(capabilities);

	return {
		names: Array.from(new Set(names)),
		requiredParametersByTool,
		capabilities,
	};
}
