/**
 * TEST-PREP TOOLS (test prep, 2026-11-10): the test-prep agent's registry —
 * propose_plan, test_progress, check_point and record_result plus the
 * read-only learner-filesystem set.
 *
 * The gates are the Review Focus 1/5 contract: nothing mutates a test record
 * until the plan is confirmed and the point id is known, and the refusals are
 * retryable tool errors (invalidInputResult) that leave the fake untouched.
 * check_point poses a pending question exactly like recall (questionResult:
 * terminate) and never reveals its committed answer to the learner.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyResult } from "../src/core/test-prep.ts";
import type { PlanDraftSection, TestRecord } from "../src/core/test-prep.ts";
import { QUESTION_TOOLS, toolQuestionKind } from "../src/core/pending.ts";
import {
	checkPointInputObject,
	testPrepTools,
	type TestPrepToolContext,
} from "../src/agent/tools/test-prep.ts";

// ── fixtures ─────────────────────────────────────────────────────────────────

const RECORD: TestRecord = {
	id: "test_1",
	title: "Bio midterm",
	createdAt: "2026-11-10T00:00:00.000Z",
	updatedAt: "2026-11-10T00:00:00.000Z",
	planConfirmed: true,
	sections: [
		{
			id: "sec_cells",
			title: "Cells",
			points: [
				{
					id: "p_recheck",
					text: "Membrane transport",
					source: "slides 4",
					status: "fixed-recheck",
					fixedIn: "chat_old",
					history: [],
				},
				{
					id: "p_unchecked",
					text: "Mitosis stages",
					source: "outline 2",
					status: "unchecked",
					history: [],
				},
				{ id: "p_solid", text: "ATP", source: "outline 1", status: "solid", history: [] },
			],
		},
		{
			id: "sec_genetics",
			title: "Genetics",
			points: [
				{
					id: "p_gap",
					text: "Punnett squares",
					source: "slides 9",
					status: "gap",
					history: [],
				},
			],
		},
	],
	version: 1,
};

function recordOf(overrides: Partial<TestRecord> = {}): TestRecord {
	return { ...RECORD, ...overrides };
}

interface FakeCalls {
	get: string[];
	savePlan: Array<{ id: string; draft: PlanDraftSection[]; confirm: boolean }>;
	recordResult: Array<{ id: string; pointId: string; result: string; chatId: string }>;
}

/** An in-memory fake of the three store methods the tools consume. Every
 *  mutation is recorded so a refusal can assert the record never moved. */
function fakeTests(initial: TestRecord): {
	tests: TestPrepToolContext["tests"];
	calls: FakeCalls;
	current: () => TestRecord;
} {
	let current = initial;
	const calls: FakeCalls = { get: [], savePlan: [], recordResult: [] };
	const tests: TestPrepToolContext["tests"] = {
		get: (id) => {
			calls.get.push(id);
			return current;
		},
		savePlan: (id, draft, confirm) => {
			calls.savePlan.push({ id, draft, confirm });
			return current;
		},
		recordResult: (id, pointId, result, chatId) => {
			calls.recordResult.push({ id, pointId, result, chatId });
			current = {
				...current,
				sections: current.sections.map((section) => ({
					...section,
					points: section.points.map((point) =>
						point.id === pointId
							? applyResult(point, result, chatId, "2026-11-10T01:00:00.000Z")
							: point,
					),
				})),
			};
			return current;
		},
	};
	return { tests, calls, current: () => current };
}

function ctxOf(tests: TestPrepToolContext["tests"]): TestPrepToolContext {
	return { chatId: "chat_now", testId: "test_1", tests };
}

const CHECK_INPUT = {
	pointId: "p_unchecked",
	question: "What are the stages of mitosis, in order?",
	correctAnswer: "Prophase, metaphase, anaphase, telophase.",
};

const DRAFT: PlanDraftSection[] = [
	{
		title: "Cells",
		points: [{ text: "Membrane transport", source: "slides 4" }],
	},
];

// ── the registry ────────────────────────────────────────────────────────────

describe("testPrepTools registry", () => {
	it("carries the four session tools plus the read-only learner-filesystem set", () => {
		const tools = testPrepTools(ctxOf(fakeTests(recordOf()).tests));
		assert.deepEqual(Object.keys(tools).sort(), [
			"check_point",
			"find",
			"grep",
			"ls",
			"propose_plan",
			"read",
			"record_result",
			"test_progress",
		]);
	});

	it("wires the pdf job when a jobs context is passed — and omits it without one", () => {
		// Outlines and slides are usually PDFs: without the job context the
		// agent could not read the folder it was pointed at.
		const plain = testPrepTools(ctxOf(fakeTests(recordOf()).tests));
		assert.equal(plain.pdf, undefined);
		const jobs = { chatId: "chat_now", jobStore: null as never, spawn: (() => {}) as never, searchAvailable: () => false };
		const withJobs = testPrepTools({ ...ctxOf(fakeTests(recordOf()).tests), jobs });
		assert.ok(withJobs.pdf, "pdf job present with a jobs context");
		assert.ok(withJobs.research, "the same job set practice carries");
	});

	it("check_point is a question tool: it folds onto the explain kind (the turn pauses)", () => {
		assert.ok((QUESTION_TOOLS as readonly string[]).includes("check_point"));
		assert.equal(toolQuestionKind("check_point"), "explain");
	});
});

// ── propose_plan (Review Focus 5) ───────────────────────────────────────────

describe("propose_plan", () => {
	it("REFUSES an invalid draft without touching the record", async () => {
		const { tests, calls } = fakeTests(recordOf());
		const tool = testPrepTools(ctxOf(tests)).propose_plan!;
		const result = await tool.execute("call_plan", { sections: [{ title: "", points: [] }] } as never);
		assert.equal(result.isError, true);
		assert.equal(calls.savePlan.length, 0, "an invalid plan is never saved");
	});

	it("saves a valid draft UNCONFIRMED and tells the model to wait for review", async () => {
		const { tests, calls } = fakeTests(recordOf({ planConfirmed: false }));
		const tool = testPrepTools(ctxOf(tests)).propose_plan!;
		const result = await tool.execute("call_plan", { sections: DRAFT } as never);
		assert.equal(result.isError, undefined);
		assert.equal(calls.savePlan.length, 1);
		assert.equal(calls.savePlan[0]!.confirm, false);
		assert.deepEqual(calls.savePlan[0]!.draft, DRAFT);
		assert.match((result.content[0] as { text: string }).text, /end your turn/i);
		assert.match((result.content[0] as { text: string }).text, /review/i);
	});

	it("stays available after confirmation (the learner may ask for changes)", async () => {
		const { tests, calls } = fakeTests(recordOf({ planConfirmed: true }));
		const tool = testPrepTools(ctxOf(tests)).propose_plan!;
		const result = await tool.execute("call_plan", { sections: DRAFT } as never);
		assert.equal(result.isError, undefined);
		assert.equal(calls.savePlan.length, 1);
	});
});

// ── check_point (Review Focus 1, the recall mechanism) ──────────────────────

describe("check_point", () => {
	it("REFUSES before the plan is confirmed — no mutation", async () => {
		const { tests, calls } = fakeTests(recordOf({ planConfirmed: false }));
		const tool = testPrepTools(ctxOf(tests)).check_point!;
		const result = await tool.execute("call_q", CHECK_INPUT as never);
		assert.equal(result.isError, true);
		assert.match((result.details as { problems: string[] }).problems[0]!, /not confirmed/i);
		assert.equal(calls.recordResult.length, 0);
		assert.equal(calls.savePlan.length, 0);
	});

	it("REFUSES an unknown point id — no mutation", async () => {
		const { tests, calls } = fakeTests(recordOf());
		const tool = testPrepTools(ctxOf(tests)).check_point!;
		const result = await tool.execute("call_q", { ...CHECK_INPUT, pointId: "p_ghost" } as never);
		assert.equal(result.isError, true);
		assert.match((result.details as { problems: string[] }).problems[0]!, /p_ghost/);
		assert.equal(calls.recordResult.length, 0);
	});

	it("poses the pending question and ends the turn exactly like recall", async () => {
		const { tests } = fakeTests(recordOf());
		const tool = testPrepTools(ctxOf(tests)).check_point!;
		const result = await tool.execute("call_q", CHECK_INPUT as never);
		assert.equal(result.isError, undefined);
		assert.equal(result.terminate, true);
		assert.match((result.content[0] as { text: string }).text, /Question posed/);
		assert.equal(tool.executionMode, "sequential");
	});

	it("states that the committed answer is never shown to the learner", () => {
		const tool = testPrepTools(ctxOf(fakeTests(recordOf()).tests)).check_point!;
		assert.match(tool.description, /never shown to the learner/i);
		assert.match(tool.description, /✓/);
	});

	it("overrides the inherited correctAnswer description — no 'shown to him' leak", () => {
		const description =
			(checkPointInputObject.properties.correctAnswer as { description?: string }).description ?? "";
		assert.doesNotMatch(description, /shown to him/i);
		assert.match(description, /never shown to the learner/i);
		assert.match(description, /COMMITTED before/i);
	});

	it("enforces the explain commitment rule (empty correctAnswer refuses)", async () => {
		const { tests } = fakeTests(recordOf());
		const tool = testPrepTools(ctxOf(tests)).check_point!;
		const result = await tool.execute("call_q", { ...CHECK_INPUT, correctAnswer: "   " } as never);
		assert.equal(result.isError, true);
		assert.match((result.details as { problems: string[] }).problems[0]!, /correctAnswer/i);
	});
});

// ── record_result (Review Focus 1) ──────────────────────────────────────────

describe("record_result", () => {
	it("REFUSES before the plan is confirmed, without calling the store mutation", async () => {
		const { tests, calls } = fakeTests(recordOf({ planConfirmed: false }));
		const tool = testPrepTools(ctxOf(tests)).record_result!;
		const result = await tool.execute("call_r", { pointId: "p_unchecked", result: "correct" } as never);
		assert.equal(result.isError, true);
		assert.match((result.details as { problems: string[] }).problems[0]!, /not confirmed/i);
		assert.equal(calls.recordResult.length, 0, "the refusal must not call the mutating method");
	});

	it("REFUSES an unknown point id, without calling the store mutation", async () => {
		const { tests, calls } = fakeTests(recordOf());
		const tool = testPrepTools(ctxOf(tests)).record_result!;
		const result = await tool.execute("call_r", { pointId: "p_ghost", result: "correct" } as never);
		assert.equal(result.isError, true);
		assert.match((result.details as { problems: string[] }).problems[0]!, /p_ghost/);
		assert.equal(calls.recordResult.length, 0);
	});

	it("records a correct unseen point as solid and reports overall readiness", async () => {
		const { tests, calls } = fakeTests(recordOf());
		const tool = testPrepTools(ctxOf(tests)).record_result!;
		const result = await tool.execute("call_r", { pointId: "p_unchecked", result: "correct" } as never);
		assert.equal(result.isError, undefined);
		assert.equal(calls.recordResult.length, 1);
		assert.deepEqual(calls.recordResult[0], {
			id: "test_1",
			pointId: "p_unchecked",
			result: "correct",
			chatId: "chat_now",
		});
		const text = (result.content[0] as { text: string }).text;
		assert.match(text, /solid/);
		assert.match(text, /readiness/i);
	});
});

// ── test_progress ───────────────────────────────────────────────────────────

describe("test_progress", () => {
	it("reports readiness and the queue in nextQueue order (recheck before unchecked)", async () => {
		const { tests } = fakeTests(recordOf());
		const tool = testPrepTools(ctxOf(tests)).test_progress!;
		const result = await tool.execute("call_p", {} as never);
		assert.equal(result.isError, undefined);
		const text = (result.content[0] as { text: string }).text;
		assert.match(text, /Ready: 25%/);
		assert.match(text, /Cells: 33%/);
		assert.match(text, /Genetics: 0%/);
		const recheck = text.indexOf("p_recheck · recheck · Cells › Membrane transport");
		const unchecked = text.indexOf("p_unchecked · unchecked · Cells › Mitosis stages");
		assert.ok(recheck >= 0, "the recheck line is present in the documented format");
		assert.ok(unchecked >= 0, "the unchecked line is present in the documented format");
		assert.ok(recheck < unchecked, "re-checks come before unchecked points");
		assert.ok(text.indexOf("p_gap · gap · Genetics › Punnett squares") > unchecked, "gaps come last");
	});

	it("never rounds a near-perfect ratio up to 100% (100% = every point solid)", async () => {
		const many: TestRecord = recordOf({
			sections: [
				{
					id: "sec_big",
					title: "Big",
					points: Array.from({ length: 200 }, (_, i) => ({
						id: `p_${i}`,
						text: `Point ${i}`,
						source: "outline",
						status: i === 199 ? ("unchecked" as const) : ("solid" as const),
						history: [],
					})),
				},
			],
		});
		const { tests } = fakeTests(many);
		const tool = testPrepTools(ctxOf(tests)).test_progress!;
		const result = await tool.execute("call_p", {} as never);
		const text = (result.content[0] as { text: string }).text;
		assert.match(text, /Ready: 99%/);
		assert.doesNotMatch(text, /Ready: 100%/);
		assert.match(text, /Big: 99%/);
	});

	it("reports exact integer percentages without float undercount (57/100, 29/100)", async () => {
		for (const [solidCount, expected] of [
			[57, "57%"],
			[29, "29%"],
		] as const) {
			const points = Array.from({ length: 100 }, (_, i) => ({
				id: `p_${i}`,
				text: `Point ${i}`,
				source: "outline",
				status: i < solidCount ? ("solid" as const) : ("unchecked" as const),
				history: [],
			}));
			const { tests } = fakeTests(
				recordOf({ sections: [{ id: "sec_big", title: "Big", points }] }),
			);
			const result = await testPrepTools(ctxOf(tests)).test_progress!.execute("call_p", {} as never);
			const text = (result.content[0] as { text: string }).text;
			assert.match(text, new RegExp(`Ready: ${expected}`));
			assert.match(text, new RegExp(`Big: ${expected}`));
			assert.doesNotMatch(text, new RegExp(`Ready: ${Number.parseInt(expected) - 1}%`));
		}
	});

	it("caps the queue at 30 lines", async () => {
		const many: TestRecord = recordOf({
			sections: [
				{
					id: "sec_big",
					title: "Big",
					points: Array.from({ length: 35 }, (_, i) => ({
						id: `p_${i}`,
						text: `Point ${i}`,
						source: "outline",
						status: "unchecked" as const,
						history: [],
					})),
				},
			],
		});
		const { tests } = fakeTests(many);
		const tool = testPrepTools(ctxOf(tests)).test_progress!;
		const result = await tool.execute("call_p", {} as never);
		const text = (result.content[0] as { text: string }).text;
		const queueLines = text.split("\n").filter((line) => line.includes(" · "));
		assert.equal(queueLines.length, 30);
	});
});