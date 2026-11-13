' Contractors Guild — hidden boot launcher.
' Windows runs this at logon (Startup folder). It starts the headless server
' with no visible window; output goes to logs/serve.log instead.
Set shell = CreateObject("WScript.Shell")
project = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\scripts") - 1)
node = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If Not CreateObject("Scripting.FileSystemObject").FileExists(node) Then
  node = "node.exe"
End If
shell.CurrentDirectory = project
shell.Run """" & node & """ scripts\serve.mjs run", 0, False
