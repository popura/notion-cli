import { CONFIG_DIR } from "../util/config.js";
import { resolveProfile, type ResolveProfileOptions } from "./profile-resolver.js";
import type { ResolvedProfile } from "./types.js";

let explicitProfile: string | undefined;

export function setRuntimeProfile(name: string | undefined): void {
	explicitProfile = name;
}

export function getRuntimeProfile(): string | undefined {
	return explicitProfile;
}

export function resetRuntimeProfile(): void {
	explicitProfile = undefined;
}

export function resolveRuntimeProfile(
	options: Omit<ResolveProfileOptions, "explicitProfile"> = {},
): ResolvedProfile {
	const { configDirectory = CONFIG_DIR, ...rest } = options;
	return resolveProfile({
		...rest,
		configDirectory,
		explicitProfile,
	});
}
