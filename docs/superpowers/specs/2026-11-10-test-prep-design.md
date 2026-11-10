# Test prep mode — design

Date: 2026-11-10 · Owner: Kevin09sun · Status: draft for approval

## Intent

The owner studies for tests across many fields (STEM, philosophy, English, …) and aims for 100% on each. They put the course material — slides, the test outline, etc. — in a folder and want LearnHarness to:

1. find out **as fast as possible** where they stand on everything the test covers,
2. **never explain what they already know**, and
3. fill the gaps efficiently, until every point is solid.

Today's Teach mode explains its way up to a goal; Practice poses problems from graph material. Neither is shaped around "cover a whole test outline, skip the known, fix only the gaps, track readiness over several sittings." Test prep is a third session type for exactly that.

## Goals

- A new **Test prep** session type alongside Teach and Practice.
- Scope comes from the learner's folder: the test outline defines "everything"; slides fill in when there's no outline or it is vague.
- Fast diagnosis with short typed answers, spread across all sections.
- Known material is skipped silently; only gaps get teaching.
- Per-point progress that persists across sittings (at least 2), with a per-section readiness view.

## Non-goals

- Full essays or long-form writing practice. Essay subjects are broken into small skills (see "Subjects").
- Multiple-choice as the main format (short typed answers are the format).
- Changing how Teach or Practice behave.

## Anti-goals (would be a failure even if it "works")

- Explaining things the learner just answered correctly.
- Readiness going up without the learner actually answering correctly (no "I know this" shortcuts, no credit for hint-assisted answers).
- A point counting as solid just because it was answered right immediately after its explanation.
- Writing learner performance into the knowledge graph (it stores ideas, not ability ratings — see `src/core/contracts/graph.ts:6-10`, `README.md`).

## The flow (owner-approved)

### 1. Start a test
The learner picks **Test prep** (where Teach/Practice are chosen today), points it at a folder using the existing file/folder picker, and names the test (e.g. "Bio midterm").

The agent reads the outline (or, failing that, the slides) and **proposes a plan**: sections (from the outline's headings) each containing points (the individual things the test covers). The learner reviews it — edit, add, remove points — and confirms, the same way the current teaching plan is shown for review. Nothing is diagnosed before the plan is confirmed.

### 2. Diagnose fast
One quick short-answer question per point, spread across all sections. A correct answer marks the point **solid** and the agent moves on with no explanation. A wrong answer marks it a **gap**.

### 3. Fix gaps
For a gap: a short explanation, then a **fresh** question on the same point (not a repeat of the first one).
- Right → **fixed, re-check next time**.
- Wrong → try a different angle (different explanation/question), and repeat.

### 4. Later sittings
Opening the test shows the readiness view. **Continue** works in this order: re-checks first, then unchecked points, then remaining gaps. A fixed point becomes **solid** only when answered correctly in a **later** sitting than the one where it was fixed.

### 5. Readiness
Readiness = solid points ÷ all points, overall and per section. 100% = every point solid.

### Point statuses
`unchecked` · `solid` · `gap` · `fixed-recheck` (fixed this sitting, needs a re-check in a later sitting).

## Subjects

Questions are always short typed answers. For essay-style subjects, points are small skills, not essays:
- **English:** e.g. write a thesis for a given prompt, analyze a given quote, choose evidence for a claim.
- **Philosophy:** e.g. explain a concept, lay out an argument, give an objection.
- **STEM:** short computations, definitions, short explanations.

Each answer is judged on its own as solid or a gap.

## Readiness view (owner chose option B)

When returning to a test: the test name, an overall "Ready: N%" figure, and one progress bar per section. Opening a section shows its points and their statuses. A **Continue where I left off** button resumes. (Mockup: `.superpowers/brainstorm/…/progress-view.html`, option B.)

## Constraints

- Build inside this repo (LearnHarness fork, branch `custom`), reusing its stack. Per `AGENTS.md`, read `node_modules/next/dist/docs/` before Next.js work.
- Answer input reuses the existing short-answer question UI (`explain`/`recall` text mode in `components/question-dock.tsx`, schema in `src/core/question-core.ts`).
- Folder access reuses the existing picker and read-only file tools (`components/attach-files-button.tsx`, `src/agent/tools/read.ts`, PDF subagent).
- Performance data must not go into the knowledge graph.

## Knowledge graph (owner-decided)

Test prep sessions **run the normal background graph extraction**, like Teach sessions (not extraction-free like Practice): the course ideas a session covers become propositions/chains in the graph, reusable in later Teach and Practice sessions. Only ideas go in — never statuses, answers' correctness or readiness (see Anti-goals).

## Feedback and help (Claude's calls, from the builder check)

- **After a correct answer:** a brief ✓ verdict and the next question. The committed answer is **not** revealed and nothing is explained. The existing free-text card always reveals the answer (`components/question-dock.tsx:309-314`, `components/answered-card.tsx:224-231`), so Test prep needs a variant/flag that suppresses the reveal.
- **After a wrong answer:** the short explanation (which includes the right answer), then a fresh question on the same point.
- **"I don't know" / asking for help or a hint:** counts as a gap and goes straight to the explanation. Never credited; there is no hint step.

## Plan editing and scope (Claude's calls, from the builder check)

- The plan stays **editable after confirmation**, from the readiness view: added points start `unchecked`; removed points drop out of readiness (their history may be kept but doesn't count). Readiness recalculates.
- **Coverage is audited by the learner, not machine-validated:** at review, each proposed point shows the outline line (or slide) it came from, so missing outline items are easy to spot.
- **No usable outline and no defensible scope from the slides:** the agent stops and asks the learner what the test covers rather than inventing scope from general knowledge.

## Decided by Claude (owner can override)

- **Progress storage:** each test's progress (sections, points, statuses, per-point history with sitting dates) is stored in its own file under the data directory (e.g. `data/tests/<id>.json`), separate from chats and the graph.
- **A dedicated Test prep agent prompt** under `src/agent/prompts/test-prep/`, overridable like other role prompts, with tools to propose/confirm the plan, ask a point's question, and record a point's result.
- **Grading** is model judgement of the short answer against the point, in the style of Practice's grading.

## Left to the builder

- Exact tool names and schemas, store format details, and how "a sitting" is delimited (e.g. by calendar day or by explicit session).
- How the plan-review UI is built, as long as it behaves like the current teaching plan review.
- Readiness view component details within option B.
- Compaction handling for long test sessions.
- Tests.

## Reference: existing code (from recon)

- Session kinds: `ChatKind` in `src/core/contracts/chat.ts:28`; creation `src/store/chats.ts:37-48`; UI choice `components/home.tsx`, `components/sidebar.tsx`, `app/chat/new/page.tsx`; per-turn agent selection `src/server/chat-handler.ts:418-525`.
- Prompts: `src/agent/prompts/{shared,teacher,prober,practice}`; composition `src/agent/teacher-agent.ts:77-84`; segments `src/agent/prompt-segments.ts`; overrides `src/store/prompt-overrides.ts`, Settings → Agent → System prompts.
- Prober plan/assessment: `src/agent/tools/probe.ts`, `src/core/contracts/probe.ts`.
- Practice grading vocabulary: `src/agent/tools/practice.ts:165-219`.
