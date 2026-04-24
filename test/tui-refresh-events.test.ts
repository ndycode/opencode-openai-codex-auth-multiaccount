import { describe, expect, it } from "vitest";
import type { Event } from "@opencode-ai/sdk/v2";

import { shouldRefreshQuotaForEvent } from "../tui.js";

const tokens = {
	input: 10,
	output: 4,
	reasoning: 2,
	cache: {
		read: 0,
		write: 0,
	},
};

describe("TUI quota refresh events", () => {
	it("refreshes after assistant completion and model step finish", () => {
		const assistantCompleted = {
			type: "message.updated",
			properties: {
				sessionID: "ses_1",
				info: {
					id: "msg_1",
					sessionID: "ses_1",
					role: "assistant",
					time: { created: 1, completed: 2 },
					parentID: "msg_0",
					modelID: "gpt-5.5",
					providerID: "openai",
					mode: "build",
					agent: "build",
					path: { cwd: "C:\\repo", root: "C:\\repo" },
					cost: 0,
					tokens,
				},
			},
		} satisfies Extract<Event, { type: "message.updated" }>;

		const stepFinish = {
			type: "message.part.updated",
			properties: {
				sessionID: "ses_1",
				time: 2,
				part: {
					id: "part_1",
					sessionID: "ses_1",
					messageID: "msg_1",
					type: "step-finish",
					reason: "tool",
					cost: 0,
					tokens,
				},
			},
		} satisfies Extract<Event, { type: "message.part.updated" }>;

		expect(shouldRefreshQuotaForEvent(assistantCompleted)).toBe(true);
		expect(shouldRefreshQuotaForEvent(stepFinish)).toBe(true);
	});

	it("refreshes after tool completion and session idle", () => {
		const toolCompleted = {
			type: "message.part.updated",
			properties: {
				sessionID: "ses_1",
				time: 3,
				part: {
					id: "part_2",
					sessionID: "ses_1",
					messageID: "msg_1",
					type: "tool",
					callID: "call_1",
					tool: "bash",
					state: {
						status: "completed",
						input: {},
						output: "ok",
						title: "bash",
						metadata: {},
						time: { start: 2, end: 3 },
					},
				},
			},
		} satisfies Extract<Event, { type: "message.part.updated" }>;

		const idleStatus = {
			type: "session.status",
			properties: {
				sessionID: "ses_1",
				status: { type: "idle" },
			},
		} satisfies Extract<Event, { type: "session.status" }>;

		expect(shouldRefreshQuotaForEvent(toolCompleted)).toBe(true);
		expect(shouldRefreshQuotaForEvent(idleStatus)).toBe(true);
	});

	it("does not refresh for streaming text or busy status", () => {
		const textPart = {
			type: "message.part.updated",
			properties: {
				sessionID: "ses_1",
				time: 1,
				part: {
					id: "part_3",
					sessionID: "ses_1",
					messageID: "msg_1",
					type: "text",
					text: "hello",
				},
			},
		} satisfies Extract<Event, { type: "message.part.updated" }>;

		const busyStatus = {
			type: "session.status",
			properties: {
				sessionID: "ses_1",
				status: { type: "busy" },
			},
		} satisfies Extract<Event, { type: "session.status" }>;

		expect(shouldRefreshQuotaForEvent(textPart)).toBe(false);
		expect(shouldRefreshQuotaForEvent(busyStatus)).toBe(false);
	});
});
