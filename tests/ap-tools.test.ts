/**
 * AP TOOLS (AP prep stage 1): the AP tutor's registry — ap_save_document,
 * the three pdf readers, propose_units, ap_progress, ap_mcq and
 * ap_record_result plus the read-only learner-filesystem set.
 *
 * The gates mirror Test prep's Review Focus 1/5 contract: nothing touches a
 * course record until the unit and topic list is confirmed and the topic id
 * is known, and the refusals are retryable tool errors (invalidInputResult)
 * that leave the fake untouched. ap_mcq poses a pending question exactly like
 * recall (questionResult: terminate) and never reveals its committed answer.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { createFauxCore } from "@earendil-works/pi-ai";

import { applyResult, mergePlan } from "../src/core/test-prep.ts";
import type { AnswerResult, PlanDraftSection } from "../src/core/test-prep.ts";
import type { ApCourseRecord, ApDocument, ApSitting } from "../src/core/ap.ts";
import { QUESTION_TOOLS, toolQuestionKind } from "../src/core/pending.ts";
import { createApAgent } from "../src/agent/teacher-agent.ts";
import { apTools, type ApCourseStorePort, type ApPapersPort, type ApToolContext } from "../src/agent/tools/ap.ts";
import { tinyPdf } from "./helpers/tiny-pdf.ts";

// ── fixtures ─────────────────────────────────────────────────────────────────

const COURSE: ApCourseRecord = {
	id: "ap_course_1",
	title: "AP Calculus BC",
	createdAt: "2026-11-13T00:00:00.000Z",
	updatedAt: "2026-11-13T00:00:00.000Z",
	planConfirmed: true,
	documents: [],
	sections: [
		{
			id: "unit_limits",
			title: "Unit 1 Limits",
			points: [
				{
					id: "t_recheck",
					text: "1.1 Introducing Calculus",
					source: "p. 12",
					status: "fixed-recheck",
					fixedIn: "chat_old",
					history: [],
				},
				{
					id: "t_unchecked",
					text: "1.2 Defining Limits",
					source: "p. 14",
					status: "unchecked",
					history: [],
				},
				{ id: "t_solid", text: "1.3 Estimating", source: "p. 16", status: "solid", history: [] },
			],
		},
		{
			id: "unit_deriv",
			title: "Unit 2 Derivatives",
			points: [
				{ id: "t_gap", text: "2.1 Definition", source: "p. 30", status: "gap", history: [] },
			],
		},
	],
	version: 1,
};

function courseOf(overrides: Partial<ApCourseRecord> = {}): ApCourseRecord {
	return { ...COURSE, ...overrides };
}

const CED: ApDocument = {
	id: "ced",
	kind: "ced",
	label: "Course and Exam Description",
	url: "https://apcentral.collegeboard.org/ced.pdf",
	file: "ced.pdf",
	pages: 3,
};

interface FakeCourseCalls {
	get: string[];
	savePlan: Array<{ id: string; draft: PlanDraftSection[]; confirm: boolean }>;
	recordResult: Array<{ id: string; topicId: string; result: string; chatId: string }>;
	putDocument: Array<{ id: string; doc: ApDocument }>;
}

/** An in-memory fake of the four course-store methods the tools consume.
 *  Every mutation is recorded so a refusal can assert the record never moved. */
function fakeCourses(initial: ApCourseRecord): {
	courses: ApCourseStorePort;
	calls: FakeCourseCalls;
	current: () => ApCourseRecord;
} {
	let current = initial;
	const calls: FakeCourseCalls = { get: [], savePlan: [], recordResult: [], putDocument: [] };
	const courses: ApCourseStorePort = {
		get: (id) => {
			calls.get.push(id);
			return current.id === id ? current : null;
		},
		savePlan: (id, draft, confirm) => {
			calls.savePlan.push({ id, draft, confirm });
			current = {
				...current,
				// Mirror the real store: merge the draft into the record's units
				// (progress survives by id), then record the confirmation state.
				sections: mergePlan(current.sections, draft, () => "generated_topic_id"),
				planConfirmed: confirm,
			};
			return current;
		},
		recordResult: (id, topicId, result, chatId) => {
			calls.recordResult.push({ id, topicId, result, chatId });
			current = {
				...current,
				sections: current.sections.map((section) => ({
					...section,
					points: section.points.map((point) =>
						point.id === topicId
							? applyResult(point, result, chatId, "2026-11-13T01:00:00.000Z")
							: point,
					),
				})),
			};
			return current;
		},
		putDocument: (id, doc) => {
			calls.putDocument.push({ id, doc });
			current = {
				...current,
				documents: [...current.documents.filter((document) => document.id !== doc.id), doc],
			};
			return current;
		},
	};
	return { courses, calls, current: () => current };
}

interface FakePaperCalls {
	dir: string[];
	present: Array<{ courseId: string; file: string }>;
	download: Array<{ courseId: string; url: string; file: string }>;
	importFile: Array<{ courseId: string; sourcePath: string; file: string }>;
}

/** An in-memory fake of the papers port. Downloads and imports write a real
 *  two-page PDF so ap_save_document's pdf_info page count is genuine; files
 *  listed as absent read absent from present(). */
function fakePapers(options: { absent?: string[]; downloadError?: string } = {}): {
	papers: ApPapersPort;
	calls: FakePaperCalls;
	dir: string;
} {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ap-tools-"));
	const calls: FakePaperCalls = { dir: [], present: [], download: [], importFile: [] };
	const twoPages = tinyPdf([
		{ runs: [{ text: "Page one", x: 72, y: 700 }] },
		{ runs: [{ text: "Page two", x: 72, y: 700 }] },
	]);
	const present = (file: string) => !(options.absent ?? []).includes(file);
	const papers: ApPapersPort = {
		dir: (courseId) => {
			calls.dir.push(courseId);
			return dir;
		},
		present: (courseId, file) => {
			calls.present.push({ courseId, file });
			return present(file);
		},
		download: async (courseId, url, file) => {
			calls.download.push({ courseId, url, file });
			if (options.downloadError) throw new Error(options.downloadError);
			fs.writeFileSync(path.join(dir, file), twoPages);
			return { file, bytes: twoPages.byteLength };
		},
		importFile: async (courseId, sourcePath, file) => {
			calls.importFile.push({ courseId, sourcePath, file });
			fs.writeFileSync(path.join(dir, file), twoPages);
			return { file, bytes: twoPages.byteLength };
		},
	};
	return { papers, calls, dir };
}

function ctxOf(
	courses: ApCourseStorePort,
	papers: ApPapersPort,
	sitting?: ApSitting,
): ApToolContext {
	return { chatId: "chat_now", courseId: "ap_course_1", courses, papers, ...(sitting ? { sitting } : {}) };
}

/** A scripted pi engine — the agent factories need one injected (BYOK). */
function fauxEngine() {
	const faux = createFauxCore({});
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

/** The job context fixture: both jobs available keylessly. */
const JOBS = { chatId: "chat_now", jobStore: null as never, spawn: (() => {}) as never, searchAvailable: () => false };

const MCQ_INPUT = {
	topicId: "t_unchecked",
	question: "What is the limit of (x² − 1)/(x − 1) as x approaches 1?",
	options: [
		{ label: "0", value: "a" },
		{ label: "2", value: "b" },
		{ label: "1", value: "c" },
		{ label: "Does not exist", value: "d" },
	],
	correctAnswer: "b",
	optionNotes: [
		"Substituting gives 0/0, not 0.",
		"Factor to (x + 1); the limit is 2.",
		"1 is the point approached, not the limit value.",
		"The two-sided limit exists and equals 2.",
	],
};

const WEAK: ApSitting = { scope: { type: "weak" }, kind: "mcq" };

const DRAFT: PlanDraftSection[] = [
	{
		id: "unit_limits",
		title: "Unit 1 Limits",
		points: [{ id: "t_unchecked", text: "1.2 Defining Limits", source: "p. 14" }],
	},
];

/** The fixture with a topic carrying exactly one prior attempt. */
function withLastAttempt(result: AnswerResult, chatId: string): ApCourseRecord {
	return courseOf({
		sections: COURSE.sections.map((section) => ({
			...section,
			points: section.points.map((point) =>
				point.id === "t_unchecked"
					? { ...point, status: result === "correct" ? "solid" : "gap", history: [{ at: "2026-11-13T01:00:00.000Z", chatId, result }] }
					: point,
			),
		})),
	});
}

// ── the registry ────────────────────────────────────────────────────────────

describe("apTools registry", () => {
	it("carries the AP tools in order plus the read-only learner-filesystem set", () => {
		const { papers } = fakePapers();
		const tools = apTools(ctxOf(fakeCourses(courseOf()).courses, papers));
		assert.deepEqual(Object.keys(tools), [
			"ap_save_document",
			"pdf_info",
			"pdf_extract",
			"pdf_search",
			"propose_units",
			"ap_progress",
			"ap_mcq",
			"ap_record_result",
			"read",
			"ls",
			"find",
			"grep",
		]);
		// No acquire/render tool of its own, no pdf job, no demo/visual.
		for (const forbidden of ["web_fetch_pdf", "pdf", "visual", "demo"]) {
			assert.equal(tools[forbidden], undefined, `${forbidden} must never be registered`);
		}
	});

	it("wires research and the direct web tools when their seams are passed", () => {
		const { papers } = fakePapers();
		const tools = apTools({ ...ctxOf(fakeCourses(courseOf()).courses, papers), jobs: JOBS, search: () => null });
		assert.ok(tools.research, "research present with a jobs context");
		assert.ok(tools.web_search && tools.web_fetch, "web tools present with a search seam");
	});

	it("no jobs or search seam → neither research nor web tools", () => {
		const { papers } = fakePapers();
		const tools = apTools(ctxOf(fakeCourses(courseOf()).courses, papers));
		assert.equal(tools.research, undefined);
		assert.equal(tools.web_search, undefined);
		assert.equal(tools.web_fetch, undefined);
	});

	it("web:false removes only the web tools", () => {
		const { papers } = fakePapers();
		const base = { ...ctxOf(fakeCourses(courseOf()).courses, papers), jobs: JOBS, search: () => null };
		const off = apTools(base, { web: false, research: false, pdf: false });
		assert.equal(off.web_search, undefined);
		assert.equal(off.web_fetch, undefined);
		const withoutWeb = Object.keys(apTools(base)).filter(
			(name) => name !== "web_search" && name !== "web_fetch",
		);
		assert.deepEqual(Object.keys(off), withoutWeb);
	});

	it("ap_mcq is a question tool: it folds onto the quiz kind (the turn pauses)", () => {
		assert.ok((QUESTION_TOOLS as readonly string[]).includes("ap_mcq"));
		assert.equal(toolQuestionKind("ap_mcq"), "quiz");
	});
});

// ── ap_save_document ────────────────────────────────────────────────────────

describe("ap_save_document", () => {
	it("downloads a url to ced.pdf and stores a ced document with the real page count", async () => {
		const fake = fakeCourses(courseOf());
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers)).ap_save_document!;
		const result = await tool.execute("call_save", {
			kind: "ced",
			label: "Course and Exam Description (2026)",
			year: 2026,
			url: "https://apcentral.collegeboard.org/ced.pdf",
		} as never);

		assert.equal(result.isError, undefined);
		assert.deepEqual(papers.calls.download, [
			{ courseId: "ap_course_1", url: "https://apcentral.collegeboard.org/ced.pdf", file: "ced.pdf" },
		]);
		assert.equal(fake.calls.putDocument.length, 1);
		const stored = fake.calls.putDocument[0]!;
		assert.equal(stored.id, "ap_course_1");
		assert.equal(stored.doc.id, "ced");
		assert.equal(stored.doc.kind, "ced");
		assert.equal(stored.doc.file, "ced.pdf");
		assert.equal(stored.doc.label, "Course and Exam Description (2026)");
		assert.equal(stored.doc.year, 2026);
		assert.equal(stored.doc.url, "https://apcentral.collegeboard.org/ced.pdf");
		assert.equal(stored.doc.pages, 2, "the page count comes from the stored PDF");
		const text = (result.content[0] as { text: string }).text;
		assert.match(text, /ced\.pdf/);
		assert.match(text, /2 pages/);
		assert.match(text, /pdf_info/);
		assert.match(text, /pdf_extract/);
		assert.match(text, /pdf_search/);
	});

	it("imports a learner path to ced.pdf", async () => {
		const fake = fakeCourses(courseOf());
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers)).ap_save_document!;
		const result = await tool.execute("call_save", {
			kind: "ced",
			label: "Course and Exam Description",
			path: "C:/learner/ced.pdf",
		} as never);

		assert.equal(result.isError, undefined);
		assert.deepEqual(papers.calls.importFile, [
			{ courseId: "ap_course_1", sourcePath: "C:/learner/ced.pdf", file: "ced.pdf" },
		]);
		assert.equal(papers.calls.download.length, 0);
		assert.equal(fake.calls.putDocument[0]!.doc.url, "", "an imported file carries no source link");
	});

	it("REFUSES both url and path, and neither", async () => {
		const fake = fakeCourses(courseOf());
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers)).ap_save_document!;
		for (const input of [
			{ kind: "ced", label: "CED", url: "https://apcentral.collegeboard.org/ced.pdf", path: "C:/learner/ced.pdf" },
			{ kind: "ced", label: "CED" },
		]) {
			const result = await tool.execute("call_save", input as never);
			assert.equal(result.isError, true);
			assert.match((result.details as { problems: string[] }).problems[0]!, /one of url or path/i);
		}
		assert.equal(papers.calls.download.length, 0);
		assert.equal(papers.calls.importFile.length, 0);
	});

	it("surfaces a refused download as a retryable input problem, never a throw", async () => {
		const fake = fakeCourses(courseOf());
		const papers = fakePapers({ downloadError: "Only College Board addresses are accepted" });
		const tool = apTools(ctxOf(fake.courses, papers.papers)).ap_save_document!;
		const result = await tool.execute("call_save", {
			kind: "ced",
			label: "CED",
			url: "https://example.com/ced.pdf",
		} as never);
		assert.equal(result.isError, true);
		assert.match((result.details as { problems: string[] }).problems[0]!, /Only College Board addresses are accepted/);
		assert.equal(fake.calls.putDocument.length, 0, "a refused download stores nothing");
	});

	it("REFUSES kinds stage 1 does not carry yet", async () => {
		const fake = fakeCourses(courseOf());
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers)).ap_save_document!;
		const result = await tool.execute("call_save", { kind: "frq", label: "FRQ", url: "https://apcentral.collegeboard.org/frq.pdf" } as never);
		assert.equal(result.isError, true);
		assert.match((result.details as { problems: string[] }).problems[0]!, /later version/i);
		assert.equal(papers.calls.download.length, 0);
	});

	it("REFUSES inside a practice sitting without touching a port or the record", async () => {
		const fake = fakeCourses(courseOf());
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers, WEAK)).ap_save_document!;
		for (const input of [
			{ kind: "ced", label: "Course and Exam Description", url: "https://apcentral.collegeboard.org/ced.pdf" },
			{ kind: "ced", label: "Course and Exam Description", path: "C:/learner/ced.pdf" },
		]) {
			const result = await tool.execute("call_save", input as never);
			assert.equal(result.isError, true);
			assert.equal(
				(result.details as { problems: string[] }).problems[0],
				"The course description is saved only in the course's setup session, not during a sitting.",
			);
		}
		assert.equal(papers.calls.download.length, 0);
		assert.equal(papers.calls.importFile.length, 0);
		assert.equal(fake.calls.putDocument.length, 0);
	});
});

// ── propose_units ───────────────────────────────────────────────────────────

describe("propose_units", () => {
	it("REFUSES before a stored ced document is present", async () => {
		const fake = fakeCourses(courseOf());
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers)).propose_units!;
		const result = await tool.execute("call_plan", { sections: DRAFT } as never);
		assert.equal(result.isError, true);
		assert.equal(
			(result.details as { problems: string[] }).problems[0],
			"save the course description with ap_save_document first — the unit and topic list must come from it",
		);
		assert.equal(fake.calls.savePlan.length, 0);
	});

	it("REFUSES when the ced document is recorded but missing on this computer", async () => {
		const fake = fakeCourses(courseOf({ documents: [CED] }));
		const papers = fakePapers({ absent: ["ced.pdf"] });
		const tool = apTools(ctxOf(fake.courses, papers.papers)).propose_units!;
		const result = await tool.execute("call_plan", { sections: DRAFT } as never);
		assert.equal(result.isError, true);
		assert.match((result.details as { problems: string[] }).problems[0]!, /ap_save_document first/);
		assert.equal(fake.calls.savePlan.length, 0);
	});

	it("saves a valid unit and topic draft UNCONFIRMED", async () => {
		const fake = fakeCourses(courseOf({ documents: [CED], planConfirmed: false }));
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers)).propose_units!;
		const result = await tool.execute("call_plan", { sections: DRAFT } as never);
		assert.equal(result.isError, undefined);
		assert.equal(fake.calls.savePlan.length, 1);
		assert.equal(fake.calls.savePlan[0]!.confirm, false);
		assert.deepEqual(fake.calls.savePlan[0]!.draft, DRAFT);
		const text = (result.content[0] as { text: string }).text;
		assert.match(text, /UNCONFIRMED/);
		assert.match(text, /1 unit\(s\)/);
		assert.match(text, /1 topic\(s\)/);
	});

	it("REFUSES an empty unit without touching the record", async () => {
		const fake = fakeCourses(courseOf({ documents: [CED] }));
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers)).propose_units!;
		const result = await tool.execute("call_plan", { sections: [{ title: "", points: [] }] } as never);
		assert.equal(result.isError, true);
		assert.equal(fake.calls.savePlan.length, 0);
	});

	it("REFUSES inside a practice sitting without touching the record", async () => {
		const fake = fakeCourses(courseOf({ documents: [CED] }));
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers, WEAK)).propose_units!;
		const result = await tool.execute("call_plan", { sections: DRAFT } as never);
		assert.equal(result.isError, true);
		assert.equal(
			(result.details as { problems: string[] }).problems[0],
			"The unit and topic list changes only in the course's setup session or on the course page, not during a sitting.",
		);
		assert.equal(fake.calls.savePlan.length, 0);
		assert.equal(fake.current().planConfirmed, true, "a sitting call never unconfirms the course");
	});
});

// ── ap_progress ─────────────────────────────────────────────────────────────

describe("ap_progress", () => {
	it("names the setup session and its unconfirmed list, with no queue", async () => {
		const fake = fakeCourses(courseOf({ planConfirmed: false }));
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers)).ap_progress!;
		const result = await tool.execute("call_p", {} as never);
		assert.equal(result.isError, undefined);
		const text = (result.content[0] as { text: string }).text;
		assert.equal(text.split("\n")[0], "Session: setup");
		assert.match(text, /Units and topics: UNCONFIRMED/);
		assert.doesNotMatch(text, /Queue:/);
	});

	it("reports the practice sitting's label, readiness, and scoped queue", async () => {
		const fake = fakeCourses(courseOf());
		const papers = fakePapers();
		const sitting: ApSitting = { scope: { type: "topic", topicId: "t_solid" }, kind: "mcq" };
		const tool = apTools(ctxOf(fake.courses, papers.papers, sitting)).ap_progress!;
		const result = await tool.execute("call_p", {} as never);
		const text = (result.content[0] as { text: string }).text;
		assert.match(text, /^Session: practice — AP Calculus BC · 1\.3 Estimating · multiple-choice$/m);
		assert.match(text, /Ready: 25% \(1\/4 points solid\)/);
		assert.match(text, /Unit 1 Limits: 33% \(1\/3\)/);
		assert.match(text, /Unit 2 Derivatives: 0% \(0\/1\)/);
		assert.match(text, /^t_solid · review · Unit 1 Limits › 1\.3 Estimating$/m);
	});

	it("marks a recorded document missing on this computer", async () => {
		const fake = fakeCourses(courseOf({ documents: [CED] }));
		const papers = fakePapers({ absent: ["ced.pdf"] });
		const tool = apTools(ctxOf(fake.courses, papers.papers)).ap_progress!;
		const result = await tool.execute("call_p", {} as never);
		const text = (result.content[0] as { text: string }).text;
		assert.match(text, /ced\.pdf · Course and Exam Description · MISSING on this computer/);
	});

	it("lists a present document by page count", async () => {
		const fake = fakeCourses(courseOf({ documents: [CED] }));
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers)).ap_progress!;
		const result = await tool.execute("call_p", {} as never);
		const text = (result.content[0] as { text: string }).text;
		assert.match(text, /ced\.pdf · Course and Exam Description · 3 pages/);
	});

	it("reports a sitting whose scope no longer exists", async () => {
		const fake = fakeCourses(courseOf());
		const papers = fakePapers();
		const sitting: ApSitting = { scope: { type: "unit", unitId: "unit_gone" }, kind: "mcq" };
		const tool = apTools(ctxOf(fake.courses, papers.papers, sitting)).ap_progress!;
		const result = await tool.execute("call_p", {} as never);
		const text = (result.content[0] as { text: string }).text;
		assert.match(text, /the unit this sitting was started on is no longer in the course/);
	});
});

// ── ap_mcq ──────────────────────────────────────────────────────────────────

describe("ap_mcq", () => {
	function assertNoMutation(calls: FakeCourseCalls) {
		assert.equal(calls.savePlan.length, 0);
		assert.equal(calls.recordResult.length, 0);
		assert.equal(calls.putDocument.length, 0);
	}

	it("REFUSES when the course does not exist", async () => {
		const fake = fakeCourses(courseOf());
		fake.courses.get = () => null;
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers, WEAK)).ap_mcq!;
		const result = await tool.execute("call_q", MCQ_INPUT as never);
		assert.equal(result.isError, true);
		assert.match((result.details as { problems: string[] }).problems[0]!, /not found/i);
		assertNoMutation(fake.calls);
	});

	it("REFUSES before the unit and topic list is confirmed", async () => {
		const fake = fakeCourses(courseOf({ planConfirmed: false }));
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers, WEAK)).ap_mcq!;
		const result = await tool.execute("call_q", MCQ_INPUT as never);
		assert.equal(result.isError, true);
		assert.match((result.details as { problems: string[] }).problems[0]!, /not confirmed/i);
		assertNoMutation(fake.calls);
	});

	it("REFUSES in the setup session", async () => {
		const fake = fakeCourses(courseOf());
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers)).ap_mcq!;
		const result = await tool.execute("call_q", MCQ_INPUT as never);
		assert.equal(result.isError, true);
		assert.equal(
			(result.details as { problems: string[] }).problems[0],
			"this is the setup session — questions are asked in a practice sitting started from the course page",
		);
		assertNoMutation(fake.calls);
	});

	it("REFUSES a topic id not in the confirmed list", async () => {
		const fake = fakeCourses(courseOf());
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers, WEAK)).ap_mcq!;
		const result = await tool.execute("call_q", { ...MCQ_INPUT, topicId: "t_ghost" } as never);
		assert.equal(result.isError, true);
		assert.match((result.details as { problems: string[] }).problems[0]!, /not in the confirmed list/);
		assertNoMutation(fake.calls);
	});

	it("REFUSES a topic outside the sitting's scope", async () => {
		const fake = fakeCourses(courseOf());
		const papers = fakePapers();
		const sitting: ApSitting = { scope: { type: "unit", unitId: "unit_limits" }, kind: "mcq" };
		const tool = apTools(ctxOf(fake.courses, papers.papers, sitting)).ap_mcq!;
		const result = await tool.execute("call_q", { ...MCQ_INPUT, topicId: "t_gap" } as never);
		assert.equal(result.isError, true);
		assert.match((result.details as { problems: string[] }).problems[0]!, /outside this sitting's scope/);
		assertNoMutation(fake.calls);
	});

	it("REFUSES an authoring-invalid question", async () => {
		const fake = fakeCourses(courseOf());
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers, WEAK)).ap_mcq!;
		const result = await tool.execute("call_q", { ...MCQ_INPUT, options: MCQ_INPUT.options.slice(0, 3) } as never);
		assert.equal(result.isError, true);
		assert.match((result.details as { problems: string[] }).problems[0]!, /exactly four options/);
		assertNoMutation(fake.calls);
	});

	it("REFUSES a fresh question after a miss this sitting without details", async () => {
		for (const result of ["wrong", "dontKnow"] as const) {
			const fake = fakeCourses(withLastAttempt(result, "chat_now"));
			const papers = fakePapers();
			const tool = apTools(ctxOf(fake.courses, papers.papers, WEAK)).ap_mcq!;
			const refused = await tool.execute("call_q", MCQ_INPUT as never);
			assert.equal(refused.isError, true);
			assert.match((refused.details as { problems: string[] }).problems[0]!, /after a miss, put the short explanation/i);
			assertNoMutation(fake.calls);
		}
	});

	it("poses the pending question and ends the turn exactly like recall", async () => {
		const fake = fakeCourses(courseOf());
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers, WEAK)).ap_mcq!;
		const result = await tool.execute("call_q", { ...MCQ_INPUT, details: "Factor first." } as never);
		assert.equal(result.isError, undefined);
		assert.equal(result.terminate, true);
		assert.match((result.content[0] as { text: string }).text, /Question posed/);
		assert.equal(tool.executionMode, "sequential");
		assertNoMutation(fake.calls);
	});

	it("accepts the fresh question when details carries the post-miss diagnosis", async () => {
		const fake = fakeCourses(withLastAttempt("wrong", "chat_now"));
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers, WEAK)).ap_mcq!;
		const result = await tool.execute("call_q", { ...MCQ_INPUT, details: "The limit is 2, not 0." } as never);
		assert.equal(result.isError, undefined);
		assert.equal(result.terminate, true);
	});
});

// ── ap_record_result ────────────────────────────────────────────────────────

describe("ap_record_result", () => {
	it("REFUSES in a setup session without calling the store", async () => {
		const fake = fakeCourses(courseOf());
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers)).ap_record_result!;
		const result = await tool.execute("call_r", { topicId: "t_unchecked", result: "correct" } as never);
		assert.equal(result.isError, true);
		assert.match((result.details as { problems: string[] }).problems[0]!, /setup session/);
		assert.equal(fake.calls.recordResult.length, 0);
	});

	it("REFUSES a topic outside the sitting's scope", async () => {
		const fake = fakeCourses(courseOf());
		const papers = fakePapers();
		const sitting: ApSitting = { scope: { type: "unit", unitId: "unit_limits" }, kind: "mcq" };
		const tool = apTools(ctxOf(fake.courses, papers.papers, sitting)).ap_record_result!;
		const result = await tool.execute("call_r", { topicId: "t_gap", result: "correct" } as never);
		assert.equal(result.isError, true);
		assert.match((result.details as { problems: string[] }).problems[0]!, /outside this sitting's scope/);
		assert.equal(fake.calls.recordResult.length, 0);
	});

	it("records the outcome and reports the topic's status and overall readiness", async () => {
		const fake = fakeCourses(courseOf());
		const papers = fakePapers();
		const tool = apTools(ctxOf(fake.courses, papers.papers, WEAK)).ap_record_result!;
		const result = await tool.execute("call_r", { topicId: "t_unchecked", result: "correct" } as never);
		assert.equal(result.isError, undefined);
		assert.deepEqual(fake.calls.recordResult[0], {
			id: "ap_course_1",
			topicId: "t_unchecked",
			result: "correct",
			chatId: "chat_now",
		});
		const text = (result.content[0] as { text: string }).text;
		assert.match(text, /solid/);
		assert.match(text, /readiness/i);
	});
});

// ── the agent factory ───────────────────────────────────────────────────────

describe("createApAgent", () => {
	it("carries the registry and forwards the web switch", () => {
		const fake = fakeCourses(courseOf());
		const papers = fakePapers();
		const ctx = { ...ctxOf(fake.courses, papers.papers, WEAK), jobs: JOBS, search: () => null };
		const on = createApAgent(ctx, { engine: fauxEngine() });
		const onNames = on.state.tools.map((tool) => tool.name);
		for (const name of Object.keys(apTools(ctx))) {
			assert.ok(onNames.includes(name), `${name} reaches the agent`);
		}
		assert.ok(onNames.includes("web_search") && onNames.includes("web_fetch"), "the search seam reaches the registry");

		const off = createApAgent(ctx, { engine: fauxEngine(), toolToggles: { web: false } });
		const offNames = off.state.tools.map((tool) => tool.name);
		assert.ok(!offNames.includes("web_search") && !offNames.includes("web_fetch"));
		assert.ok(offNames.includes("ap_mcq"));
	});
});