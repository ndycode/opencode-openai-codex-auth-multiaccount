#!/usr/bin/env node

import { execSync } from "node:child_process";

const ALLOWED_HIGH_OR_CRITICAL_PACKAGES = new Set([
	"eslint",
	"ajv",
	"@eslint-community/eslint-utils",
	"@typescript-eslint/eslint-plugin",
	"@typescript-eslint/parser",
	"@typescript-eslint/type-utils",
	"@typescript-eslint/typescript-estree",
	"@typescript-eslint/utils",
	"minimatch",
]);

function summarizeVia(via) {
	if (!Array.isArray(via)) return [];
	return via
		.map((item) => {
			if (typeof item === "string") return item;
			if (!item || typeof item !== "object") return "unknown";
			const name = typeof item.name === "string" ? item.name : "unknown";
			const range = typeof item.range === "string" ? item.range : "";
			return range ? `${name}:${range}` : name;
		})
		.slice(0, 5);
}

let rawAuditOutput = "";
try {
	rawAuditOutput = execSync("npm audit --json", {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
} catch (error) {
	const execError = error;
	const stdout =
		execError &&
		typeof execError === "object" &&
		"stdout" in execError &&
		typeof execError.stdout === "string"
			? execError.stdout
			: "";
	const stderr =
		execError &&
		typeof execError === "object" &&
		"stderr" in execError &&
		typeof execError.stderr === "string"
			? execError.stderr
			: "";
	rawAuditOutput = stdout.trim() || stderr.trim();
}

if (!rawAuditOutput) {
	console.error("Failed to read npm audit JSON output.");
	process.exit(1);
}

let auditJson;
try {
	auditJson = JSON.parse(rawAuditOutput.replace(/^\uFEFF/, ""));
} catch (error) {
	console.error("Failed to parse npm audit JSON output.");
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}

const vulnerabilities =
	auditJson && typeof auditJson === "object" && auditJson.vulnerabilities && typeof auditJson.vulnerabilities === "object"
		? auditJson.vulnerabilities
		: {};

const unexpected = [];
const allowlisted = [];

for (const [name, details] of Object.entries(vulnerabilities)) {
	if (!details || typeof details !== "object") continue;
	const severity = typeof details.severity === "string" ? details.severity : "unknown";
	if (severity !== "high" && severity !== "critical") continue;

	const entry = {
		name,
		severity,
		via: summarizeVia(details.via),
		fixAvailable: details.fixAvailable ?? false,
	};

	if (ALLOWED_HIGH_OR_CRITICAL_PACKAGES.has(name)) {
		allowlisted.push(entry);
		continue;
	}
	unexpected.push(entry);
}

if (unexpected.length > 0) {
	console.error("Unexpected high/critical vulnerabilities detected in dev dependency audit:");
	for (const entry of unexpected) {
		console.error(
			`- ${entry.name} (${entry.severity}) via ${entry.via.join(", ") || "unknown"} fixAvailable=${String(entry.fixAvailable)}`,
		);
	}
	process.exit(1);
}

if (allowlisted.length > 0) {
	console.warn("Allowlisted high/critical dev vulnerabilities detected:");
	for (const entry of allowlisted) {
		console.warn(
			`- ${entry.name} (${entry.severity}) via ${entry.via.join(", ") || "unknown"} fixAvailable=${String(entry.fixAvailable)}`,
		);
	}
	console.warn("No unexpected high/critical vulnerabilities found.");
}
