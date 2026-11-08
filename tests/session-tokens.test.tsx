/**
 * The per-session token counter: everything a session caused (teacher turns,
 * context compaction, graph extraction, background agents), as one processed
 * total plus its split into output, new input and cache reads.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { sessionTokens, type TokenTotals } from "../src/core/session-tokens.ts";
import { tokenBreakdown } from "../components/usage-format.ts";
import { SessionRow } from "../components/sidebar.tsx";
import { StatsBar } from "../components/stats-bar.tsx";
import { chatTokens } from "../src/server/session-tokens.ts";
import { chatStore } from "../src/store/chats.ts";
import { jobStore } from "../src/store/jobs.ts";
import type { CallUsage, ChatListItem, JobUsage, TurnUsage } from "../src/core/index.ts";

function call(input: number, output: number, cacheRead: number, cacheWrite: number): CallUsage {
	return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, reasoningTokens: undefined };
}
function turn(id: string, steps: CallUsage[]): TurnUsage {
	return { id, messageId: `m-${id}`, at: "2026-11-07T00:00:00.000Z", model: "claude-code:opus", steps };
}
function jobUsage(input: number, output: number, cacheRead: number, cacheWrite: number): JobUsage {
	return { model: "claude-code:haiku", inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, reasoningTokens: undefined, steps: 1 };
}
const zero: TokenTotals = { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

describe("sessionTokens", () => {
	it("an empty session used nothing", () => {
		assert.deepEqual(sessionTokens({}), zero);
	});

	it("adds every step of every teacher turn, compaction included", () => {
		const totals = sessionTokens({ turns: [
			turn("a", [call(2, 473, 0, 11242), call(0, 0, 0, 0)]),
			turn("compaction-marker", [call(5, 300, 1000, 0)]),
		] });
		assert.deepEqual(totals, { total: 2 + 473 + 11242 + 5 + 300 + 1000, input: 7, output: 773, cacheRead: 1000, cacheWrite: 11242 });
	});

	it("includes both graph extraction stages", () => {
		const totals = sessionTokens({ extractions: [{
			startedAt: 1, at: "2026-11-07T00:00:00.000Z", durationMs: 10,
			stages: { extractor: { model: "m", steps: [call(10, 20, 0, 0)] }, auditor: { model: "m", steps: [call(1, 2, 3, 4)] } },
		}] });
		assert.deepEqual(totals, { total: 40, input: 11, output: 22, cacheRead: 3, cacheWrite: 4 });
	});

	it("includes background agents, skipping jobs that never reported usage", () => {
		const totals = sessionTokens({}, [{ usage: jobUsage(100, 50, 25, 5) }, { usage: undefined }]);
		assert.deepEqual(totals, { total: 180, input: 100, output: 50, cacheRead: 25, cacheWrite: 5 });
	});

	it("unreported fields count as zero, never NaN", () => {
		const totals = sessionTokens({ turns: [turn("a", [{ inputTokens: undefined, outputTokens: 7, cacheReadTokens: undefined, cacheWriteTokens: undefined, reasoningTokens: 3 }])] });
		assert.deepEqual(totals, { total: 7, input: 0, output: 7, cacheRead: 0, cacheWrite: 0 });
	});
});

describe("tokenBreakdown", () => {
	it("splits output, new input (fresh + newly cached) and cache reads", () => {
		const text = tokenBreakdown({ total: 145057, input: 20, output: 6274, cacheRead: 108481, cacheWrite: 30282 });
		assert.equal(text, "145.1k tokens used: 6.3k output, 30.3k new input, 108.5k cache reads. Includes background agents.");
	});
});

describe("chatTokens (server)", () => {
	const created: string[] = [];
	after(() => { for (const id of created) chatStore.deleteChat(id); });

	it("joins the session record with its background jobs", () => {
		const chat = chatStore.createChat("token counter test");
		created.push(chat.id);
		chatStore.appendTurnUsage(chat.id, turn("t1", [call(10, 20, 30, 40)]));
		const job = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "tc1" });
		jobStore.updateJob(job.id, { usage: jobUsage(1, 2, 3, 4) });
		assert.deepEqual(chatTokens(chat.id), { total: 110, input: 11, output: 22, cacheRead: 33, cacheWrite: 44 });
	});

	it("an unknown session is null", () => {
		assert.equal(chatTokens("chat_missing"), null);
	});
});

describe("sidebar row", () => {
	const item = (tokens: TokenTotals | undefined): ChatListItem => ({
		id: "c1", title: "Session", kind: "teach", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
		messageCount: 4, phase: "probe", pendingQuestion: true, pendingProblem: false, busy: false, compacting: false, tokens,
	});
	const render = (chat: ChatListItem) => renderToStaticMarkup(<SessionRow chat={chat} active={false} onOpen={() => {}} />);

	it("shows the running total after the status, with the split on hover", () => {
		const html = render(item({ total: 145057, input: 20, output: 6274, cacheRead: 108481, cacheWrite: 30282 }));
		assert.match(html, /Waiting for input · [^<]*· 145\.1k tokens/);
		assert.match(html, /title="145\.1k tokens used: 6\.3k output, 30\.3k new input, 108\.5k cache reads\. Includes background agents\."/);
	});

	it("shows nothing for a session that has not used any tokens yet", () => {
		assert.doesNotMatch(render(item(zero)), /tokens/);
		assert.doesNotMatch(render(item(undefined)), /tokens/);
	});
});

describe("stats bar", () => {
	it("shows the session's running total in the summary", () => {
		const html = renderToStaticMarkup(
			<StatsBar chatId="c1" turns={[turn("a", [call(2, 473, 0, 11242)])]} tokens={{ total: 145057, input: 20, output: 6274, cacheRead: 108481, cacheWrite: 30282 }} />,
		);
		assert.match(html, /data-testid="stats-tokens"[^>]*title="145\.1k tokens used: [^"]*"[^>]*>145\.1k tokens</);
	});

	it("leaves it out until the session has used tokens", () => {
		const html = renderToStaticMarkup(<StatsBar chatId="c1" turns={[]} />);
		assert.doesNotMatch(html, /stats-tokens/);
	});
});
