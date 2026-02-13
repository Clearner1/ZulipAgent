/**
 * Agent runner — creates and manages Pi Agent sessions per topic.
 * Adapted from mom's agent.ts pattern.
 *
 * Each Zulip stream+topic gets its own AgentRunner with persistent
 * session context (context.jsonl). Runners are cached in memory.
 */

import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
// getModel no longer needed — we build custom models from config
import {
    AgentSession,
    AuthStorage,
    convertToLlm,
    createExtensionRuntime,
    formatSkillsForPrompt,
    loadSkillsFromDir,
    type ResourceLoader,
    SessionManager,
    ModelRegistry,
    type Skill,
    createCodingTools,
} from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { homedir } from "os";
import { join, resolve } from "path";

import type { BridgeConfig } from "./config.js";
import { syncLogToSessionManager, BridgeSettingsManager } from "./context.js";
import type { ChannelStore } from "./store.js";
import type { Model, Api } from "@mariozechner/pi-ai";

// Build model from config — supports custom base URL and model name
function buildModel(config: BridgeConfig): Model<"anthropic-messages"> {
    return {
        id: config.llmModel,
        name: config.llmModel,
        api: "anthropic-messages" as const,
        provider: config.llmProvider,
        baseUrl: config.llmBaseUrl,
        reasoning: false,
        input: ["text", "image"] as ("text" | "image")[],
        cost: {
            input: 3,
            output: 15,
            cacheRead: 0.3,
            cacheWrite: 3.75,
        },
        contextWindow: 200000,
        maxTokens: 64000,
    };
}

// ============================================================================
// Types
// ============================================================================

export interface ZulipContext {
    message: {
        text: string;
        user: string;
        userName: string;
        stream: string;
        topic: string;
        ts: string;
    };
    respond: (text: string) => Promise<void>;
    setTyping: (isTyping: boolean) => Promise<void>;
}

export interface AgentRunner {
    run(ctx: ZulipContext, store: ChannelStore): Promise<{ stopReason: string; errorMessage?: string }>;
    abort(): void;
}

// ============================================================================
// Memory
// ============================================================================

function getMemory(topicDir: string, workspaceDir: string): string {
    const parts: string[] = [];

    // Workspace-level memory (shared across all topics)
    const globalMemoryPath = join(workspaceDir, "MEMORY.md");
    if (existsSync(globalMemoryPath)) {
        try {
            const content = readFileSync(globalMemoryPath, "utf-8").trim();
            if (content) parts.push(`### Global Memory\n${content}`);
        } catch { }
    }

    // Topic-specific memory
    const topicMemoryPath = join(topicDir, "MEMORY.md");
    if (existsSync(topicMemoryPath)) {
        try {
            const content = readFileSync(topicMemoryPath, "utf-8").trim();
            if (content) parts.push(`### Topic Memory\n${content}`);
        } catch { }
    }

    return parts.length > 0 ? parts.join("\n\n") : "(no working memory yet)";
}

// ============================================================================
// Skills
// ============================================================================

function loadBridgeSkills(topicDir: string, workspaceDir: string): Skill[] {
    const skillMap = new Map<string, Skill>();

    // Workspace-level skills
    const workspaceSkillsDir = join(workspaceDir, "skills");
    for (const skill of loadSkillsFromDir({ dir: workspaceSkillsDir, source: "workspace" }).skills) {
        skillMap.set(skill.name, skill);
    }

    // Topic-specific skills (override workspace on collision)
    const topicSkillsDir = join(topicDir, "skills");
    for (const skill of loadSkillsFromDir({ dir: topicSkillsDir, source: "topic" }).skills) {
        skillMap.set(skill.name, skill);
    }

    return Array.from(skillMap.values());
}

// ============================================================================
// System Prompt
// ============================================================================

function buildSystemPrompt(
    workspacePath: string,
    stream: string,
    topic: string,
    memory: string,
    skills: Skill[],
): string {
    const topicPath = `${workspacePath}/${stream}/${topic}`;
    const eventsPath = `${workspacePath}/events`;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    return `You are a Zulip bot assistant. Be concise. No emojis.

## Context
- For current date/time, use: date
- You have access to previous conversation context including tool results from prior turns.
- For older history beyond your context, search log.jsonl.
- **Important**: For queries about tasks, diary, or any real-time data, ALWAYS re-run the tool/script to get fresh data. Never reuse results from previous turns — the data may have changed.

## Zulip Formatting (Markdown)
Bold: **text**, Italic: *text*, Code: \`code\`, Block: \`\`\`code\`\`\`, Links: [text](url)
Mention users with @**username** format.

## Environment
You are running directly on the host machine.
- Bash working directory: ${process.cwd()}
- Be careful with system modifications

## Workspace Layout
${workspacePath}/
├── MEMORY.md                    # Global memory (all topics)
├── settings.json                # Bot settings
├── events/                      # Scheduled event files
├── skills/                      # Global CLI tools
└── ${stream}/${topic}/          # This topic
    ├── MEMORY.md                # Topic-specific memory
    ├── log.jsonl                # Message history
    ├── context.jsonl            # LLM context
    └── scratch/                 # Working directory

## Skills (Custom CLI Tools)
Create reusable CLI tools for recurring tasks.

### Creating Skills
Store in \`${workspacePath}/skills/<name>/\` (global) or \`${topicPath}/skills/<name>/\` (topic).
Each skill needs a \`SKILL.md\` with YAML frontmatter:
\`\`\`markdown
---
name: skill-name
description: Short description
---
# Skill Name
Usage instructions. Scripts are in: {baseDir}/
\`\`\`

### Available Skills
${skills.length > 0 ? formatSkillsForPrompt(skills) : "(no skills installed yet)"}

## Events
Schedule events that wake you at specific times. Events are JSON files in \`${eventsPath}/\`.

### Event Types

**Immediate** - Triggers right away. Use in scripts/webhooks.
\`\`\`json
{"type": "immediate", "stream": "${stream}", "topic": "${topic}", "text": "New notification"}
\`\`\`

**One-shot** - Triggers at a specific time, then deleted.
\`\`\`json
{"type": "one-shot", "stream": "${stream}", "topic": "${topic}", "text": "Reminder", "at": "2025-12-15T09:00:00+08:00"}
\`\`\`

**Periodic** - Triggers on cron schedule. Persists until deleted.
\`\`\`json
{"type": "periodic", "stream": "${stream}", "topic": "${topic}", "text": "Check inbox", "schedule": "0 9 * * 1-5", "timezone": "${tz}"}
\`\`\`

### Cron Format
\`minute hour day-of-month month day-of-week\`
- \`0 9 * * *\` = daily at 9:00
- \`0 9 * * 1-5\` = weekdays at 9:00
- \`0 0 1 * *\` = first of month at midnight

### Timezones
All \`at\` timestamps must include offset. Periodic events use IANA timezone names.
The bot runs in ${tz}. Assume ${tz} when users don't specify.

### Creating Events
Use unique filenames:
\`\`\`bash
cat > ${eventsPath}/reminder-$(date +%s).json << 'EOF'
{"type": "one-shot", "stream": "${stream}", "topic": "${topic}", "text": "Reminder", "at": "2025-12-15T09:00:00+08:00"}
EOF
\`\`\`

### Managing Events
- List: \`ls ${eventsPath}/\`
- View: \`cat ${eventsPath}/foo.json\`
- Delete: \`rm ${eventsPath}/foo.json\`

### When Events Trigger
You receive a message like:
\`[EVENT:reminder.json:one-shot:2025-12-15T09:00:00+08:00] Reminder text\`
Immediate and one-shot events auto-delete. Periodic events persist until deleted.

### Silent Completion
For periodic events with nothing to report, respond with just \`[SILENT]\`.
This suppresses the output. Use to avoid spamming.

### Limits
Maximum 5 events queued.

## Memory
Write to MEMORY.md files to persist context across conversations.
- Global (${workspacePath}/MEMORY.md): skills, preferences, project info
- Topic (${topicPath}/MEMORY.md): topic-specific decisions, ongoing work
Update when you learn something important.

### Current Memory
${memory}

## Log Queries (for older history)
Format: \`{"date":"...","ts":"...","user":"...","userName":"...","text":"...","isBot":false}\`
\`\`\`bash
# Recent messages
tail -30 ${topicPath}/log.jsonl | jq -c '{date: .date[0:19], user: (.userName // .user), text}'

# Search
grep -i "topic" ${topicPath}/log.jsonl | jq -c '{date: .date[0:19], user: (.userName // .user), text}'
\`\`\`

## Tools
- bash: Run shell commands (primary tool). Install packages as needed.
- read: Read files
- write: Create/overwrite files
- edit: Surgical file edits
`;
}

// ============================================================================
// Runner Cache
// ============================================================================

const topicRunners = new Map<string, AgentRunner>();

/**
 * Get or create an AgentRunner for a topic.
 * Runners are cached — one per stream+topic, persistent across messages.
 */
export function getOrCreateRunner(
    config: BridgeConfig,
    stream: string,
    topic: string,
): AgentRunner {
    const key = `${stream}:${topic}`;
    const existing = topicRunners.get(key);
    if (existing) return existing;

    const runner = createRunner(config, stream, topic);
    topicRunners.set(key, runner);
    return runner;
}

// ============================================================================
// Create Runner
// ============================================================================

function createRunner(
    config: BridgeConfig,
    stream: string,
    topic: string,
): AgentRunner {
    const workspaceDir = resolve(config.workingDir);
    const store = new (class {
        sanitize(name: string): string {
            return name.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, "-").toLowerCase().slice(0, 100);
        }
    })();
    const safeStream = store.sanitize(stream);
    const safeTopic = store.sanitize(topic);
    const topicDir = join(workspaceDir, safeStream, safeTopic);

    // Ensure topic directory exists
    mkdirSync(topicDir, { recursive: true });

    // Load initial resources
    const memory = getMemory(topicDir, workspaceDir);
    const skills = loadBridgeSkills(topicDir, workspaceDir);
    const systemPrompt = buildSystemPrompt(workspaceDir, safeStream, safeTopic, memory, skills);

    // Create session manager (persistent file per topic)
    const contextFile = join(topicDir, "context.jsonl");
    const sessionManager = SessionManager.open(contextFile, topicDir);
    const settingsManager = new BridgeSettingsManager(workspaceDir);

    // Auth storage — register our custom API key so AgentSession can find it
    const authStorage = new AuthStorage(join(homedir(), ".pi", "zulip-bridge", "auth.json"));
    authStorage.setRuntimeApiKey(config.llmProvider, config.llmApiKey);
    const modelRegistry = new ModelRegistry(authStorage);

    // Tools: use standard coding tools with Downloads as working directory
    const agentCwd = "/Users/loumac/Downloads";
    const tools = createCodingTools(agentCwd);

    // Create agent
    const model = buildModel(config);
    const agent = new Agent({
        initialState: {
            systemPrompt,
            model,
            thinkingLevel: "off",
            tools,
        },
        convertToLlm,
        getApiKey: async () => {
            return config.llmApiKey;
        },
    });

    // Load existing messages from context.jsonl
    const loadedSession = sessionManager.buildSessionContext();
    if (loadedSession.messages.length > 0) {
        agent.replaceMessages(loadedSession.messages);
        console.log(`[agent] [${stream}/${topic}] Loaded ${loadedSession.messages.length} messages from context`);
    }

    // Resource loader (minimal, we don't need extensions)
    const resourceLoader: ResourceLoader = {
        getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
        getSkills: () => ({ skills: [], diagnostics: [] }),
        getPrompts: () => ({ prompts: [], diagnostics: [] }),
        getThemes: () => ({ themes: [], diagnostics: [] }),
        getAgentsFiles: () => ({ agentsFiles: [] }),
        getSystemPrompt: () => systemPrompt,
        getAppendSystemPrompt: () => [],
        getPathMetadata: () => new Map(),
        extendResources: () => { },
        reload: async () => { },
    };

    const baseToolsOverride = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    // Create AgentSession
    const session = new AgentSession({
        agent,
        sessionManager,
        settingsManager: settingsManager as any,
        cwd: agentCwd,
        modelRegistry,
        resourceLoader,
        baseToolsOverride,
    });

    // Mutable per-run state
    const runState = {
        ctx: null as ZulipContext | null,
        pendingTools: new Map<string, { toolName: string; startTime: number }>(),
        totalUsage: { input: 0, output: 0, cost: 0 },
        stopReason: "stop",
        errorMessage: undefined as string | undefined,
    };

    // Subscribe to events ONCE
    session.subscribe(async (event) => {
        if (!runState.ctx) return;
        const { ctx, pendingTools } = runState;

        if (event.type === "tool_execution_start") {
            const agentEvent = event as AgentEvent & { type: "tool_execution_start" };
            const args = agentEvent.args as { label?: string };
            const label = args.label || agentEvent.toolName;
            pendingTools.set(agentEvent.toolCallId, {
                toolName: agentEvent.toolName,
                startTime: Date.now(),
            });
            console.log(`[agent] → ${agentEvent.toolName}: ${label}`);
        } else if (event.type === "tool_execution_end") {
            const agentEvent = event as AgentEvent & { type: "tool_execution_end" };
            const pending = pendingTools.get(agentEvent.toolCallId);
            pendingTools.delete(agentEvent.toolCallId);
            const durationMs = pending ? Date.now() - pending.startTime : 0;
            const duration = (durationMs / 1000).toFixed(1);
            const status = agentEvent.isError ? "✗" : "✓";
            console.log(
                `[agent] ${status} ${agentEvent.toolName} (${duration}s)`,
            );
        } else if (event.type === "message_end") {
            const agentEvent = event as AgentEvent & { type: "message_end" };
            if (agentEvent.message.role === "assistant") {
                const assistantMsg = agentEvent.message as any;
                if (assistantMsg.stopReason) runState.stopReason = assistantMsg.stopReason;
                if (assistantMsg.errorMessage) runState.errorMessage = assistantMsg.errorMessage;

                if (assistantMsg.usage) {
                    runState.totalUsage.input += assistantMsg.usage.input;
                    runState.totalUsage.output += assistantMsg.usage.output;
                    runState.totalUsage.cost += assistantMsg.usage.cost?.total || 0;
                }
            }
        } else if (event.type === "auto_compaction_start") {
            console.log("[agent] Compacting context...");
        } else if (event.type === "auto_compaction_end") {
            const compEvent = event as any;
            if (compEvent.result) {
                console.log(`[agent] Compaction complete: ${compEvent.result.tokensBefore} tokens`);
            }
        } else if (event.type === "auto_retry_start") {
            const retryEvent = event as any;
            console.log(`[agent] Retrying (${retryEvent.attempt}/${retryEvent.maxAttempts})...`);
        }
    });

    return {
        async run(
            ctx: ZulipContext,
            channelStore: ChannelStore,
        ): Promise<{ stopReason: string; errorMessage?: string }> {
            // Ensure topic directory exists
            await mkdir(topicDir, { recursive: true });

            // Sync log.jsonl → context
            const syncedCount = syncLogToSessionManager(sessionManager, topicDir, ctx.message.ts);
            if (syncedCount > 0) {
                console.log(`[agent] [${stream}/${topic}] Synced ${syncedCount} messages from log`);
            }

            // Reload messages from context
            const reloaded = sessionManager.buildSessionContext();
            if (reloaded.messages.length > 0) {
                agent.replaceMessages(reloaded.messages);
            }

            // Refresh system prompt with current memory and skills
            const memory = getMemory(topicDir, workspaceDir);
            const skills = loadBridgeSkills(topicDir, workspaceDir);
            const freshPrompt = buildSystemPrompt(workspaceDir, safeStream, safeTopic, memory, skills);
            session.agent.setSystemPrompt(freshPrompt);

            // Reset per-run state
            runState.ctx = ctx;
            runState.pendingTools.clear();
            runState.totalUsage = { input: 0, output: 0, cost: 0 };
            runState.stopReason = "stop";
            runState.errorMessage = undefined;

            // Build user message with timestamp and username
            const now = new Date();
            const pad = (n: number) => n.toString().padStart(2, "0");
            const offset = -now.getTimezoneOffset();
            const offsetSign = offset >= 0 ? "+" : "-";
            const offsetHours = pad(Math.floor(Math.abs(offset) / 60));
            const offsetMins = pad(Math.abs(offset) % 60);
            const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${offsetSign}${offsetHours}:${offsetMins}`;
            const userMessage = `[${timestamp}] [${ctx.message.userName || "unknown"}]: ${ctx.message.text}`;

            // Debug: write context snapshot
            const debugContext = {
                systemPrompt: freshPrompt,
                messageCount: session.messages.length,
                newUserMessage: userMessage,
            };
            await writeFile(join(topicDir, "last_prompt.json"), JSON.stringify(debugContext, null, 2));

            // Run the agent
            await session.prompt(userMessage);

            // Extract final text
            const messages = session.messages;
            const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
            const finalText =
                lastAssistant?.content
                    .filter((c): c is { type: "text"; text: string } => c.type === "text")
                    .map((c) => c.text)
                    .join("\n") || "";

            // Handle [SILENT] responses (for periodic events with nothing to report)
            if (finalText.trim() === "[SILENT]" || finalText.trim().startsWith("[SILENT]")) {
                console.log("[agent] Silent response — suppressed output");
            } else if (finalText.trim()) {
                // Send response to Zulip
                await ctx.respond(finalText);

                // Log bot response
                await channelStore.logBotResponse(ctx.message.stream, ctx.message.topic, finalText);
            }

            // Handle error
            if (runState.stopReason === "error" && runState.errorMessage) {
                try {
                    await ctx.respond(`❌ Error: ${runState.errorMessage}`);
                } catch { }
            }

            // Log usage
            if (runState.totalUsage.cost > 0) {
                console.log(
                    `[agent] Usage: ${runState.totalUsage.input} in / ${runState.totalUsage.output} out — $${runState.totalUsage.cost.toFixed(4)}`,
                );
            }

            return { stopReason: runState.stopReason, errorMessage: runState.errorMessage };
        },

        abort(): void {
            session.abort();
        },
    };
}
