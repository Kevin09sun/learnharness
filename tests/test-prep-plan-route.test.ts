/**
 * PUT /api/tests/[id]/plan (test prep, 2026-11-10): the plan-review write
 * seam. The pure merge/validation rules live in core/test-prep.ts; this
 * route pins the HTTP contract the plan-review card and the readiness view
 * rely on:
 *   - a draft with problems is a 400 LISTING them, and the record is untouched
 *   - a valid confirm saves through testStore.savePlan (ids on the draft keep
 *     their point status) and answers 200 with the record
 *   - an unknown test is a 404, and a cross-origin mutation is refused
 *   - GET serves the latest record so the card renders the saved plan, not
 *     the tool call's arguments.
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
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-test-prep-plan-route-"));
process.env.LH_DATA_DIR = TMP_DATA;
delete process.env.LH_DESKTOP_SERVER;
delete process.env.LH_DESKTOP_API_SECRET;

const { testStore } = await import("../src/store/tests.ts");

type Route = typeof import("../app/api/tests/[id]/plan/route.ts");
let route: Route;
before(async () => {
	route = await import("../app/api/tests/[id]/plan/route.ts");
});
after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
	delete process.env.LH_DATA_DIR;
});

type PlanDraftSection = import("../src/core/test-prep.ts").PlanDraftSection;

const BASE = "http://localhost";

function draft(): PlanDraftSection[] {
	return [
		{
			title: "Section A",
			points: [
				{ text: "Point one", source: "outline.md" },
				{ text: "Point two", source: "outline.md" },
			],
		},
	];
}

function put(
	id: string,
	body: unknown,
	headers: Record<string, string> = { origin: BASE, "content-type": "application/json" },
): Promise<Response> {
	return route.PUT(
		new Request(`${BASE}/api/tests/${id}/plan`, {
			method: "PUT",
			headers,
			body: JSON.stringify(body),
		}),
		{ params: Promise.resolve({ id }) },
	);
}

function get(id: string): Promise<Response> {
	return route.GET(new Request(`${BASE}/api/tests/${id}/plan`), { params: Promise.resolve({ id }) });
}

describe("GET /api/tests/[id]/plan", () => {
	it("serves the latest saved record", async () => {
		const test = testStore.create("Readable");
		testStore.savePlan(test.id, draft(), true);

		const res = await get(test.id);
		assert.equal(res.status, 200);
		const record = (await res.json()) as { id: string; planConfirmed: boolean; sections: Array<{ title: string }> };
		assert.equal(record.id, test.id);
		assert.equal(record.planConfirmed, true);
		assert.equal(record.sections[0]?.title, "Section A");
	});

	it("is a 404 for an unknown test", async () => {
		const res = await get("test_never_existed");
		assert.equal(res.status, 404);
	});
});

describe("PUT /api/tests/[id]/plan", () => {
	it("rejects an invalid draft with its problems and leaves the record unchanged", async () => {
		const test = testStore.create("Invalid");
		const before = testStore.get(test.id);

		const res = await put(test.id, {
			sections: [{ title: "", points: [{ text: "", source: "" }] }],
			confirm: true,
		});
		assert.equal(res.status, 400);
		const body = (await res.json()) as { problems?: unknown };
		assert.ok(Array.isArray(body.problems), "the response lists the problems");
		assert.ok((body.problems as string[]).length >= 2);
		assert.ok((body.problems as string[]).some((problem) => /title/.test(problem)));
		assert.ok((body.problems as string[]).some((problem) => /needs text/.test(problem)));

		assert.deepEqual(testStore.get(test.id), before, "a refused draft never writes");
	});

	it("confirms a valid draft and answers 200 with the saved record", async () => {
		const test = testStore.create("Confirm");

		const res = await put(test.id, { sections: draft(), confirm: true });
		assert.equal(res.status, 200);
		const record = (await res.json()) as {
			id: string;
			planConfirmed: boolean;
			sections: Array<{ points: Array<{ status: string }> }>;
		};
		assert.equal(record.id, test.id);
		assert.equal(record.planConfirmed, true);
		assert.equal(record.sections[0]?.points.length, 2);
		assert.ok(record.sections[0]?.points.every((point) => point.status === "unchecked"));
		assert.equal(testStore.get(test.id)?.planConfirmed, true);
	});

	it("keeps the status of points whose ids ride the draft", async () => {
		const test = testStore.create("Ids");
		const saved = testStore.savePlan(test.id, draft(), true);
		const section = saved.sections[0]!;
		const [pointOne, pointTwo] = section.points;

		const answered = testStore.recordResult(test.id, pointOne!.id, "correct", "chat_1");
		assert.equal(answered.sections[0]?.points[0]?.status, "solid");

		const res = await put(test.id, {
			sections: [
				{
					id: section.id,
					title: "Section A",
					points: [
						{ id: pointOne!.id, text: pointOne!.text, source: pointOne!.source },
						{ id: pointTwo!.id, text: pointTwo!.text, source: pointTwo!.source },
					],
				},
			],
			confirm: true,
		});
		assert.equal(res.status, 200);

		const afterEdit = testStore.get(test.id)!;
		assert.equal(afterEdit.sections[0]?.points[0]?.status, "solid", "the edit preserved the point's status");
		assert.equal(afterEdit.sections[0]?.id, section.id, "the edit preserved the section id");
	});

	it("is a 404 for an unknown test", async () => {
		const res = await put("test_never_existed", { sections: draft(), confirm: true });
		assert.equal(res.status, 404);
	});

	it("refuses a cross-origin mutation", async () => {
		const test = testStore.create("Cross origin");
		const before = testStore.get(test.id);

		const res = await put(
			test.id,
			{ sections: draft(), confirm: true },
			{ origin: "https://evil.example", "content-type": "application/json" },
		);
		assert.equal(res.status, 403);
		assert.deepEqual(testStore.get(test.id), before, "a refused request never writes");
	});
});