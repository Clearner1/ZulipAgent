/**
 * Agent runner — creates and manages Pi Agent sessions per topic.
 * Adapted from mom's agent.ts pattern.
 *
 * Each Zulip stream+topic gets its own AgentRunner with persistent
 * session context (context.jsonl). Runners are cached in memory.
 */

import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import { execSync } from "child_process";
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
import { existsSync, readFileSync, mkdirSync, statSync, writeFileSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { homedir } from "os";
import { join, resolve } from "path";
import { Type } from "@sinclair/typebox";

import type { BridgeConfig } from "./config.js";
import { syncLogToSessionManager, BridgeSettingsManager } from "./context.js";
import type { ChannelStore } from "./store.js";
import { runReflection, runMemoryFlush, runPostRunMemoryExtraction, extractConversationText } from "./reflection.js";
import type { Model, Api } from "@mariozechner/pi-ai";

// Max context.jsonl file size in bytes before auto-pruning (~800KB ≈ ~160K tokens).
// The GLM-4.7 model has a 200K context limit; we leave headroom for system prompt.
const MAX_CONTEXT_FILE_BYTES = 800_000;

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

// Build browser-specific model (stronger model for bb-browser tasks)
function buildBrowserModel(config: BridgeConfig): Model<"anthropic-messages"> | null {
    if (!config.browserModel || !config.browserApiKey) return null;
    const isThinking = config.browserModel.toLowerCase().includes("thinking");
    return {
        id: config.browserModel,
        name: config.browserModel,
        api: "anthropic-messages" as const,
        provider: config.browserProvider || config.llmProvider,
        baseUrl: config.browserBaseUrl || config.llmBaseUrl,
        reasoning: isThinking,
        input: ["text", "image"] as ("text" | "image")[],
        cost: {
            input: 15,
            output: 75,
            cacheRead: 1.5,
            cacheWrite: 18.75,
        },
        contextWindow: 200000,
        maxTokens: isThinking ? 128000 : 64000,
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
        messageId?: number;  // Zulip message ID for reactions
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
    agentCwd: string,
): string {
    const topicPath = `${workspacePath}/${stream}/${topic}`;
    const eventsPath = `${workspacePath}/events`;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Load workspace identity files from project root
    const projectRoot = join(workspacePath, "..");

    // SOUL.md — defines agent persona and tone
    let soulSection = "";
    const soulPath = join(projectRoot, "SOUL.md");
    if (existsSync(soulPath)) {
        try {
            const soulContent = readFileSync(soulPath, "utf-8").trim();
            if (soulContent) {
                soulSection = `\n## Soul (Persona & Tone)\nEmbody the persona and tone defined below. Follow this guidance.\n\n${soulContent}\n`;
            }
        } catch { }
    }

    // USER.md — who you're helping
    let userSection = "";
    const userMdPath = join(projectRoot, "USER.md");
    if (existsSync(userMdPath)) {
        try {
            const userContent = readFileSync(userMdPath, "utf-8").trim();
            if (userContent) {
                userSection = `\n## User Profile\n${userContent}\n`;
            }
        } catch { }
    }

    // AGENTS.md — operating manual
    let agentsSection = "";
    const agentsMdPath = join(projectRoot, "AGENTS.md");
    if (existsSync(agentsMdPath)) {
        try {
            const agentsContent = readFileSync(agentsMdPath, "utf-8").trim();
            if (agentsContent) {
                agentsSection = `\n## Operating Manual\n${agentsContent}\n`;
            }
        } catch { }
    }

    // LESSONS.md — accumulated experiential knowledge
    let lessonsSection = "";
    const lessonsPath = join(workspacePath, "LESSONS.md");
    if (existsSync(lessonsPath)) {
        try {
            const lessonsContent = readFileSync(lessonsPath, "utf-8").trim();
            if (lessonsContent) {
                lessonsSection = `\n## Lessons Learned (经验本)\nThese lessons were extracted from past runs. Apply them before trying alternatives.\n\n${lessonsContent}\n`;
            }
        } catch { }
    }

    return `You are a Zulip bot assistant. Be concise. No emojis.
${soulSection}${userSection}${agentsSection}${lessonsSection}

## Context
- For current date/time, use: date
- You have access to previous conversation context including tool results from prior turns.
- For older history beyond your context, search log.jsonl.
- **Important**: For queries about tasks, diary, or any real-time data, ALWAYS re-run the tool/script to get fresh data. Never reuse results from previous turns — the data may have changed.

## Zulip Formatting (Markdown)
Bold: **text**, Italic: *text*, Code: \`code\`, Block: \`\`\`code\`\`\`, Links: [text](url)
Mention users with @**username** format.

## Multi-Message Replies — 像人一样聊天
You have a \`reply\` tool. Use it frequently. Humans don't send one giant message — they chat in fragments. You should too.

**Default behavior:** When you need to do any work (read files, run scripts, check tasks), ALWAYS send a quick reply first, then do the work, then give results. Don't make the user stare at a blank screen.

**Examples of natural multi-message flow:**
- Zane: "帮我看看今天的任务" → reply("好的，让我查一下") → run task script → final: "你今天有3个任务..."
- Zane: "最近怎么样" → reply("嘿！让我先看看最近的记忆") → read MEMORY.md → final: "看了一下，上次你在..."
- Zane: "帮我写个脚本" → reply("没问题，我想想怎么写") → write file → final: "写好了，在 xxx 路径"

**When to use reply:**
- Before doing any tool call or bash command (let user know you're on it)
- When you have a quick reaction before diving into work
- When reporting progress on multi-step tasks
- When you want to acknowledge + act (don't just silently work)

**When NOT to use reply:**
- Simple questions that don't need tool calls (just answer directly)
- When your response is short enough to be one message

**Important:** If you use reply as your LAST action (no more tool calls or work to do after it), do NOT write any additional final text. The reply already delivered your message. Just stop — no need to repeat or paraphrase what you already sent via reply.

## Self-Evolution (自我进化)
Your past lessons are in "Lessons Learned" above. Use them:
- Before running a tool, check lessons for known solutions
- If a lesson says "pip不可用，用pip3", follow it immediately
- You may also manually append lessons to ${workspacePath}/LESSONS.md

## Environment
You are running directly on the host machine.
- Bash working directory: ${agentCwd}
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

### Response Modes
You don't have to reply to every message with text. Choose the appropriate mode:
- **Normal reply** — reply with text as usual (questions, requests, tasks)
- \`[SILENT]\` — say nothing. Use for periodic events with nothing to report, or when the user sends a pure acknowledgment like "ok", "知道了", "好的"
- \`[REACT:emoji_name]\` — send only an emoji reaction, no text. Read the zulip-react skill to find available emojis. Pick one that matches the mood naturally.

Be natural — don't force a reply when none is needed.

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
    forceRecreate = false,
): AgentRunner {
    const key = `${stream}:${topic}`;
    const existing = topicRunners.get(key);
    if (existing && !forceRecreate) return existing;

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

    // Agent bash working directory
    const agentCwd = "/Users/loumac/Downloads";

    // Load initial resources
    const memory = getMemory(topicDir, workspaceDir);
    const skills = loadBridgeSkills(topicDir, workspaceDir);
    const systemPrompt = buildSystemPrompt(workspaceDir, safeStream, safeTopic, memory, skills, agentCwd);

    // Create session manager (persistent file per topic)
    const contextFile = join(topicDir, "context.jsonl");
    const sessionManager = SessionManager.open(contextFile, topicDir);
    const settingsManager = new BridgeSettingsManager(workspaceDir);

    // Auth storage — register our custom API key so AgentSession can find it
    const authStorage = new AuthStorage(join(homedir(), ".pi", "zulip-bridge", "auth.json"));
    authStorage.setRuntimeApiKey(config.llmProvider, config.llmApiKey);
    if (config.browserApiKey && config.browserProvider) {
        authStorage.setRuntimeApiKey(config.browserProvider, config.browserApiKey);
    }
    const modelRegistry = new ModelRegistry(authStorage);

    // Mutable ref for the current respond function (set per-run)
    const respondRef: { current: ((text: string) => Promise<void>) | null } = { current: null };

    // Tools: standard coding tools + custom reply tool
    const tools = createCodingTools(agentCwd);

    // reply tool — sends an immediate message to the user while continuing work
    const replyTool: any = {
        name: "reply",
        label: "Send interim message",
        description: "Send a message to the user immediately, then continue working. Use this to send quick updates like '让我看看' before doing more work. The final text response will also be sent as usual.",
        parameters: Type.Object({
            message: Type.String({ description: "The message to send immediately" }),
        }),
        async execute(toolCallId: string, params: { message: string }) {
            let text = params.message?.trim() || "";
            // Sanitize: strip leaked think tags
            if (text.includes("</think>")) { text = text.split("</think>")[0].trim(); }
            text = text.replace(/<\/?think>/g, "").trim();
            if (!text) {
                return { content: [{ type: "text" as const, text: "No message provided" }], details: {} };
            }

            // Intercept [SILENT] — don't send anything (case-insensitive)
            if (/\[silent\]/i.test(text)) {
                console.log(`[reply-tool] Silent — suppressed`);
                return { content: [{ type: "text" as const, text: "Silent — no message sent" }], details: {} };
            }

            // Intercept [REACT:emoji] — send emoji reaction instead of text (case-insensitive)
            const reactMatch = text.match(/\[react:(\w+)\]/i);
            if (reactMatch && runState.ctx?.message.messageId) {
                const emoji = reactMatch[1];
                try {
                    execSync(`bash ${join(workspaceDir, "skills/zulip-react/scripts/react.sh")} ${runState.ctx.message.messageId} ${emoji}`, { timeout: 5000 });
                    console.log(`[reply-tool] React-only: :${emoji}: on msg ${runState.ctx.message.messageId}`);
                } catch (err) {
                    console.log(`[reply-tool] React failed: ${(err as Error).message}`);
                }
                return { content: [{ type: "text" as const, text: `Reacted with :${emoji}:` }], details: {} };
            }

            if (respondRef.current) {
                await respondRef.current(text);
                console.log(`[reply-tool] Sent: "${text.slice(0, 60)}"`);
                return { content: [{ type: "text" as const, text: `Message sent: "${text.slice(0, 50)}"` }], details: {} };
            }
            return { content: [{ type: "text" as const, text: "No active conversation" }], details: {} };
        },
    };
    tools.push(replyTool);

    // Check if this stream should use the stronger browser model
    const useBrowserModel = config.browserStreams.includes(safeStream);
    const browserModel = useBrowserModel ? buildBrowserModel(config) : null;
    const model = browserModel || buildModel(config);
    const isThinking = model.reasoning === true;

    if (browserModel) {
        console.log(`[agent] [${stream}/${topic}] Using browser model: ${browserModel.id}${isThinking ? " (thinking)" : ""}`);
    }

    // Create agent
    const agent = new Agent({
        initialState: {
            systemPrompt,
            model,
            thinkingLevel: isThinking ? "medium" : "off",
            tools,
        },
        convertToLlm,
        getApiKey: async () => {
            return browserModel ? (config.browserApiKey || config.llmApiKey) : config.llmApiKey;
        },
    });

    // Load existing messages from context.jsonl (with size guard)
    const contextFileSize = existsSync(contextFile) ? statSync(contextFile).size : 0;
    if (contextFileSize > MAX_CONTEXT_FILE_BYTES) {
        console.log(
            `[agent] [${stream}/${topic}] ⚠️ context.jsonl is ${(contextFileSize / 1024).toFixed(0)}KB — exceeds ${(MAX_CONTEXT_FILE_BYTES / 1024).toFixed(0)}KB limit, resetting to prevent overflow`,
        );
        writeFileSync(contextFile, "");
        // Reopen session manager after reset
        const freshSession = SessionManager.open(contextFile, topicDir);
        Object.assign(sessionManager, freshSession);
    }
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
        failedTools: [] as Array<{ toolName: string; error: string }>,
        totalToolCalls: 0,
        lastToolName: "" as string,  // track last completed tool
        replyUsed: false,  // whether reply tool was called this run
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
            runState.totalToolCalls++;
            runState.lastToolName = agentEvent.toolName;
            if (agentEvent.toolName === "reply") {
                runState.replyUsed = true;
            }
            const pending = pendingTools.get(agentEvent.toolCallId);
            pendingTools.delete(agentEvent.toolCallId);
            const durationMs = pending ? Date.now() - pending.startTime : 0;
            const duration = (durationMs / 1000).toFixed(1);
            const status = agentEvent.isError ? "✗" : "✓";
            console.log(
                `[agent] ${status} ${agentEvent.toolName} (${duration}s)`,
            );
            if (agentEvent.isError) {
                const errorText = typeof agentEvent.result === "string"
                    ? agentEvent.result.slice(0, 200)
                    : JSON.stringify(agentEvent.result)?.slice(0, 200) || "unknown error";
                runState.failedTools.push({
                    toolName: agentEvent.toolName,
                    error: errorText,
                });
            }
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
            // Memory flush: save durable memories before compaction
            try {
                const conversationText = extractConversationText(session.messages as any[]);
                if (conversationText.length > 100) {
                    runMemoryFlush({
                        conversationSummary: conversationText,
                        topicDir,
                        workspaceDir,
                        config,
                        stream: safeStream,
                        topic: safeTopic,
                    }).catch(err => console.log(`[memory-flush] Error: ${(err as Error).message}`));
                }
            } catch (err) {
                console.log(`[memory-flush] Extract error: ${(err as Error).message}`);
            }
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
            console.log(`[debug:run] ENTER stream=${stream} topic=${topic} ts=${ctx.message.ts} text="${ctx.message.text.slice(0, 40)}"`);
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
            const freshPrompt = buildSystemPrompt(workspaceDir, safeStream, safeTopic, memory, skills, agentCwd);
            session.agent.setSystemPrompt(freshPrompt);

            // Reset per-run state
            runState.ctx = ctx;
            respondRef.current = ctx.respond;
            runState.pendingTools.clear();
            runState.failedTools = [];
            runState.totalToolCalls = 0;
            runState.lastToolName = "";
            runState.replyUsed = false;
            runState.totalUsage = { input: 0, output: 0, cost: 0 };
            runState.stopReason = "stop";
            runState.errorMessage = undefined;

            // Snapshot browser tabs before run (for cleanup after)
            let preRunTabIds = new Set<number>();
            try {
                const raw = execSync("bb-browser tab --json 2>/dev/null", { timeout: 3000 }).toString().trim();
                const parsed = JSON.parse(raw);
                const tabs = parsed?.data?.tabs;
                if (Array.isArray(tabs)) {
                    preRunTabIds = new Set(tabs.map((t: any) => t.tabId));
                }
            } catch { /* bb-browser not running — fine */ }

            // Build user message with timestamp and username
            const now = new Date();
            const pad = (n: number) => n.toString().padStart(2, "0");
            const offset = -now.getTimezoneOffset();
            const offsetSign = offset >= 0 ? "+" : "-";
            const offsetHours = pad(Math.floor(Math.abs(offset) / 60));
            const offsetMins = pad(Math.abs(offset) % 60);
            const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${offsetSign}${offsetHours}:${offsetMins}`;
            const userMessage = `[${timestamp}] [${ctx.message.userName || "unknown"}] [msg:${ctx.message.messageId || ctx.message.ts}]: ${ctx.message.text}`;

            // Debug: write context snapshot
            const debugContext = {
                systemPrompt: freshPrompt,
                messageCount: session.messages.length,
                newUserMessage: userMessage,
            };
            await writeFile(join(topicDir, "last_prompt.json"), JSON.stringify(debugContext, null, 2));

            // Run the agent (with overflow recovery)
            try {
                await session.prompt(userMessage);
            } catch (promptErr: any) {
                const errMsg = promptErr?.message || String(promptErr);
                // Detect context overflow errors (GLM-4 style)
                if (/input length.*exceeds.*maximum/i.test(errMsg) ||
                    /request.?too.?large/i.test(errMsg) ||
                    /context.?overflow/i.test(errMsg)) {
                    console.log(`[agent] [${stream}/${topic}] ⚠️ Context overflow detected — resetting context and retrying`);
                    // Clear context file
                    writeFileSync(contextFile, "");
                    // Reopen session and retry with just the current message
                    const freshSessionManager = SessionManager.open(contextFile, topicDir);
                    Object.assign(sessionManager, freshSessionManager);
                    agent.replaceMessages([]);
                    try {
                        await session.prompt(userMessage);
                    } catch (retryErr: any) {
                        console.error(`[agent] [${stream}/${topic}] Retry after overflow reset also failed: ${retryErr?.message}`);
                        throw retryErr;
                    }
                } else {
                    throw promptErr;
                }
            }

            // Extract final text
            const messages = session.messages;
            const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
            const finalText = (() => {
                let text = lastAssistant?.content
                    .filter((c): c is { type: "text"; text: string } => c.type === "text")
                    .map((c) => c.text)
                    .join("\n") || "";
                // Sanitize: strip leaked </think> tags and anything after
                if (text.includes("</think>")) {
                    text = text.split("</think>")[0].trim();
                }
                // Sanitize: strip leaked <think> tags
                text = text.replace(/<\/?think>/g, "").trim();
                return text;
            })();

            // Handle [SILENT] responses (case-insensitive, flexible match)
            if (/\[silent\]/i.test(finalText)) {
                console.log("[agent] Silent response — suppressed output");
            } else if (/\[react:(\w+)\]/i.test(finalText)) {
                // Handle [REACT:emoji] — send emoji reaction instead of text
                const emojiMatch = finalText.match(/\[react:(\w+)\]/i);
                if (emojiMatch && ctx.message.messageId) {
                    const emoji = emojiMatch[1];
                    try {
                        execSync(`bash ${join(workspaceDir, "skills/zulip-react/scripts/react.sh")} ${ctx.message.messageId} ${emoji}`, { timeout: 5000 });
                        console.log(`[agent] React-only response: :${emoji}: on msg ${ctx.message.messageId}`);
                    } catch (err) {
                        console.log(`[agent] React failed: ${(err as Error).message}`);
                    }
                }
            } else if (runState.replyUsed) {
                // Reply was used this run → Andy already sent messages to user.
                // Suppress final response to avoid repeating/paraphrasing the reply.
                console.log(`[debug:run] SUPPRESS final (reply was used): "${finalText.slice(0, 60)}"`);
                // Still log it for debugging, but don't send to Zulip
            } else if (finalText.trim()) {
                // Send response to Zulip
                console.log(`[debug:run] RESPOND len=${finalText.length} text="${finalText.slice(0, 60)}"`);
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

            // Post-run reflection: extract lessons from failures
            runReflection({
                failedTools: [...runState.failedTools],
                totalToolCalls: runState.totalToolCalls,
                workspaceDir,
                config,
            }).catch(err => console.log(`[reflection] Error: ${(err as Error).message}`));

            // Post-run memory extraction (方案 A + 硬条件过滤): 4 道门槛后才触发 LLM
            runPostRunMemoryExtraction({
                messages: session.messages as any[],
                totalToolCalls: runState.totalToolCalls,
                topicDir,
                workspaceDir,
                config,
                stream: safeStream,
                topic: safeTopic,
            }).catch(err => console.log(`[post-run-memory] Error: ${(err as Error).message}`));

            // Post-run: auto-close browser tabs opened during this run
            if (runState.totalToolCalls > 0) {
                try {
                    const raw = execSync("bb-browser tab --json 2>/dev/null", { timeout: 3000 }).toString().trim();
                    const parsed = JSON.parse(raw);
                    const tabs = parsed?.data?.tabs;
                    if (Array.isArray(tabs)) {
                        const newTabs = tabs.filter((t: any) => !preRunTabIds.has(t.tabId));
                        for (const tab of newTabs) {
                            try { execSync(`bb-browser tab close --id ${tab.tabId}`, { timeout: 2000 }); } catch { }
                        }
                        if (newTabs.length > 0) {
                            console.log(`[agent] Auto-closed ${newTabs.length} browser tab(s) opened during run`);
                        }
                    }
                } catch {
                    // bb-browser not running or no tabs — ignore silently
                }
            }

            return { stopReason: runState.stopReason, errorMessage: runState.errorMessage };
        },

        abort(): void {
            session.abort();
        },
    };
}
