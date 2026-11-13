/**
 * AP PAPER STORE PINS (AP prep stage 1, 2026-11-13): official PDFs live in a
 * local folder that is deliberately kept out of the learner's synced data
 * repo. The download seam is a security boundary — it only ever fetches
 * College Board addresses (request and every redirect hop), only ever writes
 * a PDF into the course's own folder, and leaves nothing behind on refusal.
 * Runs under an isolated LH_DATA_DIR (the chat-birth-stamp discipline: the
 * seam is set before any config-loading import, so every app-module import
 * is dynamic). No test touches the network: fetchImpl is always a stub.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

// ── the seam, BEFORE any config-loading import ──────────────────────────────
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-ap-papers-"));
process.env.LH_DATA_DIR = TMP_DATA;
const SOURCE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lh-ap-paper-sources-"));

const {
	AP_PAPER_MAX_BYTES,
	apPapers,
	apPapersDir,
	apPaperPath,
	apPaperPresent,
	downloadApPaper,
	ensureApPapersIgnored,
	importApPaper,
} = await import("../src/server/ap-papers.ts");

const PDF = "%PDF-1.7\n% test paper\n";
const OFF_COLLEGE_BOARD = "Only College Board addresses are accepted";

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
	fs.rmSync(SOURCE_DIR, { recursive: true, force: true });
});

/** A Response with a settable final URL (the property is normally read-only). */
function response(body: BodyInit | null, init?: ResponseInit, url?: string): Response {
	const res = new Response(body, init);
	if (url !== undefined) Object.defineProperty(res, "url", { value: url });
	return res;
}

/** Names in a course's papers folder; [] when the folder was never made. */
function paperFiles(courseId: string): string[] {
	try {
		return fs.readdirSync(apPapersDir(courseId));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

function noLeftovers(courseId: string): void {
	const names = paperFiles(courseId);
	assert.ok(!names.some((name) => name.endsWith(".tmp")), "no temp file survives");
	assert.deepEqual(names, [], "a refusal leaves nothing on disk");
}

describe("AP paper store (AP prep stage 1, 2026-11-13)", () => {
	it("refuses a non-College-Board address without fetching", async () => {
		let calls = 0;
		const stub = async (): Promise<Response> => {
			calls++;
			return response(PDF, undefined, "https://www.collegeboard.org/a.pdf");
		};
		await assert.rejects(
			downloadApPaper("course-no-fetch", "https://evil.example/x.pdf", "x.pdf", stub as typeof fetch),
			(error: Error) => error.message === OFF_COLLEGE_BOARD,
		);
		assert.equal(calls, 0, "the URL is checked before any request");
		noLeftovers("course-no-fetch");
	});

	it("refuses when a redirect hop points off College Board", async () => {
		const stub = async (): Promise<Response> =>
			response(null, { status: 302, headers: { location: "https://evil.example/x.pdf" } });
		await assert.rejects(
			downloadApPaper("course-redirect-off", "https://www.collegeboard.org/x.pdf", "x.pdf", stub as typeof fetch),
			(error: Error) => error.message === OFF_COLLEGE_BOARD,
		);
		noLeftovers("course-redirect-off");
	});

	it("refuses a response whose own final URL is off College Board", async () => {
		const stub = async (): Promise<Response> =>
			response(PDF, undefined, "https://evil.example/x.pdf");
		await assert.rejects(
			downloadApPaper("course-final-off", "https://www.collegeboard.org/x.pdf", "x.pdf", stub as typeof fetch),
			(error: Error) => error.message === OFF_COLLEGE_BOARD,
		);
		noLeftovers("course-final-off");
	});

	it("refuses more than five redirects", async () => {
		let calls = 0;
		const stub = async (): Promise<Response> => {
			calls++;
			return response(null, {
				status: 302,
				headers: { location: "https://www.collegeboard.org/again.pdf" },
			});
		};
		await assert.rejects(
			downloadApPaper("course-too-many", "https://www.collegeboard.org/x.pdf", "x.pdf", stub as typeof fetch),
			(error: Error) => error.message === "Too many redirects",
		);
		assert.equal(calls, 6, "five redirects are followed, the sixth is refused");
		noLeftovers("course-too-many");
	});

	it("refuses a body that is not a PDF", async () => {
		const stub = async (): Promise<Response> => response("<html>not a paper</html>");
		await assert.rejects(
			downloadApPaper("course-not-pdf", "https://www.collegeboard.org/x.pdf", "x.pdf", stub as typeof fetch),
			(error: Error) => error.message === "Not a PDF",
		);
		noLeftovers("course-not-pdf");
	});

	it("refuses an oversized PDF by declared length", async () => {
		const stub = async (): Promise<Response> =>
			response(PDF, { headers: { "content-length": String(AP_PAPER_MAX_BYTES + 1) } });
		await assert.rejects(
			downloadApPaper("course-oversized", "https://www.collegeboard.org/x.pdf", "x.pdf", stub as typeof fetch),
			(error: Error) => error.message === "PDF too large",
		);
		noLeftovers("course-oversized");
	});

	it("refuses a streamed body over the limit even without content-length", async () => {
		const chunk = new Uint8Array(1024 * 1024).fill(0x20);
		let sent = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (sent > AP_PAPER_MAX_BYTES) {
					controller.close();
					return;
				}
				sent += chunk.byteLength;
				controller.enqueue(chunk);
			},
		});
		const stub = async (): Promise<Response> => new Response(body);
		await assert.rejects(
			downloadApPaper("course-streamed", "https://www.collegeboard.org/x.pdf", "x.pdf", stub as typeof fetch),
			(error: Error) => error.message === "PDF too large",
		);
		noLeftovers("course-streamed");
	});

	it("saves a PDF and reports its size", async () => {
		let seen: RequestInit | undefined;
		const stub = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			seen = init;
			return response(PDF, undefined, "https://www.collegeboard.org/ced.pdf");
		};
		const result = await downloadApPaper(
			"course-save",
			"https://www.collegeboard.org/ced.pdf",
			"ced.pdf",
			stub as typeof fetch,
		);

		const expected = Buffer.byteLength(PDF);
		assert.deepEqual(result, { file: "ced.pdf", bytes: expected });
		assert.equal(apPaperPresent("course-save", "ced.pdf"), true);
		const onDisk = fs.readFileSync(apPaperPath("course-save", "ced.pdf"));
		assert.equal(onDisk.byteLength, expected, "bytes on disk equal the reported size");
		assert.equal(onDisk.toString("utf8"), PDF);

		assert.equal(seen?.redirect, "manual");
		assert.equal(seen?.credentials, "omit");
		const headers = new Headers(seen?.headers);
		assert.equal(headers.get("accept"), "application/pdf");
		assert.ok(headers.get("user-agent"), "a user agent is sent");
	});

	it("follows a redirect chain that stays on College Board", async () => {
		let calls = 0;
		const stub = async (input: RequestInfo | URL): Promise<Response> => {
			calls++;
			const url = String(input);
			if (url.endsWith("/start.pdf")) {
				return response(null, {
					status: 302,
					headers: { location: "https://ap.collegeboard.org/next.pdf" },
				});
			}
			if (url.endsWith("/next.pdf")) {
				return response(null, {
					status: 301,
					headers: { location: "/final/ced.pdf" },
				});
			}
			return response(PDF, undefined, url);
		};

		const result = await downloadApPaper(
			"course-chain",
			"https://www.collegeboard.org/start.pdf",
			"ced.pdf",
			stub as typeof fetch,
		);
		assert.equal(calls, 3);
		assert.equal(result.bytes, Buffer.byteLength(PDF));
		assert.equal(fs.readFileSync(apPaperPath("course-chain", "ced.pdf"), "utf8"), PDF);
	});

	it("rejects unsafe course ids and file names", () => {
		assert.throws(() => apPapersDir("../x"), /Invalid course id/);
		assert.throws(() => apPapersDir("a/b"), /Invalid course id/);
		assert.throws(() => apPaperPath("course-safe", ".."), /Invalid paper file/);
		assert.throws(() => apPaperPath("course-safe", "../x.pdf"), /Invalid paper file/);
		assert.throws(() => apPaperPath("course-safe", "a/b.pdf"), /Invalid paper file/);
		assert.throws(() => apPaperPath("course-safe", "C:\\x.pdf"), /Invalid paper file/);
		assert.throws(() => apPaperPath("course-safe", "/x.pdf"), /Invalid paper file/);
		assert.throws(() => apPaperPath("course-safe", "x.exe"), /Invalid paper file/);
		assert.equal(apPaperPath("course-safe", "ced-2026.v2.pdf"), path.join(apPapersDir("course-safe"), "ced-2026.v2.pdf"));
	});

	it("apPaperPresent is false before a paper exists", () => {
		assert.equal(apPaperPresent("course-absent", "ced.pdf"), false);
	});

	it("exposes the injectable port with a three-argument download", () => {
		assert.equal(apPapers.dir, apPapersDir);
		assert.equal(apPapers.present, apPaperPresent);
		assert.equal(apPapers.importFile, importApPaper);
		assert.equal(apPapers.download.length, 3);
	});

	it("ensureApPapersIgnored appends once to an existing .gitignore and keeps its content", () => {
		const ignore = path.join(TMP_DATA, ".gitignore");
		fs.writeFileSync(ignore, "debug/\n");

		ensureApPapersIgnored();
		assert.equal(fs.readFileSync(ignore, "utf8"), "debug/\nap-papers/\n");

		ensureApPapersIgnored();
		assert.equal(fs.readFileSync(ignore, "utf8"), "debug/\nap-papers/\n", "the second call changes nothing");
	});

	it("ensureApPapersIgnored creates the file only when data/ is a git repo", () => {
		const ignore = path.join(TMP_DATA, ".gitignore");
		const git = path.join(TMP_DATA, ".git");
		fs.rmSync(ignore, { force: true });
		fs.rmSync(git, { recursive: true, force: true });

		ensureApPapersIgnored();
		assert.equal(fs.existsSync(ignore), false, "no git repo, no ignore file");

		fs.mkdirSync(git);
		ensureApPapersIgnored();
		assert.equal(fs.readFileSync(ignore, "utf8"), "ap-papers/\n");
	});

	it("importApPaper copies a learner PDF and refuses a non-PDF", async () => {
		const source = path.join(SOURCE_DIR, "learner.pdf");
		fs.writeFileSync(source, PDF);

		const result = await importApPaper("course-import", source, "learner.pdf");
		assert.deepEqual(result, { file: "learner.pdf", bytes: Buffer.byteLength(PDF) });
		assert.equal(apPaperPresent("course-import", "learner.pdf"), true);
		assert.equal(fs.readFileSync(apPaperPath("course-import", "learner.pdf"), "utf8"), PDF);

		const html = path.join(SOURCE_DIR, "notes.pdf");
		fs.writeFileSync(html, "<html>not a paper</html>");
		await assert.rejects(
			importApPaper("course-import", html, "notes.pdf"),
			(error: Error) => error.message === "Not a PDF",
		);
		assert.equal(apPaperPresent("course-import", "notes.pdf"), false);
		assert.deepEqual(paperFiles("course-import"), ["learner.pdf"], "the refusal leaves no temp file");
	});
});