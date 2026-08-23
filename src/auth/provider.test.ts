import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthorizationInteraction } from "./authorization-interaction.js";
import { OAuthSessionManager } from "./oauth-session.js";
import { NotionOAuthProvider } from "./provider.js";
import { TokenStore } from "./token-store.js";

function createInteraction(redirectUrl: URL): AuthorizationInteraction {
	return {
		redirectUrl,
		presentAuthorizationUrl: vi.fn(async () => undefined),
		waitForCallback: vi.fn(async () => ({ code: "authorization-code" })),
		close: vi.fn(async () => undefined),
	};
}

describe("NotionOAuthProvider", () => {
	let directory: string;

	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "ncli-provider-test-"));
	});

	afterEach(() => {
		fs.rmSync(directory, { recursive: true, force: true });
	});

	/**
	 * Preconditions: The provider has a profile-scoped store, a lazy session manager, and a
	 * replaceable authorization interaction.
	 * Prerequisites: The SDK asks for state, saves its PKCE verifier, and supplies an authorization URL.
	 * Verification: Provider delegates all user interaction and preserves the structured session.
	 */
	it("delegates authorization while exposing session state and redirect URI", async () => {
		const store = new TokenStore(directory);
		const redirectUrl = new URL("http://127.0.0.1:53742/callback");
		const manager = new OAuthSessionManager(
			store,
			redirectUrl.toString(),
			"headless",
			"work",
			() => new Date("2026-08-23T10:00:00.000Z"),
		);
		const interaction = createInteraction(redirectUrl);
		const provider = new NotionOAuthProvider(store, manager, interaction);
		const authorizationUrl = new URL("https://mcp.notion.com/authorize?client_id=test");

		const state = await provider.state();
		await provider.saveCodeVerifier("verifier123");
		await provider.redirectToAuthorization(authorizationUrl);

		expect(provider.redirectUrl).toBe(redirectUrl);
		expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(provider.codeVerifier()).toBe("verifier123");
		expect(interaction.presentAuthorizationUrl).toHaveBeenCalledWith(authorizationUrl);
		expect(store.readOAuthSession()).toMatchObject({
			state,
			codeVerifier: "verifier123",
			redirectUri: redirectUrl.toString(),
		});
	});

	/**
	 * Preconditions: The selected profile has saved OAuth tokens, client registration, and a pending
	 * session started by this provider.
	 * Prerequisites: The SDK reports invalid_grant and asks the provider to invalidate only tokens.
	 * Verification: Tokens are removed while client registration and pending session remain available.
	 */
	it("invalidates only tokens when the SDK reports an invalid grant", async () => {
		const store = new TokenStore(directory);
		const redirectUrl = new URL("http://127.0.0.1:53742/callback");
		const manager = new OAuthSessionManager(
			store,
			redirectUrl.toString(),
			"browser",
			"work",
			() => new Date("2026-08-23T10:00:00.000Z"),
		);
		const provider = new NotionOAuthProvider(store, manager, createInteraction(redirectUrl));
		store.saveTokens({ access_token: "expired", refresh_token: "invalid" });
		store.saveClientInfo({ client_id: "registered-client" });
		const state = await provider.state();

		await provider.invalidateCredentials("tokens");

		expect(store.readTokens()).toBeUndefined();
		expect(store.readClientInfo()).toEqual({ client_id: "registered-client" });
		expect(store.readOAuthSession()).toMatchObject({ state });
	});
});
