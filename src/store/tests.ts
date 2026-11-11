/**
 * TestStore — the fs JSON adapter for Test prep records (one file per test
 * in data/tests/).
 *
 * A test record holds the plan (sections of points) plus each point's
 * progress across sittings; the pure rules live in core/test-prep.ts. Every
 * mutation is a fresh read-modify-write (a plan edit made while a sitting
 * is open must not be reverted by the next answer) and announces
 * "tests-changed" post-write. Idioms match the chat store: sync fs, tiny
 * records, id-guarded filenames, the shared atomic writer.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import { applyResult, mergePlan, readiness } from "../core/test-prep.ts";
import type { AnswerResult, PlanDraftSection, TestRecord } from "../core/test-prep.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

function testFile(id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid test id: ${id}`);
	return path.join(PATHS.tests, `${id}.json`);
}

/** Ids mirror chat ids: sortable, collision-resistant filename-safe strings. */
function newId(): string {
	return `test_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

function writeTest(record: TestRecord): void {
	writeFileAtomicSync(testFile(record.id), JSON.stringify(record, null, "\t"));
}

function get(id: string): TestRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(testFile(id), "utf-8"));
	} catch {
		// Missing, unreadable, or malformed: an honest absent read. The file
		// is left untouched — a caller must never rewrite what it could not
		// parse.
		return null;
	}
	return parsed as TestRecord;
}

function loadOrThrow(id: string): TestRecord {
	const record = get(id);
	if (!record) throw new Error(`Test not found: ${id}`);
	return record;
}

function create(title: string, folder?: string): TestRecord {
	const now = new Date().toISOString();
	const record: TestRecord = {
		id: newId(),
		title: title.trim(),
		...(folder === undefined ? {} : { folder }),
		createdAt: now,
		updatedAt: now,
		planConfirmed: false,
		sections: [],
		version: 1,
	};
	fs.mkdirSync(PATHS.tests, { recursive: true });
	writeTest(record);
	emit("tests-changed", {});
	return record;
}

/** Summaries for the test list: readiness is derived at projection time,
 *  never stored. Most recently touched first. */
function list(): Array<Pick<TestRecord, "id" | "title" | "updatedAt" | "planConfirmed"> & { readiness: number }> {
	try {
		fs.mkdirSync(PATHS.tests, { recursive: true });
		return fs
			.readdirSync(PATHS.tests)
			.filter((file) => file.endsWith(".json"))
			.map((file) => get(file.slice(0, -5)))
			.filter((record): record is TestRecord => record !== null)
			.map((record) => ({
				id: record.id,
				title: record.title,
				updatedAt: record.updatedAt,
				planConfirmed: record.planConfirmed,
				readiness: readiness(record).overall,
			}))
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	} catch {
		return [];
	}
}

/** Merge an edited plan draft (ids minted here for new sections/points) and
 *  set the confirmation to exactly `confirm`. An unconfirmed save CLEARS a
 *  prior confirmation: a revision after confirmation is a new proposal the
 *  learner has not approved, and questions must be refused until they do. */
function savePlan(id: string, draft: PlanDraftSection[], confirm: boolean): TestRecord {
	const record = loadOrThrow(id);
	const next: TestRecord = {
		...record,
		sections: mergePlan(record.sections, draft, newId),
		planConfirmed: confirm,
		updatedAt: new Date().toISOString(),
	};
	writeTest(next);
	emit("tests-changed", {});
	return next;
}

/** Apply one answer to a point. The confirmation guard comes first so an
 *  unconfirmed plan refuses with "plan not confirmed" even when the point
 *  id is also unknown. */
function recordResult(id: string, pointId: string, result: AnswerResult, chatId: string): TestRecord {
	const record = loadOrThrow(id);
	if (!record.planConfirmed) throw new Error("plan not confirmed");

	const at = new Date().toISOString();
	let found = false;
	const sections = record.sections.map((section) => ({
		...section,
		points: section.points.map((point) => {
			if (point.id !== pointId) return point;
			found = true;
			return applyResult(point, result, chatId, at);
		}),
	}));
	if (!found) throw new Error("unknown point");

	const next: TestRecord = { ...record, sections, updatedAt: at };
	writeTest(next);
	emit("tests-changed", {});
	return next;
}

export const testStore = {
	create,
	get,
	list,
	savePlan,
	recordResult,
};
