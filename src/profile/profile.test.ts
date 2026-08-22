import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TokenStore } from "../auth/token-store.js";
import { CliError } from "../util/errors.js";
import { migrateLegacyCredentials } from "./migration.js";
import { validateProfileName } from "./profile-name.js";
import { resolveProfile } from "./profile-resolver.js";
import { ProfileStore } from "./profile-store.js";
import { resetRuntimeProfile, resolveRuntimeProfile, setRuntimeProfile } from "./runtime.js";

describe("profiles", () => {
	let configDirectory: string;
	let store: ProfileStore;

	beforeEach(() => {
		configDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ncli-profile-test-"));
		store = new ProfileStore(configDirectory);
	});

	afterEach(() => {
		resetRuntimeProfile();
		fs.rmSync(configDirectory, { recursive: true, force: true });
	});

	it("validates portable path-safe names", () => {
		for (const valid of ["personal", "work-prod", "company.jp", "account_2", "a"]) {
			expect(validateProfileName(valid)).toBe(valid);
		}
		for (const invalid of [
			"",
			"Work",
			"../work",
			"/work",
			"work/",
			".work",
			"work-",
			"con",
			"COM1.txt",
		]) {
			expect(() => validateProfileName(invalid)).toThrow(CliError);
		}
	});

	it("makes the first profile active and isolates credentials", () => {
		store.create("personal", { label: "個人" });
		store.create("work", { label: "会社" });
		expect(store.getActive()).toBe("personal");

		const personalTokens = new TokenStore(store.profileDirectory("personal"));
		const workTokens = new TokenStore(store.profileDirectory("work"));
		personalTokens.saveTokens({ access_token: "personal-token" });
		workTokens.saveTokens({ access_token: "work-token" });
		workTokens.saveRestToken("ntn_work");

		expect(personalTokens.readTokens()).toEqual({ access_token: "personal-token" });
		expect(workTokens.readTokens()).toEqual({ access_token: "work-token" });
		expect(personalTokens.readRestToken()).toBeUndefined();
		expect(workTokens.readRestToken()).toBe("ntn_work");

		const summaries = store.list();
		expect(summaries.find((profile) => profile.name === "personal")?.mcpConfigured).toBe(true);
		expect(summaries.find((profile) => profile.name === "personal")?.restConfigured).toBe(false);
		expect(summaries.find((profile) => profile.name === "work")?.restConfigured).toBe(true);
	});

	it("does not overwrite an existing profile", () => {
		const created = store.create("work", { label: "Company" });
		expect(() => store.create("work")).toThrow(CliError);
		expect(store.create("work", { ifNotExists: true })).toEqual(created);
	});

	it("requires an explicit replacement when deleting the active profile", () => {
		store.create("personal");
		store.create("work");
		expect(() => store.delete("personal")).toThrow(CliError);
		store.delete("personal", { switchTo: "work" });
		expect(store.getActive()).toBe("work");
		expect(store.exists("personal")).toBe(false);
	});

	it("does not accept --switch-to for a non-active deletion", () => {
		store.create("personal");
		store.create("work");
		expect(() => store.delete("work", { switchTo: "personal" })).toThrow(CliError);
		expect(store.getActive()).toBe("personal");
		expect(store.exists("work")).toBe(true);
	});

	it("leaves no active profile after deleting the final profile", () => {
		store.create("personal");
		store.delete("personal");
		expect(store.getActive()).toBeUndefined();
		expect(store.list()).toEqual([]);
	});

	it("resolves flag, environment, active profile, then default", () => {
		store.create("personal");
		store.create("work");
		store.create("default");
		store.setActive("personal");

		expect(
			resolveProfile({
				explicitProfile: "work",
				environment: { NCLI_PROFILE: "default" },
				configDirectory,
			}),
		).toEqual({ name: "work", directory: store.profileDirectory("work"), source: "flag" });
		expect(
			resolveProfile({ environment: { NCLI_PROFILE: "work" }, configDirectory }).source,
		).toBe("environment");
		expect(resolveProfile({ environment: {}, configDirectory }).name).toBe("personal");
		store.clearActive();
		expect(resolveProfile({ environment: {}, configDirectory }).source).toBe("default");
	});

	it("never falls back from an explicitly missing profile", () => {
		store.create("default");
		expect(() => resolveProfile({ explicitProfile: "typo", configDirectory })).toThrow(
			CliError,
		);
	});

	it("preserves a supplied config directory during runtime resolution", () => {
		store.create("work");
		setRuntimeProfile("work");
		const resolved = resolveRuntimeProfile({ configDirectory, environment: {} });
		expect(resolved.directory).toBe(store.profileDirectory("work"));
		expect(resolved.source).toBe("flag");
	});

	it("migrates legacy credentials to default without data loss", () => {
		const legacy = {
			"tokens.json": '{"access_token":"legacy"}',
			"client.json": '{"client_id":"client"}',
			"auth-state.json": '{"codeVerifier":"verifier"}',
			"rest-token.json": '{"token":"ntn_legacy"}',
		};
		for (const [name, content] of Object.entries(legacy)) {
			fs.writeFileSync(path.join(configDirectory, name), content);
		}

		expect(migrateLegacyCredentials(store).status).toBe("migrated");
		expect(store.getActive()).toBe("default");
		for (const [name, content] of Object.entries(legacy)) {
			expect(
				fs.readFileSync(path.join(store.profileDirectory("default"), name), "utf-8"),
			).toBe(content);
			expect(fs.existsSync(path.join(configDirectory, name))).toBe(false);
		}
		expect(migrateLegacyCredentials(store)).toEqual({ status: "not_needed" });
	});

	it("cleans up an identical leftover legacy copy idempotently", () => {
		store.create("default");
		const destination = path.join(store.profileDirectory("default"), "tokens.json");
		fs.writeFileSync(destination, '{"access_token":"same"}');
		fs.writeFileSync(path.join(configDirectory, "tokens.json"), '{"access_token":"same"}');

		expect(migrateLegacyCredentials(store).status).toBe("migrated");
		expect(fs.existsSync(path.join(configDirectory, "tokens.json"))).toBe(false);
	});

	it("never overwrites conflicting legacy credentials", () => {
		store.create("default");
		const destination = path.join(store.profileDirectory("default"), "tokens.json");
		fs.writeFileSync(destination, "new");
		fs.writeFileSync(path.join(configDirectory, "tokens.json"), "legacy");

		expect(() => migrateLegacyCredentials(store)).toThrow(CliError);
		expect(fs.readFileSync(destination, "utf-8")).toBe("new");
		expect(fs.readFileSync(path.join(configDirectory, "tokens.json"), "utf-8")).toBe(
			"legacy",
		);
	});
});
