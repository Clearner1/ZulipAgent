/**
 * Pi-Zulip Bridge v2 — Main entry point.
 *
 * Connects Pi Coding Agent to Zulip chat.
 * Architecture follows mom's pattern: per-topic agent sessions,
 * persistent context, file-based events for scheduled tasks.
 */

import "dotenv/config";
import { resolve, join } from "path";
import { mkdirSync, readdirSync, rmSync, statSync } from "fs";
import { loadConfig, type BridgeConfig } from "./config.js";
import { ZulipBot, type ZulipMessage } from "./zulip.js";
import { getOrCreateRunner, type AgentRunner, type ZulipContext } from "./agent.js";
import { ChannelStore } from "./store.js";
import { createEventsWatcher, type EventsWatcher, type EventHandler } from "./events.js";

// ============================================================================
// Per-topic state
// ============================================================================

interface TopicState {
    running: boolean;
    runner: AgentRunner;
}

const topicStates = new Map<string, TopicState>();

// Message-level deduplication to prevent processing the same Zulip message twice
// (Zulip event queue can sometimes deliver duplicate events)
const processedMessageIds = new Set<number>();

function getState(config: BridgeConfig, stream: string, topic: string): TopicState {
    const key = `${stream}:${topic}`;
    let state = topicStates.get(key);
    if (!state) {
        state = {
            running: false,
            runner: getOrCreateRunner(config, stream, topic),
        };
        topicStates.set(key, state);
    }
    return state;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
    console.log("╔══════════════════════════════════════╗");
    console.log("║     Pi-Zulip Bridge v2.0.0           ║");
    console.log("╚══════════════════════════════════════╝");

    // Load config
    const config = loadConfig();
    const workspaceDir = resolve(config.workingDir);
    mkdirSync(workspaceDir, { recursive: true });

    console.log(`\n📋 Config:`);
    console.log(`   Zulip URL: ${config.zulipUrl}`);
    console.log(`   Bot Email: ${config.zulipBotEmail}`);
    console.log(`   Workspace: ${workspaceDir}`);
    console.log(`   Trigger: ${config.triggerWord || "(respond to all @mentions)"}`);

    // Create store
    const store = new ChannelStore(workspaceDir);

    // Connect to Zulip
    const zulip = new ZulipBot(config);
    try {
        await zulip.connect();
    } catch (err: any) {
        console.error(`\n❌ Zulip connection failed: ${err.message}`);
        console.error(`\nMake sure:`);
        console.error(`  1. Zulip server is running at ${config.zulipUrl}`);
        console.error(`  2. Bot credentials are correct in .env`);
        console.error(`  3. The bot has been created in Zulip Settings → Bots\n`);
        process.exit(1);
    }

    // Sync bot subscriptions with owner
    if (config.ownerEmail) {
        await zulip.syncSubscriptionsTo(config.ownerEmail).catch(err =>
            console.log(`[sync] Subscription sync failed (non-fatal): ${(err as Error).message}`)
        );
    }

    // Sync local topic directories with Zulip
    await syncLocalTopics(zulip, workspaceDir);

    // Create events handler
    const eventHandler: EventHandler = {
        isRunning(topicKey: string): boolean {
            const state = topicStates.get(topicKey);
            return state?.running ?? false;
        },

        async handleEvent(stream: string, topic: string, text: string, modelOverride?: string): Promise<void> {
            // Temporarily override model for runner creation if specified
            const originalModel = config.llmModel;
            const originalBaseUrl = config.llmBaseUrl;
            const originalApiKey = config.llmApiKey;
            const originalProvider = config.llmProvider;
            if (modelOverride) {
                config.llmModel = modelOverride;
                if (config.browserBaseUrl) config.llmBaseUrl = config.browserBaseUrl;
                if (config.browserApiKey) config.llmApiKey = config.browserApiKey;
                if (config.browserProvider) config.llmProvider = config.browserProvider;
            }

            const state = getState(config, stream, topic);

            // Restore config immediately after getState (runner is now cached)
            if (modelOverride) {
                config.llmModel = originalModel;
                config.llmBaseUrl = originalBaseUrl;
                config.llmApiKey = originalApiKey;
                config.llmProvider = originalProvider;
            }

            if (state.running) return;

            state.running = true;
            if (modelOverride) {
                console.log(`\n⏰ [EVENT] [${stream}/${topic}] (model: ${modelOverride}) ${text.slice(0, 60)}`);
            } else {
                console.log(`\n⏰ [EVENT] [${stream}/${topic}] ${text.slice(0, 80)}`);
            }

            try {
                const ctx: ZulipContext = {
                    message: {
                        text,
                        user: "system",
                        userName: "event",
                        stream,
                        topic,
                        ts: Date.now().toString(),
                    },
                    respond: async (reply: string) => {
                        if (/\[silent\]/i.test(reply)) return;
                        await zulip.sendMessage(stream, topic, reply);
                    },
                    setTyping: async () => { },
                };

                await state.runner.run(ctx, store);
            } catch (err: any) {
                console.error(`[event] Error: ${err.message}`);
                try {
                    await zulip.sendMessage(stream, topic, `❌ Event error: ${err.message}`);
                } catch { }
            } finally {
                state.running = false;
            }
        },
    };

    // Start events watcher
    const eventsWatcher = createEventsWatcher(workspaceDir, eventHandler);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        console.log(`\n🛑 ${signal} received, shutting down...`);
        eventsWatcher.stop();
        await zulip.disconnect();
        process.exit(0);
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    console.log(`\n✅ Bridge is running! Listening for messages in Zulip...\n`);

    // Message loop
    while (true) {
        try {
            const messages = await zulip.pollMessages();

            for (const msg of messages) {
                await handleMessage(msg, config, zulip, store);
            }
        } catch (err: any) {
            console.error(`[loop] Error: ${err.message}`);
            await sleep(3000);

            if (!zulip.isConnected()) {
                console.log("[loop] Reconnecting to Zulip...");
                try {
                    await zulip.connect();
                } catch {
                    console.error("[loop] Reconnect failed, will retry...");
                }
            }
        }
    }
}

// ============================================================================
// Message Handler
// ============================================================================

async function handleMessage(
    msg: ZulipMessage,
    config: BridgeConfig,
    zulip: ZulipBot,
    store: ChannelStore,
): Promise<void> {
    console.log(`[debug:handleMessage] ENTER msgId=${msg.id} type=${msg.type} content="${msg.content.trim().slice(0, 50)}"`);
    // Deduplicate: skip if we've already processed this Zulip message ID
    if (processedMessageIds.has(msg.id)) {
        console.log(`[dedup] Skipping duplicate message ${msg.id}`);
        return;
    }
    processedMessageIds.add(msg.id);
    // Auto-clean after 60s to avoid memory leak
    setTimeout(() => processedMessageIds.delete(msg.id), 60000);

    let userText = msg.content.trim();

    // For stream messages: check trigger word
    // For DMs: always respond (no trigger needed)
    if (msg.type === "stream") {
        if (config.triggerWord) {
            const triggerRegex = new RegExp(
                `^${escapeRegex(config.triggerWord)}\\b`,
                "i",
            );
            if (!triggerRegex.test(userText)) return;
            userText = userText.replace(triggerRegex, "").trim();
        }
    }

    if (!userText) return;

    // Determine stream/topic for both message types
    const isDM = msg.type === "direct";
    const stream = isDM ? "_dm" : msg.displayRecipient;
    const topic = isDM ? msg.senderEmail : msg.subject;
    const topicKey = `${stream}:${topic}`;

    console.log(
        `\n📨 [${isDM ? "DM" : stream}/${topic}] ${msg.senderFullName}: ${userText.slice(0, 100)}${userText.length > 100 ? "..." : ""}`,
    );

    // Log user message
    await store.logMessage(stream, topic, {
        date: new Date(msg.timestamp * 1000).toISOString(),
        ts: msg.id.toString(),
        user: msg.senderEmail,
        userName: msg.senderFullName,
        text: userText,
        isBot: false,
    });

    // Get or create state for this topic
    const state = getState(config, stream, topic);

    if (state.running) {
        if (isDM) {
            await zulip.sendDirectMessage(msg.senderEmail, "⏳ Still working on a previous request...");
        } else {
            await zulip.sendMessage(stream, topic, "⏳ Still working on a previous request...");
        }
        return;
    }

    state.running = true;

    try {
        // Show typing (DM uses different API)
        if (isDM) {
            await zulip.setDirectTyping(msg.senderId, true);
        } else {
            await zulip.setTyping(msg.streamId, topic, true);
        }

        const ctx: ZulipContext = {
            message: {
                text: userText,
                user: msg.senderEmail,
                userName: msg.senderFullName,
                stream,
                topic,
                ts: msg.id.toString(),
                messageId: msg.id,
            },
            respond: async (text: string) => {
                if (isDM) {
                    await zulip.sendDirectMessage(msg.senderEmail, text);
                } else {
                    await zulip.sendMessage(stream, topic, text);
                }
            },
            setTyping: async (isTyping: boolean) => {
                if (isDM) {
                    await zulip.setDirectTyping(msg.senderId, isTyping);
                } else {
                    await zulip.setTyping(msg.streamId, topic, isTyping);
                }
            },
        };

        await state.runner.run(ctx, store);
        console.log(`✅ [${isDM ? "DM" : stream}/${topic}] Done`);
    } catch (err: any) {
        console.error(`❌ [${isDM ? "DM" : stream}/${topic}] Error: ${err.message}`);
        try {
            if (isDM) {
                await zulip.sendDirectMessage(msg.senderEmail, `❌ Error: ${err.message}`);
            } else {
                await zulip.sendMessage(stream, topic, `❌ Error: ${err.message}`);
            }
        } catch { }
    } finally {
        state.running = false;
        if (isDM) {
            await zulip.setDirectTyping(msg.senderId, false);
        } else {
            await zulip.setTyping(msg.streamId, topic, false);
        }
    }
}

// ============================================================================
// Utilities
// ============================================================================

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

// ============================================================================
// Sync local topic directories with Zulip
// ============================================================================

/** Normalize topic name to directory name (mirrors ChannelStore.sanitize) */
function topicToDir(name: string): string {
    return name
        .replace(/[<>:"/\\|?*]/g, "_")
        .replace(/\s+/g, "-")
        .toLowerCase()
        .slice(0, 100);
}

/**
 * Remove local topic directories that no longer exist on Zulip.
 * Runs once at startup.
 */
async function syncLocalTopics(zulip: ZulipBot, workspaceDir: string): Promise<void> {
    console.log("\n🔄 Syncing local topics with Zulip...");

    // Dirs that are NOT stream/topic data — never delete these
    const reservedDirs = new Set(["skills", "events", "_dm"]);

    try {
        // 1. Build a set of all valid "stream/topic" pairs from Zulip
        const streams = await zulip.getSubscribedStreams();
        const zulipTopics = new Set<string>(); // "streamDir/topicDir"

        for (const stream of streams) {
            const streamDir = topicToDir(stream.name);
            try {
                const topics = await zulip.getTopics(stream.streamId);
                for (const topic of topics) {
                    zulipTopics.add(`${streamDir}/${topicToDir(topic)}`);
                }
            } catch (err: any) {
                // Can't get topics for this stream (e.g. no permission), skip
                console.log(`  ⚠️ Cannot read topics for stream "${stream.name}": ${err.message}`);
            }
        }

        // 2. Walk local workspace directories
        let deletedCount = 0;

        const localEntries = readdirSync(workspaceDir);
        for (const streamEntry of localEntries) {
            if (reservedDirs.has(streamEntry)) continue;

            const streamPath = join(workspaceDir, streamEntry);
            if (!statSync(streamPath).isDirectory()) continue;

            // Check if this is a file like MEMORY.md — skip
            const topicEntries = readdirSync(streamPath);
            for (const topicEntry of topicEntries) {
                const topicPath = join(streamPath, topicEntry);
                if (!statSync(topicPath).isDirectory()) continue;

                const key = `${streamEntry}/${topicEntry}`;
                if (!zulipTopics.has(key)) {
                    console.log(`  🗑️  Removing stale topic: ${key}`);
                    rmSync(topicPath, { recursive: true, force: true });
                    deletedCount++;
                }
            }

            // If stream directory is now empty, remove it too
            const remaining = readdirSync(streamPath);
            if (remaining.length === 0) {
                console.log(`  🗑️  Removing empty stream: ${streamEntry}`);
                rmSync(streamPath, { recursive: true, force: true });
            }
        }

        if (deletedCount === 0) {
            console.log("  ✅ All local topics are in sync.");
        } else {
            console.log(`  ✅ Removed ${deletedCount} stale topic(s).`);
        }
    } catch (err: any) {
        console.error(`  ⚠️ Sync failed (non-fatal): ${err.message}`);
    }
}

// ============================================================================
// Start
// ============================================================================

main().catch((err) => {
    console.error(`\n💥 Fatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
});
