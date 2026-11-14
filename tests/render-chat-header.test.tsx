/**
 * The chat header's door back to its home surface (AP prep stage 1, task 11):
 * a Test prep session links to its test's readiness page; an AP session
 * links to its course page. The door is a pure body (props in, markup out),
 * exported from the chat so SSR can pin it without the session hook.
 *
 * tsx ignores tsconfig's `jsx` field and uses the CLASSIC transform, so React
 * must be a resolvable global before this module's JSX runs.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionHomeDoor } from "../components/chat.tsx";

describe("the chat header's session door (AP prep, 2026-11-13)", () => {
	it("an AP session links back to its course", () => {
		const html = renderToStaticMarkup(<SessionHomeDoor kind="ap" apCourseId="ap_x" />);
		assert.match(html, /data-testid="ap-course-link"/);
		assert.match(html, /href="\/ap\/ap_x"/);
		assert.match(html, />Course page</);
	});

	it("a Test prep session keeps its readiness door unchanged", () => {
		const html = renderToStaticMarkup(<SessionHomeDoor kind="testprep" testId="test_1" />);
		assert.match(html, /data-testid="test-readiness-link"/);
		assert.match(html, /href="\/tests\/test_1"/);
		assert.match(html, />Readiness</);
	});

	it("no door when the session carries no linked record", () => {
		assert.equal(renderToStaticMarkup(<SessionHomeDoor kind="ap" />), "");
		assert.equal(renderToStaticMarkup(<SessionHomeDoor kind="teach" />), "");
	});
});