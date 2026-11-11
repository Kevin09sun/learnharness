/**
 * PlanReviewCard (test prep, 2026-11-10): the propose_plan artifact. It
 * renders the LATEST saved record (not the tool call's arguments), shows each
 * point's source so coverage is auditable, and confirming does exactly two
 * things: one PUT with the edited sections + confirm:true, then one learner
 * message "I've confirmed the plan." through the session's normal send path
 * (ChatActionsContext — the demo card's seam).
 *
 * tsx uses the CLASSIC JSX transform: React must be a resolvable global
 * before this module's JSX runs (the render-cards shim), and linkedom gives
 * createRoot a document (the chatgpt-ui shim).
 */

import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { ChatActionsContext } from "../components/chat.tsx";
import { PlanReviewCard } from "../components/test-prep/plan-review-card.tsx";
import type { TestRecord } from "../src/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const originalFetch = globalThis.fetch;
let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	root = undefined;
	host = undefined;
	globalThis.fetch = originalFetch;
});

function record(overrides: Partial<TestRecord> = {}): TestRecord {
	return {
		id: "test_1",
		title: "Algebra",
		createdAt: "2026-11-10T12:00:00.000Z",
		updatedAt: "2026-11-10T12:00:00.000Z",
		planConfirmed: false,
		version: 1,
		sections: [
			{
				id: "section_1",
				title: "Section A",
				points: [
					{ id: "point_1", text: "Point one", source: "outline.md", status: "unchecked", history: [] },
					{ id: "point_2", text: "Point two", source: "slides 4-6", status: "unchecked", history: [] },
				],
			},
		],
		...overrides,
	};
}

/** Mounts the card against a mock API, returning the requests it saw. */
async function mount(initial: TestRecord) {
	const puts: Array<{ method: string; body: unknown }> = [];
	const sent: string[] = [];
	let current = initial;
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		if (url === "/api/chats/chat_1") return Response.json({ id: "chat_1", testId: initial.id });
		if (url === `/api/tests/${initial.id}/plan` && (init?.method ?? "GET") === "GET") {
			return Response.json(current);
		}
		if (url === `/api/tests/${initial.id}/plan` && init?.method === "PUT") {
			const body = JSON.parse(String(init.body)) as { sections: TestRecord["sections"]; confirm: boolean };
			puts.push({ method: init.method, body });
			current = { ...current, planConfirmed: body.confirm ? true : current.planConfirmed, sections: body.sections };
			return Response.json(current);
		}
		throw new Error(`unexpected request ${url}`);
	}) as typeof fetch;

	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => {
		root!.render(
			<ChatActionsContext.Provider
				value={{
					chatId: "chat_1",
					syncFromServer: async () => {},
					sendText: (text: string) => {
						sent.push(text);
					},
					openSetup: () => {},
				}}
			>
				<PlanReviewCard
					part={{
						type: "tool-propose_plan",
						state: "output-available",
						toolCallId: "call_1",
						// Deliberately different from the record: the card must
						// render the saved plan, never the call arguments.
						input: {
							sections: [{ title: "From the call", points: [{ text: "Call text", source: "call.md" }] }],
						},
					}}
				/>
			</ChatActionsContext.Provider>,
		);
	});
	return { puts, sent };
}

test("renders each saved point with its source, not the call arguments", async () => {
	await mount(record());

	const pointOne = document.querySelector<HTMLInputElement>('input[aria-label="Section 1, point 1"]');
	const pointTwo = document.querySelector<HTMLInputElement>('input[aria-label="Section 1, point 2"]');
	assert.equal(pointOne?.value, "Point one");
	assert.equal(pointTwo?.value, "Point two");
	const sources = [...document.querySelectorAll('[data-testid="plan-source"]')].map((node) => node.textContent);
	assert.deepEqual(sources, ["outline.md", "slides 4-6"], "every point's source is shown");
	assert.ok(
		document.querySelector('[data-testid="plan-source"]')?.classList.contains("text-muted-foreground"),
		"the source is provenance, in the muted register",
	);
	assert.doesNotMatch(document.body.textContent ?? "", /Call text/, "the tool call's stale draft never wins over the saved record");
	assert.notEqual(pointOne?.value, "Call text");
});

test("Confirm sends one PUT with confirm:true carrying the ids, then one learner message", async () => {
	const { puts, sent } = await mount(record());

	const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
		button.textContent?.includes("Confirm plan"),
	);
	assert.ok(confirm, "the card offers Confirm plan");

	await act(async () => confirm!.click());

	assert.equal(puts.length, 1, "exactly one PUT");
	assert.equal(puts[0]!.method, "PUT");
	const body = puts[0]!.body as {
		confirm: boolean;
		sections: Array<{ id?: string; points: Array<{ id?: string }> }>;
	};
	assert.equal(body.confirm, true);
	assert.equal(body.sections[0]?.id, "section_1", "the editor carries the section id through");
	assert.deepEqual(
		body.sections[0]?.points.map((point) => point.id),
		["point_1", "point_2"],
		"the editor carries every point id through, so mergePlan keeps statuses",
	);
	assert.deepEqual(sent, ["I've confirmed the plan."], "exactly one learner message, after the PUT");
});

test("a confirmed plan collapses to a summary linking to the readiness page", async () => {
	await mount(record({ planConfirmed: true }));

	assert.ok(document.querySelector('[data-testid="plan-confirmed"]'), "confirmed summary renders");
	const link = document.querySelector<HTMLAnchorElement>('a[href="/tests/test_1"]');
	assert.ok(link, "the summary links to the readiness page");
	assert.match(document.body.textContent ?? "", /Plan confirmed/);
});