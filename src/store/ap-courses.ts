/**
 * ApCourseStore — the fs JSON adapter for AP course records (one file per
 * course in data/ap/).
 *
 * A course holds the plan (units of official topics) plus each topic's
 * progress across sittings, and the manifest of official documents that
 * syncs with it; the pure rules live in core/test-prep.ts and
 * core/ap.ts. Every mutation is a fresh read-modify-write (a plan edit
 * made while a sitting is open must not be reverted by the next answer)
 * and announces "ap-changed" post-write. Idioms match the test store:
 * sync fs, tiny records, id-guarded filenames, the shared atomic writer.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import { applyResult, forgetChatInPoint, mergePlan, readiness } from "../core/test-prep.ts";
import type { AnswerResult, PlanDraftSection } from "../core/test-prep.ts";
import type { ApCourseRecord, ApDocument } from "../core/ap.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

const COURSE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const POINT_STATUSES: ReadonlySet<string> = new Set(["unchecked", "solid", "gap", "fixed-recheck"]);
const DOCUMENT_KINDS: ReadonlySet<string> = new Set(["ced", "frq", "scoring"]);

function courseFile(id: string): string {
	if (!COURSE_ID_PATTERN.test(id)) throw new Error(`Invalid course id: ${id}`);
	return path.join(PATHS.ap, `${id}.json`);
}

/** Ids mirror chat ids: sortable, collision-resistant filename-safe strings. */
function newId(): string {
	return `ap_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

function writeCourse(record: ApCourseRecord): void {
	writeFileAtomicSync(courseFile(record.id), JSON.stringify(record, null, "\t"));
}

/** The record shape a file must satisfy before the store trusts it. A
 *  parseable file can still be foreign (a conflict copy, a hand-edited
 *  notes file), and projecting readiness off it would crash or lie. A
 *  course also always carries a documents array — an outside file without
 *  one is not a course. */
function isApCourseRecord(value: unknown): value is ApCourseRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	if (
		typeof record.id !== "string" ||
		typeof record.title !== "string" ||
		typeof record.createdAt !== "string" ||
		typeof record.updatedAt !== "string" ||
		typeof record.planConfirmed !== "boolean" ||
		!Array.isArray(record.sections) ||
		!Array.isArray(record.documents)
	) {
		return false;
	}
	// Every document entry carries the fields the course page and the
	// download path project; the optional year/pages ride along unchecked.
	const documentsOkay = record.documents.every((document) => {
		if (typeof document !== "object" || document === null || Array.isArray(document)) return false;
		const item = document as Record<string, unknown>;
		return (
			typeof item.id === "string" &&
			typeof item.kind === "string" &&
			DOCUMENT_KINDS.has(item.kind) &&
			typeof item.label === "string" &&
			typeof item.url === "string" &&
			typeof item.file === "string"
		);
	});
	if (!documentsOkay) return false;

	return record.sections.every((section) => {
		if (typeof section !== "object" || section === null || Array.isArray(section)) return false;
		const candidate = section as Record<string, unknown>;
		if (typeof candidate.id !== "string" || typeof candidate.title !== "string" || !Array.isArray(candidate.points)) {
			return false;
		}
		return candidate.points.every((point) => {
			if (typeof point !== "object" || point === null || Array.isArray(point)) return false;
			const item = point as Record<string, unknown>;
			return (
				typeof item.id === "string" &&
				typeof item.text === "string" &&
				typeof item.source === "string" &&
				typeof item.status === "string" &&
				POINT_STATUSES.has(item.status) &&
				Array.isArray(item.history)
			);
		});
	});
}

function get(id: string): ApCourseRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(courseFile(id), "utf-8"));
	} catch {
		// Missing, unreadable, or malformed: an honest absent read. The file
		// is left untouched — a caller must never rewrite what it could not
		// parse.
		return null;
	}
	// Parseable but wrong-shaped reads the same as absent; the file is never
	// rewritten here.
	return isApCourseRecord(parsed) ? parsed : null;
}

function loadOrThrow(id: string): ApCourseRecord {
	const record = get(id);
	if (!record) throw new Error(`Course not found: ${id}`);
	return record;
}

function create(title: string): ApCourseRecord {
	const now = new Date().toISOString();
	const record: ApCourseRecord = {
		id: newId(),
		title: title.trim(),
		createdAt: now,
		updatedAt: now,
		planConfirmed: false,
		sections: [],
		documents: [],
		version: 1,
	};
	fs.mkdirSync(PATHS.ap, { recursive: true });
	writeCourse(record);
	emit("ap-changed", {});
	return record;
}

/** Summaries for the course list: readiness is derived at projection time,
 *  never stored. The solid/total counts ride along so the UI can apply the
 *  one count-based percent rule (a bare ratio cannot be floored safely).
 *  Most recently touched first. */
function list(): Array<
	Pick<ApCourseRecord, "id" | "title" | "updatedAt" | "planConfirmed"> & {
		readiness: number;
		solid: number;
		total: number;
	}
> {
	try {
		fs.mkdirSync(PATHS.ap, { recursive: true });
		return fs
			.readdirSync(PATHS.ap)
			.filter((file) => file.endsWith(".json"))
			.map((file) => file.slice(0, -5))
			.filter((id) => COURSE_ID_PATTERN.test(id))
			.map((id) => get(id))
			.filter((record): record is ApCourseRecord => record !== null)
			.map((record) => {
				const ready = readiness(record);
				const counts = ready.sections.reduce(
					(acc, section) => ({ solid: acc.solid + section.solid, total: acc.total + section.total }),
					{ solid: 0, total: 0 },
				);
				return {
					id: record.id,
					title: record.title,
					updatedAt: record.updatedAt,
					planConfirmed: record.planConfirmed,
					readiness: ready.overall,
					solid: counts.solid,
					total: counts.total,
				};
			})
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	} catch {
		return [];
	}
}

/** Merge an edited plan draft (ids minted here for new units/topics) and
 *  set the confirmation to exactly `confirm`. An unconfirmed save CLEARS a
 *  prior confirmation: a revision after confirmation is a new proposal the
 *  learner has not approved, and questions must be refused until they do. */
function savePlan(id: string, draft: PlanDraftSection[], confirm: boolean): ApCourseRecord {
	const record = loadOrThrow(id);
	const next: ApCourseRecord = {
		...record,
		sections: mergePlan(record.sections, draft, newId),
		planConfirmed: confirm,
		updatedAt: new Date().toISOString(),
	};
	writeCourse(next);
	emit("ap-changed", {});
	return next;
}

/** Apply one answer to a topic. The confirmation guard comes first so an
 *  unconfirmed plan refuses with "plan not confirmed" even when the topic
 *  id is also unknown. */
function recordResult(id: string, topicId: string, result: AnswerResult, chatId: string): ApCourseRecord {
	const record = loadOrThrow(id);
	if (!record.planConfirmed) throw new Error("plan not confirmed");

	const at = new Date().toISOString();
	let found = false;
	const sections = record.sections.map((section) => ({
		...section,
		points: section.points.map((point) => {
			if (point.id !== topicId) return point;
			found = true;
			return applyResult(point, result, chatId, at);
		}),
	}));
	if (!found) throw new Error("unknown topic");

	const next: ApCourseRecord = { ...record, sections, updatedAt: at };
	writeCourse(next);
	emit("ap-changed", {});
	return next;
}

/** Add an official document to the manifest, or replace the entry with the
 *  same id (a re-download updates its label, year or page count). */
function putDocument(id: string, doc: ApDocument): ApCourseRecord {
	const record = loadOrThrow(id);
	const exists = record.documents.some((document) => document.id === doc.id);
	const documents = exists
		? record.documents.map((document) => (document.id === doc.id ? doc : document))
		: [...record.documents, doc];

	const next: ApCourseRecord = { ...record, documents, updatedAt: new Date().toISOString() };
	writeCourse(next);
	emit("ap-changed", {});
	return next;
}

/** Erase one chat's answers from every topic and replay what remains. Writes
 *  only when some topic actually carried an attempt from the chat. A missing
 *  course returns false. */
function forgetChat(id: string, chatId: string): boolean {
	const record = get(id);
	if (!record) return false;

	let changed = false;
	const sections = record.sections.map((section) => ({
		...section,
		points: section.points.map((point) => {
			const next = forgetChatInPoint(point, chatId);
			if (next !== point) changed = true;
			return next;
		}),
	}));
	if (!changed) return false;

	const next: ApCourseRecord = { ...record, sections, updatedAt: new Date().toISOString() };
	writeCourse(next);
	emit("ap-changed", {});
	return true;
}

export const apCourseStore = {
	create,
	get,
	list,
	savePlan,
	recordResult,
	putDocument,
	forgetChat,
};