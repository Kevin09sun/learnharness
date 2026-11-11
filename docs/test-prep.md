# Test prep mode

Test prep is the third session type, alongside Teach and Practice. It is built around a named test: the agent turns your outline into a plan of sections and points, asks one short question per point, explains only what you miss, and tracks how ready you are across several sittings.

Use it when you have a folder of course material (an outline, slides, or both) and want to cover everything the test can ask, skip what you already know, and fix the gaps.

## Start a test prep session

1. Choose **Test prep** where you choose Teach or Practice.
2. Enter a **test name** (for example, "Bio midterm"). The name labels the test and its readiness page.
3. Attach the folder holding your material, using the file/folder picker.

The agent reads the **outline first**. It reads the slides only when there is no outline, or when the outline is too vague to place items. It then proposes a plan:

- **Sections** are the outline's headings.
- **Points** are the individual things the test covers under each heading.

If neither the outline nor the slides yields a defensible scope, the agent asks what the test covers instead of inventing one. Nothing is diagnosed before you confirm the plan.

## Review and confirm the plan

The proposed plan appears as a card in the conversation. Every point shows the outline line or slide it came from, in smaller text under it, so you can audit coverage and spot anything missing.

In the card you can:

- edit a section title or a point's text in place;
- remove a section or a point;
- add points to a section, or add a new section.

Then choose **Confirm plan**. Confirming saves the plan and starts the first sitting; the card collapses to a summary with a link to the test's readiness page. If the agent later proposes a revised plan, only the latest proposal is editable and earlier ones are marked as revised.

## How questions work

The agent asks **one short-answer question per point**, spread across the sections so a sitting does not get stuck in one heading. Type the answer and send it.

- **Correct:** the agent says only that it is right and moves on. It does not explain the answer, and the answer itself is not revealed.
- **Wrong, "I don't know", or asking for help or the answer:** this counts as a gap. The agent gives a short explanation that includes the right answer, then asks a **fresh** question on the same point, not a repeat of the one you just saw. If that is missed too, it tries a different angle.

There are no hints, and answering "I know this" earns nothing. Only an answered question moves a point.

For essay-style subjects, points are small skills rather than essays: write a thesis for a prompt, analyse a quoted line, choose evidence for a claim, lay out an argument, give an objection, or do a short computation or definition.

## Point statuses

Each point has one of four statuses:

| Status | Meaning |
| --- | --- |
| `unchecked` | Not asked yet. |
| `solid` | Answered correctly, unaided. |
| `gap` | Missed, or the first answer was wrong or "I don't know". |
| `fixed-recheck` | Answered correctly after an explanation in this sitting. It must be answered correctly again in a **later** sitting before it counts as solid. |

A solid point that is later missed becomes a gap again.

## Readiness

Open **Tests** in the sidebar to see every test, or open a test directly. The readiness page shows:

- the test name and an overall **Ready: N%**, with the number of solid points out of the total;
- one progress bar per section, with its own solid/total counts;
- each section's points and their statuses when you expand it.

Readiness is solid points divided by all points. 100% is reserved for every point being solid; other percentages round down.

## Sittings

Each conversation with the test is a sitting. **Continue where I left off** on the readiness page creates the next sitting and starts from the agent's queue:

1. re-checks of points fixed in an earlier sitting;
2. unchecked points, interleaved across sections;
3. remaining gaps.

A point fixed in one sitting becomes solid only when answered correctly in a different sitting. A point already fixed in the current sitting is not asked again in it.

## Editing the plan later

**Edit plan** on the readiness page reopens the same plan editor on the confirmed plan. Saving always confirms the plan, so answering can continue immediately.

- Edited points keep their status and history.
- Added points start `unchecked`.
- Removed points stop counting toward readiness; their history is kept in the test file.

Readiness recalculates from the new plan.

## Where progress is stored

Each test's plan, statuses, and per-point history are stored under the data directory at `data/tests/<id>.json`. Test prep sessions also contribute to the knowledge graph like Teach sessions: the ideas the material covers become graph material for later sessions. Only ideas go in. Statuses, answer correctness, and readiness never do.