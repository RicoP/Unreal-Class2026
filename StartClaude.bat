@echo off
rem Starts Claude Code in this repo and continues its last session.
rem   StartClaude.bat        continue the last session of this folder
rem   StartClaude.bat new    start a fresh session
rem
rem The Unreal MCP server (.mcp.json: http://127.0.0.1:8000/mcp) runs inside
rem the Unreal editor, and Claude only connects to it at startup. So this
rem script opens the project if the server isn't up yet and waits for it.

setlocal
cd /d "%~dp0"

set "MCP_PORT=8000"
set "WAIT_SECONDS=300"

call :mcp_up
if not errorlevel 1 goto start_claude

tasklist /fi "imagename eq UnrealEditor.exe" 2>nul | find /i "UnrealEditor.exe" >nul
if errorlevel 1 (
    echo Unreal MCP server is not running. Opening Platforming1.uproject ...
    start "" "%~dp0Platforming1.uproject"
) else (
    echo Unreal editor is running, but its MCP server does not answer yet.
)

echo Waiting up to %WAIT_SECONDS% seconds for port %MCP_PORT% ^(Ctrl+C to stop^) ...
set /a TRIES=WAIT_SECONDS/2
:wait_loop
call :mcp_up
if not errorlevel 1 goto start_claude
set /a TRIES-=1
if %TRIES% leq 0 (
    echo The MCP server did not come up. Starting Claude without it;
    echo once the editor is ready, type /mcp in Claude to reconnect.
    goto start_claude
)
timeout /t 2 /nobreak >nul
goto wait_loop

:start_claude
if /i "%~1"=="new" (
    call claude
) else (
    call claude --continue
)
endlocal
exit /b

:mcp_up
powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient('127.0.0.1', %MCP_PORT%)).Close(); exit 0 } catch { exit 1 }" >nul 2>&1
exit /b %errorlevel%
