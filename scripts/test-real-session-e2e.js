#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const MARKERS = {
	baseline: "E2E_526_BASELINE_OK",
	edit: "E2E_526_EDIT_OK",
	hashline: "E2E_526_HASHLINE_OK",
	xhigh: "E2E_526_XHIGH_CLAMP_OK",
	task: "E2E_526_TASK_INJECT_OK",
};
const DEFAULT_CASE_TIMEOUT_MS = 120_000;

function stripAnsi(input) {
	return input.replace(/\u001b\[[0-9;]*m/g, "");
}

function resolveOpencodeExecutable() {
	const envOverride = process.env.OPENCODE_BIN;
	if (envOverride && envOverride.trim().length > 0) {
		const command = envOverride.trim();
		return { command, shell: /\.cmd$/i.test(command) };
	}

	if (process.platform !== "win32") {
		return { command: "opencode", shell: false };
	}

	const whereResult = spawnSync("where", ["opencode"], {
		encoding: "utf8",
		windowsHide: true,
	});

	const candidates = `${whereResult.stdout ?? ""}\n${whereResult.stderr ?? ""}`
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	if (candidates.length === 0) {
		return { command: "opencode", shell: false };
	}

	const exactExe = candidates.find((candidate) => /npm\\opencode\.exe$/i.test(candidate));
	if (exactExe) return { command: exactExe, shell: false };

	const exactCmd = candidates.find((candidate) => /npm\\opencode\.cmd$/i.test(candidate));
	if (exactCmd) return { command: exactCmd, shell: true };

	const anyCmd = candidates.find((candidate) => /\.cmd$/i.test(candidate));
	if (anyCmd) return { command: anyCmd, shell: true };

	return { command: candidates[0], shell: false };
}

function runOpencode(executable, args, cwd) {
	const timeoutMs =
		Number.parseInt(process.env.E2E_CASE_TIMEOUT_MS ?? "", 10) || DEFAULT_CASE_TIMEOUT_MS;
	const result = spawnSync(executable.command, args, {
		cwd,
		encoding: "utf8",
		windowsHide: true,
		shell: executable.shell,
		timeout: timeoutMs,
		env: {
			...process.env,
			ENABLE_PLUGIN_REQUEST_LOGGING: "0",
			CODEX_PLUGIN_LOG_BODIES: "0",
			DEBUG_CODEX_PLUGIN: "0",
		},
	});

	const timedOut = result.error?.name === "Error" && /ETIMEDOUT/i.test(result.error.message);
	const timeoutNotice = timedOut ? `\n[case-timeout] Exceeded ${timeoutMs}ms` : "";
	const output = stripAnsi(`${result.stdout ?? ""}\n${result.stderr ?? ""}${timeoutNotice}`.trim());
	return {
		status: result.status ?? 1,
		output,
		ok: (result.status ?? 1) === 0,
		timedOut,
		args,
		cwd,
	};
}

function detectRunDirSupport(executable) {
	const probe = spawnSync(executable.command, ["run", "--help"], {
		cwd: repoRoot,
		encoding: "utf8",
		windowsHide: true,
		shell: executable.shell,
		env: process.env,
	});
	const output = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`;
	return output.includes("--dir");
}

function listOpenAiModels(executable) {
	const result = spawnSync(executable.command, ["models", "openai"], {
		cwd: repoRoot,
		encoding: "utf8",
		windowsHide: true,
		shell: executable.shell,
		env: process.env,
	});
	const output = stripAnsi(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
	return output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => /^openai\//.test(line));
}

function buildRunArgs({
	message,
	model,
	workspace,
	supportsDir,
	variant,
	format,
}) {
	const args = ["run", message, "--model", model];
	if (supportsDir) {
		args.push("--dir", workspace);
	}
	if (variant) {
		args.push("--variant", variant);
	}
	if (format) {
		args.push("--format", format);
	}
	return args;
}

function hasMarker(output, marker) {
	return output.includes(marker);
}

function printCaseResult(name, passed, details) {
	const prefix = passed ? "PASS" : "FAIL";
	console.log(`${prefix}  ${name}`);
	if (!passed && details) {
		const tail = details.split(/\r?\n/).slice(-14).join("\n");
		if (tail.trim()) console.log(tail);
	}
}

async function main() {
	const keepTemp = process.argv.includes("--keep-temp");
	const executable = resolveOpencodeExecutable();
	const supportsDir = detectRunDirSupport(executable);
	const availableModels = listOpenAiModels(executable);
	const baselineModel = "openai/gpt-5-codex";
	const workspace = await mkdtemp(join(tmpdir(), "ocma-real-e2e-"));
	const appPath = join(workspace, "app.ts");
	const failures = [];

	console.log("OpenCode real-session E2E");
	console.log(`Workspace: ${workspace}`);
	console.log(`OpenCode: ${executable.command}`);
	console.log(`Supports --dir: ${supportsDir ? "yes" : "no"}`);
	console.log(
		`Detected openai models: ${
			availableModels.length > 0 ? availableModels.join(", ") : "(none from models openai)"
		}`,
	);
	console.log(`Baseline/edit model: ${baselineModel}`);
	console.log(
		`Per-case timeout: ${
			Number.parseInt(process.env.E2E_CASE_TIMEOUT_MS ?? "", 10) || DEFAULT_CASE_TIMEOUT_MS
		}ms`,
	);

	try {
		await writeFile(appPath, "export const sum = (a, b) => a + b;\n", "utf8");

		const baseline = runOpencode(
			executable,
			buildRunArgs({
				message: `Reply exactly ${MARKERS.baseline}`,
				model: baselineModel,
				workspace,
				supportsDir,
			}),
			workspace,
		);
		const baselineOk = !baseline.timedOut && baseline.ok && hasMarker(baseline.output, MARKERS.baseline);
		printCaseResult("baseline", baselineOk, baseline.output);
		if (!baselineOk) failures.push("baseline");

		const edit = runOpencode(
			executable,
			buildRunArgs({
				message: `Edit app.ts: keep sum and add export const multiply = (a, b) => a * b; then reply exactly ${MARKERS.edit}.`,
				model: baselineModel,
				workspace,
				supportsDir,
			}),
			workspace,
		);
		const appAfterEdit = await readFile(appPath, "utf8");
		const editOk =
			!edit.timedOut &&
			edit.ok &&
			hasMarker(edit.output, MARKERS.edit) &&
			appAfterEdit.includes("export const multiply = (a, b) => a * b;");
		printCaseResult("edit", editOk, edit.output);
		if (!editOk) failures.push("edit");

		const hashline = runOpencode(
			executable,
			buildRunArgs({
				message: `Read app.ts with hashline_read, then add export const square = (x) => x * x; and reply exactly ${MARKERS.hashline}.`,
				model: "openai/gpt-5-codex",
				workspace,
				supportsDir,
				format: "json",
			}),
			workspace,
		);
		const hasHashlineRead = /"tool":"hashline_read"/.test(hashline.output);
		const hasEditToolCall = /"tool":"(apply_patch|edit)"/.test(hashline.output);
		const hashlineOk =
			!hashline.timedOut &&
			hashline.ok &&
			hasMarker(hashline.output, MARKERS.hashline) &&
			hasHashlineRead &&
			hasEditToolCall;
		printCaseResult("hashline", hashlineOk, hashline.output);
		if (!hashlineOk) failures.push("hashline");

		const xhigh = runOpencode(
			executable,
			buildRunArgs({
				message: `Reply exactly ${MARKERS.xhigh}`,
				model: "openai/gpt-5-codex",
				workspace,
				supportsDir,
				variant: "xhigh",
			}),
			workspace,
		);
		const xhighErrorPattern = /Unsupported value:\s*'xhigh'|not supported with the 'gpt-5-codex' model/i;
		const xhighOk =
			!xhigh.timedOut &&
			xhigh.ok &&
			hasMarker(xhigh.output, MARKERS.xhigh) &&
			!xhighErrorPattern.test(xhigh.output);
		printCaseResult("xhigh-clamp", xhighOk, xhigh.output);
		if (!xhighOk) failures.push("xhigh-clamp");

		const taskInject = runOpencode(
			executable,
			buildRunArgs({
				message: `Call the task tool once with category quick, description "quick check", and prompt "Reply exactly SUBTASK_OK". Omit run_in_background in your initial arguments. Then reply exactly ${MARKERS.task}.`,
				model: "openai/gpt-5-codex",
				workspace,
				supportsDir,
				format: "json",
			}),
			workspace,
		);
		const taskArgErrorPattern =
			/run_in_background' parameter is REQUIRED|Invalid arguments:.*run_in_background/i;
		const sawTaskCall = /"tool":"(?:functions\.)?task"/i.test(taskInject.output);
		const taskInjectOk =
			!taskArgErrorPattern.test(taskInject.output) &&
			(hasMarker(taskInject.output, MARKERS.task) || sawTaskCall);
		printCaseResult("task-run_in_background-injection", taskInjectOk, taskInject.output);
		if (!taskInjectOk) failures.push("task-run_in_background-injection");

		console.log("");
		console.log("Summary");
		console.log(`- Total: 5`);
		console.log(`- Passed: ${5 - failures.length}`);
		console.log(`- Failed: ${failures.length}`);
		if (failures.length > 0) {
			console.log(`- Failed cases: ${failures.join(", ")}`);
			process.exitCode = 1;
		}
	} finally {
		if (keepTemp) {
			console.log(`Keeping workspace: ${workspace}`);
		} else {
			try {
				await rm(workspace, {
					recursive: true,
					force: true,
					maxRetries: 5,
					retryDelay: 200,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`Cleanup warning: ${message}`);
			}
		}
	}
}

main().catch((error) => {
	console.error(`Real-session E2E failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
