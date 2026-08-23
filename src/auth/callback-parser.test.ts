import { describe, expect, it } from "vitest";
import { MAX_CALLBACK_URL_LENGTH } from "../util/config.js";
import { CliError } from "../util/errors.js";
import { parseAndValidateOAuthCallback } from "./callback-parser.js";
import type { PendingOAuthSession } from "./oauth-session.js";

const ACTIVE_SESSION: PendingOAuthSession = {
	schemaVersion: 2,
	state: "expected-state",
	codeVerifier: "saved-code-verifier",
	redirectUri: "http://127.0.0.1:53742/callback",
	mode: "headless",
	createdAt: "2026-08-23T10:00:00.000Z",
	expiresAt: "2026-08-23T10:10:00.000Z",
};

describe("parseAndValidateOAuthCallback", () => {
	/**
	 * Preconditions: The pending session is active and its loopback redirect URI and state match
	 * the URL copied from the browser.
	 * Prerequisites: The callback contains exactly one authorization code and one state value.
	 * Verification: The parser returns only the authorization code required by the SDK token exchange.
	 */
	it("returns the authorization code from a valid callback URL", () => {
		expect(
			parseAndValidateOAuthCallback(
				"http://127.0.0.1:53742/callback?code=authorization-code&state=expected-state",
				ACTIVE_SESSION,
				new Date("2026-08-23T10:05:00.000Z"),
			),
		).toEqual({ code: "authorization-code" });
	});

	/**
	 * Preconditions: A callback has the expected redirect URI but a state created by another
	 * login session.
	 * Prerequisites: The URL also carries an authorization code that must never reach token exchange.
	 * Verification: The parser rejects with a recoverable state error and does not disclose the code.
	 */
	it("rejects a callback whose state does not match the pending session", () => {
		let thrown: unknown;
		try {
			parseAndValidateOAuthCallback(
				"http://127.0.0.1:53742/callback?code=secret-code&state=other-state",
				ACTIVE_SESSION,
				new Date("2026-08-23T10:05:00.000Z"),
			);
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(CliError);
		expect(thrown).toMatchObject({
			what: "OAuth callback does not match this login session",
			why: "The state parameter is missing or different",
		});
		expect(String(thrown)).not.toContain("secret-code");
	});

	/**
	 * Preconditions: Every callback carries the expected state and a code, but one redirect URI
	 * component differs from the URI registered for the pending session.
	 * Prerequisites: The cases cover protocol, host, port, path, userinfo, and URL fragment changes.
	 * Verification: Every altered callback is rejected before its authorization code can be used.
	 */
	it.each([
		"https://127.0.0.1:53742/callback?code=secret-code&state=expected-state",
		"http://localhost:53742/callback?code=secret-code&state=expected-state",
		"http://127.0.0.1:53743/callback?code=secret-code&state=expected-state",
		"http://127.0.0.1:53742/other?code=secret-code&state=expected-state",
		"http://user@127.0.0.1:53742/callback?code=secret-code&state=expected-state",
		"http://127.0.0.1:53742/callback?code=secret-code&state=expected-state#fragment",
	])("rejects a callback that changes the registered redirect URI: %s", (callbackUrl) => {
		expect(() =>
			parseAndValidateOAuthCallback(
				callbackUrl,
				ACTIVE_SESSION,
				new Date("2026-08-23T10:05:00.000Z"),
			),
		).toThrow("OAuth callback URL is not valid for this login session");
	});

	/**
	 * Preconditions: The pasted value is longer than the configured callback URL limit.
	 * Prerequisites: The prefix otherwise resembles a valid callback and includes secret material.
	 * Verification: The parser rejects the value before URL processing and does not echo the input.
	 */
	it("rejects a callback URL that exceeds the input length limit", () => {
		const callbackUrl =
			"http://127.0.0.1:53742/callback?code=secret-code&state=expected-state&padding=" +
			"x".repeat(MAX_CALLBACK_URL_LENGTH);

		expect(() =>
			parseAndValidateOAuthCallback(
				callbackUrl,
				ACTIVE_SESSION,
				new Date("2026-08-23T10:05:00.000Z"),
			),
		).toThrow("OAuth callback URL exceeds the allowed length");
	});

	/**
	 * Preconditions: The interactive input is within the size limit but is not an absolute URL.
	 * Prerequisites: The invalid value contains a code-like secret that errors must not reproduce.
	 * Verification: The parser returns a CliError classification without disclosing the input.
	 */
	it("rejects a value that cannot be parsed as a callback URL", () => {
		let thrown: unknown;
		try {
			parseAndValidateOAuthCallback(
				"not-a-url-secret-code",
				ACTIVE_SESSION,
				new Date("2026-08-23T10:05:00.000Z"),
			);
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(CliError);
		expect(thrown).toMatchObject({
			what: "OAuth callback URL is invalid",
			why: "The pasted value is not a complete absolute URL",
		});
		expect(String(thrown)).not.toContain("secret-code");
	});

	/**
	 * Preconditions: The redirect URI and code are valid, but the callback has either zero or two
	 * state parameters.
	 * Prerequisites: A duplicated state remains invalid even when its first value is correct.
	 * Verification: The parser requires exactly one state and classifies both cases as session mismatch.
	 */
	it.each([
		"http://127.0.0.1:53742/callback?code=authorization-code",
		"http://127.0.0.1:53742/callback?code=authorization-code&state=expected-state&state=expected-state",
	])("rejects a callback without exactly one state parameter: %s", (callbackUrl) => {
		expect(() =>
			parseAndValidateOAuthCallback(
				callbackUrl,
				ACTIVE_SESSION,
				new Date("2026-08-23T10:05:00.000Z"),
			),
		).toThrow("OAuth callback does not match this login session");
	});

	/**
	 * Preconditions: The redirect URI and state match, but the current time is after expiresAt.
	 * Prerequisites: The callback contains a code that would otherwise be accepted.
	 * Verification: The parser rejects the expired session before returning the code.
	 */
	it("rejects a callback received after the login session expires", () => {
		expect(() =>
			parseAndValidateOAuthCallback(
				"http://127.0.0.1:53742/callback?code=secret-code&state=expected-state",
				ACTIVE_SESSION,
				new Date("2026-08-23T10:10:00.001Z"),
			),
		).toThrow("OAuth login session expired");
	});

	/**
	 * Preconditions: The callback URI, state, and expiry are valid.
	 * Prerequisites: The OAuth response contains both a code and an error parameter.
	 * Verification: The parser rejects the contradictory response and returns neither value.
	 */
	it("rejects a callback containing both code and error", () => {
		expect(() =>
			parseAndValidateOAuthCallback(
				"http://127.0.0.1:53742/callback?code=secret-code&error=access_denied&state=expected-state",
				ACTIVE_SESSION,
				new Date("2026-08-23T10:05:00.000Z"),
			),
		).toThrow("OAuth callback contains conflicting results");
	});

	/**
	 * Preconditions: The callback URI, state, and expiry are valid and Notion returned an OAuth error.
	 * Prerequisites: The response has one error and no authorization code.
	 * Verification: The parser classifies the response as an explicit authorization denial.
	 */
	it("reports an OAuth authorization denial separately from invalid input", () => {
		let thrown: unknown;
		try {
			parseAndValidateOAuthCallback(
				"http://127.0.0.1:53742/callback?error=access_denied&error_description=User+denied+access&state=expected-state",
				ACTIVE_SESSION,
				new Date("2026-08-23T10:05:00.000Z"),
			);
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(CliError);
		expect(thrown).toMatchObject({
			what: "OAuth authorization was denied",
			why: "User denied access",
		});
	});

	/**
	 * Preconditions: The redirect URI, state, and expiry are valid and no OAuth error is present.
	 * Prerequisites: The cases contain a missing, empty, or duplicated authorization code.
	 * Verification: The parser returns a recoverable missing-code error for every invalid cardinality.
	 */
	it.each([
		"http://127.0.0.1:53742/callback?state=expected-state",
		"http://127.0.0.1:53742/callback?code=&state=expected-state",
		"http://127.0.0.1:53742/callback?code=first&code=second&state=expected-state",
	])("rejects a callback without exactly one non-empty code: %s", (callbackUrl) => {
		expect(() =>
			parseAndValidateOAuthCallback(
				callbackUrl,
				ACTIVE_SESSION,
				new Date("2026-08-23T10:05:00.000Z"),
			),
		).toThrow("OAuth callback is missing a valid authorization code");
	});
});
