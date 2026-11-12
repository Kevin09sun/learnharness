"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { PaperclipIcon } from "lucide-react";
import { directoryReferencePath, quoteFilePath } from "@/src/core";
import { Hint } from "@/components/ui/hint";
import { INSERT_FILE_PATHS_EVENT } from "@/components/path-input";

const PICKER_UNAVAILABLE_NOTICE = "The file picker is not available on this system. You can paste a full path instead.";
const PICKER_BUSY_NOTICE = "A file picker is already open. It may be behind this window.";

/** Distinguishes a 409 from other failures, so the notice can explain where
 *  the picker went. */
class FilePickerBusy extends Error {}

/** The browser case: a browser File has no local path, so the server (on this
 *  same machine) shows the native dialog. null = this OS has no dialog. */
async function requestNativePaths(mode: "files" | "folder"): Promise<string[] | null> {
	const response = await fetch("/api/path-picker", {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-learnharness-path-picker": "1" },
		body: JSON.stringify({ mode }),
	});
	if (response.status === 501) return null;
	if (response.status === 409) throw new FilePickerBusy();
	if (!response.ok) throw new Error("File picker request failed.");
	return ((await response.json()) as { paths: string[] }).paths;
}

/** Picked files → the rooted paths an editor chips (issue #285), via the
 *  desktop bridge. Same validity rule as drops: a file without a usable
 *  path is skipped, never guessed. */
export function pathsForFiles(files: Iterable<File>, resolve: (file: File) => string): { paths: string[]; skipped: number } {
	const paths: string[] = [];
	let skipped = 0;
	for (const file of files) {
		try {
			const path = resolve(file);
			quoteFilePath(path);
			paths.push(path);
		} catch { skipped++; }
	}
	return { paths, skipped };
}

/** Center over the paperclip, but clear the whole visible composer, not just
 * its bottom-aligned button. Clamp horizontally and scroll above the dock. */
export function attachmentPopupPlacement(button: { left: number; right: number }, composer: { top: number }, popupWidth: number, viewport: { width: number; height: number }) {
	const edge = 8;
	const gap = 4;
	const maxWidth = Math.max(0, viewport.width - edge * 2);
	const width = Math.min(popupWidth, maxWidth);
	return {
		left: Math.max(edge, Math.min((button.left + button.right - width) / 2, viewport.width - edge - width)),
		bottom: viewport.height - composer.top + gap,
		maxWidth,
		maxHeight: Math.max(0, Math.min(viewport.height * 0.6, composer.top - gap - edge)),
	};
}

const noSubscribe = () => () => {};
/** The bridge is fixed for the window's life; the server render is always
 *  the browser case, so hydration never mismatches. */
function useDesktopPaths(): boolean {
	return useSyncExternalStore(noSubscribe, () => Boolean(window.lh?.getPathForFile), () => false);
}

/**
 * The attach button (issue #285): the picker's twin of a file drop — files
 * stay where they are and only their quoted paths enter the draft, at the
 * caret of `editorRef` (a PathInput root). Any file type; the agent reads
 * what it can. The desktop app uses its bridge; a browser asks the server for
 * a native dialog (requestNativePaths). The separate folder choice returns the
 * directory itself, including an empty directory.
 */
export function AttachFilesButton({ editorRef }: { editorRef: React.RefObject<HTMLDivElement | null> }) {
	const pickerRef = useRef<HTMLInputElement>(null);
	const desktop = useDesktopPaths();
	const buttonRef = useRef<HTMLButtonElement>(null);
	const popupRef = useRef<HTMLDivElement>(null);
	const choosing = useRef(false);
	const [open, setOpen] = useState(false);
	const [notice, setNotice] = useState("");
	const [placement, setPlacement] = useState<ReturnType<typeof attachmentPopupPlacement> | null>(null);
	const positioned = placement !== null;
	// Like MenuShell, portal to body with viewport-capped, reanchored placement.
	// The production chat/new-session docks deliberately clip their children.
	// Keep notice focus passive; only the choice menu takes keyboard focus.
	useLayoutEffect(() => {
		if (!open && !notice) { setPlacement(null); return; }
		const button = buttonRef.current;
		const popup = popupRef.current;
		if (!button || !popup) return;
		const composer = button.closest<HTMLElement>("[data-attachment-composer]") ?? button;
		const place = () => {
			setPlacement(attachmentPopupPlacement(button.getBoundingClientRect(), composer.getBoundingClientRect(),
				popup.getBoundingClientRect().width, { width: window.innerWidth, height: window.innerHeight }));
		};
		place();
		const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
		observer?.observe(composer);
		observer?.observe(popup);
		window.addEventListener("scroll", place, true);
		window.addEventListener("resize", place);
		return () => { observer?.disconnect(); window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
	}, [open, notice]);
	useEffect(() => { if (open && positioned) popupRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [open, positioned]);
	useEffect(() => {
		if (!open && !notice) return;
		const dismissOutside = (event: PointerEvent) => {
			if (event.target instanceof Node && !popupRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) {
				setOpen(false); setNotice("");
			}
		};
		document.addEventListener("pointerdown", dismissOutside);
		return () => document.removeEventListener("pointerdown", dismissOutside);
	}, [open, notice]);
	const chooseInBrowser = async (mode: "files" | "folder") => {
		setOpen(false);
		setNotice("");
		if (choosing.current) return;
		const editor = editorRef.current;
		choosing.current = true;
		try {
			const chosen = await requestNativePaths(mode);
			if (chosen === null) { setNotice(PICKER_UNAVAILABLE_NOTICE); return; }
			const paths = mode === "folder" ? chosen.map(directoryReferencePath) : chosen;
			// Cancelling is an empty list and leaves the draft intact.
			if (paths.length > 0 && editor?.isConnected && editor === editorRef.current) editor.dispatchEvent(new CustomEvent(INSERT_FILE_PATHS_EVENT, { detail: paths }));
		} catch (error) { setNotice(error instanceof FilePickerBusy ? PICKER_BUSY_NOTICE : "Could not open the file picker. Try again."); }
		finally { choosing.current = false; }
	};
	const chooseFolder = async () => {
		const choose = window.lh?.chooseAttachmentFolder;
		if (!choose) { await chooseInBrowser("folder"); return; }
		if (choosing.current) return;
		const editor = editorRef.current;
		setOpen(false);
		setNotice("");
		choosing.current = true;
		try {
			const chosen = await choose();
			if (chosen === null) return; // Native cancellation leaves the draft intact.
			const path = directoryReferencePath(chosen);
			if (editor?.isConnected && editor === editorRef.current) editor.dispatchEvent(new CustomEvent(INSERT_FILE_PATHS_EVENT, { detail: [path] }));
		} catch { setNotice("Could not choose a folder. Try again."); }
		finally { choosing.current = false; }
	};
	return (
		<div className="relative shrink-0"
			onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && !popupRef.current?.contains(event.relatedTarget)) setOpen(false); }}
			onKeyDown={(event) => {
				if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); buttonRef.current?.focus(); }
			}}>
			<input
				ref={pickerRef}
				type="file"
				multiple
				hidden
				data-testid="attach-files-input"
				onChange={(e) => {
					const resolve = window.lh?.getPathForFile;
					const { paths } = resolve ? pathsForFiles(Array.from(e.currentTarget.files ?? []), resolve) : { paths: [] };
					if (paths.length > 0) editorRef.current?.dispatchEvent(new CustomEvent(INSERT_FILE_PATHS_EVENT, { detail: paths }));
					e.currentTarget.value = ""; // allow re-picking the same file
				}}
			/>
			<Hint label="Attach files or a folder">
				<button
					ref={buttonRef}
					type="button"
					aria-label="Attach files"
					aria-disabled={false}
					aria-haspopup="menu"
					aria-expanded={open}
					data-testid="attach-files"
					onClick={() => { setNotice(""); setOpen(!open); }}
					className="flex size-10 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground"
				>
					<PaperclipIcon className="size-4" />
				</button>
			</Hint>
			{(open || notice) && createPortal(<div ref={popupRef} role={open ? "menu" : "status"}
				aria-label={open ? "Attach files or a folder" : undefined}
				data-testid="attachment-popup"
				style={{ position: "fixed", zIndex: 60, ...(placement ?? { left: 0, top: 0, visibility: "hidden" }), overflowY: "auto" }}
				className={open ? "w-max rounded-lg border bg-card p-1 shadow-lg" : "w-64 rounded-lg border bg-card p-2 text-xs text-muted-foreground shadow-lg"}
				onKeyDown={(event) => {
					const buttons = Array.from(popupRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
					const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
					const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key === "ArrowDown" ? (index + 1) % buttons.length : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : -1;
					if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
				}}>
				{open ? <>
					<button type="button" role="menuitem" className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
						onClick={() => {
							if (!desktop) { void chooseInBrowser("files"); return; }
							setOpen(false);
							pickerRef.current?.click();
						}}>Files</button>
					<button type="button" role="menuitem" className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
						onClick={() => { void chooseFolder(); }}>Folder</button>
				</> : notice}
			</div>, document.body)}
		</div>
	);
}
