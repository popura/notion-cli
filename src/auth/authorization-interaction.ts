import type { OAuthCallbackResult } from "./callback-parser.js";
import type { PendingOAuthSession } from "./oauth-session.js";

export interface AuthorizationInteraction {
	readonly redirectUrl: URL;

	presentAuthorizationUrl(url: URL): Promise<void>;

	waitForCallback(session: PendingOAuthSession): Promise<OAuthCallbackResult>;

	close(): Promise<void>;
}
