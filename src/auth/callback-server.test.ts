import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { CallbackServer } from "./callback-server.js";
import { createPendingOAuthSession } from "./oauth-session.js";

describe("CallbackServer", () => {
	const servers: CallbackServer[] = [];

	function tracked(server: CallbackServer): CallbackServer {
		servers.push(server);
		return server;
	}

	afterEach(() => {
		for (const s of servers) s.stop();
		servers.length = 0;
	});

	describe("start()", () => {
		it("assigns a port when called without arguments", async () => {
			const server = tracked(new CallbackServer());
			await server.start();
			expect(server.port).toBeGreaterThan(0);
		});

		it("uses the preferred port when available", async () => {
			// Find a free port first
			const tempServer = http.createServer();
			const freePort = await new Promise<number>((resolve) => {
				tempServer.listen(0, "127.0.0.1", () => {
					const addr = tempServer.address();
					resolve(typeof addr === "object" && addr ? addr.port : 0);
				});
			});
			tempServer.close();

			const server = tracked(new CallbackServer());
			await server.start(freePort);
			expect(server.port).toBe(freePort);
		});

		it("falls back to a random port when preferred port is in use", async () => {
			// Occupy a port
			const blocker = http.createServer();
			const occupiedPort = await new Promise<number>((resolve) => {
				blocker.listen(0, "127.0.0.1", () => {
					const addr = blocker.address();
					resolve(typeof addr === "object" && addr ? addr.port : 0);
				});
			});

			try {
				const server = tracked(new CallbackServer());
				await server.start(occupiedPort);
				expect(server.port).toBeGreaterThan(0);
				expect(server.port).not.toBe(occupiedPort);
			} finally {
				blocker.close();
			}
		});
	});
	describe("waitForCallback()", () => {
		/**
		 * Preconditions: The loopback server is listening and the pending browser session uses its
		 * exact redirect URI.
		 * Prerequisites: The HTTP request contains one matching state and one authorization code.
		 * Verification: The server returns success HTML and resolves with the validated code object.
		 */
		it("validates and returns a successful browser callback", async () => {
			const server = tracked(new CallbackServer());
			await server.start();
			const session = createPendingOAuthSession(
				`http://127.0.0.1:${server.port}/callback`,
				"browser",
			);
			const callback = server.waitForCallback(session, 1_000);

			const response = await fetch(
				`${session.redirectUri}?code=authorization-code&state=${session.state}`,
			);

			expect(response.status).toBe(200);
			await expect(callback).resolves.toEqual({ code: "authorization-code" });
		});

		/**
		 * Preconditions: The loopback callback matches the pending state and carries an OAuth denial.
		 * Prerequisites: error_description contains markup controlled by the authorization response.
		 * Verification: The server rejects authorization and escapes the description in browser HTML.
		 */
		it("escapes OAuth error descriptions before rendering failure HTML", async () => {
			const server = tracked(new CallbackServer());
			await server.start();
			const session = createPendingOAuthSession(
				`http://127.0.0.1:${server.port}/callback`,
				"browser",
			);
			const callback = server.waitForCallback(session, 1_000);
			const rejection = expect(callback).rejects.toThrow("OAuth authorization was denied");
			const callbackUrl = new URL(session.redirectUri);
			callbackUrl.searchParams.set("error", "access_denied");
			callbackUrl.searchParams.set("error_description", '<script>alert("secret")</script>');
			callbackUrl.searchParams.set("state", session.state);

			const response = await fetch(callbackUrl);
			const body = await response.text();

			expect(response.status).toBe(400);
			expect(body).toContain("&lt;script&gt;");
			expect(body).not.toContain("<script>");
			await rejection;
		});
	});
});
