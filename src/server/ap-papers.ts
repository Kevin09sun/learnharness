/**
 * AP paper store — the local folder for official AP PDFs.
 *
 * The papers are deliberately kept OUT of the learner's synced data: data/
 * is its own git repository, and the course record carries only the
 * document manifest, never the bytes. ensureApPapersIgnored() is what keeps
 * ap-papers/ out of that repo; the folder itself mirrors data/ap/<id>.json
 * as data/ap-papers/<courseId>/.
 *
 * The download seam is a security boundary: it fetches a URL chosen by a
 * language model, so it only ever requests College Board addresses — the
 * requested URL AND every redirect hop — and only ever writes a PDF into
 * the course's own folder. A refusal leaves nothing behind: the folder is
 * created only once a complete PDF is in hand, and the write is atomic
 * (temp beside the target, then rename).
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { PATHS } from "../../config.ts";
import { isCollegeBoardUrl } from "../core/ap.ts";
import { resolveSourcePath } from "../agent/tools/fs-shared.ts";

export const AP_PAPER_MAX_BYTES = 80 * 1024 * 1024;

/** Wall-clock budget for one download, body included. */
const FETCH_TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 5;
/** Bare minimum identity — no cookies, no credentials, no browser impersonation. */
const USER_AGENT = "LearnHarness/1.0";
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

const COURSE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const PAPER_FILE_PATTERN = /^[A-Za-z0-9._-]+\.pdf$/;

/** The course's papers folder path; creates nothing. */
export function apPapersDir(courseId: string): string {
	if (!COURSE_ID_PATTERN.test(courseId)) throw new Error(`Invalid course id: ${courseId}`);
	return path.join(PATHS.apPapers, courseId);
}

/** The path of one paper inside a course's folder. Only a plain PDF file
 *  name is accepted: no "..", no separators, no absolute path, no other
 *  extension — the name reaches the filesystem, so it is checked first. */
export function apPaperPath(courseId: string, file: string): string {
	const dir = apPapersDir(courseId);
	if (!PAPER_FILE_PATTERN.test(file)) throw new Error(`Invalid paper file: ${file}`);
	return path.join(dir, file);
}

export function apPaperPresent(courseId: string, file: string): boolean {
	return fs.existsSync(apPaperPath(courseId, file));
}

/**
 * Keep ap-papers/ out of the learner's synced data repo. An existing
 * .gitignore only gains the exact line once (its content and trailing
 * newline preserved); with no .gitignore, one is created only when data/
 * actually is a git repository. Anything else does nothing.
 */
export function ensureApPapersIgnored(): void {
	const ignoreFile = path.join(PATHS.data, ".gitignore");
	let existing: string | null = null;
	try {
		existing = fs.readFileSync(ignoreFile, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	if (existing !== null) {
		if (existing.split(/\r?\n/).includes("ap-papers/")) return;
		const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
		fs.appendFileSync(ignoreFile, `${separator}ap-papers/\n`, "utf8");
		return;
	}
	if (!fs.existsSync(path.join(PATHS.data, ".git"))) return;
	fs.mkdirSync(PATHS.data, { recursive: true });
	fs.writeFileSync(ignoreFile, "ap-papers/\n", "utf8");
}

/**
 * Download an official paper. Refuses anything that is not College Board,
 * anything that redirects off College Board, a non-PDF body and a body over
 * the limit (declared or streamed) — and leaves the folder without files
 * on every refusal.
 */
export async function downloadApPaper(
	courseId: string,
	url: string,
	file: string,
	fetchImpl: typeof fetch = fetch,
): Promise<{ file: string; bytes: number }> {
	const target = apPaperPath(courseId, file); // validates id and file name
	if (!isCollegeBoardUrl(url)) throw new Error("Only College Board addresses are accepted");

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const response = await fetchFollowingCollegeBoard(url, fetchImpl, controller.signal);
		if (response.url && !isCollegeBoardUrl(response.url)) {
			throw new Error("Only College Board addresses are accepted");
		}
		if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);

		const declared = Number(response.headers.get("content-length"));
		if (Number.isFinite(declared) && declared > AP_PAPER_MAX_BYTES) throw new Error("PDF too large");

		const bytes = await readBody(response, controller.signal);
		if (!isPdf(bytes)) throw new Error("Not a PDF");

		ensureApPapersIgnored();
		await writePaperAtomic(target, bytes);
		return { file, bytes: bytes.byteLength };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Copy a PDF the learner already has. The path goes through the learner-file
 * guard (resolveSourcePath) exactly as the file tools do, so its refusal
 * message is surfaced unchanged; the bytes face the same PDF and size checks.
 */
export async function importApPaper(
	courseId: string,
	sourcePath: string,
	file: string,
): Promise<{ file: string; bytes: number }> {
	const target = apPaperPath(courseId, file); // validates id and file name
	const source = resolveSourcePath(sourcePath);
	const stat = await fsp.stat(source);
	if (stat.size > AP_PAPER_MAX_BYTES) throw new Error("PDF too large");
	const bytes = await fsp.readFile(source);
	if (bytes.byteLength > AP_PAPER_MAX_BYTES) throw new Error("PDF too large");
	if (!isPdf(bytes)) throw new Error("Not a PDF");

	ensureApPapersIgnored();
	await writePaperAtomic(target, bytes);
	return { file, bytes: bytes.byteLength };
}

/** The port later tasks inject: no fetch seam, three arguments. */
export const apPapers: {
	dir: typeof apPapersDir;
	present: typeof apPaperPresent;
	download: (courseId: string, url: string, file: string) => Promise<{ file: string; bytes: number }>;
	importFile: typeof importApPaper;
} = {
	dir: apPapersDir,
	present: apPaperPresent,
	download: (courseId: string, url: string, file: string) => downloadApPaper(courseId, url, file),
	importFile: importApPaper,
};

// ─── download plumbing ──────────────────────────────────────────────────────

/**
 * Follow redirects ourselves so every hop is checked before it is requested;
 * fetch's automatic redirect would visit an unchecked host first. At most
 * five hops.
 */
async function fetchFollowingCollegeBoard(
	url: string,
	fetchImpl: typeof fetch,
	signal: AbortSignal,
): Promise<Response> {
	let current = url;
	for (let hop = 0; ; hop++) {
		if (!isCollegeBoardUrl(current)) throw new Error("Only College Board addresses are accepted");
		const response = await fetchImpl(current, {
			redirect: "manual",
			credentials: "omit",
			headers: { accept: "application/pdf", "user-agent": USER_AGENT },
			signal,
		});
		if (response.status < 300 || response.status >= 400) return response;

		const location = response.headers.get("location");
		if (!location) return response;
		if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects");
		current = new URL(location, current).toString();
	}
}

/** Read the body while enforcing the ceiling — a lying or absent
 *  content-length cannot stream past it. */
async function readBody(response: Response, signal: AbortSignal): Promise<Uint8Array> {
	const reader = response.body?.getReader();
	if (!reader) return new Uint8Array(0);

	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			if (signal.aborted) throw new Error("Download timed out");
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > AP_PAPER_MAX_BYTES) throw new Error("PDF too large");
			chunks.push(value);
		}
	} catch (error) {
		try {
			await reader.cancel();
		} catch {
			// already closed or errored — the original error is the one to report
		}
		throw error;
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function isPdf(bytes: Uint8Array): boolean {
	if (bytes.byteLength < PDF_MAGIC.length) return false;
	return PDF_MAGIC.every((byte, index) => bytes[index] === byte);
}

/** Write beside the target, then rename over it; any failure removes the
 *  temp file so a refusal or a crash never leaves a half paper behind. */
async function writePaperAtomic(target: string, bytes: Uint8Array): Promise<void> {
	await fsp.mkdir(path.dirname(target), { recursive: true });
	const temp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
	try {
		await fsp.writeFile(temp, bytes);
		await fsp.rename(temp, target);
	} catch (error) {
		await fsp.rm(temp, { force: true });
		throw error;
	}
}