import http from "node:http";
import { URL } from "node:url";
import { AUTH_TIMEOUT_MS, CALLBACK_PATH } from "../util/config.js";
import { CliError } from "../util/errors.js";
import { type OAuthCallbackResult, parseAndValidateOAuthCallback } from "./callback-parser.js";
import type { PendingOAuthSession } from "./oauth-session.js";

const SUCCESS_HTML = `<!DOCTYPE html>
<html><body>
<h1>Authorization Successful</h1>
<p>You can close this tab and return to the terminal.</p>
</body></html>`;

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function renderFailureHtml(error: CliError): string {
	return (
		"<!DOCTYPE html><html><body><h1>" +
		escapeHtml(error.what) +
		"</h1><p>" +
		escapeHtml(error.why) +
		"</p></body></html>"
	);
}

export class CallbackServer {
	private server: http.Server | null = null;
	private _port = 0;

	get port(): number {
		return this._port;
	}

	/**
	 * Start the HTTP server and resolve once the port is known.
	 * If preferredPort is given, try it first; fall back to OS-assigned on EADDRINUSE.
	 */
	async start(preferredPort?: number): Promise<void> {
		const server = http.createServer();
		this.server = server;

		const listen = (port: number): Promise<void> =>
			new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(port, "127.0.0.1", () => {
					server.removeListener("error", reject);
					const addr = server.address();
					if (addr && typeof addr === "object") {
						this._port = addr.port;
					}
					resolve();
				});
			});

		if (preferredPort !== undefined) {
			try {
				await listen(preferredPort);
				return;
			} catch (err: unknown) {
				if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
					// Port busy — fall back to random
					await listen(0);
					return;
				}
				throw err;
			}
		}

		await listen(0);
	}

	waitForCallback(
		session: PendingOAuthSession,
		timeoutMs = AUTH_TIMEOUT_MS,
	): Promise<OAuthCallbackResult> {
		return new Promise<OAuthCallbackResult>((resolve, reject) => {
			const server = this.server;
			if (!server) {
				reject(
					new CliError(
						"Callback server not started",
						"start() must be called before waitForCallback()",
						"This is a bug — please report it",
					),
				);
				return;
			}

			let completed = false;
			let timer: NodeJS.Timeout;
			const cleanup = (): void => {
				clearTimeout(timer);
				server.removeListener("request", handleRequest);
				server.removeListener("close", handleClose);
			};
			const succeed = (result: OAuthCallbackResult): void => {
				if (completed) return;
				completed = true;
				cleanup();
				resolve(result);
			};
			const fail = (error: CliError): void => {
				if (completed) return;
				completed = true;
				cleanup();
				reject(error);
			};
			const handleClose = (): void => {
				fail(
					new CliError(
						"OAuth callback wait was cancelled",
						"The loopback listener closed before authorization completed",
						'Run "ncli login" again',
					),
				);
			};
			const handleRequest = (req: http.IncomingMessage, res: http.ServerResponse): void => {
				if (!req.url) {
					res.writeHead(400);
					res.end("Bad Request");
					return;
				}

				const callbackUrl = req.url.startsWith("/")
					? `${new URL(session.redirectUri).protocol}//${req.headers.host ?? ""}${req.url}`
					: req.url;
				let url: URL;
				try {
					url = new URL(callbackUrl);
				} catch {
					res.writeHead(400);
					res.end("Bad Request");
					return;
				}
				if (url.pathname !== CALLBACK_PATH) {
					res.writeHead(404);
					res.end("Not Found");
					return;
				}

				try {
					const result = parseAndValidateOAuthCallback(callbackUrl, session);
					res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
					res.end(SUCCESS_HTML);
					succeed(result);
				} catch (error) {
					const cliError =
						error instanceof CliError
							? error
							: new CliError(
									"OAuth callback could not be processed",
									"The callback request was malformed",
									'Run "ncli login" again',
								);
					res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
					res.end(renderFailureHtml(cliError));
					fail(cliError);
				}
			};

			server.on("request", handleRequest);
			timer = setTimeout(() => {
				fail(
					new CliError(
						"OAuth callback timed out",
						`No response received within ${timeoutMs / 1000} seconds`,
						'Run "ncli login" again',
					),
				);
				this.stop();
			}, timeoutMs);

			server.once("close", handleClose);
		});
	}

	stop(): void {
		if (this.server) {
			this.server.close();
			this.server = null;
		}
	}
}
