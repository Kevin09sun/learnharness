/**
 * TEST STORE PINS (test prep, 2026-11-10): one JSON file per test under
 * data/tests/ holds the plan and per-point progress. Every mutation is a
 * fresh read-modify-write (a plan edit made in the UI must never be
 * reverted by the next answer write), and the degraded read is honest:
 * a file that does not parse reads as absent and is never rewritten.
 * Runs under an isolated LH_DATA_DIR (the chat-birth-stamp discipline:
 * the seam is set before any config-loading import, so every app-module
 * import is dynamic).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

// ── the seam, BEFORE any config-loading import ──────────────────────────────
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-test-prep-store-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { testStore } = await import("../src/store/tests.ts");
const { subscribe } = await import("../src/core/events.ts");

type PlanDraftSection = import("../src/core/test-prep.ts").PlanDraftSection;

function draft(): PlanDraftSection[] {
	return [
		{
			title: "Section A",
			points: [
				{ text: "Point one", source: "notes.md" },
				{ text: "Point two", source: "notes.md" },
			],
		},
	];
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

describe("test store (test prep, 2026-11-10)", () => {
	it("create stores a record that get reads back", () => {
		const created = testStore.create("Algebra", "Math");

		assert.match(created.id, /^test_[0-9a-z]+_[0-9a-f]{8}$/);
		assert.equal(created.title, "Algebra");
		assert.equal(created.folder, "Math");
		assert.equal(created.planConfirmed, false);
		assert.deepEqual(created.sections, []);
		assert.equal(created.version, 1);

		assert.deepEqual(testStore.get(created.id), created);
	});

	it("get returns null for an unknown id", () => {
		assert.equal(testStore.get("test_never_existed"), null);
	});

	it("list is sorted by updatedAt desc and carries readiness", async () => {
		const first = testStore.create("First");
		await sleep(5);
		const second = testStore.create("Second");

		testStore.savePlan(first.id, draft(), true);
		const points = testStore.get(first.id)!.sections[0]!.points;
		testStore.recordResult(first.id, points[0]!.id, "correct", "chat_1");

		const list = testStore.list();
		assert.ok(
			list.findIndex((test) => test.id === first.id) < list.findIndex((test) => test.id === second.id),
			"the more recently written test comes first",
		);

		const row = list.find((test) => test.id === first.id)!;
		assert.equal(row.title, "First");
		assert.equal(row.planConfirmed, true);
		assert.equal(row.readiness, 0.5, "one of two points is solid");
		assert.equal(list.find((test) => test.id === second.id)!.readiness, 0);
	});

	it("recordResult before the plan is confirmed throws 'plan not confirmed'", () => {
		const test = testStore.create("Unconfirmed");
		const saved = testStore.savePlan(test.id, draft(), false);
		const pointId = saved.sections[0]!.points[0]!.id;

		assert.equal(saved.planConfirmed, false);
		assert.throws(
			() => testStore.recordResult(test.id, pointId, "correct", "chat_1"),
			{ message: "plan not confirmed" },
		);
	});

	it("recordResult on a missing point throws 'unknown point'", () => {
		const test = testStore.create("Missing point");
		testStore.savePlan(test.id, draft(), true);

		assert.throws(
			() => testStore.recordResult(test.id, "point_never_existed", "correct", "chat_1"),
			{ message: "unknown point" },
		);
	});

	it("a plan edit adding a point survives the next answer write (Review Focus 4)", () => {
		const test = testStore.create("Plan edit then answer");
		const confirmed = testStore.savePlan(test.id, draft(), true);
		const sectionId = confirmed.sections[0]!.id;
		const [pointOne, pointTwo] = confirmed.sections[0]!.points;

		// The learner edits the plan while a sitting is open: two existing
		// points stay, a third is added.
		const edited = testStore.savePlan(
			test.id,
			[
				{
					id: sectionId,
					title: "Section A",
					points: [
						{ id: pointOne!.id, text: pointOne!.text, source: pointOne!.source },
						{ id: pointTwo!.id, text: pointTwo!.text, source: pointTwo!.source },
						{ text: "Point three", source: "notes.md" },
					],
				},
			],
			true,
		);
		const addedId = edited.sections[0]!.points[2]!.id;

		// The next answer write re-reads the file, so the added point is not
		// reverted by a stale in-memory plan.
		const answered = testStore.recordResult(test.id, pointOne!.id, "correct", "chat_1");
		const ids = answered.sections[0]!.points.map((point) => point.id);
		assert.deepEqual(ids, [pointOne!.id, pointTwo!.id, addedId]);
		assert.equal(answered.sections[0]!.points[0]!.status, "solid");
	});

	it("get returns null for malformed JSON and never overwrites it", () => {
		const testsDir = path.join(TMP_DATA, "tests");
		fs.mkdirSync(testsDir, { recursive: true });
		const file = path.join(testsDir, "test_broken.json");
		fs.writeFileSync(file, "{ not json");

		assert.equal(testStore.get("test_broken"), null);
		assert.equal(fs.readFileSync(file, "utf-8"), "{ not json", "the unreadable record is left untouched");
	});

	it("every mutation announces tests-changed after the write", () => {
		let announces = 0;
		const off = subscribe((event) => {
			if (event.type === "tests-changed") announces++;
		});

		const test = testStore.create("Events");
		assert.equal(announces, 1, "create announces");

		const saved = testStore.savePlan(test.id, draft(), true);
		assert.equal(announces, 2, "savePlan announces");

		testStore.recordResult(test.id, saved.sections[0]!.points[0]!.id, "correct", "chat_1");
		assert.equal(announces, 3, "recordResult announces");

		off();
	});
});
