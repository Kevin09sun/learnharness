/**
 * ReadinessView (test prep, 2026-11-10): option B of the approved mockup —
 * the test name, one overall "Ready: N%" (the count-based rule), a bar per
 * section with its solid/total, and each section's points behind a click,
 * with their status badges. The page also owns the two actions: an
 * "Edit plan" toggle reusing PlanEditor (saving with confirm:true) and
 * "Continue where I left off", which creates the next testprep sitting with
 * that test's id and sends "Continue." as its first message.
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
import { ReadinessView } from "../components/test-prep/readiness-view.tsx";
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

// SessionStarter stashes the opening message before navigating; the same-tab
// handover needs sessionStorage (the render-new-session stub).
const stored = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", {
	configurable: true,
	value: {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => {
			stored.set(key, value);
		},
		removeItem: (key: string) => {
			stored.delete(key);
		},
	},
});

const originalFetch = globalThis.fetch;
let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function unmount() {
	await act(async () => root?.unmount());
	host?.remove();
	root = undefined;
	host = undefined;
}

afterEach(async () => {
	await unmount();
	globalThis.fetch = originalFetch;
	stored.clear();
});

/** Two solid points of four: overall 50%, with a re-check due and a gap. */
function record(overrides: Partial<TestRecord> = {}): TestRecord {
	return {
		id: "test_1",
		title: "Bio midterm",
		createdAt: "2026-11-10T12:00:00.000Z",
		updatedAt: "2026-11-10T12:00:00.000Z",
		planConfirmed: true,
		version: 1,
		sections: [
			{
				id: "section_1",
				title: "Membranes & transport",
				points: [
					{ id: "point_1", text: "Cell membrane structure", source: "outline 1", status: "solid", history: [] },
					{ id: "point_2", text: "Passive vs active transport", source: "outline 2", status: "solid", history: [] },
					{
						id: "point_3",
						text: "Osmosis in hypertonic solutions",
						source: "outline 3",
						status: "fixed-recheck",
						fixedIn: "chat_0",
						history: [],
					},
					{ id: "point_4", text: "Enzymes and activation energy", source: "outline 4", status: "gap", history: [] },
				],
			},
		],
		...overrides,
	};
}

interface SeenRequest {
	url: string;
	method: string;
	body: unknown;
}

/** Mounts against a mock API, returning every request and the navigation. */
async function mount(options: { navigate?: (target: string) => void; test?: TestRecord } = {}) {
	const seen: SeenRequest[] = [];
	const navigated: string[] = [];
	const navigate = options.navigate ?? ((target: string) => navigated.push(target));
	let current = options.test ?? record();
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const method = init?.method ?? "GET";
		const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
		seen.push({ url, method, body });
		if (url === "/api/chats" && method === "POST") return Response.json({ id: "chat_new", testId: "test_1" });
		if (url === "/api/tests/test_1/plan" && method === "PUT") {
			const draft = (body as { sections: TestRecord["sections"]; confirm: boolean });
			current = { ...current, sections: draft.sections, planConfirmed: draft.confirm ? true : current.planConfirmed };
			return Response.json(current);
		}
		throw new Error(`unexpected request ${method} ${url}`);
	}) as typeof fetch;

	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => {
		root!.render(<ReadinessView test={current} navigate={navigate} />);
	});
	return { seen, navigated };
}

function buttonByText(text: string): HTMLButtonElement | undefined {
	return [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
		button.textContent?.includes(text),
	);
}

test("renders the overall count-based readiness and each section's solid/total", async () => {
	await mount();

	const text = document.body.textContent ?? "";
	assert.match(text, /Ready: 50%/, "two of four solid is 50%");
	assert.match(text, /Membranes & transport/);
	assert.match(text, /2\/4/, "the section bar carries its counts");
});

test("an unconfirmed plan hides Continue and shows the review cue", async () => {
	await mount({ test: record({ planConfirmed: false }) });

	assert.equal(
		!!document.querySelector('[data-testid="continue-test"]'),
		false,
		"no Continue before confirmation",
	);
	assert.match(document.body.textContent ?? "", /Plan awaiting review — confirm it in the chat\./);
	assert.ok(document.querySelector('[data-testid="edit-plan"]'), "Edit plan stays available");
});

test("a confirmed plan still shows Continue", async () => {
	await mount();

	assert.ok(document.querySelector('[data-testid="continue-test"]'));
	assert.ok(!(document.body.textContent ?? "").includes("Plan awaiting review"));
});

test("clicking a section expands its points with status badges", async () => {
	await mount();

	const section = document.querySelector<HTMLButtonElement>('[data-testid="readiness-section-section_1"]');
	assert.ok(section, "the section row is a toggle");
	assert.equal(section!.getAttribute("aria-expanded"), "false");

	await act(async () => section!.click());

	const text = document.body.textContent ?? "";
	assert.match(text, /Re-check next time/, "a fixed point is due for a later-sitting re-check");
	assert.match(text, /Not checked yet|Gap|Solid/);
	const labels = [...document.querySelectorAll('[data-testid="point-status"]')].map((node) => node.textContent);
	assert.deepEqual(labels, ["Solid", "Solid", "Re-check next time", "Gap"]);
	assert.equal(
		document.querySelector<HTMLButtonElement>('[data-testid="readiness-section-section_1"]')?.getAttribute("aria-expanded"),
		"true",
	);
});

test("Edit plan reuses the editor and saves with confirm:true", async () => {
	const { seen } = await mount();

	await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="edit-plan"]')!.click());
	assert.ok(document.querySelector('[data-testid="plan-editor"]'), "the plan editor opens");

	const save = buttonByText("Save plan");
	assert.ok(save, "the readiness editor's action reads Save plan");

	await act(async () => save!.click());

	const put = seen.find((request) => request.method === "PUT");
	assert.ok(put, "one PUT");
	assert.equal(put!.url, "/api/tests/test_1/plan");
	const body = put!.body as { confirm: boolean; sections: Array<{ id?: string; points: Array<{ id?: string }> }> };
	assert.equal(body.confirm, true, "a readiness edit stays confirmed");
	assert.equal(body.sections[0]?.id, "section_1");
	assert.deepEqual(
		body.sections[0]?.points.map((point) => point.id),
		["point_1", "point_2", "point_3", "point_4"],
		"the ids ride through so mergePlan keeps their statuses",
	);
	assert.equal(document.querySelector('[data-testid="plan-editor"]'), null, "the editor closes after saving");
});

test("Continue creates the next testprep sitting with 'Continue.' as its first message", async () => {
	const { seen, navigated } = await mount();

	await act(async () =>
		document.querySelector<HTMLButtonElement>('[data-testid="continue-test"]')!.click(),
	);

	const post = seen.find((request) => request.method === "POST" && request.url === "/api/chats");
	assert.ok(post, "the continue action creates a session");
	assert.deepEqual(post!.body, { title: "Continue.", kind: "testprep", testId: "test_1" });
	assert.deepEqual(navigated, ["/chat/chat_new"], "it lands on the new sitting");
});