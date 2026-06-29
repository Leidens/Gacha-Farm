Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c cd /d ""C:\Users\funty\Desktop\Projet gacha\v6"" && npx vite --port 4000", 0, False
WScript.Sleep 3000
WshShell.Run "http://localhost:4000"
Set WshShell = Nothing