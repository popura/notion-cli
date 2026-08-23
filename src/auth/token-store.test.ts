import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPendingOAuthSession } from "./oauth-session.js";
import { TokenStore } from "./token-store.js";

describe("TokenStore", () => {
	let tmpDir: string;
	let store: TokenStore;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ncli-test-"));
		store = new TokenStore(tmpDir);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("tokens", () => {
		it("returns undefined when no tokens file exists", () => {
			expect(store.readTokens()).toBeUndefined();
		});

		it("saves and reads tokens", () => {
			const tokens = { access_token: "abc", refresh_token: "def", expires_in: 3600 };
			store.saveTokens(tokens);
			expect(store.readTokens()).toEqual(tokens);
		});

		it("deletes tokens", () => {
			store.saveTokens({ access_token: "abc" });
			store.deleteTokens();
			expect(store.readTokens()).toBeUndefined();
		});

		it("delete is no-op when file missing", () => {
			expect(() => store.deleteTokens()).not.toThrow();
		});

		it("writes files with 0o600 permissions", () => {
			store.saveTokens({ access_token: "abc" });
			const stat = fs.statSync(path.join(tmpDir, "tokens.json"));
			expect(stat.mode & 0o777).toBe(0o600);
		});
	});

	describe("clientInfo", () => {
		it("returns undefined when no file exists", () => {
			expect(store.readClientInfo()).toBeUndefined();
		});

		it("saves and reads client info", () => {
			const info = { client_id: "id123", client_secret: "sec456" };
			store.saveClientInfo(info);
			expect(store.readClientInfo()).toEqual(info);
		});

		it("deletes client info", () => {
			store.saveClientInfo({ client_id: "id123" });
			store.deleteClientInfo();
			expect(store.readClientInfo()).toBeUndefined();
		});
	});

	describe("OAuth session", () => {
		/**
		 * Preconditions: The selected profile has no pending auth-state file.
		 * Prerequisites: A version 2 session was created with state, redirect URI, mode, and expiry.
		 * Verification: TokenStore persists and returns the complete pending session unchanged.
		 */
		it("begins and reads a structured pending OAuth session", () => {
			const session = createPendingOAuthSession(
				"http://127.0.0.1:53742/callback",
				"headless",
				new Date("2026-08-23T10:00:00.000Z"),
			);

			store.beginOAuthSession(session, "work");

			expect(store.readOAuthSession()).toEqual(session);
		});

		/**
		 * Preconditions: A complete version 2 OAuth session is already pending for this profile.
		 * Prerequisites: The MCP SDK generated the PKCE verifier after state creation.
		 * Verification: Saving the verifier changes only codeVerifier and preserves every session field.
		 */
		it("adds a code verifier without erasing pending session metadata", () => {
			const session = createPendingOAuthSession(
				"http://127.0.0.1:53742/callback",
				"browser",
				new Date("2026-08-23T10:00:00.000Z"),
			);
			store.beginOAuthSession(session, "work");

			store.saveCodeVerifier("verifier123");

			expect(store.readOAuthSession()).toEqual({
				...session,
				codeVerifier: "verifier123",
			});
			expect(store.readCodeVerifier()).toBe("verifier123");
		});

		/**
		 * Preconditions: auth-state.json uses the pre-version-2 shape containing only codeVerifier.
		 * Prerequisites: The file is temporary state and has no state, redirect URI, mode, or expiry.
		 * Verification: Reading the pending session discards the legacy file instead of migrating it.
		 */
		it("discards the legacy codeVerifier-only auth state", () => {
			const statePath = path.join(tmpDir, "auth-state.json");
			fs.writeFileSync(statePath, JSON.stringify({ codeVerifier: "legacy-verifier" }));

			expect(store.readOAuthSession()).toBeUndefined();
			expect(fs.existsSync(statePath)).toBe(false);
		});

		/**
		 * Preconditions: A non-expired OAuth session is already pending for profile work.
		 * Prerequisites: A second process attempts to begin a different session in the same directory.
		 * Verification: TokenStore rejects the second login and preserves the first pending session.
		 */
		it("rejects a concurrent login for the same profile", () => {
			const first = createPendingOAuthSession(
				"http://127.0.0.1:53742/callback",
				"browser",
				new Date("2026-08-23T10:00:00.000Z"),
			);
			const second = createPendingOAuthSession(
				"http://127.0.0.1:53743/callback",
				"headless",
				new Date("2026-08-23T10:01:00.000Z"),
			);
			store.beginOAuthSession(first, "work");

			expect(() =>
				store.beginOAuthSession(second, "work", new Date("2026-08-23T10:01:00.000Z")),
			).toThrow('Another login is already in progress for profile "work"');
			expect(store.readOAuthSession()).toEqual(first);
		});

		/**
		 * Preconditions: One version 2 OAuth session is pending for the selected profile.
		 * Prerequisites: Cleanup may run after another process has attempted to change auth-state.json.
		 * Verification: A wrong state cannot delete the file, while the owning state removes it.
		 */
		it("deletes only the pending OAuth session with the expected state", () => {
			const session = createPendingOAuthSession(
				"http://127.0.0.1:53742/callback",
				"headless",
				new Date("2026-08-23T10:00:00.000Z"),
			);
			store.beginOAuthSession(session, "work");

			expect(store.deleteOAuthSession("other-state")).toBe(false);
			expect(store.readOAuthSession()).toEqual(session);
			expect(store.deleteOAuthSession(session.state)).toBe(true);
			expect(store.readOAuthSession()).toBeUndefined();
		});

		/**
		 * Preconditions: A profile starts a new OAuth session on a POSIX-compatible filesystem.
		 * Prerequisites: auth-state.json contains state and a PKCE verifier and is sensitive temporary data.
		 * Verification: The completed state file is readable and writable only by its owner.
		 */
		it("writes pending OAuth state with 0o600 permissions", () => {
			const session = createPendingOAuthSession("http://127.0.0.1:53742/callback", "headless");
			store.beginOAuthSession(session, "work");
			store.saveCodeVerifier("verifier123");

			const stat = fs.statSync(path.join(tmpDir, "auth-state.json"));
			expect(stat.mode & 0o777).toBe(0o600);
		});

		/**
		 * Preconditions: A profile contains an OAuth session whose ten-minute lifetime has elapsed.
		 * Prerequisites: A new login starts after the old expiresAt timestamp.
		 * Verification: The stale lock is removed and replaced by the new complete session.
		 */
		it("replaces an expired pending OAuth session", () => {
			const expired = createPendingOAuthSession(
				"http://127.0.0.1:53742/callback",
				"browser",
				new Date("2026-08-23T10:00:00.000Z"),
			);
			const replacement = createPendingOAuthSession(
				"http://127.0.0.1:53743/callback",
				"headless",
				new Date("2026-08-23T10:11:00.000Z"),
			);
			store.beginOAuthSession(expired, "work");

			store.beginOAuthSession(replacement, "work", new Date("2026-08-23T10:11:00.000Z"));

			expect(store.readOAuthSession()).toEqual(replacement);
		});

		/**
		 * Preconditions: Two named profiles live in different profile directories.
		 * Prerequisites: Both profiles begin OAuth independently and only work receives tokens and PKCE data.
		 * Verification: State, verifier, client registration, and tokens never cross profile boundaries.
		 */
		it("keeps OAuth credentials and pending state isolated by profile directory", () => {
			const work = new TokenStore(path.join(tmpDir, "work"));
			const personal = new TokenStore(path.join(tmpDir, "personal"));
			const workSession = createPendingOAuthSession("http://127.0.0.1:53742/callback", "headless");
			const personalSession = createPendingOAuthSession(
				"http://127.0.0.1:53743/callback",
				"browser",
			);
			work.beginOAuthSession(workSession, "work");
			personal.beginOAuthSession(personalSession, "personal");
			work.saveCodeVerifier("work-verifier");
			work.saveClientInfo({ client_id: "work-client" });
			work.saveTokens({ access_token: "work-token" });

			expect(work.readOAuthSession()).toMatchObject({
				state: workSession.state,
				codeVerifier: "work-verifier",
			});
			expect(personal.readOAuthSession()).toEqual(personalSession);
			expect(personal.readClientInfo()).toBeUndefined();
			expect(personal.readTokens()).toBeUndefined();
		});
	});

	describe("codeVerifier", () => {
		/**
		 * Preconditions: The selected profile has no pending OAuth session file.
		 * Prerequisites: codeVerifier is now a field of the version 2 session, not a standalone file shape.
		 * Verification: Reading a verifier without a pending session returns undefined.
		 */
		it("returns undefined when no pending session exists", () => {
			expect(store.readCodeVerifier()).toBeUndefined();
		});
	});

	describe("restToken", () => {
		it("returns undefined when no file exists", () => {
			expect(store.readRestToken()).toBeUndefined();
		});

		it("saves and reads rest token", () => {
			store.saveRestToken("ntn_abc123");
			expect(store.readRestToken()).toBe("ntn_abc123");
		});

		it("deletes rest token", () => {
			store.saveRestToken("ntn_abc123");
			store.deleteRestToken();
			expect(store.readRestToken()).toBeUndefined();
		});

		it("delete is no-op when file missing", () => {
			expect(() => store.deleteRestToken()).not.toThrow();
		});

		it("writes file with 0o600 permissions", () => {
			store.saveRestToken("ntn_abc123");
			const stat = fs.statSync(path.join(tmpDir, "rest-token.json"));
			expect(stat.mode & 0o777).toBe(0o600);
		});
	});

	describe("deleteAll", () => {
		/**
		 * Preconditions: The profile stores MCP tokens, client registration, a pending OAuth session,
		 * and a REST token.
		 * Prerequisites: The pending session has a PKCE verifier saved inside its version 2 object.
		 * Verification: deleteAll removes every credential and pending session file.
		 */
		it("deletes all files including rest token", () => {
			store.saveTokens({ access_token: "abc" });
			store.saveClientInfo({ client_id: "id" });
			store.beginOAuthSession(
				createPendingOAuthSession(
					"http://127.0.0.1:53742/callback",
					"browser",
					new Date("2026-08-23T10:00:00.000Z"),
				),
				"work",
			);
			store.saveCodeVerifier("v");
			store.saveRestToken("ntn_abc123");
			store.deleteAll();
			expect(store.readTokens()).toBeUndefined();
			expect(store.readClientInfo()).toBeUndefined();
			expect(store.readCodeVerifier()).toBeUndefined();
			expect(store.readRestToken()).toBeUndefined();
		});
	});

	describe("directory creation", () => {
		it("creates nested directories when they dont exist", () => {
			const nestedDir = path.join(tmpDir, "a", "b", "c");
			const nestedStore = new TokenStore(nestedDir);
			nestedStore.saveTokens({ access_token: "abc" });
			expect(nestedStore.readTokens()).toEqual({ access_token: "abc" });
		});
	});
});
