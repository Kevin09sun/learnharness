# Sets up LearnHarness on a Windows computer: learning data, dependencies, build, and the
# two scheduled tasks. Safe to run again. Needs git, Node, and a logged-in gh and Claude Code.
# -TasksOnly just (re)registers the tasks, for example after moving the repo.
param([switch]$TasksOnly)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$data = Join-Path $repo 'data'
Set-Location $repo

if (-not $TasksOnly) {
	foreach ($tool in 'git', 'node', 'npm', 'gh', 'claude') {
		if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not installed." }
	}
	gh auth setup-git
	if (-not (Test-Path (Join-Path $data '.git'))) {
		if ((Test-Path $data) -and (Get-ChildItem $data -Force)) { throw "$data has files but is not a git repo. Move them aside first." }
		$url = (git -C $repo remote get-url origin) -replace '/learnharness(\.git)?$', '/learnharness-data.git'
		git clone $url $data
		if ($LASTEXITCODE -ne 0) { throw 'Could not clone the learning data.' }
	}
	npm ci --no-fund --no-audit
	if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
	npm run build
	if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
}

$me = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
New-Item -ItemType Directory -Force (Join-Path $env:LOCALAPPDATA 'LearnHarnessAutostart') | Out-Null

function New-HiddenAction($script) {
	$arguments = '"' + (Join-Path $PSScriptRoot 'run-hidden.vbs') + '" "' + (Join-Path $PSScriptRoot $script) + '"'
	New-ScheduledTaskAction -Execute 'wscript.exe' -Argument $arguments
}

$serverSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -Priority 5
# Restart-on-failure only covers a failed launch, not a running server that gets killed later.
# The 5-minute trigger brings it back: while the server runs, IgnoreNew makes each firing a no-op.
$serverTriggers = @(
	(New-ScheduledTaskTrigger -AtLogOn -User $me),
	(New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5))
)
Register-ScheduledTask -TaskName 'LearnHarness' -Force -Principal $principal -Settings $serverSettings `
	-Action (New-HiddenAction 'start-server.cmd') `
	-Trigger $serverTriggers `
	-Description 'Starts the LearnHarness server at logon (127.0.0.1:3000) and restarts it within 5 minutes if it stops.' | Out-Null

$syncSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 4)
Register-ScheduledTask -TaskName 'LearnHarness Data Sync' -Force -Principal $principal -Settings $syncSettings `
	-Action (New-HiddenAction 'sync-data.ps1') `
	-Trigger (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)) `
	-Description 'Backs up LearnHarness learning data to its private GitHub repo every 5 minutes.' | Out-Null

Write-Host 'Done. Log out and back in, or run: Start-ScheduledTask LearnHarness'
