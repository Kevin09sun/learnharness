/**
 * TEST-PREP PROMPT (test prep, 2026-11-10): the test-prep agent composes its
 * OWN base + doctrine (never the teaching base) and a CURATED shared
 * appendix — voice, accuracy, learner files and formatting. The question
 * mechanics and confidence chunks stay out: test prep has its own
 * no-hints/no-explanation doctrine and no quiz/confidence tools.
 *
 * The order pin: own fragments first, then the four allowlisted shared
 * files in filename order — the same composition order the loader uses.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { listSourceSegments } from "../src/agent/prompt-segments.ts";
import { composeInstructions } from "../src/agent/teacher-agent.ts";

const promptText = (relative: string) =>
	readFileSync(new URL(`../src/agent/prompts/${relative}`, import.meta.url), "utf8").trim();

const TESTPREP_SHARED = ["10-voice.md", "15-accuracy.md", "30-learner-files.md", "40-formatting.md"];

describe("testprep prompt composition", () => {
	it("composes the doctrine and the formatting appendix — never the teaching base or question mechanics", () => {
		const prompt = composeInstructions("testprep");
		// The doctrine's rules are binding content; the wording is ours, so
		// assert the load-bearing instructions themselves.
		for (const rule of [
			"propose_plan",
			"test_progress",
			"check_point",
			"record_result",
			"dontKnow",
			"Never invent",
		]) {
			assert.ok(prompt.includes(rule), `missing doctrine rule: ${rule}`);
		}
		// The own fragments compose verbatim…
		assert.ok(prompt.includes(promptText("testprep/00-base.md")));
		assert.ok(prompt.includes(promptText("testprep/10-doctrine.md")));
		// …and the allowlisted formatting guide is the trailing appendix.
		assert.ok(prompt.includes(promptText("shared/40-formatting.md")));
		// The teaching base and the question/confidence mechanics never compose.
		assert.doesNotMatch(prompt, /install understanding/);
		assert.doesNotMatch(prompt, /## The question tools/);
		assert.doesNotMatch(prompt, /Every quiz answer carries/);
	});

	it("tells the agent the learner's answer IS its check_point result, to grade in that turn", () => {
		const prompt = composeInstructions("testprep");
		assert.ok(
			prompt.includes(
				"The learner's answer arrives as the result of your `check_point` call; grade it in that turn (`record_result`, then ✓ or explanation + fresh question) — never re-pose the same question or treat it as unanswered.",
			),
			"missing the check_point answer-arrival doctrine",
		);
	});

	it("lists own fragments first, then exactly the four allowlisted shared files", () => {
		assert.deepEqual(
			listSourceSegments("testprep").map((segment) => segment.path),
			[
				"testprep/00-base.md",
				"testprep/10-doctrine.md",
				...TESTPREP_SHARED.map((file) => `shared/${file}`),
			],
		);
	});
});