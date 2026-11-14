import type { ApSitting } from "@/src/core";
import { clearOpeningPrompt, OPENING_PROMPT_FAILURE, stashOpeningPrompt } from "./opening-prompt";

interface SessionCreation {
	title: string;
	kind?: "practice" | "testprep" | "ap";
	graphContext?: { propositions: readonly { id: string; name: string; statement: string }[] };
	/** A testprep sitting names the test: a new one by title (the start
	 *  draft) or an existing record by id (Continue on the readiness page). */
	testTitle?: string;
	testId?: string;
	/** An AP sitting names the course by id (the course page's Learn and
	 *  Practise buttons) and, for Practise, the scope and question kind. */
	apCourseTitle?: string;
	apCourseId?: string;
	apSitting?: ApSitting;
}

/** Per source-composer instance. Retain a successful creation if storage
 * fails, so an unchanged retry does not create another empty session.
 * Changed text/context/settings is a different start, not a stale title.
 */
export class SessionStarter {
	private created?: { identity: string; id: string };

	async start(body: SessionCreation, fetchLike: typeof fetch, settingsIdentity?: string): Promise<string> {
		const identity = JSON.stringify([body, settingsIdentity]);
		if (this.created?.identity !== identity) {
			if (this.created) clearOpeningPrompt(this.created.id);
			this.created = undefined;
			const res = await fetchLike("/api/chats", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!res.ok) throw new Error(OPENING_PROMPT_FAILURE);
			const result = await res.json() as { id?: unknown };
			if (typeof result.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(result.id)) throw new Error(OPENING_PROMPT_FAILURE);
			this.created = { identity, id: result.id };
		}
		if (!stashOpeningPrompt(this.created.id, body.title)) throw new Error(OPENING_PROMPT_FAILURE);
		return `/chat/${this.created.id}`;
	}
}
