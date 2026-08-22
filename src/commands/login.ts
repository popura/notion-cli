import type { Command } from "commander";
import { TokenStore } from "../auth/token-store.js";
import { withConnection } from "../mcp/with-connection.js";
import { printOutput } from "../output/json.js";
import { resolveRuntimeProfile } from "../profile/runtime.js";

export function registerLoginCommands(program: Command): void {
	program
		.command("login")
		.description("Log in to Notion via OAuth for the selected profile")
		.action(async (_opts: unknown, cmd: Command) => {
			await withConnection(async (conn) => {
				const result = await conn.callTool("notion-get-users", { user_id: "self" });
				printOutput(result as Record<string, unknown>, cmd.optsWithGlobals());
			});
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
				console.log(`Logged out profile ${JSON.stringify(profile.name)}. All local tokens cleared.`);
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
