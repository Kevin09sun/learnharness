/**
 * POST /api/chats for kind "ap" (2026-11-13): an AP session names exactly
 * one course — a new one by title (the course's setup session) or an
 * existing one by id (optionally scoped to a sitting). The route validates
 * before it creates anything: an existing course must be known, a sitting
 * only rides an existing course, its shape must parse, and its scope must
 * still exist in the course.
 *
 * Runs under an isolated LH_DATA_DIR, set before any config-loading import
 * (the test-prep-store discipline).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";

// ── the seam, BEFORE any config-loading import ──────────────────────────────
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-ap-api-"));
process.env.LH_DATA_DIR = TMP_DATA;
delete process.env.LH_DESKTOP_SERVER;
delete process.env.LH_DESKTOP_API_SECRET;

const { chatStore } = await import("../src/store/chats.ts");
const { apCourseStore } = await import("../src/store/ap-courses.ts");

type ChatsRoute = typeof import("../app/api/chats/route.ts");
let route: ChatsRoute;
before(async () => {
	route = await import("../app/api/chats/route.ts");
});
after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
	delete process.env.LH_DATA_DIR;
});

const BASE = "http://localhost";

function post(body: unknown): Promise<Response> {
	return route.POST(
		new Request(`${BASE}/api/chats`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

/** A course with one confirmed-able unit, so a unit sitting has a live scope. */
function courseWithUnit(title: string): { id: string; unitId: string; topicId: string } {
	const course = apCourseStore.create(title);
	const saved = apCourseStore.savePlan(
		course.id,
		[{ title: "Unit 1", points: [{ text: "Topic 1", source: "ced" }] }],
		false,
	);
	return { id: saved.id, unitId: saved.sections[0]!.id, topicId: saved.sections[0]!.points[0]!.id };
}

describe("POST /api/chats (kind: ap)", () => {
	it("creates a course from apCourseTitle and links the setup session to it", async () => {
		const res = await post({ title: "AP Calculus BC", kind: "ap", apCourseTitle: "AP Calculus BC" });
		assert.equal(res.status, 200);
		const { id } = (await res.json()) as { id: string };
		const chat = chatStore.getChat(id);
		assert.equal(chat?.kind, "ap");
		assert.ok(chat?.apCourseId, "the session carries a course id");
		assert.equal(chat?.apSitting, undefined, "a new course starts with its setup session");
		assert.equal("testId" in chat!, false);
		const course = apCourseStore.get(chat!.apCourseId!);
		assert.equal(course?.title, "AP Calculus BC");
	});

	it("links an existing course by apCourseId, carrying a valid sitting", async () => {
		const course = courseWithUnit("AP Biology");
		const sitting = { scope: { type: "unit", unitId: course.unitId }, kind: "mcq" };
		const res = await post({ title: "Continue", kind: "ap", apCourseId: course.id, apSitting: sitting });
		assert.equal(res.status, 200);
		const { id } = (await res.json()) as { id: string };
		const chat = chatStore.getChat(id);
		assert.equal(chat?.apCourseId, course.id);
		assert.deepEqual(chat?.apSitting, sitting, "the parsed sitting rides the record");
	});

	it("refuses an unknown apCourseId with a 404", async () => {
		const res = await post({ title: "Ghost", kind: "ap", apCourseId: "ap_never_existed" });
		assert.equal(res.status, 404);
		const body = (await res.json()) as { error: string };
		assert.equal(body.error, "Unknown AP course");
	});

	it("refuses both or neither course name (a blank title counts as absent) with a 400", async () => {
		const course = courseWithUnit("AP Chemistry");
		for (const body of [
			{ title: "Both", kind: "ap", apCourseTitle: "A", apCourseId: course.id },
			{ title: "Neither", kind: "ap" },
			{ title: "Blank", kind: "ap", apCourseTitle: "   " },
		]) {
			const res = await post(body);
			assert.equal(res.status, 400, JSON.stringify(body));
			assert.equal(
				((await res.json()) as { error: string }).error,
				"An AP session names a new course by title or an existing course by id.",
			);
		}
	});

	it("refuses a sitting on a new course (the setup session) before creating the course", async () => {
		const countBefore = apCourseStore.list().length;
		const res = await post({
			title: "New course with a sitting",
			kind: "ap",
			apCourseTitle: "AP Physics 1",
			apSitting: { scope: { type: "weak" }, kind: "mcq" },
		});
		assert.equal(res.status, 400);
		assert.equal(((await res.json()) as { error: string }).error, "A new course starts with its setup session.");
		assert.equal(apCourseStore.list().length, countBefore, "no course record was created");
	});

	it("refuses a malformed sitting with a 400", async () => {
		const course = courseWithUnit("AP Statistics");
		const res = await post({
			title: "Bad sitting",
			kind: "ap",
			apCourseId: course.id,
			apSitting: { scope: { type: "unit", unitId: "" }, kind: "mcq" },
		});
		assert.equal(res.status, 400);
		assert.equal(((await res.json()) as { error: string }).error, "Invalid AP sitting.");
	});

	it("refuses a sitting naming a unit that was removed from the course", async () => {
		const course = courseWithUnit("AP World History");
		// The edit drops Unit 1 and adds a different one.
		apCourseStore.savePlan(
			course.id,
			[{ title: "Unit 2", points: [{ text: "Topic 2", source: "ced" }] }],
			false,
		);
		const res = await post({
			title: "Removed unit",
			kind: "ap",
			apCourseId: course.id,
			apSitting: { scope: { type: "unit", unitId: course.unitId }, kind: "mcq" },
		});
		assert.equal(res.status, 400);
		assert.equal(
			((await res.json()) as { error: string }).error,
			"the unit this sitting was started on is no longer in the course",
		);
	});
});