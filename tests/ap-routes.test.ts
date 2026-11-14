/**
 * The AP course routes (AP prep stage 1, 2026-11-13): the read seam behind
 * the course list and the course page, the plan-review/plan-edit seam (Test
 * prep's /api/tests/[id]/plan behaviour over the course store), and the
 * download-the-missing-papers seam.
 *
 * The list carries each course's title, confirmation and the integer
 * solid/total counts the UI needs for the one count-based percent rule. The
 * detail read serves the whole record with each document extended by its
 * LOCAL presence — a `path` only for a paper actually on this computer. The
 * plan route reuses the pure merge/validation rules unchanged: a draft with
 * problems is a 400 LISTING them and never writes, ids ride the draft so an
 * edited topic keeps its status, and a removed topic's history is gone.
 *
 * Documents POST downloads only the papers that are missing and carry a
 * stored url; the route never takes a URL from the request (it re-checks
 * the stored one). A failure is reported per document with a 200 — one bad
 * paper does not hide the others. Tests inject a stub fetch through the
 * ap-papers seam, so nothing here touches the network.
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
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-ap-routes-"));
process.env.LH_DATA_DIR = TMP_DATA;
delete process.env.LH_DESKTOP_SERVER;
delete process.env.LH_DESKTOP_API_SECRET;

const { apCourseStore } = await import("../src/store/ap-courses.ts");
const { apPaperPath, setApPaperFetch } = await import("../src/server/ap-papers.ts");

type ListRoute = typeof import("../app/api/ap/route.ts");
type DetailRoute = typeof import("../app/api/ap/[id]/route.ts");
type PlanRoute = typeof import("../app/api/ap/[id]/plan/route.ts");
type DocumentsRoute = typeof import("../app/api/ap/[id]/documents/route.ts");
let listRoute: ListRoute;
let detailRoute: DetailRoute;
let planRoute: PlanRoute;
let documentsRoute: DocumentsRoute;
before(async () => {
	listRoute = await import("../app/api/ap/route.ts");
	detailRoute = await import("../app/api/ap/[id]/route.ts");
	planRoute = await import("../app/api/ap/[id]/plan/route.ts");
	documentsRoute = await import("../app/api/ap/[id]/documents/route.ts");
});
after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
	delete process.env.LH_DATA_DIR;
});

type PlanDraftSection = import("../src/core/test-prep.ts").PlanDraftSection;
type ApDocument = import("../src/core/ap.ts").ApDocument;

const BASE = "http://localhost";
const PDF = "%PDF-1.7\n% test paper\n";

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

function document(id: string, kind: ApDocument["kind"], file: string, url: string): ApDocument {
	return { id, kind, label: id, url, file };
}

/** Put a real PDF where the route will look for one. */
function writePaper(courseId: string, file: string): void {
	const target = apPaperPath(courseId, file);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, PDF);
}

function get(id: string, headers?: Record<string, string>): Promise<Response> {
	return detailRoute.GET(
		new Request(`${BASE}/api/ap/${id}`, headers === undefined ? undefined : { headers }),
		{ params: Promise.resolve({ id }) },
	);
}

function getPlan(id: string): Promise<Response> {
	return planRoute.GET(new Request(`${BASE}/api/ap/${id}/plan`), { params: Promise.resolve({ id }) });
}

function putPlan(
	id: string,
	body: unknown,
	headers: Record<string, string> = { origin: BASE, "content-type": "application/json" },
): Promise<Response> {
	return planRoute.PUT(
		new Request(`${BASE}/api/ap/${id}/plan`, {
			method: "PUT",
			headers,
			body: JSON.stringify(body),
		}),
		{ params: Promise.resolve({ id }) },
	);
}

function postDocuments(
	id: string,
	body: unknown = {},
	headers: Record<string, string> = { origin: BASE, "content-type": "application/json" },
): Promise<Response> {
	return documentsRoute.POST(
		new Request(`${BASE}/api/ap/${id}/documents`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		}),
		{ params: Promise.resolve({ id }) },
	);
}

/** A Response carrying a PDF body; the final URL is left empty (no check). */
function pdfResponse(): Response {
	return new Response(PDF);
}

describe("GET /api/ap", () => {
	it("lists each course with the solid/total counts and readiness", async () => {
		const course = apCourseStore.create("AP Biology");
		const saved = apCourseStore.savePlan(course.id, draft(), true);
		apCourseStore.recordResult(course.id, saved.sections[0]!.points[0]!.id, "correct", "chat_1");

		const res = await listRoute.GET();
		assert.equal(res.status, 200);
		const body = (await res.json()) as {
			courses: Array<{
				id: string;
				title: string;
				planConfirmed: boolean;
				readiness: number;
				solid: number;
				total: number;
			}>;
		};
		assert.ok(Array.isArray(body.courses), "the list is an array under `courses`");
		const row = body.courses.find((listed) => listed.id === course.id);
		assert.ok(row, "the created course is listed");
		assert.equal(row!.title, "AP Biology");
		assert.equal(row!.planConfirmed, true);
		assert.equal(row!.solid, 1);
		assert.equal(row!.total, 2);
		assert.equal(row!.readiness, 0.5);
	});
});

describe("GET /api/ap/[id]", () => {
	it("serves the record with each document's local presence and a path only when present", async () => {
		const course = apCourseStore.create("AP Chemistry");
		apCourseStore.putDocument(
			course.id,
			document("ced", "ced", "ced.pdf", "https://www.collegeboard.org/ced.pdf"),
		);
		apCourseStore.putDocument(course.id, document("frq", "frq", "frq.pdf", ""));
		writePaper(course.id, "ced.pdf");

		const res = await get(course.id);
		assert.equal(res.status, 200);
		const body = (await res.json()) as {
			id: string;
			title: string;
			documents: Array<{ id: string; file: string; present: boolean; path?: string }>;
		};
		assert.equal(body.id, course.id);
		assert.equal(body.title, "AP Chemistry");

		const ced = body.documents.find((entry) => entry.id === "ced")!;
		assert.equal(ced.present, true, "the paper on disk is present");
		assert.equal(ced.path, apPaperPath(course.id, "ced.pdf"), "the absolute local path rides along");
		assert.equal(path.isAbsolute(ced.path!), true);

		const frq = body.documents.find((entry) => entry.id === "frq")!;
		assert.equal(frq.present, false, "a paper that was never downloaded is absent");
		assert.equal("path" in frq, false, "an absent paper carries no path");
		assert.equal(JSON.stringify(body).includes("%PDF-"), false, "no file contents are served");
	});

	it("is a 404 for an unknown or invalid id", async () => {
		assert.equal((await get("ap_never_existed")).status, 404);

		const invalid = await get("not a valid id");
		assert.equal(invalid.status, 404);
	});

	it("stays readable for a cross-origin caller (reads are unguarded)", async () => {
		const course = apCourseStore.create("AP Physics 1");
		const res = await get(course.id, { origin: "https://evil.example" });
		assert.equal(res.status, 200);
	});
});

describe("GET /api/ap/[id]/plan", () => {
	it("serves the latest saved record", async () => {
		const course = apCourseStore.create("AP Statistics");
		apCourseStore.savePlan(course.id, draft(), true);

		const res = await getPlan(course.id);
		assert.equal(res.status, 200);
		const record = (await res.json()) as {
			id: string;
			planConfirmed: boolean;
			sections: Array<{ title: string }>;
		};
		assert.equal(record.id, course.id);
		assert.equal(record.planConfirmed, true);
		assert.equal(record.sections[0]?.title, "Unit 1");
	});

	it("is a 404 for an unknown course", async () => {
		assert.equal((await getPlan("ap_never_existed")).status, 404);
	});
});

describe("PUT /api/ap/[id]/plan", () => {
	it("rejects an invalid draft with its problems and leaves the record unchanged", async () => {
		const course = apCourseStore.create("AP Invalid");
		const before = apCourseStore.get(course.id);

		const res = await putPlan(course.id, {
			sections: [{ title: "", points: [{ text: "", source: "" }] }],
			confirm: true,
		});
		assert.equal(res.status, 400);
		const body = (await res.json()) as { problems?: unknown };
		assert.ok(Array.isArray(body.problems), "the response lists the problems");
		assert.ok((body.problems as string[]).length >= 2);
		assert.ok((body.problems as string[]).some((problem) => /title/.test(problem)));
		assert.ok((body.problems as string[]).some((problem) => /needs text/.test(problem)));

		assert.deepEqual(apCourseStore.get(course.id), before, "a refused draft never writes");
	});

	it("confirms a valid draft and answers 200 with the saved record", async () => {
		const course = apCourseStore.create("AP Confirm");

		const res = await putPlan(course.id, { sections: draft(), confirm: true });
		assert.equal(res.status, 200);
		const record = (await res.json()) as {
			id: string;
			planConfirmed: boolean;
			sections: Array<{ points: Array<{ status: string }> }>;
		};
		assert.equal(record.id, course.id);
		assert.equal(record.planConfirmed, true);
		assert.equal(record.sections[0]?.points.length, 2);
		assert.ok(record.sections[0]?.points.every((point) => point.status === "unchecked"));
		assert.equal(apCourseStore.get(course.id)?.planConfirmed, true);
	});

	it("keeps the status of a topic whose id rides the draft", async () => {
		const course = apCourseStore.create("AP Ids");
		const saved = apCourseStore.savePlan(course.id, draft(), true);
		const section = saved.sections[0]!;
		const [topicOne, topicTwo] = section.points;

		const answered = apCourseStore.recordResult(course.id, topicOne!.id, "correct", "chat_1");
		assert.equal(answered.sections[0]?.points[0]?.status, "solid");

		const res = await putPlan(course.id, {
			sections: [
				{
					id: section.id,
					title: "Unit 1",
					points: [
						{ id: topicOne!.id, text: topicOne!.text, source: topicOne!.source },
						{ id: topicTwo!.id, text: topicTwo!.text, source: topicTwo!.source },
					],
				},
			],
			confirm: true,
		});
		assert.equal(res.status, 200);

		const afterEdit = apCourseStore.get(course.id)!;
		assert.equal(afterEdit.sections[0]?.points[0]?.status, "solid", "the edit preserved the topic's status");
		assert.equal(afterEdit.sections[0]?.id, section.id, "the edit preserved the unit id");
	});

	it("drops a removed topic's history", async () => {
		const course = apCourseStore.create("AP Removed");
		const saved = apCourseStore.savePlan(course.id, draft(), true);
		const section = saved.sections[0]!;
		const [topicOne, topicTwo] = section.points;
		apCourseStore.recordResult(course.id, topicTwo!.id, "correct", "chat_1");

		// The edit keeps only the first topic.
		const removed = await putPlan(course.id, {
			sections: [
				{
					id: section.id,
					title: "Unit 1",
					points: [{ id: topicOne!.id, text: topicOne!.text, source: topicOne!.source }],
				},
			],
			confirm: true,
		});
		assert.equal(removed.status, 200);
		const afterRemoval = apCourseStore.get(course.id)!;
		assert.equal(afterRemoval.sections[0]?.points.length, 1);
		assert.ok(
			!afterRemoval.sections[0]?.points.some((point) => point.id === topicTwo!.id),
			"the removed topic is gone",
		);

		// Re-adding the same text starts from a clean slate: its history was dropped.
		const readded = await putPlan(course.id, {
			sections: [
				{
					id: section.id,
					title: "Unit 1",
					points: [
						{ id: topicOne!.id, text: topicOne!.text, source: topicOne!.source },
						{ text: topicTwo!.text, source: topicTwo!.source },
					],
				},
			],
			confirm: true,
		});
		assert.equal(readded.status, 200);
		const freshTopic = apCourseStore
			.get(course.id)!
			.sections[0]!.points.find((point) => point.text === topicTwo!.text)!;
		assert.equal(freshTopic.status, "unchecked", "the re-added topic starts unchecked");
		assert.deepEqual(freshTopic.history, [], "the removed topic's history is gone");
	});

	it("is a 404 for an unknown course", async () => {
		const res = await putPlan("ap_never_existed", { sections: draft(), confirm: true });
		assert.equal(res.status, 404);
	});

	it("refuses a cross-origin mutation", async () => {
		const course = apCourseStore.create("AP Cross origin");
		const before = apCourseStore.get(course.id);

		const res = await putPlan(
			course.id,
			{ sections: draft(), confirm: true },
			{ origin: "https://evil.example", "content-type": "application/json" },
		);
		assert.equal(res.status, 403);
		assert.deepEqual(apCourseStore.get(course.id), before, "a refused request never writes");
	});
});

describe("POST /api/ap/[id]/documents", () => {
	it("downloads only the missing papers that carry a stored url", async () => {
		const course = apCourseStore.create("AP Downloads");
		apCourseStore.putDocument(
			course.id,
			document("present", "ced", "present.pdf", "https://www.collegeboard.org/present.pdf"),
		);
		apCourseStore.putDocument(
			course.id,
			document("missing", "frq", "missing.pdf", "https://www.collegeboard.org/missing.pdf"),
		);
		apCourseStore.putDocument(course.id, document("imported", "scoring", "imported.pdf", ""));
		writePaper(course.id, "present.pdf");

		const requested: string[] = [];
		setApPaperFetch((async (input: RequestInfo | URL) => {
			requested.push(String(input));
			return pdfResponse();
		}) as typeof fetch);

		// A URL in the request must be ignored: only the stored manifest is used.
		const res = await postDocuments(course.id, { url: "https://evil.example/attacker.pdf" });
		assert.equal(res.status, 200);
		const body = (await res.json()) as {
			documents: Array<{ id: string; file: string; present: boolean; error?: string }>;
		};

		assert.deepEqual(requested, ["https://www.collegeboard.org/missing.pdf"]);
		assert.ok(!requested.some((url) => url.includes("evil.example")));

		const present = body.documents.find((entry) => entry.id === "present")!;
		assert.equal(present.present, true, "an already-present paper is left alone");
		assert.equal(present.error, undefined);

		const missing = body.documents.find((entry) => entry.id === "missing")!;
		assert.equal(missing.present, true, "the downloaded paper is now present");
		assert.equal(missing.error, undefined);
		assert.equal(fs.readFileSync(apPaperPath(course.id, "missing.pdf"), "utf8"), PDF);

		const imported = body.documents.find((entry) => entry.id === "imported")!;
		assert.equal(imported.present, false, "a document with no url is not downloaded");
		assert.equal(imported.error, undefined);
	});

	it("reports a failure per document and still answers 200", async () => {
		const course = apCourseStore.create("AP Partial");
		apCourseStore.putDocument(
			course.id,
			document("bad", "ced", "bad.pdf", "https://www.collegeboard.org/bad.pdf"),
		);
		apCourseStore.putDocument(
			course.id,
			document("good", "frq", "good.pdf", "https://www.collegeboard.org/good.pdf"),
		);

		setApPaperFetch((async (input: RequestInfo | URL) => {
			const url = String(input);
			return url.endsWith("/bad.pdf") ? new Response("<html>not a paper</html>") : pdfResponse();
		}) as typeof fetch);

		const res = await postDocuments(course.id);
		assert.equal(res.status, 200);
		const body = (await res.json()) as {
			documents: Array<{ id: string; present: boolean; error?: string }>;
		};

		const bad = body.documents.find((entry) => entry.id === "bad")!;
		assert.equal(bad.present, false);
		assert.equal(bad.error, "Not a PDF", "the refusal message rides along");

		const good = body.documents.find((entry) => entry.id === "good")!;
		assert.equal(good.present, true, "one bad paper does not stop the rest");
		assert.equal(good.error, undefined);
	});

	it("is a 404 for an unknown course", async () => {
		const res = await postDocuments("ap_never_existed");
		assert.equal(res.status, 404);
	});

	it("refuses a cross-origin request and downloads nothing", async () => {
		const course = apCourseStore.create("AP Cross origin download");
		apCourseStore.putDocument(
			course.id,
			document("ced", "ced", "ced.pdf", "https://www.collegeboard.org/ced.pdf"),
		);

		let calls = 0;
		setApPaperFetch((async () => {
			calls++;
			return pdfResponse();
		}) as typeof fetch);

		const res = await postDocuments(course.id, {}, { origin: "https://evil.example", "content-type": "application/json" });
		assert.equal(res.status, 403);
		assert.equal(calls, 0, "a refused request never downloads");
	});
});