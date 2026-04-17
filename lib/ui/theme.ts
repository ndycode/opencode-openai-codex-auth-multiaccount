/**
 * Shared terminal theme primitives for legacy and Codex-style TUI rendering.
 */

/**
 * Resolve whether ANSI color output is permitted, honouring the widely
 * supported `NO_COLOR` (https://no-color.org) and `FORCE_COLOR`
 * conventions before falling back to TTY detection.
 *
 * Precedence:
 *   1. `NO_COLOR` — if set to any non-empty value, colors are disabled.
 *      An empty string is treated as "not set" (matches the spec).
 *   2. `FORCE_COLOR` — if set to any value other than `"0"` / `"false"`,
 *      colors are forced on even without a TTY. `"0"` or `"false"`
 *      forces colors OFF regardless of TTY.
 *   3. Fallback: enable colors when the stream is a TTY.
 *
 * The helper takes its dependencies as parameters so it is trivially
 * testable and can be reused from non-process contexts.
 */
export function shouldUseColor(
	stdout: { isTTY?: boolean } = process.stdout,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
	const force = env.FORCE_COLOR;
	if (force !== undefined && force !== "") {
		if (force === "0" || force === "false") return false;
		return true;
	}
	return Boolean(stdout.isTTY);
}

export type UiColorProfile = "ansi16" | "ansi256" | "truecolor";
export type UiGlyphMode = "ascii" | "unicode" | "auto";

export interface UiGlyphSet {
	selected: string;
	unselected: string;
	bullet: string;
	check: string;
	cross: string;
}

export interface UiThemeColors {
	reset: string;
	dim: string;
	muted: string;
	heading: string;
	accent: string;
	success: string;
	warning: string;
	danger: string;
	border: string;
}

export interface UiTheme {
	profile: UiColorProfile;
	glyphMode: UiGlyphMode;
	glyphs: UiGlyphSet;
	colors: UiThemeColors;
}

const ansi16 = (code: number): string => `\x1b[${code}m`;
const ansi256 = (code: number): string => `\x1b[38;5;${code}m`;
const truecolor = (r: number, g: number, b: number): string => `\x1b[38;2;${r};${g};${b}m`;

function resolveGlyphMode(mode: UiGlyphMode): Exclude<UiGlyphMode, "auto"> {
	if (mode !== "auto") return mode;
	const isLikelyUnicodeSafe =
		process.env.WT_SESSION !== undefined ||
		process.env.TERM_PROGRAM === "vscode" ||
		process.env.TERM?.toLowerCase().includes("xterm") === true;
	return isLikelyUnicodeSafe ? "unicode" : "ascii";
}

function getGlyphs(mode: Exclude<UiGlyphMode, "auto">): UiGlyphSet {
	if (mode === "unicode") {
		return {
			selected: "◆",
			unselected: "○",
			bullet: "•",
			check: "✓",
			cross: "✗",
		};
	}
	return {
		selected: ">",
		unselected: "o",
		bullet: "-",
		check: "+",
		cross: "x",
	};
}

function getColors(profile: UiColorProfile): UiThemeColors {
	switch (profile) {
		case "truecolor":
			return {
				reset: "\x1b[0m",
				dim: "\x1b[2m",
				muted: truecolor(148, 163, 184),
				heading: truecolor(226, 232, 240),
				accent: truecolor(56, 189, 248),
				success: truecolor(74, 222, 128),
				warning: truecolor(251, 191, 36),
				danger: truecolor(248, 113, 113),
				border: truecolor(100, 116, 139),
			};
		case "ansi256":
			return {
				reset: "\x1b[0m",
				dim: "\x1b[2m",
				muted: ansi256(109),
				heading: ansi256(255),
				accent: ansi256(45),
				success: ansi256(84),
				warning: ansi256(220),
				danger: ansi256(203),
				border: ansi256(67),
			};
		default:
			return {
				reset: "\x1b[0m",
				dim: "\x1b[2m",
				muted: ansi16(37),
				heading: ansi16(97),
				accent: ansi16(96),
				success: ansi16(92),
				warning: ansi16(93),
				danger: ansi16(91),
				border: ansi16(90),
			};
	}
}

export function createUiTheme(options?: {
	profile?: UiColorProfile;
	glyphMode?: UiGlyphMode;
}): UiTheme {
	const profile = options?.profile ?? "truecolor";
	const glyphMode = options?.glyphMode ?? "ascii";
	const resolvedGlyphMode = resolveGlyphMode(glyphMode);
	return {
		profile,
		glyphMode,
		glyphs: getGlyphs(resolvedGlyphMode),
		colors: getColors(profile),
	};
}

