/**
 * GET /api/ap/[id] — the course page's read seam (AP prep stage 1,
 * 2026-11-13).
 *
 * The record rides along unchanged, except that each official document is
 * extended with its LOCAL presence: `present` is true only when the paper is
 * on this computer, and only then does an absolute `path` ride along. The
 * bytes are never served here — the course page points the reader at the
 * path. An unknown, invalid or unreadable id is a 404. Reads stay unguarded
 * like every other read route.
 */

import { apPaperPath, apPaperPresent, stores } from "@/src/server";

export const dynamic = "force-dynamic";

/** A malformed manifest entry reads as absent rather than failing the page. */
function paperState(courseId: string, file: string): { present: boolean; path?: string } {
	try {
		if (!apPaperPresent(courseId, file)) return { present: false };
		return { present: true, path: apPaperPath(courseId, file) };
	} catch {
		return { present: false };
	}
}

export async function GET(
	_request: Request,
	ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
	const { id } = await ctx.params;
	const record = stores.apCourseStore.get(id);
	if (!record) return Response.json({ error: "Unknown AP course" }, { status: 404 });

	return Response.json({
		...record,
		documents: record.documents.map((document) => ({
			...document,
			...paperState(id, document.file),
		})),
	});
}