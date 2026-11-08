# Syncs data/ (chats, graph, settings) with its private GitHub repo.
# On a conflict it stops and logs, leaving both versions in git. It never discards anything.
param([switch]$PullOnly)

$data = Join-Path $PSScriptRoot '..\..\data'
$logDir = Join-Path $env:LOCALAPPDATA 'LearnHarnessAutostart'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir 'sync.log'

function Write-SyncLog($message) { "$(Get-Date -Format s) $message" | Add-Content -Path $log -Encoding utf8 }
function Invoke-DataGit {
	$ErrorActionPreference = 'Continue'
	$output = & git -C $data @args 2>&1 | ForEach-Object { "$_" }
	($output -join "`n").Trim()
}

if (-not (Test-Path (Join-Path $data '.git'))) { Write-SyncLog 'data is not a git repo; skipping'; exit 0 }

# One sync at a time: the logon pull and the 5-minute task can otherwise overlap.
$lock = $null
try { $lock = [IO.File]::Open((Join-Path $logDir 'sync.lock'), 'OpenOrCreate', 'ReadWrite', 'None') } catch { exit 0 }

try {
	# Commit first so a pull can never overwrite or conflict with uncommitted records.
	$null = Invoke-DataGit add -A
	if (Invoke-DataGit status --porcelain) { $null = Invoke-DataGit commit -q -m "Sync from $env:COMPUTERNAME" }

	$output = Invoke-DataGit pull --rebase -q origin main
	if ($LASTEXITCODE -ne 0) {
		$conflicted = Test-Path (Join-Path $data '.git\rebase-merge')
		$null = Invoke-DataGit rebase --abort
		if ($conflicted) { Write-SyncLog "CONFLICT: both computers changed the same record. Nothing was lost; it will retry, but this needs fixing by hand. $output" }
		else { Write-SyncLog "pull failed, will retry next run: $output" }
		exit 1
	}

	if (-not $PullOnly) {
		$output = Invoke-DataGit push -q origin main
		if ($LASTEXITCODE -ne 0) { Write-SyncLog "push failed, will retry next run: $output"; exit 1 }
	}
	exit 0
} finally {
	$lock.Dispose()
}
