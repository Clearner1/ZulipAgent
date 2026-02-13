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

    // Workspace
    workingDir: string;

    // Trigger
    triggerWord: string;
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
        workingDir: process.env.WORKING_DIR || "./data",
        triggerWord: process.env.TRIGGER_WORD || "",
    };
}
