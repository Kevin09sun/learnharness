/**
 * The web version's file/folder picker: a browser cannot reveal local paths,
 * but the server runs on the learner's own machine and can show a native
 * dialog there. Paths only — nothing is read or uploaded.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nativePathPickerResponse, pickNativePaths, type PathPickerOutcome } from "../src/server/native-path-picker.ts";

function request(body: unknown = { mode: "folder" }, headers: Record<string, string> = {}, url = "http://127.0.0.1:3000/api/path-picker") {
	return new Request(url, {
		method: "POST",
		headers: { "content-type": "application/json", "x-learnharness-path-picker": "1", origin: new URL(url).origin, ...headers },
		body: JSON.stringify(body),
	});
}

const picked = (paths: string[]): (() => Promise<PathPickerOutcome>) => async () => ({ status: "picked", paths });

describe("nativePathPickerResponse — who may open a dialog", () => {
	for (const headers of [
		{ origin: "https://attacker.invalid" },
		{ "sec-fetch-site": "cross-site" },
		{ origin: "null" },
		{ "x-learnharness-path-picker": "" },
	] as Record<string, string>[]) it(`refuses ${JSON.stringify(headers)} without opening a dialog`, async () => {
		const response = await nativePathPickerResponse(request(undefined, headers), async () => assert.fail("must not open"));
		assert.equal(response.status, 403);
		assert.equal(response.headers.get("access-control-allow-origin"), null);
	});

	it("refuses a server reached through a non-loopback name", async () => {
		const response = await nativePathPickerResponse(request(undefined, {}, "http://10.0.0.5:3000/api/path-picker"), async () => assert.fail("must not open"));
		assert.equal(response.status, 403);
	});

	it("refuses GET, so a link or image tag cannot open a dialog", async () => {
		const response = await nativePathPickerResponse(new Request("http://127.0.0.1:3000/api/path-picker", { headers: { "x-learnharness-path-picker": "1" } }), async () => assert.fail("must not open"));
		assert.equal(response.status, 405);
	});

	for (const url of ["http://localhost:3000/api/path-picker", "http://127.0.0.1:3000/api/path-picker"]) it(`allows ${url}`, async () => {
		const response = await nativePathPickerResponse(request({ mode: "files" }, {}, url), picked(["C:\\a.pdf"]));
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { paths: ["C:\\a.pdf"] });
	});
});

describe("nativePathPickerResponse — requests and outcomes", () => {
	for (const mode of [undefined, "", "everything", 1]) it(`rejects mode ${JSON.stringify(mode)}`, async () => {
		const response = await nativePathPickerResponse(request({ mode }), async () => assert.fail("must not open"));
		assert.equal(response.status, 400);
	});

	it("passes the requested mode to the dialog", async () => {
		let seen = "";
		await nativePathPickerResponse(request({ mode: "folder" }), async (mode) => { seen = mode; return { status: "picked", paths: [] }; });
		assert.equal(seen, "folder");
	});

	it("cancelling is an empty list, not an error", async () => {
		const response = await nativePathPickerResponse(request(), picked([]));
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { paths: [] });
	});

	it("reports an unsupported OS so the client can fall back", async () => {
		const response = await nativePathPickerResponse(request(), async () => ({ status: "unsupported" }));
		assert.equal(response.status, 501);
	});

	it("reports a dialog that is already open", async () => {
		const response = await nativePathPickerResponse(request(), async () => ({ status: "busy" }));
		assert.equal(response.status, 409);
	});

	it("reports a failed dialog", async () => {
		const response = await nativePathPickerResponse(request(), async () => { throw new Error("boom"); });
		assert.equal(response.status, 500);
	});
});

describe("pickNativePaths — the Windows dialog", () => {
	const win32 = { platform: "win32" as const };

	it("runs an STA PowerShell, with the mode's dialog", async () => {
		const calls: { file: string; args: string[] }[] = [];
		const run = async (file: string, args: string[]) => { calls.push({ file, args }); return "[]"; };
		await pickNativePaths("folder", { ...win32, run });
		await pickNativePaths("files", { ...win32, run });
		assert.equal(calls[0]!.file, "powershell.exe");
		assert.ok(calls[0]!.args.includes("-STA"));
		const script = (call: { args: string[] }) => Buffer.from(call.args[call.args.indexOf("-EncodedCommand") + 1]!, "base64").toString("utf16le");
		assert.match(script(calls[0]!), /FolderBrowserDialog/);
		assert.match(script(calls[1]!), /OpenFileDialog/);
		assert.match(script(calls[1]!), /Multiselect = \$true/);
	});

	it("returns chosen paths, including non-ASCII names", async () => {
		const outcome = await pickNativePaths("files", { ...win32, run: async () => JSON.stringify(["C:\\Users\\k\\微积分 notes.pdf", "D:\\b.png"]) });
		assert.deepEqual(outcome, { status: "picked", paths: ["C:\\Users\\k\\微积分 notes.pdf", "D:\\b.png"] });
	});

	it("drops anything that is not a rooted path", async () => {
		const outcome = await pickNativePaths("files", { ...win32, run: async () => JSON.stringify(["relative.pdf", "", 3, "C:\\ok.pdf"]) });
		assert.deepEqual(outcome, { status: "picked", paths: ["C:\\ok.pdf"] });
	});

	it("treats unparseable dialog output as a failure", async () => {
		await assert.rejects(pickNativePaths("files", { ...win32, run: async () => "not json" }));
	});

	it("only one dialog at a time, and the slot frees afterwards", async () => {
		let release!: (value: string) => void;
		const first = pickNativePaths("folder", { ...win32, run: () => new Promise<string>((resolve) => { release = resolve; }) });
		assert.deepEqual(await pickNativePaths("folder", { ...win32, run: async () => assert.fail("second dialog opened") }), { status: "busy" });
		release("[]");
		assert.deepEqual(await first, { status: "picked", paths: [] });
		assert.deepEqual(await pickNativePaths("folder", { ...win32, run: async () => "[]" }), { status: "picked", paths: [] });
	});

	it("frees the slot after a failed dialog", async () => {
		await assert.rejects(pickNativePaths("folder", { ...win32, run: async () => { throw new Error("boom"); } }));
		assert.deepEqual(await pickNativePaths("folder", { ...win32, run: async () => "[]" }), { status: "picked", paths: [] });
	});

	it("other systems report unsupported rather than guessing", async () => {
		assert.deepEqual(await pickNativePaths("folder", { platform: "linux", run: async () => assert.fail("must not run") }), { status: "unsupported" });
	});
});
