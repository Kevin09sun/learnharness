/**
 * AP PROMPT (AP prep, 2026-11-13): the AP agent composes its OWN base +
 * doctrine (never the teaching base) and the same CURATED shared appendix
 * as test prep — voice, accuracy, learner files, web lookups and
 * formatting. The question mechanics and confidence chunks stay out: AP has
 * its own doctrine and no quiz or confidence tools.
 *
 * The order pin: own fragments first, then the five allowlisted shared
 * files in filename order — the same composition order the loader uses.
 *
 * TEST-DIR ISOLATION: the GET route reads the settings store, so LH_DATA_DIR
 * must be set before the first import that loads config.ts (same discipline
 * as prompt-overrides.test.ts).
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = mkdtempSync(path.join(os.tmpdir(), "lh-ap-prompt-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { listSourceSegments } = await import("../src/agent/prompt-segments.ts");
const { composeInstructions } = await import("../src/agent/teacher-agent.ts");
const { isValidSegmentPath } = await import("../src/core/prompt-segments.ts");
const { GET: getPromptSegments } = await import("../app/api/settings/prompts/route.ts");

after(() => {
	rmSync(TMP_DATA, { recursive: true, force: true });
});

const promptText = (relative: string) =>
	readFileSync(new URL(`../src/agent/prompts/${relative}`, import.meta.url), "utf8").trim();

const AP_SHARED = ["10-voice.md", "15-accuracy.md", "30-learner-files.md", "35-web.md", "40-formatting.md"];

describe("ap prompt composition", () => {
	it("composes the doctrine and the formatting appendix — never the teaching base or question mechanics", () => {
		const prompt = composeInstructions("ap");
		// The doctrine's rules are binding content; the wording is ours, so
		// assert the load-bearing instructions themselves.
		for (const rule of [
			"ap_save_document",
			"propose_units",
			"ap_progress",
			"ap_mcq",
			"ap_record_result",
			"dontKnow",
			"Never build the list from general knowledge",
		]) {
			assert.ok(prompt.includes(rule), `missing doctrine rule: ${rule}`);
		}
		// The own fragments compose verbatim…
		assert.ok(prompt.includes(promptText("ap/00-base.md")));
		assert.ok(prompt.includes(promptText("ap/10-doctrine.md")));
		// …and the allowlisted formatting guide is the trailing appendix.
		assert.ok(prompt.includes(promptText("shared/40-formatting.md")));
		// The teaching base and the question/confidence mechanics never compose.
		assert.doesNotMatch(prompt, /install understanding/);
		assert.doesNotMatch(prompt, /## The question tools/);
		assert.doesNotMatch(prompt, /Every quiz answer carries/);
	});

	it("pins the owner-approved doctrine sentences", () => {
		const prompt = composeInstructions("ap");
		assert.ok(prompt.includes("A right option reached by flawed reasoning is `wrong`."));
		assert.ok(prompt.includes("Never build the list from general knowledge or from a site that is not College Board's."));
	});

	it("lists own fragments first, then exactly the five allowlisted shared files", () => {
		assert.deepEqual(
			listSourceSegments("ap").map((segment) => segment.path),
			[
				"ap/00-base.md",
				"ap/10-doctrine.md",
				...AP_SHARED.map((file) => `shared/${file}`),
			],
		);
		assert.ok(!listSourceSegments("ap").some((segment) => segment.path === "system-prompt.md"));
	});

	it("GET /api/settings/prompts exposes the ap segments", async () => {
		const response = await getPromptSegments();
		assert.equal(response.status, 200);
		const view = await response.json();
		assert.ok(Array.isArray(view.ap), "the ap key is present");
		assert.deepEqual(view.ap.map((s: { path: string }) => s.path), listSourceSegments("ap").map((s) => s.path));
	});

	it("accepts ap segment paths", () => {
		assert.equal(isValidSegmentPath("ap/10-doctrine.md"), true);
	});
});