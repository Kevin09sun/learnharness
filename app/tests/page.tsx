import Link from "next/link";

import { SidebarToggle } from "@/components/sidebar";
import { readinessPercent } from "@/src/core";
import { stores } from "@/src/server";

/**
 * /tests — the Tests list (test prep, 2026-11-10).
 *
 * Every test the learner is preparing for, newest first, each row linking
 * to its readiness page. The percent is the ONE count-based rule
 * (readinessPercent over the store's integer counts), so the list can never
 * disagree with the readiness page or the agent's spoken numbers. Reads
 * come straight from the server store, like the chat page; `force-dynamic`
 * keeps a navigation from serving a cached list.
 */

export const dynamic = "force-dynamic";

export default function TestsPage() {
	const tests = stores.testStore.list();

	return (
		<div className="relative flex h-dvh flex-col">
			<header className="flex h-15 shrink-0 items-center gap-2 border-b border-border px-3">
				<SidebarToggle />
				<h1 className="font-title text-xl tracking-tight">Tests</h1>
			</header>
			<main className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-3xl px-6 py-8">
					{tests.length === 0 ? (
						<div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
							<p>
								No tests yet. Name a test in a new Test prep session and the agent
								will build a plan from your outline.
							</p>
							<Link
								href="/chat/new?mode=testprep"
								className="mt-3 inline-block font-medium text-foreground underline underline-offset-4"
							>
								Start a test prep session
							</Link>
						</div>
					) : (
						<>
							<p className="mb-4 text-sm text-muted-foreground">
								Every test you are preparing for, with the share of its plan you
								have made solid.
							</p>
							<ul className="space-y-3">
								{tests.map((test) => {
									const percent = readinessPercent(test.solid, test.total);
									return (
										<li key={test.id}>
											<Link
												href={`/tests/${test.id}`}
												data-testid={`test-row-${test.id}`}
												className="block rounded-xl border bg-card p-4 transition-colors hover:bg-accent"
											>
												<div className="flex items-start justify-between gap-3">
													<div className="min-w-0">
														<div className="truncate text-sm font-medium">
															{test.title}
														</div>
														<div className="mt-1 text-xs text-muted-foreground">
															{test.planConfirmed
																? "Plan confirmed"
																: "Plan awaiting review"}
															{" · "}
															{test.solid}/{test.total} points solid
														</div>
													</div>
													<span className="shrink-0 text-sm font-semibold tabular-nums">
														Ready: {percent}%
													</span>
												</div>
												<div
													className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
													aria-hidden="true"
												>
													<div
														className="h-full rounded-full bg-green-500 transition-[width]"
														style={{ width: `${percent}%` }}
													/>
												</div>
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