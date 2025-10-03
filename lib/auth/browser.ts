/**
 * Browser utilities for OAuth flow
 * Handles platform-specific browser opening
 */

import { spawn } from "node:child_process";
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

/**
 * Opens a URL in the default browser
 * Silently fails if browser cannot be opened (user can copy URL manually)
 * @param url - URL to open
 */
export function openBrowserUrl(url: string): void {
	try {
		const opener = getBrowserOpener();
		spawn(opener, [url], {
			stdio: "ignore",
			shell: process.platform === "win32",
		});
	} catch (error) {
		// Silently fail - user can manually open the URL from instructions
	}
}
