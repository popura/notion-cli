import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthorizationInteraction } from "../auth/authorization-interaction.js";
import { HeadlessManualInteraction } from "../auth/headless-manual-interaction.js";
import { createPendingOAuthSession } from "../auth/oauth-session.js";
import type { NotionOAuthProvider } from "../auth/provider.js";
import { TokenStore } from "../auth/token-store.js";
import { CliError } from "../util/errors.js";
import {
	extractPortFromClientInfo,
	extractRedirectUriFromClientInfo,
	MCPConnection,
	type MCPConnectionDependencies,
} from "./client.js";

describe("extractPortFromClientInfo", () => {
	it("extracts port from redirect_uris", () => {
		expect(
			extractPortFromClientInfo({
				redirect_uris: ["http://127.0.0.1:54975/callback"],
				client_id: "abc",
			}),
		).toBe(54975);
	});

	it("returns undefined when info is undefined", () => {
		expect(extractPortFromClientInfo(undefined)).toBeUndefined();
	});

	it("returns undefined when redirect_uris is missing", () => {
		expect(extractPortFromClientInfo({ client_id: "abc" })).toBeUndefined();
	});

	it("returns undefined when redirect_uris is empty", () => {
		expect(extractPortFromClientInfo({ redirect_uris: [] })).toBeUndefined();
	});

	it("returns undefined for URL without explicit port", () => {
		expect(
			extractPortFromClientInfo({ redirect_uris: ["http://127.0.0.1/callback"] }),
		).toBeUndefined();
	});
});

describe("extractRedirectUriFromClientInfo", () => {
	it("accepts only the registered strict IPv4 loopback callback URI", () => {
		expect(
			extractRedirectUriFromClientInfo({
				redirect_uris: ["http://127.0.0.1:54975/callback"],
			})?.toString(),
		).toBe("http://127.0.0.1:54975/callback");
		expect(
			extractRedirectUriFromClientInfo({
				redirect_uris: ["http://localhost:54975/callback"],
			}),
		).toBeUndefined();
		expect(
			extractRedirectUriFromClientInfo({
				redirect_uris: ["http://127.0.0.1:54975/callback?state=old"],
			}),
		).toBeUndefined();
	});
});

describe("MCPConnection", () => {
	const temporaryDirectories: string[] = [];

	afterEach(() => {
		for (const directory of temporaryDirectories) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
		temporaryDirectories.length = 0;
	});

	function temporaryProfile(): string {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ncli-connection-test-"));
		temporaryDirectories.push(directory);
		return directory;
	}

	it("throws CliError when calling callTool before connect", async () => {
		const conn = new MCPConnection();
		await expect(conn.callTool("notion-search", { query: "test" })).rejects.toThrow(CliError);
		await expect(conn.callTool("notion-search", { query: "test" })).rejects.toThrow(
			"Not connected",
		);
	});

	it("throws CliError when calling listTools before connect", async () => {
		const conn = new MCPConnection();
		await expect(conn.listTools()).rejects.toThrow(CliError);
		await expect(conn.listTools()).rejects.toThrow("Not connected");
	});

	it("disconnect is safe when not connected", async () => {
		const conn = new MCPConnection();
		await expect(conn.disconnect()).resolves.toBeUndefined();
	});

	/**
	 * Preconditions: The selected profile already has OAuth tokens and compatible client registration.
	 * Prerequisites: The MCP client accepts the saved access token on its first connection attempt.
	 * Verification: Connection succeeds without constructing a browser interaction or loopback listener.
	 */
	it("does not initialize authorization interaction when stored tokens connect", async () => {
		const directory = temporaryProfile();
		const store = new TokenStore(directory);
		store.saveTokens({ access_token: "stored-access-token" });
		store.saveClientInfo({
			client_id: "stored-client",
			redirect_uris: ["http://127.0.0.1:54975/callback"],
		});
		const connect = vi.fn(async () => undefined);
		const client = {
			connect,
			close: vi.fn(async () => undefined),
		} as unknown as Client;
		const transport = {} as StreamableHTTPClientTransport;
		const createBrowserInteraction = vi.fn();
		const createHeadlessInteraction = vi.fn();
		const dependencies: Partial<MCPConnectionDependencies> = {
			createClient: () => client,
			createTransport: () => transport,
			createBrowserInteraction,
			createHeadlessInteraction,
		};
		const connection = new MCPConnection(
			{ profileDirectory: directory, profileName: "work" },
			dependencies,
		);

		await connection.connect();

		expect(connect).toHaveBeenCalledOnce();
		expect(createBrowserInteraction).not.toHaveBeenCalled();
		expect(createHeadlessInteraction).not.toHaveBeenCalled();
	});
	/**
	 * Preconditions: The selected profile has an expired access token and a usable refresh token.
	 * Prerequisites: The MCP SDK refreshes and saves the token during its first connection attempt.
	 * Verification: Connection succeeds with the rotated token without constructing either interaction.
	 */
	it("refreshes stored tokens without initializing an authorization interaction", async () => {
		const directory = temporaryProfile();
		const store = new TokenStore(directory);
		store.saveTokens({
			access_token: "expired-access-token",
			refresh_token: "usable-refresh-token",
		});
		store.saveClientInfo({
			client_id: "stored-client",
			redirect_uris: ["http://127.0.0.1:54975/callback"],
		});
		const createTransport = vi.fn((_url: URL, provider: NotionOAuthProvider) => {
			return { provider } as unknown as StreamableHTTPClientTransport;
		});
		const connect = vi.fn(async (transport: StreamableHTTPClientTransport) => {
			const { provider } = transport as unknown as { provider: NotionOAuthProvider };
			expect(provider.tokens()).toMatchObject({ refresh_token: "usable-refresh-token" });
			await provider.saveTokens({
				access_token: "refreshed-access-token",
				refresh_token: "rotated-refresh-token",
			});
		});
		const client = {
			connect,
			close: vi.fn(async () => undefined),
		} as unknown as Client;
		const createBrowserInteraction = vi.fn();
		const createHeadlessInteraction = vi.fn();
		const connection = new MCPConnection(
			{ profileDirectory: directory, profileName: "work" },
			{
				createClient: () => client,
				createTransport,
				createBrowserInteraction,
				createHeadlessInteraction,
			},
		);

		await connection.connect();

		expect(connect).toHaveBeenCalledOnce();
		expect(store.readTokens()).toEqual({
			access_token: "refreshed-access-token",
			refresh_token: "rotated-refresh-token",
		});
		expect(createBrowserInteraction).not.toHaveBeenCalled();
		expect(createHeadlessInteraction).not.toHaveBeenCalled();
	});

	/**
	 * Preconditions: The selected profile has an expired access token and an invalid refresh token.
	 * Prerequisites: The SDK removes only the rejected tokens and returns UnauthorizedError.
	 * Verification: MCPConnection closes the stored-token attempt, preserves client registration,
	 * and starts the selected reauthentication interaction with a headless recovery hint.
	 */
	it("starts reauthentication after an invalid refresh token", async () => {
		const directory = temporaryProfile();
		const store = new TokenStore(directory);
		store.saveTokens({
			access_token: "expired-access-token",
			refresh_token: "invalid-refresh-token",
		});
		store.saveClientInfo({
			client_id: "stored-client",
			redirect_uris: ["http://127.0.0.1:54975/callback"],
		});
		const createTransport = vi.fn((_url: URL, provider: NotionOAuthProvider) => {
			return { provider } as unknown as StreamableHTTPClientTransport;
		});
		const connect = vi.fn(async (transport: StreamableHTTPClientTransport) => {
			const { provider } = transport as unknown as { provider: NotionOAuthProvider };
			provider.invalidateCredentials("tokens");
			throw new UnauthorizedError();
		});
		const closeClient = vi.fn(async () => undefined);
		const client = { connect, close: closeClient } as unknown as Client;
		const listenerError = new CliError(
			"Could not start the local OAuth callback server",
			"The loopback listener is unavailable in this environment",
			'Run "ncli --profile work login --headless"',
		);
		const createBrowserInteraction = vi.fn(async () => {
			throw listenerError;
		});
		const createHeadlessInteraction = vi.fn();
		const connection = new MCPConnection(
			{ profileDirectory: directory, profileName: "work" },
			{
				createClient: () => client,
				createTransport,
				createBrowserInteraction,
				createHeadlessInteraction,
			},
		);

		await expect(connection.connect()).rejects.toBe(listenerError);

		expect(connect).toHaveBeenCalledOnce();
		expect(closeClient).toHaveBeenCalledOnce();
		expect(store.readTokens()).toBeUndefined();
		expect(store.readClientInfo()).toMatchObject({ client_id: "stored-client" });
		expect(createBrowserInteraction).toHaveBeenCalledOnce();
		expect(createHeadlessInteraction).not.toHaveBeenCalled();
	});

	/**
	 * Preconditions: The selected profile has no OAuth credentials and headless authorization is explicit.
	 * Prerequisites: The SDK starts PKCE authorization, the interaction returns a validated code, and token
	 * exchange succeeds.
	 * Verification: No browser interaction is built, the code reaches finishAuth once, connection retries,
	 * and the profile-scoped pending session is deleted.
	 */
	it("completes a headless authorization code exchange without browser interaction", async () => {
		const directory = temporaryProfile();
		const store = new TokenStore(directory);
		const redirectUrl = new URL("http://127.0.0.1:53742/callback");
		const presentAuthorizationUrl = vi.fn(async () => undefined);
		const waitForCallback = vi.fn(async () => ({ code: "validated-code" }));
		const closeInteraction = vi.fn(async () => undefined);
		const interaction: AuthorizationInteraction = {
			redirectUrl,
			presentAuthorizationUrl,
			waitForCallback,
			close: closeInteraction,
		};
		type TestTransport = {
			provider: NotionOAuthProvider;
			finishAuth: ReturnType<typeof vi.fn>;
		};
		const transports: TestTransport[] = [];
		const createTransport = vi.fn((_url: URL, provider: NotionOAuthProvider) => {
			const testTransport: TestTransport = {
				provider,
				finishAuth: vi.fn(async (code: string) => {
					expect(code).toBe("validated-code");
					expect(provider.codeVerifier()).toBe("test-code-verifier");
					await provider.saveTokens({ access_token: "new-access-token" });
				}),
			};
			transports.push(testTransport);
			return testTransport as unknown as StreamableHTTPClientTransport;
		});
		const connect = vi.fn(async (transport: StreamableHTTPClientTransport) => {
			if (connect.mock.calls.length !== 1) return;
			const testTransport = transport as unknown as TestTransport;
			testTransport.provider.state();
			await testTransport.provider.saveCodeVerifier("test-code-verifier");
			await testTransport.provider.redirectToAuthorization(
				new URL("https://mcp.notion.com/authorize?client_id=test"),
			);
			throw new UnauthorizedError();
		});
		const client = {
			connect,
			close: vi.fn(async () => undefined),
		} as unknown as Client;
		const createBrowserInteraction = vi.fn();
		const dependencies: Partial<MCPConnectionDependencies> = {
			createClient: () => client,
			createTransport,
			createBrowserInteraction,
			createHeadlessInteraction: vi.fn(() => interaction),
			randomPort: () => 53_742,
		};
		const connection = new MCPConnection(
			{
				profileDirectory: directory,
				profileName: "work",
				authorizationMode: "headless",
			},
			dependencies,
		);

		await connection.connect();

		expect(createBrowserInteraction).not.toHaveBeenCalled();
		expect(presentAuthorizationUrl).toHaveBeenCalledOnce();
		expect(waitForCallback).toHaveBeenCalledOnce();
		expect(transports[0]?.finishAuth).toHaveBeenCalledOnce();
		expect(connect).toHaveBeenCalledTimes(2);
		expect(store.readTokens()).toEqual({ access_token: "new-access-token" });
		expect(store.readOAuthSession()).toBeUndefined();
		expect(closeInteraction).toHaveBeenCalledOnce();
	});

	/**
	 * Preconditions: Profiles work and personal own separate pending headless sessions.
	 * Prerequisites: The callback pasted for work carries a secret code and the state stored for personal.
	 * Verification: Work rejects before finishAuth and deletes only its state; personal remains intact.
	 */
	it("rejects a callback state owned by another profile", async () => {
		const directory = temporaryProfile();
		const store = new TokenStore(directory);
		const otherStore = new TokenStore(temporaryProfile());
		const otherSession = createPendingOAuthSession("http://127.0.0.1:53742/callback", "headless");
		otherStore.beginOAuthSession(otherSession, "personal");
		type TestTransport = {
			provider: NotionOAuthProvider;
			finishAuth: ReturnType<typeof vi.fn>;
		};
		const transports: TestTransport[] = [];
		const createTransport = vi.fn((_url: URL, provider: NotionOAuthProvider) => {
			const testTransport: TestTransport = {
				provider,
				finishAuth: vi.fn(async () => undefined),
			};
			transports.push(testTransport);
			return testTransport as unknown as StreamableHTTPClientTransport;
		});
		const connect = vi.fn(async (transport: StreamableHTTPClientTransport) => {
			const testTransport = transport as unknown as TestTransport;
			testTransport.provider.state();
			await testTransport.provider.saveCodeVerifier("test-code-verifier");
			await testTransport.provider.redirectToAuthorization(
				new URL("https://mcp.notion.com/authorize?client_id=test"),
			);
			throw new UnauthorizedError();
		});
		const client = {
			connect,
			close: vi.fn(async () => undefined),
		} as unknown as Client;
		const createBrowserInteraction = vi.fn();
		const dependencies: Partial<MCPConnectionDependencies> = {
			createClient: () => client,
			createTransport,
			createBrowserInteraction,
			createHeadlessInteraction: vi.fn(
				(options) =>
					new HeadlessManualInteraction({
						...options,
						isInteractive: () => true,
						readCallbackUrl: async () =>
							`${options.redirectUrl}?code=secret-rejected-code&state=${otherSession.state}`,
						writeStderr: () => undefined,
					}),
			),
			randomPort: () => 53_742,
		};
		const connection = new MCPConnection(
			{
				profileDirectory: directory,
				profileName: "work",
				authorizationMode: "headless",
			},
			dependencies,
		);
		let thrown: unknown;

		try {
			await connection.connect();
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(CliError);
		expect(thrown).toMatchObject({
			hint: 'Restart "ncli --profile work login --headless" and paste the callback URL from the new authorization attempt',
		});
		expect(String(thrown)).not.toContain("secret-rejected-code");
		expect(transports[0]?.finishAuth).not.toHaveBeenCalled();
		expect(store.readTokens()).toBeUndefined();
		expect(store.readOAuthSession()).toBeUndefined();
		expect(otherStore.readOAuthSession()).toMatchObject({ state: otherSession.state });
		expect(createBrowserInteraction).not.toHaveBeenCalled();
	});

	/**
	 * Preconditions: A desktop login has no usable token and a loopback listener is ready.
	 * Prerequisites: The SDK creates state and PKCE data before launching the browser.
	 * Verification: Callback waiting is armed before browser launch, then the existing code-exchange
	 * and reconnect sequence succeeds.
	 */
	it("arms the browser callback before presenting the authorization URL", async () => {
		const directory = temporaryProfile();
		const redirectUrl = new URL("http://127.0.0.1:53742/callback");
		const waitForCallback = vi.fn(async () => ({ code: "browser-code" }));
		const presentAuthorizationUrl = vi.fn(async () => undefined);
		const closeInteraction = vi.fn(async () => undefined);
		const interaction: AuthorizationInteraction = {
			redirectUrl,
			waitForCallback,
			presentAuthorizationUrl,
			close: closeInteraction,
		};
		type TestTransport = {
			provider: NotionOAuthProvider;
			finishAuth: ReturnType<typeof vi.fn>;
		};
		const transports: TestTransport[] = [];
		const createTransport = vi.fn((_url: URL, provider: NotionOAuthProvider) => {
			const testTransport: TestTransport = {
				provider,
				finishAuth: vi.fn(async () => {
					await provider.saveTokens({ access_token: "browser-access-token" });
				}),
			};
			transports.push(testTransport);
			return testTransport as unknown as StreamableHTTPClientTransport;
		});
		const connect = vi.fn(async (transport: StreamableHTTPClientTransport) => {
			if (connect.mock.calls.length !== 1) return;
			const testTransport = transport as unknown as TestTransport;
			testTransport.provider.state();
			await testTransport.provider.saveCodeVerifier("browser-verifier");
			expect(waitForCallback).toHaveBeenCalledOnce();
			await testTransport.provider.redirectToAuthorization(
				new URL("https://mcp.notion.com/authorize?client_id=test"),
			);
			throw new UnauthorizedError();
		});
		const client = {
			connect,
			close: vi.fn(async () => undefined),
		} as unknown as Client;
		const createHeadlessInteraction = vi.fn();
		const connection = new MCPConnection(
			{
				profileDirectory: directory,
				profileName: "work",
				authorizationMode: "browser",
			},
			{
				createClient: () => client,
				createTransport,
				createBrowserInteraction: vi.fn(async () => interaction),
				createHeadlessInteraction,
				randomPort: () => 53_742,
			},
		);

		await connection.connect();

		expect(presentAuthorizationUrl).toHaveBeenCalledOnce();
		expect(transports[0]?.finishAuth).toHaveBeenCalledWith("browser-code");
		expect(connect).toHaveBeenCalledTimes(2);
		expect(closeInteraction).toHaveBeenCalledOnce();
		expect(createHeadlessInteraction).not.toHaveBeenCalled();
	});

	/**
	 * Preconditions: Headless OAuth has persisted state and a PKCE verifier for one profile.
	 * Prerequisites: Manual authorization ends in either an explicit denial or input timeout.
	 * Verification: Both classified failures skip token exchange and remove the owned temporary state.
	 */
	it.each([
		{
			label: "authorization denial",
			error: new CliError(
				"OAuth authorization was denied",
				"The user declined access",
				'Run "ncli login --headless" again',
			),
		},
		{
			label: "input timeout",
			error: new CliError(
				"OAuth callback timed out",
				"No callback URL was entered within 600 seconds",
				'Run "ncli login --headless" again',
			),
		},
	])("cleans pending state after $label", async ({ error }) => {
		const directory = temporaryProfile();
		const store = new TokenStore(directory);
		const redirectUrl = new URL("http://127.0.0.1:53742/callback");
		const finishAuth = vi.fn(async () => undefined);
		type TestTransport = {
			provider: NotionOAuthProvider;
			finishAuth: typeof finishAuth;
		};
		const createTransport = vi.fn((_url: URL, provider: NotionOAuthProvider) => {
			return { provider, finishAuth } as unknown as StreamableHTTPClientTransport;
		});
		const connect = vi.fn(async (transport: StreamableHTTPClientTransport) => {
			const testTransport = transport as unknown as TestTransport;
			testTransport.provider.state();
			await testTransport.provider.saveCodeVerifier("test-code-verifier");
			await testTransport.provider.redirectToAuthorization(
				new URL("https://mcp.notion.com/authorize?client_id=test"),
			);
			throw new UnauthorizedError();
		});
		const client = {
			connect,
			close: vi.fn(async () => undefined),
		} as unknown as Client;
		const interaction: AuthorizationInteraction = {
			redirectUrl,
			presentAuthorizationUrl: vi.fn(async () => undefined),
			waitForCallback: vi.fn(async () => {
				throw error;
			}),
			close: vi.fn(async () => undefined),
		};
		const connection = new MCPConnection(
			{
				profileDirectory: directory,
				profileName: "work",
				authorizationMode: "headless",
			},
			{
				createClient: () => client,
				createTransport,
				createHeadlessInteraction: vi.fn(() => interaction),
				randomPort: () => 53_742,
			},
		);

		await expect(connection.connect()).rejects.toBe(error);

		expect(finishAuth).not.toHaveBeenCalled();
		expect(store.readTokens()).toBeUndefined();
		expect(store.readOAuthSession()).toBeUndefined();
	});
});
