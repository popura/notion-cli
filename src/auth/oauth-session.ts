import { randomBytes } from "node:crypto";
import { OAUTH_SESSION_TTL_MS } from "../util/config.js";
import { CliError } from "../util/errors.js";
import type { TokenStore } from "./token-store.js";

export type AuthorizationMode = "browser" | "headless";

export interface PendingOAuthSession {
	readonly schemaVersion: 2;
	readonly state: string;
	readonly codeVerifier: string | null;
	readonly redirectUri: string;
	readonly mode: AuthorizationMode;
	readonly createdAt: string;
	readonly expiresAt: string;
}

export function createPendingOAuthSession(
	redirectUri: string,
	mode: AuthorizationMode,
	now = new Date(),
): PendingOAuthSession {
	return {
		schemaVersion: 2,
		state: randomBytes(32).toString("base64url"),
		codeVerifier: null,
		redirectUri,
		mode,
		createdAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + OAUTH_SESSION_TTL_MS).toISOString(),
	};
}

export function isPendingOAuthSession(value: unknown): value is PendingOAuthSession {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	const createdAt =
		typeof candidate.createdAt === "string" ? Date.parse(candidate.createdAt) : Number.NaN;
	const expiresAt =
		typeof candidate.expiresAt === "string" ? Date.parse(candidate.expiresAt) : Number.NaN;
	return (
		candidate.schemaVersion === 2 &&
		typeof candidate.state === "string" &&
		/^[A-Za-z0-9_-]{43}$/.test(candidate.state) &&
		(candidate.codeVerifier === null ||
			(typeof candidate.codeVerifier === "string" && candidate.codeVerifier.length > 0)) &&
		typeof candidate.redirectUri === "string" &&
		(candidate.mode === "browser" || candidate.mode === "headless") &&
		Number.isFinite(createdAt) &&
		Number.isFinite(expiresAt) &&
		expiresAt > createdAt &&
		expiresAt - createdAt <= OAUTH_SESSION_TTL_MS
	);
}

export class OAuthSessionManager {
	private session: PendingOAuthSession | undefined;

	constructor(
		private readonly tokenStore: TokenStore,
		private readonly redirectUri: string,
		private readonly mode: AuthorizationMode,
		private readonly profileName: string,
		private readonly now: () => Date = () => new Date(),
	) {}

	state(): string {
		const current = this.current();
		if (current) return current.state;
		const session = createPendingOAuthSession(this.redirectUri, this.mode, this.now());
		this.tokenStore.beginOAuthSession(session, this.profileName, this.now());
		this.session = session;
		return session.state;
	}

	current(): PendingOAuthSession | undefined {
		if (!this.session) return undefined;
		const stored = this.tokenStore.readOAuthSession();
		if (!stored || stored.state !== this.session.state) return undefined;
		this.session = stored;
		return stored;
	}

	saveCodeVerifier(verifier: string): void {
		const session = this.requireCurrent();
		this.tokenStore.saveCodeVerifier(verifier, session.state);
		this.session = { ...session, codeVerifier: verifier };
	}

	codeVerifier(): string {
		const verifier = this.requireCurrent().codeVerifier;
		if (!verifier) {
			throw new CliError(
				"No code verifier saved",
				"OAuth state is incomplete or corrupted",
				'Run "ncli login" again',
			);
		}
		return verifier;
	}

	clear(): void {
		if (this.session) this.tokenStore.deleteOAuthSession(this.session.state);
		this.session = undefined;
	}

	private requireCurrent(): PendingOAuthSession {
		const session = this.current();
		if (!session) {
			throw new CliError(
				"No pending OAuth login session",
				"The authorization state is missing or belongs to another login attempt",
				'Run "ncli login" again',
			);
		}
		return session;
	}
}
