# Bulk Delete Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user select many sessions in the sidebar and delete them in one action, and make every session delete erase the test-prep results that session produced.

**Architecture:** A pure replay function in `src/core/test-prep.ts` rebuilds a point's status from its remaining attempts. The shared server purge (`finishChatDeletion`) calls it through the tests store, so single and bulk delete both get it. A new `POST /api/chats/bulk-delete` endpoint runs the existing `deleteChatSession` for each id in sequence and returns a result for each one. The sidebar gains a select mode backed by pure selection helpers and a new bulk-delete dialog.

**Tech Stack:** Next.js 16.4 (App Router, `params` is a Promise), React, TypeScript, `node --test` via `tsx`, SSR-only component tests.

**Spec:** `docs/superpowers/specs/2026-11-12-bulk-delete-sessions-design.md`

## Global Constraints

- Test command: `npm test`. A single file: `NODE_ENV=test npx tsx --test tests/<file>`.
- All tests live flat in `tests/`. Route tests set `process.env.LH_DATA_DIR` to an `fs.mkdtempSync` dir and delete `LH_DESKTOP_SERVER` / `LH_DESKTOP_API_SECRET` **before** dynamically importing any store or route (see `tests/test-prep-plan-route.test.ts:24-29`).
- Indent with tabs, like the rest of the repo.
- Delete copy keeps "This cannot be undone."
- New mutating endpoints call `sameOriginAuthorized(request)` from `@/src/server/same-origin` and return 403 when it fails.
- The suite already had about 29 environment-related failures before this work (auth, data-dir, update-preference, verify-release). Judge only the files this plan touches and confirm no **new** failures against the baseline saved in Task 0.

## Review Focus

1. **A test-prep session whose delete fails** (409/503) must leave its test progress untouched: cleanup runs only after a successful purge. *(Task 2 test)*
2. **A point whose every attempt came from the deleted session** returns to `unchecked` with no `fixedIn` and an empty history. *(Task 1 test)*
3. **`fixedIn` pointing at the deleted session.** After replay, a `gap → correct(deleted) → correct(other)` point must end as `fixed-recheck` with `fixedIn = other`, not `solid`. *(Task 1 test)*
4. **Duplicate, empty, or unknown ids in a bulk request.** Duplicates are deduped. An empty list or a non-string returns 400. An unknown id yields a per-item `not_found` without aborting the rest. *(Task 3 tests)*
5. **Selection hiding behind a filter.** Changing the filter or search prunes the selection to the rows still shown, so **Delete N…** never deletes something the user can't see. *(Task 4 test)*

---

### Task 0: Baseline

- [ ] Run `npm test > %TEMP%\lh-baseline.txt 2>&1` (or bash equivalent) on the current HEAD and record the failing test names. Later tasks compare against this list.

### Task 1: Replay test-point history without a session

**Files:**
- Modify: `src/core/test-prep.ts` (next to `applyResult`, line ~73)
- Modify: `src/store/tests.ts` (add store method; export in the store object at ~198-204)
- Test: `tests/test-prep-core.test.ts`, `tests/test-prep-store.test.ts`

**Interfaces:**
- Produces: `forgetChatInPoint(point: TestPoint, chatId: string): TestPoint`, a pure function. It returns the point rebuilt by starting from `{ ...point, status: "unchecked", fixedIn: undefined, history: [] }` and folding `applyResult(acc, a.result, a.chatId, a.at)` over `point.history.filter(a => a.chatId !== chatId)` in original order. When no attempt matches `chatId`, it returns the same object reference unchanged.
- Produces: `testStore.forgetChat(testId: string, chatId: string): boolean`. It applies `forgetChatInPoint` to every point in every section. It writes with `writeTest` and emits `tests-changed` only if some point changed, and returns whether it wrote. A missing test returns `false`.

- [ ] **Step 1: Write failing core tests** in `tests/test-prep-core.test.ts`:
  - `forgetChatInPoint resets a point whose only attempts were from the chat`: history `[{chat A, wrong}]`, status `gap` → result `status === "unchecked"`, `fixedIn === undefined`, `history.length === 0`.
  - `forgetChatInPoint replays remaining attempts`: build a point by `applyResult` over `B wrong`, `A correct`, `C correct`, then forget `A` → `status === "fixed-recheck"`, `fixedIn === "C"`, `history.map(h => h.chatId)` equals `["B","C"]`.
  - `forgetChatInPoint keeps solid earned without the chat`: `B wrong`, `C correct`, `A correct`; forget `A` → `status === "fixed-recheck"`, `fixedIn === "C"`.
  - `forgetChatInPoint returns the same object when the chat is absent`: `assert.strictEqual(forgetChatInPoint(p, "Z"), p)`.
- [ ] **Step 2:** Run `NODE_ENV=test npx tsx --test tests/test-prep-core.test.ts`. Expect failure (no export).
- [ ] **Step 3:** Implement `forgetChatInPoint` in `src/core/test-prep.ts`.
- [ ] **Step 4: Write a failing store test** in `tests/test-prep-store.test.ts`, `forgetChat erases a chat's results and lowers readiness`: create a test, save a plan with one point, `recordResult(... "correct", "A")` until `solid` (follow the transitions `applyResult` needs, using two chats where it requires them, e.g. `A` then `B`), call `forgetChat(id, "B")` → returns `true`, the stored point is no longer `solid`, and `readiness(get(id))` shows 0 solid. `forgetChat(id, "nope")` returns `false`, and `forgetChat("missing", "A")` returns `false`.
- [ ] **Step 5:** Implement `forgetChat` in `src/store/tests.ts` and add it to the exported store.
- [ ] **Step 6:** Run both test files. Expect PASS.
- [ ] **Step 7: Commit** `feat(test-prep): erase a session's results from test progress`.

### Task 2: Erase test-prep results on every session delete, plus a bulk server function

**Files:**
- Modify: `src/server/chats.ts` (`finishChatDeletion` ~142-148; add `deleteChatSessions`; export it from `src/server/index` alongside `deleteChatSession`)
- Test: new `tests/chat-bulk-delete.test.ts` (copy the data-dir setup from `tests/graph.test.ts`, which already exercises `deleteChatSession`)

**Interfaces:**
- Consumes: `testStore.forgetChat` (Task 1). Use `stores.testStore` if `stores` exposes it; otherwise import `testStore` from `src/store/tests.ts`.
- Produces:
  ```ts
  export type BulkDeleteItem =
  	| { id: string; ok: true }
  	| { id: string; ok: false; code: string; error: string };
  export async function deleteChatSessions(ids: string[], mode: ChatDeleteMode):
  	Promise<{ results: BulkDeleteItem[]; graphRevision: number }>;
  ```
  It dedupes ids while keeping first-seen order, then awaits `deleteChatSession(id, mode)` **one at a time**, mapping each outcome to a `BulkDeleteItem`. `graphRevision` is the revision after the last delete, or the current `graphRevision()` if none succeeded.
- `finishChatDeletion`: read `stores.chatStore.getChat(chatId)?.testId` **before** the purge. After `finishChatRecordDeletion` succeeds, if `testId` is set, call `forgetChat(testId, chatId)`.

- [ ] **Step 1: Write failing tests** in `tests/chat-bulk-delete.test.ts`:
  - `deleting a testprep session erases its results`: create a test with one point, create a `testprep` chat with `testId`, `recordResult` for that chat, then `deleteChatSession(chatId, "preserve-graph")` → `ok`, and the point's history no longer contains the chat id and its status is `unchecked`.
  - `a blocked delete leaves test progress untouched`: same setup, but make the chat busy the way `tests/graph.test.ts` does for `turn_in_flight` (reuse its approach). `deleteChatSession` returns `ok:false`, and the point's history still contains the chat.
  - `deleteChatSessions deletes several and reports each`: chats `a`, `b`, plus id `missing`, with `["a","b","a","missing"]` → `results` has length 3 in order `a,b,missing`, the first two `ok:true`, the third `{ok:false, code:"not_found"}`, and `a` and `b` are gone from `listChats()`.
- [ ] **Step 2:** Run the file. Expect FAIL.
- [ ] **Step 3:** Implement the `finishChatDeletion` change and `deleteChatSessions`.
- [ ] **Step 4:** Run the file and `tests/graph.test.ts`. Expect PASS.
- [ ] **Step 5: Commit** `feat(chats): bulk delete and test-prep cleanup on delete`.

### Task 3: `POST /api/chats/bulk-delete`

**Files:**
- Create: `app/api/chats/bulk-delete/route.ts`
- Test: new `tests/chat-bulk-delete-route.test.ts`

**Interfaces:**
- Consumes: `deleteChatSessions` (Task 2), `sameOriginAuthorized`.
- Produces: `POST /api/chats/bulk-delete`, body `{ ids: string[]; mode: "preserve-graph" | "delete-nodes" }`.
  - Not same-origin → 403 `{ error: "Deleting sessions requires a trusted same-origin request.", code: "forbidden" }`.
  - Invalid JSON, `ids` not a non-empty array of non-empty strings, or a bad `mode` → 400 `{ error, code: "bad_request" }`.
  - Otherwise → 200 `{ results: BulkDeleteItem[], graphRevision: number }`, even when some items failed.

- [ ] **Step 1: Write failing tests**: the 403 case (no `Sec-Fetch-Site`/`Origin`), 400 for `ids: []`, `ids: [1]`, and `mode: "x"`, and a 200 case deleting two real chats plus one unknown id (assert per-item `ok` and `code`). Build same-origin requests the way `tests/test-prep-plan-route.test.ts` does.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement the route.
- [ ] **Step 4:** Run. Expect PASS.
- [ ] **Step 5: Commit** `feat(api): bulk delete sessions endpoint`.

### Task 4: Selection helpers

**Files:**
- Create: `components/session-selection.ts`
- Test: new `tests/session-selection.test.ts`

**Interfaces (all pure, return new Sets):**
- `toggleSelected(selected: ReadonlySet<string>, id: string): Set<string>`
- `selectRange(selected: ReadonlySet<string>, shownIds: readonly string[], anchorId: string | null, id: string): Set<string>`: adds every id between `anchorId` and `id` inclusive, in `shownIds` order. If the anchor is null or not shown, it acts like adding just `id`.
- `selectAllShown(shownIds: readonly string[]): Set<string>`
- `pruneToShown(selected: ReadonlySet<string>, shownIds: readonly string[]): Set<string>`

- [ ] **Step 1:** Write a failing test for each function, including a backward range (anchor below `id`), a missing anchor, and `pruneToShown` dropping a hidden id.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement. **Step 4:** Run. Expect PASS.
- [ ] **Step 5: Commit** `feat(sidebar): session selection helpers`.

### Task 5: Bulk delete dialog

**Files:**
- Create: `components/bulk-delete-sessions-dialog.tsx` (model on `components/delete-session-dialog.tsx`: portal, `useBackdropDismiss`, Esc, Cancel/destructive pair, unchecked-by-default traces checkbox)
- Test: new `tests/bulk-delete-dialog.test.tsx` (SSR, like `tests/session-context.test.tsx`)

**Interfaces:**
- Produces: `BulkDeleteSessionsDialog({ chats, onClose, onFinished })`, where:
  - `chats: Pick<ChatListItem, "id" | "title">[] | null` (null = closed)
  - `onFinished: (deletedIds: string[], failed: { id: string; code: string; error: string }[], graphRevision: number) => void`
  - It also exports a presentational `BulkDeleteSessionsBody` for SSR tests.
- Fixed copy (N = `chats.length`; use "session"/"sessions" for N = 1 vs other):
  - Title: `Delete N sessions?`
  - Intro: `This permanently removes N sessions — their messages, background jobs, and extraction records. Everything they added to the graph stays unless you check below. This cannot be undone.`
  - Checkbox title: `Also remove their graph traces`. Body: `These sessions’ topics, links, and events leave the graph too. Topics other sessions or imported notes also cover survive; topics only these sessions created are removed entirely.`
  - Buttons: `Cancel` / `Delete N` (busy: `Deleting…`).
  - Partial result (shown in the dialog after the request, with a single `Close` button): `Deleted X of N; Y couldn't be deleted.` followed by a list of each failed session's title and `error`.
- Behavior: it POSTs to `/api/chats/bulk-delete` with the chosen mode. If every item succeeds, it calls `onFinished` right away. Otherwise it calls `onFinished` and then shows the partial result until the user presses Close (`onClose`). A non-200 response shows the error with `Try again`, like the existing dialog.

- [ ] **Step 1:** Write failing SSR tests: the title and intro for N = 3, singular wording for N = 1, the `Delete 3` button text, and the partial-result text for X = 2, N = 3, Y = 1.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement. **Step 4:** Run. Expect PASS.
- [ ] **Step 5: Commit** `feat(sidebar): bulk delete sessions dialog`.

### Task 6: Select mode in the sidebar

**Files:**
- Modify: `components/sidebar.tsx`: the Sessions header (746-805), row mapping (841-862), `SessionRow` (301-347), and dialog mounting (~960-964)
- Test: `tests/render-sidebar.test.tsx`

**Interfaces:**
- Consumes: Task 4 helpers, Task 5 dialog.
- `SessionRow` gains optional `selectable?: boolean` and `selected?: boolean`. When `selectable` is set, it renders a checkbox (`role="checkbox"`, `aria-checked={selected}`) before the title, `data-testid="session-row-select"`, and its click calls a new `onToggle(e)` prop instead of `onOpen`.
- Sidebar state: `selecting: boolean`, `selected: Set<string>`, `anchorId: string | null`, `bulkDeleting: ChatListItem[] | null`.
  - The header shows **Select** when not selecting. When selecting it shows **Select all (shown)** and **Cancel**. Cancel clears the selection and exits.
  - A click toggles the row and sets `anchorId`. Shift-click calls `selectRange`. Enter on the keyboard row toggles it.
  - A footer button under the list reads `Delete N…` and is disabled at 0. It opens the dialog with the selected `ChatListItem`s.
  - On any change to `shown` (filter, search, or a list refresh), run `selected = pruneToShown(selected, shown ids)`.
  - The context menu doesn't open while selecting.
  - `onFinished`: remove the deleted ids from `chats`. If `pathname` is `/chat/<deleted id>`, `router.push("/")`. Dispatch `lh:graph-revision` with the revision. Set `selected` to the failed ids. If none failed, exit select mode and close the dialog.

- [ ] **Step 1:** Write failing SSR tests for `SessionRow`: with `selectable` and `selected` it renders `data-testid="session-row-select"` and `aria-checked="true"`; without `selectable` there is no checkbox.
- [ ] **Step 2:** Run. Expect FAIL. **Step 3:** Implement the `SessionRow` props and the sidebar wiring. **Step 4:** Run. Expect PASS, and `npx tsc --noEmit` is clean.
- [ ] **Step 5:** Run the full `npm test` and compare it with the Task 0 baseline. Expect no new failures.
- [ ] **Step 6: Manual check:** `npm run build`, then restart the server (`Stop` the node process on :3000, then `Start-ScheduledTask LearnHarness`). In the browser, select 2 throwaway sessions, delete them, and confirm they disappear and the sidebar leaves select mode.
- [ ] **Step 7: Commit** `feat(sidebar): select mode for bulk deleting sessions`.
