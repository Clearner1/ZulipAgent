/**
 * Message persistence — log.jsonl per topic.
 * Adapted from mom's store.ts pattern.
 *
 * Each Zulip stream+topic gets its own directory:
 *   data/<stream>/<topic>/log.jsonl
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";

export interface LoggedMessage {
    date: string; // ISO 8601
    ts: string; // unique message ID (epoch ms or Zulip message ID)
    user: string; // user email or "bot"
    userName?: string; // display name
    text: string;
    isBot: boolean;
}

export class ChannelStore {
    private recentlyLogged = new Map<string, number>();

    constructor(private workingDir: string) {
        if (!existsSync(this.workingDir)) {
            mkdirSync(this.workingDir, { recursive: true });
        }
    }

    /**
     * Get or create the directory for a stream+topic.
     * Sanitizes names for filesystem safety.
     */
    getTopicDir(stream: string, topic: string): string {
        const safeStream = this.sanitize(stream);
        const safeTopic = this.sanitize(topic);
        const dir = join(this.workingDir, safeStream, safeTopic);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    /**
     * Log a message to the topic's log.jsonl.
     * Returns false if message was already logged (duplicate).
     */
    async logMessage(stream: string, topic: string, message: LoggedMessage): Promise<boolean> {
        const dedupeKey = `${stream}:${topic}:${message.ts}`;
        if (this.recentlyLogged.has(dedupeKey)) {
            return false;
        }

        this.recentlyLogged.set(dedupeKey, Date.now());
        setTimeout(() => this.recentlyLogged.delete(dedupeKey), 60000);

        const topicDir = this.getTopicDir(stream, topic);
        const logPath = join(topicDir, "log.jsonl");

        if (!message.date) {
            message.date = new Date().toISOString();
        }

        const line = `${JSON.stringify(message)}\n`;
        await appendFile(logPath, line, "utf-8");
        return true;
    }

    /**
     * Log a bot response.
     */
    async logBotResponse(stream: string, topic: string, text: string): Promise<void> {
        await this.logMessage(stream, topic, {
            date: new Date().toISOString(),
            ts: Date.now().toString(),
            user: "bot",
            text,
            isBot: true,
        });
    }

    /**
     * Get the timestamp of the last logged message for a topic.
     */
    getLastTimestamp(stream: string, topic: string): string | null {
        const topicDir = this.getTopicDir(stream, topic);
        const logPath = join(topicDir, "log.jsonl");
        if (!existsSync(logPath)) {
            return null;
        }

        try {
            const content = readFileSync(logPath, "utf-8");
            const lines = content.trim().split("\n");
            if (lines.length === 0 || lines[0] === "") {
                return null;
            }
            const lastLine = lines[lines.length - 1];
            const message = JSON.parse(lastLine) as LoggedMessage;
            return message.ts;
        } catch {
            return null;
        }
    }

    /**
     * Sanitize a string for use as a directory name.
     */
    private sanitize(name: string): string {
        return name
            .replace(/[<>:"/\\|?*]/g, "_")
            .replace(/\s+/g, "-")
            .toLowerCase()
            .slice(0, 100);
    }
}
