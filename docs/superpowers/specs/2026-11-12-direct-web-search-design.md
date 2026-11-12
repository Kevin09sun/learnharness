# Direct web search for the tutors — design

Status: approved by the owner on 2026-11-12. First of two pieces; the AP prep mode is
designed separately afterwards and builds on this.

## Intent

The owner wants to use LearnHarness to learn and practise AP content and needs
the tutor to get current information from the web. Today only the background
researcher can search: the tutor dispatches a `research` job and the findings
arrive later as a separate message. The owner wants the tutor to look things up
itself, inside the reply being written, with sources.

## Goals

- Every conversation tutor (Teach, the opening assessment, Practice, Test prep)
  can search the web and read a page during its own turn.
- Looked-up claims carry their source link in the reply.
- A "Web search" switch in Settings, on by default, independent of the
  existing research switch.
- Honest behaviour when search is not set up.

## Non-goals

- Changing the background `research` job. It stays as it is and remains the
  route for long jobs and for reading PDFs on the web.
- A browser, logged-in pages, or anything beyond search plus page reading.
- Saving or caching search results, or a usage/quota meter.
- Any AP-specific behaviour.

## Anti-goals (a failure even if it "works")

- The tutor presenting something as checked against the web when it was not.
- Test prep using the web to decide what a test covers. Its rule stands:
  scope comes from the learner's outline or slides, or from asking them.
- Replies becoming slow because the tutor searches for things it knows.

## Approaches

1. **Hand the existing `web_search` and `web_fetch` tools to the tutors
   (chosen).** They already exist for the researcher
   (`src/agent/tools/web.ts`, `createWebTools`), with the search service
   injected from `src/server/search.ts`. A tool in a tutor's list reaches the
   Claude Code route automatically through the app's tool bridge.
2. Make the tutor wait for the researcher to finish. Rejected: every lookup
   becomes a multi-step sub-agent run on the cheaper model, and the tutor sees
   only a summary, not the page.
3. Turn on each model provider's own built-in search. Rejected: it works on
   some model routes and not others, and the app deliberately switches
   provider built-in tools off.

The owner chose "direct, in the reply" in conversation; approach 1 is the only
one that delivers that on every model route.

## Behaviour (owner-decided)

- **Scope:** all four tutors get both tools.
- **Switch:** a "Web search" switch beside the research, demo, drawing and PDF
  switches. On by default. Off removes both tools from every tutor and leaves
  background research untouched.
- **No working key:** with the switch on and no search key saved, the tutor
  can still read a page (a pasted link, a known official page) but cannot
  search. When it needed a search it tells the learner search is not set up
  and points to Settings, and does not answer as though it had checked.
- **When to search unprompted:** when it is not certain of a fact, when the
  answer may have changed recently (exam format, dates, syllabus), or when the
  learner asks. Things it knows well it teaches without searching.
- **Search service:** the owner will create a Tavily key and paste it into
  Settings → Keys. No code is Tavily-specific; all five supported services
  behave the same.

## Tutor instructions (proposed wording, owner to approve)

One new shared fragment, included for all four tutors:

> **Web lookups.** You can search the web with `web_search` and read a page
> with `web_fetch`. Use them when you are not certain of a fact, when the
> answer may have changed recently, or when the learner asks you to look
> something up. Do not search for what you know well. Search with a few
> focused queries, read the most authoritative result rather than relying on
> the snippet, and prefer primary and official sources. Give the source as a
> link next to each claim you took from the web. If `web_search` reports that
> search is not set up, tell the learner so and that a key can be added in
> Settings; do not present an unchecked claim as checked. For a PDF on the
> web, or a lookup needing many pages, dispatch `research` instead.

Added to the Test prep doctrine:

> Web lookups are for verifying facts and committed answers. Never use the web
> to decide what the test covers.

## Decided by Claude (owner can override)

- The switch is stored under the key `web` alongside the existing toggle keys
  and governs both tools together.
- No hard limit on searches per reply in code; the instruction wording
  ("a few focused queries") is the only brake.
- While a lookup runs, the chat shows it the same way other non-question tool
  calls are shown today; no new visual treatment.
- The "search is not set up" tool message, currently worded for the
  researcher ("Report in your brief…"), is reworded so it reads correctly for
  both the researcher and a tutor.
- Test prep and Practice must honour the new switch. Test prep does not
  currently apply the Settings switches to its tool list at all; this work
  makes it apply the `web` switch only and leaves its other tools as they are.
- The stale comment in `src/server/chat-handler.ts` claiming that no search
  engine removes the `research` tool is corrected.

## Left to the builder

- The fragment's file name and number, and how it joins each tutor's fragment
  list (`src/agent/prompt-segments.ts`).
- Passing the search service into each tool list: Teach and the assessment
  (`src/agent/tools.ts`), Practice (`src/agent/tools/practice.ts`), Test prep
  (`src/agent/tools/test-prep.ts`), from `src/server/chat-handler.ts`.
- Where the switch is declared (`src/core/pending.ts`, `TOGGLEABLE_TOOLS`) and
  rendered (`components/settings/agent-section.tsx`).
- Confirming that a page-sized tool result (up to 40,000 characters) passes
  through the Claude Code route intact.
- Tests, following the existing `tests/web-search.test.ts`.

## Constraints

- Follow `AGENTS.md`: read the relevant guide in `node_modules/next/dist/docs/`
  before touching any Next.js route or page.
- Reuse `createWebTools` and `searchProvider`; no second search path.

## Reference: existing code (from recon, not re-verified)

- `src/agent/tools/web.ts` — `createWebTools(search)`; `web_search`
  `{query, count 1–10}`; `web_fetch {url}` with a 30 s timeout, 5 MB limit and
  40,000-character truncation; PDF links redirect to `web_fetch_pdf`, which
  only the researcher has.
- `src/server/search.ts` — `searchProvider()`, `searchAvailable()`; a saved
  key activates its service automatically.
- `src/agent/subagents/researcher.ts:95` — the only current user of the tools.
- `src/core/pending.ts:93` — `TOGGLEABLE_TOOLS = ["research","demo","visual","pdf"]`.
- `src/agent/claude-code/tool-bridge.ts:224` — every tool in a tutor's list is
  allowed on the Claude Code route without a separate list.
- `src/core/auth-keys.ts`, `components/settings/keys-section.tsx` — where a
  search key is entered; written to `auth.json`.
