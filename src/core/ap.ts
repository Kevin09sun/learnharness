/**
 * ap — the AP session type's pure core: the course record's official-document
 * manifest, a sitting's scope and kind, and the scoped question queue built on
 * Test prep's status machine and queue order.
 *
 * A course is units (Test prep sections) whose points are the official
 * numbered topics. A sitting asks about one topic, one unit, or the weak
 * topics across units. No fs, no framework imports: deterministic and
 * unit-testable.
 */

import { nextQueue, type TestPoint, type TestSection } from "./test-prep.ts";

// ─── records ────────────────────────────────────────────────────────────────

export type ApDocumentKind = "ced" | "frq" | "scoring";

export interface ApDocument {
	id: string; // stable within the course
	kind: ApDocumentKind;
	label: string; // e.g. "Course and Exam Description (2026)"
	year?: number;
	url: string; // source link; "" when imported from a learner file
	file: string; // file name inside the course's local papers folder
	pages?: number;
}

export type ApSittingScope =
	| { type: "topic"; topicId: string }
	| { type: "unit"; unitId: string }
	| { type: "weak" };

export type ApSittingKind = "mcq" | "frq" | "mixed";

export interface ApSitting {
	scope: ApSittingScope;
	kind: ApSittingKind;
}

export interface ApCourseRecord {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	planConfirmed: boolean;
	sections: TestSection[]; // units; each point is one official topic
	documents: ApDocument[];
	version: 1;
}

export type ApQueueReason = "recheck" | "unchecked" | "gap" | "review";

// ─── source links ───────────────────────────────────────────────────────────

/**
 * Official PDFs come only from College Board's own sites: `https:` and a host
 * equal to `collegeboard.org` or ending in `.collegeboard.org`. The suffix
 * check anchors on the dot, so `evilcollegeboard.org` and
 * `collegeboard.org.evil.com` are rejected.
 */
export function isCollegeBoardUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== "https:") return false;
	const host = parsed.hostname.toLowerCase();
	return host === "collegeboard.org" || host.endsWith(".collegeboard.org");
}

// ─── a sitting ──────────────────────────────────────────────────────────────

/** Validate a stored sitting, returning a fresh object with only known fields. */
export function parseApSitting(value: unknown): ApSitting | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;

	const kind = record.kind;
	if (kind !== "mcq" && kind !== "frq" && kind !== "mixed") return null;

	const rawScope = record.scope;
	if (typeof rawScope !== "object" || rawScope === null) return null;
	const scope = rawScope as Record<string, unknown>;

	switch (scope.type) {
		case "weak":
			return { scope: { type: "weak" }, kind };
		case "unit": {
			const unitId = scope.unitId;
			if (typeof unitId !== "string" || unitId === "") return null;
			return { scope: { type: "unit", unitId }, kind };
		}
		case "topic": {
			const topicId = scope.topicId;
			if (typeof topicId !== "string" || topicId === "") return null;
			return { scope: { type: "topic", topicId }, kind };
		}
		default:
			return null;
	}
}

// ─── scope lookups ──────────────────────────────────────────────────────────

function findSection(
	course: Pick<ApCourseRecord, "sections">,
	unitId: string,
): TestSection | undefined {
	return course.sections.find((section) => section.id === unitId);
}

function findPoint(
	course: Pick<ApCourseRecord, "sections">,
	topicId: string,
): TestPoint | undefined {
	for (const section of course.sections) {
		const point = section.points.find((candidate) => candidate.id === topicId);
		if (point) return point;
	}
	return undefined;
}

/** A problem with the sitting's scope, or null when the scope still exists. */
export function sittingScopeProblem(
	course: Pick<ApCourseRecord, "sections">,
	scope: ApSittingScope,
): string | null {
	switch (scope.type) {
		case "weak":
			return null;
		case "unit":
			return findSection(course, scope.unitId)
				? null
				: "the unit this sitting was started on is no longer in the course";
		case "topic":
			return findPoint(course, scope.topicId)
				? null
				: "the topic this sitting was started on is no longer in the course";
	}
}

export function topicInScope(
	course: Pick<ApCourseRecord, "sections">,
	scope: ApSittingScope,
	topicId: string,
): boolean {
	if (!findPoint(course, topicId)) return false;
	switch (scope.type) {
		case "weak":
			return true;
		case "unit":
			return course.sections.some(
				(section) =>
					section.id === scope.unitId && section.points.some((point) => point.id === topicId),
			);
		case "topic":
			return scope.topicId === topicId;
	}
}

// ─── question order ─────────────────────────────────────────────────────────

/**
 * The order to ask a sitting's topics in, weak-first. The weak scope is the
 * shared Test prep queue unchanged; a unit is that queue narrowed to the
 * unit's topics; a single topic is always asked — its shared-queue entry when
 * it has one, otherwise a `review` entry (so a solid topic is still asked, and
 * a topic re-checked in this chat is still offered).
 */
export function scopedQueue(
	course: Pick<ApCourseRecord, "sections">,
	scope: ApSittingScope,
	chatId: string,
): Array<{ pointId: string; reason: ApQueueReason }> {
	const queue = nextQueue(course, chatId);

	switch (scope.type) {
		case "weak":
			return queue;
		case "unit": {
			const section = findSection(course, scope.unitId);
			const ids = new Set(section?.points.map((point) => point.id) ?? []);
			return queue.filter((entry) => ids.has(entry.pointId));
		}
		case "topic": {
			const entry = queue.find((candidate) => candidate.pointId === scope.topicId);
			if (entry) return [entry];
			return findPoint(course, scope.topicId)
				? [{ pointId: scope.topicId, reason: "review" }]
				: [];
		}
	}
}

// ─── labels ─────────────────────────────────────────────────────────────────

const KIND_LABELS: Record<ApSittingKind, string> = {
	mcq: "multiple-choice",
	frq: "free-response",
	mixed: "mixed",
};

/** The session title: course · scope · kind, e.g. "AP Calculus BC · Unit 1 Limits · multiple-choice". */
export function sittingLabel(
	course: Pick<ApCourseRecord, "title" | "sections">,
	sitting: ApSitting,
): string {
	let scopeLabel: string;
	switch (sitting.scope.type) {
		case "weak":
			scopeLabel = "weak topics";
			break;
		case "unit":
			scopeLabel = findSection(course, sitting.scope.unitId)?.title ?? "removed unit";
			break;
		case "topic":
			scopeLabel = findPoint(course, sitting.scope.topicId)?.text ?? "removed topic";
			break;
	}
	return `${course.title} · ${scopeLabel} · ${KIND_LABELS[sitting.kind]}`;
}