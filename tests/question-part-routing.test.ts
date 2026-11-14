/**
 * The transcript routing of question tool parts (stage 1, task 9 fix round 1).
 * Question tools are client-owned: the live question lives in the dock, and
 * ONLY a settled answer may render in the transcript. If an `ap_mcq` part
 * falls through to the default branch, LiveToolCard prints its raw input —
 * the model's `correctAnswer` and `optionNotes` commitment — while the
 * question streams. This pins the routing decision so deleting the
 * `ap_mcq` case cannot silently restore that leak.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { questionPartDisposition } from "../components/chat.tsx";

const QUESTION_TOOLS = ["quiz", "probe", "ask_user_question", "explain", "recall", "check_point", "ap_mcq"];

describe("questionPartDisposition", () => {
	it("suppresses ap_mcq while streaming and while its input is available", () => {
		assert.equal(questionPartDisposition("tool-ap_mcq", "input-streaming"), "suppress");
		assert.equal(questionPartDisposition("tool-ap_mcq", "input-available"), "suppress");
	});

	it("renders an answered ap_mcq part", () => {
		assert.equal(questionPartDisposition("tool-ap_mcq", "output-available"), "answered");
	});

	it("keeps every existing question tool's routing", () => {
		for (const tool of QUESTION_TOOLS) {
			assert.equal(questionPartDisposition(`tool-${tool}`, "input-streaming"), "suppress", tool);
			assert.equal(questionPartDisposition(`tool-${tool}`, "input-available"), "suppress", tool);
			assert.equal(questionPartDisposition(`tool-${tool}`, "output-available"), "answered", tool);
		}
	});

	it("sends ordinary tools through the normal transcript/artifact routing", () => {
		for (const type of ["tool-read", "tool-grep", "tool-research", "text", "reasoning"]) {
			assert.equal(questionPartDisposition(type, "input-streaming"), "default", type);
			assert.equal(questionPartDisposition(type, "output-available"), "default", type);
		}
	});
});