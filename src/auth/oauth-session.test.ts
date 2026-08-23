import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OAUTH_SESSION_TTL_MS } from "../util/config.js";
import { createPendingOAuthSession, OAuthSessionManager } from "./oauth-session.js";
import { TokenStore } from "./token-store.js";

describe("createPendingOAuthSession", () => {
	/**
	 * Preconditions: A new headless login starts with a selected loopback redirect URI.
	 * Prerequisites: No PKCE verifier exists until the MCP SDK creates one later in the flow.
	 * Verification: Each session has an independent 256-bit base64url state and a ten-minute expiry.
	 */
	it("creates a versioned pending session with a fresh high-entropy state", () => {
		const now = new Date("2026-08-23T10:00:00.000Z");
		const first = createPendingOAuthSession("http://127.0.0.1:53742/callback", "headless", now);
		const second = createPendingOAuthSession("http://127.0.0.1:53742/callback", "headless", now);

		expect(first).toMatchObject({
			schemaVersion: 2,
			codeVerifier: null,
			redirectUri: "http://127.0.0.1:53742/callback",
			mode: "headless",
			createdAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + OAUTH_SESSION_TTL_MS).toISOString(),
		});
		expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(second.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(first.state).not.toBe(second.state);
	});
});

describe("OAuthSessionManager", () => {
	/**
	 * Preconditions: A selected profile has no pending auth-state file.
	 * Prerequisites: The provider may read saved tokens without ever requesting a new OAuth state.
	 * Verification: State creation is lazy, verifier updates preserve the session, and clear removes it.
	 */
	it("owns one lazy pending session from state creation through cleanup", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ncli-oauth-session-test-"));
		try {
			const store = new TokenStore(directory);
			const now = new Date("2026-08-23T10:00:00.000Z");
			const manager = new OAuthSessionManager(
				store,
				"http://127.0.0.1:53742/callback",
				"headless",
				"work",
				() => now,
			);

			expect(store.readOAuthSession()).toBeUndefined();

			const state = manager.state();
			expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
			expect(manager.current()).toMatchObject({ state, codeVerifier: null });

			manager.saveCodeVerifier("verifier123");
			expect(manager.codeVerifier()).toBe("verifier123");
			expect(store.readOAuthSession()).toMatchObject({ state, codeVerifier: "verifier123" });

			manager.clear();
			expect(store.readOAuthSession()).toBeUndefined();
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});
});
