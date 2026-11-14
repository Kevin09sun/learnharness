import Link from "next/link";

import { SidebarToggle } from "@/components/sidebar";
import { readinessPercent } from "@/src/core";
import { stores } from "@/src/server";

/**
 * /ap — the AP course list (AP prep, 2026-11-13).
 *
 * Every course the learner is preparing for, newest first, each row linking
 * to its course page. The percent is the ONE count-based rule
 * (readinessPercent over the store's integer counts), so the list can never
 * disagree with the course page. A course with no confirmed units and topics
 * reads "Not set up yet" — a bare 0% would suggest work that has started.
 * Reads come straight from the server store, like the Tests list;
 * `force-dynamic` keeps a navigation from serving a cached list.
 */

export const dynamic = "force-dynamic";

export default function ApCoursesPage() {
	const courses = stores.apCourseStore.list();

	return (
		<div className="relative flex h-dvh flex-col">
			<header className="flex h-15 shrink-0 items-center gap-2 border-b border-border px-3">
				<SidebarToggle />
				<h1 className="font-title text-xl tracking-tight">AP</h1>
			</header>
			<main className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-3xl px-6 py-8">
					{courses.length === 0 ? (
						<div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
							<p>
								No courses yet. Name a course in a new AP session and the agent
								will build its units and topics from the official course
								description.
							</p>
							<Link
								href="/chat/new?mode=ap"
								className="mt-3 inline-block font-medium text-foreground underline underline-offset-4"
							>
								Start an AP session
							</Link>
						</div>
					) : (
						<>
							<p className="mb-4 text-sm text-muted-foreground">
								Every AP course you are preparing for, with the share of its
								topics you have made solid.
							</p>
							<ul className="space-y-3">
								{courses.map((course) => {
									const percent = readinessPercent(course.solid, course.total);
									const setUp = course.planConfirmed && course.total > 0;
									return (
										<li key={course.id}>
											<Link
												href={`/ap/${course.id}`}
												data-testid={`course-row-${course.id}`}
												className="block rounded-xl border bg-card p-4 transition-colors hover:bg-accent"
											>
												<div className="flex items-start justify-between gap-3">
													<div className="min-w-0">
														<div className="truncate text-sm font-medium">
															{course.title}
														</div>
														<div className="mt-1 text-xs text-muted-foreground">
															{course.planConfirmed
																? "Units and topics confirmed"
																: "Units and topics awaiting review"}
															{" · "}
															{course.solid}/{course.total} topics solid
														</div>
													</div>
													<span className="shrink-0 text-sm font-semibold tabular-nums">
														{setUp ? `Ready: ${percent}%` : "Not set up yet"}
													</span>
												</div>
												{setUp && (
													<div
														className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
														aria-hidden="true"
													>
														<div
															className="h-full rounded-full bg-green-500 transition-[width]"
															style={{ width: `${percent}%` }}
														/>
													</div>
												)}
											</Link>
										</li>
									);
								})}
							</ul>
						</>
					)}
				</div>
			</main>
		</div>
	);
}