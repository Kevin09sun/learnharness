/**
 * Unit tests — AP core (pure logic, no fs, no server).
 *
 * The course record's document manifest, a sitting's scope and label, and the
 * scoped question queue live in src/core/ap.ts; later tasks (store, tools, UI)
 * import these.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	isCollegeBoardUrl,
	parseApSitting,
	scopedQueue,
	sittingLabel,
	sittingScopeProblem,
	topicInScope,
	type ApCourseRecord,
} from "../src/core/ap.ts";
import { nextQueue, type PointStatus } from "../src/core/test-prep.ts";

const course: ApCourseRecord = {
	id: "apcalc",
	title: "AP Calculus BC",
	createdAt: "2026-11-13T00:00:00.000Z",
	updatedAt: "2026-11-13T00:00:00.000Z",
	planConfirmed: true,
	sections: [
		{
			id: "u1",
			title: "Unit 1 Limits",
			points: [
				{ id: "t11", text: "1.1 Limits intro", source: "CED p. 1", status: "unchecked", history: [] },
				{ id: "t12", text: "1.2 Limits at infinity", source: "CED p. 2", status: "unchecked", history: [] },
			],
		},
		{
			id: "u2",
			title: "Unit 2 Derivatives",
			points: [
				{ id: "t21", text: "2.1 Definition of derivative", source: "CED p. 3", status: "unchecked", history: [] },
			],
		},
	],
	documents: [],
	version: 1,
};

/** A copy of the fixture with one topic's status (and fixedIn) set. */
function withStatus(
	fixture: ApCourseRecord,
	topicId: string,
	status: PointStatus,
	fixedIn?: string,
): ApCourseRecord {
	return {
		...fixture,
		sections: fixture.sections.map((section) => ({
			...section,
			points: section.points.map((point) =>
				point.id === topicId ? { ...point, status, fixedIn } : point,
			),
		})),
	};
}

describe("AP core", () => {
	it("isCollegeBoardUrl accepts https College Board hosts only", () => {
		assert.equal(isCollegeBoardUrl("https://apcentral.collegeboard.org/media/pdf/ap-calculus-ab-and-bc-course-and-exam-description.pdf"), true);
		assert.equal(isCollegeBoardUrl("https://collegeboard.org/x.pdf"), true);
		assert.equal(isCollegeBoardUrl("http://apcentral.collegeboard.org/x.pdf"), false);
		assert.equal(isCollegeBoardUrl("https://collegeboard.org.evil.com/x.pdf"), false);
		assert.equal(isCollegeBoardUrl("https://evilcollegeboard.org/x.pdf"), false);
		assert.equal(isCollegeBoardUrl("not a url"), false);
	});

	it("parseApSitting accepts the three scopes and three kinds, rejects the rest", () => {
		assert.deepEqual(parseApSitting({ scope: { type: "weak" }, kind: "mcq" }), { scope: { type: "weak" }, kind: "mcq" });
		assert.deepEqual(parseApSitting({ scope: { type: "unit", unitId: "u1" }, kind: "mixed" }), { scope: { type: "unit", unitId: "u1" }, kind: "mixed" });
		assert.deepEqual(parseApSitting({ scope: { type: "topic", topicId: "t11" }, kind: "frq" }), { scope: { type: "topic", topicId: "t11" }, kind: "frq" });
		for (const bad of [null, {}, { scope: { type: "unit" }, kind: "mcq" }, { scope: { type: "weak" }, kind: "essay" }, { scope: { type: "topic", topicId: "" }, kind: "mcq" }]) {
			assert.equal(parseApSitting(bad), null);
		}
	});

	it("sittingScopeProblem names a missing unit or topic", () => {
		assert.equal(sittingScopeProblem(course, { type: "weak" }), null);
		assert.equal(sittingScopeProblem(course, { type: "unit", unitId: "u1" }), null);
		assert.match(sittingScopeProblem(course, { type: "unit", unitId: "gone" })!, /unit .* no longer in the course/);
		assert.match(sittingScopeProblem(course, { type: "topic", topicId: "gone" })!, /topic .* no longer in the course/);
	});

	it("scopedQueue: weak = the shared queue; unit = that unit's entries in the same order", () => {
		assert.deepEqual(scopedQueue(course, { type: "weak" }, "c1"), nextQueue(course, "c1"));
		const unit = scopedQueue(course, { type: "unit", unitId: "u1" }, "c1");
		assert.deepEqual(unit.map((e) => e.pointId), nextQueue(course, "c1").map((e) => e.pointId).filter((id) => id === "t11" || id === "t12"));
	});

	it("scopedQueue: a single topic is always asked, solid or not", () => {
		const solid = withStatus(course, "t11", "solid");
		assert.deepEqual(scopedQueue(solid, { type: "topic", topicId: "t11" }, "c1"), [{ pointId: "t11", reason: "review" }]);
		const gap = withStatus(course, "t11", "gap");
		assert.deepEqual(scopedQueue(gap, { type: "topic", topicId: "t11" }, "c1"), [{ pointId: "t11", reason: "gap" }]);
	});

	it("scopedQueue: a topic re-checked in this same chat is still offered in a single-topic sitting", () => {
		const fixedHere = withStatus(course, "t11", "fixed-recheck", "c1");
		assert.deepEqual(scopedQueue(fixedHere, { type: "topic", topicId: "t11" }, "c1"), [{ pointId: "t11", reason: "review" }]);
	});

	it("scopedQueue: a scope that no longer exists yields an empty queue", () => {
		assert.deepEqual(scopedQueue(course, { type: "topic", topicId: "gone" }, "c1"), []);
		assert.deepEqual(scopedQueue(course, { type: "unit", unitId: "gone" }, "c1"), []);
	});

	it("topicInScope follows the scope", () => {
		assert.equal(topicInScope(course, { type: "weak" }, "t21"), true);
		assert.equal(topicInScope(course, { type: "unit", unitId: "u1" }, "t21"), false);
		assert.equal(topicInScope(course, { type: "topic", topicId: "t11" }, "t12"), false);
		assert.equal(topicInScope(course, { type: "weak" }, "gone"), false);
	});

	it("sittingLabel reads as a session title", () => {
		assert.equal(sittingLabel(course, { scope: { type: "unit", unitId: "u1" }, kind: "mcq" }), "AP Calculus BC · Unit 1 Limits · multiple-choice");
		assert.equal(sittingLabel(course, { scope: { type: "weak" }, kind: "mixed" }), "AP Calculus BC · weak topics · mixed");
		assert.equal(sittingLabel(course, { scope: { type: "topic", topicId: "t11" }, kind: "frq" }), "AP Calculus BC · 1.1 Limits intro · free-response");
	});
});