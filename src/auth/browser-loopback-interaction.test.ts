import { describe, expect, it, vi } from "vitest";
import { BrowserLoopbackInteraction } from "./browser-loopback-interaction.js";

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
});
