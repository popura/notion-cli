import open from "open";
import { AUTH_TIMEOUT_MS, CALLBACK_PATH } from "../util/config.js";
import { CliError } from "../util/errors.js";
import type { AuthorizationInteraction } from "./authorization-interaction.js";
import type { OAuthCallbackResult } from "./callback-parser.js";
import { CallbackServer } from "./callback-server.js";
import type { PendingOAuthSession } from "./oauth-session.js";

export interface BrowserLoopbackInteractionOptions {
	readonly preferredPort?: number;
	readonly timeoutMs?: number;
	readonly profileName?: string;
	readonly openBrowser?: (url: string) => Promise<unknown>;
	readonly callbackServer?: CallbackServer;
}

export class BrowserLoopbackInteraction implements AuthorizationInteraction {
	readonly redirectUrl: URL;

	private constructor(
		private readonly callbackServer: CallbackServer,
		private readonly timeoutMs: number,
		private readonly openBrowser: (url: string) => Promise<unknown>,
		private readonly profileName?: string,
	) {
		this.redirectUrl = new URL(`http://127.0.0.1:${callbackServer.port}${CALLBACK_PATH}`);
	}

	static async create(
		options: BrowserLoopbackInteractionOptions = {},
	): Promise<BrowserLoopbackInteraction> {
		const callbackServer = options.callbackServer ?? new CallbackServer();
		try {
			await callbackServer.start(options.preferredPort);
		} catch {
			throw new CliError(
				"Could not start the local OAuth callback server",
				"The loopback listener is unavailable in this environment",
				headlessLoginHint(options.profileName),
			);
		}
		return new BrowserLoopbackInteraction(
			callbackServer,
			options.timeoutMs ?? AUTH_TIMEOUT_MS,
			options.openBrowser ?? (async (url) => open(url)),
			options.profileName,
		);
	}

	async presentAuthorizationUrl(url: URL): Promise<void> {
		try {
			await this.openBrowser(url.toString());
		} catch {
			throw new CliError(
				"Could not open a browser for Notion login",
				"No supported desktop browser launcher is available",
				headlessLoginHint(this.profileName),
			);
		}
	}

	waitForCallback(session: PendingOAuthSession): Promise<OAuthCallbackResult> {
		return this.callbackServer.waitForCallback(session, this.timeoutMs);
	}

	async close(): Promise<void> {
		await this.callbackServer.stop();
	}
}

function headlessLoginHint(profileName: string | undefined): string {
	if (profileName) return `Run "ncli --profile ${profileName} login --headless"`;
	return 'Run "ncli login --headless"';
}
