# Quick Start

## Prerequisites
- Node.js 20+
- A Zulip server with a bot account
- Anthropic API key

## Setup

```bash
cd pi-zulip-bridge
npm install
cp .env.example .env
# Edit .env with your credentials
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ZULIP_URL` | ✅ | — | Zulip server URL |
| `ZULIP_BOT_EMAIL` | ✅ | — | Bot email (from Zulip Settings → Bots) |
| `ZULIP_BOT_API_KEY` | ✅ | — | Bot API key |
| `ANTHROPIC_API_KEY` | ✅ | — | Anthropic API key |
| `WORKING_DIR` | | `./data` | Workspace root for persistence |
| `TRIGGER_WORD` | | `""` | Only respond to messages starting with this word |

## Run

```bash
npm run dev
```

## Architecture

```
main.ts ──→ Per-topic state management
  ├── zulip.ts ──→ Event Queue polling + message sending
  ├── agent.ts ──→ Per-topic AgentRunner (Agent + AgentSession)
  ├── store.ts ──→ log.jsonl persistence per topic
  ├── context.ts ──→ Session sync + settings
  ├── events.ts ──→ Scheduled tasks (immediate/one-shot/periodic)
  └── config.ts ──→ Environment variables
```

## Data Layout

```
data/
├── MEMORY.md          # Global memory
├── settings.json      # Bot settings
├── events/            # Scheduled event JSON files
└── <stream>/<topic>/  # Per-topic data
    ├── log.jsonl      # Message history
    ├── context.jsonl  # LLM context (persistent)
    ├── MEMORY.md      # Topic-specific memory
    └── scratch/       # Agent working dir
```

## Events (Scheduled Tasks)

The agent can create scheduled tasks by writing JSON files to `data/events/`:

```json
// Immediate
{"type": "immediate", "stream": "general", "topic": "alerts", "text": "Server down!"}

// One-shot (fires once)
{"type": "one-shot", "stream": "general", "topic": "reminders", "text": "Meeting in 5 min", "at": "2025-12-15T09:00:00+08:00"}

// Periodic (cron)
{"type": "periodic", "stream": "general", "topic": "daily-report", "text": "Check inbox", "schedule": "0 9 * * 1-5", "timezone": "Asia/Shanghai"}
```
