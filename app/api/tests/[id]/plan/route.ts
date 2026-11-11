/**
 * GET/PUT /api/tests/[id]/plan — the plan-review and plan-edit seam
 * (test prep, 2026-11-10).
 *
 * PUT merges an edited draft through testStore.savePlan: the pure rules
 * (mergePlan/planProblems) own ids, statuses and validation. A draft with
 * problems is a 400 LISTING them — a refused edit never writes. `confirm`
 * rides the same write, so the plan-review card's Confirm is one request.
 *
 * GET serves the latest saved record: the plan-review card renders the
 * record (not the propose_plan call's arguments), so edits made elsewhere
 * always show, and Task 8's readiness view reads the same shape.
 *
 * The trusted same-origin guard mirrors app/api/custom-provider (see
 * src/server/custom-provider-http.ts): this is browser intent, not user
 * authentication. Reads stay unguarded like every other route; the
 * mutation refuses a cross-site or cross-origin caller.
 */

import { planProblems } from "@/src/core";
import type { PlanDraftSection } from "@/src/core";
import { desktopAPIAuthorized, stores, subscriptionRequestOrigin } from "@/src/server";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
	const desktop = process.env.LH_DESKTOP_SERVER === "1" || Boolean(process.env.LH_DESKTOP_API_SECRET);
	if (desktop) return desktopAPIAuthorized(request.headers);
	const origin = request.headers.get("origin");
	if (!origin || origin === "null") return false;
	try {
		// Match the addressed origin (never forwarded-origin headers), and
		// refuse an explicit cross-site fetch. Same idiom as the custom
		// provider route.
		return (
			origin === subscriptionRequestOrigin(request) &&
			(!request.headers.has("sec-fetch-site") || request.headers.get("sec-fetch-site") === "same-origin")
		);
	} catch {
		return false;
	}
}

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
	const record = stores.testStore.get(id);
	if (!record) return Response.json({ error: "Unknown test" }, { status: 404 });
	return Response.json(record);
}

export async function PUT(
	request: Request,
	ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
	if (!authorized(request)) {
		return Response.json({ error: "Test plan changes require a trusted same-origin request." }, { status: 403 });
	}

	const { id } = await ctx.params;
	if (!stores.testStore.get(id)) return Response.json({ error: "Unknown test" }, { status: 404 });

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

	const problems = planProblems(sections);
	if (problems.length > 0) {
		return Response.json({ error: "The plan has problems.", problems }, { status: 400 });
	}

	return Response.json(stores.testStore.savePlan(id, sections, body.confirm));
}