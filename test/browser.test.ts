import { describe, it, expect } from 'vitest';
import { getBrowserOpener } from '../lib/auth/browser.js';
import { PLATFORM_OPENERS } from '../lib/constants.js';

describe('Browser Module', () => {
	describe('getBrowserOpener', () => {
		it('should return correct opener for darwin', () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'darwin' });
			expect(getBrowserOpener()).toBe(PLATFORM_OPENERS.darwin);
			Object.defineProperty(process, 'platform', { value: originalPlatform });
		});

		it('should return correct opener for win32', () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'win32' });
			expect(getBrowserOpener()).toBe(PLATFORM_OPENERS.win32);
			Object.defineProperty(process, 'platform', { value: originalPlatform });
		});

		it('should return linux opener for other platforms', () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'linux' });
			expect(getBrowserOpener()).toBe(PLATFORM_OPENERS.linux);
			Object.defineProperty(process, 'platform', { value: originalPlatform });
		});

		it('should handle unknown platforms', () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'freebsd' });
			expect(getBrowserOpener()).toBe(PLATFORM_OPENERS.linux);
			Object.defineProperty(process, 'platform', { value: originalPlatform });
		});
	});
});
