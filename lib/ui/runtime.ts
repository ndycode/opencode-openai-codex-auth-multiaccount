import {
	createUiTheme,
	shouldUseColor,
	type UiColorProfile,
	type UiGlyphMode,
	type UiTheme,
} from "./theme.js";

export interface UiRuntimeOptions {
	v2Enabled: boolean;
	colorProfile: UiColorProfile;
	glyphMode: UiGlyphMode;
	theme: UiTheme;
	/**
	 * Effective ANSI-color enablement after resolving `NO_COLOR` /
	 * `FORCE_COLOR` / TTY detection via {@link shouldUseColor}.
	 *
	 * Optional so existing literals that build a `UiRuntimeOptions` in
	 * tests or mocks without this field keep working; downstream
	 * consumers must treat `undefined` as "colors allowed" to preserve
	 * the pre-existing behaviour.
	 */
	colorEnabled?: boolean;
}

function buildDefaultOptions(): UiRuntimeOptions {
	return {
		v2Enabled: true,
		colorProfile: "truecolor",
		glyphMode: "ascii",
		theme: createUiTheme({ profile: "truecolor", glyphMode: "ascii" }),
		colorEnabled: shouldUseColor(),
	};
}

let runtimeOptions: UiRuntimeOptions = buildDefaultOptions();

export function setUiRuntimeOptions(
	options: Partial<Omit<UiRuntimeOptions, "theme">>,
): UiRuntimeOptions {
	const v2Enabled = options.v2Enabled ?? runtimeOptions.v2Enabled;
	const colorProfile = options.colorProfile ?? runtimeOptions.colorProfile;
	const glyphMode = options.glyphMode ?? runtimeOptions.glyphMode;
	// Re-resolve colorEnabled on every apply so that a test or caller
	// flipping `NO_COLOR` / `FORCE_COLOR` between invocations is honoured,
	// while an explicit override via `options.colorEnabled` still wins.
	const colorEnabled = options.colorEnabled ?? shouldUseColor();
	runtimeOptions = {
		v2Enabled,
		colorProfile,
		glyphMode,
		theme: createUiTheme({ profile: colorProfile, glyphMode }),
		colorEnabled,
	};
	return runtimeOptions;
}

export function getUiRuntimeOptions(): UiRuntimeOptions {
	return runtimeOptions;
}

export function resetUiRuntimeOptions(): UiRuntimeOptions {
	runtimeOptions = buildDefaultOptions();
	return runtimeOptions;
}

