/**
 * AP COURSE STORE PINS (AP prep stage 1, 2026-11-13): one JSON file per
 * course under data/ap/ holds the units/topics (Test prep sections/points),
 * their progress, and the official-document manifest. Every mutation is a
 * fresh read-modify-write (a plan edit made in the UI must never be
 * reverted by the next answer write), and the degraded read is honest:
 * a file that does not parse — or is not an AP course — reads as absent
 * and is never rewritten. Runs under an isolated LH_DATA_DIR (the
 * chat-birth-stamp discipline: the seam is set before any config-loading
 * import, so every app-module import is dynamic).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

// ── the seam, BEFORE any config-loading import ──────────────────────────────
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-ap-store-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { apCourseStore } = await import("../src/store/ap-courses.ts");
const { readiness } = await import("../src/core/test-prep.ts");
const { subscribe } = await import("../src/core/events.ts");

type PlanDraftSection = import("../src/core/test-prep.ts").PlanDraftSection;

function draft(): PlanDraftSection[] {
	return [
		{
			title: "Unit 1",
			points: [
				{ text: "Topic 1.1", source: "ced.pdf" },
				{ text: "Topic 1.2", source: "ced.pdf" },
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

describe("AP course store (AP prep stage 1, 2026-11-13)", () => {
	it("create stores a record that get reads back", () => {
		const created = apCourseStore.create("AP Biology");

		assert.match(created.id, /^ap_[0-9a-z]+_[0-9a-f]{8}$/);
		assert.equal(created.title, "AP Biology");
		assert.equal(created.planConfirmed, false);
		assert.deepEqual(created.sections, []);
		assert.deepEqual(created.documents, []);
		assert.equal(created.version, 1);

		assert.deepEqual(apCourseStore.get(created.id), created);
	});

	it("get returns null for an unknown id", () => {
		assert.equal(apCourseStore.get("ap_never_existed"), null);
	});

	it("list is sorted by updatedAt desc and carries readiness", async () => {
		const first = apCourseStore.create("First");
		await sleep(5);
		const second = apCourseStore.create("Second");

		apCourseStore.savePlan(first.id, draft(), true);
		const topics = apCourseStore.get(first.id)!.sections[0]!.points;
		apCourseStore.recordResult(first.id, topics[0]!.id, "correct", "chat_1");

		const list = apCourseStore.list();
		assert.ok(
			list.findIndex((course) => course.id === first.id) <
				list.findIndex((course) => course.id === second.id),
			"the more recently written course comes first",
		);

		const row = list.find((course) => course.id === first.id)!;
		assert.equal(row.title, "First");
		assert.equal(row.planConfirmed, true);
		assert.equal(row.readiness, 0.5, "one of two topics is solid");
		assert.equal(list.find((course) => course.id === second.id)!.readiness, 0);
	});

	it("recordResult before the plan is confirmed throws 'plan not confirmed'", () => {
		const course = apCourseStore.create("Unconfirmed");
		const saved = apCourseStore.savePlan(course.id, draft(), false);
		const topicId = saved.sections[0]!.points[0]!.id;

		assert.equal(saved.planConfirmed, false);
		assert.throws(
			() => apCourseStore.recordResult(course.id, topicId, "correct", "chat_1"),
			{ message: "plan not confirmed" },
		);
	});

	it("the confirmation guard comes before the unknown-topic guard", () => {
		const course = apCourseStore.create("Guard order");
		apCourseStore.savePlan(course.id, draft(), false);

		assert.throws(
			() => apCourseStore.recordResult(course.id, "topic_never_existed", "correct", "chat_1"),
			{ message: "plan not confirmed" },
		);
	});

	it("a revision saved unconfirmed clears a prior confirmation", () => {
		const course = apCourseStore.create("Revision");
		const confirmed = apCourseStore.savePlan(course.id, draft(), true);
		assert.equal(confirmed.planConfirmed, true);

		// propose_plan after confirmation saves the revision UNCONFIRMED: the
		// learner has not approved this scope yet, so questions must refuse.
		const revised = apCourseStore.savePlan(course.id, draft(), false);
		assert.equal(revised.planConfirmed, false);
		assert.equal(apCourseStore.get(course.id)!.planConfirmed, false);

		const topicId = revised.sections[0]!.points[0]!.id;
		assert.throws(
			() => apCourseStore.recordResult(course.id, topicId, "correct", "chat_1"),
			{ message: "plan not confirmed" },
		);
	});

	it("recordResult on a missing topic throws 'unknown topic'", () => {
		const course = apCourseStore.create("Missing topic");
		apCourseStore.savePlan(course.id, draft(), true);

		assert.throws(
			() => apCourseStore.recordResult(course.id, "topic_never_existed", "correct", "chat_1"),
			{ message: "unknown topic" },
		);
	});

	it("a plan edit adding a topic survives the next answer write", () => {
		const course = apCourseStore.create("Plan edit then answer");
		const confirmed = apCourseStore.savePlan(course.id, draft(), true);
		const unitId = confirmed.sections[0]!.id;
		const [topicOne, topicTwo] = confirmed.sections[0]!.points;

		// The learner edits the plan while a sitting is open: two existing
		// topics stay, a third is added.
		const edited = apCourseStore.savePlan(
			course.id,
			[
				{
					id: unitId,
					title: "Unit 1",
					points: [
						{ id: topicOne!.id, text: topicOne!.text, source: topicOne!.source },
						{ id: topicTwo!.id, text: topicTwo!.text, source: topicTwo!.source },
						{ text: "Topic 1.3", source: "ced.pdf" },
					],
				},
			],
			true,
		);
		const addedId = edited.sections[0]!.points[2]!.id;

		// The next answer write re-reads the file, so the added topic is not
		// reverted by a stale in-memory plan.
		const answered = apCourseStore.recordResult(course.id, topicOne!.id, "correct", "chat_1");
		const ids = answered.sections[0]!.points.map((point) => point.id);
		assert.deepEqual(ids, [topicOne!.id, topicTwo!.id, addedId]);
		assert.equal(answered.sections[0]!.points[0]!.status, "solid");
	});

	it("get returns null for malformed JSON and never overwrites it", () => {
		const apDir = path.join(TMP_DATA, "ap");
		fs.mkdirSync(apDir, { recursive: true });
		const file = path.join(apDir, "ap_broken.json");
		fs.writeFileSync(file, "{ not json");

		assert.equal(apCourseStore.get("ap_broken"), null);
		assert.equal(fs.readFileSync(file, "utf-8"), "{ not json", "the unreadable record is left untouched");
	});

	it("list skips shape-invalid and non-record files individually; get refuses a shape-invalid record", () => {
		const apDir = path.join(TMP_DATA, "ap");
		fs.mkdirSync(apDir, { recursive: true });
		for (const file of fs.readdirSync(apDir)) fs.rmSync(path.join(apDir, file), { force: true });

		const valid = apCourseStore.create("Valid");
		const badShape = path.join(apDir, "ap_bad_shape.json");
		const badBytes = JSON.stringify({ id: "ap_bad_shape", title: 42 });
		fs.writeFileSync(badShape, badBytes);
		fs.writeFileSync(path.join(apDir, "notes.json"), JSON.stringify({ hello: "world" }));
		fs.writeFileSync(path.join(apDir, "ap_x (1).json"), JSON.stringify({ hello: "world" }));

		assert.deepEqual(
			apCourseStore.list().map((course) => course.id),
			[valid.id],
			"only the valid record is listed — bad shapes and non-course filenames are skipped individually",
		);
		assert.equal(apCourseStore.get("ap_bad_shape"), null, "a wrong-shaped record reads as absent");
		assert.equal(fs.readFileSync(badShape, "utf-8"), badBytes, "the wrong-shaped record is left untouched");
	});

	it("a record without a documents array is not an AP course", () => {
		const course = apCourseStore.create("No documents");
		const file = path.join(TMP_DATA, "ap", `${course.id}.json`);
		const { documents: _documents, ...withoutDocuments } = JSON.parse(fs.readFileSync(file, "utf-8"));
		const handBytes = JSON.stringify(withoutDocuments);
		fs.writeFileSync(file, handBytes);

		assert.equal(apCourseStore.get(course.id), null, "a course record must carry a documents array");
		assert.equal(fs.readFileSync(file, "utf-8"), handBytes, "the wrong-shaped record is left untouched");
	});

	it("putDocument appends, then replaces by id", () => {
		const course = apCourseStore.create("AP Biology");
		apCourseStore.putDocument(course.id, {
			id: "ced",
			kind: "ced",
			label: "CED",
			url: "https://apcentral.collegeboard.org/a.pdf",
			file: "ced.pdf",
		});
		const next = apCourseStore.putDocument(course.id, {
			id: "ced",
			kind: "ced",
			label: "CED (2026)",
			url: "https://apcentral.collegeboard.org/b.pdf",
			file: "ced.pdf",
			pages: 230,
		});
		assert.equal(next.documents.length, 1);
		assert.equal(next.documents[0]!.label, "CED (2026)");
		assert.equal(next.documents[0]!.pages, 230);
	});

	it("forgetChat erases a chat's results and lowers readiness", () => {
		const course = apCourseStore.create("Forget chat");
		const saved = apCourseStore.savePlan(
			course.id,
			[{ title: "Unit 1", points: [{ text: "Topic 1.1", source: "ced.pdf" }] }],
			true,
		);
		const topicId = saved.sections[0]!.points[0]!.id;

		// unchecked + correct → solid, so chat_A is the chat that earned the solid.
		const solid = apCourseStore.recordResult(course.id, topicId, "correct", "chat_A");
		assert.equal(solid.sections[0]!.points[0]!.status, "solid");
		assert.equal(readiness(apCourseStore.get(course.id)!).overall, 1);

		// A chat with no attempt changes nothing and does not write.
		assert.equal(apCourseStore.forgetChat(course.id, "chat_nope"), false);
		assert.equal(readiness(apCourseStore.get(course.id)!).overall, 1);

		// Forgetting the chat that earned the solid erases its result.
		assert.equal(apCourseStore.forgetChat(course.id, "chat_A"), true);
		const after = apCourseStore.get(course.id)!;
		assert.notEqual(after.sections[0]!.points[0]!.status, "solid");
		assert.equal(after.sections[0]!.points[0]!.history.length, 0);
		assert.equal(readiness(after).overall, 0);

		// A missing course returns false.
		assert.equal(apCourseStore.forgetChat("ap_never_existed", "chat_A"), false);
	});

	it("emits ap-changed on create, savePlan, recordResult, putDocument and a changing forgetChat", () => {
		let announces = 0;
		const off = subscribe((event) => {
			if (event.type === "ap-changed") announces++;
		});

		const course = apCourseStore.create("Events");
		assert.equal(announces, 1, "create announces");

		const saved = apCourseStore.savePlan(course.id, draft(), true);
		assert.equal(announces, 2, "savePlan announces");

		apCourseStore.recordResult(course.id, saved.sections[0]!.points[0]!.id, "correct", "chat_1");
		assert.equal(announces, 3, "recordResult announces");

		apCourseStore.putDocument(course.id, {
			id: "ced",
			kind: "ced",
			label: "CED",
			url: "https://apcentral.collegeboard.org/a.pdf",
			file: "ced.pdf",
		});
		assert.equal(announces, 4, "putDocument announces");

		assert.equal(apCourseStore.forgetChat(course.id, "chat_nope"), false);
		assert.equal(announces, 4, "a forgetChat that changes nothing does not announce");

		assert.equal(apCourseStore.forgetChat(course.id, "chat_1"), true);
		assert.equal(announces, 5, "a changing forgetChat announces");

		off();
	});
});