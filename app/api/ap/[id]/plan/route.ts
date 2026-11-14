/**
 * GET/PUT /api/ap/[id]/plan — the plan-review and plan-edit seam (AP prep
 * stage 1, 2026-11-13).
 *
 * This is Test prep's /api/tests/[id]/plan behaviour over the course store:
 * PUT merges an edited draft through apCourseStore.savePlan and the pure
 * rules (mergePlan/planProblems) own ids, statuses and validation. A draft
 * with problems is a 400 LISTING them — a refused edit never writes.
 * `confirm` rides the same write, so the plan-review card's Confirm is one
 * request.
 *
 * GET serves the latest saved record: the plan-review card renders the
 * record (not the propose_plan call's arguments), so edits made elsewhere
 * always show.
 *
 * The trusted same-origin guard is the shared server helper
 * (src/server/same-origin.ts): this is browser intent, not user
 * authentication. Reads stay unguarded like every other route; the mutation
 * refuses a cross-site or cross-origin caller.
 */

import { fillAddedTopicSources, planProblems } from "@/src/core";
import type { PlanDraftSection } from "@/src/core";
import { sameOriginAuthorized, stores } from "@/src/server";

export const dynamic = "force-dynamic";

/** Shape gate before planProblems: malformed JSON must not reach `.trim()`. */
function readDraft(value: unknown): PlanDraftSection[] | null {
	if (!Array.isArray(value)) return null;
	const sections: PlanDraftSection[] = [];
	for (const rawSection of value) {
		if (typeof rawSection !== "object" || rawSection === null || Array.isArray(rawSection)) return null;
		const section = rawSection as Record<string, unknown>;
		if (typeof section.title !== "string" || !Array.isArray(section.points)) return null;
		if (section.id !== undefined && typeof section.id !== "string") return null;

		const points: PlanDraftSection["points"] = [];
		for (const rawPoint of section.points) {
			if (typeof rawPoint !== "object" || rawPoint === null || Array.isArray(rawPoint)) return null;
			const point = rawPoint as Record<string, unknown>;
			if (typeof point.text !== "string" || typeof point.source !== "string") return null;
			if (point.id !== undefined && typeof point.id !== "string") return null;
			const id = typeof point.id === "string" ? point.id : undefined;
			points.push({ ...(id === undefined ? {} : { id }), text: point.text, source: point.source });
		}

		const id = typeof section.id === "string" ? section.id : undefined;
		sections.push({ ...(id === undefined ? {} : { id }), title: section.title, points });
	}
	return sections;
}

export async function GET(
	_request: Request,
	ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
	const { id } = await ctx.params;
	const record = stores.apCourseStore.get(id);
	if (!record) return Response.json({ error: "Unknown AP course" }, { status: 404 });
	return Response.json(record);
}

export async function PUT(
	request: Request,
	ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
	if (!sameOriginAuthorized(request)) {
		return Response.json({ error: "AP plan changes require a trusted same-origin request." }, { status: 403 });
	}

	const { id } = await ctx.params;
	if (!stores.apCourseStore.get(id)) return Response.json({ error: "Unknown AP course" }, { status: 404 });

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return Response.json({ error: "A JSON object is required." }, { status: 400 });
	}
	const sections = readDraft(body.sections);
	if (!sections) {
		return Response.json(
			{ error: "sections must be an array of { id?, title, points: [{ id?, text, source }] }" },
			{ status: 400 },
		);
	}
	if (typeof body.confirm !== "boolean") {
		return Response.json({ error: "confirm must be a boolean." }, { status: 400 });
	}

	// The AP editor has no source field: a topic the learner adds by hand gets
	// the fixed source before validation. Points carrying an id are official
	// and are left exactly as they are.
	const filled = fillAddedTopicSources(sections);
	const problems = planProblems(filled);
	if (problems.length > 0) {
		return Response.json({ error: "The plan has problems.", problems }, { status: 400 });
	}

	return Response.json(stores.apCourseStore.savePlan(id, filled, body.confirm));
}