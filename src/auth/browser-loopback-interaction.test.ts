import { describe, expect, it, vi } from "vitest";
import { BrowserLoopbackInteraction } from "./browser-loopback-interaction.js";
import type { CallbackServer } from "./callback-server.js";

describe("BrowserLoopbackInteraction", () => {
	/**
	 * Preconditions: A browser login needs a loopback listener and an available browser launcher.
	 * Prerequisites: The launcher is injected so the test never opens a real desktop browser.
	 * Verification: Creation exposes the listener URI, presentation delegates the URL, and close succeeds.
	 */
	it("owns the loopback listener and delegates browser presentation", async () => {
		const openBrowser = vi.fn(async (_url: string) => undefined);
		const interaction = await BrowserLoopbackInteraction.create({
			timeoutMs: 1_000,
			openBrowser,
		});

		const authorizationUrl = new URL("https://mcp.notion.com/authorize?client_id=test");
		await interaction.presentAuthorizationUrl(authorizationUrl);

		expect(interaction.redirectUrl.protocol).toBe("http:");
		expect(interaction.redirectUrl.hostname).toBe("127.0.0.1");
		expect(interaction.redirectUrl.port).not.toBe("");
		expect(interaction.redirectUrl.pathname).toBe("/callback");
		expect(openBrowser).toHaveBeenCalledWith(authorizationUrl.toString());
		await expect(interaction.close()).resolves.toBeUndefined();
	});

	/**
	 * Preconditions: Browser OAuth has completed, but the loopback HTTP server is still releasing
	 * its final browser connection.
	 * Prerequisites: The injected callback server exposes an asynchronous stop operation whose
	 * completion can be controlled by this test.
	 * Verification: Interaction close remains pending until the callback server has fully stopped,
	 * so the login command cannot return while a listener-owned handle is still open.
	 */
	it("waits for the loopback listener to finish stopping", async () => {
		let finishStop!: () => void;
		const stopFinished = new Promise<void>((resolve) => {
			finishStop = resolve;
		});
		const stop = vi.fn(() => stopFinished);
		const callbackServer = {
			start: vi.fn(async () => undefined),
			stop,
			port: 53_742,
		} as unknown as CallbackServer;
		const interaction = await BrowserLoopbackInteraction.create({
			callbackServer,
			openBrowser: vi.fn(async () => undefined),
		});
		let closeCompleted = false;

		const closing = interaction.close().then(() => {
			closeCompleted = true;
		});
		await Promise.resolve();

		expect(stop).toHaveBeenCalledOnce();
		expect(closeCompleted).toBe(false);

		finishStop();
		await closing;
		expect(closeCompleted).toBe(true);
	});

	/**
	 * Preconditions: Browser-mode OAuth is selected for profile work, but no launcher can open a URL.
	 * Prerequisites: The loopback listener started successfully and the injected launcher rejects.
	 * Verification: The error preserves the selected profile in the headless recovery command.
	 */
	it("suggests profile-scoped headless login when browser launch fails", async () => {
		const interaction = await BrowserLoopbackInteraction.create({
			profileName: "work",
			openBrowser: vi.fn(async () => {
				throw new Error("launcher unavailable");
			}),
		});
		try {
			await expect(
				interaction.presentAuthorizationUrl(
					new URL("https://mcp.notion.com/authorize?client_id=test"),
				),
			).rejects.toMatchObject({
				hint: 'Run "ncli --profile work login --headless"',
			});
		} finally {
			await interaction.close();
		}
	});

	/**
	 * Preconditions: Browser-mode OAuth is selected for profile work in a listener-restricted host.
	 * Prerequisites: The injected callback server rejects start() with an EPERM-style error.
	 * Verification: Creation converts the failure to CliError and recommends the profile-scoped
	 * headless command without attempting to launch a browser.
	 */
	it("suggests profile-scoped headless login when the listener is forbidden", async () => {
		const start = vi.fn(async () => {
			throw Object.assign(new Error("listen EPERM"), { code: "EPERM" });
		});
		const callbackServer = {
			start,
			stop: vi.fn(),
			port: 0,
		} as unknown as CallbackServer;
		const openBrowser = vi.fn(async () => undefined);

		await expect(
			BrowserLoopbackInteraction.create({
				profileName: "work",
				callbackServer,
				openBrowser,
			}),
		).rejects.toMatchObject({
			what: "Could not start the local OAuth callback server",
			hint: 'Run "ncli --profile work login --headless"',
		});
		expect(start).toHaveBeenCalledOnce();
		expect(openBrowser).not.toHaveBeenCalled();
	});
});
