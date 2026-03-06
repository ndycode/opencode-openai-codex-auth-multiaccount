import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readJson(relativePath: string): Record<string, unknown> {
	return JSON.parse(readFileSync(resolve(relativePath), "utf8")) as Record<string, unknown>;
}

function getOpenAiModels(template: Record<string, unknown>): Record<string, { name?: string }> {
	const provider = template.provider as { openai?: { models?: Record<string, { name?: string }> } } | undefined;
	return provider?.openai?.models ?? {};
}

describe("config templates", () => {
	it("labels the modern gpt-5-codex selector as GPT 5.4 in the TUI template", () => {
		const template = readJson("config/opencode-modern.json");
		const models = getOpenAiModels(template);

		expect(models["gpt-5-codex"]?.name).toBe("GPT 5.4 (OAuth)");
		expect(models["gpt-5.4"]?.name).toBe("GPT 5.4 (OAuth)");
	});

	it("labels the legacy codex presets as GPT 5.4 variants", () => {
		const template = readJson("config/opencode-legacy.json");
		const models = getOpenAiModels(template);

		expect(models["gpt-5-codex-low"]?.name).toBe("GPT 5.4 Low (OAuth)");
		expect(models["gpt-5-codex-medium"]?.name).toBe("GPT 5.4 Medium (OAuth)");
		expect(models["gpt-5-codex-high"]?.name).toBe("GPT 5.4 High (OAuth)");
	});
});
