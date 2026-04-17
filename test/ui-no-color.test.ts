import { describe, it, expect, beforeEach } from "vitest";

import { shouldUseColor } from "../lib/ui/theme.js";
import {
	resetUiRuntimeOptions,
	setUiRuntimeOptions,
} from "../lib/ui/runtime.js";
import { paintUiText } from "../lib/ui/format.js";

describe("shouldUseColor", () => {
	it("NO_COLOR=anything disables", () => {
		expect(shouldUseColor({ isTTY: true }, { NO_COLOR: "1" })).toBe(false);
		expect(shouldUseColor({ isTTY: true }, { NO_COLOR: "yes" })).toBe(
			false,
		);
	});

	it("NO_COLOR empty is ignored", () => {
		expect(shouldUseColor({ isTTY: true }, { NO_COLOR: "" })).toBe(true);
	});

	it("FORCE_COLOR=1 forces over TTY=false", () => {
		expect(shouldUseColor({ isTTY: false }, { FORCE_COLOR: "1" })).toBe(
			true,
		);
	});

	it("FORCE_COLOR=0 disables", () => {
		expect(shouldUseColor({ isTTY: true }, { FORCE_COLOR: "0" })).toBe(
			false,
		);
	});

	it("FORCE_COLOR=false disables", () => {
		expect(shouldUseColor({ isTTY: true }, { FORCE_COLOR: "false" })).toBe(
			false,
		);
	});

	it("defaults to TTY", () => {
		expect(shouldUseColor({ isTTY: true }, {})).toBe(true);
		expect(shouldUseColor({ isTTY: false }, {})).toBe(false);
	});

	it("NO_COLOR wins over FORCE_COLOR", () => {
		expect(
			shouldUseColor(
				{ isTTY: false },
				{ NO_COLOR: "1", FORCE_COLOR: "1" },
			),
		).toBe(false);
	});
});

describe("UI runtime NO_COLOR wiring", () => {
	beforeEach(() => {
		resetUiRuntimeOptions();
	});

	it("paintUiText suppresses ANSI when colorEnabled=false", () => {
		const ui = setUiRuntimeOptions({
			v2Enabled: true,
			colorProfile: "truecolor",
			glyphMode: "ascii",
			colorEnabled: false,
		});
		const painted = paintUiText(ui, "hello", "accent");
		expect(painted).toBe("hello");
		expect(painted).not.toContain("\x1b[");
	});

	it("paintUiText still emits ANSI when colorEnabled=true", () => {
		const ui = setUiRuntimeOptions({
			v2Enabled: true,
			colorProfile: "truecolor",
			glyphMode: "ascii",
			colorEnabled: true,
		});
		const painted = paintUiText(ui, "hello", "accent");
		expect(painted).toContain("hello");
		expect(painted).toContain("\x1b[");
	});
});
