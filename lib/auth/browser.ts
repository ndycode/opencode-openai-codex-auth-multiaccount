/**
 * Browser utilities for OAuth flow
 * Handles platform-specific browser opening
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PLATFORM_OPENERS } from "../constants.js";

/**
 * Gets the platform-specific command to open a URL in the default browser
 * @returns Browser opener command for the current platform
 */
export function getBrowserOpener(): string {
	const platform = process.platform;
	if (platform === "darwin") return PLATFORM_OPENERS.darwin;
	if (platform === "win32") return PLATFORM_OPENERS.win32;
	return PLATFORM_OPENERS.linux;
}

function commandExists(command: string): boolean {
	if (!command) return false;

	/* v8 ignore start -- unreachable: openBrowserUrl uses PowerShell on win32 */
	if (process.platform === "win32" && command.toLowerCase() === "start") {
		return true;
	}
	/* v8 ignore stop */

	const pathValue = process.env.PATH || "";
	const entries = pathValue.split(path.delimiter).filter(Boolean);
	if (entries.length === 0) return false;

	/* v8 ignore start -- unreachable: openBrowserUrl uses PowerShell on win32 */
			if (process.platform === "win32") {
			// Prevent RCE by passing the URL as an argument instead of interpolating into the Command string
			const child = spawn(
				"powershell.exe",
				["-NoLogo", "-NoProfile", "-Command", "Start-Process $args[0]", url],
				{ stdio: "ignore" },
			);
			child.on("error", () => {});
			return true;
		}


		const opener = getBrowserOpener();
		if (!commandExists(opener)) {
			return false;
		}
		const child = spawn(opener, [url], {
			stdio: "ignore",
			shell: false,
		});
		child.on("error", () => {});
		return true;
	} catch {
		// Silently fail - user can manually open the URL from instructions
		return false;
	}
}

