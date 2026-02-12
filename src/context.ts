/**
 * Context management — sync log.jsonl → SessionManager.
 * Adapted from mom's context.ts.
 *
 * Syncs user messages from log.jsonl into the SessionManager
 * so the agent sees messages that arrived while it was offline.
 *
 * Also provides BridgeSettingsManager for AgentSession compatibility.
 */

import type { UserMessage } from "@mariozechner/pi-ai";
import type { SessionManager, SessionMessageEntry } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

// ============================================================================
// Sync log.jsonl to SessionManager
// ============================================================================

interface LogMessage {
    date?: string;
    ts?: string;
    user?: string;
    userName?: string;
    text?: string;
    isBot?: boolean;
}

/**
 * Sync user messages from log.jsonl to SessionManager.
 *
 * Ensures messages logged while agent wasn't running are added to LLM context.
 *
 * @param sessionManager - The SessionManager to sync to
 * @param topicDir - Path to topic directory containing log.jsonl
 * @param excludeTs - Timestamp of current message (added via prompt(), not sync)
 * @returns Number of messages synced
 */
export function syncLogToSessionManager(
    sessionManager: SessionManager,
    topicDir: string,
    excludeTs?: string,
): number {
    const logFile = join(topicDir, "log.jsonl");
    if (!existsSync(logFile)) return 0;

    // Build set of existing message content from session
    const existingMessages = new Set<string>();
    for (const entry of sessionManager.getEntries()) {
        if (entry.type === "message") {
            const msgEntry = entry as SessionMessageEntry;
            const msg = msgEntry.message as { role: string; content?: unknown };
            if (msg.role === "user" && msg.content !== undefined) {
                const content = msg.content;
                if (typeof content === "string") {
                    let normalized = content.replace(
                        /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}\] /,
                        "",
                    );
                    existingMessages.add(normalized);
                } else if (Array.isArray(content)) {
                    for (const part of content) {
                        if (
                            typeof part === "object" &&
                            part !== null &&
                            "type" in part &&
                            part.type === "text" &&
                            "text" in part
                        ) {
                            let normalized = (part as { type: "text"; text: string }).text;
                            normalized = normalized.replace(
                                /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}\] /,
                                "",
                            );
                            existingMessages.add(normalized);
                        }
                    }
                }
            }
        }
    }

    // Read log.jsonl and find user messages not in context
    const logContent = readFileSync(logFile, "utf-8");
    const logLines = logContent.trim().split("\n").filter(Boolean);

    const newMessages: Array<{ timestamp: number; message: UserMessage }> = [];

    for (const line of logLines) {
        try {
            const logMsg: LogMessage = JSON.parse(line);

            const ts = logMsg.ts;
            const date = logMsg.date;
            if (!ts || !date) continue;

            // Skip the current message being processed
            if (excludeTs && ts === excludeTs) continue;

            // Skip bot messages
            if (logMsg.isBot) continue;

            // Build message text as it would appear in context
            const messageText = `[${logMsg.userName || logMsg.user || "unknown"}]: ${logMsg.text || ""}`;

            // Skip if already in context
            if (existingMessages.has(messageText)) continue;

            const msgTime = new Date(date).getTime() || Date.now();
            const userMessage: UserMessage = {
                role: "user",
                content: [{ type: "text", text: messageText }],
                timestamp: msgTime,
            };

            newMessages.push({ timestamp: msgTime, message: userMessage });
            existingMessages.add(messageText);
        } catch {
            // Skip malformed lines
        }
    }

    if (newMessages.length === 0) return 0;

    // Sort by timestamp and add to session
    newMessages.sort((a, b) => a.timestamp - b.timestamp);
    for (const { message } of newMessages) {
        sessionManager.appendMessage(message);
    }

    return newMessages.length;
}

// ============================================================================
// BridgeSettingsManager - Settings for AgentSession compatibility
// ============================================================================

interface BridgeSettings {
    defaultProvider?: string;
    defaultModel?: string;
    defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
}

/**
 * Settings manager compatible with AgentSession requirements.
 */
export class BridgeSettingsManager {
    private settingsPath: string;
    private settings: BridgeSettings;

    constructor(workspaceDir: string) {
        this.settingsPath = join(workspaceDir, "settings.json");
        this.settings = this.load();
    }

    private load(): BridgeSettings {
        if (!existsSync(this.settingsPath)) return {};
        try {
            return JSON.parse(readFileSync(this.settingsPath, "utf-8"));
        } catch {
            return {};
        }
    }

    private save(): void {
        try {
            const dir = dirname(this.settingsPath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), "utf-8");
        } catch (error) {
            console.error(`[settings] Could not save: ${error}`);
        }
    }

    getCompactionSettings() {
        return { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 };
    }

    getCompactionEnabled(): boolean {
        return true;
    }

    setCompactionEnabled(_enabled: boolean): void { }

    getRetrySettings() {
        return { enabled: true, maxRetries: 3, baseDelayMs: 2000 };
    }

    getRetryEnabled(): boolean {
        return true;
    }

    setRetryEnabled(_enabled: boolean): void { }

    getDefaultModel(): string | undefined {
        return this.settings.defaultModel;
    }

    getDefaultProvider(): string | undefined {
        return this.settings.defaultProvider;
    }

    setDefaultModelAndProvider(provider: string, modelId: string): void {
        this.settings.defaultProvider = provider;
        this.settings.defaultModel = modelId;
        this.save();
    }

    getDefaultThinkingLevel(): string {
        return this.settings.defaultThinkingLevel || "off";
    }

    setDefaultThinkingLevel(level: string): void {
        this.settings.defaultThinkingLevel = level as BridgeSettings["defaultThinkingLevel"];
        this.save();
    }

    getSteeringMode(): "all" | "one-at-a-time" {
        return "one-at-a-time";
    }

    setSteeringMode(_mode: "all" | "one-at-a-time"): void { }

    getFollowUpMode(): "all" | "one-at-a-time" {
        return "one-at-a-time";
    }

    setFollowUpMode(_mode: "all" | "one-at-a-time"): void { }

    getHookPaths(): string[] {
        return [];
    }

    getHookTimeout(): number {
        return 30000;
    }
}
