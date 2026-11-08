import type { CallUsage, ChatRecord, TokenTotals } from "./contracts/chat.ts";
import type { JobRecord } from "./contracts/jobs.ts";

export type { TokenTotals };

function add(totals: TokenTotals, u: Pick<CallUsage, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens">) {
	// Unreported fields count as zero here: a running counter, not a bill.
	const input = u.inputTokens ?? 0, output = u.outputTokens ?? 0, cacheRead = u.cacheReadTokens ?? 0, cacheWrite = u.cacheWriteTokens ?? 0;
	totals.input += input;
	totals.output += output;
	totals.cacheRead += cacheRead;
	totals.cacheWrite += cacheWrite;
	totals.total += input + output + cacheRead + cacheWrite;
}

/** Folds the session's usage logs: teacher turns (compaction lands there
 *  too), graph extraction runs, and its background jobs' running totals. */
export function sessionTokens(
	record: Pick<ChatRecord, "turns" | "extractions">,
	jobs: readonly Pick<JobRecord, "usage">[] = [],
): TokenTotals {
	const totals: TokenTotals = { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	for (const turn of record.turns ?? []) for (const step of turn.steps) add(totals, step);
	for (const run of record.extractions ?? []) {
		for (const step of [...run.stages.extractor.steps, ...run.stages.auditor.steps]) add(totals, step);
	}
	for (const job of jobs) if (job.usage) add(totals, job.usage);
	return totals;
}
