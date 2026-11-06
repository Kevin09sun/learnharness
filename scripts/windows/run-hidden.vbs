' Runs a .cmd or .ps1 with no console window and passes its exit code to Task Scheduler.
target = WScript.Arguments(0)
If LCase(Right(target, 4)) = ".ps1" Then
	command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & target & """"
Else
	command = "cmd.exe /c """ & target & """"
End If
Set shell = CreateObject("WScript.Shell")
WScript.Quit shell.Run(command, 0, True)
