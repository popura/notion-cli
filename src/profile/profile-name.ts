import { CliError } from "../util/errors.js";

const PROFILE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,61}[a-z0-9])?$/;
const WINDOWS_RESERVED_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function validateProfileName(name: string): string {
	if (typeof name !== "string" || name.length === 0) {
		throw new CliError(
			"Invalid profile name",
			"A profile name is required",
			'Use a lowercase name such as "personal" or "work"',
		);
	}
	if (!PROFILE_NAME_PATTERN.test(name)) {
		throw new CliError(
			`Invalid profile name: ${JSON.stringify(name)}`,
			"Profile names must be 1-63 lowercase characters and may contain letters, digits, dots, underscores, or hyphens; they must start and end with a letter or digit",
			'Use a name such as "personal", "work-prod", or "company.jp"',
		);
	}
	if (name === "." || name === ".." || WINDOWS_RESERVED_NAME_PATTERN.test(name)) {
		throw new CliError(
			`Invalid profile name: ${JSON.stringify(name)}`,
			"The name is reserved by the operating system",
			'Use another name such as "personal" or "work"',
		);
	}
	return name;
}

export function normalizeProfileLabel(label: string | undefined): string | undefined {
	if (label === undefined) return undefined;
	const normalized = label.trim();
	if (normalized.length === 0) {
		throw new CliError(
			"Invalid profile label",
			"The label cannot be empty",
			"Omit --label or provide a non-empty display label",
		);
	}
	if (normalized.length > 200) {
		throw new CliError(
			"Invalid profile label",
			"The label exceeds 200 characters",
			"Use a shorter display label",
		);
	}
	return normalized;
}
