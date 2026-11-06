# Syncs data/ (chats, graph, settings) with its private GitHub repo.
# On a conflict it stops and logs, leaving both versions in git. It never discards anything.
param([switch]$PullOnly)

$data = Join-Path $PSScriptRoot '..\..\data'
$logDir = Join-Path $env:LOCALAPPDATA 'LearnHarnessAutostart'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir 'sync.log'

function Write-SyncLog($message) { "$(Get-Date -Format s) $message" | Add-Content -Path $log -Encoding utf8 }
function Invoke-DataGit { & git -C $data @args 2>&1 | Out-String }

if (-not (Test-Path (Join-Path $data '.git'))) { Write-SyncLog 'data is not a git repo; skipping'; exit 0 }

# Commit first so a pull can never overwrite or conflict with uncommitted records.
$null = Invoke-DataGit add -A
if ((Invoke-DataGit status --porcelain).Trim()) { $null = Invoke-DataGit commit -q -m "Sync from $env:COMPUTERNAME" }

$output = Invoke-DataGit pull --rebase -q origin main
if ($LASTEXITCODE -ne 0) {
	$null = Invoke-DataGit rebase --abort
	Write-SyncLog "CONFLICT: both computers changed the same record. Nothing was lost, but syncing is paused. $output"
	exit 1
}

if (-not $PullOnly) {
	$output = Invoke-DataGit push -q origin main
	if ($LASTEXITCODE -ne 0) { Write-SyncLog "push failed, will retry next run: $output"; exit 1 }
}
exit 0
