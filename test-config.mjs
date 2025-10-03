#!/usr/bin/env node
import { getModelConfig, getReasoningConfig } from "./lib/request-transformer.mjs";

console.log("=== Testing Configuration Parsing ===\n");

// Simulate provider config from opencode.json
const providerConfig = {
	options: {
		reasoningEffort: "medium",
		reasoningSummary: "auto",
		textVerbosity: "medium",
	},
	models: {
		"gpt-5-codex": {
			options: {
				reasoningSummary: "concise", // Override global
			},
		},
		"gpt-5": {
			options: {
				reasoningEffort: "high", // Override global
			},
		},
	},
};

// Build userConfig structure (same as in index.mjs)
const userConfig = {
	global: providerConfig.options || {},
	models: providerConfig.models || {},
};

console.log("Provider Config:");
console.log(JSON.stringify(providerConfig, null, 2));
console.log("\n");

// Test 1: gpt-5-codex (should merge global + model-specific)
console.log("Test 1: gpt-5-codex configuration");
const codexConfig = getModelConfig("gpt-5-codex", userConfig);
console.log("Merged config:", codexConfig);
console.log("Expected: reasoningEffort='medium' (global), reasoningSummary='concise' (override), textVerbosity='medium' (global)");
console.log("✓ Pass:", 
	codexConfig.reasoningEffort === "medium" &&
	codexConfig.reasoningSummary === "concise" &&
	codexConfig.textVerbosity === "medium"
);
console.log("\n");

// Test 2: gpt-5 (should merge global + model-specific)
console.log("Test 2: gpt-5 configuration");
const gpt5Config = getModelConfig("gpt-5", userConfig);
console.log("Merged config:", gpt5Config);
console.log("Expected: reasoningEffort='high' (override), reasoningSummary='auto' (global), textVerbosity='medium' (global)");
console.log("✓ Pass:", 
	gpt5Config.reasoningEffort === "high" &&
	gpt5Config.reasoningSummary === "auto" &&
	gpt5Config.textVerbosity === "medium"
);
console.log("\n");

// Test 3: Reasoning config with user settings
console.log("Test 3: Reasoning config for gpt-5-codex");
const reasoningConfig = getReasoningConfig("gpt-5-codex", codexConfig);
console.log("Reasoning config:", reasoningConfig);
console.log("Expected: effort='medium', summary='concise'");
console.log("✓ Pass:", 
	reasoningConfig.effort === "medium" &&
	reasoningConfig.summary === "concise"
);
console.log("\n");

// Test 4: Defaults when no config provided
console.log("Test 4: Defaults with empty config");
const emptyConfig = getModelConfig("gpt-5-codex", {});
const defaultReasoning = getReasoningConfig("gpt-5-codex", emptyConfig);
console.log("Empty config:", emptyConfig);
console.log("Default reasoning:", defaultReasoning);
console.log("Expected: effort='medium' (default), summary='auto' (default)");
console.log("✓ Pass:", 
	defaultReasoning.effort === "medium" &&
	defaultReasoning.summary === "auto"
);
console.log("\n");

// Test 5: Lightweight model defaults
console.log("Test 5: Lightweight model (gpt-5-nano)");
const nanoReasoning = getReasoningConfig("gpt-5-nano", {});
console.log("Nano reasoning:", nanoReasoning);
console.log("Expected: effort='minimal' (lightweight default), summary='auto'");
console.log("✓ Pass:",
	nanoReasoning.effort === "minimal" &&
	nanoReasoning.summary === "auto"
);
console.log("\n");

// Test 6: Normalize "minimal" to "low" for gpt-5-codex
console.log("Test 6: Normalize minimal→low for gpt-5-codex (Codex CLI doesn't support minimal)");
const codexMinimalConfig = { reasoningEffort: "minimal" };
const codexMinimalReasoning = getReasoningConfig("gpt-5-codex", codexMinimalConfig);
console.log("Config:", codexMinimalConfig);
console.log("Reasoning result:", codexMinimalReasoning);
console.log("Expected: effort='low' (normalized from minimal), summary='auto'");
console.log("✓ Pass:",
	codexMinimalReasoning.effort === "low" &&
	codexMinimalReasoning.summary === "auto"
);

console.log("\n=== All Tests Complete ===");
