# Bulk delete sessions — design

## Why
The user wants to clear out a lot of old sessions at once. Today a session can only be deleted one at a time, through the sidebar's right-click menu (**Delete…** opens `DeleteSessionDialog`).

## Goals
- Delete many sessions in one action from the sidebar's Sessions list.
- When a test-prep session is deleted, erase the test-progress results it produced, as if that session never happened. This applies to both single and bulk delete.

## Non-goals
- Rule-based cleanup ("older than N days"). Search and filter plus **Select all** cover that need.
- Undo or a trash bin. Deletes stay permanent, as they are today.
- Deleting tests themselves (on `/tests`).

## Approaches
- **A. Select mode in the sidebar (chosen).** A visible **Select** button turns on checkboxes. It's easy to find, works with the existing search and filter, and gives precise control.
- B. Ctrl/Shift-click on rows plus right-click "Delete N…". No mode switch, but it's as hidden as delete is today.
- C. "Delete sessions older than X" with a preview. Fast, but it can catch sessions that are still in use.

## Design (decided by the user)
- A **Select** button sits in the Sessions header (`components/sidebar.tsx`). In select mode each row shows a checkbox, a click toggles the row, and shift-click selects a range. The header shows **Cancel** and **Select all (shown)**, which selects every row that passes the current filter and search. The footer shows **Delete N…**, disabled when N = 0.
- **Delete N…** opens a confirmation box modeled on `DeleteSessionDialog`. It says how many sessions will be deleted and offers the same graph choice (`preserve-graph` / `delete-nodes`), applied to every selected session. The copy keeps "This cannot be undone."
- Deleting a test-prep session also removes that session's results from its test's progress: point `history` entries and `fixedIn` marks whose `chatId` matches (`src/core/test-prep.ts`). Every point status derived from them is computed from what remains, so readiness can go down.

## My calls (correct any)
- **One bulk server operation** (a new endpoint beside `/api/chats/[id]` DELETE). It does not loop over single DELETEs from the client, because each delete rewrites the graph files, and N separate calls would be slow and could interfere with each other. It returns a result for each session.
- **Partial failure:** sessions that can't be deleted (for example, one with a turn running) are skipped. The box reports "Deleted X of N; Y couldn't be deleted", and the skipped sessions stay selected so the user can retry.
- After a successful delete, select mode exits. If the open session was deleted, the app goes home, matching single delete.
- Single delete gets the same test-prep cleanup through the same server code path.
- The new mutating endpoint uses the existing `sameOriginAuthorized` check (`src/server/same-origin.ts`).
- The new behavior gets tests: bulk endpoint results, the test-prep erase, and the select-mode UI.

## Left to the builder
- Exact component split and the bulk endpoint's route shape.
- How to batch the graph rewrites inside the bulk operation.
