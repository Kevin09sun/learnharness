/**
 * Unit tests — test-prep core (pure logic, no fs, no server).
 *
 * The status machine, readiness math, question order, and plan merging all
 * live in src/core/test-prep.ts; later tasks (store, tools, UI) import these.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	applyResult,
	mergePlan,
	nextQueue,
	planProblems,
	readiness,
	readinessPercent,
	type PlanDraftSection,
	type TestPoint,
	type TestSection,
} from "../src/core/test-prep.ts";

const point = (overrides: Partial<TestPoint> = {}): TestPoint => ({
	id: "p",
	text: "a point",
	source: "outline line",
	status: "unchecked",
	history: [],
	...overrides,
});

const section = (id: string, title: string, points: TestPoint[]): TestSection => ({ id, title, points });

describe("applyResult — the status machine", () => {
	const at = "2026-11-10T10:00:00.000Z";

	it("unchecked + correct → solid", () => {
		assert.equal(applyResult(point(), "correct", "c1", at).status, "solid");
	});

	it("unchecked + wrong → gap", () => {
		assert.equal(applyResult(point(), "wrong", "c1", at).status, "gap");
	});

	it("unchecked + dontKnow → gap", () => {
		assert.equal(applyResult(point(), "dontKnow", "c1", at).status, "gap");
	});

	it("gap + correct → fixed-recheck, fixed in the answering chat", () => {
		const next = applyResult(point({ status: "gap" }), "correct", "c1", at);
		assert.equal(next.status, "fixed-recheck");
		assert.equal(next.fixedIn, "c1");
	});

	it("fixed-recheck + correct in the same chat stays fixed-recheck", () => {
		const next = applyResult(point({ status: "fixed-recheck", fixedIn: "c1" }), "correct", "c1", at);
		assert.equal(next.status, "fixed-recheck");
		assert.equal(next.fixedIn, "c1");
	});

	it("fixed-recheck + correct in a later chat becomes solid and clears fixedIn", () => {
		const next = applyResult(point({ status: "fixed-recheck", fixedIn: "c1" }), "correct", "c2", at);
		assert.equal(next.status, "solid");
		assert.equal(next.fixedIn, undefined);
	});

	it("fixed-recheck + wrong → gap", () => {
		assert.equal(
			applyResult(point({ status: "fixed-recheck", fixedIn: "c1" }), "wrong", "c2", at).status,
			"gap",
		);
	});

	it("solid + wrong → gap", () => {
		assert.equal(applyResult(point({ status: "solid" }), "wrong", "c2", at).status, "gap");
	});

	it("appends exactly one history entry per call", () => {
		const before = point({
			history: [{ at: "2026-11-09T00:00:00.000Z", chatId: "c0", result: "wrong" }],
		});
		const next = applyResult(before, "correct", "c1", at);
		assert.equal(next.history.length, 2);
		assert.deepEqual(next.history[1], { at, chatId: "c1", result: "correct" });
	});

	it("does not mutate its input", () => {
		const before = point({ status: "gap", history: [] });
		const next = applyResult(before, "correct", "c1", at);
		assert.equal(before.status, "gap");
		assert.equal(before.fixedIn, undefined);
		assert.equal(before.history.length, 0);
		assert.notEqual(next, before);
	});
});

describe("readiness", () => {
	it("is solid points ÷ all points, overall and per section (empty section ratio 0)", () => {
		const result = readiness({
			sections: [
				section("s1", "Section one", [
					point({ id: "a", status: "solid" }),
					point({ id: "b", status: "solid" }),
					point({ id: "c", status: "gap" }),
					point({ id: "d", status: "fixed-recheck", fixedIn: "c1" }),
				]),
				section("s2", "Section two", []),
			],
		});

		assert.equal(result.overall, 0.5);
		assert.deepEqual(result.sections, [
			{ id: "s1", title: "Section one", solid: 2, total: 4, ratio: 0.5 },
			{ id: "s2", title: "Section two", solid: 0, total: 0, ratio: 0 },
		]);
	});

	it("is 0 for an all-empty test", () => {
		assert.equal(readiness({ sections: [section("s1", "Empty", [])] }).overall, 0);
		assert.equal(readiness({ sections: [] }).overall, 0);
	});
});

describe("readinessPercent — the one count-based percent rule", () => {
	it("is 0 when there is nothing planned", () => {
		assert.equal(readinessPercent(0, 0), 0);
	});

	it("floors a partial score and never undercounts an exact integer", () => {
		assert.equal(readinessPercent(57, 100), 57);
		assert.equal(readinessPercent(199, 200), 99);
	});

	it("is 100 only when every point is solid", () => {
		assert.equal(readinessPercent(4, 4), 100);
	});
});

describe("nextQueue — re-checks, then interleaved unchecked, then gaps", () => {
	it("orders the queue for the current chat", () => {
		const queue = nextQueue(
			{
				sections: [
					section("s1", "Section one", [
						point({ id: "a1" }),
						point({ id: "a2", status: "fixed-recheck", fixedIn: "c1" }),
						point({ id: "a3", status: "solid" }),
						point({ id: "a4", status: "gap" }),
						point({ id: "a5" }),
					]),
					section("s2", "Section two", [
						point({ id: "b1" }),
						point({ id: "b2", status: "fixed-recheck", fixedIn: "c2" }),
						point({ id: "b3", status: "gap" }),
						point({ id: "b4" }),
					]),
				],
			},
			"c2",
		);

		assert.deepEqual(queue, [
			// points fixed in an earlier chat come first
			{ pointId: "a2", reason: "recheck" },
			// unchecked points interleave: point 1 of each section, then point 2
			{ pointId: "a1", reason: "unchecked" },
			{ pointId: "b1", reason: "unchecked" },
			{ pointId: "a5", reason: "unchecked" },
			{ pointId: "b4", reason: "unchecked" },
			// gaps last
			{ pointId: "a4", reason: "gap" },
			{ pointId: "b3", reason: "gap" },
		]);
	});

	it("never includes solid points or points fixed in this chat", () => {
		const queue = nextQueue(
			{
				sections: [
					section("s1", "Section one", [
						point({ id: "solid", status: "solid" }),
						point({ id: "here", status: "fixed-recheck", fixedIn: "c2" }),
					]),
				],
			},
			"c2",
		);
		assert.deepEqual(queue, []);
	});
});

describe("mergePlan — editing keeps progress", () => {
	it("keeps status/history/fixedIn for existing ids, mints ids for new points, drops removed points", () => {
		const history = [{ at: "2026-11-09T00:00:00.000Z", chatId: "c1", result: "correct" as const }];
		const existing: TestSection[] = [
			section("s1", "Old title", [
				point({ id: "p1", text: "old one", source: "old src", status: "solid", history }),
				point({ id: "p2", text: "old two", source: "old src 2", status: "fixed-recheck", fixedIn: "c1" }),
			]),
		];

		const draft: PlanDraftSection[] = [
			{
				id: "s1",
				title: "New title",
				points: [
					{ id: "p1", text: "new one", source: "new src" },
					{ text: "brand new", source: "new src 2" },
				],
			},
		];

		const merged = mergePlan(existing, draft, () => "gen-1");

		assert.equal(merged.length, 1);
		const mergedSection = merged[0]!;
		assert.equal(mergedSection.id, "s1");
		assert.equal(mergedSection.title, "New title");
		assert.equal(mergedSection.points.length, 2);
		// p1 keeps its identity and progress, takes the draft's text/source
		assert.equal(mergedSection.points[0]!.id, "p1");
		assert.equal(mergedSection.points[0]!.text, "new one");
		assert.equal(mergedSection.points[0]!.source, "new src");
		assert.equal(mergedSection.points[0]!.status, "solid");
		assert.deepEqual(mergedSection.points[0]!.history, history);
		// new point gets the minted id and starts unchecked
		assert.equal(mergedSection.points[1]!.id, "gen-1");
		assert.equal(mergedSection.points[1]!.text, "brand new");
		assert.equal(mergedSection.points[1]!.source, "new src 2");
		assert.equal(mergedSection.points[1]!.status, "unchecked");
		assert.deepEqual(mergedSection.points[1]!.history, []);
	});

	it("keeps a point's progress even when its section is replaced", () => {
		const existing = [
			section("s1", "Old", [point({ id: "p1", status: "gap", fixedIn: "c1" })]),
		];
		const draft: PlanDraftSection[] = [
			{ title: "Fresh section", points: [{ id: "p1", text: "kept", source: "src" }] },
		];

		const merged = mergePlan(existing, draft, () => "gen-1");
		assert.equal(merged[0]!.id, "gen-1");
		assert.equal(merged[0]!.points[0]!.status, "gap");
		assert.equal(merged[0]!.points[0]!.fixedIn, "c1");
	});

	it("a revision without ids keeps progress by matching trimmed titles and texts", () => {
		const history = [{ at: "2026-11-09T00:00:00.000Z", chatId: "c1", result: "correct" as const }];
		const existing: TestSection[] = [
			section("s1", "Section A", [
				point({ id: "p1", text: "Alpha", source: "old", status: "solid", history }),
				point({ id: "p2", text: "Beta", source: "old", status: "fixed-recheck", fixedIn: "c1" }),
			]),
		];
		const draft: PlanDraftSection[] = [
			{
				title: "  Section A  ",
				points: [
					{ text: " Alpha ", source: "new" },
					{ text: "Beta", source: "new" },
				],
			},
		];

		const merged = mergePlan(existing, draft, () => "gen-1");
		assert.equal(merged[0]!.id, "s1", "the section is matched by trimmed title");
		assert.equal(merged[0]!.points[0]!.id, "p1");
		assert.equal(merged[0]!.points[0]!.status, "solid");
		assert.deepEqual(merged[0]!.points[0]!.history, history);
		assert.equal(merged[0]!.points[0]!.source, "new", "the draft's source wins");
		assert.equal(merged[0]!.points[1]!.id, "p2");
		assert.equal(merged[0]!.points[1]!.status, "fixed-recheck");
		assert.equal(merged[0]!.points[1]!.fixedIn, "c1");
	});

	it("a renamed point starts unchecked", () => {
		const existing = [section("s1", "Section A", [point({ id: "p1", text: "Alpha", status: "solid" })])];
		const draft: PlanDraftSection[] = [
			{ title: "Section A", points: [{ text: "Alpha, revised", source: "src" }] },
		];

		const merged = mergePlan(existing, draft, () => "gen-1");
		assert.equal(merged[0]!.points[0]!.id, "gen-1");
		assert.equal(merged[0]!.points[0]!.status, "unchecked");
		assert.deepEqual(merged[0]!.points[0]!.history, []);
	});

	it("never claims one existing point for two draft points", () => {
		const existing = [section("s1", "Section A", [point({ id: "p1", text: "Same", status: "solid" })])];
		const draft: PlanDraftSection[] = [
			{
				title: "Section A",
				points: [
					{ text: "Same", source: "src" },
					{ text: "Same", source: "src" },
				],
			},
		];

		const merged = mergePlan(existing, draft, () => "gen-1");
		assert.equal(merged[0]!.points[0]!.id, "p1");
		assert.equal(merged[0]!.points[0]!.status, "solid");
		assert.equal(merged[0]!.points[1]!.id, "gen-1");
		assert.equal(merged[0]!.points[1]!.status, "unchecked");
	});

	it("an explicit id takes precedence over text matching", () => {
		const existing = [
			section("s1", "Section A", [
				point({ id: "p1", text: "Alpha", status: "solid" }),
				point({ id: "p2", text: "Beta", status: "gap" }),
			]),
		];
		const draft: PlanDraftSection[] = [
			{ id: "s1", title: "Section A", points: [{ id: "p2", text: "Alpha", source: "src" }] },
		];

		const merged = mergePlan(existing, draft, () => "gen-1");
		assert.equal(merged[0]!.points[0]!.id, "p2");
		assert.equal(merged[0]!.points[0]!.status, "gap");
	});
});

describe("planProblems — the plan must be answerable", () => {
	const valid: PlanDraftSection[] = [
		{ title: "Section", points: [{ text: "A point", source: "outline" }] },
	];

	it("returns [] for a valid draft", () => {
		assert.deepEqual(planProblems(valid), []);
	});

	it("rejects zero sections", () => {
		assert.notDeepEqual(planProblems([]), []);
	});

	it("rejects a section with zero points", () => {
		assert.notDeepEqual(planProblems([{ title: "Empty section", points: [] }]), []);
	});

	it("rejects a blank section title", () => {
		assert.notDeepEqual(
			planProblems([{ title: "   ", points: [{ text: "A point", source: "outline" }] }]),
			[],
		);
	});

	it("rejects a blank point text", () => {
		assert.notDeepEqual(
			planProblems([{ title: "Section", points: [{ text: "  ", source: "outline" }] }]),
			[],
		);
	});

	it("rejects a blank point source", () => {
		assert.notDeepEqual(
			planProblems([{ title: "Section", points: [{ text: "A point", source: "  " }] }]),
			[],
		);
	});
});