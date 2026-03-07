export const UI_COPY = {
	mainMenu: {
		title: "Accounts Dashboard",
		searchSubtitlePrefix: "Search:",
		quickStart: "Quick Actions",
		addAccount: "Add New Account",
		checkAccounts: "Run Health Check",
		bestAccount: "Pick Best Account",
		fixIssues: "Auto-Repair Issues",
		settings: "Settings",
		moreChecks: "Advanced Checks",
		refreshChecks: "Refresh All Accounts",
		checkFlagged: "Check Problem Accounts",
		accounts: "Saved Accounts",
		noSearchMatches: "No accounts match your search",
		dangerZone: "Danger Zone",
		removeAllAccounts: "Delete All Accounts",
		helpCompact: "↑↓ Move | Enter Select | / Search | 1-9 Switch | Q Back",
		helpDetailed: "Arrow keys move, Enter selects, / searches, 1-9 switches account, Q goes back",
	},
	accountDetails: {
		back: "Back",
		enable: "Enable Account",
		disable: "Disable Account",
		setCurrent: "Set As Current",
		refresh: "Re-Login",
		remove: "Delete Account",
		help: "↑↓ Move | Enter Select | S Use | R Sign In | D Delete | Q Back",
	},
	settings: {
		title: "Settings",
		subtitle: "Manage sync and cleanup options",
		help: "↑↓ Move | Enter Select | Q Back",
		syncToggle: "Sync from codex-multi-auth",
		syncNow: "Sync Now",
		cleanupOverlaps: "Cleanup Synced Overlaps",
		back: "Back",
	},
	syncPrune: {
		title: "Prepare Sync",
		subtitle: (neededCount: number) => `Select ${neededCount} account(s) to remove before syncing`,
		help: "↑↓ Move | Enter Toggle | Space Toggle | C Continue | Q Cancel",
		selected: "selected",
		current: "current",
		confirm: "Continue With Selected Accounts",
		cancel: "Cancel",
	},
	fallback: {
		addAnotherTip: "Tip: Use private mode or sign out before adding another account.",
		addAnotherQuestion: (count: number) => `Add another account? (${count} added) (y/n): `,
		selectModePrompt:
			"(a) add, (c) check, (b) best, fi(x), (s) settings, (d) deep, (g) problem, (f) fresh, (q) back [a/c/b/x/s/d/g/f/q]: ",
		invalidModePrompt: "Use one of: a, c, b, x, s, d, g, f, q.",
	},
} as const;

export function formatCheckFlaggedLabel(flaggedCount: number): string {
	return flaggedCount > 0
		? `${UI_COPY.mainMenu.checkFlagged} (${flaggedCount})`
		: UI_COPY.mainMenu.checkFlagged;
}
