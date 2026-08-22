import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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

	readCodeVerifier(): string | undefined {
		const state = this.readJson<{ codeVerifier: string }>("auth-state.json");
		return state?.codeVerifier;
	}

	saveCodeVerifier(verifier: string): void {
		this.writeJson("auth-state.json", { codeVerifier: verifier });
	}

	deleteCodeVerifier(): void {
		this.deleteFile("auth-state.json");
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
