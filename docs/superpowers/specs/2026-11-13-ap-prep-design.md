# AP prep mode — design

Status: approved by the owner on 2026-11-13. One design, built in three stages; each
stage gets its own plan.

## Intent

The owner is sitting AP exams in 2027 and wants LearnHarness to teach the AP
content and to practise it with exam-style questions. The point of practice is
to have the owner's **thinking** judged, not just final answers: where the
reasoning went wrong, against the official scoring where it exists.

Test prep cannot do this. It scopes only from the learner's own folder, asks
short typed answers, and names multiple-choice and long-form answers as
non-goals. AP prep is therefore a new mode beside it (owner-chosen), reusing
its readiness rule.

## Goals

- An AP course is set up once from College Board's official course
  description: units, and the numbered topics inside each unit.
- Per topic, the owner can **Learn** (taught by the existing Teach mode) or
  **Practise** (AP questions), and sees readiness per unit and topic.
- Practice asks one question at a time, multiple-choice or free-response,
  grades the reasoning as well as the answer, and explains each miss.
- Free-response practice uses real released questions graded against the
  official scoring guidelines, and later newly written questions in the same
  style. Every question is labelled real or generated.
- Works for any AP course. The owner's first courses are in maths/computing
  and the sciences.

## Non-goals

- Timed mock exam sections, pacing, or a projected 1–5 score.
- Real past multiple-choice questions (College Board does not publish them,
  beyond samples in the course description).
- Changing how Teach, Practice or Test prep behave.
- Speaking and listening tasks (world languages), and audio stimulus.
- Hardening web page reading (accepted as later work in the search design).

## Anti-goals (a failure even if it "works")

- A topic turning solid on a lucky pick, on a right answer with wrong
  reasoning, or on a retry taken straight after the explanation.
- A generated question whose committed answer or rubric is wrong, so the
  owner is graded against a mistake.
- A generated question presented as a real released one, or the reverse.
- Readiness rising from a Learn session, from self-assessment, or from
  anything other than an answered practice question.
- Official papers travelling in the data sync.
- Writing performance (statuses, correctness, readiness) into the knowledge
  graph.

## The flow (owner-approved)

### 1. Add a course

Setup happens **in a chat with the tutor** (owner-chosen). Choosing AP and
typing a course name ("AP Calculus BC") opens a setup session. The tutor
finds the official Course and Exam Description on College Board's site,
downloads it, and proposes the unit list and each unit's numbered topics,
with the source page for each unit, as a card in the chat. The owner edits
and confirms the card, the same way a Test prep plan is confirmed. Nothing
can be practised before the list is confirmed.

If the tutor finds the wrong document or none, the owner can say so, paste a
College Board link, or attach the PDF themselves; the tutor then works from
that.

From stage 2, setup also finds and downloads the released free-response
question papers and their scoring guidelines, for as many years as College
Board publishes for the current course framework.

### 2. The course page

```
AP Calculus BC                         readiness 41%
  Unit 5  Analytical Applications      62%   [Learn] [Practise]
    5.1 Mean Value Theorem       solid        [Learn] [Practise]
    5.2 Extreme Value Theorem    solid        [Learn] [Practise]
    5.3 Increasing/decreasing    gap          [Learn] [Practise]
    5.4 First Derivative Test    re-check next sitting
    5.5 …                        not yet asked
  Unit 6  …                            not started
  [Practise weak topics]
```

### 3. Start a practice sitting

Starting a sitting asks two things: **what** (a single topic, one unit, or
weak topics across units; owner-chosen) and **which kind** (multiple-choice,
free-response, or mixed). Within that choice the tutor orders topics
weak-first: re-checks, then topics not yet asked, then remaining gaps. A
single-topic sitting asks several different questions on that topic; the
readiness rule is unchanged.

### 4. A multiple-choice question

Newly written by the tutor, modelled on the official sample questions in the
course description, four options, one topic. The owner picks an option and
may type or dictate their reasoning; reasoning is optional.

- A bare pick is graded right or wrong.
- A pick with reasoning: the tutor judges both. **A right pick with flawed
  reasoning is a miss.**

### 5. A free-response question

A multi-part question. Each part is tied to the topic it tests and carries
rubric points. The owner works on paper, dictates the answer and reasoning
for each part, and may attach a photo of the page when they want the written
steps checked. When a photo is attached the tutor first states what it read
from the page, then grades.

Each part is graded point by point. **A topic counts as answered correctly
only when every rubric point on its part was earned.**

- *Real* questions (stage 2) are shown as the original page image from the
  official paper, figures included, and graded against the official scoring
  guideline.
- *Generated* questions (stage 3) are written by the tutor in the style of
  the released ones, with a rubric it commits before posing.

### 6. After an answer

- **Correct:** the tutor says so briefly and moves on.
- **Miss or "I don't know":** the tutor gives the correct answer and
  pinpoints where the reasoning went wrong (for free-response, which rubric
  points were lost and why), then poses a **fresh question on the same topic
  straight away**. That immediate retry never makes the topic solid.

### 7. Readiness

The Test prep rule, per topic:

| Status | Meaning |
|---|---|
| not yet asked | no practice answer yet |
| solid | answered correctly, unaided |
| gap | last answer was a miss |
| re-check | missed, then answered correctly in the same sitting; must be answered correctly again in a later sitting to become solid |

A solid topic that is later missed becomes a gap. Unit readiness is solid
topics out of all topics in the unit; course readiness is the same across
all units.

### 8. Learn

"Learn" on a unit or topic opens a normal Teach session, with its opening
message naming the course, the unit or topic, and the downloaded course
description as reference material. Teach runs unchanged, including its
opening assessment. Learning never changes readiness.

## Stages

1. **Courses, multiple-choice, readiness, Learn.** Add a course from the
   official description; confirm units and topics; the course page;
   multiple-choice practice with optional reasoning; readiness; Learn.
   Multiple-choice questions in this stage use text, tables, maths notation
   and inline diagrams only, with no drawn figures.
2. **Real free-response.** Download and index released papers and scoring
   guidelines; show original pages; dictated answers with optional photo;
   rubric grading per part.
3. **Generated free-response and drawn figures.** Newly written free-response
   questions; figures drawn by the existing drawing helper for generated
   questions of either kind.

Each stage is usable on its own and is planned after the one before it has
been used.

## Storage and sync (owner-decided)

- The course record (units, topics, statuses, attempt history, and the list
  of official documents with their source links) is learning data and syncs
  with the rest of `data/`.
- The downloaded PDFs, and anything derived from them that can be rebuilt
  (extracted text, page images, the question index), stay on this computer
  and are excluded from the sync. On the other computer the course opens
  with its progress intact and offers to download the papers again.
- Page images shown in a session are served from that local store. They are
  not copied into the chat record, because chat records sync.

## Knowledge graph

Same rule as Test prep: AP practice sessions run the normal background
extraction of ideas; statuses, correctness and readiness never go in. Learn
sessions are ordinary Teach sessions and behave as Teach does.

## Constraints

- Follow `AGENTS.md`: read the relevant guide in `node_modules/next/dist/docs/`
  before writing any route or page.
- The tutor for an AP session runs on the session's conversation model, like
  every other mode. Reading a handwritten photo needs a model that accepts
  images; with one that does not, the tutor says so and grades the dictated
  answer only.
- Reuse what exists: the Test prep status machine and queue order
  (`src/core/test-prep.ts`), the question dock, dictation, the native file
  picker, PDF text extraction and page rendering (browser-free), the
  researcher, direct web search, the drawing helper.
- Official PDFs are downloaded only from College Board's own sites.

## Decided by Claude (owner can override)

- **Names.** The mode is shown as "AP"; the session kind is `ap`; the pages
  are `/ap` (courses) and `/ap/[id]` (one course); the course record lives at
  `data/ap/<id>.json` and local papers under `data/ap-papers/<id>/`, with
  `ap-papers/` added to `data/.gitignore`.
- **Entry points.** A fourth choice, "AP", in the home screen's mode switch
  (typing a course name there starts the setup session), and an "AP" link in
  the sidebar beside "Tests" leading to the course list.
- **One sitting is one session.** Every practice sitting is a new AP
  session linked to its course, with its scope (topic, unit or weak topics)
  and kind stored on the session. "A later sitting" in the readiness rule
  means a different session, exactly as in Test prep. The setup session is
  its own session linked to the same course.
- **Asking for help counts as a miss.** As in Test prep, asking for a hint,
  for help, or for the answer before answering is recorded as a miss, and
  "I don't know" as don't-know; the diagnosis and fresh question follow.
- **The list can be edited after confirmation**, from the course page, as a
  Test prep plan can. Topics keep stable identities: an edited or reordered
  topic keeps its status and history, a removed topic's history is dropped,
  a new topic starts as not yet asked. The tutor itself never changes the
  list during practice.
- **Stage 1 builds the document store for all stages.** The course record
  lists each official document (kind, edition or year, source link, download
  state), and the local store and the "download missing documents" path are
  built once, in stage 1, even though only the course description uses them
  then. A course opened on the other computer offers that download before
  Learn or practice.
- **The practice tutor is given the course description too**, not only
  Learn: the confirmed topic's page range and the official sample questions
  are its model for writing multiple-choice questions.
- **The multiple-choice card shows no automatic verdict.** The existing quiz
  card marks right and wrong and reveals the answer by itself; the AP card
  withholds all of that until the tutor has graded, as Test prep's card
  does. The confidence slider is not shown on AP questions.
- **Deleting a session** is wired in stage 1: wherever a deleted Test prep
  session's answers are forgotten at that time, an AP session's are too; if
  that is still unwired for Test prep, stage 1 wires the AP record's cleanup
  into session deletion directly.
- **The verdict is the tutor's.** As in Test prep, the app does not show a
  right/wrong mark from the option picked; the tutor grades (it must judge
  reasoning) and records the result. The tutor commits the correct option, a
  one-line reason each wrong option is wrong, and for free-response the full
  rubric, before the question is shown.
- **Recording a free-response result.** One result per topic touched: each
  part's topic gets correct or miss by the all-points rule. A part that tests
  a topic outside the confirmed list is graded and explained but changes no
  status.
- **Real questions and units.** When papers are indexed, each real question
  part is tagged with the topic it tests by the indexing job, from the
  question text and scoring guideline. The tag is shown with the question; the
  owner can tell the tutor it is wrong and the tutor corrects it.
- **A real question spanning topics outside the chosen unit** is still
  eligible for a unit sitting if at least one part tests that unit; all its
  parts are asked and recorded.
- **Not repeating real questions.** A real question already answered is not
  asked again until every other eligible real question has been used.
- **Free-response retry after a miss** is a short generated question on the
  missed part's topic, not another full real paper question. In stage 2,
  before generated free-response exists, the retry is a multiple-choice
  question on that topic.
- **Photo attach.** The answer box gains an "Attach photo" control that uses
  the existing file picker and inserts the file's path; the tutor reads the
  image from that path. No upload, no copy into the chat record.
- **Generated figures arrive late.** The drawing helper is a background job,
  so in stage 3 a generated question needing a figure is posed only once its
  figure has arrived and been checked against the question; the tutor asks a
  figure-free question in the meantime.
- **Weak-first order across a mixed sitting.** Topics are ordered weak-first;
  for each topic the tutor asks multiple-choice unless a real free-response
  question covering it is available and unused, in which case it alternates.
- **Deleting a session** removes that session's attempts from the course
  record and replays the rest, as Test prep's record does (see the wiring
  note above).
- **Dictation, search and research** behave in AP sessions as they do
  everywhere else. The web may be used to verify facts and committed answers,
  never to change the confirmed unit and topic list.
- **Course description changes.** A course is tied to the description it was
  built from. A newer edition is handled by adding the course again.

## Tutor instructions (to be drafted for owner approval in each stage's plan)

Each stage's plan brings the exact instruction text for approval before it
is built. The rules they must carry:

- Commit the answer (and each wrong option's flaw, or the rubric) before the
  learner sees the question; verify it first; never revise it afterwards.
- One question at a time; never reveal the answer before an attempt.
- Grade the reasoning. Right pick, flawed reasoning: miss.
- Free-response: grade each rubric point; all points on a part or it is a
  miss for that topic; say which points were lost and why.
- With a photo: say what was read from it before grading; when unreadable,
  say so and grade the dictation.
- After a miss: correct answer, where the thinking went wrong, then a fresh
  question on the same topic. No hints before an answer.
- Label every question real (with year and number) or generated.
- Never credit self-assessment. Never change the confirmed topic list.

## Left to the builder

- The shape of the course record, the document manifest and the question
  index; routes and page components; how the new session kind is threaded
  through (the list of places Test prep touched is in the reference below).
- The tools the AP tutor is given, their names and schemas, and how the two
  question forms appear in the question dock (multiple-choice with optional
  reasoning already exists there as the quiz form; free text as the explain
  form).
- How course setup is run: which part is the researcher finding links, which
  is a new server-side download into the local paper store, and how the
  proposed unit and topic list is extracted from the description.
- How papers are indexed in the background and how a real question's pages
  are rendered and served to the screen.
- How "Learn" hands the course description to Teach (a path in the opening
  message is readable under the default file-access policy; with a
  restricted policy the local paper store must be an allowed folder, and the
  app should say so instead of failing silently).
- Tests.

## Open risks

- **Topic extraction quality.** Course descriptions differ in layout between
  subjects. The owner's confirmation step is the safeguard.
- **Tagging real question parts to topics** is done by a model and can be
  wrong; a wrong tag moves the wrong topic's status.
- **Generated multiple-choice quality.** A plausible but wrong committed
  answer is the worst failure here; the commit-and-verify rule and web
  verification are the only defences in stage 1.
- **Handwriting.** Photo reading can misread; the read-back step is the
  safeguard.
- **Search allowance.** Course setup uses the search key; a large course's
  paper hunt may use a noticeable share of a month's free searches.
- **Bulk session delete** is designed but not yet wired for Test prep
  records (`forgetChat` has no caller). The AP record needs the same hook and
  should be wired when that work lands.

## Reference: existing code (from recon, not re-verified)

- Session kinds: `src/core/contracts/chat.ts:30` (`ChatKind`); creation
  `app/api/chats/route.ts`; per-turn agent choice
  `src/server/chat-handler.ts:478-564`; factories `src/agent/teacher-agent.ts`;
  prompt composition `src/agent/prompt-segments.ts`.
- Test prep, the model to mirror: `src/core/test-prep.ts` (statuses,
  `applyResult`, `nextQueue`, `readiness`, `mergePlan`), `src/store/tests.ts`,
  `app/api/tests/**`, `app/tests/**`, `components/test-prep/**`,
  `src/agent/tools/test-prep.ts`, `src/agent/prompts/testprep/**`. Files
  containing `testprep`: `app/api/chats/route.ts`, `components/new-session.tsx`,
  `components/home.tsx`, `components/chat.tsx`, `src/server/chat-handler.ts`,
  `src/agent/teacher-agent.ts`, `src/core/contracts/chat.ts`, `src/core/ports.ts`,
  `src/store/chats.ts`.
- Question dock: `src/core/question-core.ts` (`quizInputBase` :158 with
  options and optional thinking; `explainInputBase` :303 free text;
  `buildAnswer` :708 skips committing the verdict for `check_point` :752);
  `components/question-dock.tsx`; `components/answered-card.tsx`.
- Dictation targets the answer field in text mode and the thinking field in
  select mode (`components/question-dock.tsx:349-370`).
- No attach control in the dock; a dropped file becomes a quoted path
  (`components/file-path-drop-zone.tsx`); the native picker is
  `POST /api/path-picker` (`components/attach-files-button.tsx`).
- Images reach the model through `read` (`src/agent/tools/read.ts`); the
  Claude Code bridge passes image parts (`src/agent/claude-code/tool-bridge.ts`).
- PDF: text tools are pure JS (`src/agent/tools/pdf-read.ts`); page rendering
  to PNG is browser-free (`src/agent/subagents/headless.ts:523`
  `renderPdfPages`). No persistent cache exists. `web_fetch_pdf` downloads
  only into a per-job temp folder that is deleted (`runner.ts:370,403`); there
  is no keep-a-download capability today.
- The drawing helper is asynchronous (`src/agent/tools/jobs.ts`
  `VISUAL_ACK`); inline mermaid diagrams render in the same message.
- Data sync is git over `data/` (`scripts/windows/sync-data.ps1`);
  `data/.gitignore` currently excludes only `debug/` and temp files. Image
  snapshots live inside chat JSON and therefore sync.
- Teach sessions begin with the opening assessment; teaching starts after
  `probe_done` (`src/server/chat-handler.ts:427`). A session's first message
  is delivered by the chat page (`components/start-session.ts`,
  `components/test-prep/readiness-view.tsx:62-68`).
- Graph extraction runs for every kind except practice
  (`src/server/chat-handler.ts` ~651).
