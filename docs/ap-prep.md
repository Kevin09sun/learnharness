# AP prep mode

AP prep is the fourth session type, alongside Teach, Practice and Test prep. It is built around a named AP course: the agent builds the course's units and official topics from College Board's Course and Exam Description, teaches any topic with the ordinary Teach mode, asks newly written multiple-choice questions, and tracks readiness per unit and course with a status per topic across sittings.

Use it when you are preparing for an AP exam and want practice that judges your reasoning, not only your final answer.

## Add a course

1. Choose **AP** where you choose Teach, Practice or Test prep.
2. Type the course name (for example, "AP Calculus BC") and send it. Starting a course asks for the name only — there is nothing to attach yet.

The agent finds the course's current official Course and Exam Description on a College Board site, saves it to this computer, and reads it a few pages at a time. It then proposes the course's units, each holding the official numbered topics it covers. Every topic shows the course-description page it came from, in smaller text under it, so you can audit coverage.

If the agent finds the wrong document, or cannot find one, say so in the setup chat. You can paste a College Board link or attach the PDF there, and the agent works from that instead. It never builds the list from general knowledge or from a site that is not College Board's.

## Confirm the units and topics

The proposed list appears as a card in the conversation. In the card you can:

- edit a unit title or a topic's text in place;
- remove a unit or a topic;
- add topics to a unit, or add a new unit.

Then choose **Confirm units and topics**. Confirming saves the list and the card collapses to a summary with a link to the course page. Nothing can be practised until the list is confirmed.

A topic you add yourself has no page in the course description. It is saved with the source **Added by you**, and Learn teaches it without a page reference.

## The course page

Open **AP** in the sidebar to see every course, or open a course directly. The course page shows:

- the course name and **Ready: N%**, with the number of solid topics out of the total;
- one row per unit with its own solid/total count, percent and progress bar;
- each unit's topics with their status and its **Learn** and **Practise** buttons;
- **Practise weak topics** for a sitting across units.

Each topic has one of four statuses:

| Status | Meaning |
| --- | --- |
| `solid` | Answered correctly, unaided, for the right reasons. |
| `gap` | The last answer was a miss. |
| `re-check next sitting` | Missed, then answered correctly later in the same sitting. It must be answered correctly again in a **later** sitting before it counts as solid. |
| `not yet asked` | No practice answer yet. |

A solid topic that is later missed becomes a gap again. Readiness is solid topics divided by all topics, both per unit and overall; 100% is reserved for every topic being solid, and other percentages round down. Learning never changes readiness.

## Start a sitting

**Practise** asks two things. The **scope** is whichever button opened it: a single topic, one whole unit, or **Practise weak topics** across units. The chooser then asks the question **kind**:

- **Multiple-choice** starts the sitting.
- **Free-response** and **Mixed** are shown but cannot be selected; each says `multiple-choice only for now`.

Each sitting is its own session. Within the scope, topics are ordered weak-first: re-checks first, then topics not yet asked, then remaining gaps. A single-topic sitting asks several different questions on that topic.

## How questions work

In this stage every question is newly written by the agent and multiple-choice. It is modelled on the official sample questions for the topic's unit in the course description, and tests one topic. Each card is labelled **AP · generated**.

Pick an option. You may also type or dictate your reasoning; the field is **YOUR REASONING (optional)**.

- A bare pick is graded right or wrong.
- With reasoning, the agent judges both. **A right pick reached by flawed reasoning counts as a miss.**
- "I don't know" counts as a miss, and so does asking for a hint, for help, or for the answer before answering.

The card shows no verdict: the app does not mark an option right or wrong, does not reveal the correct option, and shows no confidence slider. The agent's reply is the verdict.

## After an answer

- **Correct:** the agent says only that it is right and moves on. It does not explain a correct answer.
- **Miss or "I don't know":** the agent gives the correct answer, pinpoints where the reasoning went wrong, and asks a **fresh** question on the same topic straight away. The diagnosis appears with the fresh question. That immediate retry never makes the topic solid. If the fresh question is missed too, the agent tries a different angle.

Only an answered question moves a topic.

## Learn

**Learn** on a unit or a topic opens an ordinary Teach session, with its opening message naming the course and the unit or topic. When the course description is on this computer, the message points to it as reference material. When it is not, the agent says so and teaches from its own knowledge of the AP syllabus.

Teach runs unchanged, including its opening assessment. Learning never changes readiness.

## Edit the units and topics later

**Edit units and topics** on the course page reopens the same editor on the confirmed list. Saving confirms the list again, so practice can continue immediately.

- An edited or reordered topic keeps its status and history.
- A new topic starts `not yet asked`.
- A removed topic's history is dropped.

## Official documents and this computer

The course record holds the units, topics, statuses, answer history and the list of official documents, and syncs with the rest of your learning data at `data/ap/<id>.json`. The PDFs themselves do not sync: they stay on this computer under `data/ap-papers/<courseId>/`, and `ap-papers/` is excluded in `data/.gitignore`.

A course opened on another computer therefore has its progress intact but not its documents. The course page shows **Missing on this computer** beside a missing document, with a **Download** button that fetches it again. Downloads come only from College Board sites.

## Later stages

This stage covers courses, multiple-choice practice, readiness and Learn. Free-response practice, with real released questions graded against the official scoring guidelines, comes in a later stage, as do figures: stage 1 questions use text, tables, mathematical notation and inline diagrams only, with no drawn figures.

## Where progress is stored

Each course's units, topics, statuses and per-topic history are stored under the data directory at `data/ap/<id>.json`. AP sessions also contribute to the knowledge graph like Teach sessions: the ideas the material covers become graph material for later sessions. Only ideas go in. Statuses, answer correctness, and readiness never do.
