import { sessionTokens, type TokenTotals } from "../core/session-tokens.ts";
import { stores } from "./stores.ts";

/** A session's running token total, background jobs included. null = no such session. */
export function chatTokens(chatId: string): TokenTotals | null {
	const chat = stores.chatStore.getChat(chatId);
	return chat ? sessionTokens(chat, stores.jobStore.listJobs(chatId)) : null;
}
