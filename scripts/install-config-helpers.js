export const INSTALL_PLUGIN_NAME = "oc-chatgpt-multi-auth";

function isPlainObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
	if (value === null || value === undefined) return value;
	if (typeof structuredClone === "function") {
		return structuredClone(value);
	}
	return JSON.parse(JSON.stringify(value));
}

function deepMerge(base, override) {
	if (Array.isArray(base) && Array.isArray(override)) {
		return override.slice();
	}
	if (base && typeof base === "object" && override && typeof override === "object") {
		const output = { ...base };
		for (const [key, value] of Object.entries(override)) {
			const baseValue = output[key];
			if (baseValue && typeof baseValue === "object" && !Array.isArray(baseValue) && value && typeof value === "object" && !Array.isArray(value)) {
				output[key] = deepMerge(baseValue, value);
			} else {
				output[key] = clone(value);
			}
		}
		return output;
	}
	if (override !== undefined) {
		return clone(override);
	}
	return clone(base);
}

export function normalizePluginList(list, pluginName = INSTALL_PLUGIN_NAME) {
	const entries = Array.isArray(list)
		? list
			.filter((entry) => typeof entry === "string")
			.map((entry) => entry.trim())
			.filter(Boolean)
		: [];
	const filtered = entries.filter((entry) => {
		return entry !== pluginName && !entry.startsWith(`${pluginName}@`);
	});
	return [...filtered, pluginName];
}

export function createMergedConfig(template, existing, pluginName = INSTALL_PLUGIN_NAME) {
	const templateClone = isPlainObject(template) ? clone(template) : {};
	if (!isPlainObject(existing)) {
		return templateClone;
	}
	const merged = deepMerge(templateClone, existing);
	merged.plugin = normalizePluginList(existing.plugin ?? merged.plugin ?? [], pluginName);
	return merged;
}
