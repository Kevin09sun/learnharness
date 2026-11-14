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
 *
 * AP (2026-11-13) reuses the whole behaviour through `config`: the words
 * become unit/topic, the chat link field is `apCourseId`, and the endpoints
 * live under /api/ap and /ap. The default config is exactly Test prep's
 * rendering.
 */

/** The record shape both records share — the fields this card renders. */
type PlanRecord = Pick<TestRecord, "id" | "title" | "planConfirmed" | "sections">;

export interface PlanReviewConfig {
	/** The tool whose settled parts are the proposals. */
	toolName: string;
	/** The chat record field carrying the linked record's id. */
	chatKey: "testId" | "apCourseId";
	/** e.g. "/api/tests" — the record's plan route base. */
	apiBase: string;
	/** e.g. "/tests" — the record's page base. */
	pageBase: string;
	sectionLabel: string;
	pointLabel: string;
	submitLabel: string;
	proposedTitle: string;
	confirmedTitle: string;
	openPage: string;
	superseded: string;
	loading: string;
	notLinked: string;
	loadError: string;
	unavailable: string;
	saveError: string;
	confirmMessage: string;
	instruction: string;
	/** Optional last look at the draft before it is PUT. Test prep leaves it
	 *  unset; the AP card fills a learner-added topic's missing source. */
	prepareDraft?: (sections: PlanDraftSection[]) => PlanDraftSection[];
}

export const TEST_PREP_PLAN_CONFIG: PlanReviewConfig = {
	toolName: "propose_plan",
	chatKey: "testId",
	apiBase: "/api/tests",
	pageBase: "/tests",
	sectionLabel: "section",
	pointLabel: "point",
	submitLabel: "Confirm plan",
	proposedTitle: "Proposed plan",
	confirmedTitle: "Plan confirmed",
	openPage: "Open readiness",
	superseded: "This plan was revised below.",
	loading: "Loading the plan…",
	notLinked: "This session is not linked to a test.",
	loadError: "Could not load the test plan.",
	unavailable: "The plan is unavailable.",
	saveError: "The plan could not be saved.",
	confirmMessage: "I've confirmed the plan.",
	instruction:
		"Check every point against your outline — each one shows the line or slide it came from. Edit anything that is off, then confirm.",
};

/** The latest proposal call in the session view, or null when the context
 *  has no view (tests/previews keep the card interactive). */
function latestProposalCallId(
	messages: readonly LhViewMessage[] | undefined,
	toolName: string,
): string | null {
	if (!messages) return null;
	for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
		const parts = messages[messageIndex]?.parts ?? [];
		for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
			const candidate = parts[partIndex];
			// Only a SETTLED call saved a revision; a failed/interrupted call
			// (output-error, input-available) never superseded the record.
			if (
				candidate?.type === `tool-${toolName}` &&
				candidate.state === "output-available" &&
				typeof candidate.toolCallId === "string"
			) {
				return candidate.toolCallId;
			}
		}
	}
	return null;
}

type PlanSections = TestRecord["sections"];

function toDraft(sections: PlanSections): PlanDraftSection[] {
	return sections.map((section) => ({
		id: section.id,
		title: section.title,
		points: section.points.map((point) => ({ id: point.id, text: point.text, source: point.source })),
	}));
}

function errorText(reason: unknown, fallback: string): string {
	return reason instanceof Error && reason.message !== "" ? reason.message : fallback;
}

function countLine(config: PlanReviewConfig, sections: number, points: number): string {
	return `${sections} ${sections === 1 ? config.sectionLabel : `${config.sectionLabel}s`} · ${points} ${
		points === 1 ? config.pointLabel : `${config.pointLabel}s`
	}`;
}

export function PlanReviewCard({
	part,
	config = TEST_PREP_PLAN_CONFIG,
}: ArtifactPartProps & { config?: PlanReviewConfig }) {
	const actions = useContext(ChatActionsContext);
	const chatId = actions?.chatId;
	const [record, setRecord] = useState<PlanRecord | null>(null);
	const [linkedId, setLinkedId] = useState<string | null>(null);
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
				const chat = (await chatResponse.json()) as Record<string, unknown>;
				const id = chat[config.chatKey];
				if (typeof id !== "string" || id === "") {
					throw new Error(config.notLinked);
				}
				if (!alive) return;
				setLinkedId(id);

				const recordResponse = await fetch(`${config.apiBase}/${id}/plan`);
				if (!recordResponse.ok) throw new Error(config.loadError);
				const loaded = (await recordResponse.json()) as PlanRecord;
				if (alive) setRecord(loaded);
			} catch (reason) {
				if (alive) setError(errorText(reason, config.loadError));
			} finally {
				if (alive) setLoading(false);
			}
		})();
		return () => {
			alive = false;
		};
	}, [chatId, config]);

	const latestProposalId = latestProposalCallId(actions?.messages, config.toolName);
	const isLatestProposal = latestProposalId === null || latestProposalId === part.toolCallId;

	async function save(sections: PlanDraftSection[], confirm: boolean): Promise<void> {
		if (!linkedId) return;
		setSaving(true);
		setError(null);
		try {
			const draft = config.prepareDraft ? config.prepareDraft(sections) : sections;
			const response = await fetch(`${config.apiBase}/${linkedId}/plan`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sections: draft, confirm }),
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
							: config.saveError,
				);
			}
			const saved = (await response.json()) as PlanRecord;
			setRecord(saved);
			if (confirm) actions?.sendText(config.confirmMessage);
		} catch (reason) {
			setError(errorText(reason, config.saveError));
		} finally {
			setSaving(false);
		}
	}

	// A tool part that has not finished has no saved plan to show yet.
	if (part.state !== "output-available" || !chatId) return null;

	if (loading) {
		return (
			<div data-testid="plan-review-card" className="my-1 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
				{config.loading}
			</div>
		);
	}

	if (!record) {
		return (
			<div data-testid="plan-review-card" className="my-1 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
				{error ?? config.unavailable}
			</div>
		);
	}

	if (!isLatestProposal) {
		return (
			<div data-testid="plan-superseded" className="my-1 px-1 text-sm text-muted-foreground/70">
				{config.superseded}
			</div>
		);
	}

	if (record.planConfirmed) {
		const points = record.sections.reduce((total, section) => total + section.points.length, 0);
		return (
			<div data-testid="plan-confirmed" className="my-1 rounded-xl border bg-card p-4">
				<div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{config.confirmedTitle}
				</div>
				<div className="text-[15px] font-medium">{record.title}</div>
				<div className="mt-0.5 text-sm text-muted-foreground">
					{countLine(config, record.sections.length, points)}
				</div>
				<a
					href={`${config.pageBase}/${record.id}`}
					className="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
				>
					{config.openPage}
				</a>
			</div>
		);
	}

	return (
		<div data-testid="plan-review-card" className="my-1 rounded-xl border bg-card p-4">
			<div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{config.proposedTitle}
			</div>
			<p className="mb-3 text-sm text-muted-foreground">{config.instruction}</p>
			<PlanEditor
				initial={toDraft(record.sections)}
				onSave={save}
				saving={saving}
				submitLabel={config.submitLabel}
				sectionLabel={config.sectionLabel}
				pointLabel={config.pointLabel}
			/>
			{error && <p className="mt-2 text-sm text-red-500">{error}</p>}
		</div>
	);
}