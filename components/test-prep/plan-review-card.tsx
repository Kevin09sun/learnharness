"use client";

import { useContext, useEffect, useState } from "react";

import { ChatActionsContext } from "@/components/chat";
import { PlanEditor } from "@/components/test-prep/plan-editor";
import type { ArtifactPartProps, LhViewMessage, PlanDraftSection, TestRecord } from "@/src/core";

/**
 * The plan-review card (test prep, 2026-11-10): the `propose_plan` artifact.
 *
 * It renders the LATEST test record, never the tool call's arguments — a
 * draft the learner already edited (or a plan confirmed in an earlier turn)
 * must not snap back to the model's original proposal. The record arrives
 * through the session: ChatActionsContext gives the chat id (the demo card's
 * seam), the chat record carries `testId`, and GET /api/tests/[id]/plan
 * serves the saved record.
 *
 * Each point shows the outline line/slide it came from in muted text, so
 * missing coverage is easy to spot. Editing lives in PlanEditor (reused by
 * the readiness view). Confirm sends ONE PUT (confirm:true) and then ONE
 * learner message through the session's normal send path, which lets the
 * agent move on to the first sitting. A confirmed plan collapses to a
 * summary with a link back to the readiness page.
 *
 * Revisions: a later propose_plan supersedes every earlier proposal. Only
 * the latest propose_plan part may show the editor/Confirm while the plan is
 * unconfirmed (the record is the single latest saved revision, so an earlier
 * card showing it would let the learner "confirm" a scope that no longer
 * matches its own message); earlier parts collapse to one muted line.
 */

/** The latest propose_plan call in the session view, or null when the
 *  context has no view (tests/previews keep the card interactive). */
function latestProposePlanCallId(messages: readonly LhViewMessage[] | undefined): string | null {
	if (!messages) return null;
	for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
		const parts = messages[messageIndex]?.parts ?? [];
		for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
			const candidate = parts[partIndex];
			// Only a SETTLED call saved a revision; a failed/interrupted call
			// (output-error, input-available) never superseded the record.
			if (
				candidate?.type === "tool-propose_plan" &&
				candidate.state === "output-available" &&
				typeof candidate.toolCallId === "string"
			) {
				return candidate.toolCallId;
			}
		}
	}
	return null;
}

function toDraft(sections: TestRecord["sections"]): PlanDraftSection[] {
	return sections.map((section) => ({
		id: section.id,
		title: section.title,
		points: section.points.map((point) => ({ id: point.id, text: point.text, source: point.source })),
	}));
}

function errorText(reason: unknown, fallback: string): string {
	return reason instanceof Error && reason.message !== "" ? reason.message : fallback;
}

export function PlanReviewCard({ part }: ArtifactPartProps) {
	const actions = useContext(ChatActionsContext);
	const chatId = actions?.chatId;
	const [record, setRecord] = useState<TestRecord | null>(null);
	const [testId, setTestId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!chatId) {
			setLoading(false);
			return;
		}
		let alive = true;
		(async () => {
			try {
				const chatResponse = await fetch(`/api/chats/${chatId}`);
				if (!chatResponse.ok) throw new Error("Could not load this session.");
				const chat = (await chatResponse.json()) as { testId?: unknown };
				if (typeof chat.testId !== "string" || chat.testId === "") {
					throw new Error("This session is not linked to a test.");
				}
				if (!alive) return;
				setTestId(chat.testId);

				const recordResponse = await fetch(`/api/tests/${chat.testId}/plan`);
				if (!recordResponse.ok) throw new Error("Could not load the test plan.");
				const loaded = (await recordResponse.json()) as TestRecord;
				if (alive) setRecord(loaded);
			} catch (reason) {
				if (alive) setError(errorText(reason, "Could not load the test plan."));
			} finally {
				if (alive) setLoading(false);
			}
		})();
		return () => {
			alive = false;
		};
	}, [chatId]);

	const latestProposalId = latestProposePlanCallId(actions?.messages);
	const isLatestProposal = latestProposalId === null || latestProposalId === part.toolCallId;

	async function save(sections: PlanDraftSection[], confirm: boolean): Promise<void> {
		if (!testId) return;
		setSaving(true);
		setError(null);
		try {
			const response = await fetch(`/api/tests/${testId}/plan`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sections, confirm }),
			});
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as {
					problems?: unknown;
					error?: unknown;
				} | null;
				const problems = Array.isArray(payload?.problems)
					? payload.problems.filter((problem): problem is string => typeof problem === "string")
					: [];
				throw new Error(
					problems.length > 0
						? problems.join(" ")
						: typeof payload?.error === "string"
							? payload.error
							: "The plan could not be saved.",
				);
			}
			const saved = (await response.json()) as TestRecord;
			setRecord(saved);
			if (confirm) actions?.sendText("I've confirmed the plan.");
		} catch (reason) {
			setError(errorText(reason, "The plan could not be saved."));
		} finally {
			setSaving(false);
		}
	}

	// A tool part that has not finished has no saved plan to show yet.
	if (part.state !== "output-available" || !chatId) return null;

	if (loading) {
		return (
			<div data-testid="plan-review-card" className="my-1 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
				Loading the plan…
			</div>
		);
	}

	if (!record) {
		return (
			<div data-testid="plan-review-card" className="my-1 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
				{error ?? "The plan is unavailable."}
			</div>
		);
	}

	if (!isLatestProposal) {
		return (
			<div data-testid="plan-superseded" className="my-1 px-1 text-sm text-muted-foreground/70">
				This plan was revised below.
			</div>
		);
	}

	if (record.planConfirmed) {
		const points = record.sections.reduce((total, section) => total + section.points.length, 0);
		return (
			<div data-testid="plan-confirmed" className="my-1 rounded-xl border bg-card p-4">
				<div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Plan confirmed
				</div>
				<div className="text-[15px] font-medium">{record.title}</div>
				<div className="mt-0.5 text-sm text-muted-foreground">
					{record.sections.length} {record.sections.length === 1 ? "section" : "sections"} · {points}{" "}
					{points === 1 ? "point" : "points"}
				</div>
				<a
					href={`/tests/${record.id}`}
					className="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
				>
					Open readiness
				</a>
			</div>
		);
	}

	return (
		<div data-testid="plan-review-card" className="my-1 rounded-xl border bg-card p-4">
			<div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Proposed plan</div>
			<p className="mb-3 text-sm text-muted-foreground">
				Check every point against your outline — each one shows the line or slide it came from. Edit
				anything that is off, then confirm.
			</p>
			<PlanEditor initial={toDraft(record.sections)} onSave={save} saving={saving} />
			{error && <p className="mt-2 text-sm text-red-500">{error}</p>}
		</div>
	);
}