"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { OPENING_PROMPT_FAILURE } from "@/components/opening-prompt";
import { SidebarToggle } from "@/components/sidebar";
import { SessionStarter } from "@/components/start-session";
import { PlanEditor } from "@/components/test-prep/plan-editor";
import { Button } from "@/components/ui/button";
import { readiness, readinessPercent } from "@/src/core";
import type { PlanDraftSection, PointStatus, TestRecord } from "@/src/core";

/**
 * The readiness view (test prep, 2026-11-10) — option B of the approved
 * mockup: the test's name, one overall "Ready: N%" (the shared count-based
 * rule, never a rounded-up score), and one bar per section showing its
 * solid/total counts. Opening a section reveals its points and each one's
 * status badge.
 *
 * Two actions live here. "Edit plan" reuses PlanEditor on the confirmed
 * plan: a save always confirms (confirm:true through PUT /api/tests/[id]/plan)
 * so the learner never loses the ability to answer. "Continue where I left
 * off" creates the next testprep sitting through the ordinary new-session
 * flow — POST /api/chats {kind:"testprep", testId}, then navigate — with
 * "Continue." as its first message, delivered the normal way.
 */

const STATUS_LABEL: Record<PointStatus, string> = {
	solid: "Solid",
	gap: "Gap",
	"fixed-recheck": "Re-check next time",
	unchecked: "Not checked yet",
};

/** The existing status register (answered-card / practice-cards): green for
 *  right, red for a gap, amber for fixed-but-unverified, muted for untried.
 *  The /15 fills read correctly in both themes. */
const STATUS_CLASS: Record<PointStatus, string> = {
	solid: "bg-green-500/15 text-green-500",
	gap: "bg-red-500/15 text-red-500",
	"fixed-recheck": "bg-amber-500/15 text-amber-500",
	unchecked: "bg-muted text-muted-foreground",
};

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

/** Create the next sitting for an existing test. The opening message is
 *  the ordinary first message ("Continue."), stashed and delivered by the
 *  chat page exactly like a Teach/Practice draft send. */
export async function continueSession(
	testId: string,
	fetchLike: typeof fetch,
	starter = new SessionStarter(),
): Promise<string> {
	return starter.start({ title: "Continue.", kind: "testprep", testId }, fetchLike);
}

export function ReadinessView({
	test: initialTest,
	navigate,
}: {
	test: TestRecord;
	/** Where to go after starting the next sitting. Production supplies the
	 *  app router; the shell seam keeps the view renderable without one. */
	navigate?: (target: string) => void;
}) {
	const [test, setTest] = useState<TestRecord>(initialTest);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
	const [editing, setEditing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [starting, setStarting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const ready = readiness(test);
	const totals = ready.sections.reduce(
		(acc, section) => ({ solid: acc.solid + section.solid, total: acc.total + section.total }),
		{ solid: 0, total: 0 },
	);
	const percent = readinessPercent(totals.solid, totals.total);

	const go = navigate ?? ((target: string) => window.location.assign(target));

	function toggleSection(id: string): void {
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	async function save(sections: PlanDraftSection[]): Promise<void> {
		setSaving(true);
		setError(null);
		try {
			const response = await fetch(`/api/tests/${test.id}/plan`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				// A readiness edit is always a confirmed plan: the learner is
				// refining scope mid-course, never re-proposing from scratch.
				body: JSON.stringify({ sections, confirm: true }),
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
			setTest((await response.json()) as TestRecord);
			setEditing(false);
		} catch (reason) {
			setError(errorText(reason, "The plan could not be saved."));
		} finally {
			setSaving(false);
		}
	}

	async function start(): Promise<void> {
		if (starting) return;
		setStarting(true);
		setError(null);
		try {
			go(await continueSession(test.id, fetch));
		} catch {
			setStarting(false);
			setError(OPENING_PROMPT_FAILURE);
		}
	}

	return (
		<div className="space-y-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0">
					<h1 className="font-title text-3xl tracking-tight">{test.title}</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Ready:{" "}
						<span className="text-lg font-semibold tabular-nums text-foreground">{percent}%</span>
						{totals.total > 0 && (
							<span>
								{" "}
								· {totals.solid}/{totals.total} points solid
							</span>
						)}
					</p>
				</div>
				<div className="flex shrink-0 flex-wrap gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						data-testid="edit-plan"
						disabled={starting}
						onClick={() => {
							setError(null);
							setEditing((current) => !current);
						}}
					>
						{editing ? "Close editor" : "Edit plan"}
					</Button>
					<Button
						type="button"
						size="sm"
						data-testid="continue-test"
						disabled={starting}
						onClick={() => void start()}
					>
						{starting ? "Starting…" : "Continue where I left off"}
					</Button>
				</div>
			</div>

			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}

			{editing && (
				<div className="rounded-xl border bg-card p-4">
					<div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Edit plan
					</div>
					<PlanEditor
						initial={toDraft(test.sections)}
						onSave={save}
						saving={saving}
						submitLabel="Save plan"
					/>
				</div>
			)}

			<div data-testid="readiness-sections" className="space-y-3">
				{ready.sections.map((section) => {
					const open = expanded.has(section.id);
					const sectionPercent = readinessPercent(section.solid, section.total);
					// readiness() carries the counts; the points (with their
					// statuses) live on the record, matched by the shared id.
					const points = test.sections.find((entry) => entry.id === section.id)?.points ?? [];
					return (
						<div key={section.id} className="rounded-xl border bg-card p-4">
							<button
								type="button"
								data-testid={`readiness-section-${section.id}`}
								aria-expanded={open}
								onClick={() => toggleSection(section.id)}
								className="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
							>
								<span className="text-sm font-medium">{section.title}</span>
								<span className="shrink-0 text-xs tabular-nums text-muted-foreground">
									{section.solid}/{section.total}
								</span>
							</button>
							<div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
								<div
									className="h-full rounded-full bg-green-500 transition-[width]"
									style={{ width: `${sectionPercent}%` }}
								/>
							</div>
							{open &&
								(points.length === 0 ? (
									<p className="mt-3 text-sm text-muted-foreground">
										This section has no points yet.
									</p>
								) : (
									<ul className="mt-3 space-y-2">
										{points.map((point) => (
											<li key={point.id} className="flex items-start justify-between gap-3">
												<span className="min-w-0 text-sm">{point.text}</span>
												<span
													data-testid="point-status"
													className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLASS[point.status]}`}
												>
													{STATUS_LABEL[point.status]}
												</span>
											</li>
										))}
									</ul>
								))}
						</div>
					);
				})}
			</div>

			{test.sections.length === 0 && (
				<p className="text-sm text-muted-foreground">
					No plan yet — the agent proposes one in your first sitting.
				</p>
			)}
		</div>
	);
}

/** The routed readiness page body: the app router is the only Next coupling,
 *  kept out of ReadinessView so the view renders in tests and previews. */
export function ReadinessPage({ test }: { test: TestRecord }) {
	const router = useRouter();
	return (
		<div className="relative flex h-dvh flex-col">
			<header className="flex h-15 shrink-0 items-center gap-2 border-b border-border px-3">
				<SidebarToggle />
				<Link
					href="/tests"
					className="text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
				>
					Tests
				</Link>
			</header>
			<main className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-3xl px-6 py-8">
					<ReadinessView test={test} navigate={(target) => router.push(target)} />
				</div>
			</main>
		</div>
	);
}