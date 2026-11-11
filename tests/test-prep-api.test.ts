/**
 * GET /api/tests and GET /api/tests/[id] (test prep, 2026-11-10): the read
 * seam behind the Tests list and the readiness page.
 *
 * The list carries each test's title, confirmation and the integer
 * solid/total counts the UI needs for the one count-based percent rule
 * (readinessPercent) — a ratio alone cannot be floored safely. The detail
 * read serves the whole record plus the derived readiness; an unknown id is
 * a 404. Reads are unguarded like every other read route: a cross-origin
 * browser caller may still read, only mutations are refused.
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
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-test-prep-api-"));
process.env.LH_DATA_DIR = TMP_DATA;
delete process.env.LH_DESKTOP_SERVER;
delete process.env.LH_DESKTOP_API_SECRET;

const { testStore } = await import("../src/store/tests.ts");

type ListRoute = typeof import("../app/api/tests/route.ts");
type DetailRoute = typeof import("../app/api/tests/[id]/route.ts");
let listRoute: ListRoute;
let detailRoute: DetailRoute;
before(async () => {
	listRoute = await import("../app/api/tests/route.ts");
	detailRoute = await import("../app/api/tests/[id]/route.ts");
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
				{ text: "Point three", source: "outline.md" },
				{ text: "Point four", source: "outline.md" },
			],
		},
	];
}

/** A confirmed four-point test with two solid points (overall 0.5). */
function seeded(title: string): string {
	const test = testStore.create(title);
	const saved = testStore.savePlan(test.id, draft(), true);
	for (const point of saved.sections[0]!.points.slice(0, 2)) {
		testStore.recordResult(test.id, point.id, "correct", "chat_1");
	}
	return test.id;
}

function get(id: string, headers?: Record<string, string>): Promise<Response> {
	return detailRoute.GET(
		new Request(`${BASE}/api/tests/${id}`, headers === undefined ? undefined : { headers }),
		{ params: Promise.resolve({ id }) },
	);
}

describe("GET /api/tests", () => {
	it("lists each test with the solid/total counts and readiness", async () => {
		const id = seeded("Bio midterm");

		const res = await listRoute.GET();
		assert.equal(res.status, 200);
		const body = (await res.json()) as {
			tests: Array<{
				id: string;
				title: string;
				planConfirmed: boolean;
				readiness: number;
				solid: number;
				total: number;
			}>;
		};
		assert.ok(Array.isArray(body.tests), "the list is an array under `tests`");
		const row = body.tests.find((test) => test.id === id);
		assert.ok(row, "the created test is listed");
		assert.equal(row!.title, "Bio midterm");
		assert.equal(row!.planConfirmed, true);
		assert.equal(row!.solid, 2);
		assert.equal(row!.total, 4);
		assert.equal(row!.readiness, 0.5);
	});
});

describe("GET /api/tests/[id]", () => {
	it("serves the record plus derived readiness", async () => {
		const id = seeded("Readable");

		const res = await get(id);
		assert.equal(res.status, 200);
		const body = (await res.json()) as {
			id: string;
			title: string;
			planConfirmed: boolean;
			sections: Array<{ id: string; title: string }>;
			readiness: {
				overall: number;
				sections: Array<{ id: string; title: string; solid: number; total: number; ratio: number }>;
			};
		};
		assert.equal(body.id, id);
		assert.equal(body.title, "Readable");
		assert.equal(body.planConfirmed, true);
		assert.equal(body.sections[0]?.title, "Section A", "the record rides along unchanged");
		assert.equal(body.readiness.overall, 0.5);
		assert.deepEqual(body.readiness.sections[0], {
			id: body.sections[0]!.id,
			title: "Section A",
			solid: 2,
			total: 4,
			ratio: 0.5,
		});
	});

	it("is a 404 for an unknown test", async () => {
		const res = await get("test_never_existed");
		assert.equal(res.status, 404);
	});

	it("stays readable for a cross-origin caller (reads are unguarded)", async () => {
		const id = seeded("Cross origin read");

		const res = await get(id, { origin: "https://evil.example" });
		assert.equal(res.status, 200);
	});
});