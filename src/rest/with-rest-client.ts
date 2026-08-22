import { TokenStore } from "../auth/token-store.js";
import { resolveRuntimeProfile } from "../profile/runtime.js";
import { REST_TOKEN_ENV_VAR } from "../util/config.js";
import { CliError, withRetry } from "../util/errors.js";
import { NotionRestClient } from "./client.js";

export function resolveRestToken(profileDirectory?: string): string {
	const envToken = process.env[REST_TOKEN_ENV_VAR];
	if (envToken) {
		return envToken;
	}

	const directory = profileDirectory ?? resolveRuntimeProfile().directory;
	const store = new TokenStore(directory);
	const storedToken = store.readRestToken();
	if (storedToken) {
		return storedToken;
	}

	throw new CliError(
		"No REST API token configured for the selected profile",
		"Notion REST API requires an integration token (Bearer token)",
		`Set ${REST_TOKEN_ENV_VAR} env var, or run "ncli rest login" for the selected profile`,
	);
}

export async function withRestClient<T>(
	fn: (client: NotionRestClient) => Promise<T>,
	profileDirectory?: string,
): Promise<T> {
	const token = resolveRestToken(profileDirectory);
	const client = new NotionRestClient(token);
	try {
		return await withRetry(() => fn(client));
	} catch (error) {
		process.exitCode = 1;
		throw error;
	}
}
