"use client";

import type { ArtifactPartProps } from "@/src/core";
import { fillAddedTopicSources } from "@/src/core";
import {
	PlanReviewCard,
	type PlanReviewConfig,
} from "@/components/test-prep/plan-review-card";

/**
 * The units-review card (AP prep, 2026-11-13): the `propose_units` artifact.
 *
 * Same behaviour as Test prep's plan review card — the learner audits every
 * topic against the course description, edits inline, and confirms — with the
 * record's own words ("unit"/"topic"), the AP chat link field and the AP
 * endpoints. All the logic lives in PlanReviewCard; this is only the config.
 */
export const AP_PLAN_CONFIG: PlanReviewConfig = {
	toolName: "propose_units",
	chatKey: "apCourseId",
	apiBase: "/api/ap",
	pageBase: "/ap",
	sectionLabel: "unit",
	pointLabel: "topic",
	submitLabel: "Confirm units and topics",
	proposedTitle: "Proposed units and topics",
	confirmedTitle: "Units and topics confirmed",
	openPage: "Open course page",
	superseded: "This list was revised below.",
	loading: "Loading the units and topics…",
	notLinked: "This session is not linked to a course.",
	loadError: "Could not load the course.",
	unavailable: "The units and topics are unavailable.",
	saveError: "The units and topics could not be saved.",
	confirmMessage: "I've confirmed the units and topics.",
	instruction:
		"Check every topic against your course description — each one shows the page it came from. Edit anything that is off, then confirm.",
	prepareDraft: fillAddedTopicSources,
};

export function UnitsReviewCard({ part }: ArtifactPartProps) {
	return <PlanReviewCard part={part} config={AP_PLAN_CONFIG} />;
}