import {
	HEADLESS_AUTH_TIMEOUT_MS,
	MAX_AUTH_TIMEOUT_MS,
	MAX_CALLBACK_URL_LENGTH,
} from "../util/config.js";
import { CliError } from "../util/errors.js";
import type { AuthorizationInteraction } from "./authorization-interaction.js";
import { type OAuthCallbackResult, parseAndValidateOAuthCallback } from "./callback-parser.js";
import type { PendingOAuthSession } from "./oauth-session.js";

export interface HeadlessManualInteractionOptions {
	readonly redirectUrl: URL;
	readonly profileName: string;
	readonly timeoutMs?: number;
	readonly isInteractive?: () => boolean;
	readonly readCallbackUrl?: (signal: AbortSignal) => Promise<string>;
	readonly writeStderr?: (text: string) => void;
	readonly input?: NodeJS.ReadStream;
}

export class HeadlessManualInteraction implements AuthorizationInteraction {
	readonly redirectUrl: URL;

	private readonly profileName: string;
	private readonly timeoutMs: number;
	private readonly isInteractive: () => boolean;
	private readonly readCallbackUrl: (signal: AbortSignal) => Promise<string>;
	private readonly writeStderr: (text: string) => void;
	private activeInput: AbortController | undefined;

	constructor(options: HeadlessManualInteractionOptions) {
		const timeoutMs = options.timeoutMs ?? HEADLESS_AUTH_TIMEOUT_MS;
		if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_AUTH_TIMEOUT_MS) {
			throw new CliError(
				"Invalid OAuth authorization timeout",
				`The timeout must be between 1 and ${MAX_AUTH_TIMEOUT_MS / 1000} seconds`,
				"Choose a shorter timeout and retry",
			);
		}
		const input = options.input ?? process.stdin;
		this.redirectUrl = options.redirectUrl;
		this.profileName = options.profileName;
		this.timeoutMs = timeoutMs;
		this.isInteractive = options.isInteractive ?? (() => input.isTTY === true);
		this.readCallbackUrl =
			options.readCallbackUrl ?? ((signal) => readCallbackUrlFromTty(input, signal));
		this.writeStderr = options.writeStderr ?? ((text) => process.stderr.write(text));
	}

	async presentAuthorizationUrl(url: URL): Promise<void> {
		this.assertInteractive();
		this.writeStderr(
			[
				"Headless Notion login",
				`Profile: ${this.profileName}`,
				"",
				"1. Open this authorization URL in a browser:",
				url.toString(),
				"2. Complete authorization in Notion.",
				"3. When the browser cannot reach 127.0.0.1, copy its complete address-bar URL.",
				"4. Paste that URL below. The pasted value is hidden and is never printed.",
				"",
			].join("\n"),
		);
	}

	async waitForCallback(session: PendingOAuthSession): Promise<OAuthCallbackResult> {
		this.assertInteractive();
		const controller = new AbortController();
		this.activeInput = controller;
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, this.timeoutMs);
		this.writeStderr("Callback URL (input hidden): ");

		try {
			const callbackUrl = (await this.readCallbackUrl(controller.signal)).trim();
			return parseAndValidateOAuthCallback(callbackUrl, session);
		} catch (error) {
			if (timedOut) {
				throw new CliError(
					"OAuth callback timed out",
					`No callback URL was entered within ${this.timeoutMs / 1000} seconds`,
					this.retryHint(),
				);
			}
			if (error instanceof CliError) throw this.withProfileRecovery(error);
			throw new CliError(
				"Could not read the OAuth callback URL",
				"The secure terminal input ended unexpectedly",
				'Run "ncli login --headless" again in an interactive terminal',
			);
		} finally {
			clearTimeout(timer);
			if (this.activeInput === controller) this.activeInput = undefined;
			this.writeStderr("\n");
		}
	}

	async close(): Promise<void> {
		this.activeInput?.abort();
		this.activeInput = undefined;
	}

	private assertInteractive(): void {
		if (this.isInteractive()) return;
		throw new CliError(
			"Headless login requires an interactive terminal",
			"The callback URL must be pasted securely after browser authorization",
			`Run "ncli --profile ${this.profileName} login --headless" from an interactive terminal`,
		);
	}

	private retryHint(): string {
		return `Run "ncli --profile ${this.profileName} login --headless" again`;
	}

	private withProfileRecovery(error: CliError): CliError {
		if (error.what === "OAuth callback does not match this login session") {
			return new CliError(
				error.what,
				error.why,
				'Restart "ncli --profile ' +
					this.profileName +
					' login --headless" and paste the callback URL from the new authorization attempt',
			);
		}
		if (error.what === "OAuth login session expired") {
			return new CliError(error.what, error.why, this.retryHint());
		}
		if (error.what === "OAuth authorization was denied") {
			return new CliError(
				error.what,
				error.why,
				`${this.retryHint()} if you want to authorize this profile`,
			);
		}
		return error;
	}
}

/**
 * Read one callback URL without terminal echo. This deliberately bypasses
 * readline because its normal editing path redraws the secret input.
 */
export function readCallbackUrlFromTty(
	input: NodeJS.ReadStream,
	signal: AbortSignal,
): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const wasFlowing = input.readableFlowing;
		const wasRaw = input.isRaw ?? false;
		let value = "";
		let settled = false;

		const restore = (): void => {
			input.removeListener("data", onData);
			input.removeListener("end", onEnd);
			signal.removeEventListener("abort", onAbort);
			if (input.isTTY && typeof input.setRawMode === "function") input.setRawMode(wasRaw);
			if (wasFlowing === true) input.resume();
			else input.pause();
		};
		const succeed = (): void => {
			if (settled) return;
			settled = true;
			restore();
			resolve(value);
		};
		const fail = (error: CliError): void => {
			if (settled) return;
			settled = true;
			restore();
			reject(error);
		};
		const onAbort = (): void => {
			fail(
				new CliError(
					"OAuth callback input was cancelled",
					"The login attempt ended before a complete callback URL was entered",
					'Run "ncli login --headless" again',
				),
			);
		};
		const onEnd = (): void => {
			fail(
				new CliError(
					"OAuth callback input ended unexpectedly",
					"The terminal closed before Enter was pressed",
					'Run "ncli login --headless" again',
				),
			);
		};
		const onData = (chunk: Buffer | string): void => {
			for (const character of chunk.toString()) {
				if (character === "\r" || character === "\n") {
					succeed();
					return;
				}
				if (character === "\u0003") {
					fail(
						new CliError(
							"OAuth callback input was cancelled",
							"Ctrl-C was pressed before login completed",
							'Run "ncli login --headless" again',
						),
					);
					return;
				}
				if (character === "\b" || character === "\u007f") {
					value = value.slice(0, -1);
					continue;
				}
				if (character < " ") continue;
				value += character;
				if (Buffer.byteLength(value) > MAX_CALLBACK_URL_LENGTH) {
					fail(
						new CliError(
							"OAuth callback URL exceeds the allowed length",
							"The pasted value is larger than the secure input limit",
							"Paste the complete callback URL directly from the browser address bar",
						),
					);
					return;
				}
			}
		};

		if (signal.aborted) {
			onAbort();
			return;
		}
		if (!input.isTTY || typeof input.setRawMode !== "function") {
			fail(
				new CliError(
					"Secure terminal input is unavailable",
					"The current standard input does not support hidden TTY input",
					'Run "ncli login --headless" from an interactive terminal',
				),
			);
			return;
		}

		signal.addEventListener("abort", onAbort, { once: true });
		input.on("data", onData);
		input.once("end", onEnd);
		input.setRawMode(true);
		input.resume();
	});
}
