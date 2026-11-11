/**
 * GET /api/tests — the Tests list seam (test prep, 2026-11-10).
 *
 * Each row is the store's projection: title, plan confirmation, the
 * count-based readiness (solid ÷ all points) and the integer solid/total
 * counts the UI needs to format the one percent rule. Reads stay unguarded
 * like every other read route; the mutations live under /api/tests/[id].
 */

import { stores } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
	return Response.json({ tests: stores.testStore.list() });
}