import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CliError } from "../util/errors.js";
import { normalizeProfileLabel, validateProfileName } from "./profile-name.js";
import {
	PROFILE_SCHEMA_VERSION,
	type ProfileMetadata,
	type ProfileState,
	type ProfileSummary,
} from "./types.js";

export interface CreateProfileOptions {
	label?: string;
	use?: boolean;
	ifNotExists?: boolean;
}

export interface DeleteProfileOptions {
	switchTo?: string;
}

export interface ProfileStorePaths {
	configDirectory: string;
	profilesDirectory: string;
	statePath: string;
}

function defaultState(): ProfileState {
	return { schemaVersion: PROFILE_SCHEMA_VERSION };
}

function parseJsonFile<T>(filePath: string, description: string): T {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
	} catch (error) {
		throw new CliError(
			`Could not read ${description}`,
			error instanceof Error ? error.message : String(error),
			`Back up and repair or remove ${filePath}`,
		);
	}
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
	const parent = path.dirname(filePath);
	fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
	const temporaryPath = path.join(parent, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
	try {
		fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
		try {
			fs.renameSync(temporaryPath, filePath);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if ((code === "EEXIST" || code === "EPERM") && fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
				fs.renameSync(temporaryPath, filePath);
			} else {
				throw error;
			}
		}
		try {
			fs.chmodSync(filePath, 0o600);
		} catch {
			// Some filesystems do not implement POSIX permissions.
		}
	} finally {
		if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
	}
}

export class ProfileStore {
	readonly paths: ProfileStorePaths;

	constructor(configDirectory: string) {
		this.paths = {
			configDirectory,
			profilesDirectory: path.join(configDirectory, "profiles"),
			statePath: path.join(configDirectory, "profiles.json"),
		};
	}

	profileDirectory(name: string): string {
		const validName = validateProfileName(name);
		const directory = path.resolve(this.paths.profilesDirectory, validName);
		const parent = path.resolve(this.paths.profilesDirectory);
		if (path.dirname(directory) !== parent) {
			throw new CliError(
				`Invalid profile path for ${JSON.stringify(name)}`,
				"The resolved path is outside the profiles directory",
				"Use a simple lowercase profile name",
			);
		}
		return directory;
	}

	metadataPath(name: string): string {
		return path.join(this.profileDirectory(name), "profile.json");
	}

	exists(name: string): boolean {
		return fs.existsSync(this.metadataPath(name));
	}

	readState(): ProfileState {
		if (!fs.existsSync(this.paths.statePath)) return defaultState();
		const state = parseJsonFile<ProfileState>(this.paths.statePath, "profile state");
		if (state.schemaVersion !== PROFILE_SCHEMA_VERSION) {
			throw new CliError(
				"Unsupported profile state version",
				`Expected schema version ${PROFILE_SCHEMA_VERSION}, found ${String(state.schemaVersion)}`,
				"Upgrade ncli or restore a compatible profiles.json file",
			);
		}
		if (state.activeProfile !== undefined) validateProfileName(state.activeProfile);
		return state;
	}

	writeState(state: ProfileState): void {
		writeJsonAtomic(this.paths.statePath, state);
	}

	getActive(): string | undefined {
		return this.readState().activeProfile;
	}

	setActive(name: string): void {
		const validName = validateProfileName(name);
		if (!this.exists(validName)) {
			throw new CliError(
				`Profile ${JSON.stringify(validName)} was not found`,
				"The selected profile does not exist",
				'Run "ncli profile list" or create it with "ncli profile add <name>"',
			);
		}
		this.writeState({ schemaVersion: PROFILE_SCHEMA_VERSION, activeProfile: validName });
	}

	clearActive(): void {
		this.writeState(defaultState());
	}

	create(name: string, options: CreateProfileOptions = {}): ProfileMetadata {
		const validName = validateProfileName(name);
		const label = normalizeProfileLabel(options.label);
		if (this.exists(validName)) {
			if (options.ifNotExists) {
				const existing = this.get(validName);
				if (options.use) this.setActive(validName);
				return existing;
			}
			throw new CliError(
				`Profile ${JSON.stringify(validName)} already exists`,
				"Creating it again could overwrite saved credentials",
				'Use another name, pass --if-not-exists, or delete the existing profile first',
			);
		}

		fs.mkdirSync(this.paths.profilesDirectory, { recursive: true, mode: 0o700 });
		const finalDirectory = this.profileDirectory(validName);
		const temporaryDirectory = path.join(
			this.paths.profilesDirectory,
			`.create-${validName}-${randomUUID()}`,
		);
		const timestamp = new Date().toISOString();
		const metadata: ProfileMetadata = {
			schemaVersion: PROFILE_SCHEMA_VERSION,
			name: validName,
			...(label ? { label } : {}),
			createdAt: timestamp,
			updatedAt: timestamp,
		};

		try {
			fs.mkdirSync(temporaryDirectory, { mode: 0o700 });
			writeJsonAtomic(path.join(temporaryDirectory, "profile.json"), metadata);
			fs.renameSync(temporaryDirectory, finalDirectory);
		} catch (error) {
			fs.rmSync(temporaryDirectory, { recursive: true, force: true });
			throw new CliError(
				`Could not create profile ${JSON.stringify(validName)}`,
				error instanceof Error ? error.message : String(error),
				"Check that the ncli configuration directory is writable",
			);
		}

		const state = this.readState();
		if (options.use || state.activeProfile === undefined) this.setActive(validName);
		return metadata;
	}

	get(name: string): ProfileMetadata {
		const validName = validateProfileName(name);
		const metadataPath = this.metadataPath(validName);
		if (!fs.existsSync(metadataPath)) {
			throw new CliError(
				`Profile ${JSON.stringify(validName)} was not found`,
				"The requested profile does not exist",
				'Run "ncli profile list" or create it with "ncli profile add <name>"',
			);
		}
		const metadata = parseJsonFile<ProfileMetadata>(metadataPath, `profile ${validName}`);
		if (metadata.schemaVersion !== PROFILE_SCHEMA_VERSION || metadata.name !== validName) {
			throw new CliError(
				`Profile ${JSON.stringify(validName)} is invalid`,
				"profile.json does not match the directory or schema version",
				`Back up and repair ${metadataPath}`,
			);
		}
		return metadata;
	}

	update(
		name: string,
		update: Partial<Omit<ProfileMetadata, "schemaVersion" | "name" | "createdAt">>,
	): ProfileMetadata {
		const current = this.get(name);
		const next: ProfileMetadata = {
			...current,
			...update,
			updatedAt: new Date().toISOString(),
		};
		writeJsonAtomic(this.metadataPath(name), next);
		return next;
	}

	list(): ProfileSummary[] {
		if (!fs.existsSync(this.paths.profilesDirectory)) return [];
		const active = this.getActive();
		return fs
			.readdirSync(this.paths.profilesDirectory, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
			.map((entry) => validateProfileName(entry.name))
			.filter((name) => this.exists(name))
			.sort((a, b) => a.localeCompare(b))
			.map((name) => {
				const metadata = this.get(name);
				const directory = this.profileDirectory(name);
				return {
					...metadata,
					active: active === name,
					mcpConfigured: fs.existsSync(path.join(directory, "tokens.json")),
					restConfigured: fs.existsSync(path.join(directory, "rest-token.json")),
				};
			});
	}

	delete(name: string, options: DeleteProfileOptions = {}): void {
		const validName = validateProfileName(name);
		if (!this.exists(validName)) {
			throw new CliError(
				`Profile ${JSON.stringify(validName)} was not found`,
				"The requested profile does not exist",
				'Run "ncli profile list" to see available profiles',
			);
		}
		const active = this.getActive();
		const profiles = this.list();
		let replacement: string | undefined;
		if (options.switchTo !== undefined) {
			if (active !== validName) {
				throw new CliError(
					"--switch-to is only valid when deleting the active profile",
					`Profile ${JSON.stringify(validName)} is not active`,
					`Delete it without --switch-to, or run "ncli profile use ${validName}" first`,
				);
			}
			replacement = validateProfileName(options.switchTo);
			if (replacement === validName) {
				throw new CliError(
					"Replacement profile must be different",
					"A deleted profile cannot remain active",
					'Choose another profile with --switch-to <name>',
				);
			}
			if (!this.exists(replacement)) {
				throw new CliError(
					`Profile ${JSON.stringify(replacement)} was not found`,
					"The replacement profile does not exist",
					'Run "ncli profile list" to choose an existing profile',
				);
			}
		}
		if (active === validName && profiles.length > 1 && replacement === undefined) {
			throw new CliError(
				`Cannot delete active profile ${JSON.stringify(validName)}`,
				"Another profile must become active before deletion",
				`Use --switch-to <name>, for example: ncli profile delete ${validName} --switch-to <name> --force`,
			);
		}

		const directory = this.profileDirectory(validName);
		const trash = path.join(this.paths.profilesDirectory, `.delete-${validName}-${randomUUID()}`);
		const previousState = this.readState();
		try {
			fs.renameSync(directory, trash);
			if (active === validName) {
				if (replacement) this.setActive(replacement);
				else this.clearActive();
			}
			fs.rmSync(trash, { recursive: true, force: true });
		} catch (error) {
			if (fs.existsSync(trash) && !fs.existsSync(directory)) {
				try {
					fs.renameSync(trash, directory);
				} catch {
					// Preserve the original error; the recovery hint points to the config directory.
				}
			}
			try {
				this.writeState(previousState);
			} catch {
				// Preserve the original error and point the user to the configuration directory.
			}
			throw new CliError(
				`Could not delete profile ${JSON.stringify(validName)}`,
				error instanceof Error ? error.message : String(error),
				`Check ${this.paths.profilesDirectory} and restore from backup if necessary`,
			);
		}
	}
}
