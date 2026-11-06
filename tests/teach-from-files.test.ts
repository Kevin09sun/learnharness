/**
 * Materials the learner points at are the lesson's source, not background
 * reading. Prompt instructions cannot prove model behavior; this pins that the
 * instruction reaches both agents that run a teaching session.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeInstructions } from "../src/agent/teacher-agent.ts";

for (const kind of ["prober", "teacher"] as const) describe(`${kind} prompt`, () => {
	const prompt = composeInstructions(kind);

	it("reads attached materials before asking or planning", () => {
		assert.match(prompt, /Read them before you probe or plan/);
	});

	it("explores an attached folder instead of asking what is inside", () => {
		assert.match(prompt, /A folder is an invitation to look/);
	});

	it("teaches from the materials and cites where things are", () => {
		assert.match(prompt, /the source of the lesson/);
		assert.match(prompt, /Cite file and page or section/);
	});

	it("labels anything from outside the materials", () => {
		assert.match(prompt, /beyond the materials, say so plainly/);
	});
});
