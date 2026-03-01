import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("omx-capture-evidence script", () => {
  it("parses required args", async () => {
    const mod = await import("../scripts/omx-capture-evidence-core.js");
    expect(
      mod.parseArgs([
        "--mode",
        "ralph",
        "--architect-tier",
        "standard",
        "--architect-ref",
        "architect://run/123",
      ]),
    ).toEqual({
      mode: "ralph",
      team: "",
      architectTier: "standard",
      architectRef: "architect://run/123",
      architectNote: "",
      output: "",
    });
  });

  it("requires architect args", async () => {
    const mod = await import("../scripts/omx-capture-evidence-core.js");
    expect(() => mod.parseArgs(["--mode", "ralph"])).toThrow("`--architect-tier` is required.");
  });

  it("parses team status counts from json and text", async () => {
    const mod = await import("../scripts/omx-capture-evidence-core.js");
    expect(mod.parseTeamCounts('{"task_counts":{"pending":0,"in_progress":0,"failed":1}}')).toEqual({
      pending: 0,
      inProgress: 0,
      failed: 1,
    });
    expect(mod.parseTeamCounts("pending=2 in_progress=1 failed=0")).toEqual({
      pending: 2,
      inProgress: 1,
      failed: 0,
    });
  });

  it("redacts sensitive command output before writing evidence", async () => {
    const mod = await import("../scripts/omx-capture-evidence-core.js");
    const root = await mkdtemp(join(tmpdir(), "omx-evidence-redaction-"));
    await writeFile(join(root, "package.json"), '{"name":"tmp"}', "utf8");

    try {
      const outputPath = join(root, ".omx", "evidence", "redacted.md");
      await mod.runEvidence(
        {
          mode: "ralph",
          team: "",
          architectTier: "standard",
          architectRef: "architect://verdict/ok",
          architectNote: "",
          output: outputPath,
        },
        {
          cwd: root,
          runCommand: (command: string, args: string[]) => {
            const fakeBearer = ["bearer", "value"].join("-");
            const fakeSk = ["sk", "1234567890123456789012"].join("-");
            const fakeAwsAccessKeyId = ["AKIA", "1234567890ABCDEF"].join("");
            const fakeAwsSecret = Array.from({ length: 40 }, () => "a").join("");
            if (command === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
              return { command: "git rev-parse --abbrev-ref HEAD", code: 0, stdout: "feature/test", stderr: "" };
            }
            if (command === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
              return { command: "git rev-parse HEAD", code: 0, stdout: "abc123", stderr: "" };
            }
            return {
              command: `${command} ${args.join(" ")}`,
              code: 0,
              stdout: `token=secret-value Authorization: Bearer ${fakeBearer} ${fakeSk} ${fakeAwsAccessKeyId} AWS_SECRET_ACCESS_KEY=${fakeAwsSecret}`,
              stderr: "",
            };
          },
        },
      );

      const markdown = await readFile(outputPath, "utf8");
      expect(markdown).toContain("***REDACTED***");
      expect(markdown).not.toContain("secret-value");
      expect(markdown).not.toContain("bearer-value");
      expect(markdown).not.toContain("AKIA1234567890ABCDEF");
      expect(markdown).not.toContain("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(markdown).toContain("## Redaction Strategy");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("handles 100 concurrent retry-prone writes without EBUSY throw", async () => {
    const mod = await import("../scripts/omx-capture-evidence-core.js");
    const root = await mkdtemp(join(tmpdir(), "omx-evidence-concurrency-"));
    const sharedPath = join(root, "shared-evidence.md");
    const seenPayloadAttempts = new Map<string, number>();

    const makeBusyError = () => {
      const error = new Error("file busy");
      Object.assign(error, { code: "EBUSY" });
      return error;
    };

    try {
      const concurrencyCount = 100;
      const writes = Array.from({ length: concurrencyCount }, (_value, index) => {
        return new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        }).then(() =>
          mod.writeFileWithRetry(sharedPath, `write-${index}`, {
            writeFileSyncFn: (path: string, content: string, encoding: BufferEncoding) => {
              const attempts = seenPayloadAttempts.get(content) ?? 0;
              if (attempts === 0) {
                seenPayloadAttempts.set(content, 1);
                throw makeBusyError();
              }
              seenPayloadAttempts.set(content, attempts + 1);
              writeFileSync(path, content, encoding);
            },
            sleepFn: async () => Promise.resolve(),
            maxAttempts: 5,
            baseDelayMs: 0,
          }),
        );
      });

      await expect(Promise.all(writes)).resolves.toHaveLength(concurrencyCount);
      const finalContent = await readFile(sharedPath, "utf8");
      expect(finalContent.startsWith("write-")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retries EBUSY with built-in sleep implementation", async () => {
    const mod = await import("../scripts/omx-capture-evidence-core.js");
    const root = await mkdtemp(join(tmpdir(), "omx-evidence-sleep-"));
    const outputPath = join(root, "retry-output.md");
    let calls = 0;

    const makeBusyError = () => {
      const error = new Error("file busy");
      Object.assign(error, { code: "EBUSY" });
      return error;
    };

    try {
      await expect(
        mod.writeFileWithRetry(outputPath, "content", {
          writeFileSyncFn: (path: string, content: string, encoding: BufferEncoding) => {
            calls += 1;
            if (calls === 1) throw makeBusyError();
            writeFileSync(path, content, encoding);
          },
          maxAttempts: 3,
          baseDelayMs: 1,
        }),
      ).resolves.toBeUndefined();

      expect(calls).toBe(2);
      const fileContent = await readFile(outputPath, "utf8");
      expect(fileContent).toBe("content");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes evidence markdown when gates pass in ralph mode", async () => {
    const mod = await import("../scripts/omx-capture-evidence-core.js");
    const root = await mkdtemp(join(tmpdir(), "omx-evidence-"));
    await writeFile(join(root, "package.json"), '{"name":"tmp"}', "utf8");

    try {
      const outputPath = join(root, ".omx", "evidence", "result.md");
      const result = await mod.runEvidence(
        {
          mode: "ralph",
          team: "",
          architectTier: "standard",
          architectRef: "architect://verdict/ok",
          architectNote: "approved",
          output: outputPath,
        },
        {
          cwd: root,
          runCommand: (command: string, args: string[]) => {
            if (command === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
              return { command: "git rev-parse --abbrev-ref HEAD", code: 0, stdout: "feature/test", stderr: "" };
            }
            if (command === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
              return { command: "git rev-parse HEAD", code: 0, stdout: "abc123", stderr: "" };
            }
            return { command: `${command} ${args.join(" ")}`, code: 0, stdout: "ok", stderr: "" };
          },
        },
      );

      expect(result.overallPassed).toBe(true);
      const markdown = await readFile(outputPath, "utf8");
      expect(markdown).toContain("## Overall Result: PASS");
      expect(markdown).toContain("architect://verdict/ok");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails ralph mode evidence when cleanup state is still active", async () => {
    const mod = await import("../scripts/omx-capture-evidence-core.js");
    const root = await mkdtemp(join(tmpdir(), "omx-evidence-active-"));
    await writeFile(join(root, "package.json"), '{"name":"tmp"}', "utf8");
    await mkdir(join(root, ".omx", "state"), { recursive: true });
    await writeFile(
      join(root, ".omx", "state", "ralph-state.json"),
      JSON.stringify({ active: true, current_phase: "executing" }),
      "utf8",
    );

    try {
      const outputPath = join(root, ".omx", "evidence", "result-active.md");
      const result = await mod.runEvidence(
        {
          mode: "ralph",
          team: "",
          architectTier: "standard",
          architectRef: "architect://verdict/ok",
          architectNote: "",
          output: outputPath,
        },
        {
          cwd: root,
          runCommand: (command: string, args: string[]) => {
            if (command === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
              return { command: "git rev-parse --abbrev-ref HEAD", code: 0, stdout: "feature/test", stderr: "" };
            }
            if (command === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
              return { command: "git rev-parse HEAD", code: 0, stdout: "abc123", stderr: "" };
            }
            return { command: `${command} ${args.join(" ")}`, code: 0, stdout: "ok", stderr: "" };
          },
        },
      );

      expect(result.overallPassed).toBe(false);
      const markdown = await readFile(outputPath, "utf8");
      expect(markdown).toContain("Ralph cleanup state");
      expect(markdown).toContain("FAIL");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
