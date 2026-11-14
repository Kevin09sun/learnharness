/**
 * GET /api/ap — the AP courses list seam (AP prep stage 1, 2026-11-13).
 *
 * Each row is the store's projection: title, plan confirmation, the
 * count-based readiness (solid ÷ all topics) and the integer solid/total
 * counts the UI needs to format the one percent rule. Reads stay unguarded
 * like every other read route; the mutations live under /api/ap/[id].
 */

import { stores } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
	return Response.json({ courses: stores.apCourseStore.list() });
}