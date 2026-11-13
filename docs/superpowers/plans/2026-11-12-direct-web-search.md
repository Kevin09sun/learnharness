# Direct Web Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the four conversation tutors (teacher, prober, practice, test prep) the existing `web_search` and `web_fetch` tools directly, behind a Settings switch keyed `web` that is on by default.

**Architecture:** The researcher's tools come from `createWebTools(search)` in `src/agent/tools/web.ts`. A new helper in the same file, `tutorWebTools(search, enabled)`, returns that pair or nothing, and each tutor registry spreads it. The live search service reaches the registries as a new optional `search` field on each tool context, filled by `src/server/chat-handler.ts` with the existing `searchProvider`. One new shared prompt fragment tells the tutors when to use the tools.

**Tech Stack:** TypeScript, `@earendil-works/pi-agent-core` tools, `node:test` + `node:assert/strict`, React (settings and chat cards).

**Spec:** `docs/superpowers/specs/2026-11-12-direct-web-search-design.md`

## Global Constraints

- Read `AGENTS.md` first. Before touching any Next.js route or page, read the relevant guide in `node_modules/next/dist/docs/`. No task here needs a route or page change.
- Reuse `createWebTools` and `searchProvider`; no second search path.
- `src/agent/**` may import types from `src/core/search.ts` and never from `src/server/**`.
- The background `research` job is not changed: not its description, its registration, or its researcher tools.
- Explicit test registries (`AgentBuildOptions.tools`) stay caller-owned: never add web tools to them.
- Run one test file: `NODE_ENV=test tsx --test tests/<file>`. Run the suite: `NODE_ENV=test tsx --test tests/*.test.ts tests/*.test.tsx`. On Windows PowerShell set `$env:NODE_ENV = 'test'` first.
- Commit messages follow the repo's `feat(scope): …` / `fix(scope): …` style and end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Do not stage or commit the unrelated modified files already in the working tree, or `.superpowers/`.

## Review Focus

1. Switch off (`agent.tools.web === false`): neither tool is in any of the four registries. Tests in Tasks 3 and 4.
2. No `search` field on the context (tests, wiring bugs): neither tool is present, and no existing registry test changes its expected tool list. Tests in Tasks 1, 3 and 4.
3. Key removed or added mid-session: the next `web_search` call reflects it, because the provider is resolved per call. Test in Task 1.
4. `web_fetch` on a PDF link: the tutor has no `web_fetch_pdf`, so the pointer text must not send it to a tool it lacks. Test in Task 1.
5. Settings write: `PUT` with `{ agent: { tools: { web: false } } }` is accepted, not rejected as an unknown tool. Test in Task 2.

Not covered by an automated test, to check by hand after the last task: on the Claude Code route, a `web_fetch` of a long page (near 40,000 characters) returns intact to the tutor.

---

### Task 1: `tutorWebTools`, the no-key message and the PDF pointer

**Files:**
- Modify: `src/agent/tools/web.ts`
- Test: `tests/web-search.test.ts`

**Interfaces:**
- Produces: `export function tutorWebTools(search: (() => SearchProvider | null) | undefined, enabled?: EnabledTools): Record<string, AgentTool<any>>` in `src/agent/tools/web.ts`. Returns `{}` when `search` is `undefined` or `enabled?.web === false`; otherwise `createWebTools(search)`.
- Produces: `export const WEB_SEARCH_UNAVAILABLE: string` in the same file, the exact no-provider text below.

- [ ] **Step 1: Write the failing tests** in `tests/web-search.test.ts`

Replace the pinned string in the existing test `null provider → the honest unavailability string, never a crash` with the imported `WEB_SEARCH_UNAVAILABLE`, and add:

```ts
describe("tutorWebTools", () => {
	it("no search seam → no web tools", () => {
		assert.deepEqual(Object.keys(tutorWebTools(undefined)), []);
	});
	it("web: false → no web tools, even with a live provider", () => {
		assert.deepEqual(Object.keys(tutorWebTools(() => stubProvider(), { web: false })), []);
	});
	it("seam present, switch absent or true → both tools", () => {
		assert.deepEqual(Object.keys(tutorWebTools(() => null)), ["web_search", "web_fetch"]);
		assert.deepEqual(Object.keys(tutorWebTools(() => stubProvider(), { web: true })), ["web_search", "web_fetch"]);
	});
	it("other switches do not remove the web tools", () => {
		assert.deepEqual(Object.keys(tutorWebTools(() => null, { research: false })), ["web_search", "web_fetch"]);
	});
	it("the provider is resolved per call", async () => {
		let live: SearchProvider | null = null;
		const { web_search } = tutorWebTools(() => live);
		assert.equal((await web_search!.execute!("c1", { query: "q" })).details, WEB_SEARCH_UNAVAILABLE);
		live = stubProvider();
		assert.deepEqual((await web_search!.execute!("c2", { query: "q" })).details, [{ title: "t", url: "https://e.com/", snippet: "s" }]);
	});
	it("the unavailable text reads correctly for a tutor", () => {
		assert.equal(
			WEB_SEARCH_UNAVAILABLE,
			"web_search is not available: no search engine is configured. " +
				"A Tavily, Brave, Exa, Firecrawl, or Ollama search API key can be added in Settings. " +
				"Say plainly that web search is unavailable; do not present an unchecked claim as checked.",
		);
	});
	it("a PDF link points at tools the caller may have", async (t) => {
		t.mock.method(globalThis, "fetch", async () =>
			new Response("%PDF", { status: 200, headers: { "content-type": "application/pdf" } }));
		const { web_fetch } = tutorWebTools(() => null);
		const out = await web_fetch!.execute!("c1", { url: "https://e.com/a.pdf" });
		assert.equal(
			out.details,
			"web_fetch: this URL is a PDF document. If you have web_fetch_pdf, call it on this URL; otherwise dispatch research to read it.",
		);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NODE_ENV=test tsx --test tests/web-search.test.ts`
Expected: FAIL, `tutorWebTools` and `WEB_SEARCH_UNAVAILABLE` are not exported.

- [ ] **Step 3: Implement** in `src/agent/tools/web.ts`

Add `WEB_SEARCH_UNAVAILABLE` with the exact text from the test and return it from `web_search` when the provider is null. Change the PDF pointer in `fetchAndExtract` to the exact text from the test. Add `tutorWebTools` with the signature above; import `type EnabledTools` from `../../core/pending.ts`. Update the file's header comment, which says the tools are for the researcher only.

- [ ] **Step 4: Find other pins of the two old strings**

Run: `grep -rn "Report in your brief that web search" tests src` and `grep -rn "call web_fetch_pdf on it" tests src`
Expected: no matches after updating any that appear.

- [ ] **Step 5: Run to verify pass**

Run: `NODE_ENV=test tsx --test tests/web-search.test.ts`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add src/agent/tools/web.ts tests/web-search.test.ts
git commit -m "feat(web): tutorWebTools seam and tutor-safe tool messages"
```

---

### Task 2: The `web` switch in Settings

**Files:**
- Modify: `src/core/pending.ts:93` (`TOGGLEABLE_TOOLS`) and its comment
- Modify: `components/settings/agent-section.tsx:94` (`TOGGLE_TOOLS`) and the row label at `:844-856`
- Test: `tests/question-tools.test.ts:256-263`, `tests/render-settings.test.tsx:196-207`, and the test file that covers the settings write-side "unknown tool" rejection (find it with `grep -rln "unknown tool" tests`)

**Interfaces:**
- Produces: `TOGGLEABLE_TOOLS = ["research", "demo", "visual", "pdf", "web"]`; `WRITABLE_TOOL_KEYS` follows from it unchanged in code.
- Produces: `TOGGLE_TOOLS = ["research", "demo", "visual", "pdf", "web"]`; the `web` row's label is `Tool · web search`, its testid `tool-row-web`, its `Toggle` label `tool web`.

- [ ] **Step 1: Update the failing pins and add the write-side case**

In `tests/question-tools.test.ts` the pin becomes `assert.deepEqual(TOGGLEABLE_TOOLS, ["research", "demo", "visual", "pdf", "web"]);`. In `tests/render-settings.test.tsx` the `TOGGLE_TOOLS` pin becomes the same five, and add assertions that the rendered section contains `data-testid="tool-row-web"` and the text `Tool · web search`, and that the `web` toggle is checked with no saved settings. In the write-side test file add a case, in that file's existing style, that a body with `agent.tools = { web: false }` parses with `ok: true` and yields `tools.web === false`.

- [ ] **Step 2: Run to verify failure**

Run: `NODE_ENV=test tsx --test tests/question-tools.test.ts tests/render-settings.test.tsx <write-side test file>`
Expected: FAIL on the three updated pins and the new write-side case (`unknown tool "web"`).

- [ ] **Step 3: Implement**

Add `"web"` to both lists. In `agent-section.tsx` render the label as `Tool · web search` for `web` and `Tool · ${id}` for the others. In `pending.ts` amend the `TOGGLEABLE_TOOLS` comment: the list is the sub-agent job tools plus `web`, which governs the tutors' direct `web_search` and `web_fetch` together and is applied by `tutorWebTools`, not by `filterEnabledTools` (whose keys are tool names).

- [ ] **Step 4: Run to verify pass**

Run: the same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/pending.ts components/settings/agent-section.tsx tests/question-tools.test.ts tests/render-settings.test.tsx <write-side test file>
git commit -m "feat(settings): web search switch"
```

---

### Task 3: Teacher and prober registries

**Files:**
- Modify: `src/agent/tools.ts` (`ProberToolContext` :264-280, `createProberTools` :282-349, `TeacherToolContext` :394-404, `createTeacherTools` :435-470)
- Test: `tests/tool-toggles-bridge.test.ts`

**Interfaces:**
- Consumes: `tutorWebTools` from Task 1.
- Produces: optional field `search?: () => SearchProvider | null` on both `ProberToolContext` and `TeacherToolContext` (type imported from `../core/search.ts`).

- [ ] **Step 1: Write the failing tests** in `tests/tool-toggles-bridge.test.ts`, reusing that file's existing context fixtures

```ts
describe("direct web tools: teacher and prober", () => {
	it("teacher: search seam → both tools; web:false → neither", () => {
		const on = createTeacherTools({ ...teacherCtx, search: () => null });
		assert.ok(on.web_search && on.web_fetch);
		const off = createTeacherTools({ ...teacherCtx, search: () => null }, { web: false });
		assert.equal(off.web_search, undefined);
		assert.equal(off.web_fetch, undefined);
		assert.ok(off.research, "the research job is untouched by the web switch");
	});
	it("teacher: no search seam → neither tool", () => {
		const tools = createTeacherTools(teacherCtx);
		assert.equal(tools.web_search, undefined);
		assert.equal(tools.web_fetch, undefined);
	});
	it("prober: search seam → both tools; web:false → neither; probe_done stays", () => {
		const on = createProberTools({ ...proberCtx, search: () => null });
		assert.ok(on.web_search && on.web_fetch);
		const off = createProberTools({ ...proberCtx, search: () => null }, { web: false });
		assert.equal(off.web_search, undefined);
		assert.equal(off.web_fetch, undefined);
		assert.ok(off.probe_done);
	});
	it("research:false leaves the web tools in place", () => {
		const tools = createTeacherTools({ ...teacherCtx, search: () => null }, { research: false });
		assert.equal(tools.research, undefined);
		assert.ok(tools.web_search && tools.web_fetch);
	});
});
```

`teacherCtx` and `proberCtx` stand for the fixtures the file already builds; if it builds them inline, lift them into named constants.

- [ ] **Step 2: Run to verify failure**

Run: `NODE_ENV=test tsx --test tests/tool-toggles-bridge.test.ts`
Expected: FAIL, `search` is not a known context property and the tools are absent.

- [ ] **Step 3: Implement**

Add the `search` field to both context interfaces. In each registry, spread `...tutorWebTools(ctx.search, enabled)` into the object passed to `filterEnabledTools`, after the job tools.

- [ ] **Step 4: Run to verify pass, and that no registry pin moved**

Run: `NODE_ENV=test tsx --test tests/tool-toggles-bridge.test.ts tests/question-tools.test.ts tests/jobs.test.ts tests/web-search.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools.ts tests/tool-toggles-bridge.test.ts
git commit -m "feat(web): teacher and prober get direct web tools"
```

---

### Task 4: Practice and Test prep registries, and the composition root

**Files:**
- Modify: `src/agent/tools/practice.ts` (`PracticeToolContext` :32-47, `practiceTools` :222-249)
- Modify: `src/agent/tools/test-prep.ts` (`TestPrepToolContext` :43-53, `testPrepTools` :325-348)
- Modify: `src/agent/teacher-agent.ts:347-364` (`createPracticeAgent`, `createTestPrepAgent`)
- Modify: `src/server/chat-handler.ts:473-553` (the four agent contexts) and the stale comment at `:530-531`
- Test: `tests/practice-agents.test.ts`, `tests/test-prep-tools.test.ts`

**Interfaces:**
- Consumes: `tutorWebTools` from Task 1; the `search` context field from Task 3.
- Produces: optional field `search?: () => SearchProvider | null` on `PracticeToolContext` and `TestPrepToolContext`.
- Produces: `practiceTools(ctx: PracticeToolContext, enabled?: EnabledTools)` and `testPrepTools(ctx: TestPrepToolContext, enabled?: EnabledTools)`. `enabled` is read only for the `web` key; no other tool in these registries becomes switchable.

- [ ] **Step 1: Write the failing tests**

In `tests/practice-agents.test.ts` and `tests/test-prep-tools.test.ts`, reusing each file's context fixture (`ctx` below):

```ts
it("search seam → both web tools; web:false → neither; nothing else is filtered", () => {
	const on = practiceTools({ ...ctx, search: () => null });
	assert.ok(on.web_search && on.web_fetch);
	const off = practiceTools({ ...ctx, search: () => null }, { web: false, research: false, pdf: false });
	assert.equal(off.web_search, undefined);
	assert.equal(off.web_fetch, undefined);
	assert.deepEqual(
		Object.keys(off).sort(),
		Object.keys(practiceTools(ctx)).sort(),
		"research:false and pdf:false are ignored here, as before",
	);
});
it("no search seam → no web tools", () => {
	const tools = practiceTools(ctx);
	assert.equal(tools.web_search, undefined);
});
it("the factory forwards the web switch", () => {
	const agent = createPracticeAgent({ ...ctx, search: () => null }, { engine: fauxEngine(), toolToggles: { web: false } });
	const names = agent.state.tools.map((tool) => tool.name);
	assert.ok(!names.includes("web_search") && !names.includes("web_fetch"));
});
```

Write the same three for `testPrepTools` / `createTestPrepAgent`. Read tool names off the agent the way `tests/tool-toggles-bridge.test.ts` already does if it differs from `agent.state.tools`.

- [ ] **Step 2: Run to verify failure**

Run: `NODE_ENV=test tsx --test tests/practice-agents.test.ts tests/test-prep-tools.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the registries and factories**

Add the `search` field and the `enabled` parameter; spread `...tutorWebTools(ctx.search, enabled)` last in each registry object. In `teacher-agent.ts` the two factories call `practiceTools(ctx, opts.toolToggles)` and `testPrepTools(ctx, opts.toolToggles)`. Update the registry comments that say nothing is toggle-filtered: the `web` switch is the one exception.

- [ ] **Step 4: Wire the composition root**

In `src/server/chat-handler.ts`, add `search: searchProvider` to each of the four contexts built in the per-turn branch (test prep, practice, teacher, prober). `searchProvider` is already imported at `:37`. Replace the stale comment above the teacher's `searchAvailable` ("The registry drop's signal … no live engine = no research tool in the teacher's registry") with one line: research is registered with or without a search key; `searchAvailable` is a retained status seam.

- [ ] **Step 5: Run to verify pass, and type-check**

Run: `NODE_ENV=test tsx --test tests/practice-agents.test.ts tests/test-prep-tools.test.ts tests/tool-toggles-bridge.test.ts`
Expected: PASS.
Run: the type-check script named in `package.json` `scripts` (if there is none, `npx tsc --noEmit`).
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/agent/tools/practice.ts src/agent/tools/test-prep.ts src/agent/teacher-agent.ts src/server/chat-handler.ts tests/practice-agents.test.ts tests/test-prep-tools.test.ts
git commit -m "feat(web): practice and test prep get direct web tools"
```

---

### Task 5: Tutor instructions

**Files:**
- Create: `src/agent/prompts/shared/35-web.md`
- Modify: `src/agent/prompt-segments.ts:38-50` (`PRACTICE_SHARED_FRAGMENTS`, `TESTPREP_SHARED_FRAGMENTS`)
- Modify: `src/agent/prompts/testprep/10-doctrine.md` (end of "Scoping the plan")
- Test: `tests/prompt-overrides.test.ts`, `tests/practice-agents.test.ts`, `tests/test-prep-prompt.test.ts`

**Interfaces:**
- Produces: segment path `shared/35-web.md`, composed for all four agents. Teacher and prober pick up every shared fragment automatically; practice and test prep need it in their allowlists.

- [ ] **Step 1: Write the failing tests**

In each of the three test files, in its existing style for listing an agent's segments (`listSourceSegments(agent)` from `src/agent/prompt-segments.ts`):

```ts
for (const agent of ["prober", "teacher", "practice", "testprep"] as const) {
	it(`${agent} composes shared/35-web.md after 30-learner-files and before 40-formatting`, () => {
		const paths = listSourceSegments(agent).map((s) => s.path);
		assert.ok(paths.includes("shared/35-web.md"));
		assert.ok(paths.indexOf("shared/35-web.md") < paths.indexOf("shared/40-formatting.md"));
	});
}
it("test prep doctrine bars the web from scoping", () => {
	const doctrine = fs.readFileSync("src/agent/prompts/testprep/10-doctrine.md", "utf8");
	assert.ok(doctrine.includes("Never use the web to decide what the test covers."));
});
```

Put the loop in `tests/prompt-overrides.test.ts` and the doctrine test in `tests/test-prep-prompt.test.ts`. If any existing test pins the exact segment list of an agent, add `shared/35-web.md` to that pin.

- [ ] **Step 2: Run to verify failure**

Run: `NODE_ENV=test tsx --test tests/prompt-overrides.test.ts tests/practice-agents.test.ts tests/test-prep-prompt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create `src/agent/prompts/shared/35-web.md`** with exactly:

```md
## Web lookups

When `web_search` and `web_fetch` are among your tools, you can search the web with `web_search` and read a page with `web_fetch`. Use them when you are not certain of a fact, when the answer may have changed recently, or when the learner asks you to look something up. Do not search for what you know well. Search with a few focused queries, read the most authoritative result rather than relying on the snippet, and prefer primary and official sources. Give the source as a link next to each claim you took from the web. If `web_search` reports that search is not set up, tell the learner so and that a key can be added in Settings; do not present an unchecked claim as checked. For a PDF on the web, or a lookup needing many pages, dispatch `research` instead.
```

- [ ] **Step 4: Register and extend**

Add `"35-web.md"` to `PRACTICE_SHARED_FRAGMENTS` and `TESTPREP_SHARED_FRAGMENTS`, keeping numeric order. Append to the "Scoping the plan" section of `10-doctrine.md`, as its own paragraph after the "Never invent scope from general knowledge." paragraph, exactly:

```md
Web lookups are for verifying facts and committed answers. Never use the web to decide what the test covers.
```

- [ ] **Step 5: Run to verify pass**

Run: the same command as Step 2.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/prompts/shared/35-web.md src/agent/prompt-segments.ts src/agent/prompts/testprep/10-doctrine.md tests/prompt-overrides.test.ts tests/practice-agents.test.ts tests/test-prep-prompt.test.ts
git commit -m "feat(web): tutor instructions for web lookups"
```

---

### Task 6: Show the lookups in the chat

**Files:**
- Modify: `components/artifacts/index.ts` (`artifactRenderers`)
- Modify: `components/artifacts/tool-call-card.tsx:26-43` (`headlineArg`)
- Modify: `src/core/pending.ts:168-179` (`ACTIVITY_LABELS`)
- Test: the existing render test for `ToolCallCard` (find with `grep -rln "ToolCallCard\|tool-call-card" tests`) and the test covering `ACTIVITY_LABELS` (find with `grep -rln "ACTIVITY_LABELS\|Working…" tests`)

**Interfaces:**
- Produces: `artifactRenderers.web_search` and `artifactRenderers.web_fetch`, both `ToolCallCard`. Without these a settled call renders nothing.
- Produces: collapsed headline is the `query` for `web_search` and the `url` for `web_fetch`.
- Produces: `ACTIVITY_LABELS.web_search = "Searching the web…"`, `ACTIVITY_LABELS.web_fetch = "Reading a web page…"`.

- [ ] **Step 1: Write the failing tests**, in the found files' existing style

- `artifactRenderers.web_search` and `artifactRenderers.web_fetch` are both `ToolCallCard`.
- A `ToolCallCard` for a settled `tool-web_search` part with input `{ query: "ap calculus bc exam format 2027" }` renders that query in its collapsed line; one for `tool-web_fetch` with input `{ url: "https://e.com/page" }` renders that URL.
- The activity label for `web_search` is `Searching the web…` and for `web_fetch` is `Reading a web page…`, read through the same exported function the existing label test uses.

- [ ] **Step 2: Run to verify failure**

Run: `NODE_ENV=test tsx --test <the two found test files>`
Expected: FAIL.

- [ ] **Step 3: Implement** the two registry entries, the two `headlineArg` cases and the two labels.

- [ ] **Step 4: Run to verify pass**

Run: the same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/artifacts/index.ts components/artifacts/tool-call-card.tsx src/core/pending.ts <the two test files>
git commit -m "feat(web): show web lookups as tool cards"
```

---

### Task 7: Docs and the full suite

**Files:**
- Modify: `docs/getting-started.md` (the passage near line 16 on research and search keys)
- Modify: `docs/architecture.md` (the passage near line 164 describing the researcher as the only holder of the web tools)
- Modify: `README.md` (near lines 76 and 86, only where it says the tutor reaches the web solely through background research)

- [ ] **Step 1: Update the three docs**

Each passage gains the same facts, in that document's voice: the tutors in every mode can search the web and read a page inside their own reply; a "web search" switch under Settings → Agent turns that off without affecting background research; searching needs a search key under Settings → Keys, and without one the tutor can still read a page it is given; PDFs on the web still go through background research.

- [ ] **Step 2: Run the whole suite**

Run: `NODE_ENV=test tsx --test tests/*.test.ts tests/*.test.tsx`
Expected: PASS with no failures. A failure in a file this plan did not touch, and that also fails on the base commit, is reported and not fixed here.

- [ ] **Step 3: Type-check and lint**

Run: the type-check and lint scripts named in `package.json` `scripts`.
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add docs/getting-started.md docs/architecture.md README.md
git commit -m "docs: direct web search for the tutors"
```

- [ ] **Step 5: Hand-check (with the owner, on the running app)**

With a Tavily key saved under Settings → Keys, in a Teach session on the Claude Code route: ask a question whose answer changed recently and confirm a "web_search" card appears and the reply carries a source link; paste a link to a long article and confirm the tutor quotes from near its end; turn the switch off and confirm the tutor says it cannot search. Report what was seen; do not mark this step done from tests alone.
