export const PROFILE_SCHEMA_VERSION = 1 as const;

export interface ProfileState {
	schemaVersion: typeof PROFILE_SCHEMA_VERSION;
	activeProfile?: string;
}

export interface McpProfileMetadata {
	workspaceId?: string;
	workspaceName?: string;
	userId?: string;
	userName?: string;
}

export interface RestProfileMetadata {
	workspaceId?: string;
	workspaceName?: string;
	botId?: string;
}

export interface ProfileMetadata {
	schemaVersion: typeof PROFILE_SCHEMA_VERSION;
	name: string;
	label?: string;
	createdAt: string;
	updatedAt: string;
	mcp?: McpProfileMetadata;
	rest?: RestProfileMetadata;
}

export interface ProfileSummary extends ProfileMetadata {
	active: boolean;
	mcpConfigured: boolean;
	restConfigured: boolean;
}

export type ProfileSource = "flag" | "environment" | "active" | "default";

export interface ResolvedProfile {
	name: string;
	directory: string;
	source: ProfileSource;
}
