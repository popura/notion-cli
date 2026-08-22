import type { Command } from "commander";
import { printLocalOutput } from "../output/local.js";
import { migrateLegacyCredentials } from "../profile/migration.js";
import { resolveProfile } from "../profile/profile-resolver.js";
import { ProfileStore } from "../profile/profile-store.js";
import { getRuntimeProfile } from "../profile/runtime.js";
import { CONFIG_DIR } from "../util/config.js";
import { confirm } from "../util/confirm.js";
import { CliError } from "../util/errors.js";

interface AddOptions {
	label?: string;
	use?: boolean;
	ifNotExists?: boolean;
}

interface DeleteOptions {
	force?: boolean;
	switchTo?: string;
}

function outputOptions(cmd: Command): { json?: boolean; raw?: boolean } {
	return cmd.optsWithGlobals() as { json?: boolean; raw?: boolean };
}

function createStore(configDirectory: string): ProfileStore {
	const store = new ProfileStore(configDirectory);
	migrateLegacyCredentials(store);
	return store;
}

export function profileListResult(store: ProfileStore): Record<string, unknown> {
	return {
		activeProfile: store.getActive() ?? null,
		profiles: store.list().map((profile) => ({
			name: profile.name,
			label: profile.label ?? null,
			active: profile.active,
			createdAt: profile.createdAt,
			updatedAt: profile.updatedAt,
			mcp: {
				configured: profile.mcpConfigured,
				workspaceId: profile.mcp?.workspaceId ?? null,
				workspaceName: profile.mcp?.workspaceName ?? null,
				userId: profile.mcp?.userId ?? null,
				userName: profile.mcp?.userName ?? null,
			},
			rest: {
				configured: profile.restConfigured,
				workspaceId: profile.rest?.workspaceId ?? null,
				workspaceName: profile.rest?.workspaceName ?? null,
				botId: profile.rest?.botId ?? null,
			},
		})),
	};
}

async function requireDeletionApproval(
	name: string,
	opts: DeleteOptions,
	cmd: Command,
): Promise<boolean> {
	if (opts.force) return true;
	const globals = outputOptions(cmd);
	if (globals.json || !process.stdin.isTTY) {
		throw new CliError(
			`Refusing to delete profile ${JSON.stringify(name)} without confirmation`,
			"Interactive confirmation is unavailable in JSON or non-TTY mode",
			`Re-run with --force: ncli profile delete ${name} --force`,
		);
	}
	return confirm(`Delete profile ${JSON.stringify(name)} and all locally stored credentials?`);
}

export function registerProfileCommands(
	program: Command,
	configDirectory: string = CONFIG_DIR,
): void {
	const profile = program
		.command("profile")
		.description("Create, select, inspect, and delete local Notion authentication profiles");

	profile
		.command("add")
		.description("Create a local profile without starting authentication")
		.argument("<name>", "Lowercase profile name")
		.option("--label <label>", "Human-readable display label")
		.option("--use", "Make the profile active")
		.option("--if-not-exists", "Succeed without overwriting an existing profile")
		.action((name: string, opts: AddOptions, cmd: Command) => {
			const store = createStore(configDirectory);
			const existed = store.exists(name);
			const metadata = store.create(name, opts);
			printLocalOutput(
				{
					status: existed ? "already_exists" : "created",
					profile: metadata,
					activeProfile: store.getActive() ?? null,
				},
				outputOptions(cmd),
			);
		});

	profile
		.command("list")
		.description("List local profiles without contacting Notion")
		.action((_opts: unknown, cmd: Command) => {
			const store = createStore(configDirectory);
			printLocalOutput(profileListResult(store), outputOptions(cmd));
		});

	profile
		.command("show")
		.description("Show one profile without revealing credentials")
		.argument("[name]", "Profile name; defaults to the selected profile")
		.action((name: string | undefined, _opts: unknown, cmd: Command) => {
			const resolved = resolveProfile({
				explicitProfile: name ?? getRuntimeProfile(),
				configDirectory,
				createDefault: false,
			});
			const store = new ProfileStore(configDirectory);
			const summary = store.list().find((item) => item.name === resolved.name);
			if (!summary) {
				throw new CliError(
					`Profile ${JSON.stringify(resolved.name)} was not found`,
					"The profile disappeared while it was being read",
					'Run "ncli profile list" and retry',
				);
			}
			printLocalOutput(
				{
					...summary,
					selectionSource: resolved.source,
				},
				outputOptions(cmd),
			);
		});

	profile
		.command("use")
		.description("Set the default profile for future commands")
		.argument("<name>", "Existing profile name")
		.action((name: string, _opts: unknown, cmd: Command) => {
			const store = createStore(configDirectory);
			store.setActive(name);
			printLocalOutput({ status: "active", activeProfile: name }, outputOptions(cmd));
		});

	profile
		.command("delete")
		.alias("remove")
		.description("Delete a profile and all locally stored credentials")
		.argument("<name>", "Profile name")
		.option("--switch-to <name>", "Make another profile active when deleting the active profile")
		.option("--force", "Delete without interactive confirmation")
		.action(async (name: string, opts: DeleteOptions, cmd: Command) => {
			const store = createStore(configDirectory);
			store.get(name);
			if (!(await requireDeletionApproval(name, opts, cmd))) {
				printLocalOutput({ status: "cancelled", profile: name }, outputOptions(cmd));
				return;
			}
			store.delete(name, { switchTo: opts.switchTo });
			printLocalOutput(
				{
					status: "deleted",
					profile: name,
					activeProfile: store.getActive() ?? null,
					remoteAuthorizationRevoked: false,
				},
				outputOptions(cmd),
			);
		});
}
