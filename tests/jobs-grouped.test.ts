/**
 * The sessions list's ONE jobs-dir read (owner perf round): GET /api/chats
 * used to call chatTokens per chat, and each chatTokens → listJobs re-read
 * and re-parsed EVERY job file — O(chats × jobs). listJobsByChat groups the
 * same records in a single read; the pins here say the grouped view is
 * exactly listJobs per chat (same records, same newest-first order) and
 * that the route's token totals are unchanged.
 *
 * Runs under an isolated LH_DATA_DIR (the chat-birth-stamp discipline: the
 * seam is set before any config-loading import, so every app-module import
 * is dynamic).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

// ── the seam, BEFORE any config-loading import ──────────────────────────────
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-jobs-grouped-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { jobStore } = await import("../src/store/jobs.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { chatTokens } = await import("../src/server/session-tokens.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

describe("listJobsByChat (the sessions list's grouped read)", () => {
	it("one grouped read equals listJobs for every chat", () => {
		const older = jobStore.createJob({ kind: "research", chatId: "chat_group_a", toolCallId: "call-ga" });
		const other = jobStore.createJob({ kind: "pdf", chatId: "chat_group_b", toolCallId: "call-gb" });
		const newer = jobStore.createJob({ kind: "visual", chatId: "chat_group_a", toolCallId: "call-ga2" });
		// Deterministic order without relying on wall-clock granularity.
		jobStore.updateJob(older.id, { updatedAt: "2026-01-01T00:00:01.000Z" });
		jobStore.updateJob(other.id, { updatedAt: "2026-01-01T00:00:02.000Z" });
		jobStore.updateJob(newer.id, { updatedAt: "2026-01-01T00:00:03.000Z" });

		const grouped = jobStore.listJobsByChat();
		for (const chatId of ["chat_group_a", "chat_group_b", "chat_group_missing"]) {
			assert.deepEqual(grouped.get(chatId) ?? [], jobStore.listJobs(chatId), `grouped read matches listJobs for ${chatId}`);
		}
		assert.deepEqual(grouped.get("chat_group_a")!.map((j) => j.id), [newer.id, older.id], "newest activity first, same order as listJobs");
	});

	it("GET /api/chats reports the same tokens as chatTokens (grouped read)", async () => {
		const chat = chatStore.createChat("grouped tokens route test");
		const job = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "call-tokens-route" });
		jobStore.updateJob(job.id, { usage: { model: "test/model", inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, reasoningTokens: undefined, steps: 1 } });

		const { GET } = await import("../app/api/chats/route.ts");
		const body = (await (await GET()).json()) as { chats: Array<{ id: string; tokens?: unknown }> };
		const row = body.chats.find((c) => c.id === chat.id);
		assert.ok(row, "the new session appears in the list");
		assert.deepEqual(row.tokens, chatTokens(chat.id), "the route's single grouped read yields the per-chat token total unchanged");
	});
});