import { notFound } from "next/navigation";

import { ReadinessPage } from "@/components/test-prep/readiness-view";
import { stores } from "@/src/server";

/**
 * /tests/[id] — one test's readiness page (test prep, 2026-11-10).
 *
 * The record is read server-side and handed to the client body, which owns
 * the two mutations (Edit plan → PUT the confirmed plan, Continue → start
 * the next sitting through the ordinary new-session flow). An unknown id is
 * a 404, not an empty page.
 */

export const dynamic = "force-dynamic";

export default async function TestReadinessPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const test = stores.testStore.get(id);
	if (!test) notFound();
	return <ReadinessPage test={test} />;
}