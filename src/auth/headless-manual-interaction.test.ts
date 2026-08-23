import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { CliError } from "../util/errors.js";
import {
	HeadlessManualInteraction,
	readCallbackUrlFromTty,
} from "./headless-manual-interaction.js";
import { createPendingOAuthSession } from "./oauth-session.js";

describe("HeadlessManualInteraction", () => {
	/**
	 * Preconditions: The user selected profile work in an interactive terminal without a local browser.
	 * Prerequisites: A complete callback URL copied from another computer is supplied by the secure reader.
	 * Verification: Instructions go to stderr, the callback validates, and no callback or code is printed.
	 */
	it("presents remote-browser instructions and validates one manually entered callback", async () => {
		const redirectUrl = new URL("http://127.0.0.1:53742/callback");
		const session = createPendingOAuthSession(redirectUrl.toString(), "headless");
		const callbackUrl = `${session.redirectUri}?code=secret-authorization-code&state=${session.state}`;
		const stderr: string[] = [];
		const readCallbackUrl = vi.fn(async () => callbackUrl);
		const interaction = new HeadlessManualInteraction({
			redirectUrl,
			profileName: "work",
			isInteractive: () => true,
			readCallbackUrl,
			writeStderr: (text) => stderr.push(text),
			timeoutMs: 1_000,
		});
		const authorizationUrl = new URL("https://mcp.notion.com/authorize?client_id=test");

		await interaction.presentAuthorizationUrl(authorizationUrl);
		const result = await interaction.waitForCallback(session);

		const displayed = stderr.join("");
		expect(displayed).toContain("Headless Notion login");
		expect(displayed).toContain("Profile: work");
		expect(displayed).toContain(authorizationUrl.toString());
		expect(displayed).not.toContain(callbackUrl);
		expect(displayed).not.toContain("secret-authorization-code");
		expect(readCallbackUrl).toHaveBeenCalledOnce();
		expect(result).toEqual({ code: "secret-authorization-code" });
	});

	/**
	 * Preconditions: Headless login is requested with stdin connected to a pipe rather than a TTY.
	 * Prerequisites: No callback reader has started and no authorization URL has been disclosed.
	 * Verification: The interaction fails immediately with a recovery hint and consumes no input.
	 */
	it("fails before prompting when secure interactive input is unavailable", async () => {
		const readCallbackUrl = vi.fn(async () => "unused");
		const stderr: string[] = [];
		const interaction = new HeadlessManualInteraction({
			redirectUrl: new URL("http://127.0.0.1:53742/callback"),
			profileName: "work",
			isInteractive: () => false,
			readCallbackUrl,
			writeStderr: (text) => stderr.push(text),
		});

		await expect(
			interaction.presentAuthorizationUrl(
				new URL("https://mcp.notion.com/authorize?client_id=test"),
			),
		).rejects.toMatchObject({
			what: "Headless login requires an interactive terminal",
		});
		expect(readCallbackUrl).not.toHaveBeenCalled();
		expect(stderr).toEqual([]);
	});

	/**
	 * Preconditions: An interactive headless login is waiting for a callback URL.
	 * Prerequisites: The configured wait limit elapses before the secure reader resolves.
	 * Verification: Input is aborted, the error is classified as a timeout, and no secret is printed.
	 */
	it("aborts secure callback input when the authorization timeout elapses", async () => {
		vi.useFakeTimers();
		try {
			const redirectUrl = new URL("http://127.0.0.1:53742/callback");
			const session = createPendingOAuthSession(redirectUrl.toString(), "headless");
			const readCallbackUrl = vi.fn(
				(signal: AbortSignal) =>
					new Promise<string>((_resolve, reject) => {
						signal.addEventListener(
							"abort",
							() => reject(new CliError("OAuth callback input was cancelled", "The wait ended")),
							{ once: true },
						);
					}),
			);
			const interaction = new HeadlessManualInteraction({
				redirectUrl,
				profileName: "work",
				isInteractive: () => true,
				readCallbackUrl,
				writeStderr: () => undefined,
				timeoutMs: 100,
			});

			const waiting = interaction.waitForCallback(session);
			const rejected = expect(waiting).rejects.toMatchObject({
				what: "OAuth callback timed out",
				hint: 'Run "ncli --profile work login --headless" again',
			});
			await vi.advanceTimersByTimeAsync(100);

			await rejected;
			expect(readCallbackUrl).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	/**
	 * Preconditions: A real interactive terminal supports raw mode and receives a pasted callback.
	 * Prerequisites: The input ends with Enter and remains below the configured maximum length.
	 * Verification: The reader returns the value while enabling then restoring raw mode, so terminal
	 * echo never receives the pasted secret.
	 */
	it("reads one callback in raw terminal mode and restores the prior mode", async () => {
		const input = new PassThrough() as PassThrough & NodeJS.ReadStream;
		Object.defineProperty(input, "isTTY", { value: true });
		Object.defineProperty(input, "isRaw", { value: false, writable: true });
		const setRawMode = vi.fn((mode: boolean) => {
			Object.defineProperty(input, "isRaw", { value: mode, writable: true });
			return input;
		});
		Object.defineProperty(input, "setRawMode", { value: setRawMode });
		const controller = new AbortController();

		const waiting = readCallbackUrlFromTty(input, controller.signal);
		input.write("http://127.0.0.1:53742/callback?code=secret&state=state\r");
		const callbackUrl = await waiting;

		expect(callbackUrl).toContain("code=secret");
		expect(setRawMode.mock.calls).toEqual([[true], [false]]);
	});
});
