@echo off
title Python and ngrok Auto Starter

REM Step 1. Move to working directory
cd /d "C:\labview-dashboard\backend"

REM Step 2. Run Python server
echo Starting Python Server...
start "PythonServer" cmd /k "python main.py"

REM Step 3. Wait for server to start
timeout /t 3 /nobreak > nul

REM Step 4. Run ngrok tunnel
echo Starting ngrok Tunnel...
start "ngrokTunnel" cmd /k "ngrok http 8000"

echo All processes started!