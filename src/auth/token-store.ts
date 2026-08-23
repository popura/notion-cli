import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CliError } from "../util/errors.js";
import { isPendingOAuthSession, type PendingOAuthSession } from "./oauth-session.js";

export class TokenStore {
	constructor(private configDir: string) {}

	private filePath(name: string): string {
		return path.join(this.configDir, name);
	}

	private ensureDir(): void {
		fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
	}

	private readJson<T>(name: string): T | undefined {
		try {
			const data = fs.readFileSync(this.filePath(name), "utf-8");
			return JSON.parse(data) as T;
		} catch {
			return undefined;
		}
	}

	private writeJson(name: string, data: unknown): void {
		this.ensureDir();
		const destination = this.filePath(name);
		const temporary = this.filePath(`.${name}.${randomUUID()}.tmp`);
		try {
			fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
			try {
				fs.renameSync(temporary, destination);
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if ((code === "EEXIST" || code === "EPERM") && fs.existsSync(destination)) {
					fs.unlinkSync(destination);
					fs.renameSync(temporary, destination);
				} else {
					throw error;
				}
			}
			try {
				fs.chmodSync(destination, 0o600);
			} catch {
				// Some filesystems do not implement POSIX permissions.
			}
		} finally {
			if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
		}
	}

	private createJsonExclusive(name: string, data: unknown): boolean {
		this.ensureDir();
		const destination = this.filePath(name);
		const temporary = this.filePath(`.${name}.${randomUUID()}.tmp`);
		try {
			fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
			try {
				fs.linkSync(temporary, destination);
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if ((code === "EEXIST" || code === "EPERM") && fs.existsSync(destination)) {
					return false;
				}
				throw error;
			}
			try {
				fs.chmodSync(destination, 0o600);
			} catch {
				// Some filesystems do not implement POSIX permissions.
			}
			return true;
		} finally {
			if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
		}
	}

	private deleteFile(name: string): void {
		try {
			fs.unlinkSync(this.filePath(name));
		} catch {
			// no-op if file doesn't exist
		}
	}

	readTokens(): Record<string, unknown> | undefined {
		return this.readJson("tokens.json");
	}

	saveTokens(tokens: Record<string, unknown>): void {
		this.writeJson("tokens.json", tokens);
	}

	deleteTokens(): void {
		this.deleteFile("tokens.json");
	}

	readClientInfo(): Record<string, unknown> | undefined {
		return this.readJson("client.json");
	}

	saveClientInfo(info: Record<string, unknown>): void {
		this.writeJson("client.json", info);
	}

	deleteClientInfo(): void {
		this.deleteFile("client.json");
	}

	readOAuthSession(): PendingOAuthSession | undefined {
		const session = this.readJson<unknown>("auth-state.json");
		if (isPendingOAuthSession(session)) return session;
		if (fs.existsSync(this.filePath("auth-state.json"))) this.deleteFile("auth-state.json");
		return undefined;
	}

	beginOAuthSession(session: PendingOAuthSession, profileName: string, now = new Date()): void {
		const existing = this.readOAuthSession();
		if (existing && now.getTime() < Date.parse(existing.expiresAt)) {
			throw new CliError(
				`Another login is already in progress for profile ${JSON.stringify(profileName)}`,
				"Concurrent OAuth sessions would overwrite the pending state",
				"Complete or cancel the existing login before starting another",
			);
		}
		if (existing) this.deleteFile("auth-state.json");
		if (!this.createJsonExclusive("auth-state.json", session)) {
			throw new CliError(
				`Another login is already in progress for profile ${JSON.stringify(profileName)}`,
				"Concurrent OAuth sessions would overwrite the pending state",
				"Complete or cancel the existing login before starting another",
			);
		}
	}

	deleteOAuthSession(expectedState?: string): boolean {
		const session = this.readOAuthSession();
		if (!session || (expectedState !== undefined && session.state !== expectedState)) {
			return false;
		}
		this.deleteFile("auth-state.json");
		return true;
	}

	readCodeVerifier(): string | undefined {
		return this.readOAuthSession()?.codeVerifier ?? undefined;
	}

	saveCodeVerifier(verifier: string, expectedState?: string): void {
		const session = this.readOAuthSession();
		if (!session || (expectedState !== undefined && session.state !== expectedState)) {
			throw new CliError(
				"Could not save the OAuth code verifier",
				"The pending login session is missing or belongs to another authorization attempt",
				'Run "ncli login" again',
			);
		}
		this.writeJson("auth-state.json", {
			...session,
			codeVerifier: verifier,
		});
	}

	deleteCodeVerifier(): void {
		this.deleteOAuthSession();
	}

	readRestToken(): string | undefined {
		const data = this.readJson<{ token: string }>("rest-token.json");
		return data?.token;
	}

	saveRestToken(token: string): void {
		this.writeJson("rest-token.json", { token });
	}

	deleteRestToken(): void {
		this.deleteFile("rest-token.json");
	}

	deleteAll(): void {
		this.deleteTokens();
		this.deleteClientInfo();
		this.deleteCodeVerifier();
		this.deleteRestToken();
	}
}
