import path from "node:path";
import envPaths from "env-paths";

const paths = envPaths("ncli", { suffix: "" });

export const CONFIG_DIR = paths.config;
export const PROFILES_DIR = path.join(CONFIG_DIR, "profiles");
export const PROFILE_STATE_PATH = path.join(CONFIG_DIR, "profiles.json");
export const PROFILE_ENV_VAR = "NCLI_PROFILE";

// Legacy paths are retained only for one-time migration into profiles/default.
export const TOKENS_PATH = path.join(CONFIG_DIR, "tokens.json");
export const CLIENT_INFO_PATH = path.join(CONFIG_DIR, "client.json");
export const AUTH_STATE_PATH = path.join(CONFIG_DIR, "auth-state.json");
export const REST_TOKEN_PATH = path.join(CONFIG_DIR, "rest-token.json");

export const MCP_SERVER_URL = "https://mcp.notion.com/mcp";
export const CLIENT_NAME = "ncli";
export const CALLBACK_PATH = "/callback";
export const AUTH_TIMEOUT_MS = 120_000;
export const HEADLESS_AUTH_TIMEOUT_MS = 600_000;
export const MAX_AUTH_TIMEOUT_MS = HEADLESS_AUTH_TIMEOUT_MS;
export const MAX_CALLBACK_URL_LENGTH = 8_192;

export const NOTION_API_BASE_URL = "https://api.notion.com/v1";
export const OAUTH_SESSION_TTL_MS = 600_000;
export const NOTION_API_VERSION = "2026-03-11";
export const REST_TOKEN_ENV_VAR = "NOTION_API_KEY";
