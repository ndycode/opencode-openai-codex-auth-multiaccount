#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const REDACTION_PLACEHOLDER = "***REDACTED***";
const WRITE_RETRY_ATTEMPTS = 6;
const WRITE_RETRY_BASE_DELAY_MS = 40;

function normalizePathForCompare(path) {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  return normalizePathForCompare(process.argv[1]) === normalizePathForCompare(__filename);
})();

function resolveTool(toolName) {
  if (process.platform !== "win32") return toolName;
  if (toolName === "npm") return "npm.cmd";
  if (toolName === "npx") return "npx.cmd";
  return toolName;
}

export function parseArgs(argv) {
  const options = {
    mode: "",
    team: "",
    architectTier: "",
    architectRef: "",
    architectNote: "",
    output: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1] ?? "";
    if (token === "--mode") {
      if (!value) throw new Error("Missing value for --mode");
      options.mode = value;
      index += 1;
      continue;
    }
    if (token === "--team") {
      if (!value) throw new Error("Missing value for --team");
      options.team = value;
      index += 1;
      continue;
    }
    if (token === "--architect-tier") {
      if (!value) throw new Error("Missing value for --architect-tier");
      options.architectTier = value;
      index += 1;
      continue;
    }
    if (token === "--architect-ref") {
      if (!value) throw new Error("Missing value for --architect-ref");
      options.architectRef = value;
      index += 1;
      continue;
    }
    if (token === "--architect-note") {
      if (!value) throw new Error("Missing value for --architect-note");
      options.architectNote = value;
      index += 1;
      continue;
    }
    if (token === "--output") {
      if (!value) throw new Error("Missing value for --output");
      options.output = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${token}`);
  }

  if (options.mode !== "team" && options.mode !== "ralph") {
    throw new Error("`--mode` must be `team` or `ralph`.");
  }
  if (options.mode === "team" && !options.team) {
    throw new Error("`--team` is required when --mode team.");
  }
  if (!options.architectTier) {
    throw new Error("`--architect-tier` is required.");
  }
  if (!options.architectRef) {
    throw new Error("`--architect-ref` is required.");
  }

  return options;
}

export function runCommand(command, args, overrides = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    ...overrides,
  });

  return {
    command: `${command} ${args.join(" ")}`.trim(),
    code: typeof result.status === "number" ? result.status : 1,
    stdout: typeof result.stdout === "string" ? result.stdout.trim() : "",
    stderr: typeof result.stderr === "string" ? result.stderr.trim() : "",
  };
}

function nowStamp() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  const millis = String(date.getMilliseconds()).padStart(3, "0");
  return `${year}${month}${day}-${hour}${minute}${second}-${millis}`;
}

function clampText(text, maxLength = 12000) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...[truncated]`;
}

export function redactSensitiveText(text) {
  let redacted = text;
  const replacementRules = [
    {
      pattern: /\b(Authorization\s*:\s*Bearer\s+)([^\s\r\n]+)/gi,
      replace: (_match, prefix, _secret) => `${prefix}${REDACTION_PLACEHOLDER}`,
    },
    {
      pattern: /("(?:token|secret|password|api[_-]?key|authorization|access_token)"\s*:\s*")([^"]+)(")/gi,
      replace: (_match, start, _secret, end) => `${start}${REDACTION_PLACEHOLDER}${end}`,
    },
    {
      pattern: /\b((?:token|secret|password|api[_-]?key|authorization|access_token)\b[^\S\r\n]*[:=][^\S\r\n]*)([^\s\r\n]+)/gi,
      replace: (_match, prefix, _secret) => `${prefix}${REDACTION_PLACEHOLDER}`,
    },
    {
      pattern: /\b(Bearer\s+)([A-Za-z0-9._~+/=-]+)/gi,
      replace: (_match, prefix, _secret) => `${prefix}${REDACTION_PLACEHOLDER}`,
    },
    {
      pattern: /([?&](?:token|api[_-]?key|access_token|password)=)([^&\s]+)/gi,
      replace: (_match, prefix, _secret) => `${prefix}${REDACTION_PLACEHOLDER}`,
    },
    {
      pattern: /\bsk-[A-Za-z0-9]{20,}\b/g,
      replace: REDACTION_PLACEHOLDER,
    },
    {
      pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
      replace: REDACTION_PLACEHOLDER,
    },
  ];

  for (const rule of replacementRules) {
    redacted = redacted.replace(rule.pattern, rule.replace);
  }
  return redacted;
}

function parseCount(text, keyAliases) {
  for (const key of keyAliases) {
    const patterns = [
      new RegExp(`${key}\\s*[=:]\\s*(\\d+)`, "i"),
      new RegExp(`"${key}"\\s*:\\s*(\\d+)`, "i"),
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return Number(match[1]);
    }
  }
  return null;
}

export function parseTeamCounts(statusOutput) {
  try {
    const parsed = JSON.parse(statusOutput);
    if (parsed && typeof parsed === "object") {
      const summary =
        "task_counts" in parsed && parsed.task_counts && typeof parsed.task_counts === "object"
          ? parsed.task_counts
          : "tasks" in parsed && parsed.tasks && typeof parsed.tasks === "object"
            ? parsed.tasks
            : null;
      if (summary) {
        const pending = "pending" in summary && typeof summary.pending === "number" ? summary.pending : null;
        const inProgress = "in_progress" in summary && typeof summary.in_progress === "number" ? summary.in_progress : null;
        const failed = "failed" in summary && typeof summary.failed === "number" ? summary.failed : null;
        if (pending !== null && inProgress !== null && failed !== null) {
          return { pending, inProgress, failed };
        }
      }
    }
  } catch {
    // ignore and fallback to regex parse
  }

  const pending = parseCount(statusOutput, ["pending"]);
  const inProgress = parseCount(statusOutput, ["in_progress", "in-progress", "in progress"]);
  const failed = parseCount(statusOutput, ["failed"]);
  if (pending === null || inProgress === null || failed === null) return null;
  return { pending, inProgress, failed };
}

function formatOutput(result) {
  const combined = [result.stdout, result.stderr].filter((value) => value.length > 0).join("\n");
  if (!combined) return "(no output)";
  return clampText(redactSensitiveText(combined));
}

function getErrorCode(error) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "";
}

function isRetryableWriteError(error) {
  const code = getErrorCode(error);
  return code === "EBUSY" || code === "EPERM";
}

function sleep(milliseconds) {
  const waitMs = Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 0;
  if (waitMs === 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, waitMs);
  });
}

export async function writeFileWithRetry(outputPath, content, deps = {}) {
  const writeFn = deps.writeFileSyncFn ?? writeFileSync;
  const sleepFn = deps.sleepFn ?? sleep;
  const maxAttempts = Number.isInteger(deps.maxAttempts) ? deps.maxAttempts : WRITE_RETRY_ATTEMPTS;
  const baseDelayMs = Number.isFinite(deps.baseDelayMs) ? deps.baseDelayMs : WRITE_RETRY_BASE_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      writeFn(outputPath, content, "utf8");
      return;
    } catch (error) {
      const isRetryable = isRetryableWriteError(error);
      if (!isRetryable || attempt === maxAttempts) throw error;
      await sleepFn(baseDelayMs * attempt);
    }
  }
}

function ensureRepoRoot(cwd) {
  const packagePath = join(cwd, "package.json");
  if (!existsSync(packagePath)) {
    throw new Error(`Expected package.json in current directory (${cwd}). Run this command from repo root.`);
  }
}

function checkRalphCleanup(cwd) {
  const statePath = join(cwd, ".omx", "state", "ralph-state.json");
  if (!existsSync(statePath)) {
    return { passed: true, detail: "ralph state file not present (treated as cleaned)." };
  }

  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    const active = parsed && typeof parsed === "object" && "active" in parsed ? parsed.active : undefined;
    const phase = parsed && typeof parsed === "object" && "current_phase" in parsed ? parsed.current_phase : undefined;
    if (active === false) {
      return { passed: true, detail: `ralph state inactive${phase ? ` (${String(phase)})` : ""}.` };
    }
    return { passed: false, detail: "ralph state is still active; run `omx cancel` before final evidence capture." };
  } catch {
    return { passed: false, detail: "ralph state file unreadable; fix state file or run `omx cancel`." };
  }
}

function buildOutputPath(options, cwd, runId) {
  if (options.output) return options.output;
  const filename = `${runId}-${options.mode}-evidence.md`;
  return join(cwd, ".omx", "evidence", filename);
}

export async function runEvidence(options, deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  ensureRepoRoot(cwd);

  const run = deps.runCommand ?? runCommand;
  const npm = resolveTool("npm");
  const npx = resolveTool("npx");
  const omx = resolveTool("omx");

  const metadataBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  const metadataCommit = run("git", ["rev-parse", "HEAD"], { cwd });

  const typecheck = run(npm, ["run", "typecheck"], { cwd });
  const tests = run(npm, ["test"], { cwd });
  const build = run(npm, ["run", "build"], { cwd });
  const diagnostics = run(npx, ["tsc", "--noEmit", "--pretty", "false"], { cwd });

  let teamStatus = null;
  let teamCounts = null;
  if (options.mode === "team") {
    teamStatus = run(omx, ["team", "status", options.team], { cwd });
    if (teamStatus.code === 0) {
      teamCounts = parseTeamCounts(`${teamStatus.stdout}\n${teamStatus.stderr}`);
    }
  }

  const teamStatePassed =
    options.mode === "team"
      ? teamStatus !== null &&
        teamStatus.code === 0 &&
        teamCounts !== null &&
        teamCounts.pending === 0 &&
        teamCounts.inProgress === 0 &&
        teamCounts.failed === 0
      : true;

  const ralphCleanup = options.mode === "ralph" ? checkRalphCleanup(cwd) : { passed: true, detail: "Not applicable (mode=team)" };

  const architectPassed = options.architectTier.trim().length > 0 && options.architectRef.trim().length > 0;

  const gates = [
    { name: "Typecheck", passed: typecheck.code === 0, detail: "npm run typecheck" },
    { name: "Tests", passed: tests.code === 0, detail: "npm test" },
    { name: "Build", passed: build.code === 0, detail: "npm run build" },
    { name: "Diagnostics", passed: diagnostics.code === 0, detail: "npx tsc --noEmit --pretty false" },
    {
      name: "Team terminal state",
      passed: teamStatePassed,
      detail:
        options.mode === "team"
          ? teamCounts
            ? `pending=${teamCounts.pending}, in_progress=${teamCounts.inProgress}, failed=${teamCounts.failed}`
            : "Unable to parse team status counts."
          : "Not applicable (mode=ralph)",
    },
    {
      name: "Architect verification",
      passed: architectPassed,
      detail: `tier=${options.architectTier}; ref=${options.architectRef}`,
    },
    {
      name: "Ralph cleanup state",
      passed: ralphCleanup.passed,
      detail: ralphCleanup.detail,
    },
  ];

  const overallPassed =
    typecheck.code === 0 &&
    tests.code === 0 &&
    build.code === 0 &&
    diagnostics.code === 0 &&
    teamStatePassed &&
    architectPassed &&
    ralphCleanup.passed;

  const runId = nowStamp();
  const outputPath = buildOutputPath(options, cwd, runId);
  mkdirSync(dirname(outputPath), { recursive: true });

  const lines = [];
  lines.push("# OMX Execution Evidence");
  lines.push("");
  lines.push("## Metadata");
  lines.push(`- Run ID: ${runId}`);
  lines.push(`- Generated at: ${new Date().toISOString()}`);
  lines.push(`- Mode: ${options.mode}`);
  if (options.mode === "team") lines.push(`- Team name: ${options.team}`);
  lines.push(`- Branch: ${metadataBranch.code === 0 ? metadataBranch.stdout : "unknown"}`);
  lines.push(`- Commit: ${metadataCommit.code === 0 ? metadataCommit.stdout : "unknown"}`);
  lines.push("");
  lines.push("## Gate Summary");
  lines.push("| Gate | Result | Detail |");
  lines.push("| --- | --- | --- |");
  for (const gate of gates) {
    lines.push(`| ${gate.name} | ${gate.passed ? "PASS" : "FAIL"} | ${gate.detail.replace(/\|/g, "\\|")} |`);
  }
  lines.push("");
  lines.push(`## Overall Result: ${overallPassed ? "PASS" : "FAIL"}`);
  lines.push("");
  lines.push("## Redaction Strategy");
  lines.push(`- Command output is sanitized before writing evidence; keys matching token/secret/password/api key patterns are replaced with ${REDACTION_PLACEHOLDER}.`);
  lines.push("");
  lines.push("## Command Output");

  const commandResults = [
    { name: "typecheck", result: typecheck },
    { name: "tests", result: tests },
    { name: "build", result: build },
    { name: "diagnostics", result: diagnostics },
  ];
  if (teamStatus) commandResults.push({ name: "team-status", result: teamStatus });

  for (const item of commandResults) {
    lines.push(`### ${item.name} (${item.result.code === 0 ? "PASS" : "FAIL"})`);
    lines.push("```text");
    lines.push(`$ ${item.result.command}`);
    lines.push(formatOutput(item.result));
    lines.push("```");
    lines.push("");
  }

  lines.push("## Architect Verification");
  lines.push("```text");
  lines.push(`tier=${options.architectTier}`);
  lines.push(`ref=${options.architectRef}`);
  if (options.architectNote) lines.push(`note=${options.architectNote}`);
  lines.push("```");
  lines.push("");

  await writeFileWithRetry(outputPath, lines.join("\n"));
  return { overallPassed, outputPath };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await runEvidence(options);
  if (result.overallPassed) {
    console.log(`Evidence captured at ${result.outputPath}`);
    console.log("All gates passed.");
    process.exit(0);
  }
  console.error(`Evidence captured at ${result.outputPath}`);
  console.error("One or more gates failed.");
  process.exit(1);
}

if (isDirectRun) {
  main().catch((error) => {
    console.error("Failed to capture evidence.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
