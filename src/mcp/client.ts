import { randomInt } from "node:crypto";
import path from "node:path";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { AuthorizationInteraction } from "../auth/authorization-interaction.js";
import {
	BrowserLoopbackInteraction,
	type BrowserLoopbackInteractionOptions,
} from "../auth/browser-loopback-interaction.js";
import type { OAuthCallbackResult } from "../auth/callback-parser.js";
import {
	HeadlessManualInteraction,
	type HeadlessManualInteractionOptions,
} from "../auth/headless-manual-interaction.js";
import { type AuthorizationMode, OAuthSessionManager } from "../auth/oauth-session.js";
import { NotionOAuthProvider } from "../auth/provider.js";
import { TokenStore } from "../auth/token-store.js";
import { resolveRuntimeProfile } from "../profile/runtime.js";
import {
	AUTH_TIMEOUT_MS,
	CALLBACK_PATH,
	HEADLESS_AUTH_TIMEOUT_MS,
	MAX_AUTH_TIMEOUT_MS,
	MCP_SERVER_URL,
} from "../util/config.js";
import { CliError } from "../util/errors.js";

declare const __NCLI_VERSION__: string;
const version = typeof __NCLI_VERSION__ !== "undefined" ? __NCLI_VERSION__ : "0.0.0-dev";

const DYNAMIC_PORT_MIN = 49_152;
const DYNAMIC_PORT_MAX = 65_535;

export interface MCPConnectionOptions {
	readonly profileDirectory?: string;
	readonly profileName?: string;
	readonly authorizationMode?: AuthorizationMode;
	readonly authorizationTimeoutMs?: number;
}

export interface MCPConnectionDependencies {
	readonly createClient: () => Client;
	readonly createTransport: (
		serverUrl: URL,
		provider: NotionOAuthProvider,
	) => StreamableHTTPClientTransport;
	readonly createTokenStore: (directory: string) => TokenStore;
	readonly createBrowserInteraction: (
		options: BrowserLoopbackInteractionOptions,
	) => Promise<AuthorizationInteraction>;
	readonly createHeadlessInteraction: (
		options: HeadlessManualInteractionOptions,
	) => AuthorizationInteraction;
	readonly randomPort: () => number;
}

const DEFAULT_DEPENDENCIES: MCPConnectionDependencies = {
	createClient: () => new Client({ name: "ncli", version }, { capabilities: {} }),
	createTransport: (serverUrl, provider) =>
		new StreamableHTTPClientTransport(serverUrl, { authProvider: provider }),
	createTokenStore: (directory) => new TokenStore(directory),
	createBrowserInteraction: (options) => BrowserLoopbackInteraction.create(options),
	createHeadlessInteraction: (options) => new HeadlessManualInteraction(options),
	randomPort: () => randomInt(DYNAMIC_PORT_MIN, DYNAMIC_PORT_MAX + 1),
};

class DeferredAuthorizationInteraction implements AuthorizationInteraction {
	constructor(readonly redirectUrl: URL) {}

	presentAuthorizationUrl(): Promise<void> {
		return Promise.resolve();
	}

	waitForCallback(): Promise<never> {
		return Promise.reject(
			new CliError(
				"OAuth authorization interaction is not active",
				"The stored credentials were tested before starting an interactive login",
				"Retry with an explicit login command",
			),
		);
	}

	close(): Promise<void> {
		return Promise.resolve();
	}
}

export class MCPConnection {
	private readonly options: MCPConnectionOptions;
	private readonly dependencies: MCPConnectionDependencies;
	private client: Client | null = null;

	constructor(
		options: MCPConnectionOptions | string = {},
		dependencies: Partial<MCPConnectionDependencies> = {},
	) {
		this.options = typeof options === "string" ? { profileDirectory: options } : options;
		this.dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies };
	}

	async connect(): Promise<void> {
		if (this.client) return;
		const profile = this.resolveProfile();
		const tokenStore = this.dependencies.createTokenStore(profile.directory);
		const mode = this.options.authorizationMode ?? "browser";
		const timeoutMs = resolveAuthorizationTimeoutMs(mode, this.options.authorizationTimeoutMs);

		if (tokenStore.readTokens()) {
			const connected = await this.tryStoredCredentials(tokenStore, profile.name, mode);
			if (connected) return;
		}

		await this.authenticate(tokenStore, profile.name, mode, timeoutMs);
	}

	async callTool(
		name: string,
		args: Record<string, unknown> = {},
	): Promise<Awaited<ReturnType<Client["callTool"]>>> {
		if (!this.client) {
			throw new CliError(
				"Not connected to Notion",
				"connect() has not been called",
				"Run any command — connection is automatic",
			);
		}
		const result = await this.client.callTool({ name, arguments: args });
		if (result.isError) {
			throw mcpErrorToCliError(name, result);
		}
		return result;
	}

	async listTools(): Promise<Tool[]> {
		if (!this.client) {
			throw new CliError(
				"Not connected to Notion",
				"connect() has not been called",
				"Run any command — connection is automatic",
			);
		}
		const result = await this.client.listTools();
		return result.tools;
	}

	async disconnect(): Promise<void> {
		if (!this.client) return;
		await this.client.close();
		this.client = null;
	}

	private resolveProfile(): { directory: string; name: string } {
		if (!this.options.profileDirectory) {
			const profile = resolveRuntimeProfile();
			return {
				directory: profile.directory,
				name: this.options.profileName ?? profile.name,
			};
		}
		return {
			directory: this.options.profileDirectory,
			name: this.options.profileName ?? (path.basename(this.options.profileDirectory) || "default"),
		};
	}

	private async tryStoredCredentials(
		tokenStore: TokenStore,
		profileName: string,
		mode: AuthorizationMode,
	): Promise<boolean> {
		const redirectUrl = resolveLoopbackRedirectUrl(
			tokenStore.readClientInfo(),
			this.dependencies.randomPort,
		);
		const interaction = new DeferredAuthorizationInteraction(redirectUrl);
		const sessionManager = new OAuthSessionManager(
			tokenStore,
			redirectUrl.toString(),
			mode,
			profileName,
		);
		const provider = new NotionOAuthProvider(tokenStore, sessionManager, interaction);
		const client = this.dependencies.createClient();
		const transport = this.dependencies.createTransport(new URL(MCP_SERVER_URL), provider);

		try {
			await client.connect(transport);
			sessionManager.clear();
			this.client = client;
			return true;
		} catch (error) {
			sessionManager.clear();
			await closeIgnoringErrors(client);
			if (error instanceof UnauthorizedError) return false;
			throw error;
		}
	}

	private async authenticate(
		tokenStore: TokenStore,
		profileName: string,
		mode: AuthorizationMode,
		timeoutMs: number,
	): Promise<void> {
		const interaction = await this.createAuthorizationInteraction(
			tokenStore,
			profileName,
			mode,
			timeoutMs,
		);
		const sessionManager = new OAuthSessionManager(
			tokenStore,
			interaction.redirectUrl.toString(),
			mode,
			profileName,
		);
		const provider = new NotionOAuthProvider(tokenStore, sessionManager, interaction);
		const client = this.dependencies.createClient();
		const serverUrl = new URL(MCP_SERVER_URL);
		const transport = this.dependencies.createTransport(serverUrl, provider);
		let browserCallback: Promise<OAuthCallbackResult> | undefined;

		try {
			if (mode === "browser") {
				sessionManager.state();
				const session = sessionManager.current();
				if (!session) {
					throw new CliError(
						"OAuth authorization could not be started",
						"The profile-scoped pending login session could not be saved",
						loginHint(profileName, mode),
					);
				}
				browserCallback = interaction.waitForCallback(session);
				void browserCallback.catch(() => undefined);
			}
		} catch (error) {
			sessionManager.clear();
			await interaction.close();
			await closeIgnoringErrors(client);
			throw error;
		}

		try {
			await client.connect(transport);
			sessionManager.clear();
			await interaction.close();
			this.client = client;
			return;
		} catch (error) {
			if (!(error instanceof UnauthorizedError)) {
				sessionManager.clear();
				await interaction.close();
				await closeIgnoringErrors(client);
				throw error;
			}
		}

		try {
			let result: OAuthCallbackResult;
			if (browserCallback) {
				result = await browserCallback;
			} else {
				const session = sessionManager.current();
				if (!session) {
					throw new CliError(
						"OAuth authorization could not be completed",
						"The pending login session is missing or was replaced",
						loginHint(profileName, mode),
					);
				}
				result = await interaction.waitForCallback(session);
			}
			await transport.finishAuth(result.code);
		} catch (error) {
			await closeIgnoringErrors(client);
			throw error;
		} finally {
			sessionManager.clear();
			await interaction.close();
		}

		const authenticatedTransport = this.dependencies.createTransport(serverUrl, provider);
		try {
			await client.connect(authenticatedTransport);
			this.client = client;
		} catch (error) {
			await closeIgnoringErrors(client);
			throw error;
		}
	}

	private async createAuthorizationInteraction(
		tokenStore: TokenStore,
		profileName: string,
		mode: AuthorizationMode,
		timeoutMs: number,
	): Promise<AuthorizationInteraction> {
		const clientInfo = tokenStore.readClientInfo();
		const savedRedirectUrl = extractRedirectUriFromClientInfo(clientInfo);
		const redirectUrl =
			savedRedirectUrl ?? createLoopbackRedirectUrl(this.dependencies.randomPort());
		if (clientInfo && !savedRedirectUrl) tokenStore.deleteClientInfo();

		if (mode === "headless") {
			return this.dependencies.createHeadlessInteraction({
				redirectUrl,
				profileName,
				timeoutMs,
			});
		}

		const interaction = await this.dependencies.createBrowserInteraction({
			preferredPort: Number(redirectUrl.port),
			timeoutMs,
			profileName,
		});
		if (interaction.redirectUrl.toString() !== redirectUrl.toString()) {
			tokenStore.deleteClientInfo();
		}
		return interaction;
	}
}

function resolveAuthorizationTimeoutMs(
	mode: AuthorizationMode,
	requested: number | undefined,
): number {
	const timeoutMs = requested ?? (mode === "headless" ? HEADLESS_AUTH_TIMEOUT_MS : AUTH_TIMEOUT_MS);
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_AUTH_TIMEOUT_MS) {
		throw new CliError(
			"Invalid OAuth authorization timeout",
			`The timeout must be between 1 and ${MAX_AUTH_TIMEOUT_MS / 1000} seconds`,
			"Choose a timeout in the supported range",
		);
	}
	return timeoutMs;
}

function createLoopbackRedirectUrl(port: number): URL {
	if (!Number.isInteger(port) || port < DYNAMIC_PORT_MIN || port > DYNAMIC_PORT_MAX) {
		throw new CliError(
			"Could not select an OAuth redirect port",
			"The generated port is outside the dynamic private port range",
			"Retry the login attempt",
		);
	}
	return new URL(`http://127.0.0.1:${port}${CALLBACK_PATH}`);
}

function resolveLoopbackRedirectUrl(
	clientInfo: Record<string, unknown> | undefined,
	selectPort: () => number,
): URL {
	return extractRedirectUriFromClientInfo(clientInfo) ?? createLoopbackRedirectUrl(selectPort());
}

function loginHint(profileName: string, mode: AuthorizationMode): string {
	const suffix = mode === "headless" ? " --headless" : "";
	return `Run "ncli --profile ${profileName} login${suffix}" again`;
}

async function closeIgnoringErrors(client: Client): Promise<void> {
	try {
		await client.close();
	} catch {
		// Preserve the primary connection or authorization error.
	}
}

function extractMcpErrorMessage(result: Record<string, unknown>): string {
	const content = result.content;
	if (!Array.isArray(content)) return "Unknown MCP error";
	const text = (content as Array<{ type: string; text?: string }>)
		.filter((c) => c.type === "text" && c.text)
		.map((c) => c.text)
		.join("\n");
	try {
		const parsed = JSON.parse(text);
		if (parsed.body) {
			try {
				const body = JSON.parse(parsed.body);
				return body.message || parsed.message || text;
			} catch {
				return parsed.message || text;
			}
		}
		return parsed.message || text;
	} catch {
		return text || "Unknown MCP error";
	}
}

interface HintRule {
	pattern: RegExp;
	tool?: string;
	hint: string;
}

const HINT_RULES: HintRule[] = [
	// Tool-specific hints (checked first)
	{
		pattern: /could not find page with id/i,
		tool: "notion-create-pages",
		hint: 'If adding to a database, use --parent collection://<ds-id>. For --data, use "parent":{"data_source_id":"<uuid>","type":"data_source_id"}. Run "ncli fetch <db-id>" to get the data_source_id',
	},
	{
		pattern: /invalid database view url/i,
		hint: 'Use a view URL with ?v= parameter. Run "ncli fetch <db-id>" to find view URLs, or create one with "ncli view create"',
	},
	{
		pattern: /data_source_id[\s\S]*?required/i,
		hint: "data_source_id is required. Use --parent collection://<ds-id> or, with --data, pass the bare UUID from the fetched collection://... value",
	},
	{
		pattern: /rich_text[\s\S]*?required/i,
		hint: 'Use --body "your comment text" to set the comment content',
	},
	{
		pattern: /tool .* not found/i,
		hint: 'Run "ncli --help" to see available commands, or check the tool name for typos',
	},
	// Generic hints
	{
		pattern: /unauthorized|not authorized/i,
		hint: 'Run "ncli login" to re-authenticate',
	},
	{
		pattern: /could not find|does not exist/i,
		hint: 'Check the ID or URL. Run "ncli search" to find the correct resource',
	},
	{
		pattern: /rate limit|429/i,
		hint: "Wait a moment and retry. The CLI retries automatically up to 3 times",
	},
	{
		pattern: /input validation error/i,
		hint: 'Check required arguments. Use --data for full control, or run "ncli <command> --help" for usage',
	},
];

function mcpErrorToCliError(toolName: string, result: Record<string, unknown>): CliError {
	const message = extractMcpErrorMessage(result);
	const rule = HINT_RULES.find((r) => r.pattern.test(message) && (!r.tool || r.tool === toolName));
	return new CliError(`${toolName} failed`, message, rule?.hint);
}

export function extractRedirectUriFromClientInfo(
	info: Record<string, unknown> | undefined,
): URL | undefined {
	const uris = info?.redirect_uris;
	if (!Array.isArray(uris) || typeof uris[0] !== "string") return undefined;
	try {
		const url = new URL(uris[0]);
		const port = Number(url.port);
		if (
			url.protocol !== "http:" ||
			url.hostname !== "127.0.0.1" ||
			url.pathname !== CALLBACK_PATH ||
			url.username !== "" ||
			url.password !== "" ||
			url.search !== "" ||
			url.hash !== "" ||
			!Number.isInteger(port) ||
			port < 1 ||
			port > 65_535
		) {
			return undefined;
		}
		return url;
	} catch {
		return undefined;
	}
}

export function extractPortFromClientInfo(
	info: Record<string, unknown> | undefined,
): number | undefined {
	const redirectUrl = extractRedirectUriFromClientInfo(info);
	return redirectUrl ? Number(redirectUrl.port) : undefined;
}
