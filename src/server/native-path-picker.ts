import { execFile } from "node:child_process";
import { subscriptionRequestOrigin } from "./web-subscription-http.ts";

export type PathPickerMode = "files" | "folder";
export type PathPickerOutcome = { status: "picked"; paths: string[] } | { status: "unsupported" } | { status: "busy" };

type RunDialog = (file: string, args: string[]) => Promise<string>;

/** An abandoned dialog must not hold the single slot forever. */
const DIALOG_TIMEOUT_MS = 15 * 60 * 1000;
const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ROOTED_WINDOWS_PATH = /^(?:[a-z]:[\\/]|\\\\)/i;

/** Fixed per mode: nothing from the request reaches the script. The hidden
 *  topmost owner keeps the dialog above the browser that asked for it. */
function windowsDialogScript(mode: PathPickerMode): string {
	const dialog = mode === "folder"
		? `$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose a folder for LearnHarness'
$dialog.ShowNewFolderButton = $false
$chosen = { @($dialog.SelectedPath) }`
		: `$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Choose files for LearnHarness'
$dialog.Multiselect = $true
$chosen = { @($dialog.FileNames) }`;
	return `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
${dialog}
$paths = @()
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $paths = & $chosen }
ConvertTo-Json -InputObject @($paths) -Compress`;
}

const runProcess: RunDialog = (file, args) => new Promise((resolve, reject) => {
	execFile(file, args, { encoding: "utf8", timeout: DIALOG_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
		if (error) reject(error);
		else resolve(stdout);
	});
});

let dialogOpen = false;

/** Shows the OS dialog on the machine running the server and returns the
 *  chosen paths. Reads and grants nothing: the paths are only references. */
export async function pickNativePaths(
	mode: PathPickerMode,
	{ platform = process.platform, run = runProcess }: { platform?: NodeJS.Platform; run?: RunDialog } = {},
): Promise<PathPickerOutcome> {
	if (platform !== "win32") return { status: "unsupported" };
	if (dialogOpen) return { status: "busy" };
	dialogOpen = true;
	try {
		const encoded = Buffer.from(windowsDialogScript(mode), "utf16le").toString("base64");
		const output = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encoded]);
		const parsed: unknown = JSON.parse(output);
		if (!Array.isArray(parsed)) throw new Error("Unexpected dialog output.");
		return { status: "picked", paths: parsed.filter((path): path is string => typeof path === "string" && ROOTED_WINDOWS_PATH.test(path)) };
	} finally {
		dialogOpen = false;
	}
}

function error(message: string, status: number) {
	return Response.json({ error: message }, { status, headers: HEADERS });
}

/** Same-origin browser intent, not user authentication. A dialog only makes
 *  sense for someone sitting at the server, so non-loopback names are refused. */
export async function nativePathPickerResponse(
	request: Request,
	pick: (mode: PathPickerMode) => Promise<PathPickerOutcome> = pickNativePaths,
): Promise<Response> {
	if (request.method !== "POST") return error("Unsupported method.", 405);
	const origin = subscriptionRequestOrigin(request);
	if (!origin || !LOOPBACK_HOSTS.has(new URL(origin).hostname)
		|| request.headers.get("x-learnharness-path-picker") !== "1"
		|| request.headers.get("sec-fetch-site") === "cross-site"
		|| request.headers.get("origin") !== origin) {
		return error("The file picker requires a same-origin request from this computer.", 403);
	}
	const body = await request.json().catch(() => null) as { mode?: unknown } | null;
	if (body?.mode !== "files" && body?.mode !== "folder") return error("mode must be \"files\" or \"folder\".", 400);
	try {
		const outcome = await pick(body.mode);
		if (outcome.status === "unsupported") return error("The file picker is not available on this operating system.", 501);
		if (outcome.status === "busy") return error("A file picker is already open.", 409);
		return Response.json({ paths: outcome.paths }, { headers: HEADERS });
	} catch {
		return error("Could not open the file picker.", 500);
	}
}
