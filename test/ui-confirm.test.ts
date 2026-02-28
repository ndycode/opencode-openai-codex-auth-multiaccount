import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createUiTheme } from '../lib/ui/theme.js';
import { confirm } from '../lib/ui/confirm.js';
import { select } from '../lib/ui/select.js';
import { getUiRuntimeOptions } from '../lib/ui/runtime.js';

vi.mock('../lib/ui/select.js', () => ({
	select: vi.fn(),
}));

vi.mock('../lib/ui/runtime.js', () => ({
	getUiRuntimeOptions: vi.fn(),
}));

describe('ui confirm', () => {
	beforeEach(() => {
		vi.mocked(select).mockReset();
		vi.mocked(getUiRuntimeOptions).mockReset();
	});

	it('uses legacy variant with No/Yes order by default', async () => {
		vi.mocked(getUiRuntimeOptions).mockReturnValue({
			v2Enabled: false,
			colorProfile: 'ansi16',
			glyphMode: 'ascii',
			theme: createUiTheme({ profile: 'ansi16', glyphMode: 'ascii' }),
		});
		vi.mocked(select).mockResolvedValueOnce(true);

		const result = await confirm('Delete account?');

		expect(result).toBe(true);
		expect(vi.mocked(select)).toHaveBeenCalledWith(
			[
				{ label: 'No', value: false },
				{ label: 'Yes', value: true },
			],
			expect.objectContaining({
				message: 'Delete account?',
				variant: 'legacy',
			}),
		);
	});

	it('uses codex variant and Yes/No order when defaultYes=true', async () => {
		vi.mocked(getUiRuntimeOptions).mockReturnValue({
			v2Enabled: true,
			colorProfile: 'truecolor',
			glyphMode: 'ascii',
			theme: createUiTheme({ profile: 'truecolor', glyphMode: 'ascii' }),
		});
		vi.mocked(select).mockResolvedValueOnce(false);

		const result = await confirm('Continue?', true);

		expect(result).toBe(false);
		expect(vi.mocked(select)).toHaveBeenCalledWith(
			[
				{ label: 'Yes', value: true },
				{ label: 'No', value: false },
			],
			expect.objectContaining({
				message: 'Continue?',
				variant: 'codex',
			}),
		);
	});

	it('returns false when selection is cancelled', async () => {
		vi.mocked(getUiRuntimeOptions).mockReturnValue({
			v2Enabled: true,
			colorProfile: 'truecolor',
			glyphMode: 'ascii',
			theme: createUiTheme({ profile: 'truecolor', glyphMode: 'ascii' }),
		});
		vi.mocked(select).mockResolvedValueOnce(null);

		const result = await confirm('Cancel me?');

		expect(result).toBe(false);
	});
});
