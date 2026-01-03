# watson-bot

A command-based Telegram bot ("Watson") that gives dry, non-shaming observations and summaries.

## Commands
- /rules
- /summary (incremental: since your last /summary)
- /catchup (incremental: what happened while Watson was off)
- /observe
- /silence

## Setup (Windows PowerShell)
1) Put this folder somewhere (e.g., Documents\watson-bot)
2) Create a real `.env` file (see `.env.example`)
3) Install deps:
   npm install
4) Run:
   npm start

### Double-click start
- `Start-Watson.bat` (normal)
- `Start-Watson-Background.bat` (minimized, logs to `data\watson.log`)
- `Stop-Watson.bat` (stops the minimized background window)

## Notes
- Long polling: Watson must be running somewhere to respond.
- Watson stores local history in `data/` (ignored by git). This is what makes /summary and /catchup useful.
