import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { auditLog, configureAudit } from "../lib/audit.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("Audit Logger - Concurrency Tests", () => {
    const testLogDir = path.join(os.tmpdir(), "oc-chatgpt-multi-auth-test-audit-2");
    
    beforeAll(() => {
        if (fs.existsSync(testLogDir)) {
            fs.rmSync(testLogDir, { recursive: true, force: true });
        }
        fs.mkdirSync(testLogDir, { recursive: true });
        configureAudit({ enabled: true, logDir: testLogDir, maxFileSizeBytes: 10 * 1024 * 1024, maxFiles: 5 });
    });

    afterAll(() => {
        if (fs.existsSync(testLogDir)) {
            fs.rmSync(testLogDir, { recursive: true, force: true });
        }
    });

    it("should handle 100 concurrent log writes without throwing EBUSY or dropping lines", async () => {
        const concurrencyCount = 100;
        const promises = [];

        // Fire 100 concurrent audit logs
        for (let i = 0; i < concurrencyCount; i++) {
            promises.push(new Promise<void>((resolve) => {
                setTimeout(() => {
                    expect(() => {
                        auditLog("concurrent_test" as any, "test_actor", "concurrent_test_resource", "success" as any, { iteration: i });
                    }).not.toThrow();
                    resolve();
                }, 0);
            }));
        }

        await Promise.all(promises);

        // Give the async queue a tiny moment to flush to disk
        await new Promise(r => setTimeout(r, 100));

        const files = fs.readdirSync(testLogDir);
        expect(files.length).toBeGreaterThan(0);
        
        const logContent = fs.readFileSync(path.join(testLogDir, files[0] as string), "utf-8");
        const lines = logContent.split("\n").filter(line => line.trim().length > 0);
        
        expect(lines.length).toBe(concurrencyCount);
    });
});
