/**
 * Zulip integration — message sending and receiving.
 *
 * Uses Zulip's Event Queue API for real-time message listening
 * and REST API for sending messages.
 */

import type { BridgeConfig } from "./config.js";

// ============================================================================
// Types
// ============================================================================

export interface ZulipMessage {
    id: number;
    senderId: number;
    senderEmail: string;
    senderFullName: string;
    content: string; // raw HTML content from Zulip
    subject: string; // topic
    streamId: number;
    displayRecipient: string; // stream name
    type: "stream" | "direct";
    timestamp: number;
}

// ============================================================================
// ZulipBot
// ============================================================================

export class ZulipBot {
    private queueId: string | null = null;
    private lastEventId = -1;
    private connected = false;
    private abortController: AbortController | null = null;

    constructor(private config: BridgeConfig) { }

    // --- Auth ---

    private authHeader(): string {
        const credentials = `${this.config.zulipBotEmail}:${this.config.zulipBotApiKey}`;
        const encoded =
            typeof btoa !== "undefined"
                ? btoa(credentials)
                : Buffer.from(credentials).toString("base64");
        return `Basic ${encoded}`;
    }

    // --- API ---

    private async api(
        method: "GET" | "POST" | "DELETE",
        endpoint: string,
        params?: Record<string, string>,
    ): Promise<any> {
        const url = new URL(`/api/v1${endpoint}`, this.config.zulipUrl);

        const options: RequestInit = {
            method,
            headers: {
                Authorization: this.authHeader(),
            },
        };

        if (params) {
            if (method === "GET") {
                for (const [k, v] of Object.entries(params)) {
                    url.searchParams.set(k, v);
                }
            } else {
                const form = new URLSearchParams(params);
                options.body = form.toString();
                (options.headers as Record<string, string>)["Content-Type"] =
                    "application/x-www-form-urlencoded";
            }
        }

        const response = await fetch(url.toString(), options);
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Zulip API ${method} ${endpoint}: ${response.status} ${text}`);
        }
        return response.json();
    }

    // --- Connection ---

    /**
     * Register an event queue for real-time message events.
     */
    async connect(): Promise<void> {
        const result = await this.api("POST", "/register", {
            event_types: JSON.stringify(["message"]),
            all_public_streams: "true",
        });
        this.queueId = result.queue_id;
        this.lastEventId = result.last_event_id;
        this.connected = true;
        console.log("[zulip] Connected to event queue");
    }

    /**
     * Poll for new messages (long-polling).
     */
    async pollMessages(): Promise<ZulipMessage[]> {
        if (!this.queueId) {
            throw new Error("Not connected — call connect() first");
        }

        this.abortController = new AbortController();

        try {
            const url = new URL("/api/v1/events", this.config.zulipUrl);
            url.searchParams.set("queue_id", this.queueId);
            url.searchParams.set("last_event_id", this.lastEventId.toString());

            const response = await fetch(url.toString(), {
                headers: { Authorization: this.authHeader() },
                signal: this.abortController.signal,
            });

            if (!response.ok) {
                const text = await response.text();
                // Queue expired — reconnect
                if (response.status === 400) {
                    console.log("[zulip] Queue expired, reconnecting...");
                    this.connected = false;
                    await this.connect();
                    return [];
                }
                throw new Error(`Poll failed: ${response.status} ${text}`);
            }

            const data = await response.json();
            const messages: ZulipMessage[] = [];

            for (const event of data.events || []) {
                this.lastEventId = event.id;
                if (event.type === "message") {
                    const msg = event.message;
                    // Skip our own messages and all other bot messages
                    if (msg.sender_email === this.config.zulipBotEmail) continue;
                    if (msg.sender_is_bot) continue;

                    messages.push({
                        id: msg.id,
                        senderId: msg.sender_id,
                        senderEmail: msg.sender_email,
                        senderFullName: msg.sender_full_name,
                        content: this.stripHtml(msg.content),
                        subject: msg.subject || "(no topic)",
                        streamId: msg.stream_id,
                        displayRecipient:
                            typeof msg.display_recipient === "string"
                                ? msg.display_recipient
                                : msg.display_recipient?.[0]?.full_name || "direct",
                        type: msg.type === "private" ? "direct" : "stream",
                        timestamp: msg.timestamp,
                    });
                }
            }

            return messages;
        } catch (err: any) {
            if (err.name === "AbortError") return [];
            throw err;
        } finally {
            this.abortController = null;
        }
    }

    // --- Sending ---

    /**
     * Send a message to a Zulip stream + topic.
     * Automatically splits long messages.
     */
    async sendMessage(stream: string, topic: string, content: string): Promise<void> {
        const chunks = this.splitMessage(content, 9500);
        for (const chunk of chunks) {
            await this.api("POST", "/messages", {
                type: "stream",
                to: stream,
                topic,
                content: chunk,
            });
        }
    }

    /**
     * Send a direct message to a user.
     */
    async sendDirectMessage(userEmail: string, content: string): Promise<void> {
        await this.api("POST", "/messages", {
            type: "direct",
            to: JSON.stringify([userEmail]),
            content,
        });
    }

    /**
     * Set typing indicator.
     */
    async setTyping(streamId: number, topic: string, isTyping: boolean): Promise<void> {
        try {
            await this.api("POST", "/typing", {
                op: isTyping ? "start" : "stop",
                type: "stream",
                stream_id: streamId.toString(),
                topic,
            });
        } catch {
            // Typing indicators are best-effort
        }
    }

    // --- Stream & Topic discovery ---

    /**
     * Get all streams the bot is subscribed to / can see.
     */
    async getSubscribedStreams(): Promise<{ streamId: number; name: string }[]> {
        const result = await this.api("GET", "/streams");
        return (result.streams || []).map((s: any) => ({
            streamId: s.stream_id,
            name: s.name,
        }));
    }

    /**
     * Get all topics in a stream.
     */
    async getTopics(streamId: number): Promise<string[]> {
        const result = await this.api("GET", `/users/me/${streamId}/topics`);
        return (result.topics || []).map((t: any) => t.name as string);
    }

    // --- Lifecycle ---

    async disconnect(): Promise<void> {
        if (this.abortController) {
            this.abortController.abort();
        }
        if (this.queueId) {
            try {
                await this.api("DELETE", "/events", { queue_id: this.queueId });
            } catch {
                // Ignore
            }
        }
        this.queueId = null;
        this.connected = false;
        console.log("[zulip] Disconnected");
    }

    isConnected(): boolean {
        return this.connected;
    }

    /**
     * Log a bot response (for store integration).
     */
    logBotResponse(stream: string, topic: string, text: string): void {
        // This is called by main.ts to log to the store
        // Actual logging happens in the caller
    }

    // --- Helpers ---

    stripHtml(html: string): string {
        let text = html;
        // Remove @mention markup: <span class="user-mention" ...>@Name</span>
        text = text.replace(/<span class="user-mention"[^>]*>@[^<]*<\/span>/g, "");
        // Remove user-group mentions
        text = text.replace(/<span class="user-group-mention"[^>]*>@[^<]*<\/span>/g, "");
        // Convert <p> to newlines
        text = text.replace(/<\/p>\s*<p>/g, "\n\n");
        // Convert <br> to newlines
        text = text.replace(/<br\s*\/?>/g, "\n");
        // Strip remaining HTML tags
        text = text.replace(/<[^>]+>/g, "");
        // Decode common HTML entities
        text = text.replace(/&amp;/g, "&");
        text = text.replace(/&lt;/g, "<");
        text = text.replace(/&gt;/g, ">");
        text = text.replace(/&quot;/g, '"');
        text = text.replace(/&#39;/g, "'");
        return text.trim();
    }

    splitMessage(content: string, maxLength: number): string[] {
        if (content.length <= maxLength) return [content];

        const parts: string[] = [];
        let remaining = content;
        let partNum = 1;

        while (remaining.length > 0) {
            let chunk: string;
            if (remaining.length <= maxLength) {
                chunk = remaining;
                remaining = "";
            } else {
                // Try to split at paragraph boundary
                let splitAt = remaining.lastIndexOf("\n\n", maxLength);
                if (splitAt < maxLength * 0.3) {
                    // Try line boundary
                    splitAt = remaining.lastIndexOf("\n", maxLength);
                }
                if (splitAt < maxLength * 0.3) {
                    splitAt = maxLength;
                }
                chunk = remaining.substring(0, splitAt);
                remaining = remaining.substring(splitAt).trimStart();
            }

            const suffix =
                remaining.length > 0 ? `\n\n*(continued ${partNum}...)*` : "";
            parts.push(chunk + suffix);
            partNum++;
        }

        return parts;
    }
}
