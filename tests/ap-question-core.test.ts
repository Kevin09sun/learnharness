/**
 * Unit tests — the AP `ap_mcq` question shape (task 5, stage 1).
 *
 * An AP multiple-choice question reuses the quiz mechanic in the dock, but
 * the verdict is WITHHELD from the learner: the correct option and the
 * per-option notes are the model's commitment, and the tutor's reply is the
 * verdict. These pins sit at the pure core seams — the tool schema and
 * authoring problems, the answer record (verdict for the MODEL only), the
 * learner-facing projection, the tool-result frame and the markdown export.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	apMcqInputProblems,
	buildAnswer,
	compactAnswerForModel,
	normalizeOptions,
	type QuestionData,
} from "../src/core/question-core.ts";
import { QUESTION_TOOLS, toolQuestionKind } from "../src/core/pending.ts";
import { parseApMcqInput, parseQuestionInput } from "../src/core/tool-parts.ts";
import { answerForPresentation } from "../src/core/answer-presentation.ts";
import { AP_MCQ_ANSWER_FRAME, newAnswerResult, type LhMessage } from "../src/core/native-messages.ts";
import { sessionMarkdown } from "../src/core/session-markdown.ts";

const good = {
	topicId: "unit-1-topic-1",
	question: "If f(x) = x^2, what is f'(2)?",
	options: [
		{ label: "0", value: "0" },
		{ label: "2", value: "2" },
		{ label: "4", value: "4" },
		{ label: "8", value: "8" },
	],
	correctAnswer: "4",
	optionNotes: [
		"0 treats the derivative as zero everywhere.",
		"2 confuses f'(0) with f'(2).",
		"f'(x) = 2x, so f'(2) = 4.",
		"8 is f(2), not f'(2).",
	],
	details: "Use the power rule.",
};

function apMcqQD(overrides?: Partial<QuestionData>): QuestionData {
	return {
		id: "ap1",
		kind: "quiz",
		question: good.question,
		mode: "single-select",
		options: normalizeOptions(good.options),
		correctIndices: [3],
		createdAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

describe("ap_mcq is a quiz-kind question tool", () => {
	it("registers in QUESTION_TOOLS and folds onto the quiz kind", () => {
		assert.ok((QUESTION_TOOLS as readonly string[]).includes("ap_mcq"));
		assert.equal(toolQuestionKind("ap_mcq"), "quiz");
	});
});

describe("apMcqInputProblems (the authoring contract)", () => {
	it("accepts a well-formed question", () => {
		assert.deepEqual(apMcqInputProblems(good), []);
	});

	const cases: Array<[string, (input: typeof good) => void, RegExp]> = [
		["three options", (input) => { input.options.pop(); }, /four options/],
		["duplicate option", (input) => { input.options[1]!.label = input.options[0]!.label; }, /distinct/],
		["correctAnswer not an option", (input) => { input.correctAnswer = "none of these"; }, /correctAnswer/],
		["three notes", (input) => { input.optionNotes.pop(); }, /four .*notes/],
		["blank note", (input) => { input.optionNotes[2] = "  "; }, /note/],
		["blank question", (input) => { input.question = " "; }, /question/],
	];
	for (const [name, mutate, pattern] of cases) {
		it(`rejects ${name}`, () => {
			const input = structuredClone(good);
			mutate(input);
			assert.match(apMcqInputProblems(input).join(" "), pattern);
		});
	}

	it("parses a well-formed call and rejects a malformed one", () => {
		const parsed = parseApMcqInput(good);
		assert.ok(parsed, "a well-formed ap_mcq call parses for the dock");
		assert.deepEqual(parsed.options.map((o) => o.label), ["0", "2", "4", "8"]);
		assert.equal(parsed.optionNotes.length, 4);
		const malformed = structuredClone(good);
		malformed.options.pop();
		assert.equal(parseApMcqInput(malformed), undefined);
		assert.equal(parseQuestionInput("ap_mcq", good)?.question, good.question);
	});
});

describe("the ap_mcq answer record", () => {
	it("carries the pick, its correctness and the reasoning for the model, and no commitment or confidence", () => {
		const answer = buildAnswer(apMcqQD(), { values: ["4"], thinking: "because f' changes sign" }, "ap_mcq");
		assert.equal(answer.kind, "quiz");
		assert.equal(answer.correct, true);
		assert.equal(answer.thinking, "because f' changes sign");
		assert.equal(answer.committed, undefined);
		assert.equal(answer.confidence, undefined);
		assert.equal(buildAnswer(apMcqQD(), { values: ["4"], confidence: 90 }, "ap_mcq").confidence, undefined);
		const compact = compactAnswerForModel(answer);
		assert.equal(compact.correct, true);
		assert.equal(compact.thinking, "because f' changes sign");
	});

	it("the learner-facing projection has no verdict", () => {
		const answer = buildAnswer(apMcqQD(), { values: ["4"], thinking: "because f' changes sign" }, "ap_mcq");
		const shown = answerForPresentation(answer, good);
		assert.equal("correct" in shown, false);
		assert.equal("committed" in shown, false);
		assert.equal("correctIndices" in shown, false);
		assert.equal("explanation" in shown, false);
	});
});

describe("the ap_mcq tool result and export", () => {
	it("the model-facing tool result is framed for grading", () => {
		const answer = buildAnswer(apMcqQD(), { values: ["4"], thinking: "because f' changes sign" }, "ap_mcq");
		const result = newAnswerResult("ap1", "ap_mcq", answer);
		assert.ok((result.content[0] as { text: string }).text.startsWith(AP_MCQ_ANSWER_FRAME));
	});

	it("the markdown export shows the pick and reasoning and no verdict", () => {
		const answer = buildAnswer(apMcqQD(), { values: ["4"], thinking: "because f' changes sign" }, "ap_mcq");
		const messages = [
			{
				id: "a1",
				role: "assistant",
				content: [{ type: "toolCall", id: "ap1", name: "ap_mcq", arguments: good }],
				timestamp: Date.now(),
			},
			{ ...newAnswerResult("ap1", "ap_mcq", answer), id: "r1" },
		] as unknown as LhMessage[];
		const md = sessionMarkdown(messages);
		assert.match(md, /AP question/);
		assert.match(md, /because f' changes sign/);
		assert.doesNotMatch(md, /correct|✓|✗/i);
	});
});