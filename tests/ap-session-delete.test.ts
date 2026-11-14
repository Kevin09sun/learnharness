/**
 * FORGET A DELETED SESSION'S ANSWERS (AP prep stage 1, 2026-11-13): an AP
 * sitting writes its answers into the course record, so deleting the session
 * must forget them there — the topic replays its remaining attempts. The
 * course forget is best-effort for a gone course: the session deletion still
 * succeeds. Runs under an isolated LH_DATA_DIR, set before any
 * config-loading import (the test-prep-store discipline).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

// ── the seam, BEFORE any config-loading import ──────────────────────────────
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-ap-session-delete-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { chatStore } = await import("../src/store/chats.ts");
const { apCourseStore } = await import("../src/store/ap-courses.ts");
const { deleteChatSession, deleteIdleChatRecord } = await import("../src/server/chats.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
	delete process.env.LH_DATA_DIR;
});

/** A confirmed one-topic course: the only topic both sittings answer. */
function confirmedCourse(title: string): { courseId: string; topicId: string } {
	const course = apCourseStore.create(title);
	const saved = apCourseStore.savePlan(
		course.id,
		[{ title: "Unit 1", points: [{ text: "Topic 1.1", source: "ced.pdf" }] }],
		true,
	);
	return { courseId: saved.id, topicId: saved.sections[0]!.points[0]!.id };
}

function apChat(title: string, courseId: string): string {
	return chatStore.createChat(title, "ap", undefined, { courseId }).id;
}

function onlyPoint(courseId: string) {
	return apCourseStore.get(courseId)!.sections[0]!.points[0]!;
}

describe("AP session deletion forgets the session's answers (AP prep stage 1, 2026-11-13)", () => {
	it("deleting the second chat replays the topic from the first chat's attempt alone", async () => {
		const { courseId, topicId } = confirmedCourse("Forget the second chat");
		const first = apChat("First sitting", courseId);
		const second = apChat("Second sitting", courseId);

		apCourseStore.recordResult(courseId, topicId, "correct", first);
		apCourseStore.recordResult(courseId, topicId, "wrong", second);
		assert.equal(onlyPoint(courseId).status, "gap", "the second chat's wrong answer is the live verdict before deletion");

		const outcome = await deleteChatSession(second, "preserve-graph");
		assert.equal(outcome.ok, true);
		assert.equal(chatStore.getChat(second), null, "the chat record is gone");

		const point = onlyPoint(courseId);
		assert.equal(point.status, "solid", "the first chat's correct answer alone makes it solid");
		assert.deepEqual(point.history.map((attempt) => attempt.chatId), [first], "the second chat's attempt is forgotten");
	});

	it("deleting a chat with no attempts leaves the course file's bytes unchanged", () => {
		const { courseId } = confirmedCourse("No attempts");
		const chat = apChat("Setup session", courseId);
		const file = path.join(TMP_DATA, "ap", `${courseId}.json`);
		const before = fs.readFileSync(file);

		assert.deepEqual(deleteIdleChatRecord(chat), { ok: true });
		assert.equal(chatStore.getChat(chat), null, "the chat record is gone");
		assert.deepEqual(fs.readFileSync(file), before, "a forget with nothing to erase does not rewrite the course file");
	});

	it("deleting an AP chat whose course file is gone still succeeds", async () => {
		const { courseId } = confirmedCourse("Course gone");
		const chat = apChat("Orphaned sitting", courseId);
		fs.rmSync(path.join(TMP_DATA, "ap", `${courseId}.json`));

		const outcome = await deleteChatSession(chat, "preserve-graph");
		assert.equal(outcome.ok, true, "a missing course is not an error");
		assert.equal(chatStore.getChat(chat), null, "the session deletion stands");
		assert.equal(apCourseStore.get(courseId), null);
	});
});