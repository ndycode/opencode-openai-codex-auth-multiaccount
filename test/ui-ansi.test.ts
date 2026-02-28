import { afterEach, describe, expect, it } from 'vitest';
import { isTTY, parseKey } from '../lib/ui/ansi.js';

const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

function setTtyState(stdin: boolean, stdout: boolean): void {
	Object.defineProperty(process.stdin, 'isTTY', {
		value: stdin,
		configurable: true,
	});
	Object.defineProperty(process.stdout, 'isTTY', {
		value: stdout,
		configurable: true,
	});
}

function restoreTtyState(): void {
	if (stdinDescriptor) {
		Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
	} else {
		delete (process.stdin as { isTTY?: boolean }).isTTY;
	}
	if (stdoutDescriptor) {
		Object.defineProperty(process.stdout, 'isTTY', stdoutDescriptor);
	} else {
		delete (process.stdout as { isTTY?: boolean }).isTTY;
	}
}

describe('ui ansi helpers', () => {
	afterEach(() => {
		restoreTtyState();
	});

	it('parses up/down arrows, enter, and escape actions', () => {
		expect(parseKey(Buffer.from('\x1b[A'))).toBe('up');
		expect(parseKey(Buffer.from('\x1bOA'))).toBe('up');
		expect(parseKey(Buffer.from('\x1b[B'))).toBe('down');
		expect(parseKey(Buffer.from('\x1bOB'))).toBe('down');
		expect(parseKey(Buffer.from('\r'))).toBe('enter');
		expect(parseKey(Buffer.from('\n'))).toBe('enter');
		expect(parseKey(Buffer.from('\x03'))).toBe('escape');
		expect(parseKey(Buffer.from('\x1b'))).toBe('escape-start');
		expect(parseKey(Buffer.from('x'))).toBeNull();
	});

	it('detects tty availability from stdin and stdout', () => {
		setTtyState(true, true);
		expect(isTTY()).toBe(true);

		setTtyState(false, true);
		expect(isTTY()).toBe(false);

		setTtyState(true, false);
		expect(isTTY()).toBe(false);
	});
});
