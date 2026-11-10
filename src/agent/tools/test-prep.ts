/**
 * THE TEST-PREP TOOLS (test prep, 2026-11-10): the test-prep agent's toolset
 * — `propose_plan` (author the section/point plan for learner review),
 * `test_progress` (readiness + the next queue), `check_point` (pose one
 * short-answer question on a plan point; terminates the turn exactly like
 * recall) and `record_result` (apply the learner's graded outcome), plus the
 * read-only learner-filesystem set.
 *
 * The gating law (Review Focus 1/5): nothing touches a test's plan or
 * progress until the learner has confirmed the plan and the point id exists
 * in it — refusals are retryable tool errors and never call a mutating store
 * method. `check_point` is defined HERE, not beside recall: it needs the
 * test context for the point/plan gate, and the teacher must never carry it.
 *
 * Mechanics-only descriptions (the doctrine ruling, 2026-10-04): what to
 * pass and what happens; the test-prep doctrine lives in the system prompt
 * (prompts/testprep/10-doctrine.md).
 */

import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { explainInputBase, explainInputProblems } from "../../core/question-core.ts";
import { nextQueue, planProblems, readiness } from "../../core/test-prep.ts";
import type { AnswerResult, PlanDraftSection, TestRecord } from "../../core/test-prep.ts";
import { invalidInputResult, questionResult } from "../tool-execute.ts";
import { healEncodedArguments, healToolRecord } from "./heal.ts";
import { readTool } from "./read.ts";
import { lsTool } from "./ls.ts";
import { findTool } from "./find.ts";
import { grepTool } from "./grep.ts";

/** The storage port this toolset closes over — the three test-record
 *  operations it needs, structurally satisfied by store/tests.ts. The agent
 *  layer never imports store adapters (the ports/factories rule), so the
 *  shape is declared here and the composition root injects the real store. */
export interface TestPrepStore {
	get(id: string): TestRecord | null;
	savePlan(id: string, draft: PlanDraftSection[], confirm: boolean): TestRecord;
	recordResult(id: string, pointId: string, result: AnswerResult, chatId: string): TestRecord;
}

/** The record-reading context the gates need (the practice-tools idiom). */
export interface TestPrepToolContext {
	chatId: string;
	testId: string;
	tests: TestPrepStore;
}

/** Plain-text result (these tools answer the model in prose, not JSON). */
function textResult(text: string): AgentToolResult<string> {
	return { content: [{ type: "text", text }], details: text };
}

function percent(ratio: number): string {
	return `${Math.round(ratio * 100)}%`;
}

function locatePoint(test: TestRecord, pointId: string) {
	for (const section of test.sections) {
		const point = section.points.find((candidate) => candidate.id === pointId);
		if (point) return { section, point };
	}
	return null;
}

/** The shared pre-write gate (Review Focus 1): the plan must be confirmed
 *  and the point must exist. Empty result = the call may proceed. */
function pointGateProblems(ctx: TestPrepToolContext, pointId: string): string[] {
	const test = ctx.tests.get(ctx.testId);
	if (!test) return [`test "${ctx.testId}" was not found`];
	if (!test.planConfirmed) {
		return [
			"the plan is not confirmed — propose it with propose_plan, then wait for the learner to confirm it before checking or recording points",
		];
	}
	if (!locatePoint(test, pointId)) {
		return [`pointId "${pointId}" is not in the confirmed plan — use an id from the plan the learner confirmed`];
	}
	return [];
}

// ─── propose_plan ───────────────────────────────────────────────────────────

const planPointInputObject = Type.Object({
	id: Type.Optional(Type.String()),
	text: Type.String({ description: "REQUIRED — one individually testable item." }),
	source: Type.String({
		description: "REQUIRED — the outline line or slide this point came from, so the learner can audit coverage.",
	}),
});

const planSectionInputObject = Type.Object({
	id: Type.Optional(Type.String()),
	title: Type.String({ description: "REQUIRED — the section heading." }),
	points: Type.Array(planPointInputObject, {
		description: "REQUIRED — the individual items this section covers (at least one).",
	}),
});

export const proposePlanInputObject = Type.Object({
	sections: Type.Array(planSectionInputObject, {
		description:
			"REQUIRED — sections from the outline's headings, each with the individual points the test covers.",
	}),
});

export type ProposePlanInput = { sections: PlanDraftSection[] };

function proposePlanTool(ctx: TestPrepToolContext): AgentTool<typeof proposePlanInputObject> {
	return {
		name: "propose_plan",
		label: "propose_plan",
		description:
			"Propose (or revise) the test plan for learner review: sections from the outline's headings, each holding " +
			"the individual points the test covers, every point carrying the outline line or slide it came from. " +
			"Validates that every section has a title and at least one point, and that every point has text. Saves the " +
			"plan UNCONFIRMED and ends your move: say nothing further that assumes scope, wait for the learner to review " +
			"and confirm. Call it again whenever the learner asks for changes — including after confirmation.",
		parameters: proposePlanInputObject,
		prepareArguments: (args: unknown) => healEncodedArguments(args, proposePlanInputObject) as never,
		executionMode: "sequential",
		execute: async (_toolCallId, input) => {
			const problems = planProblems(input.sections);
			if (problems.length > 0) return invalidInputResult("propose_plan", problems);
			const saved = ctx.tests.savePlan(ctx.testId, input.sections, false);
			const points = saved.sections.reduce((total, section) => total + section.points.length, 0);
			return textResult(
				`Plan proposed with ${saved.sections.length} section(s) and ${points} point(s). ` +
					"End your turn now and wait for the learner to review it — do not check any point until the plan is confirmed. " +
					"If the learner asks for changes, call propose_plan again with the revised sections.",
			);
		},
	};
}

// ─── test_progress ──────────────────────────────────────────────────────────

const emptyInputObject = Type.Object({});

function testProgressTool(ctx: TestPrepToolContext): AgentTool<typeof emptyInputObject> {
	return {
		name: "test_progress",
		label: "test_progress",
		description:
			"Report where this test stands: overall readiness and one line per section, then the question queue in " +
			"work order (`pointId · reason · section › point text`, capped at 30 lines). Read-only. Call it at the " +
			"start of every sitting, then work the queue in order.",
		parameters: emptyInputObject,
		prepareArguments: (args: unknown) => healEncodedArguments(args, emptyInputObject) as never,
		executionMode: "sequential",
		execute: async () => {
			const test = ctx.tests.get(ctx.testId);
			if (!test) return invalidInputResult("test_progress", [`test "${ctx.testId}" was not found`]);

			const ready = readiness(test);
			const totals = ready.sections.reduce(
				(acc, section) => ({ solid: acc.solid + section.solid, total: acc.total + section.total }),
				{ solid: 0, total: 0 },
			);
			const lines = [
				`Ready: ${percent(ready.overall)} (${totals.solid}/${totals.total} points solid)`,
				...ready.sections.map(
					(section) => `${section.title}: ${percent(section.ratio)} (${section.solid}/${section.total})`,
				),
			];

			const byPoint = new Map<string, { sectionTitle: string; text: string }>();
			for (const section of test.sections) {
				for (const point of section.points) {
					byPoint.set(point.id, { sectionTitle: section.title, text: point.text });
				}
			}
			const queue = nextQueue(test, ctx.chatId).slice(0, 30).map((entry) => {
				const info = byPoint.get(entry.pointId);
				return `${entry.pointId} · ${entry.reason} · ${info?.sectionTitle ?? "?"} › ${info?.text ?? ""}`;
			});
			lines.push("", ...(queue.length > 0 ? ["Queue:", ...queue] : ["Queue: nothing left"]));
			return textResult(lines.join("\n"));
		},
	};
}

// ─── check_point ────────────────────────────────────────────────────────────

export const checkPointInputObject = Type.Object({
	pointId: Type.String({
		description:
			"REQUIRED — the plan point this question checks, exactly as it appears in test_progress. " +
			"Validated against the confirmed plan; an unknown id is rejected.",
	}),
	...explainInputBase.properties,
});

function checkPointTool(ctx: TestPrepToolContext): AgentTool<typeof checkPointInputObject> {
	return {
		name: "check_point",
		label: "check_point",
		description:
			"Ask the learner to EXPLAIN one point from the test plan in his own words — a graded check with NO options: " +
			"he types a free-text answer. THE COMMITMENT RULE: correctAnswer is the FULL correct answer in your own " +
			"words, reasoning included, COMMITTED before he ever sees the question. When his answer returns, grade it " +
			"strictly against the commitment — never revise it after seeing his words. THE COMMITTED ANSWER IS NEVER " +
			"SHOWN TO THE LEARNER: he sees only a ✓ verdict when right, or your explanation when wrong. pointId must " +
			"name a point in the confirmed plan (validated at call time). ONE question per turn: call a single " +
			"check_point, then end your turn — his answer determines the next.",
		parameters: checkPointInputObject,
		prepareArguments: (args: unknown) => healEncodedArguments(args, checkPointInputObject) as never,
		executionMode: "sequential",
		execute: async (_toolCallId, input) => {
			const problems = pointGateProblems(ctx, input.pointId);
			if (problems.length > 0) return invalidInputResult("check_point", problems);
			const authoring = explainInputProblems(input);
			if (authoring.length > 0) return invalidInputResult("check_point", authoring);
			return questionResult();
		},
	};
}

// ─── record_result ──────────────────────────────────────────────────────────

export const recordResultInputObject = Type.Object({
	pointId: Type.String({
		description: "REQUIRED — the plan point this outcome belongs to; validated against the confirmed plan.",
	}),
	result: Type.Union([Type.Literal("correct"), Type.Literal("wrong"), Type.Literal("dontKnow")], {
		description:
			"REQUIRED — the graded outcome as a bare word: correct, wrong, or dontKnow. A hint-assisted or " +
			"self-assessed answer is never correct.",
	}),
});

function recordResultTool(ctx: TestPrepToolContext): AgentTool<typeof recordResultInputObject> {
	return {
		name: "record_result",
		label: "record_result",
		description:
			"Record the learner's graded outcome for one plan point. Updates the point's status and returns its new " +
			"status plus overall readiness. Refused before the plan is confirmed and for a point id not in the plan. " +
			"Call it once per check, immediately after grading the learner's answer.",
		parameters: recordResultInputObject,
		prepareArguments: (args: unknown) => healEncodedArguments(args, recordResultInputObject) as never,
		executionMode: "sequential",
		execute: async (_toolCallId, input) => {
			const problems = pointGateProblems(ctx, input.pointId);
			if (problems.length > 0) return invalidInputResult("record_result", problems);
			const updated = ctx.tests.recordResult(ctx.testId, input.pointId, input.result, ctx.chatId);
			const located = locatePoint(updated, input.pointId);
			const ready = readiness(updated);
			const totals = ready.sections.reduce(
				(acc, section) => ({ solid: acc.solid + section.solid, total: acc.total + section.total }),
				{ solid: 0, total: 0 },
			);
			return textResult(
				`Point ${input.pointId} is now ${located?.point.status ?? "unknown"}.\n` +
					`Overall readiness: ${percent(ready.overall)} (${totals.solid}/${totals.total} points solid).`,
			);
		},
	};
}

// ─── the registry ───────────────────────────────────────────────────────────

/** The test-prep toolset (the test-prep agent's whole registry). */
export function testPrepTools(ctx: TestPrepToolContext): Record<string, AgentTool<any>> {
	// healToolRecord — the standard argument heal over the WHOLE registry
	// (the practice/teacher/prober convention). The per-tool prepareArguments
	// above is the composed inner pass; the double heal is idempotent.
	return healToolRecord({
		propose_plan: proposePlanTool(ctx),
		test_progress: testProgressTool(ctx),
		check_point: checkPointTool(ctx),
		record_result: recordResultTool(ctx),
		read: readTool,
		ls: lsTool,
		find: findTool,
		grep: grepTool,
	});
}