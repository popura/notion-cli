import type { Command } from "commander";
import { TokenStore } from "../auth/token-store.js";
import { withConnection } from "../mcp/with-connection.js";
import { printOutput } from "../output/json.js";
import { resolveRuntimeProfile } from "../profile/runtime.js";
import { MAX_AUTH_TIMEOUT_MS } from "../util/config.js";
import { CliError } from "../util/errors.js";

interface LoginOptions {
	readonly headless?: boolean;
	readonly authTimeout?: number;
}

export interface LoginCommandDependencies {
	readonly isInteractiveInput: () => boolean;
	readonly resolveProfileName: () => string;
}

const DEFAULT_DEPENDENCIES: LoginCommandDependencies = {
	isInteractiveInput: () => process.stdin.isTTY === true,
	resolveProfileName: () => resolveRuntimeProfile().name,
};

export function parseAuthorizationTimeoutSeconds(value: string): number {
	if (!/^[1-9]\d*$/.test(value)) {
		throw invalidAuthorizationTimeout();
	}
	const seconds = Number(value);
	if (!Number.isSafeInteger(seconds) || seconds > MAX_AUTH_TIMEOUT_MS / 1000) {
		throw invalidAuthorizationTimeout();
	}
	return seconds * 1000;
}

export function assertHeadlessInteractiveInput(isInteractive: boolean, profileName: string): void {
	if (isInteractive) return;
	throw new CliError(
		"Headless login requires an interactive terminal",
		"The callback URL must be pasted securely after browser authorization",
		`Run "ncli --profile ${profileName} login --headless" from an interactive terminal`,
	);
}

export function registerLoginCommands(
	program: Command,
	dependencyOverrides: Partial<LoginCommandDependencies> = {},
): void {
	const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };

	program
		.command("login")
		.description("Log in to Notion via OAuth for the selected profile")
		.option("--headless", "Authorize using a remote browser and secure manual callback URL input")
		.option(
			"--auth-timeout <seconds>",
			"Maximum authorization wait in seconds (1-600)",
			parseAuthorizationTimeoutSeconds,
		)
		.addHelpText(
			"after",
			"\nHeadless login:\n" +
				"  ncli --profile work login --headless\n" +
				"  Open the displayed URL in any browser, authorize Notion, then paste the\n" +
				"  complete 127.0.0.1 callback URL at the hidden terminal prompt.\n",
		)
		.action(async (opts: LoginOptions, cmd: Command) => {
			const authorizationMode = opts.headless ? "headless" : "browser";
			if (authorizationMode === "headless") {
				assertHeadlessInteractiveInput(
					dependencies.isInteractiveInput(),
					dependencies.resolveProfileName(),
				);
			}
			await withConnection(
				async (conn) => {
					const result = await conn.callTool("notion-get-users", { user_id: "self" });
					printOutput(result as Record<string, unknown>, cmd.optsWithGlobals());
				},
				{
					authorizationMode,
					authorizationTimeoutMs: opts.authTimeout,
				},
			);
		});

	program
		.command("logout")
		.description("Remove local OAuth and REST credentials from the selected profile")
		.action((_opts: unknown, cmd: Command) => {
			const profile = resolveRuntimeProfile({ createDefault: false });
			const store = new TokenStore(profile.directory);
			store.deleteAll();
			const opts = cmd.optsWithGlobals();
			if (opts.json) {
				console.log(
					JSON.stringify(
						{ status: "logged_out", profile: profile.name, remoteAuthorizationRevoked: false },
						null,
						2,
					),
				);
			} else {
				console.log(
					`Logged out profile ${JSON.stringify(profile.name)}. All local tokens cleared.`,
				);
			}
		});

	program
		.command("whoami")
		.description("Show current Notion user info for the selected profile")
		.action(async (_opts: unknown, cmd: Command) => {
			await withConnection(async (conn) => {
				const result = await conn.callTool("notion-get-users", { user_id: "self" });
				printOutput(result as Record<string, unknown>, cmd.optsWithGlobals());
			});
		});
}

function invalidAuthorizationTimeout(): CliError {
	return new CliError(
		"Invalid OAuth authorization timeout",
		`The value must be a whole number from 1 through ${MAX_AUTH_TIMEOUT_MS / 1000} seconds`,
		'Use a value such as "--auth-timeout 300"',
	);
}
