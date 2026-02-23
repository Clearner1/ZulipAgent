/**
 * Configuration for Pi-Zulip Bridge.
 * Reads from environment variables (.env file via dotenv).
 */

export interface BridgeConfig {
    // Zulip
    zulipUrl: string;
    zulipBotEmail: string;
    zulipBotApiKey: string;

    // LLM
    llmApiKey: string;
    llmBaseUrl: string;
    llmProvider: string;
    llmModel: string;

    // LLM — Browser model (optional, stronger model for complex browser tasks)
    browserApiKey?: string;
    browserBaseUrl?: string;
    browserProvider?: string;
    browserModel?: string;
    browserStreams: string[];  // Streams that should use the browser model

    // Workspace
    workingDir: string;

    // Trigger
    triggerWord: string;

    // Owner (for subscription sync)
    ownerEmail: string;
}

function requireEnv(name: string): string {
    const val = process.env[name];
    if (!val) {
        throw new Error(
            `Missing required environment variable: ${name}\n` +
            `Copy .env.example to .env and fill in the values.`,
        );
    }
    return val;
}

export function loadConfig(): BridgeConfig {
    return {
        zulipUrl: requireEnv("ZULIP_URL"),
        zulipBotEmail: requireEnv("ZULIP_BOT_EMAIL"),
        zulipBotApiKey: requireEnv("ZULIP_BOT_API_KEY"),
        llmApiKey: requireEnv("LLM_API_KEY"),
        llmBaseUrl: process.env.LLM_BASE_URL || "https://api.anthropic.com",
        llmProvider: process.env.LLM_PROVIDER || "anthropic",
        llmModel: process.env.LLM_MODEL || "claude-sonnet-4-5",
        browserApiKey: process.env.LLM_BROWSER_API_KEY || undefined,
        browserBaseUrl: process.env.LLM_BROWSER_BASE_URL || undefined,
        browserProvider: process.env.LLM_BROWSER_PROVIDER || undefined,
        browserModel: process.env.LLM_BROWSER_MODEL || undefined,
        browserStreams: (process.env.LLM_BROWSER_STREAMS || "").split(",").map(s => s.trim()).filter(Boolean),
        workingDir: process.env.WORKING_DIR || "./data",
        triggerWord: process.env.TRIGGER_WORD || "",
        ownerEmail: process.env.OWNER_EMAIL || "",
    };
}
