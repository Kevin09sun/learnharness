/**
 * POST /api/ap/[id]/documents — download the missing official papers (AP
 * prep stage 1, 2026-11-13).
 *
 * Every document in the course's manifest is reported with its resulting
 * local state. Only a paper that is absent AND carries a stored url is
 * fetched; the request never supplies a URL (downloadApPaper re-checks the
 * stored one against the College Board rule on every hop). One failure is
 * reported per document and the route still answers 200 — a single bad link
 * must not hide the papers that did download. An unknown course is a 404.
 *
 * The mutation carries the shared same-origin guard (src/server/same-origin.ts):
 * a cross-site caller could otherwise make this machine fetch and write
 * files. Reads and the list live under the unguarded read routes.
 */

import { downloadApPaper, apPaperPresent, sameOriginAuthorized, stores } from "@/src/server";

export const dynamic = "force-dynamic";

interface DocumentState {
	id: string;
	file: string;
	present: boolean;
	error?: string;
}

/** A malformed manifest entry reads as absent rather than failing the batch. */
function paperPresent(courseId: string, file: string): boolean {
	try {
		return apPaperPresent(courseId, file);
	} catch {
		return false;
	}
}

export async function POST(
	request: Request,
	ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
	if (!sameOriginAuthorized(request)) {
		return Response.json({ error: "AP document downloads require a trusted same-origin request." }, { status: 403 });
	}

	const { id } = await ctx.params;
	const record = stores.apCourseStore.get(id);
	if (!record) return Response.json({ error: "Unknown AP course" }, { status: 404 });

	const documents: DocumentState[] = [];
	for (const document of record.documents) {
		let present = paperPresent(id, document.file);
		let error: string | undefined;
		if (!present && document.url !== "") {
			try {
				await downloadApPaper(id, document.url, document.file);
				present = true;
			} catch (failure) {
				error = failure instanceof Error ? failure.message : String(failure);
			}
		}
		documents.push({
			id: document.id,
			file: document.file,
			present,
			...(error === undefined ? {} : { error }),
		});
	}

	return Response.json({ documents });
}