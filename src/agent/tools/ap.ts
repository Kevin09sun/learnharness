/**
 * THE AP TOOLS (AP prep stage 1, 2026-11-13): the AP tutor's toolset —
 * `ap_save_document` (store the official College Board course description),
 * the three pdf readers over the course's local papers folder,
 * `propose_units` (author the unit/topic list for learner review),
 * `ap_progress` (session kind, readiness, documents, the scoped queue),
 * `ap_mcq` (pose one multiple-choice question; terminates the turn exactly
 * like recall) and `ap_record_result` (apply the graded outcome), plus the
 * read-only learner-filesystem set.
 *
 * The gating law mirrors Test prep's Review Focus 1/5: nothing asks a
 * question or records a result until the learner has confirmed the unit and
 * topic list, the session is a practice sitting, and the topic id is inside
 * the sitting's scope — refusals are retryable tool errors and never call a
 * mutating store method. The committed answer and option notes stay hidden:
 * the app never marks an answer, the tutor's reply is the verdict.
 *
 * Mechanics-only descriptions (the doctrine ruling): the AP method lives in
 * the system prompt (prompts/ap/).
 */

import * as path from "node:path";
import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { apMcqInputObject, apMcqInputProblems } from "../../core/question-core.ts";
import { planProblems, readiness, readinessPercent } from "../../core/test-prep.ts";
import type { AnswerResult, PlanDraftSection } from "../../core/test-prep.ts";
import { scopedQueue, sittingLabel, sittingScopeProblem, topicInScope } from "../../core/ap.ts";
import type { ApCourseRecord, ApDocument, ApSitting } from "../../core/ap.ts";
import type { SearchProvider } from "../../core/search.ts";
import type { EnabledTools } from "../../core/pending.ts";
import { invalidInputResult, questionResult } from "../tool-execute.ts";
import { pdfInfo, parsePageSpec } from "../subagents/pdf-ops.ts";
import { createPdfReadTools } from "./pdf-read.ts";
import { healEncodedArguments, healToolRecord } from "./heal.ts";
import { readTool } from "./read.ts";
import { lsTool } from "./ls.ts";
import { findTool } from "./find.ts";
import { grepTool } from "./grep.ts";
import { jobTools, type JobToolContext } from "./jobs.ts";
import { tutorWebTools } from "./web.ts";

/** The course-storage port this toolset closes over — the four course-record
 *  operations it needs, structurally satisfied by store/ap-courses.ts. The
 *  agent layer never imports store adapters (the ports/factories rule), so
 *  the shape is declared here and the composition root injects the real
 *  store. */
export interface ApCourseStorePort {
	get(id: string): ApCourseRecord | null;
	savePlan(id: string, draft: PlanDraftSection[], confirm: boolean): ApCourseRecord;
	recordResult(id: string, topicId: string, result: AnswerResult, chatId: string): ApCourseRecord;
	putDocument(id: string, doc: ApDocument): ApCourseRecord;
}

/** The local-paper port: the course's folder, presence on this computer, and
 *  the two ways a file arrives — a College Board download or a learner file.
 *  Structurally satisfied by server/ap-papers.ts. */
export interface ApPapersPort {
	dir(courseId: string): string;
	present(courseId: string, file: string): boolean;
	download(courseId: string, url: string, file: string): Promise<{ file: string; bytes: number }>;
	importFile(courseId: string, sourcePath: string, file: string): Promise<{ file: string; bytes: number }>;
}

/** The record-reading context the gates need (the practice-tools idiom). */
export interface ApToolContext {
	chatId: string;
	courseId: string;
	/** Absent = the course's setup session. */
	sitting?: ApSitting;
	courses: ApCourseStorePort;
	papers: ApPapersPort;
	/** THE RARELY-NEEDED SET (the practice-tools idiom): the research job,
	 *  injected by the composition root. Absent (tests, wiring bugs) = absent
	 *  from the registry. */
	jobs?: JobToolContext;
	/** Direct web tools (2026-11-12): the live search provider seam. Present
	 *  = web_search/web_fetch are registered (behind the settings `web`
	 *  switch); absent = not wired (tests / wiring bug), no web tools. */
	search?: () => SearchProvider | null;
}

/** The course description's fixed identity in stage 1. */
const CED_FILE = "ced.pdf";
const CED_ID = "ced";
const CED_FIRST =
	"save the course description with ap_save_document first — the unit and topic list must come from it";

/** The course description is read a few pages at a time: one pdf_extract call
 *  may resolve to at most this many pages, so a whole 200-page CED cannot
 *  flood the model's context or the saved session. */
export const AP_PDF_EXTRACT_MAX_PAGES = 15;
const AP_PDF_EXTRACT_REFUSAL = `Read at most ${AP_PDF_EXTRACT_MAX_PAGES} pages of the course description per call; ask for a specific page range.`;

/** Plain-text result (these tools answer the model in prose, not JSON). */
function textResult(text: string): AgentToolResult<string> {
	return { content: [{ type: "text", text }], details: text };
}

/** Readiness from integer counts: the shared count-based rule (100% only
 *  when every topic is solid, exact integer percentages never undercount). */
function pct(solid: number, total: number): string {
	return `${readinessPercent(solid, total)}%`;
}

function locateTopic(course: ApCourseRecord, topicId: string) {
	for (const unit of course.sections) {
		const topic = unit.points.find((candidate) => candidate.id === topicId);
		if (topic) return { unit, topic };
	}
	return null;
}

/** The shared pre-write gate (Review Focus 1): the course must exist, its
 *  unit and topic list must be confirmed, and the session must be a practice
 *  sitting. Empty result = the call may proceed. */
function listingGateProblems(course: ApCourseRecord | null, sitting: ApSitting | undefined, courseId: string): string[] {
	if (!course) return [`course "${courseId}" was not found`];
	if (!course.planConfirmed) {
		return [
			"the unit and topic list is not confirmed — propose it with propose_units, then wait for the learner to confirm it before asking or recording questions",
		];
	}
	if (!sitting) {
		return [
			"this is the setup session — questions are asked in a practice sitting started from the course page",
		];
	}
	return [];
}

/** The topic half of the same gate: it must exist in the confirmed list and
 *  fall inside the sitting's scope. */
function topicGateProblems(course: ApCourseRecord, sitting: ApSitting, topicId: string): string[] {
	if (!locateTopic(course, topicId)) {
		return [`topicId "${topicId}" is not in the confirmed list — use an id from the list the learner confirmed`];
	}
	if (!topicInScope(course, sitting.scope, topicId)) {
		return [`topicId "${topicId}" is outside this sitting's scope`];
	}
	return [];
}

// ─── ap_save_document ───────────────────────────────────────────────────────

const apSaveDocumentInputObject = Type.Object({
	kind: Type.String({
		description:
			'REQUIRED — the document kind. Stage 1 accepts only "ced" (the Course and Exam Description); ' +
			"free-response and scoring documents arrive in a later version.",
	}),
	label: Type.String({ description: "REQUIRED — a human label, e.g. \"Course and Exam Description (2026)\"." }),
	year: Type.Optional(Type.Integer({ description: "Optional. The document's edition year." })),
	url: Type.Optional(
		Type.String({
			description:
				"An official College Board link to the PDF. Pass exactly one of url or path — never both, never neither.",
		}),
	),
	path: Type.Optional(
		Type.String({
			description:
				"A local PDF path the learner attached. Pass exactly one of url or path — never both, never neither.",
		}),
	),
});

function apSaveDocumentTool(ctx: ApToolContext): AgentTool<typeof apSaveDocumentInputObject> {
	return {
		name: "ap_save_document",
		label: "ap_save_document",
		description:
			"Save the AP course's official Course and Exam Description into the course's local papers folder — " +
			"from a College Board `url` or from a learner file `path` (exactly one). Only kind \"ced\" is accepted " +
			"in this version. Returns the stored file name and page count; pdf_info, pdf_extract and pdf_search read " +
			"it by that file name. A refused download returns the reason as a retryable error.",
		parameters: apSaveDocumentInputObject,
		prepareArguments: (args: unknown) => healEncodedArguments(args, apSaveDocumentInputObject) as never,
		executionMode: "sequential",
		execute: async (_toolCallId, input) => {
			// A sitting could otherwise replace ced.pdf and break every
			// topic's source page — the description is a setup-session write.
			if (ctx.sitting) {
				return invalidInputResult("ap_save_document", [
					"The course description is saved only in the course's setup session, not during a sitting.",
				]);
			}
			if (input.kind !== "ced") {
				return invalidInputResult("ap_save_document", [
					`kind "${input.kind}" is not available yet — only the course description ("ced") is accepted in this version; free-response and scoring documents arrive in a later version`,
				]);
			}
			const hasUrl = typeof input.url === "string" && input.url.trim().length > 0;
			const hasPath = typeof input.path === "string" && input.path.trim().length > 0;
			if (hasUrl === hasPath) {
				return invalidInputResult("ap_save_document", [
					hasUrl
						? "pass exactly one of url or path — not both"
						: "pass one of url or path — a College Board link or a local PDF path",
				]);
			}

			let pages: number;
			try {
				if (hasUrl) await ctx.papers.download(ctx.courseId, input.url!, CED_FILE);
				else await ctx.papers.importFile(ctx.courseId, input.path!, CED_FILE);
				// The PDF tools' own info function: the page count the learner
				// will see, measured from the bytes actually stored.
				const info = await pdfInfo(path.join(ctx.papers.dir(ctx.courseId), CED_FILE));
				pages = info.page_count;
			} catch (error) {
				return invalidInputResult("ap_save_document", [
					error instanceof Error ? error.message : String(error),
				]);
			}

			const doc: ApDocument = {
				id: CED_ID,
				kind: "ced",
				label: input.label,
				...(input.year !== undefined ? { year: input.year } : {}),
				url: hasUrl ? input.url!.trim() : "",
				file: CED_FILE,
				pages,
			};
			ctx.courses.putDocument(ctx.courseId, doc);
			return textResult(
				`Saved ${CED_FILE} (${pages} page${pages === 1 ? "" : "s"}) to this course's papers folder. ` +
					`pdf_info, pdf_extract and pdf_search read it by the file name "${CED_FILE}".`,
			);
		},
	};
}

// ─── propose_units ──────────────────────────────────────────────────────────

const unitTopicInputObject = Type.Object({
	id: Type.Optional(
		Type.String({
			description:
				"Optional. An unchanged topic keeps its progress automatically by matching text (trimmed) — pass ids only when you know them.",
		}),
	),
	text: Type.String({ description: "REQUIRED — one official numbered topic, written as its number and title." }),
	source: Type.String({
		description: "REQUIRED — the course description page this topic came from, so the learner can audit coverage.",
	}),
});

const unitInputObject = Type.Object({
	id: Type.Optional(
		Type.String({
			description:
				"Optional. An unchanged unit is matched by title (trimmed) without an id; pass ids only when you know them.",
		}),
	),
	title: Type.String({ description: "REQUIRED — the unit heading, as the course description writes it." }),
	points: Type.Array(unitTopicInputObject, {
		description: "REQUIRED — the official numbered topics this unit covers (at least one).",
	}),
});

export const proposeUnitsInputObject = Type.Object({
	sections: Type.Array(unitInputObject, {
		description:
			"REQUIRED — the course description's units in its order, each with the numbered topics it covers.",
	}),
});

function proposeUnitsTool(ctx: ApToolContext): AgentTool<typeof proposeUnitsInputObject> {
	return {
		name: "propose_units",
		label: "propose_units",
		description:
			"Propose (or revise) the course's unit and topic list for learner review: units from the course " +
			"description, each holding the official numbered topics it covers, every topic carrying the course " +
			"description page it came from. Validates that every unit has a title and at least one topic, and that " +
			"every topic has text and a source. Refused until the course description has been stored with " +
			"ap_save_document and is present on this computer. Saves the list UNCONFIRMED and ends your move: say " +
			"nothing further that assumes scope, wait for the learner to review and confirm. Call it again whenever " +
			"the learner asks for changes; a revision is unconfirmed again, so ap_mcq and ap_record_result refuse " +
			"until the learner confirms it.",
		parameters: proposeUnitsInputObject,
		prepareArguments: (args: unknown) => healEncodedArguments(args, proposeUnitsInputObject) as never,
		executionMode: "sequential",
		execute: async (_toolCallId, input) => {
			// The design's law: the tutor never changes the unit and topic
			// list during practice — that belongs to the setup session or the
			// course page. Refuse before any store call.
			if (ctx.sitting) {
				return invalidInputResult("propose_units", [
					"The unit and topic list changes only in the course's setup session or on the course page, not during a sitting.",
				]);
			}
			const course = ctx.courses.get(ctx.courseId);
			if (!course) return invalidInputResult("propose_units", [`course "${ctx.courseId}" was not found`]);
			const ced = course.documents.find((document) => document.kind === "ced");
			if (!ced || !ctx.papers.present(ctx.courseId, ced.file)) {
				return invalidInputResult("propose_units", [CED_FIRST]);
			}
			const problems = planProblems(input.sections);
			if (problems.length > 0) return invalidInputResult("propose_units", problems);
			const saved = ctx.courses.savePlan(ctx.courseId, input.sections, false);
			const topics = saved.sections.reduce((total, unit) => total + unit.points.length, 0);
			return textResult(
				`Units proposed with ${saved.sections.length} unit(s) and ${topics} topic(s). ` +
					"The list is UNCONFIRMED: end your turn now and wait for the learner to review it — ap_mcq and " +
					"ap_record_result refuse until the learner confirms. If the learner asks for changes, call " +
					"propose_units again with the revised units; the revision is unconfirmed again.",
			);
		},
	};
}

// ─── ap_progress ────────────────────────────────────────────────────────────

const emptyInputObject = Type.Object({});

function apProgressTool(ctx: ApToolContext): AgentTool<typeof emptyInputObject> {
	return {
		name: "ap_progress",
		label: "ap_progress",
		description:
			"Report where this AP course stands: whether this is the setup session or a practice sitting (with its " +
			"scope and question kind), the readiness overall and per unit, the stored documents and whether each is " +
			"present on this computer, and — in a practice sitting — the topic queue in work order " +
			"(`topicId · reason · unit › topic`, capped at 30). Read-only. Call it at the start of every session, " +
			"then work the queue in order.",
		parameters: emptyInputObject,
		prepareArguments: (args: unknown) => healEncodedArguments(args, emptyInputObject) as never,
		executionMode: "sequential",
		execute: async () => {
			const course = ctx.courses.get(ctx.courseId);
			if (!course) return invalidInputResult("ap_progress", [`course "${ctx.courseId}" was not found`]);

			const sitting = ctx.sitting;
			const lines: string[] = [
				sitting ? `Session: practice — ${sittingLabel(course, sitting)}` : "Session: setup",
			];
			if (sitting) {
				const scopeProblem = sittingScopeProblem(course, sitting.scope);
				if (scopeProblem) lines.push(scopeProblem);
			}
			if (!course.planConfirmed) {
				lines.push(
					"Units and topics: UNCONFIRMED — propose them with propose_units and wait for the learner to confirm before asking questions.",
				);
			}

			const ready = readiness(course);
			const totals = ready.sections.reduce(
				(acc, unit) => ({ solid: acc.solid + unit.solid, total: acc.total + unit.total }),
				{ solid: 0, total: 0 },
			);
			lines.push(`Ready: ${pct(totals.solid, totals.total)} (${totals.solid}/${totals.total} points solid)`);
			for (const unit of ready.sections) {
				lines.push(`${unit.title}: ${pct(unit.solid, unit.total)} (${unit.solid}/${unit.total})`);
			}

			lines.push("", "Documents:");
			for (const document of course.documents) {
				const present = ctx.papers.present(ctx.courseId, document.file);
				lines.push(
					present
						? `${document.file} · ${document.label} · ${document.pages ?? 0} pages`
						: `${document.file} · ${document.label} · MISSING on this computer`,
				);
			}

			if (sitting) {
				const byTopic = new Map<string, { unitTitle: string; text: string }>();
				for (const unit of course.sections) {
					for (const topic of unit.points) {
						byTopic.set(topic.id, { unitTitle: unit.title, text: topic.text });
					}
				}
				const queue = scopedQueue(course, sitting.scope, ctx.chatId)
					.slice(0, 30)
					.map((entry) => {
						const info = byTopic.get(entry.pointId);
						return `${entry.pointId} · ${entry.reason} · ${info?.unitTitle ?? "?"} › ${info?.text ?? ""}`;
					});
				lines.push("", ...(queue.length > 0 ? ["Queue:", ...queue] : ["Queue: nothing left"]));
			}
			return textResult(lines.join("\n"));
		},
	};
}

// ─── ap_mcq ─────────────────────────────────────────────────────────────────

function apMcqTool(ctx: ApToolContext): AgentTool<typeof apMcqInputObject> {
	return {
		name: "ap_mcq",
		label: "ap_mcq",
		description:
			"Ask one multiple-choice question on one topic in this sitting's scope. Exactly four options, exactly " +
			"one correct. correctAnswer and optionNotes (one line per option: why it is right or the specific error " +
			"that leads to it) are your COMMITMENT, written before the learner answers and never revised; NEITHER " +
			"is shown to the learner, and the app never marks the answer — your next reply is the verdict. topicId " +
			"must name a topic in the confirmed list and inside this sitting's scope. ONE question per turn: pose, " +
			"then end your turn. AFTER A MISS this sitting (the topic's last answer in this chat was wrong or " +
			"\"I don't know\") the fresh question MUST carry the short diagnosis in `details` — the right answer and " +
			"where the thinking went wrong; the call is rejected without it.",
		parameters: apMcqInputObject,
		prepareArguments: (args: unknown) => healEncodedArguments(args, apMcqInputObject) as never,
		executionMode: "sequential",
		execute: async (_toolCallId, input) => {
			const course = ctx.courses.get(ctx.courseId);
			const sitting = ctx.sitting;
			const listingProblems = listingGateProblems(course, sitting, ctx.courseId);
			if (listingProblems.length > 0) return invalidInputResult("ap_mcq", listingProblems);
			// The gates above return only when course and sitting are present.
			const confirmedCourse = course!;
			const confirmedSitting = sitting!;
			const topicProblems = topicGateProblems(confirmedCourse, confirmedSitting, input.topicId);
			if (topicProblems.length > 0) return invalidInputResult("ap_mcq", topicProblems);
			const authoring = apMcqInputProblems(input);
			if (authoring.length > 0) return invalidInputResult("ap_mcq", authoring);
			// THE POST-MISS DIAGNOSIS: after a miss in THIS sitting the fresh
			// question must carry the diagnosis on its visible `details`
			// field. Earlier-sitting misses do not gate.
			const located = locateTopic(confirmedCourse, input.topicId);
			const last = located?.topic.history.at(-1);
			const missedThisSitting =
				last !== undefined &&
				last.chatId === ctx.chatId &&
				(last.result === "wrong" || last.result === "dontKnow");
			if (missedThisSitting && (input.details ?? "").trim().length === 0) {
				return invalidInputResult("ap_mcq", [
					"after a miss, put the short explanation (including the right answer) in `details` — the learner sees it with the fresh question",
				]);
			}
			return questionResult();
		},
	};
}

// ─── ap_record_result ───────────────────────────────────────────────────────

const apRecordResultInputObject = Type.Object({
	topicId: Type.String({
		description: "REQUIRED — the topic this outcome belongs to; validated against the confirmed list and the sitting's scope.",
	}),
	result: Type.Union([Type.Literal("correct"), Type.Literal("wrong"), Type.Literal("dontKnow")], {
		description:
			"REQUIRED — the graded outcome as a bare word: correct, wrong, or dontKnow. A right option reached by " +
			"flawed reasoning is never correct; neither is a hint-assisted or self-assessed answer.",
	}),
});

function apRecordResultTool(ctx: ApToolContext): AgentTool<typeof apRecordResultInputObject> {
	return {
		name: "ap_record_result",
		label: "ap_record_result",
		description:
			"Record the learner's graded outcome for one topic: correct, wrong, or dontKnow. Updates the topic's " +
			"status and returns it plus overall readiness. Refused in the setup session, before the list is " +
			"confirmed, and for a topic id not in the sitting's scope. Call it once per graded answer, immediately " +
			"after grading.",
		parameters: apRecordResultInputObject,
		prepareArguments: (args: unknown) => healEncodedArguments(args, apRecordResultInputObject) as never,
		executionMode: "sequential",
		execute: async (_toolCallId, input) => {
			const course = ctx.courses.get(ctx.courseId);
			const sitting = ctx.sitting;
			const listingProblems = listingGateProblems(course, sitting, ctx.courseId);
			if (listingProblems.length > 0) return invalidInputResult("ap_record_result", listingProblems);
			const topicProblems = topicGateProblems(course!, sitting!, input.topicId);
			if (topicProblems.length > 0) return invalidInputResult("ap_record_result", topicProblems);

			const updated = ctx.courses.recordResult(ctx.courseId, input.topicId, input.result, ctx.chatId);
			const located = locateTopic(updated, input.topicId);
			const ready = readiness(updated);
			const totals = ready.sections.reduce(
				(acc, unit) => ({ solid: acc.solid + unit.solid, total: acc.total + unit.total }),
				{ solid: 0, total: 0 },
			);
			return textResult(
				`Topic ${input.topicId} is now ${located?.topic.status ?? "unknown"}.\n` +
					`Overall readiness: ${pct(totals.solid, totals.total)} (${totals.solid}/${totals.total} points solid).`,
			);
		},
	};
}

// ─── the page-capped pdf_extract ────────────────────────────────────────────

/**
 * Wrap the generic pdf_extract for AP: a call that resolves to more than
 * AP_PDF_EXTRACT_MAX_PAGES pages — including `all` on a longer document — is
 * refused before any extraction, as a retryable input problem. Requests within
 * the cap, and a document of 15 pages or fewer, behave exactly as before. The
 * tool's name, schema and description are unchanged; `info` is the pdfInfo
 * page-count seam (injectable for tests).
 */
export function capPdfExtract(
	tool: AgentTool<any>,
	dir: string,
	info: (filePath: string) => Promise<{ page_count: number }> = pdfInfo,
): AgentTool<any> {
	return {
		...tool,
		execute: async (toolCallId, input, signal, onUpdate) => {
			const params = input as { path?: unknown; pages?: unknown } | null;
			const filePath = typeof params?.path === "string" ? params.path : null;
			const pages = typeof params?.pages === "string" ? params.pages : null;
			if (filePath !== null && pages !== null) {
				const root = path.resolve(dir) + path.sep;
				const scoped = path.resolve(dir, filePath);
				if (scoped.startsWith(root)) {
					try {
						const total = (await info(scoped)).page_count;
						if (parsePageSpec(pages, total).length > AP_PDF_EXTRACT_MAX_PAGES) {
							return invalidInputResult("pdf_extract", [AP_PDF_EXTRACT_REFUSAL]);
						}
					} catch {
						// An unreadable path falls through to the tool's own error, unchanged.
					}
				}
			}
			return tool.execute(toolCallId, input, signal, onUpdate);
		},
	};
}

// ─── the registry ───────────────────────────────────────────────────────────

/** The AP tutor's whole registry. The three pdf readers are scoped to the
 *  course's papers folder; there is no web_fetch_pdf, no pdf job and no
 *  demo/visual here. */
export function apTools(ctx: ApToolContext, enabled?: EnabledTools): Record<string, AgentTool<any>> {
	const jobs = ctx.jobs ? jobTools(ctx.jobs) : null;
	const papersDir = ctx.papers.dir(ctx.courseId);
	const pdfTools = createPdfReadTools(papersDir);
	// healToolRecord — the standard argument heal over the WHOLE registry
	// (the practice/teacher/test-prep convention).
	return healToolRecord({
		ap_save_document: apSaveDocumentTool(ctx),
		pdf_info: pdfTools.pdf_info!,
		pdf_extract: capPdfExtract(pdfTools.pdf_extract!, papersDir),
		pdf_search: pdfTools.pdf_search!,
		propose_units: proposeUnitsTool(ctx),
		ap_progress: apProgressTool(ctx),
		ap_mcq: apMcqTool(ctx),
		ap_record_result: apRecordResultTool(ctx),
		read: readTool,
		ls: lsTool,
		find: findTool,
		grep: grepTool,
		...(jobs?.research ? { research: jobs.research } : {}),
		// Direct web tools: the settings `web` switch is the only toggle this
		// registry reads.
		...tutorWebTools(ctx.search, enabled),
	});
}