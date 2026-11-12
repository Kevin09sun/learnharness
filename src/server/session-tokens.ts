import { sessionTokens, type TokenTotals } from "../core/session-tokens.ts";
import type { JobRecord } from "../core/contracts/jobs.ts";
import { stores } from "./stores.ts";

/** A session's running token total, background jobs included. null = no such session.
 *  `jobs` lets a caller pass the already-read job list (the sessions list
 *  reads the whole jobs dir once); omitted, this chat's jobs are read here. */
export function chatTokens(chatId: string, jobs?: readonly Pick<JobRecord, "usage">[]): TokenTotals | null {
	const chat = stores.chatStore.getChat(chatId);
	return chat ? sessionTokens(chat, jobs ?? stores.jobStore.listJobs(chatId)) : null;
}
