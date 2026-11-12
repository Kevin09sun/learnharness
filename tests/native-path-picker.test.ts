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

	it("runs an STA PowerShell with the modern Explorer common item dialog, never the legacy classes", async () => {
		const calls: { file: string; args: string[] }[] = [];
		const run = async (file: string, args: string[]) => { calls.push({ file, args }); return "[]"; };
		await pickNativePaths("folder", { ...win32, run });
		await pickNativePaths("files", { ...win32, run });
		assert.equal(calls[0]!.file, "powershell.exe");
		assert.ok(calls[0]!.args.includes("-STA"));
		const script = (call: { args: string[] }) => Buffer.from(call.args[call.args.indexOf("-EncodedCommand") + 1]!, "base64").toString("utf16le");
		for (const mode of [0, 1]) {
			const decoded = script(calls[mode]!);
			assert.match(decoded, /DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7/i, "IFileOpenDialog coclass");
			assert.match(decoded, /d57c7288-d4ad-4768-be02-9d969532d960/i, "IFileOpenDialog IID");
			assert.match(decoded, /IFileOpenDialog/, "the COM interface is declared");
			assert.match(decoded, /SIGDN_FILESYSPATH/, "paths come back as filesystem paths");
			assert.doesNotMatch(decoded, /FolderBrowserDialog/);
			assert.doesNotMatch(decoded, /OpenFileDialog/);
		}
	});

	it("folder mode picks one folder; files mode selects multiple existing files", async () => {
		const scripts: Record<string, string> = {};
		for (const mode of ["folder", "files"] as const) {
			await pickNativePaths(mode, {
				...win32,
				run: async (_file, args) => {
					scripts[mode] = Buffer.from(args[args.indexOf("-EncodedCommand") + 1]!, "base64").toString("utf16le");
					return "[]";
				},
			});
		}
		assert.match(scripts.folder!, /FOS_PICKFOLDERS/, "folder mode asks for folders");
		assert.doesNotMatch(scripts.folder!, /FOS_ALLOWMULTISELECT/);
		assert.match(scripts.folder!, /Pick\(\$owner\.Handle, \$true, 'Choose a folder for LearnHarness'\)/);
		assert.match(scripts.files!, /FOS_ALLOWMULTISELECT/, "files mode allows multiple");
		assert.match(scripts.files!, /FOS_FILEMUSTEXIST/);
		assert.doesNotMatch(scripts.files!, /FOS_PICKFOLDERS/);
		assert.match(scripts.files!, /Pick\(\$owner\.Handle, \$false, 'Choose files for LearnHarness'\)/);
		for (const decoded of Object.values(scripts)) {
			assert.match(decoded, /FOS_FORCEFILESYSTEM/);
			assert.match(decoded, /FOS_PATHMUSTEXIST/);
			assert.match(decoded, /FOS_NOCHANGEDIR/);
			assert.match(decoded, /\[System\.Windows\.Forms\.Application\]::EnableVisualStyles\(\)/, "visual styles before the form");
		}
	});

	it("shows an invisible, centered, topmost owner before the dialog and closes it afterwards", async () => {
		for (const mode of ["folder", "files"] as const) {
			let script = "";
			await pickNativePaths(mode, {
				...win32,
				run: async (_file, args) => {
					script = Buffer.from(args[args.indexOf("-EncodedCommand") + 1]!, "base64").toString("utf16le");
					return "[]";
				},
			});
			assert.match(script, /\$owner\.TopMost = \$true/, `${mode}: owner is topmost`);
			assert.match(script, /\$owner\.ShowInTaskbar = \$false/, `${mode}: owner stays off the taskbar`);
			assert.match(script, /\$owner\.FormBorderStyle = 'None'/, `${mode}: owner has no frame`);
			assert.match(script, /\$owner\.Opacity = 0/, `${mode}: owner is invisible`);
			assert.match(script, /\$owner\.StartPosition = 'CenterScreen'/, `${mode}: owner is centered`);
			const show = script.indexOf("$owner.Show()");
			const activate = script.indexOf("$owner.Activate()");
			const showDialog = script.indexOf("[LearnHarnessFileDialog]::Pick(");
			assert.ok(show >= 0 && activate >= 0 && showDialog >= 0, `${mode}: all three calls exist`);
			assert.ok(show < showDialog, `${mode}: owner is shown before the dialog`);
			assert.ok(activate < showDialog, `${mode}: owner is activated before the dialog`);
			assert.match(script, /\$owner\.Handle/, `${mode}: the owner handle is passed to the dialog`);
			assert.match(script, /\$owner\.Close\(\)/, `${mode}: owner is closed`);
			assert.match(script, /try\s*\{[\s\S]*Pick\([\s\S]*\}\s*finally\s*\{[\s\S]*\$owner\.Close\(\)/, `${mode}: owner closes even if the dialog throws`);
		}
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
