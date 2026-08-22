import { CONFIG_DIR, PROFILE_ENV_VAR } from "../util/config.js";
import { CliError } from "../util/errors.js";
import { migrateLegacyCredentials } from "./migration.js";
import { validateProfileName } from "./profile-name.js";
import { ProfileStore } from "./profile-store.js";
import type { ProfileSource, ResolvedProfile } from "./types.js";

export interface ResolveProfileOptions {
	explicitProfile?: string;
	environment?: NodeJS.ProcessEnv;
	configDirectory?: string;
	createDefault?: boolean;
	migrateLegacy?: boolean;
}

function resolveExisting(
	store: ProfileStore,
	name: string,
	source: ProfileSource,
): ResolvedProfile {
	const validName = validateProfileName(name);
	if (!store.exists(validName)) {
		throw new CliError(
			`Profile ${JSON.stringify(validName)} was not found`,
			`The profile selected from ${source === "flag" ? "--profile" : source === "environment" ? PROFILE_ENV_VAR : "the profile configuration"} does not exist`,
			'Run "ncli profile list" or create it with "ncli profile add <name>"',
		);
	}
	return { name: validName, directory: store.profileDirectory(validName), source };
}

export function resolveProfile(options: ResolveProfileOptions = {}): ResolvedProfile {
	const store = new ProfileStore(options.configDirectory ?? CONFIG_DIR);
	if (options.migrateLegacy !== false) migrateLegacyCredentials(store);

	if (options.explicitProfile !== undefined) {
		return resolveExisting(store, options.explicitProfile, "flag");
	}
	const environmentProfile = (options.environment ?? process.env)[PROFILE_ENV_VAR];
	if (environmentProfile !== undefined && environmentProfile !== "") {
		return resolveExisting(store, environmentProfile, "environment");
	}
	const active = store.getActive();
	if (active !== undefined) return resolveExisting(store, active, "active");
	if (store.exists("default")) return resolveExisting(store, "default", "default");

	if (options.createDefault !== false) {
		store.create("default", { use: true });
		return resolveExisting(store, "default", "default");
	}
	throw new CliError(
		"No Notion profile is configured",
		"No active or default profile exists",
		'Run "ncli profile add <name> --use"',
	);
}
