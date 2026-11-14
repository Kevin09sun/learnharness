/**
 * The home entry's AP mode (AP prep stage 1, task 11): the mode switch gains
 * a fourth mode, AP, LAST; in AP mode the composer text IS the course name,
 * so the send body carries it twice — as the session title and as the new
 * course's title — and there is no test-name field or gate. The component's
 * pure seams are exported for this pin (the DraftShell precedent: a client
 * surface with hooks, tested through its pure body).
 *
 * tsx ignores tsconfig's `jsx` field and uses the CLASSIC transform, so React
 * must be a resolvable global before this module's JSX runs.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	HOME_MODES,
	HOME_MODE_LABELS,
	HomeAttachButton,
	homeCreationBody,
	homePlaceholder,
	homeSendDisabled,
} from "../components/home.tsx";

const noProps: { id: string; name: string; statement: string }[] = [];

describe("the home mode switch (AP prep, 2026-11-13)", () => {
	it("has four modes with AP last", () => {
		assert.deepEqual([...HOME_MODES], ["teach", "practice", "testprep", "ap"]);
		assert.equal(HOME_MODE_LABELS.ap, "AP");
	});

	it("AP names the course in the composer", () => {
		assert.equal(homePlaceholder("ap"), "Which AP course? e.g. AP Calculus BC");
	});
});

describe("the home AP send", () => {
	it("creates the course's setup session: the text is both the title and the course name", () => {
		assert.deepEqual(
			homeCreationBody({ mode: "ap", title: "AP Calculus BC", testName: "", practiceProps: noProps }),
			{ title: "AP Calculus BC", kind: "ap", apCourseTitle: "AP Calculus BC" },
		);
	});

	it("carries no graph context — the picks belong to Practice, like Test prep", () => {
		assert.deepEqual(
			homeCreationBody({
				mode: "ap",
				title: "AP Biology",
				testName: "",
				practiceProps: [{ id: "n_1", name: "Parity", statement: "Odd + odd = even." }],
			}),
			{ title: "AP Biology", kind: "ap", apCourseTitle: "AP Biology" },
		);
	});

	it("is disabled while the box is empty and needs no test name", () => {
		const base = { mode: "ap" as const, testName: "", busy: false, dictationActive: false };
		assert.equal(homeSendDisabled({ ...base, title: "" }), true);
		assert.equal(homeSendDisabled({ ...base, title: "   " }), true);
		assert.equal(homeSendDisabled({ ...base, title: "AP Calculus BC" }), false);
	});

	it("Test prep keeps its test-name gate (the AP mode must not weaken it)", () => {
		const base = { mode: "testprep" as const, title: "Chapters 4-6", busy: false, dictationActive: false };
		assert.equal(homeSendDisabled({ ...base, testName: "" }), true);
		assert.equal(homeSendDisabled({ ...base, testName: "Bio midterm" }), false);
	});
});

describe("home's attach control (name-only AP start, 2026-11-13)", () => {
	it("AP renders no attach control", () => {
		const html = renderToStaticMarkup(
			<HomeAttachButton mode="ap" editorRef={React.createRef<HTMLDivElement>()} />,
		);
		assert.equal(html, "", "nothing is drawn in AP mode");
	});

	it("Test prep still renders its attach control", () => {
		const html = renderToStaticMarkup(
			<HomeAttachButton mode="testprep" editorRef={React.createRef<HTMLDivElement>()} />,
		);
		assert.ok(html.includes('data-testid="attach-files"'));
	});
});