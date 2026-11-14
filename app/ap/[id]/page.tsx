import { notFound } from "next/navigation";

import { CoursePage, type CourseDocument } from "@/components/ap/course-view";
import type { ApDocument } from "@/src/core";
import { apPaperPath, apPaperPresent, stores } from "@/src/server";

/**
 * /ap/[id] — one AP course page (AP prep, 2026-11-13).
 *
 * The record is read server-side; local paper presence is a filesystem fact
 * that only the server can answer, so each document is projected with its
 * `present` state here and the client body owns the mutations (edit and
 * confirm the units, download a missing paper, start a sitting). The course
 * description's absolute path is handed over only when it is actually on
 * this computer — that path is the one thing about a paper the Learn prompt
 * carries. An unknown id is a 404, not an empty page.
 */

export const dynamic = "force-dynamic";

/** A malformed manifest entry reads as absent rather than failing the page. */
function documentState(courseId: string, document: ApDocument): CourseDocument {
	try {
		return { ...document, present: apPaperPresent(courseId, document.file) };
	} catch {
		return { ...document, present: false };
	}
}

function descriptionPath(courseId: string, documents: CourseDocument[]): string | undefined {
	const description = documents.find((document) => document.kind === "ced" && document.present);
	if (!description) return undefined;
	try {
		return apPaperPath(courseId, description.file);
	} catch {
		return undefined;
	}
}

export default async function ApCoursePage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const course = stores.apCourseStore.get(id);
	if (!course) notFound();

	const documents = course.documents.map((document) => documentState(id, document));
	const cedPath = descriptionPath(id, documents);
	return (
		<CoursePage
			course={course}
			documents={documents}
			{...(cedPath === undefined ? {} : { cedPath })}
		/>
	);
}