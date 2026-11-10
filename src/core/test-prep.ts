/**
 * test-prep — the Test prep session type's pure core: point statuses, the
 * answer→status machine, readiness math, question order and plan merging.
 *
 * The learner works through a test's outline as sections of points. A point
 * starts `unchecked`; a right first answer makes it `solid`, a wrong one (or
 * "don't know") makes it a `gap`. Fixing a gap in this sitting only earns
 * `fixed-recheck` — it becomes `solid` when answered right in a LATER chat.
 * Readiness counts solid points only, so it can never rise without a correct
 * answer. No fs, no framework imports: deterministic and unit-testable.
 */

// ─── records ────────────────────────────────────────────────────────────────

export type PointStatus = "unchecked" | "solid" | "gap" | "fixed-recheck";

export type AnswerResult = "correct" | "wrong" | "dontKnow";

export interface PointAttempt {
	at: string;
	chatId: string;
	result: AnswerResult;
}

export interface TestPoint {
	id: string;
	text: string;
	source: string;
	status: PointStatus;
	fixedIn?: string;
	history: PointAttempt[];
}

export interface TestSection {
	id: string;
	title: string;
	points: TestPoint[];
}

export interface TestRecord {
	id: string;
	title: string;
	folder?: string;
	createdAt: string;
	updatedAt: string;
	planConfirmed: boolean;
	sections: TestSection[];
	version: 1;
}

/** The plan-review draft: ids are optional because they are minted on merge. */
export interface PlanDraftSection {
	id?: string;
	title: string;
	points: Array<{ id?: string; text: string; source: string }>;
}

// ─── the status machine ─────────────────────────────────────────────────────

/**
 * Apply one answer to a point, returning a NEW point (the input is never
 * mutated). Every call appends exactly one history entry.
 *
 *   unchecked      + correct  → solid
 *   unchecked      + wrong/dk → gap
 *   gap            + correct  → fixed-recheck (fixedIn = this chat)
 *   gap            + wrong/dk → gap
 *   fixed-recheck  + correct  → solid only in a later chat; else unchanged
 *   fixed-recheck  + wrong/dk → gap
 *   solid          + wrong/dk → gap
 *   solid          + correct  → solid
 */
export function applyResult(
	point: TestPoint,
	result: AnswerResult,
	chatId: string,
	at: string,
): TestPoint {
	const history = [...point.history, { at, chatId, result }];
	let status = point.status;
	let fixedIn = point.fixedIn;

	if (result === "correct") {
		switch (point.status) {
			case "unchecked":
			case "solid":
				status = "solid";
				fixedIn = undefined;
				break;
			case "gap":
				status = "fixed-recheck";
				fixedIn = chatId;
				break;
			case "fixed-recheck":
				// A fix only counts once it is verified in a later sitting.
				if (point.fixedIn !== chatId) {
					status = "solid";
					fixedIn = undefined;
				}
				break;
		}
	} else {
		// Wrong or "don't know": a gap, never credited.
		status = "gap";
		fixedIn = undefined;
	}

	return { ...point, status, fixedIn, history };
}

// ─── readiness ──────────────────────────────────────────────────────────────

/** Readiness = solid points ÷ all points, overall and per section. */
export function readiness(test: Pick<TestRecord, "sections">): {
	overall: number;
	sections: Array<{ id: string; title: string; solid: number; total: number; ratio: number }>;
} {
	let solidTotal = 0;
	let pointsTotal = 0;

	const sections = test.sections.map((section) => {
		const solid = section.points.filter((point) => point.status === "solid").length;
		const total = section.points.length;
		solidTotal += solid;
		pointsTotal += total;
		return { id: section.id, title: section.title, solid, total, ratio: total === 0 ? 0 : solid / total };
	});

	return { overall: pointsTotal === 0 ? 0 : solidTotal / pointsTotal, sections };
}

// ─── question order ─────────────────────────────────────────────────────────

/**
 * The order to work through a test: re-checks first (points fixed in an
 * earlier sitting), then unchecked points interleaved across sections (point
 * 1 of each section, then point 2, …), then gaps. Solid points never appear,
 * and neither do points already fixed in this chat.
 */
export function nextQueue(
	test: Pick<TestRecord, "sections">,
	chatId: string,
): Array<{ pointId: string; reason: "recheck" | "unchecked" | "gap" }> {
	const rechecks: Array<{ pointId: string; reason: "recheck" }> = [];
	const gaps: Array<{ pointId: string; reason: "gap" }> = [];
	const uncheckedBySection: Array<Array<{ pointId: string; reason: "unchecked" }>> = [];

	for (const section of test.sections) {
		const unchecked = [];
		for (const point of section.points) {
			if (point.status === "fixed-recheck") {
				if (point.fixedIn !== chatId) rechecks.push({ pointId: point.id, reason: "recheck" });
			} else if (point.status === "gap") {
				gaps.push({ pointId: point.id, reason: "gap" });
			} else if (point.status === "unchecked") {
				unchecked.push({ pointId: point.id, reason: "unchecked" as const });
			}
		}
		uncheckedBySection.push(unchecked);
	}

	// Interleave: point 1 of every section, then point 2 of every section, …
	const unchecked: Array<{ pointId: string; reason: "unchecked" }> = [];
	const longest = uncheckedBySection.reduce((max, points) => Math.max(max, points.length), 0);
	for (let index = 0; index < longest; index++) {
		for (const points of uncheckedBySection) {
			const entry = points[index];
			if (entry) unchecked.push(entry);
		}
	}

	return [...rechecks, ...unchecked, ...gaps];
}

// ─── plan editing ───────────────────────────────────────────────────────────

/**
 * Merge an edited plan draft into the confirmed sections.
 *
 * - A draft point whose id matches an existing point keeps that point's
 *   status/fixedIn/history and takes the draft's text/source.
 * - Any other draft point is new: it gets `newId()` and starts `unchecked`.
 * - Existing points absent from the draft are dropped (and stop counting
 *   toward readiness); matched sections keep their id, new ones get `newId()`.
 */
export function mergePlan(
	existing: TestSection[],
	draft: PlanDraftSection[],
	newId: () => string,
): TestSection[] {
	const existingPoints = new Map<string, TestPoint>();
	for (const section of existing) {
		for (const point of section.points) existingPoints.set(point.id, point);
	}
	const existingSectionIds = new Set(existing.map((section) => section.id));

	return draft.map((section) => {
		const id = section.id !== undefined && existingSectionIds.has(section.id) ? section.id : newId();
		const points = section.points.map((draftPoint): TestPoint => {
			const prior = draftPoint.id === undefined ? undefined : existingPoints.get(draftPoint.id);
			if (prior) {
				return { ...prior, text: draftPoint.text, source: draftPoint.source, history: [...prior.history] };
			}
			return {
				id: newId(),
				text: draftPoint.text,
				source: draftPoint.source,
				status: "unchecked",
				history: [],
			};
		});
		return { id, title: section.title, points };
	});
}

// ─── plan validation ────────────────────────────────────────────────────────

/** Human-readable problems with a proposed plan; empty means it is valid. */
export function planProblems(draft: PlanDraftSection[]): string[] {
	const problems: string[] = [];

	if (draft.length === 0) problems.push("The plan needs at least one section.");

	draft.forEach((section, index) => {
		const label = section.title.trim() || `(section ${index + 1})`;
		if (section.title.trim() === "") problems.push(`Section ${index + 1} needs a title.`);
		if (section.points.length === 0) problems.push(`Section "${label}" needs at least one point.`);
		section.points.forEach((point, pointIndex) => {
			if (point.text.trim() === "") {
				problems.push(`Section "${label}", point ${pointIndex + 1} needs text.`);
			}
		});
	});

	return problems;
}