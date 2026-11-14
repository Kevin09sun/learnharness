/**
 * AP's `ap_mcq` in the question UI (stage 1, task 9): the tool is
 * quiz-shaped, so the existing dock poses it — but the verdict is the
 * tutor's, never the client's. The dock shows the four options, the
 * reasoning field and "I don't know" with NO confidence slider; the
 * answered card shows the question, the options with the learner's pick in
 * neutral styling and the reasoning — no correct/incorrect chip, no
 * green/red option marking, no "Why" control, no confidence rail. The
 * call's `correctAnswer` and `optionNotes` are the model's commitment and
 * never reach either surface (stage 1 global constraint).
 *
 * tsx ignores tsconfig's `jsx` field and uses the CLASSIC transform, so React
 * must be a resolvable global before this module's JSX runs (same shim as
 * tests/test-prep-question-ui.test.tsx).
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AnsweredCard } from "../components/answered-card.tsx";
import { QuestionDock } from "../components/question-dock.tsx";
import type { QuestionAnswerData, QuestionFormDraft } from "../src/core/index.ts";

const apMcqInput = {
	topicId: "1.1",
	question: "Which expression is the derivative of x²?",
	options: [
		{ label: "2x", value: "2x" },
		{ label: "x", value: "x" },
		{ label: "x²/2", value: "x^2/2" },
		{ label: "2", value: "2" },
	],
	correctAnswer: "2x",
	optionNotes: [
		"Right answer: the power rule gives 2x.",
		"Wrong answer: the factor of two is dropped.",
		"Wrong answer: that is the antiderivative, not the derivative.",
		"Wrong answer: that is the derivative of 2x.",
	],
	details: "Use the power rule: d/dx xⁿ = n·xⁿ⁻¹.",
};

const SECRETS = [...apMcqInput.optionNotes, "A model-authored explanation."];

function renderDock(initialDraft?: QuestionFormDraft) {
	return renderToStaticMarkup(
		<QuestionDock
			toolName="ap_mcq"
			toolCallId="ap1"
			input={apMcqInput as never}
			expanded={true}
			onExpand={() => {}}
			onSubmit={() => {}}
			initialDraft={initialDraft}
		/>,
	);
}

/** A persisted ap_mcq answer record. `answers` is the learner's pick; the
 *  leak-prone fields a real record can carry are set so the card must
 *  suppress them on its own. */
function answeredApMcq(overrides: Partial<QuestionAnswerData> = {}): QuestionAnswerData {
	return {
		kind: "quiz",
		tool: "ap_mcq",
		questionText: apMcqInput.question,
		options: apMcqInput.options.map((option, i) => ({ index: i + 1, label: option.label })),
		dontKnow: false,
		answers: [{ index: 2, label: "x", value: "x" }],
		thinking: "I dropped the factor of two.",
		correct: false,
		correctIndices: [1],
		explanation: "A model-authored explanation.",
		answeredAt: new Date().toISOString(),
		...overrides,
	};
}

describe("AP: the live ap_mcq dock", () => {
	it("is quiz-shaped, labelled AP · generated, with a reasoning field and no confidence slider", () => {
		const html = renderDock();
		for (const option of apMcqInput.options) assert.ok(html.includes(option.label), `option ${option.label} renders`);
		assert.match(html, /AP · generated/);
		assert.match(html, /YOUR REASONING \(optional\)/);
		assert.match(html, /I don(?:&#x27;|'|’)t know/);
		assert.ok(!html.includes('data-testid="confidence-slider"'), "no confidence slider on an AP question");
		assert.ok(!html.includes('data-testid="confidence-track"'), "no confidence rail on an AP question");
	});

	it("labels the collapsed bar AP · generated", () => {
		const html = renderToStaticMarkup(
			<QuestionDock
				toolName="ap_mcq"
				toolCallId="ap1"
				input={apMcqInput as never}
				expanded={false}
				onExpand={() => {}}
				onSubmit={() => {}}
			/>,
		);
		assert.ok(html.includes('data-testid="question-dock-bar"'), "the collapsed bar renders");
		assert.match(html, /data-testid="question-dock-bar"[\s\S]*?AP · generated/);
	});

	it("renders the call's details", () => {
		assert.ok(renderDock().includes(apMcqInput.details));
	});

	it("never renders the commitment or the option notes", () => {
		const html = renderDock();
		for (const secret of SECRETS) assert.ok(!html.includes(secret), `kept out of the dock: ${secret}`);
		assert.ok(!html.includes("optionNotes"), "the notes are not serialized into the dock");
		assert.ok(!html.includes("correctAnswer"), "the commitment key is not serialized into the dock");
	});

	it("submits with only a pick, but not with nothing picked", () => {
		const draft: QuestionFormDraft = {
			selection: { selected: new Set([0]), otherSelected: false, dontKnow: false },
			thinking: "",
			other: "",
			text: "",
			confidenceIndex: 2,
		};
		assert.match(renderDock(), /<button[^>]*type="submit"[^>]*disabled=""/);
		assert.ok(
			!/<button[^>]*type="submit"[^>]*disabled=""/.test(renderDock(draft)),
			"a pick is a complete answer",
		);
	});
});

describe("AP: the answered ap_mcq card withholds the verdict", () => {
	it("renders no correct/incorrect chip, no Why control, no confidence rail and no marking", () => {
		for (const answer of [answeredApMcq({ correct: true, answers: [{ index: 1, label: "2x", value: "2x" }] }), answeredApMcq()]) {
			const html = renderToStaticMarkup(<AnsweredCard answer={answer} input={apMcqInput} />);
			assert.ok(!html.includes("incorrect"), "no red verdict chip");
			assert.ok(!html.includes(">correct<"), "no green verdict chip");
			assert.ok(!html.includes('data-testid="tucked-explanation"'), "no Why control");
			assert.ok(!html.includes('data-testid="answered-confidence"'), "no confidence rail");
			assert.ok(!html.includes("data-mark"), "no ✓/✗ glyph mark");
			assert.ok(!html.includes("text-red-") && !html.includes("border-red-"), "no red marking");
			assert.ok(!html.includes("text-green-") && !html.includes("border-green-"), "no green marking");
			assert.ok(html.includes("border-primary bg-accent"), "the pick is marked with neutral styling");
		}
	});

	it("a correct pick and a wrong pick differ only in which option is marked picked", () => {
		const correct = renderToStaticMarkup(
			<AnsweredCard answer={answeredApMcq({ correct: true, answers: [{ index: 1, label: "2x", value: "2x" }] })} input={apMcqInput} />,
		);
		const wrong = renderToStaticMarkup(
			<AnsweredCard answer={answeredApMcq({ correct: false, answers: [{ index: 2, label: "x", value: "x" }] })} input={apMcqInput} />,
		);
		// Each card marks exactly its own pick, with the same neutral styling.
		assert.equal(correct.match(/border-primary bg-accent/g)?.length, 1);
		assert.equal(wrong.match(/border-primary bg-accent/g)?.length, 1);
		// With the pick marker and its muted-label side effect erased, the two
		// cards are the SAME record: the correct pick and the wrong pick are
		// indistinguishable to the card, which is the withheld verdict.
		const withoutPick = (html: string) =>
			html.replace(/ border-primary bg-accent/g, "").replace(/class="text-muted-foreground"/g, 'class=""');
		assert.equal(withoutPick(correct), withoutPick(wrong));
	});

	it("labels the learner's reasoning YOUR REASONING", () => {
		const html = renderToStaticMarkup(<AnsweredCard answer={answeredApMcq()} input={apMcqInput} />);
		assert.ok(html.includes("YOUR REASONING"));
		assert.ok(!html.includes("YOUR THINKING"));
	});

	it("renders the call's details, and never the commitment or the option notes", () => {
		const html = renderToStaticMarkup(<AnsweredCard answer={answeredApMcq()} input={apMcqInput} />);
		assert.ok(html.includes(apMcqInput.details), "details render");
		for (const secret of SECRETS) assert.ok(!html.includes(secret), `kept out of the card: ${secret}`);
	});
});