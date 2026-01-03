# watson-bot

A command-based Telegram bot ("Watson") that gives dry, non-shaming observations and summaries.

## Setup (Windows PowerShell)
1) Put this folder somewhere (e.g., Documents\watson-bot)
2) In the folder, create a real `.env` file (see `.env.example`)
3) Install deps:
   npm install
4) Run:
   npm start

## Test
- In Telegram DM with your bot: /rules
- In your group: /summary, /observe

## Notes
- This MVP uses long polling, so it must be running somewhere (your PC or a host) to respond.
- The console will print `INCOMING` when Telegram updates reach your bot.
