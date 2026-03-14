type CleanupFn = () => void | Promise<void>;

const cleanupFunctions: CleanupFn[] = [];
let shutdownRegistered = false;
let sigintHandler: (() => void) | null = null;
let sigtermHandler: (() => void) | null = null;
let beforeExitHandler: (() => void) | null = null;

export function registerCleanup(fn: CleanupFn): void {
	cleanupFunctions.push(fn);
	ensureShutdownHandler();
}

export function unregisterCleanup(fn: CleanupFn): void {
	const index = cleanupFunctions.indexOf(fn);
	if (index !== -1) {
		cleanupFunctions.splice(index, 1);
	}
}

export async function runCleanup(): Promise<void> {
	const fns = [...cleanupFunctions];
	cleanupFunctions.length = 0;
	removeShutdownHandlers();
	shutdownRegistered = false;

	for (const fn of fns) {
		try {
			await fn();
		} catch {
			// Ignore cleanup errors during shutdown
		}
	}
}

function ensureShutdownHandler(): void {
	if (shutdownRegistered) return;
	shutdownRegistered = true;

	const handleSignal = () => {
		void runCleanup().finally(() => {
			process.exit(0);
		});
	};
	sigintHandler = handleSignal;
	sigtermHandler = handleSignal;
	beforeExitHandler = () => {
		void runCleanup();
	};

	process.once("SIGINT", sigintHandler);
	process.once("SIGTERM", sigtermHandler);
	process.once("beforeExit", beforeExitHandler);
}

function removeShutdownHandlers(): void {
	if (sigintHandler) {
		process.off("SIGINT", sigintHandler);
		sigintHandler = null;
	}
	if (sigtermHandler) {
		process.off("SIGTERM", sigtermHandler);
		sigtermHandler = null;
	}
	if (beforeExitHandler) {
		process.off("beforeExit", beforeExitHandler);
		beforeExitHandler = null;
	}
}

export function getCleanupCount(): number {
	return cleanupFunctions.length;
}
