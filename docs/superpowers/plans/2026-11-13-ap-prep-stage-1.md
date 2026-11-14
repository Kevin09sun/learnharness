# AP Prep Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "AP" session mode: set up an AP course from the official course description in a chat, see units and topics with readiness, practise multiple-choice questions whose verdict the tutor gives, and open a pre-scoped Teach session with "Learn".

**Architecture:** A new session kind `ap` beside `testprep`, mirroring how Test prep was added. An AP course record reuses Test prep's section/point shapes and pure rules (`src/core/test-prep.ts`) unchanged: units are sections, topics are points. Official PDFs are downloaded server-side into a local, unsynced folder and read with the existing PDF text tools. A new question tool `ap_mcq` renders in the question dock as a multiple-choice question whose verdict is withheld from the learner until the tutor grades.

**Tech Stack:** TypeScript, Next.js (this repo's version; read `node_modules/next/dist/docs/` before any route or page), `@earendil-works/pi-agent-core` tools, typebox schemas, `node:test`, React.

**Spec:** `docs/superpowers/specs/2026-11-13-ap-prep-design.md` (stage 1 of three)

## Global Constraints

- Read `AGENTS.md` first. Before writing or changing any route handler or page, read the relevant guide under `node_modules/next/dist/docs/`.
- Mirror Test prep. For every new file, open its Test prep twin first and follow its structure, comment register and error handling: `src/core/test-prep.ts`, `src/store/tests.ts`, `src/agent/tools/test-prep.ts`, `app/api/tests/**`, `app/tests/**`, `components/test-prep/**`, `tests/test-prep-*.test.*`.
- Do not change the behaviour of Teach, Practice or Test prep. `src/core/test-prep.ts` is imported, never edited.
- Layering: `src/core/**` imports nothing from `src/agent`, `src/store` or `src/server`. `src/agent/**` imports no store adapter and no server module; stores and the paper store reach it as injected ports. `app/**` imports only from `src/server/index.ts` and the core barrel.
- Names (owner-approved): mode label `AP`; session kind `ap`; pages `/ap` and `/ap/[id]`; course record `data/ap/<id>.json`; local papers `data/ap-papers/<courseId>/`; ignore line `ap-papers/` in `data/.gitignore`.
- Official PDFs are downloaded only from College Board sites: `https:` and a host equal to or ending in `.collegeboard.org`. The check applies to the requested URL and to the final URL after redirects.
- Local papers never enter a chat record, a job record or the course record's synced fields beyond `{ id, kind, label, year, url, file, pages }`.
- Stage 1 multiple-choice questions use text, tables, LaTeX and mermaid only. No image, no drawing job.
- The app never shows a right/wrong mark, the correct option, option notes or a confidence slider on an `ap_mcq` question. The tutor's reply is the verdict.
- The tutor instruction text in Task 7 is owner-approved wording: copy it exactly.
- Tests on this Windows machine: `npm test` does not work. Use the Bash tool: `NODE_ENV=test ./node_modules/.bin/tsx --test tests/<file>`. The full suite takes about 7.5 minutes and has 26 known platform failures; run it only where a task says to. Every test that touches a store sets `process.env.LH_DATA_DIR` to a temp directory before importing `config.ts` (see `tests/test-prep-store.test.ts` lines 1–40).
- Commits: `feat(ap): …` / `test(ap): …` / `docs(ap): …`, ending with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Stage explicit paths only.

## Review Focus

1. A topic that is already solid is practised in a single-topic sitting: it must still be asked (the shared queue omits solid points). Test in Task 1.
2. `ap_mcq` answered with the right option and flawed reasoning: nothing on screen may say "correct" before the tutor's reply, in the live dock, the answered card, a reload, or the markdown export. Tests in Tasks 5 and 9.
3. A download URL that is not College Board's, or that redirects off College Board, or that returns something that is not a PDF: refused, nothing written. Tests in Task 3.
4. A course synced from the other computer whose PDFs are absent here: the course page and the tutor both say the document is missing and offer the download; nothing crashes. Tests in Tasks 3, 6 and 10.
5. A sitting whose scope names a topic or unit that has since been removed from the list: the session says so; no result is recorded against a missing topic. Tests in Tasks 4 and 6.

---

### Task 1: Course record and pure rules

**Files:**
- Create: `src/core/ap.ts`
- Modify: `src/core/index.ts` (export the new module, as `test-prep.ts` is exported)
- Test: `tests/ap-core.test.ts`

**Interfaces:**
- Consumes from `src/core/test-prep.ts`: `TestSection`, `TestPoint`, `nextQueue`.
- Produces:

```ts
export type ApDocumentKind = "ced" | "frq" | "scoring";
export interface ApDocument {
	id: string;            // stable within the course
	kind: ApDocumentKind;
	label: string;         // e.g. "Course and Exam Description (2026)"
	year?: number;
	url: string;           // source link; "" when imported from a learner file
	file: string;          // file name inside the course's local papers folder
	pages?: number;
}
export type ApSittingScope =
	| { type: "topic"; topicId: string }
	| { type: "unit"; unitId: string }
	| { type: "weak" };
export type ApSittingKind = "mcq" | "frq" | "mixed";
export interface ApSitting { scope: ApSittingScope; kind: ApSittingKind }
export interface ApCourseRecord {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	planConfirmed: boolean;
	sections: TestSection[];   // units; each point is one official topic
	documents: ApDocument[];
	version: 1;
}
export type ApQueueReason = "recheck" | "unchecked" | "gap" | "review";
export function isCollegeBoardUrl(url: string): boolean;
export function parseApSitting(value: unknown): ApSitting | null;
export function sittingScopeProblem(course: Pick<ApCourseRecord, "sections">, scope: ApSittingScope): string | null;
export function topicInScope(course: Pick<ApCourseRecord, "sections">, scope: ApSittingScope, topicId: string): boolean;
export function scopedQueue(
	course: Pick<ApCourseRecord, "sections">,
	scope: ApSittingScope,
	chatId: string,
): Array<{ pointId: string; reason: ApQueueReason }>;
export function sittingLabel(course: Pick<ApCourseRecord, "title" | "sections">, sitting: ApSitting): string;
```

- [ ] **Step 1: Write the failing tests** in `tests/ap-core.test.ts` (build a two-unit course fixture with topic ids `t11`, `t12`, `t21`; statuses set per test)

```ts
it("isCollegeBoardUrl accepts https College Board hosts only", () => {
	assert.equal(isCollegeBoardUrl("https://apcentral.collegeboard.org/media/pdf/ap-calculus-ab-and-bc-course-and-exam-description.pdf"), true);
	assert.equal(isCollegeBoardUrl("https://collegeboard.org/x.pdf"), true);
	assert.equal(isCollegeBoardUrl("http://apcentral.collegeboard.org/x.pdf"), false);
	assert.equal(isCollegeBoardUrl("https://collegeboard.org.evil.com/x.pdf"), false);
	assert.equal(isCollegeBoardUrl("https://evilcollegeboard.org/x.pdf"), false);
	assert.equal(isCollegeBoardUrl("not a url"), false);
});
it("parseApSitting accepts the three scopes and three kinds, rejects the rest", () => {
	assert.deepEqual(parseApSitting({ scope: { type: "weak" }, kind: "mcq" }), { scope: { type: "weak" }, kind: "mcq" });
	assert.deepEqual(parseApSitting({ scope: { type: "unit", unitId: "u1" }, kind: "mixed" }), { scope: { type: "unit", unitId: "u1" }, kind: "mixed" });
	assert.deepEqual(parseApSitting({ scope: { type: "topic", topicId: "t11" }, kind: "frq" }), { scope: { type: "topic", topicId: "t11" }, kind: "frq" });
	for (const bad of [null, {}, { scope: { type: "unit" }, kind: "mcq" }, { scope: { type: "weak" }, kind: "essay" }, { scope: { type: "topic", topicId: "" }, kind: "mcq" }]) {
		assert.equal(parseApSitting(bad), null);
	}
});
it("sittingScopeProblem names a missing unit or topic", () => {
	assert.equal(sittingScopeProblem(course, { type: "weak" }), null);
	assert.equal(sittingScopeProblem(course, { type: "unit", unitId: "u1" }), null);
	assert.match(sittingScopeProblem(course, { type: "unit", unitId: "gone" })!, /unit .* no longer in the course/);
	assert.match(sittingScopeProblem(course, { type: "topic", topicId: "gone" })!, /topic .* no longer in the course/);
});
it("scopedQueue: weak = the shared queue; unit = that unit's entries in the same order", () => {
	assert.deepEqual(scopedQueue(course, { type: "weak" }, "c1"), nextQueue(course, "c1"));
	const unit = scopedQueue(course, { type: "unit", unitId: "u1" }, "c1");
	assert.deepEqual(unit.map((e) => e.pointId), nextQueue(course, "c1").map((e) => e.pointId).filter((id) => id === "t11" || id === "t12"));
});
it("scopedQueue: a single topic is always asked, solid or not", () => {
	const solid = withStatus(course, "t11", "solid");
	assert.deepEqual(scopedQueue(solid, { type: "topic", topicId: "t11" }, "c1"), [{ pointId: "t11", reason: "review" }]);
	const gap = withStatus(course, "t11", "gap");
	assert.deepEqual(scopedQueue(gap, { type: "topic", topicId: "t11" }, "c1"), [{ pointId: "t11", reason: "gap" }]);
});
it("scopedQueue: a topic re-checked in this same chat is still offered in a single-topic sitting", () => {
	const fixedHere = withStatus(course, "t11", "fixed-recheck", "c1");
	assert.deepEqual(scopedQueue(fixedHere, { type: "topic", topicId: "t11" }, "c1"), [{ pointId: "t11", reason: "review" }]);
});
it("scopedQueue: a scope that no longer exists yields an empty queue", () => {
	assert.deepEqual(scopedQueue(course, { type: "topic", topicId: "gone" }, "c1"), []);
	assert.deepEqual(scopedQueue(course, { type: "unit", unitId: "gone" }, "c1"), []);
});
it("topicInScope follows the scope", () => {
	assert.equal(topicInScope(course, { type: "weak" }, "t21"), true);
	assert.equal(topicInScope(course, { type: "unit", unitId: "u1" }, "t21"), false);
	assert.equal(topicInScope(course, { type: "topic", topicId: "t11" }, "t12"), false);
	assert.equal(topicInScope(course, { type: "weak" }, "gone"), false);
});
it("sittingLabel reads as a session title", () => {
	assert.equal(sittingLabel(course, { scope: { type: "unit", unitId: "u1" }, kind: "mcq" }), "AP Calculus BC · Unit 1 Limits · multiple-choice");
	assert.equal(sittingLabel(course, { scope: { type: "weak" }, kind: "mixed" }), "AP Calculus BC · weak topics · mixed");
	assert.equal(sittingLabel(course, { scope: { type: "topic", topicId: "t11" }, kind: "frq" }), "AP Calculus BC · 1.1 Limits intro · free-response");
});
```

The fixture's course title is `AP Calculus BC`, unit `u1` is titled `Unit 1 Limits`, topic `t11` has text `1.1 Limits intro`.

- [ ] **Step 2: Run to verify failure** — `NODE_ENV=test ./node_modules/.bin/tsx --test tests/ap-core.test.ts` → FAIL, module not found.
- [ ] **Step 3: Implement `src/core/ap.ts`** with the signatures above. `scopedQueue` for a topic scope returns the shared queue's entry for that topic when present, otherwise one `review` entry when the topic exists.
- [ ] **Step 4: Run to verify pass**, then `npm run typecheck`.
- [ ] **Step 5: Commit** — `git add src/core/ap.ts src/core/index.ts tests/ap-core.test.ts` / `feat(ap): course record types and scoped queue`

---

### Task 2: Course store

**Files:**
- Create: `src/store/ap-courses.ts`
- Modify: `config.ts` (`PATHS.ap = path.join(DATA_ROOT, "ap")`, `PATHS.apPapers = path.join(DATA_ROOT, "ap-papers")`), `src/core/events.ts` (event `"ap-changed"` with an empty payload, beside `"tests-changed"`), `src/server/stores.ts` (`apCourseStore` in `stores`)
- Test: `tests/ap-store.test.ts`

**Interfaces:**
- Consumes: `ApCourseRecord`, `ApDocument` (Task 1); `applyResult`, `forgetChatInPoint`, `mergePlan`, `readiness`, `AnswerResult`, `PlanDraftSection` from `src/core/test-prep.ts`.
- Produces `export const apCourseStore` with:

```ts
create(title: string): ApCourseRecord;                       // id "ap_<base36 time>_<uuid8>", planConfirmed false, sections [], documents []
get(id: string): ApCourseRecord | null;                      // missing, malformed or wrong-shaped → null, file never rewritten
list(): Array<Pick<ApCourseRecord, "id" | "title" | "updatedAt" | "planConfirmed"> & { readiness: number; solid: number; total: number }>;
savePlan(id: string, draft: PlanDraftSection[], confirm: boolean): ApCourseRecord;
recordResult(id: string, topicId: string, result: AnswerResult, chatId: string): ApCourseRecord; // throws "plan not confirmed" before "unknown topic"
putDocument(id: string, doc: ApDocument): ApCourseRecord;     // replaces a document with the same id, else appends
forgetChat(id: string, chatId: string): boolean;
```

Every mutation is a fresh read-modify-write through `writeFileAtomicSync` and emits `"ap-changed"` after the write.

- [ ] **Step 1: Write the failing tests**, mirroring `tests/test-prep-store.test.ts` case for case (create/get/list ordering and derived readiness; `savePlan` merge keeps statuses, unconfirmed save clears confirmation; `recordResult` guard order and status change; `forgetChat` replays and returns false when nothing changed; foreign-shaped file reads as null and is not rewritten), plus:

```ts
it("putDocument appends, then replaces by id", () => {
	const c = apCourseStore.create("AP Biology");
	apCourseStore.putDocument(c.id, { id: "ced", kind: "ced", label: "CED", url: "https://apcentral.collegeboard.org/a.pdf", file: "ced.pdf" });
	const next = apCourseStore.putDocument(c.id, { id: "ced", kind: "ced", label: "CED (2026)", url: "https://apcentral.collegeboard.org/b.pdf", file: "ced.pdf", pages: 230 });
	assert.equal(next.documents.length, 1);
	assert.equal(next.documents[0]!.label, "CED (2026)");
	assert.equal(next.documents[0]!.pages, 230);
});
it("a record without a documents array is not an AP course", () => { /* write {…valid…, documents: undefined} by hand → get() === null */ });
it("emits ap-changed on create, savePlan, recordResult, putDocument and a changing forgetChat", () => { /* subscribe, count */ });
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** the store, the two `PATHS` entries, the event and the `stores` entry.
- [ ] **Step 4: Run to verify pass**, then `npm run typecheck`. Also run `tests/data-dir-seam.test.ts` only if it passed in the baseline on this machine (it is one of the 26 known failures; do not fix it).
- [ ] **Step 5: Commit** — `feat(ap): course store`

---

### Task 3: Local paper store

**Files:**
- Create: `src/server/ap-papers.ts`
- Modify: `src/server/index.ts` (export it)
- Test: `tests/ap-papers.test.ts`

**Interfaces:**
- Consumes: `isCollegeBoardUrl` (Task 1), `PATHS.apPapers`, `PATHS.data`.
- Produces:

```ts
export const AP_PAPER_MAX_BYTES = 80 * 1024 * 1024;
export function apPapersDir(courseId: string): string;                 // PATHS.apPapers/<courseId>; throws on an id not matching /^[A-Za-z0-9_-]+$/
export function apPaperPath(courseId: string, file: string): string;   // throws unless file matches /^[A-Za-z0-9._-]+\.pdf$/
export function apPaperPresent(courseId: string, file: string): boolean;
export function ensureApPapersIgnored(): void;
export async function downloadApPaper(
	courseId: string, url: string, file: string, fetchImpl?: typeof fetch,
): Promise<{ file: string; bytes: number }>;
export async function importApPaper(courseId: string, sourcePath: string, file: string): Promise<{ file: string; bytes: number }>;
export const apPapers: { dir: typeof apPapersDir; present: typeof apPaperPresent; download: typeof downloadApPaper; importFile: typeof importApPaper };
```

Behaviour:
- `ensureApPapersIgnored`: when `<PATHS.data>/.gitignore` exists and has no line exactly `ap-papers/`, append that line (preserving the file's existing content and trailing newline); when the file does not exist but `<PATHS.data>/.git` does, create it with that one line; otherwise do nothing. Called by `downloadApPaper` and `importApPaper` before writing.
- `downloadApPaper`: throw `Error("Only College Board addresses are accepted")` unless `isCollegeBoardUrl(url)`; fetch with a 120 s timeout; throw the same error when the response's final `url` is not a College Board URL; throw `"Not a PDF"` unless the body starts with the bytes `%PDF-`; throw `"PDF too large"` over `AP_PAPER_MAX_BYTES` (declared length or actual); write atomically (temp file in the same folder, then rename). On any throw nothing is left in the folder.
- `importApPaper`: resolve `sourcePath` through the existing learner-file guard `resolveSourcePath` (`src/agent/tools/fs-shared.ts`; import it via a server-side re-export if the layering rule requires), apply the same `%PDF-` and size checks, copy atomically.

- [ ] **Step 1: Write the failing tests** (temp `LH_DATA_DIR`; `fetchImpl` stubs returning `new Response(body, { headers })` with a settable `url` via `Object.defineProperty`)

```ts
it("refuses a non-College-Board address without fetching", async () => { /* stub counts calls → 0; rejects /Only College Board/ */ });
it("refuses when the final URL after redirects is off College Board", async () => { /* stub response.url = "https://evil.example/x.pdf" → rejects; folder has no files */ });
it("refuses a body that is not a PDF", async () => { /* "<html>" → rejects /Not a PDF/; no files */ });
it("refuses an oversized PDF by declared length", async () => { /* content-length > max → rejects /too large/ */ });
it("saves a PDF and reports its size", async () => { /* "%PDF-1.7 …" → { file: "ced.pdf", bytes: n }; apPaperPresent true; bytes on disk equal */ });
it("rejects unsafe course ids and file names", () => { /* "../x", "a/b.pdf", "x.exe" throw */ });
it("ensureApPapersIgnored appends once to an existing .gitignore and keeps its content", () => { /* "debug/\n" → "debug/\nap-papers/\n"; second call unchanged */ });
it("ensureApPapersIgnored creates the file only when data/ is a git repo", () => { /* no .git → no file; with .git dir → file "ap-papers/\n" */ });
it("importApPaper copies a learner PDF and refuses a non-PDF", async () => { /* temp files */ });
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass**, then `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(ap): local paper store with College Board-only downloads`

---

### Task 4: Thread the `ap` session kind

**Files:**
- Modify: `src/core/contracts/chat.ts` (`ChatKind` gains `"ap"`; `ChatRecord` and `ChatSummary` gain `apCourseId?: string` and `apSitting?: ApSitting`), `src/core/ports.ts` and `src/store/chats.ts` (`createChat`), `app/api/chats/route.ts`, `src/server/chat-handler.ts` (record guard near line 215; the four kind-label expressions near lines 301, 306, 707, 712), `src/server/compaction.ts` and `src/core/compaction.ts` (kind unions gain `"ap"`; the summariser wording treats `ap` as it treats `testprep`), `skills/learnharness/scripts/sessions.py` (wherever `testprep` is listed)
- Test: `tests/chat-kind.test.ts`, `tests/ap-api.test.ts` (new)

**Interfaces:**
- Produces `createChat(title: string, kind?: "practice" | "testprep" | "ap", testId?: string, ap?: { courseId: string; sitting?: ApSitting }): ChatRecord`. For kind `ap` the record carries `apCourseId` and, when given, `apSitting`. A session with `apCourseId` and no `apSitting` is the course's setup session.
- Produces `POST /api/chats` behaviour for `kind: "ap"`: the body names exactly one of `apCourseTitle` (non-empty string → `stores.apCourseStore.create(apCourseTitle)`, no sitting) or `apCourseId` (must exist → 404 `{ error: "Unknown AP course" }` otherwise). With `apCourseId`, an `apSitting` is optional; when present it must pass `parseApSitting` and `sittingScopeProblem` (400 with the problem text otherwise). Naming both or neither is 400. The response is unchanged in shape (`{ id }` and whatever the route returns today).
- Produces the turn guard: an `ap` record without `apCourseId` is refused with 500 `{ error: "This AP session is not linked to a course." }`, as the Test prep guard does.

- [ ] **Step 1: Write the failing tests.** In `tests/chat-kind.test.ts` add: `createChat("t", "ap", undefined, { courseId: "ap_x" })` stores `kind: "ap"`, `apCourseId: "ap_x"`, no `apSitting`, no `testId`; with a sitting it stores the sitting; `listChats()` carries `kind: "ap"`, `apCourseId` and `apSitting` in the summary; kinds other than `ap` never carry the two fields. In `tests/ap-api.test.ts` (model on `tests/test-prep-api.test.ts`): the six `POST /api/chats` cases above (create by title makes a course and links it; by id links; unknown id 404; both and neither 400; bad sitting 400; sitting naming a removed unit 400).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** In `chat-handler.ts` only the guard and the kind labels change in this task; the agent branch is Task 6. Until then an `ap` turn falls through to the existing branches — acceptable mid-plan, never shipped.
- [ ] **Step 4: Run to verify pass**: the two files plus `tests/test-prep-api.test.ts`, `tests/graph-context.test.ts`, `tests/compaction-service.test.ts`; then `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(ap): ap session kind linked to a course`

---

### Task 5: The `ap_mcq` question in the core

**Files:**
- Modify: `src/core/pending.ts` (`QUESTION_TOOLS`, `toolQuestionKind`), `src/core/question-core.ts`, `src/core/tool-parts.ts`, `src/core/answer-presentation.ts`, `src/core/session-markdown.ts`, `src/core/native-messages.ts`
- Test: `tests/ap-question-core.test.ts` (new); model on `tests/test-prep-question-ui.test.tsx` and the `check_point` cases in the question-core tests

**Interfaces:**
- Produces in `src/core/question-core.ts`:

```ts
export const apMcqInputObject = Type.Object({
	topicId: Type.String(),
	question: Type.String(),
	options: Type.Array(Type.Object({ label: Type.String() }), { minItems: 4, maxItems: 4 }),
	correctAnswer: Type.String(),            // must equal exactly one option label
	optionNotes: Type.Array(Type.String(), { minItems: 4, maxItems: 4 }),
	details: Type.Optional(Type.String()),
});
export function apMcqInputProblems(input: unknown): string[];
export function parseApMcqInput(input: unknown): /* the quiz-shaped QuestionData source */;
```

  Descriptions on each field follow the register of `checkPointInputObject` (`src/agent/tools/test-prep.ts`): `correctAnswer` and `optionNotes` are the commitment and are never shown to the learner; `details` is the visible channel and carries the diagnosis after a miss. Match the option object shape that `quizInputBase` uses in this file (label/value) rather than the sketch above if it differs.
- `apMcqInputProblems` returns a problem for: empty question; not exactly four options; an empty or duplicate option label; `correctAnswer` matching no option or more than one; not exactly four notes; an empty note.
- `QUESTION_TOOLS` gains `"ap_mcq"`; `toolQuestionKind("ap_mcq") === "quiz"`.
- The dock's `QuestionData` for `ap_mcq` is single-select with the four options, the question and `details`; it carries **no** `explanation` and its correct indices are available for building the answer but are not part of what the learner-facing projection exposes.
- `buildAnswer` for `ap_mcq`: records the picked option, optional `thinking`, `dontKnow`; sets `correct` from the pick (the tutor needs it); never sets `committed`; never records `confidence`.
- `compactAnswerForModel` for an `ap_mcq` answer includes the pick, `correct`, `thinking`, `dontKnow`, as for a quiz.
- `src/core/answer-presentation.ts`: the learner-facing projection of an `ap_mcq` answer removes `committed`, `correct`, the correct indices and any explanation.
- `src/core/native-messages.ts`: `export const AP_MCQ_ANSWER_FRAME = "The learner answered the ap_mcq question you posed. This tool result IS the learner's pick and, when present, their reasoning — grade it now against your committed correctAnswer and optionNotes, then call ap_record_result.";` prepended to the tool-result text for `ap_mcq` exactly as `CHECK_POINT_ANSWER_FRAME` is for `check_point` (not on a dismissed answer).
- `src/core/session-markdown.ts`: an `ap_mcq` question exports with the heading label `AP question`, its options and the learner's pick and reasoning, and without any correctness mark, correct option or notes.
- `src/core/tool-parts.ts`: `ap_mcq` parses through `parseApMcqInput`.

- [ ] **Step 1: Write the failing tests**

```ts
it("ap_mcq is a quiz-kind question tool", () => {
	assert.ok((QUESTION_TOOLS as readonly string[]).includes("ap_mcq"));
	assert.equal(toolQuestionKind("ap_mcq"), "quiz");
});
it("apMcqInputProblems accepts a well-formed question", () => { assert.deepEqual(apMcqInputProblems(good), []); });
for (const [name, mutate, pattern] of [
	["three options", (i) => { i.options.pop(); }, /four options/],
	["duplicate option", (i) => { i.options[1].label = i.options[0].label; }, /distinct/],
	["correctAnswer not an option", (i) => { i.correctAnswer = "none of these"; }, /correctAnswer/],
	["three notes", (i) => { i.optionNotes.pop(); }, /four .*notes/],
	["blank note", (i) => { i.optionNotes[2] = "  "; }, /note/],
	["blank question", (i) => { i.question = " "; }, /question/],
] as const) it(`apMcqInputProblems rejects ${name}`, () => { /* clone good, mutate, assert.match(problems.join(" "), pattern) */ });
it("the answer carries the pick, its correctness and the reasoning for the model, and no commitment", () => {
	const answer = buildAnswer(/* ap_mcq QuestionData, pick the correct option, thinking "because f' changes sign" */);
	assert.equal(answer.correct, true);
	assert.equal(answer.thinking, "because f' changes sign");
	assert.equal(answer.committed, undefined);
	assert.equal(answer.confidence, undefined);
	const compact = compactAnswerForModel(answer);
	assert.equal(compact.correct, true);
	assert.equal(compact.thinking, "because f' changes sign");
});
it("the learner-facing projection of an ap_mcq answer has no verdict", () => {
	const shown = /* the projection function in answer-presentation.ts */(answer);
	assert.equal("correct" in shown, false);
	assert.equal("committed" in shown, false);
	assert.equal("correctIndices" in shown, false);
});
it("the tool result is framed for grading", () => {
	const result = newAnswerResult(/* ap_mcq call, answer */);
	assert.ok(result.content[0].text.startsWith(AP_MCQ_ANSWER_FRAME));
});
it("the markdown export shows the pick and reasoning and no verdict", () => {
	const md = /* export a transcript with one answered ap_mcq */;
	assert.match(md, /AP question/);
	assert.match(md, /because f' changes sign/);
	assert.doesNotMatch(md, /correct|✓|✗/i);
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** Find every `check_point` special case in these six files (`grep -n "check_point" src/core/*.ts`) and decide for each whether `ap_mcq` needs the same treatment; the rule is the Global Constraint "the app never shows a verdict".
- [ ] **Step 4: Run to verify pass**: the new file plus every existing test file that pins `QUESTION_TOOLS` or question rendering (`grep -rln "QUESTION_TOOLS\|toolQuestionKind\|check_point" tests`); then `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(ap): ap_mcq question shape with the verdict withheld`

---

### Task 6: AP tools, agent and turn wiring

**Files:**
- Create: `src/agent/tools/ap.ts`
- Modify: `src/agent/teacher-agent.ts` (`AgentKind` gains `"ap"`; `composedInstructions.ap`; `createApAgent`; `TeachingAgent` union), `src/server/chat-handler.ts` (the per-turn branch; build the AP agent for `record.kind === "ap"` before the Test prep case), `src/core/prompt-segments.ts` (`PromptAgent` gains `"ap"`; `isValidSegmentPath` accepts `ap/`), `src/agent/prompt-segments.ts` (`listSourceSegments` treats `ap` like `testprep`: no `system-prompt.md` base, own directory, allowlisted shared fragments — the allowlist itself is Task 7)
- Test: `tests/ap-tools.test.ts` (model on `tests/test-prep-tools.test.ts`)

**Interfaces:**
- Consumes: Tasks 1–5; `createPdfReadTools(dir)` from `src/agent/tools/pdf-read.ts`; `tutorWebTools`, `jobTools`, `readTool`, `lsTool`, `findTool`, `grepTool`, `healToolRecord`, `invalidInputResult`, `questionResult`.
- Produces:

```ts
export interface ApCourseStorePort {
	get(id: string): ApCourseRecord | null;
	savePlan(id: string, draft: PlanDraftSection[], confirm: boolean): ApCourseRecord;
	recordResult(id: string, topicId: string, result: AnswerResult, chatId: string): ApCourseRecord;
	putDocument(id: string, doc: ApDocument): ApCourseRecord;
}
export interface ApPapersPort {
	dir(courseId: string): string;
	present(courseId: string, file: string): boolean;
	download(courseId: string, url: string, file: string): Promise<{ file: string; bytes: number }>;
	importFile(courseId: string, sourcePath: string, file: string): Promise<{ file: string; bytes: number }>;
}
export interface ApToolContext {
	chatId: string;
	courseId: string;
	sitting?: ApSitting;                 // absent = the setup session
	courses: ApCourseStorePort;
	papers: ApPapersPort;
	jobs?: JobToolContext;
	search?: () => SearchProvider | null;
}
export function apTools(ctx: ApToolContext, enabled?: EnabledTools): Record<string, AgentTool<any>>;
```

  and in `teacher-agent.ts`: `export function createApAgent(ctx: ApToolContext, opts: AgentBuildOptions = {})`, built like `createTestPrepAgent`.

- The registry, in this order: `ap_save_document`, `pdf_info`, `pdf_extract`, `pdf_search`, `propose_units`, `ap_progress`, `ap_mcq`, `ap_record_result`, `read`, `ls`, `find`, `grep`, `research` (when a jobs context is present), then `...tutorWebTools(ctx.search, enabled)`. The three `pdf_*` tools are taken from `createPdfReadTools(ctx.papers.dir(ctx.courseId))`; its `web_fetch_pdf` is **not** registered. No `pdf` job, no `visual`, no `demo`.
- `ap_save_document({ kind: "ced", label: string, year?: integer, url?: string, path?: string })`: exactly one of `url` / `path`. Stage 1 accepts only `kind: "ced"` (other kinds: an input problem saying they arrive in a later version). File name `ced.pdf`, document id `ced`. Downloads or imports through the port, reads the page count with the PDF tools' own info function, calls `putDocument`, and answers in prose: the stored file name, the page count, and that `pdf_info`, `pdf_extract` and `pdf_search` read it by that file name. A refused download returns the refusal text as an input problem (retryable), never a throw.
- `propose_units({ sections })`: same schema and behaviour as Test prep's `propose_plan` (reuse `proposePlanInputObject`'s shape and `planProblems`), with AP wording in descriptions and result text ("units", "topics"). Refused when the course has no stored `ced` document that is present, with: `"save the course description with ap_save_document first — the unit and topic list must come from it"`.
- `ap_progress()`: prose, in this order — a first line `Session: setup` or `Session: practice — <sittingLabel>`; `sittingScopeProblem` text when the scope no longer exists; `Units and topics: UNCONFIRMED — …` when not confirmed; overall readiness and one line per unit (as `test_progress` formats them); a `Documents:` block listing each document as `file · label · N pages` or `file · label · MISSING on this computer`; then `Queue:` from `scopedQueue` (practice sessions only), each line `topicId · reason · unit title › topic text`, capped at 30, or `Queue: nothing left`.
- `ap_mcq`: parameters `apMcqInputObject`. Gate, in order, each a retryable input problem: course not found; list not confirmed; setup session (`"this is the setup session — questions are asked in a practice sitting started from the course page"`); `topicId` not in the list; `topicId` outside the sitting's scope; `apMcqInputProblems`; and, as `check_point` does, a blank `details` when this topic's last attempt in this chat was `wrong` or `dontKnow`. Then `questionResult()`.
- `ap_record_result({ topicId, result })`: the same gate up to the scope check, then `recordResult`; answers with the topic's new status and overall readiness, as `record_result` does.
- A posed `ap_mcq` ends the turn: it is in `QUESTION_TOOLS` (Task 5), which `makeQuestionStopper` already reads.
- `chat-handler.ts`: for `record.kind === "ap"` build `createApAgent({ chatId, courseId: record.apCourseId!, sitting: record.apSitting, courses: stores.apCourseStore, papers: apPapers, jobs: { …as Test prep's… }, search: searchProvider }, agentOpts)`. The compaction and system-prompt-size expressions use `composeInstructions("ap")` for this kind.
- Background graph extraction stays on for `ap` (the condition excludes only `practice`); do not change it.

- [ ] **Step 1: Write the failing tests** with in-memory fakes for both ports (the fake papers port records calls and can be told a file is absent):
  - registry: exact tool names in order without jobs/search; `research` and the web tools appear with their seams; `web: false` removes only the web tools; `web_fetch_pdf`, `pdf`, `visual`, `demo` are never present.
  - `ap_save_document`: url path calls `download(courseId, url, "ced.pdf")` and stores a `ced` document with the reported pages; `path` calls `importFile`; both or neither is an input problem; a port rejection surfaces as an input problem containing the port's message; `kind: "frq"` is an input problem.
  - `propose_units`: refused before a present `ced` document; saves unconfirmed; refuses an empty unit.
  - `ap_progress`: setup session text; practice text with label and scoped queue; `MISSING on this computer` for an absent file; the removed-scope sentence.
  - `ap_mcq`: each gate in order (one test per gate, asserting the store's mutating methods were not called); post-miss blank `details` refused; a good call returns a terminating question result.
  - `ap_record_result`: refused in a setup session and out of scope; records and reports status and readiness.
  - agent: `createApAgent(ctx, { engine: fauxEngine() })` carries the registry; `toolToggles: { web: false }` drops the web tools.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** Create an empty `src/agent/prompts/ap/` directory entry only if composition requires the folder to exist for this task's tests; the fragment text is Task 7.
- [ ] **Step 4: Run to verify pass**: `tests/ap-tools.test.ts`, `tests/test-prep-tools.test.ts`, `tests/prompt-overrides.test.ts`, `tests/tool-toggles-bridge.test.ts`; then `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(ap): AP tools, agent and turn wiring`

---

### Task 7: Tutor instructions (owner-approved wording)

**Files:**
- Create: `src/agent/prompts/ap/00-base.md`, `src/agent/prompts/ap/10-doctrine.md`
- Modify: `src/agent/prompt-segments.ts` (`AP_SHARED_FRAGMENTS = ["10-voice.md", "15-accuracy.md", "30-learner-files.md", "35-web.md", "40-formatting.md"]`), `app/api/settings/prompts/route.ts` (add `ap`), `components/settings/agent-section.tsx` (`PromptView` and the agent tabs gain `{ id: "ap", label: "AP" }`), `src/agent/prompts/README.md` (list the `ap` agent and its shared fragments)
- Test: `tests/ap-prompt.test.ts` (model on `tests/test-prep-prompt.test.ts`), plus any settings render test that pins the tab list

- [ ] **Step 1: Write the failing tests**: `listSourceSegments("ap")` is exactly `["ap/00-base.md", "ap/10-doctrine.md", "shared/10-voice.md", "shared/15-accuracy.md", "shared/30-learner-files.md", "shared/35-web.md", "shared/40-formatting.md"]` with no `system-prompt.md`; the composed AP prompt contains the sentences `A right option reached by flawed reasoning is \`wrong\`.` and `Never build the list from general knowledge or from a site that is not College Board's.`; `GET /api/settings/prompts` has an `ap` key; `isValidSegmentPath("ap/10-doctrine.md")` is true.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Create `src/agent/prompts/ap/00-base.md`** with exactly:

```md
# The agent

You are the agent of a learning harness, running AP exam preparation. The learner is preparing for one AP course; you own its unit and topic list and its evidence, and you change nothing else. The doctrine section carries the method; this base carries the register, the accuracy contract, and the tool mechanics.

## Tool mechanics

Everything the learner sees is ordinary prose and one question at a time. Mechanics only here — when to act, what to ask, and how to respond are the doctrine's.

**`ap_save_document`** — saves the official College Board course description into the course's local store: from a `url` on a College Board site, or from a `path` the learner attached. It returns the stored file name and page count. Only College Board addresses are accepted.

**`pdf_info`, `pdf_extract`, `pdf_search`** — read a stored document by the file name `ap_save_document` or `ap_progress` gave you: its page count, the text of a page range, or the pages where a phrase appears.

**`propose_units`** — saves the unit and topic list for the learner to review. Units are the course description's units; each topic is one numbered topic, written as its number and official title, and carries `source`, the course description page it came from. The list saves UNCONFIRMED and the call ends your move: say nothing that assumes scope and wait. Call it again with revised units whenever the learner asks for changes.

**`ap_progress`** — read-only: what this session is for (setup, or a practice sitting with its scope and question kind), overall and per-unit readiness, the stored documents, and the topic queue in work order. Call it first in every session, and whenever you need the current state.

**`ap_mcq`** — asks one multiple-choice question on one topic. `topicId` must name a topic in the confirmed list and inside this sitting's scope. Exactly four options, exactly one correct. `correctAnswer` and `optionNotes` (one line per option: why it is right, or the specific error that leads to it) are your commitment, written before the learner answers and never revised; neither is displayed. The learner picks an option and may add their reasoning. One call per turn: pose, then end your turn.

**`ap_record_result`** — applies the graded outcome for one topic: `correct`, `wrong`, or `dontKnow`. Call it immediately after grading, before you speak. It returns the topic's new status and overall readiness.

**The side tools** — `web_search` and `web_fetch` when they are among your tools, `research` for longer lookups, and `read`, `ls`, `find`, `grep` over files the learner points at. All are read-only.

## Accuracy

A wrong commitment grades the learner against a lie. Solve or verify every committed answer before posing its question, and check that each wrong option is wrong for the reason you wrote; when a fact is not certain, check it first. Never present an unverified claim as the right answer.
```

- [ ] **Step 4: Create `src/agent/prompts/ap/10-doctrine.md`** with exactly:

```md
# The AP session

You prepare the learner for one AP exam. Your job is evidence about their thinking: a topic ends up solid only when the learner answers a question on it correctly, unaided, for the right reasons. Call `ap_progress` first; it says whether this session is course setup or a practice sitting. The rules below are the whole method.

## Setting up a course

The learner names an AP course. Find its current official Course and Exam Description on a College Board site, save it with `ap_save_document`, and read it. Build the list from what the document actually says:

- **Units** are the course description's units, in its order and with its titles.
- **Topics** are the numbered topics under each unit, each written as its number and official title.
- Every topic carries a `source`: the course description page it came from.

Call `propose_units`, then stop and wait for the learner to review it. If you cannot find the document, or the learner says it is the wrong one, say so plainly and ask for a College Board link or the PDF itself. **Never build the list from general knowledge or from a site that is not College Board's.**

Once the learner has confirmed the list, tell them practice and learning start from the course page, and stop.

## A practice sitting

`ap_progress` gives the sitting's scope, its question kind, and the queue. Work the queue in the order it reports. When the queue is empty, say so and stop. In this version every question is multiple-choice; if the sitting asks for free-response, say once that it is not available yet and ask multiple-choice.

If `ap_progress` reports the course description missing on this computer, say so, tell the learner the course page can download it again, and stop.

## Writing a question

Before writing, read the topic's pages in the course description and the official sample questions for its unit, and model the question on them: the same skills, the same level, the same kind of wrong answers. One topic per question. Four options, each wrong option a mistake a real student makes; never a joke option, never "all of the above" or "none of the above". Use text, tables, mathematical notation and inline diagrams only.

## Grading and after

The learner's pick, and their reasoning if they gave any, arrive as the result of your `ap_mcq` call; grade in that turn — never re-pose the same question or treat it as unanswered.

- **A pick with no reasoning** is correct if it is the committed option and wrong otherwise.
- **A pick with reasoning** is correct only if the option is right **and** the reasoning is sound. A right option reached by flawed reasoning is `wrong`.
- **"I don't know"** is `dontKnow`. **A request for a hint, for help, or for the answer** is `wrong`.

Call `ap_record_result`, then:

- **Correct** — say only that it is right, and move to the next topic in the queue. Never explain a correct answer.
- **Not correct** — put the diagnosis in the fresh `ap_mcq`'s `details` field: the right answer, and exactly where the thinking went wrong; for a right pick with flawed reasoning, name the flaw. Then pose that fresh question on the same topic, different from the one just seen; the learner sees the diagnosis with it. The call is rejected if the diagnosis is missing. If the fresh question is also missed, try a different angle.

## Standing prohibitions

- Never credit a self-assessment ("I know this"). Only an answered question moves a topic.
- Never give hints before an answer.
- Never change the unit and topic list during practice; if the learner wants it changed, tell them to edit it on the course page.
- Never present a question you wrote as a released College Board question.
- Never use the web to decide what the course covers; the course description decides. Web lookups are for finding College Board documents and for verifying facts and committed answers.
- Never mention statuses as scores in prose beyond the readiness the tools report.
```

- [ ] **Step 5: Register and run** — allowlist, route, settings tab, README; run `tests/ap-prompt.test.ts`, `tests/test-prep-prompt.test.ts`, `tests/prompt-overrides.test.ts`, the settings render tests; `npm run typecheck`. Compare both fragment files against this plan with `diff` and state the result in the report.
- [ ] **Step 6: Commit** — `feat(ap): tutor instructions`

---

### Task 8: API routes

**Files:**
- Create: `app/api/ap/route.ts` (GET list), `app/api/ap/[id]/route.ts` (GET one), `app/api/ap/[id]/plan/route.ts` (GET, PUT), `app/api/ap/[id]/documents/route.ts` (POST)
- Test: `tests/ap-routes.test.ts` (model on `tests/test-prep-api.test.ts` and `tests/test-prep-plan-route.test.ts`)

**Interfaces:**
- `GET /api/ap` → `{ courses: apCourseStore.list() }`, shaped as `GET /api/tests` shapes its list.
- `GET /api/ap/[id]` → the course record with each document extended by `present: boolean` and, when present, `path: string` (the absolute local path); 404 for an unknown or invalid id.
- `GET` / `PUT /api/ap/[id]/plan` → exactly the behaviour of `app/api/tests/[id]/plan/route.ts` over the course store (PUT body `{ sections, confirm }`, same validation via `planProblems`, same same-origin guard, same status codes).
- `POST /api/ap/[id]/documents` (same-origin guarded) → for every document that is not present and has a non-empty `url`, call `downloadApPaper`; respond `{ documents: [{ id, file, present, error? }] }` with 200 even when some fail; 404 for an unknown course.

- [ ] **Step 1: Write the failing tests**: list; get with `present`/`path` for a present and an absent file; plan GET/PUT round trip, confirm sets `planConfirmed`, an edited topic keeps its status, a removed topic's history is gone, invalid draft 400, cross-origin PUT refused; documents POST downloads only the absent ones (inject the fetch through whatever seam Task 3's function exposes — if the route cannot inject, export a test seam from `src/server/ap-papers.ts`), reports a failure per document, and 404s an unknown course.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement**, after reading the Next.js route-handler guide named in Global Constraints.
- [ ] **Step 4: Run to verify pass**; `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(ap): course routes`

---

### Task 9: Question dock and answered card for `ap_mcq`

**Files:**
- Modify: `components/question-dock.tsx`, `components/answered-card.tsx`
- Test: `tests/ap-question-ui.test.tsx` (model on `tests/test-prep-question-ui.test.tsx`)

**Interfaces:**
- Live dock, `ap_mcq`: canonical kind `quiz`, single-select; label `AP · generated`; the four options; the optional thinking field labelled `YOUR REASONING (optional)` and owned by dictation exactly as the quiz thinking field is; the "I don't know" control as on a quiz; **no confidence slider**; `details`, when present, rendered above the question as Test prep renders a `check_point`'s `details`.
- Answered card, `ap_mcq`: the question, the four options with the learner's pick marked as picked (neutral styling), the reasoning under `YOUR REASONING` when given; **no** correct/incorrect chip, **no** green/red option marking, **no** "Why" button, **no** confidence rail.

- [ ] **Step 1: Write the failing tests** (server-render the components as the Test prep UI test does): the live dock for an `ap_mcq` part contains the four option labels, `AP · generated`, `YOUR REASONING (optional)`, and does not contain `data-testid="confidence-slider"`; submitting with only a pick is allowed and with nothing picked is not; the answered card for a correct pick and for a wrong pick are identical apart from which option is marked picked; neither contains the correct/incorrect chip's test id, the "Why" control's test id, or `data-testid="answered-confidence"`; `details` text renders in both.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement**, following each `check_point` branch in the two files.
- [ ] **Step 4: Run to verify pass**: the new file plus `tests/test-prep-question-ui.test.tsx` and any other dock/answered-card render tests (`grep -rln "question-dock\|answered-card" tests`); `npm run typecheck`; `npm run lint`.
- [ ] **Step 5: Commit** — `feat(ap): multiple-choice card without an automatic verdict`

---

### Task 10: Units review card, course list and course page

**Files:**
- Create: `components/ap/units-review-card.tsx`, `components/ap/course-view.tsx`, `components/ap/start-sitting.tsx`, `app/ap/page.tsx`, `app/ap/[id]/page.tsx`
- Modify: `components/artifacts/index.ts` (`propose_units: UnitsReviewCard`; `ap_progress`, `ap_record_result`, `ap_save_document`, `pdf_info`, `pdf_extract`, `pdf_search` → `ToolCallCard`), `components/artifacts/tool-call-card.tsx` (`headlineArg`: `url` or `path` for `ap_save_document`; `path` for the three `pdf_*` tools; `topicId` for `ap_record_result`), `src/core/pending.ts` (`ACTIVITY_LABELS`: `ap_save_document: "Saving the course description…"`, `propose_units: "Proposing units and topics…"`, `ap_progress: "Checking progress…"`)
- Test: `tests/ap-course-ui.test.tsx` (model on `tests/test-prep-plan-card.test.tsx` and `tests/test-prep-readiness.test.tsx`)

**Interfaces:**
- `UnitsReviewCard`: the Test prep `PlanReviewCard` behaviour (inline edit, add/remove, Confirm) against `/api/ap/<courseId>/plan`, with the words "unit" and "topic". Reuse `components/test-prep/plan-editor.tsx` for the editing surface by giving it optional label props; if `PlanReviewCard` can take the endpoint and labels as props without changing its Test prep rendering, parametrise it instead of duplicating it. The card finds its course id the way `PlanReviewCard` finds its test id (the session's linked record).
- `/ap` (server page): the course list from `stores.apCourseStore.list()`; each row links to `/ap/<id>` with title, readiness percent (`readinessPercent`) or "Not set up yet"; empty state links to `/chat/new?mode=ap`.
- `/ap/[id]` (server page → `CourseView`): course title and overall readiness; per unit: title, percent, `[Learn]` `[Practise]`; per topic: text, status in the words `solid`, `gap`, `re-check next sitting`, `not yet asked`, and `[Learn]` `[Practise]`; a `[Practise weak topics]` button; an `[Edit units and topics]` control opening the same editor; a documents block listing each document, and for an absent one the line `Missing on this computer` with a `[Download]` button calling `POST /api/ap/<id>/documents`. Before confirmation the page shows the unconfirmed list with `[Confirm]` and no Learn/Practise buttons.
- `StartSitting`: pressing any `[Practise]` opens a small chooser with three options `Multiple-choice`, `Free-response`, `Mixed` (the last two each carry the note `multiple-choice only for now`), then creates the session with `new SessionStarter().start({ title: sittingLabel(course, sitting), kind: "ap", apCourseId, apSitting })` and navigates to the returned path. `SessionCreation` in `components/start-session.ts` gains `kind: "ap"`, `apCourseTitle?`, `apCourseId?`, `apSitting?`.
- `[Learn]` creates a Teach session (no `kind`) whose `title` — which is also its first message — is built by an exported pure function:

```ts
export function learnPrompt(input: { courseTitle: string; unitTitle: string; topicText?: string; source?: string; cedPath?: string }): string;
```

  Unit: `Teach me <unitTitle> from <courseTitle>, to the AP syllabus.` Topic: `Teach me <topicText> (<unitTitle>) from <courseTitle>, to the AP syllabus.` When `cedPath` is given, append ` The official course description is ` + the path quoted with `quoteFilePath` (`src/core/file-paths.ts`) + `.`; when `source` is also given, append ` This part is at <source>.` When `cedPath` is absent, append ` The official course description is not on this computer; teach from your own knowledge of the AP syllabus and say so.`

- [ ] **Step 1: Write the failing tests**: `learnPrompt` for the four combinations (unit/topic × with/without path), asserting the exact strings; `CourseView` rendered for a confirmed course shows the four status phrasings, the unit and topic buttons, the weak-topics button and a `Missing on this computer` row with its download button; rendered unconfirmed it shows `Confirm` and no `Practise`; `UnitsReviewCard` renders units and topics and targets `/api/ap/<id>/plan`; the artifact registry maps the seven tool names; the three activity labels.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement**, after reading the Next.js page guide named in Global Constraints.
- [ ] **Step 4: Run to verify pass**: the new file plus `tests/test-prep-plan-card.test.tsx`, `tests/test-prep-readiness.test.tsx`, `tests/demos.test.tsx`, `tests/stream-activity.test.ts`; `npm run typecheck`; `npm run lint`.
- [ ] **Step 5: Commit** — `feat(ap): course page, units review card and sitting chooser`

---

### Task 11: Entry points

**Files:**
- Modify: `components/home.tsx` (`HOME_MODES` gains `"ap"`, label `AP`; in AP mode the composer text is the course name and `begin()` posts `{ title: <name>, kind: "ap", apCourseTitle: <name> }`; placeholder `Which AP course? e.g. AP Calculus BC`; no test-name field), `components/new-session.tsx` and `app/chat/new/page.tsx` (`mode=ap`, same creation body), `components/sidebar.tsx` (a link `AP` to `/ap` with `data-testid="ap-link"` directly after the Tests link; AP sessions listed like Test prep sessions), `components/chat.tsx` and `app/chat/[id]/page.tsx` (props `kind` accepts `"ap"` and `apCourseId`; an AP session shows the door back to `/ap/<apCourseId>` where a Test prep session shows its door to the test; whatever the header hides for `testprep` it hides for `ap`)
- Test: extend the existing home, new-session, sidebar and chat render tests that cover the `testprep` mode (`grep -rln "testprep" tests`)

- [ ] **Step 1: Write the failing tests**: the home mode switch has four modes with `AP` last; in AP mode the send is disabled while the box is empty and the creation body is `{ title, kind: "ap", apCourseTitle: title }`; `/chat/new?mode=ap` renders the AP draft; the sidebar renders `ap-link` → `/ap`; a chat with `kind="ap"` and `apCourseId="ap_x"` renders a link to `/ap/ap_x`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass** on every test file touched; `npm run typecheck`; `npm run lint`.
- [ ] **Step 5: Commit** — `feat(ap): home, sidebar and chat entry points`

---

### Task 12: Forget a deleted session's answers

**Files:**
- Modify: `src/server/chats.ts`
- Test: `tests/ap-session-delete.test.ts`

**Interfaces:**
- In `finishChatRecordDeletion(chatId)`: read the chat record before it is deleted; when its `kind` is `"ap"` and it has an `apCourseId`, call `stores.apCourseStore.forgetChat(apCourseId, chatId)` after the chat record is gone. A missing course is not an error. Both deletion paths (`deleteChatSession` and `deleteIdleChatRecord`) go through this function.
- Test prep's own `forgetChat` wiring is out of scope: if `git grep -n "testStore.forgetChat" src app` shows a call already in this function, add the AP call beside it in the same style; if not, add only the AP call and leave Test prep as it is.

- [ ] **Step 1: Write the failing tests** (temp data dir; a confirmed course; two AP chats that each recorded a result on the same topic): deleting the second chat leaves the topic in the status the first chat's attempt alone produces and removes the second chat's attempt from the history; deleting a chat with no attempts leaves the course file's bytes unchanged; deleting an AP chat whose course file is gone succeeds.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass**, plus the existing session-deletion tests (`grep -rln "deleteChatSession\|deleteIdleChatRecord" tests`); `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(ap): forget a deleted session's answers in its course`

---

### Task 13: Docs and the full suite

**Files:**
- Create: `docs/ap-prep.md` (user guide, modelled on `docs/test-prep.md`)
- Modify: `docs/README.md` (link it under user guides), `README.md` (one line beside the Test prep line), `docs/architecture.md` (the `ap` kind, the course store, the local paper store and why it is unsynced)

- [ ] **Step 1: Write the docs.** The user guide covers: adding a course from the home screen; what to do when the tutor finds the wrong document; confirming and later editing units and topics; the course page and the four statuses; starting a sitting and its three scopes; that questions are newly written and multiple-choice only for now; optional reasoning and that a right pick with flawed reasoning counts as a miss; what happens after a miss; Learn; that official PDFs stay on this computer and are downloaded again on another; that free-response and figures arrive in later stages.
- [ ] **Step 2: Run the whole suite** — `NODE_ENV=test ./node_modules/.bin/tsx --test tests/*.test.ts tests/*.test.tsx`, output to a file. Compare the failing set **by name** with the baseline taken at the start of execution. Expected: the same known platform failures and nothing else. Report any new failure; do not fix baseline failures.
- [ ] **Step 3: `npm run typecheck` and `npm run lint`** — no new errors.
- [ ] **Step 4: Commit** — `docs(ap): AP prep user guide`
- [ ] **Step 5: Hand-check with the owner on the running app** (not to be marked done from tests): add "AP Calculus BC" from the home screen and watch the tutor find and save the course description and propose units; confirm; check `data/.gitignore` has `ap-papers/` and that `git -C data status` shows the course record and no PDF; practise one topic — answer one question right with no reasoning, one right with deliberately wrong reasoning, one wrong — and confirm no verdict appears before the tutor's reply and the statuses on the course page match the design; press Learn on a topic and confirm the Teach session opens with the course description referenced.
