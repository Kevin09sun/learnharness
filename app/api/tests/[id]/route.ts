/**
 * GET /api/tests/[id] — the readiness page's read seam (test prep,
 * 2026-11-10).
 *
 * The record rides along unchanged and readiness is derived here (solid
 * points ÷ all points, overall and per section — never stored). An unknown
 * id is a 404. Reads stay unguarded like every other read route; plan edits
 * live under /api/tests/[id]/plan and carry the same-origin guard.
 */

import { readiness } from "@/src/core";
import { stores } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(
	_request: Request,
	ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
	const { id } = await ctx.params;
	const record = stores.testStore.get(id);
	if (!record) return Response.json({ error: "Unknown test" }, { status: 404 });
	return Response.json({ ...record, readiness: readiness(record) });
}