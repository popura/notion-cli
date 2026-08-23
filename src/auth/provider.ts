import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
	OAuthClientInformationFull,
	OAuthClientMetadata,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { CLIENT_NAME } from "../util/config.js";
import type { AuthorizationInteraction } from "./authorization-interaction.js";
import type { OAuthSessionManager } from "./oauth-session.js";
import type { TokenStore } from "./token-store.js";

export class NotionOAuthProvider implements OAuthClientProvider {
	constructor(
		private tokenStore: TokenStore,
		private sessionManager: OAuthSessionManager,
		private interaction: AuthorizationInteraction,
	) {}

	get redirectUrl(): URL {
		return this.interaction.redirectUrl;
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: CLIENT_NAME,
			redirect_uris: [this.redirectUrl.toString()],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		};
	}

	state(): string {
		return this.sessionManager.state();
	}

	clientInformation(): OAuthClientInformationFull | undefined {
		return this.tokenStore.readClientInfo() as OAuthClientInformationFull | undefined;
	}

	async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
		this.tokenStore.saveClientInfo(info as unknown as Record<string, unknown>);
	}

	tokens(): OAuthTokens | undefined {
		return this.tokenStore.readTokens() as OAuthTokens | undefined;
	}

	async saveTokens(tokens: OAuthTokens): Promise<void> {
		this.tokenStore.saveTokens(tokens as unknown as Record<string, unknown>);
	}

	invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
		switch (scope) {
			case "all":
				this.tokenStore.deleteTokens();
				this.tokenStore.deleteClientInfo();
				this.sessionManager.clear();
				return;
			case "client":
				this.tokenStore.deleteClientInfo();
				return;
			case "tokens":
				this.tokenStore.deleteTokens();
				return;
			case "verifier":
				this.sessionManager.clear();
				return;
			case "discovery":
				return;
		}
	}

	codeVerifier(): string {
		return this.sessionManager.codeVerifier();
	}

	async saveCodeVerifier(verifier: string): Promise<void> {
		this.sessionManager.saveCodeVerifier(verifier);
	}

	async redirectToAuthorization(url: URL): Promise<void> {
		await this.interaction.presentAuthorizationUrl(url);
	}
}
