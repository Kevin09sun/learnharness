/**
 * Test prep's `check_point` in the question UI (task 6): the tool is
 * explain-shaped, so the existing dock poses it and the answered card labels
 * it "Check" — but the committed answer is NEVER revealed (spec: a correct
 * answer gets a brief ✓ only). It may stay in the persisted call args, like
 * practice's hidden modelSolution; it must not reach the learner's UI.
 *
 * tsx ignores tsconfig's `jsx` field and uses the CLASSIC transform, so React
 * must be a resolvable global before this module's JSX runs (same shim as
 * tests/render-cards.test.tsx).
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AnsweredCard } from "../components/answered-card.tsx";
import { QuestionDock } from "../components/question-dock.tsx";
import {
	answerForPresentation,
	buildAnswer,
	toolQuestionKind,
	type QuestionAnswerData,
	type QuestionData,
} from "../src/core/index.ts";
import { parseQuestionInput } from "../src/core/tool-parts.ts";
import { sessionMarkdown } from "../src/core/session-markdown.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

const checkPointInput = {
	pointId: "p1",
	question: "Why does a stationary aether predict a fringe shift?",
	correctAnswer: "Because motion through it changes the round-trip time by a measurable amount.",
	details: "Short answer.",
};

function checkPointQD(): QuestionData {
	return {
		id: "c1",
		kind: "explain",
		question: checkPointInput.question,
		mode: "text",
		options: [],
		committedAnswer: checkPointInput.correctAnswer,
		createdAt: new Date().toISOString(),
	};
}

/** A persisted check_point answer record — committed set, as a leak-prone
 *  record would carry it. The card must suppress it on its own. */
function answeredCheckPoint(overrides: Partial<QuestionAnswerData> = {}): QuestionAnswerData {
	return {
		kind: "explain",
		tool: "check_point",
		questionText: checkPointInput.question,
		options: [],
		dontKnow: false,
		answers: [],
		text: "Because aether motion changes the round-trip time.",
		committed: "Because motion through it changes the round-trip time by a measurable amount.",
		answeredAt: new Date().toISOString(),
		...overrides,
	};
}

describe("test prep: check_point is explain-shaped", () => {
	it('maps to the "explain" question kind', () => {
		assert.equal(toolQuestionKind("check_point"), "explain");
	});

	it("parses the recorded call input for the dock (pointId is not a display field)", () => {
		const parsed = parseQuestionInput("check_point", checkPointInput);
		assert.ok(parsed, "a check_point call is not malformed");
		assert.equal(parsed.question, checkPointInput.question);
		assert.ok("correctAnswer" in parsed, "explain-shaped, not ask-shaped");
		assert.equal(parsed.correctAnswer, checkPointInput.correctAnswer);
		assert.equal((parsed as { pointId?: string }).pointId, undefined);
	});

	it('the dock poses it labeled "Check" and never shows the commitment', () => {
		const html = renderToStaticMarkup(
			<QuestionDock
				toolName="check_point"
				toolCallId="c1"
				input={checkPointInput as never}
				expanded={true}
				onExpand={() => {}}
				onSubmit={() => {}}
			/>,
		);
		assert.match(html, /Check/);
		assert.match(html, /Why does a stationary aether predict a fringe shift\?/);
		assert.ok(!html.includes(checkPointInput.correctAnswer), "the committed answer never renders in the dock");
	});
});

describe("test prep: no answer reveal", () => {
	it('renders a check_point answer as "Check" with no "The answer:" block', () => {
		const html = renderToStaticMarkup(<AnsweredCard answer={answeredCheckPoint()} />);
		assert.match(html, /Check/);
		assert.match(html, /Because aether motion changes the round-trip time\./);
		assert.ok(!html.includes("The answer:"), "the commitment is never revealed");
		assert.ok(!html.includes(checkPointInput.correctAnswer), "the committed answer never reaches the card");
	});

	it("a recall card still reveals its committed answer (unchanged)", () => {
		const html = renderToStaticMarkup(
			<AnsweredCard answer={answeredCheckPoint({ tool: "recall", committed: "The committed recall answer." })} />,
		);
		assert.match(html, /Recall/);
		assert.match(html, /The answer:/);
		assert.match(html, /The committed recall answer\./);
	});

	it("a teach explain card still reveals its committed answer (unchanged)", () => {
		const html = renderToStaticMarkup(
			<AnsweredCard answer={answeredCheckPoint({ tool: "explain", committed: "The committed explain answer." })} />,
		);
		assert.match(html, /Explain/);
		assert.match(html, /The answer:/);
		assert.match(html, /The committed explain answer\./);
	});
});

describe("test prep: the commitment is dropped at the core presentation seams", () => {
	it("buildAnswer does not snapshot it for check_point", () => {
		const answer = buildAnswer(checkPointQD(), { text: "his own words" }, "check_point");
		assert.equal(answer.kind, "explain");
		assert.equal(answer.text, "his own words");
		assert.equal(answer.committed, undefined);
	});

	it("buildAnswer still snapshots it for recall (unchanged)", () => {
		const answer = buildAnswer(checkPointQD(), { text: "his own words" }, "recall");
		assert.equal(answer.committed, checkPointInput.correctAnswer);
	});

	it("answerForPresentation drops a stale commitment on a check_point answer", () => {
		const projected = answerForPresentation(answeredCheckPoint(), checkPointInput);
		assert.equal(projected.questionText, checkPointInput.question);
		assert.equal(projected.committed, undefined);
	});

	it("answerForPresentation still projects it for recall (unchanged)", () => {
		const projected = answerForPresentation(answeredCheckPoint({ tool: "recall" }), checkPointInput);
		assert.equal(projected.committed, checkPointInput.correctAnswer);
	});
});

describe("test prep: session markdown export", () => {
	it("shows the check_point answer and never the commitment", () => {
		const messages = [
			{
				id: "a1",
				role: "assistant",
				content: [{ type: "toolCall", id: "cp1", name: "check_point", arguments: checkPointInput }],
				api: "openai-completions",
				provider: "openrouter",
				model: "test",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				stopReason: "stop",
				timestamp: Date.now(),
			},
			{
				id: "r1",
				role: "toolResult",
				toolCallId: "cp1",
				toolName: "check_point",
				content: [{ type: "text", text: "ok" }],
				details: answeredCheckPoint(),
				isError: false,
				timestamp: Date.now(),
			},
		] as unknown as LhMessage[];
		const md = sessionMarkdown(messages);
		assert.match(md, /### Check/);
		assert.match(md, /The learner answered in his own words: Because aether motion changes the round-trip time\./);
		assert.ok(!md.includes(checkPointInput.correctAnswer), "the export never reveals the commitment");
	});
});