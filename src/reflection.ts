/**
 * Post-run reflection & memory flush
 *
 * Two complementary mechanisms:
 * 1. Reflection — extracts lessons from tool failures → LESSONS.md
 * 2. Memory Flush — saves durable memories before compaction → MEMORY.md
 */

import { existsSync, readFileSync } from "fs";
import { appendFile, writeFile } from "fs/promises";
import { join } from "path";
import type { BridgeConfig } from "./config.js";

// ── Types ──────────────────────────────────────────────────────────────

interface FailedTool {
    toolName: string;
    error: string;
}

export interface ReflectionInput {
    failedTools: FailedTool[];
    totalToolCalls: number;
    workspaceDir: string;
    config: BridgeConfig;
}

export interface MemoryFlushInput {
    conversationSummary: string;
    topicDir: string;
    workspaceDir: string;
    config: BridgeConfig;
    stream: string;
    topic: string;
    existingMemory?: string;  // for deduplication — skip already-known info
}

export interface PostRunMemoryInput {
    messages: Array<{ role: string; content?: any }>;
    totalToolCalls: number;
    topicDir: string;
    workspaceDir: string;
    config: BridgeConfig;
    stream: string;
    topic: string;
}

// ── Constants ──────────────────────────────────────────────────────────

const MAX_LESSONS_LINES = 80;
const MAX_MEMORY_LINES = 200;

const REFLECTION_SYSTEM_PROMPT = `You are a reflection engine. Given a list of tool call failures from a recent agent run, extract concise, reusable lessons.

Rules:
- Output ONLY bullet points, one per line, starting with "- "
- Each lesson should be actionable and specific
- Include the date in parentheses at the end: (YYYY-MM-DD)
- Categorize with a prefix: [环境], [工具], [方案], or [偏好]
- If there's nothing useful to learn, output exactly: NOTHING
- Write in Chinese
- Maximum 5 lessons per reflection

Example output:
- [环境] 本机没有 pip，使用 pip3 代替 (2026-02-22)
- [工具] macOS 的 grep 不支持 -P (PCRE)，使用 grep -E 代替 (2026-02-22)
- [方案] 查询农历日期可以用 lunarcalendar 库: pip3 install lunarcalendar (2026-02-22)`;

const MEMORY_FLUSH_SYSTEM_PROMPT = `You are a memory extraction engine. You are given a conversation between a user and an AI assistant. Your job is to extract durable, important memories that should be preserved.

Rules:
- Extract ONLY information worth remembering long-term
- Output in Markdown format with sections
- Include: decisions made, user preferences discovered, important facts, ongoing tasks, key outcomes
- Do NOT include: greetings, small talk, transient debugging steps, intermediate failures
- **DEDUP**: If "Existing Memory" is provided below, DO NOT repeat information already recorded. Only output NEW information.
- If there's nothing NEW and durable to save, output exactly: NOTHING
- Write in Chinese
- Keep it concise — max 20 lines
- Include dates when relevant

Categories to extract:
## 重要决定
## 用户偏好
## 关键事实
## 进行中的任务

Example:
## 重要决定
- 选择使用 MiniMax M2.5 作为主力模型 (2026-02-22)

## 用户偏好
- Zane 喜欢简短口语化的回复

## 关键事实
- 项目部署在 chat.yzr-stack.top
- Python 版本 3.9 (系统自带)`;

// ── Reflection (LESSONS.md) ────────────────────────────────────────────

export async function runReflection(input: ReflectionInput): Promise<void> {
    const { failedTools, totalToolCalls, workspaceDir, config } = input;

    // Only reflect if there were failures or the run was complex
    if (failedTools.length === 0 && totalToolCalls < 4) {
        return;
    }

    // Guard: don't bloat LESSONS.md
    const lessonsPath = join(workspaceDir, "LESSONS.md");
    if (existsSync(lessonsPath)) {
        try {
            const content = readFileSync(lessonsPath, "utf-8");
            const lineCount = content.split("\n").length;
            if (lineCount > MAX_LESSONS_LINES) {
                console.log(`[reflection] LESSONS.md has ${lineCount} lines (max ${MAX_LESSONS_LINES}), skipping`);
                return;
            }
        } catch { }
    }

    // Build the reflection prompt
    const failureSummary = failedTools
        .map((f, i) => `${i + 1}. Tool: ${f.toolName}\n   Error: ${f.error}`)
        .join("\n");

    const userPrompt = failedTools.length > 0
        ? `The agent run had ${totalToolCalls} tool calls, ${failedTools.length} of which failed:\n\n${failureSummary}\n\nExtract reusable lessons from these failures.`
        : `The agent run had ${totalToolCalls} tool calls (all succeeded, but it was a complex run). Extract any reusable patterns or shortcuts if applicable. If nothing noteworthy, reply NOTHING.`;

    console.log(`[reflection] Triggering reflection (${failedTools.length} failures, ${totalToolCalls} tool calls)`);

    try {
        const response = await callLLM(config, REFLECTION_SYSTEM_PROMPT, userPrompt);

        if (!response || response.trim() === "NOTHING" || response.trim().length === 0) {
            console.log("[reflection] No lessons to record");
            return;
        }

        // Extract only lines that start with "- "
        const lessons = response
            .split("\n")
            .filter(line => line.trim().startsWith("- "))
            .join("\n");

        if (!lessons.trim()) {
            console.log("[reflection] No valid lesson lines found");
            return;
        }

        // Append to LESSONS.md
        const header = existsSync(lessonsPath) ? "" : "# Andy's Lessons Learned (经验本)\n> Auto-maintained by post-run reflection. Andy can also edit manually.\n";
        const entry = `${header}\n${lessons}\n`;
        await appendFile(lessonsPath, entry, "utf-8");

        console.log(`[reflection] Recorded ${lessons.split("\n").length} lesson(s) to LESSONS.md`);
    } catch (err: any) {
        console.log(`[reflection] Failed: ${err.message}`);
    }
}

// ── Memory Flush (MEMORY.md) ───────────────────────────────────────────

export async function runMemoryFlush(input: MemoryFlushInput): Promise<void> {
    const { conversationSummary, topicDir, workspaceDir, config, stream, topic, existingMemory } = input;

    if (!conversationSummary || conversationSummary.trim().length < 50) {
        console.log("[memory-flush] Conversation too short, skipping");
        return;
    }

    // Guard: don't bloat MEMORY.md
    const globalMemoryPath = join(workspaceDir, "MEMORY.md");
    if (existsSync(globalMemoryPath)) {
        try {
            const content = readFileSync(globalMemoryPath, "utf-8");
            const lineCount = content.split("\n").length;
            if (lineCount > MAX_MEMORY_LINES) {
                console.log(`[memory-flush] Global MEMORY.md has ${lineCount} lines (max ${MAX_MEMORY_LINES}), skipping`);
                return;
            }
        } catch { }
    }

    const dateStr = new Date().toISOString().slice(0, 10);

    // Build dedup section if existing memory is provided
    const dedupSection = existingMemory && existingMemory.trim().length > 0
        ? `\n\nExisting Memory (DO NOT repeat this — only extract NEW info):\n${existingMemory}`
        : "";

    const userPrompt = `Below is a conversation from the topic "${stream}/${topic}". Extract durable memories worth preserving.${dedupSection}\n\nConversation:\n${conversationSummary}`;

    console.log(`[memory-flush] Extracting memories from ${stream}/${topic} (${conversationSummary.length} chars)`);

    try {
        const response = await callLLM(config, MEMORY_FLUSH_SYSTEM_PROMPT, userPrompt, 500);

        if (!response || response.trim() === "NOTHING" || response.trim().length === 0) {
            console.log("[memory-flush] No durable memories found");
            return;
        }

        // Write to topic MEMORY.md (topic-specific)
        const topicMemoryPath = join(topicDir, "MEMORY.md");
        const topicHeader = existsSync(topicMemoryPath)
            ? ""
            : `# Topic Memory: ${stream}/${topic}\n> Auto-maintained by memory flush. Andy can also edit manually.\n`;
        const topicEntry = `${topicHeader}\n---\n### ${dateStr} Memory Flush\n${response.trim()}\n`;
        await appendFile(topicMemoryPath, topicEntry, "utf-8");
        console.log(`[memory-flush] Saved topic memory to ${topicMemoryPath}`);

        // Also extract globally relevant items to global MEMORY.md
        const globalHeader = existsSync(globalMemoryPath)
            ? ""
            : `# Andy's Global Memory\n> Auto-maintained by memory flush. Andy can also edit manually.\n`;

        // Check if there are user preferences or key facts worth saving globally
        // Avoid false positives: LLM sometimes says "没有涉及用户偏好" which contains the keyword but means the opposite
        const isNegation = /没有涉及|没有发现|不涉及|无需记录/.test(response);
        const hasGlobalContent = !isNegation && (response.includes("用户偏好") || response.includes("关键事实"));
        if (hasGlobalContent) {
            const globalEntry = `${globalHeader}\n---\n### ${dateStr} (from ${stream}/${topic})\n${response.trim()}\n`;
            await appendFile(globalMemoryPath, globalEntry, "utf-8");
            console.log(`[memory-flush] Also saved to global MEMORY.md`);
        }
    } catch (err: any) {
        console.log(`[memory-flush] Failed: ${err.message}`);
    }
}

// ── Helper: extract text from session messages ─────────────────────────

export function extractConversationText(messages: Array<{ role: string; content?: any }>): string {
    const lines: string[] = [];
    // Only take last N messages to keep prompt small
    const recent = messages.slice(-20);

    for (const msg of recent) {
        const role = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : msg.role;
        let text = "";
        if (typeof msg.content === "string") {
            text = msg.content;
        } else if (Array.isArray(msg.content)) {
            text = msg.content
                .filter((c: any) => c?.type === "text")
                .map((c: any) => c.text)
                .join("\n");
        }
        if (text.trim()) {
            // Truncate very long messages
            const truncated = text.length > 500 ? text.slice(0, 500) + "..." : text;
            lines.push(`[${role}]: ${truncated}`);
        }
    }

    return lines.join("\n\n");
}

// ── Post-Run Memory Extraction (方案 A + 硬条件过滤) ───────────────────

// Cooldown tracker: per-topic last flush timestamp
const lastFlushTimeMap = new Map<string, number>();
const FLUSH_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const MIN_CONVERSATION_TURNS = 4; // minimum user+assistant turns to trigger

/**
 * Post-run memory extraction with 4 hard gates (zero LLM cost):
 *   ① 对话轮数 < 4 → 跳过（几句闲聊不值得记）
 *   ② 纯文字聊天，没有任何 tool call → 跳过（没做事 = 大概率闲聊）
 *   ③ 距离上次 memory flush < 30 分钟 → 跳过（冷却期）
 *   ④ 全部通过 → 调用 LLM 提取（带去重 prompt）
 */
export async function runPostRunMemoryExtraction(input: PostRunMemoryInput): Promise<void> {
    const { messages, totalToolCalls, topicDir, workspaceDir, config, stream, topic } = input;
    const topicKey = `${stream}:${topic}`;

    // ── Gate ①: 对话轮数 < 4 → 跳过 ──
    const turnCount = messages.filter(m => m.role === "user" || m.role === "assistant").length;
    if (turnCount < MIN_CONVERSATION_TURNS) {
        console.log(`[post-run-memory] Gate ①: only ${turnCount} turns (need ${MIN_CONVERSATION_TURNS}), skipping`);
        return;
    }

    // ── Gate ②: 没有任何 tool call → 跳过 ──
    if (totalToolCalls === 0) {
        console.log(`[post-run-memory] Gate ②: no tool calls (pure chat), skipping`);
        return;
    }

    // ── Gate ③: 冷却期 < 30 分钟 → 跳过 ──
    const now = Date.now();
    const lastFlush = lastFlushTimeMap.get(topicKey) || 0;
    if (now - lastFlush < FLUSH_COOLDOWN_MS) {
        const minutesAgo = ((now - lastFlush) / 60000).toFixed(1);
        console.log(`[post-run-memory] Gate ③: last flush was ${minutesAgo}min ago (cooldown 30min), skipping`);
        return;
    }

    // ── Gate ④: 全部通过 → LLM 提取 ──
    const conversationText = extractConversationText(messages);
    if (conversationText.length < 100) {
        console.log("[post-run-memory] Conversation text too short, skipping");
        return;
    }

    // Read existing memory for deduplication
    let existingMemory = "";
    try {
        const globalPath = join(workspaceDir, "MEMORY.md");
        const topicPath = join(topicDir, "MEMORY.md");
        const parts: string[] = [];
        if (existsSync(globalPath)) parts.push(readFileSync(globalPath, "utf-8"));
        if (existsSync(topicPath)) parts.push(readFileSync(topicPath, "utf-8"));
        existingMemory = parts.join("\n");
    } catch { }

    console.log(`[post-run-memory] All gates passed (${turnCount} turns, ${totalToolCalls} tools, ${((now - lastFlush) / 60000).toFixed(0)}min since last). Extracting...`);

    // Update cooldown timestamp BEFORE the async call
    lastFlushTimeMap.set(topicKey, now);

    await runMemoryFlush({
        conversationSummary: conversationText,
        topicDir,
        workspaceDir,
        config,
        stream,
        topic,
        existingMemory,
    });
}

// ── LLM Call ───────────────────────────────────────────────────────────

async function callLLM(config: BridgeConfig, systemPrompt: string, userPrompt: string, maxTokens = 300): Promise<string> {
    const baseUrl = config.llmBaseUrl || "https://api.anthropic.com";
    const url = `${baseUrl}/v1/messages`;

    const body = {
        model: config.llmModel || "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [
            { role: "user", content: userPrompt },
        ],
    };

    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": config.llmApiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`LLM call failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = await res.json() as any;
    const content = data?.content;
    if (Array.isArray(content)) {
        return content
            .filter((block: any) => block.type === "text")
            .map((block: any) => block.text)
            .join("\n");
    }
    return "";
}
