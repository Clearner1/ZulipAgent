/**
 * Events system — scheduled wake-ups for the agent.
 * Adapted from mom's events.ts pattern.
 *
 * Watches data/events/ for JSON files. Three event types:
 *   - immediate: triggers as soon as file appears
 *   - one-shot: triggers at a specific time, then deleted
 *   - periodic: triggers on cron schedule, persists until deleted
 *
 * Events trigger the agent by calling the handler with a formatted message.
 */

import { Cron } from "croner";
import {
    existsSync,
    type FSWatcher,
    mkdirSync,
    readdirSync,
    statSync,
    unlinkSync,
    watch,
} from "fs";
import { readFile } from "fs/promises";
import { join } from "path";

// ============================================================================
// Event Types
// ============================================================================

interface ImmediateEvent {
    type: "immediate";
    stream: string;
    topic: string;
    text: string;
}

interface OneShotEvent {
    type: "one-shot";
    stream: string;
    topic: string;
    text: string;
    at: string; // ISO 8601 with timezone offset
}

interface PeriodicEvent {
    type: "periodic";
    stream: string;
    topic: string;
    text: string;
    schedule: string; // cron expression
    timezone: string; // IANA timezone
}

type MomEvent = ImmediateEvent | OneShotEvent | PeriodicEvent;

// ============================================================================
// Handler interface
// ============================================================================

export interface EventHandler {
    isRunning(topicKey: string): boolean;
    handleEvent(stream: string, topic: string, text: string): Promise<void>;
}

// ============================================================================
// EventsWatcher
// ============================================================================

const DEBOUNCE_MS = 100;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 100;

export class EventsWatcher {
    private timers = new Map<string, NodeJS.Timeout>();
    private crons = new Map<string, Cron>();
    private debounceTimers = new Map<string, NodeJS.Timeout>();
    private startTime: number;
    private watcher: FSWatcher | null = null;
    private stopped = false;

    constructor(
        private eventsDir: string,
        private handler: EventHandler,
    ) {
        this.startTime = Date.now();
        mkdirSync(eventsDir, { recursive: true });
    }

    /** Start watching for events. */
    start(): void {
        this.scanExisting();

        try {
            this.watcher = watch(this.eventsDir, (_eventType, filename) => {
                if (!filename || !filename.endsWith(".json") || this.stopped) return;
                this.debounce(filename, () => this.handleFileChange(filename));
            });
        } catch (err) {
            console.error("[events] Failed to start watcher:", err);
        }

        console.log(`[events] Watching ${this.eventsDir}`);
    }

    /** Stop watching and cancel all scheduled events. */
    stop(): void {
        this.stopped = true;

        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }

        for (const [, timer] of this.timers) {
            clearTimeout(timer);
        }
        this.timers.clear();

        for (const [, cron] of this.crons) {
            cron.stop();
        }
        this.crons.clear();

        for (const [, timer] of this.debounceTimers) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();

        console.log("[events] Stopped");
    }

    private debounce(filename: string, fn: () => void): void {
        const existing = this.debounceTimers.get(filename);
        if (existing) clearTimeout(existing);
        this.debounceTimers.set(
            filename,
            setTimeout(() => {
                this.debounceTimers.delete(filename);
                fn();
            }, DEBOUNCE_MS),
        );
    }

    private scanExisting(): void {
        try {
            const files = readdirSync(this.eventsDir).filter((f) => f.endsWith(".json"));
            for (const file of files) {
                this.handleFile(file);
            }
        } catch {
            // Directory might not exist yet
        }
    }

    private handleFileChange(filename: string): void {
        const filepath = join(this.eventsDir, filename);
        if (!existsSync(filepath)) {
            this.handleDelete(filename);
            return;
        }
        this.cancelScheduled(filename);
        this.handleFile(filename);
    }

    private handleDelete(filename: string): void {
        this.cancelScheduled(filename);
    }

    private cancelScheduled(filename: string): void {
        const timer = this.timers.get(filename);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(filename);
        }
        const cron = this.crons.get(filename);
        if (cron) {
            cron.stop();
            this.crons.delete(filename);
        }
    }

    private async handleFile(filename: string): Promise<void> {
        const filepath = join(this.eventsDir, filename);

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const stat = statSync(filepath);
                if (stat.size === 0) {
                    await this.sleep(RETRY_BASE_MS * (attempt + 1));
                    continue;
                }
                const content = await readFile(filepath, "utf-8");
                const event = this.parseEvent(content, filename);
                if (!event) return;

                switch (event.type) {
                    case "immediate":
                        this.handleImmediate(filename, event);
                        break;
                    case "one-shot":
                        this.handleOneShot(filename, event);
                        break;
                    case "periodic":
                        this.handlePeriodic(filename, event);
                        break;
                }
                return;
            } catch {
                if (attempt < MAX_RETRIES - 1) {
                    await this.sleep(RETRY_BASE_MS * (attempt + 1));
                }
            }
        }
    }

    private parseEvent(content: string, filename: string): MomEvent | null {
        try {
            const data = JSON.parse(content);
            if (!data.type || !data.stream || !data.topic || !data.text) {
                console.warn(`[events] Invalid event ${filename}: missing required fields`);
                return null;
            }
            if (!["immediate", "one-shot", "periodic"].includes(data.type)) {
                console.warn(`[events] Unknown event type in ${filename}: ${data.type}`);
                return null;
            }
            return data as MomEvent;
        } catch (err) {
            console.warn(`[events] Failed to parse ${filename}:`, err);
            return null;
        }
    }

    private handleImmediate(filename: string, event: ImmediateEvent): void {
        console.log(`[events] Immediate: ${filename} → ${event.stream}/${event.topic}`);
        this.execute(filename, event, true);
    }

    private handleOneShot(filename: string, event: OneShotEvent): void {
        const triggerTime = new Date(event.at).getTime();
        const now = Date.now();
        const delay = triggerTime - now;

        if (delay <= 0) {
            // Already past — trigger if it was created after we started
            const filepath = join(this.eventsDir, filename);
            try {
                const stat = statSync(filepath);
                if (stat.mtimeMs > this.startTime) {
                    console.log(`[events] One-shot (past due): ${filename}`);
                    this.execute(filename, event, true);
                } else {
                    console.log(`[events] One-shot expired before start, deleting: ${filename}`);
                    this.deleteFile(filename);
                }
            } catch {
                this.deleteFile(filename);
            }
            return;
        }

        console.log(
            `[events] One-shot scheduled: ${filename} in ${Math.round(delay / 1000)}s`,
        );
        this.timers.set(
            filename,
            setTimeout(() => {
                this.timers.delete(filename);
                if (!this.stopped) {
                    this.execute(filename, event, true);
                }
            }, delay),
        );
    }

    private handlePeriodic(filename: string, event: PeriodicEvent): void {
        try {
            const cron = new Cron(event.schedule, { timezone: event.timezone }, () => {
                if (!this.stopped) {
                    console.log(`[events] Periodic trigger: ${filename}`);
                    this.execute(filename, event, false);
                }
            });
            this.crons.set(filename, cron);
            console.log(
                `[events] Periodic scheduled: ${filename} (${event.schedule} ${event.timezone})`,
            );
        } catch (err) {
            console.error(`[events] Invalid cron in ${filename}:`, err);
        }
    }

    private execute(filename: string, event: MomEvent, deleteAfter = true): void {
        const topicKey = `${event.stream}:${event.topic}`;

        // Format the event message like mom does
        let schedule = "";
        if (event.type === "one-shot") schedule = (event as OneShotEvent).at;
        if (event.type === "periodic") schedule = (event as PeriodicEvent).schedule;
        const eventMessage = `[EVENT:${filename}:${event.type}:${schedule}] ${event.text}`;

        // Check if agent is already running for this topic
        if (this.handler.isRunning(topicKey)) {
            console.log(`[events] Agent busy for ${topicKey}, queueing event`);
            // Re-schedule after a delay
            setTimeout(() => {
                if (!this.stopped) this.execute(filename, event, deleteAfter);
            }, 10000);
            return;
        }

        // Trigger the handler
        this.handler.handleEvent(event.stream, event.topic, eventMessage).catch((err) => {
            console.error(`[events] Error executing ${filename}:`, err);
        });

        if (deleteAfter) {
            this.deleteFile(filename);
        }
    }

    private deleteFile(filename: string): void {
        try {
            const filepath = join(this.eventsDir, filename);
            if (existsSync(filepath)) {
                unlinkSync(filepath);
            }
        } catch (err) {
            console.error(`[events] Failed to delete ${filename}:`, err);
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

/**
 * Create and start an events watcher.
 */
export function createEventsWatcher(
    workspaceDir: string,
    handler: EventHandler,
): EventsWatcher {
    const eventsDir = join(workspaceDir, "events");
    const watcher = new EventsWatcher(eventsDir, handler);
    watcher.start();
    return watcher;
}
