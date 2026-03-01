import { describe, it, expect, beforeAll } from "vitest";

describe("install config merging", () => {
	it("preserves existing provider settings while adding defaults", async () => {
		const module = await import("../scripts/install-config-helpers.js");
		const template = {
			plugin: ["oc-chatgpt-multi-auth"],
			provider: { openai: { models: { alpha: { name: "alpha" } } } },
		};
		const existing = {
			plugin: ["something-else"],
			provider: { openai: { models: { beta: { name: "beta" } }, options: { store: true } } },
		};
		const merged = module.createMergedConfig(template, existing);
		expect(merged.provider.openai.models).toMatchObject({
			alpha: { name: "alpha" },
			beta: { name: "beta" },
		});
		expect(merged.provider.openai.options.store).toBe(true);
	});

	it("ensures plugin is deduplicated and appended", async () => {
		const module = await import("../scripts/install-config-helpers.js");
		const template = { plugin: ["oc-chatgpt-multi-auth"], provider: {} };
		const merged = module.createMergedConfig(template, { plugin: ["oc-chatgpt-multi-auth", "custom"] });
		expect(merged.plugin).toContain("oc-chatgpt-multi-auth");
		expect(merged.plugin.filter((name) => name === "oc-chatgpt-multi-auth").length).toBe(1);
		expect(merged.plugin).toContain("custom");
	});

	it("filters invalid plugin entries while keeping valid strings", async () => {
		const module = await import("../scripts/install-config-helpers.js");
		const normalized = module.normalizePluginList([
			" custom-plugin ",
			"",
			null,
			42,
			"oc-chatgpt-multi-auth@1.0.0",
			"oc-chatgpt-multi-auth",
		]);
		expect(normalized).toEqual(["custom-plugin", "oc-chatgpt-multi-auth"]);
	});

	it("guards createMergedConfig when existing config is not an object", async () => {
		const module = await import("../scripts/install-config-helpers.js");
		const template = { plugin: ["oc-chatgpt-multi-auth"], provider: { openai: { options: { store: false } } } };
		const merged = module.createMergedConfig(template, "not-an-object");
		expect(merged).toEqual(template);
	});
});
