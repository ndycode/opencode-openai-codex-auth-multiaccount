import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

vi.mock("node:fs", () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
	statSync: vi.fn(),
}));

import { existsSync, readFileSync, statSync } from "node:fs";
import {
	getConfigDir,
	getProjectConfigDir,
	getProjectGlobalConfigDir,
	getProjectStorageKey,
	getProjectStorageKeyCandidates,
	isProjectDirectory,
	findProjectRoot,
	resolvePath,
} from "../lib/storage/paths.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedStatSync = vi.mocked(statSync);
const originalPlatform = process.platform;

describe("Storage Paths Module", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform });
		vi.resetAllMocks();
	});

	describe("getConfigDir", () => {
		it("should return ~/.opencode", () => {
			const result = getConfigDir();
			expect(result).toBe(path.join(homedir(), ".opencode"));
		});
	});

	describe("getProjectConfigDir", () => {
		it("should return project path with .opencode appended", () => {
			const projectPath = "/home/user/myproject";
			const result = getProjectConfigDir(projectPath);
			expect(result).toBe(path.join(projectPath, ".opencode"));
		});

		it("should handle Windows-style paths", () => {
			const projectPath = "C:\\Users\\test\\project";
			const result = getProjectConfigDir(projectPath);
			expect(result).toBe(path.join(projectPath, ".opencode"));
		});
	});

	describe("getProjectStorageKey", () => {
		it("returns deterministic key for same project path", () => {
			const projectPath = "/home/user/myproject";
			const first = getProjectStorageKey(projectPath);
			const second = getProjectStorageKey(projectPath);
			expect(first).toBe(second);
			expect(first).toMatch(/^myproject-[a-f0-9]{12}$/);
		});

		it("preserves the legacy lowercase key prefix on Windows paths", () => {
			Object.defineProperty(process, "platform", { value: "win32" });
			const projectPath = "C:\\Users\\Test\\MyProject";
			expect(getProjectStorageKey(projectPath)).toMatch(/^myproject-[a-f0-9]{12}$/);
		});

		it("uses the canonical git identity for same-repo worktrees", () => {
			const mainWorktree = "C:\\Users\\neil\\DevTools\\oc-chatgpt-multi-auth";
			const branchWorktree = "C:\\Users\\neil\\DevTools\\oc-chatgpt-multi-auth-sync-worktree";
			const mainGitPath = `${mainWorktree}\\.git`.toLowerCase();
			const branchGitPath = `${branchWorktree}\\.git`.toLowerCase();
			const sharedGitFile = "gitdir: C:/Users/neil/DevTools/oc-chatgpt-multi-auth/.git/worktrees/feature-sync\n";
			mockedExistsSync.mockImplementation((candidate) => {
				const normalized = String(candidate).replace(/\//g, "\\").toLowerCase();
				return normalized === mainGitPath || normalized === branchGitPath;
			});
			mockedStatSync.mockImplementation((candidate) => {
				const normalized = String(candidate).replace(/\//g, "\\").toLowerCase();
				return {
					isDirectory: () => normalized === mainGitPath,
				} as ReturnType<typeof statSync>;
			});
			mockedReadFileSync.mockImplementation((candidate) => {
				const normalized = String(candidate).replace(/\//g, "\\").toLowerCase();
				if (normalized === branchGitPath) {
					return sharedGitFile;
				}
				throw new Error(`unexpected read: ${String(candidate)}`);
			});

			expect(getProjectStorageKey(mainWorktree)).toBe(getProjectStorageKey(branchWorktree));
		});
	});

	describe("getProjectStorageKeyCandidates", () => {
		it("returns a shared canonical key for same-repo worktrees before the legacy fallback", () => {
			const mainWorktree = "C:\\Users\\neil\\DevTools\\oc-chatgpt-multi-auth";
			const branchWorktree = "C:\\Users\\neil\\DevTools\\oc-chatgpt-multi-auth-sync-worktree";
			const mainGitPath = `${mainWorktree}\\.git`.toLowerCase();
			const branchGitPath = `${branchWorktree}\\.git`.toLowerCase();
			const sharedGitFile = "gitdir: C:/Users/neil/DevTools/oc-chatgpt-multi-auth/.git/worktrees/feature-sync\n";
			mockedExistsSync.mockImplementation((candidate) => {
				const normalized = String(candidate).replace(/\//g, "\\").toLowerCase();
				return normalized === mainGitPath || normalized === branchGitPath;
			});
			mockedStatSync.mockImplementation((candidate) => {
				const normalized = String(candidate).replace(/\//g, "\\").toLowerCase();
				return {
					isDirectory: () => normalized === mainGitPath,
				} as ReturnType<typeof statSync>;
			});
			mockedReadFileSync.mockImplementation((candidate) => {
				const normalized = String(candidate).replace(/\//g, "\\").toLowerCase();
				if (normalized === branchGitPath) {
					return sharedGitFile;
				}
				throw new Error(`unexpected read: ${String(candidate)}`);
			});

			const mainCandidates = getProjectStorageKeyCandidates(mainWorktree);
			const branchCandidates = getProjectStorageKeyCandidates(branchWorktree);

			expect(mainCandidates[0]).toBe(branchCandidates[0]);
			expect(mainCandidates[1]).not.toBe(branchCandidates[1]);
		});
	});

	describe("getProjectGlobalConfigDir", () => {
		it("returns ~/.opencode/projects/<key>", () => {
			const projectPath = "/home/user/myproject";
			const result = getProjectGlobalConfigDir(projectPath);
			expect(result).toContain(path.join(homedir(), ".opencode", "projects"));
			expect(result).toContain("myproject-");
		});
	});

	describe("isProjectDirectory", () => {
		const markers = [".git", "package.json", "Cargo.toml", "go.mod", "pyproject.toml", ".opencode"];

		it.each(markers)("should return true when %s exists", (marker) => {
			mockedExistsSync.mockImplementation((p) => {
				return typeof p === "string" && p.endsWith(marker);
			});
			const result = isProjectDirectory("/test/project");
			expect(result).toBe(true);
		});

		it("should return false when no project markers exist", () => {
			mockedExistsSync.mockReturnValue(false);
			const result = isProjectDirectory("/test/random");
			expect(result).toBe(false);
		});

		it("should check multiple markers", () => {
			mockedExistsSync.mockReturnValue(false);
			isProjectDirectory("/test/dir");
			expect(mockedExistsSync).toHaveBeenCalledTimes(markers.length);
		});
	});

	describe("findProjectRoot", () => {
		it("should return the directory if it is a project root", () => {
			mockedExistsSync.mockImplementation((p) => {
				return typeof p === "string" && p.includes(".git");
			});
			const result = findProjectRoot("/home/user/myproject");
			expect(result).toBe("/home/user/myproject");
		});

		it("should walk up the directory tree to find project root", () => {
			mockedExistsSync.mockImplementation((p) => {
				return typeof p === "string" && p === path.join("/home/user", ".git");
			});
			const result = findProjectRoot("/home/user/myproject/src/lib");
			expect(result).toBe("/home/user");
		});

		it("should return null when no project root found", () => {
			mockedExistsSync.mockReturnValue(false);
			const result = findProjectRoot("/some/random/path");
			expect(result).toBeNull();
		});

		it("should handle root directory correctly", () => {
			mockedExistsSync.mockReturnValue(false);
			const root = path.parse(process.cwd()).root;
			const result = findProjectRoot(root);
			expect(result).toBeNull();
		});

		it("should stop at filesystem root", () => {
			mockedExistsSync.mockReturnValue(false);
			const callCount = mockedExistsSync.mock.calls.length;
			findProjectRoot("/a/b/c/d/e");
			expect(mockedExistsSync.mock.calls.length).toBeGreaterThan(callCount);
		});

		it("returns the filesystem root when it contains a project marker", () => {
			const root = path.parse(process.cwd()).root;
			mockedExistsSync.mockImplementation((p) => {
				return typeof p === "string" && p === path.join(root, ".git");
			});
			const nestedPath = path.join(root, "workspace", "repo", "src");
			expect(findProjectRoot(nestedPath)).toBe(root);
		});
	});

	describe("resolvePath", () => {
		it("should expand tilde to home directory", () => {
			const result = resolvePath("~/.opencode/config.json");
			expect(result).toBe(path.join(homedir(), ".opencode/config.json"));
		});

		it("should resolve relative paths", () => {
			const cwd = process.cwd();
			const result = resolvePath("./test.json");
			expect(result).toBe(path.resolve(cwd, "./test.json"));
		});

		it("should accept paths within home directory", () => {
			const homePath = path.join(homedir(), "projects", "myapp");
			expect(() => resolvePath(homePath)).not.toThrow();
		});

		it("should accept paths within current working directory", () => {
			const cwdPath = path.join(process.cwd(), "subdir", "file.txt");
			expect(() => resolvePath(cwdPath)).not.toThrow();
		});

		it("should accept paths within temp directory", () => {
			const tempPath = path.join(tmpdir(), "test-file.json");
			expect(() => resolvePath(tempPath)).not.toThrow();
		});

		it("should throw for paths outside allowed directories", () => {
			const outsidePath = "/definitely/not/allowed/path";
			
			if (process.platform === "win32") {
				return;
			}
			
			const home = homedir();
			const cwd = process.cwd();
			const tmp = tmpdir();
			
			if (!outsidePath.startsWith(home) && !outsidePath.startsWith(cwd) && !outsidePath.startsWith(tmp)) {
				expect(() => resolvePath(outsidePath)).toThrow("Access denied");
			}
		});

		it("rejects lookalike prefix paths outside home directory", () => {
			const home = homedir();
			const parent = path.dirname(home);
			const outsideLookalike = path.join(parent, `${path.basename(home)}-outside`, "file.json");
			expect(() => resolvePath(outsideLookalike)).toThrow("Access denied");
		});

		it("rejects lookalike prefix paths outside current working directory", () => {
			const cwd = process.cwd();
			const parent = path.dirname(cwd);
			const outsideLookalike = path.join(parent, `${path.basename(cwd)}-outside`, "file.json");
			const home = homedir();
			const tmp = tmpdir();
			if (
				outsideLookalike.startsWith(home) ||
				outsideLookalike.startsWith(tmp) ||
				outsideLookalike.startsWith(cwd)
			) {
				return;
			}
			expect(() => resolvePath(outsideLookalike)).toThrow("Access denied");
		});

		it("should handle tilde-only path", () => {
			const result = resolvePath("~");
			expect(result).toBe(homedir());
		});

		it("should handle paths with tilde in subdirectory", () => {
			const result = resolvePath("~/subdir/deep/path");
			expect(result).toBe(path.join(homedir(), "subdir/deep/path"));
		});
	});
});
