"use client";

import { XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PlanDraftSection } from "@/src/core";

/**
 * The plan editor (test prep, 2026-11-10): section titles and point text are
 * inline-editable; points can be added or removed and sections can be added.
 * Each point's `source` stays visible in muted text — the learner audits
 * coverage against the outline, so it is provenance, not an editable field.
 *
 * Ids are the merge contract: every existing section/point carries its id
 * into the draft sent to onSave, so mergePlan keeps its status/history. New
 * sections and points are sent without ids and are minted by the store.
 *
 * PlanReviewCard confirms through this editor; Task 8's readiness view
 * reuses it for "Edit plan".
 */

function cloneDraft(sections: PlanDraftSection[]): PlanDraftSection[] {
	return sections.map((section) => ({
		...(section.id === undefined ? {} : { id: section.id }),
		title: section.title,
		points: section.points.map((point) => ({
			...(point.id === undefined ? {} : { id: point.id }),
			text: point.text,
			source: point.source,
		})),
	}));
}

export function PlanEditor({
	initial,
	onSave,
	saving = false,
	submitLabel = "Confirm plan",
}: {
	initial: PlanDraftSection[];
	onSave: (sections: PlanDraftSection[], confirm: boolean) => void;
	saving?: boolean;
	/** The action's label — "Confirm plan" on a proposal, "Save plan" when
	 *  the readiness view edits an already-confirmed plan. */
	submitLabel?: string;
}) {
	const [sections, setSections] = useState<PlanDraftSection[]>(() => cloneDraft(initial));

	function editSection(index: number, update: (section: PlanDraftSection) => PlanDraftSection): void {
		setSections((current) => current.map((section, i) => (i === index ? update(section) : section)));
	}

	function editPoint(
		sectionIndex: number,
		pointIndex: number,
		update: (point: PlanDraftSection["points"][number]) => PlanDraftSection["points"][number],
	): void {
		editSection(sectionIndex, (section) => ({
			...section,
			points: section.points.map((point, i) => (i === pointIndex ? update(point) : point)),
		}));
	}

	return (
		<div data-testid="plan-editor" className="space-y-3">
			{sections.map((section, sectionIndex) => (
				<div key={section.id ?? `section-${sectionIndex}`} className="rounded-lg border bg-background/50 p-3">
					<div className="flex items-start gap-2">
						<Input
							aria-label={`Section ${sectionIndex + 1} title`}
							value={section.title}
							placeholder="Section title"
							onChange={(event) =>
								editSection(sectionIndex, (current) => ({ ...current, title: event.target.value }))
							}
							className="h-8 text-sm font-medium"
						/>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={`Remove section ${sectionIndex + 1}`}
							onClick={() => setSections((current) => current.filter((_, i) => i !== sectionIndex))}
						>
							<XIcon className="size-3.5" />
						</Button>
					</div>

					<ul className="mt-2 space-y-2">
						{section.points.map((point, pointIndex) => (
							<li key={point.id ?? `point-${sectionIndex}-${pointIndex}`} className="flex items-start gap-2">
								<div className="min-w-0 flex-1">
									<Input
										aria-label={`Section ${sectionIndex + 1}, point ${pointIndex + 1}`}
										value={point.text}
										placeholder="What is tested"
										onChange={(event) =>
											editPoint(sectionIndex, pointIndex, (current) => ({
												...current,
												text: event.target.value,
											}))
										}
										className="h-8 text-sm"
									/>
									{point.source.trim() !== "" && (
										<div data-testid="plan-source" className="mt-0.5 text-xs text-muted-foreground">
											{point.source}
										</div>
									)}
								</div>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label={`Remove section ${sectionIndex + 1}, point ${pointIndex + 1}`}
									onClick={() =>
										editSection(sectionIndex, (current) => ({
											...current,
											points: current.points.filter((_, i) => i !== pointIndex),
										}))
									}
								>
									<XIcon className="size-3.5" />
								</Button>
							</li>
						))}
					</ul>

					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="mt-1"
						onClick={() =>
							editSection(sectionIndex, (current) => ({
								...current,
								points: [...current.points, { text: "", source: "" }],
							}))
						}
					>
						Add point
					</Button>
				</div>
			))}

			<div className="flex items-center justify-between gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() =>
						setSections((current) => [...current, { title: "", points: [{ text: "", source: "" }] }])
					}
				>
					Add section
				</Button>
				<Button type="button" size="sm" disabled={saving} onClick={() => onSave(sections, true)}>
					{saving ? "Saving…" : submitLabel}
				</Button>
			</div>
		</div>
	);
}