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

/** The modern Explorer-style common item dialog (IFileOpenDialog), the same
 *  one Explorer's Open/Save uses. WinForms' FolderBrowserDialog is the legacy
 *  XP tree and OpenFileDialog is the pre-visual-styles one, so both are
 *  replaced. The vtable method order below is load-bearing: COM dispatch is
 *  positional, so any reordering calls the wrong method. */
function windowsDialogTypes(options: string): string {
	return `using System;
using System.Runtime.InteropServices;

public static class LearnHarnessFileDialog
{
${options}
    private const uint SIGDN_FILESYSPATH = 0x80058000;
    private const int ERROR_CANCELLED = unchecked((int)0x800704C7);

    [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog
    {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
        void SetFileTypeIndex(uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise(IntPtr pfde, out uint pdwCookie);
        void Unadvise(uint dwCookie);
        void SetOptions(uint fos);
        void GetOptions(out uint pfos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace(IShellItem psi, int fdap);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close(int hr);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr pFilter);
    }

    /* IFileOpenDialog is spelled out in full rather than inheriting
       IFileDialog. COM dispatch is positional, and writing every slot here
       removes any reliance on how the runtime orders inherited interface
       methods; GetResults must be slot 25. */
    [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog
    {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
        void SetFileTypeIndex(uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise(IntPtr pfde, out uint pdwCookie);
        void Unadvise(uint dwCookie);
        void SetOptions(uint fos);
        void GetOptions(out uint pfos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace(IShellItem psi, int fdap);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close(int hr);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr pFilter);
        void GetResults(out IShellItemArray ppenum);
        void GetSelectedItems(out IShellItemArray ppsai);
    }

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        void Compare(IShellItem psi, uint hint, out int piOrder);
    }

    [ComImport, Guid("b63ea76d-1f85-456f-a19c-48159efa858b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemArray
    {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppvOut);
        void GetPropertyStore(int flags, ref Guid riid, out IntPtr ppv);
        void GetPropertyDescriptionList(IntPtr keyType, ref Guid riid, out IntPtr ppv);
        void GetAttributes(int attribFlags, uint sfgaoMask, out uint psfgaoAttribs);
        void GetCount(out uint pdwNumItems);
        void GetItemAt(uint dwIndex, out IShellItem ppsi);
        void EnumItems(out IntPtr ppenumShellItems);
    }

    [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    private class FileOpenDialogClass
    {
    }

    public static string[] Pick(IntPtr owner, bool folder, string title)
    {
        IFileOpenDialog dialog = (IFileOpenDialog)new FileOpenDialogClass();
        IShellItem single = null;
        IShellItemArray many = null;
        try
        {
            dialog.SetOptions(OPTIONS);
            dialog.SetTitle(title);
            int hr = dialog.Show(owner);
            if (hr == ERROR_CANCELLED) return new string[0];
            if (hr < 0) Marshal.ThrowExceptionForHR(hr);
            if (folder)
            {
                string path;
                dialog.GetResult(out single);
                single.GetDisplayName(SIGDN_FILESYSPATH, out path);
                return new string[] { path };
            }
            uint count;
            dialog.GetResults(out many);
            many.GetCount(out count);
            string[] paths = new string[count];
            for (uint i = 0; i < count; i++)
            {
                IShellItem entry = null;
                try
                {
                    string name;
                    many.GetItemAt(i, out entry);
                    entry.GetDisplayName(SIGDN_FILESYSPATH, out name);
                    paths[i] = name;
                }
                finally
                {
                    if (entry != null) Marshal.ReleaseComObject(entry);
                }
            }
            return paths;
        }
        finally
        {
            if (many != null) Marshal.ReleaseComObject(many);
            if (single != null) Marshal.ReleaseComObject(single);
            Marshal.FinalReleaseComObject(dialog);
        }
    }
}`;
}

const FOLDER_OPTIONS = `    private const uint FOS_NOCHANGEDIR = 0x8;
    private const uint FOS_PICKFOLDERS = 0x20;
    private const uint FOS_FORCEFILESYSTEM = 0x40;
    private const uint FOS_PATHMUSTEXIST = 0x800;
    private const uint OPTIONS = FOS_NOCHANGEDIR | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST;`;

const FILES_OPTIONS = `    private const uint FOS_NOCHANGEDIR = 0x8;
    private const uint FOS_FORCEFILESYSTEM = 0x40;
    private const uint FOS_ALLOWMULTISELECT = 0x200;
    private const uint FOS_PATHMUSTEXIST = 0x800;
    private const uint FOS_FILEMUSTEXIST = 0x1000;
    private const uint OPTIONS = FOS_NOCHANGEDIR | FOS_FORCEFILESYSTEM | FOS_ALLOWMULTISELECT | FOS_PATHMUSTEXIST | FOS_FILEMUSTEXIST;`;

/** Fixed per mode: nothing from the request reaches the script. The hidden
 *  topmost owner keeps the dialog above the browser that asked for it. */
function windowsDialogScript(mode: PathPickerMode): string {
	const call = mode === "folder"
		? "[LearnHarnessFileDialog]::Pick($owner.Handle, $true, 'Choose a folder for LearnHarness')"
		: "[LearnHarnessFileDialog]::Pick($owner.Handle, $false, 'Choose files for LearnHarness')";
	const types = windowsDialogTypes(mode === "folder" ? FOLDER_OPTIONS : FILES_OPTIONS);
	return `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
Add-Type -TypeDefinition @'
${types}
'@
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = 'None'
$owner.Opacity = 0
$owner.StartPosition = 'CenterScreen'
$paths = @()
$owner.Show()
$owner.Activate()
try {
$paths = ${call}
} finally {
$owner.Close()
}
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
