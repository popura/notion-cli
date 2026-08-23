import fs from "node:fs";
import path from "node:path";
import { CliError } from "../util/errors.js";
import type { ProfileStore } from "./profile-store.js";

const LEGACY_FILES = ["tokens.json", "client.json", "auth-state.json", "rest-token.json"] as const;

export type MigrationResult =
	| { status: "not_needed" }
	| { status: "migrated"; profile: "default"; files: string[] };

function filesEqual(left: string, right: string): boolean {
	try {
		return fs.readFileSync(left).equals(fs.readFileSync(right));
	} catch {
		return false;
	}
}

function cleanupLegacyFiles(configDirectory: string, files: readonly string[]): void {
	for (const name of files) {
		try {
			fs.unlinkSync(path.join(configDirectory, name));
		} catch {
			// Migration has completed. An identical legacy copy is safe, and a later
			// invocation will retry cleanup without blocking authentication.
		}
	}
}

export function migrateLegacyCredentials(store: ProfileStore): MigrationResult {
	const existingLegacyFiles = LEGACY_FILES.filter((name) =>
		fs.existsSync(path.join(store.paths.configDirectory, name)),
	);
	if (existingLegacyFiles.length === 0) return { status: "not_needed" };

	if (store.exists("default")) {
		const destinationDirectory = store.profileDirectory("default");
		const conflictingFile = existingLegacyFiles.find((name) => {
			const source = path.join(store.paths.configDirectory, name);
			const destination = path.join(destinationDirectory, name);
			return !fs.existsSync(destination) || !filesEqual(source, destination);
		});
		if (conflictingFile) {
			throw new CliError(
				"Legacy credentials could not be migrated",
				`Legacy ${conflictingFile} conflicts with the existing default profile`,
				`Back up ${store.paths.configDirectory}, then remove or rename one of the conflicting files`,
			);
		}
		cleanupLegacyFiles(store.paths.configDirectory, existingLegacyFiles);
		return { status: "migrated", profile: "default", files: [...existingLegacyFiles] };
	}

	const profiles = store.list();
	if (profiles.length > 0 || fs.existsSync(store.paths.statePath)) {
		throw new CliError(
			"Legacy credentials could not be migrated",
			"Legacy authentication files and the new profile configuration both exist",
			`Back up ${store.paths.configDirectory}, then remove or rename one of the conflicting configurations`,
		);
	}

	store.create("default", { use: true });
	const destinationDirectory = store.profileDirectory("default");
	try {
		for (const name of existingLegacyFiles) {
			const source = path.join(store.paths.configDirectory, name);
			const destination = path.join(destinationDirectory, name);
			fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
			if (!filesEqual(source, destination)) {
				throw new CliError(
					`Copied credential file did not verify: ${name}`,
					"The destination differs from the original credential file",
				);
			}
			try {
				fs.chmodSync(destination, 0o600);
			} catch {
				// Some filesystems do not implement POSIX permissions.
			}
		}
	} catch (error) {
		try {
			store.delete("default");
		} catch {
			// Leave the original legacy files untouched and report the copy failure.
		}
		throw new CliError(
			"Legacy credentials could not be migrated",
			error instanceof Error ? error.message : String(error),
			`The original files remain in ${store.paths.configDirectory}; check permissions and retry`,
		);
	}

	cleanupLegacyFiles(store.paths.configDirectory, existingLegacyFiles);
	return { status: "migrated", profile: "default", files: [...existingLegacyFiles] };
}
