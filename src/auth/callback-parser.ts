import { timingSafeEqual } from "node:crypto";
import { MAX_CALLBACK_URL_LENGTH } from "../util/config.js";
import { CliError } from "../util/errors.js";
import type { PendingOAuthSession } from "./oauth-session.js";

export interface OAuthCallbackResult {
	readonly code: string;
}

export function parseAndValidateOAuthCallback(
	callbackUrl: string,
	_session: PendingOAuthSession,
	_now = new Date(),
): OAuthCallbackResult {
	if (callbackUrl.length > MAX_CALLBACK_URL_LENGTH) {
		throw new CliError(
			"OAuth callback URL exceeds the allowed length",
			"The pasted value is larger than the secure input limit",
			"Paste the complete callback URL directly from the browser address bar",
		);
	}
	let url: URL;
	try {
		url = new URL(callbackUrl);
	} catch {
		throw new CliError(
			"OAuth callback URL is invalid",
			"The pasted value is not a complete absolute URL",
			"Paste the complete URL from the browser address bar, including http://",
		);
	}
	const expectedUrl = new URL(_session.redirectUri);
	if (
		url.protocol !== expectedUrl.protocol ||
		url.hostname !== "127.0.0.1" ||
		url.hostname !== expectedUrl.hostname ||
		url.port !== expectedUrl.port ||
		url.pathname !== expectedUrl.pathname ||
		url.username !== "" ||
		url.password !== "" ||
		url.hash !== ""
	) {
		throw new CliError(
			"OAuth callback URL is not valid for this login session",
			"The host, port, or callback path does not match the registered redirect URI",
			"Paste the complete URL from the browser address bar without editing it",
		);
	}
	const states = url.searchParams.getAll("state");
	const actualState = states[0];
	if (states.length !== 1 || !actualState || !statesMatch(actualState, _session.state)) {
		throw new CliError(
			"OAuth callback does not match this login session",
			"The state parameter is missing or different",
			'Restart "ncli login" and use the callback from the new authorization attempt',
		);
	}
	const expiresAt = Date.parse(_session.expiresAt);
	if (!Number.isFinite(expiresAt) || _now.getTime() >= expiresAt) {
		throw new CliError(
			"OAuth login session expired",
			"The callback was received after the 10-minute session limit",
			'Run "ncli login" again',
		);
	}
	const codes = url.searchParams.getAll("code");
	const errors = url.searchParams.getAll("error");
	if (codes.length > 0 && errors.length > 0) {
		throw new CliError(
			"OAuth callback contains conflicting results",
			"The authorization response included both code and error",
			'Run "ncli login" again and use only the new callback URL',
		);
	}
	if (errors.length > 0) {
		const descriptions = url.searchParams.getAll("error_description");
		const reason =
			descriptions.length === 1 && descriptions[0]
				? descriptions[0]
				: (errors[0] ?? "access denied");
		throw new CliError(
			"OAuth authorization was denied",
			reason,
			'Run "ncli login" again if you want to authorize this profile',
		);
	}
	const code = codes[0];
	if (codes.length !== 1 || !code) {
		throw new CliError(
			"OAuth callback is missing a valid authorization code",
			"The authorization response must contain exactly one non-empty code parameter",
			'Run "ncli login" again and paste the complete callback URL',
		);
	}
	return { code };
}

function statesMatch(actual: string, expected: string): boolean {
	const actualBytes = Buffer.from(actual);
	const expectedBytes = Buffer.from(expected);
	if (actualBytes.length !== expectedBytes.length) return false;
	return timingSafeEqual(actualBytes, expectedBytes);
}
