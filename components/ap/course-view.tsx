"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { StartSitting } from "@/components/ap/start-sitting";
import { OPENING_PROMPT_FAILURE } from "@/components/opening-prompt";
import { SidebarToggle } from "@/components/sidebar";
import { SessionStarter } from "@/components/start-session";
import { PlanEditor } from "@/components/test-prep/plan-editor";
import { Button } from "@/components/ui/button";
import { quoteFilePath, readiness, readinessPercent } from "@/src/core";
import type { ApCourseRecord, ApDocument, ApSittingScope, PlanDraftSection, PointStatus } from "@/src/core";

/**
 * The AP course page body (AP prep, 2026-11-13).
 *
 * One unit row per unit (title, its solid/total, its percent, Learn and
 * Practise) and one row per official topic (text, status, Learn and
 * Practise), plus the weak-topics button and the official-documents block.
 * The readiness numbers come from the shared count-based rules, exactly as
 * the Test prep readiness page computes them — this page never invents a
 * score.
 *
 * Before the units and topics are confirmed the page is the unconfirmed
 * list: the same editor the chat card uses, confirming through the plan
 * route. No Learn or Practise affordance exists until then (an unconfirmed
 * course has nothing to teach or ask against).
 *
 * Learn opens an ordinary Teach session whose title IS the first message
 * (`learnPrompt`): the course description's absolute local path is the only
 * thing about the paper that enters the session, and only when the paper is
 * on this computer. A missing description is said out loud in the prompt.
 */

const STATUS_LABEL: Record<PointStatus, string> = {
	solid: "solid",
	gap: "gap",
	"fixed-recheck": "re-check next sitting",
	unchecked: "not yet asked",
};

const STATUS_CLASS: Record<PointStatus, string> = {
	solid: "bg-green-500/15 text-green-500",
	gap: "bg-red-500/15 text-red-500",
	"fixed-recheck": "bg-amber-500/15 text-amber-500",
	unchecked: "bg-muted text-muted-foreground",
};

export function learnPrompt(input: {
	courseTitle: string;
	unitTitle: string;
	topicText?: string;
	source?: string;
	cedPath?: string;
}): string {
	const subject =
		input.topicText === undefined
			? input.unitTitle
			: `${input.topicText} (${input.unitTitle})`;
	let prompt = `Teach me ${subject} from ${input.courseTitle}, to the AP syllabus.`;
	if (input.cedPath === undefined) {
		prompt +=
			" The official course description is not on this computer; teach from your own knowledge of the AP syllabus and say so.";
	} else {
		prompt += ` The official course description is ${quoteFilePath(input.cedPath)}.`;
		if (input.source !== undefined) prompt += ` This part is at ${input.source}.`;
	}
	return prompt;
}

function toDraft(sections: ApCourseRecord["sections"]): PlanDraftSection[] {
	return sections.map((section) => ({
		id: section.id,
		title: section.title,
		points: section.points.map((point) => ({ id: point.id, text: point.text, source: point.source })),
	}));
}

function errorText(reason: unknown, fallback: string): string {
	return reason instanceof Error && reason.message !== "" ? reason.message : fallback;
}

/** One course document with its local presence, as the server page hands it. */
export type CourseDocument = ApDocument & { present: boolean };

export function CourseView({
	course: initialCourse,
	documents: initialDocuments,
	cedPath,
	navigate,
}: {
	course: ApCourseRecord;
	documents: CourseDocument[];
	/** The confirmed course description's absolute path, when it is present. */
	cedPath?: string;
	/** Where to go after starting a session; production supplies the router. */
	navigate?: (target: string) => void;
}) {
	const [course, setCourse] = useState(initialCourse);
	const [documents, setDocuments] = useState(initialDocuments);
	const [editing, setEditing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [downloading, setDownloading] = useState(false);
	const [starting, setStarting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [starter] = useState(() => new SessionStarter());
	const go = navigate ?? ((target: string) => window.location.assign(target));

	const ready = readiness(course);
	const totals = ready.sections.reduce(
		(acc, section) => ({ solid: acc.solid + section.solid, total: acc.total + section.total }),
		{ solid: 0, total: 0 },
	);
	const percent = readinessPercent(totals.solid, totals.total);

	async function save(sections: PlanDraftSection[], confirm: boolean): Promise<void> {
		setSaving(true);
		setError(null);
		try {
			const response = await fetch(`/api/ap/${course.id}/plan`, {
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
							: "The units and topics could not be saved.",
				);
			}
			setCourse((await response.json()) as ApCourseRecord);
			setEditing(false);
		} catch (reason) {
			setError(errorText(reason, "The units and topics could not be saved."));
		} finally {
			setSaving(false);
		}
	}

	async function download(): Promise<void> {
		setDownloading(true);
		setError(null);
		try {
			// No body: the stored manifest decides which official URL is fetched.
			const response = await fetch(`/api/ap/${course.id}/documents`, { method: "POST" });
			if (!response.ok) throw new Error("The documents could not be downloaded.");
			const payload = (await response.json()) as {
				documents?: Array<{ id: string; present: boolean; error?: string }>;
			};
			const states = payload.documents ?? [];
			setDocuments((current) =>
				current.map((document) => {
					const state = states.find((candidate) => candidate.id === document.id);
					return state === undefined ? document : { ...document, present: state.present };
				}),
			);
			const failure = states.find((state) => state.error !== undefined);
			if (failure?.error !== undefined) setError(failure.error);
		} catch (reason) {
			setError(errorText(reason, "The documents could not be downloaded."));
		} finally {
			setDownloading(false);
		}
	}

	async function learn(input: { unitTitle: string; topicText?: string; source?: string }): Promise<void> {
		setStarting(true);
		setError(null);
		try {
			const title = learnPrompt({
				courseTitle: course.title,
				...input,
				...(cedPath === undefined ? {} : { cedPath }),
			});
			go(await starter.start({ title }, fetch));
		} catch {
			setStarting(false);
			setError(OPENING_PROMPT_FAILURE);
		}
	}

	return (
		<div className="space-y-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0">
					<h1 className="font-title text-3xl tracking-tight">{course.title}</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Ready:{" "}
						<span className="text-lg font-semibold tabular-nums text-foreground">{percent}%</span>
						{totals.total > 0 && (
							<span>
								{" "}
								· {totals.solid}/{totals.total} topics solid
							</span>
						)}
					</p>
				</div>
				{course.planConfirmed && (
					<div className="shrink-0">
						<Button
							type="button"
							variant="outline"
							size="sm"
							data-testid="edit-units"
							disabled={starting}
							onClick={() => {
								setError(null);
								setEditing((current) => !current);
							}}
						>
							{editing ? "Close editor" : "Edit units and topics"}
						</Button>
					</div>
				)}
			</div>

			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}

			{!course.planConfirmed && (
				<div className="rounded-xl border bg-card p-4">
					<div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Proposed units and topics
					</div>
					<p className="mb-3 text-sm text-muted-foreground">
						Check every topic against your course description — each one shows the page it came
						from. Edit anything that is off, then confirm.
					</p>
					<PlanEditor
						initial={toDraft(course.sections)}
						onSave={save}
						saving={saving}
						submitLabel="Confirm units and topics"
						sectionLabel="unit"
						pointLabel="topic"
					/>
				</div>
			)}

			{course.planConfirmed && editing && (
				<div className="rounded-xl border bg-card p-4">
					<div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Edit units and topics
					</div>
					<PlanEditor
						initial={toDraft(course.sections)}
						onSave={save}
						saving={saving}
						submitLabel="Save units and topics"
						sectionLabel="unit"
						pointLabel="topic"
					/>
				</div>
			)}

			<div data-testid="course-units" className="space-y-3">
				{ready.sections.map((section) => {
					const sectionPercent = readinessPercent(section.solid, section.total);
					const points = course.sections.find((entry) => entry.id === section.id)?.points ?? [];
					const unitScope: ApSittingScope = { type: "unit", unitId: section.id };
					return (
						<div key={section.id} data-testid={`unit-${section.id}`} className="rounded-xl border bg-card p-4">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="min-w-0">
									<div className="text-sm font-medium">{section.title}</div>
									<div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
										{section.solid}/{section.total} topics solid ·{" "}
										{sectionPercent}%
									</div>
								</div>
								{course.planConfirmed && (
									<div className="flex shrink-0 flex-wrap gap-2">
										<Button
											type="button"
											variant="ghost"
											size="sm"
											data-testid={`learn-unit-${section.id}`}
											disabled={starting}
											onClick={() =>
												void learn({
													unitTitle: section.title,
												})
											}
										>
											Learn
										</Button>
										<StartSitting
											course={course}
											scope={unitScope}
											testId={`practise-unit-${section.id}`}
											navigate={go}
										/>
									</div>
								)}
							</div>
							<div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
								<div
									className="h-full rounded-full bg-green-500 transition-[width]"
									style={{ width: `${sectionPercent}%` }}
								/>
							</div>

							{points.length === 0 ? (
								<p className="mt-3 text-sm text-muted-foreground">This unit has no topics yet.</p>
							) : (
								<ul className="mt-3 space-y-2">
									{points.map((point) => (
										<li
											key={point.id}
											data-testid={`topic-${point.id}`}
											className="flex flex-wrap items-center justify-between gap-2"
										>
											<span className="min-w-0 text-sm">{point.text}</span>
											<div className="flex shrink-0 items-center gap-2">
												<span
													data-testid="topic-status"
													className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLASS[point.status]}`}
												>
													{STATUS_LABEL[point.status]}
												</span>
												{course.planConfirmed && (
													<>
														<Button
															type="button"
															variant="ghost"
															size="sm"
															data-testid={`learn-topic-${point.id}`}
															disabled={starting}
															onClick={() =>
																void learn({
																	unitTitle: section.title,
																	topicText: point.text,
																	source: point.source,
																})
															}
														>
															Learn
														</Button>
														<StartSitting
															course={course}
															scope={{ type: "topic", topicId: point.id }}
															testId={`practise-topic-${point.id}`}
															navigate={go}
														/>
													</>
												)}
											</div>
										</li>
									))}
								</ul>
							)}
						</div>
					);
				})}
			</div>

			{course.planConfirmed && (
				<div>
					<StartSitting
						course={course}
						scope={{ type: "weak" }}
						testId="practise-weak"
						label="Practise weak topics"
						navigate={go}
					/>
				</div>
			)}

			{documents.length > 0 && (
				<div data-testid="course-documents" className="rounded-xl border bg-card p-4">
					<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Official documents
					</div>
					<ul className="space-y-2">
						{documents.map((document) => (
							<li key={document.id} className="flex flex-wrap items-center justify-between gap-2">
								<span className="min-w-0 text-sm">{document.label}</span>
								{document.present ? null : (
									<div className="flex shrink-0 items-center gap-2">
										<span className="text-xs text-muted-foreground">Missing on this computer</span>
										<Button
											type="button"
											variant="outline"
											size="sm"
											data-testid={`download-${document.id}`}
											disabled={downloading}
											onClick={() => void download()}
										>
											Download
										</Button>
									</div>
								)}
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

/** The routed course page body: the app router is the only Next coupling,
 *  kept out so CourseView renders in tests and previews. */
export function CoursePage({
	course,
	documents,
	cedPath,
}: {
	course: ApCourseRecord;
	documents: CourseDocument[];
	cedPath?: string;
}) {
	const router = useRouter();
	return (
		<div className="relative flex h-dvh flex-col">
			<header className="flex h-15 shrink-0 items-center gap-2 border-b border-border px-3">
				<SidebarToggle />
				<Link
					href="/ap"
					className="text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
				>
					AP
				</Link>
			</header>
			<main className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-3xl px-6 py-8">
					<CourseView
						course={course}
						documents={documents}
						{...(cedPath === undefined ? {} : { cedPath })}
						navigate={(target) => router.push(target)}
					/>
				</div>
			</main>
		</div>
	);
}