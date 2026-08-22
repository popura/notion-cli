import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileStore } from "../profile/profile-store.js";
import { registerProfileCommands } from "./profile.js";

describe("profile commands", () => {
	let configDirectory: string;
	let program: Command;
	let log: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		configDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ncli-profile-command-test-"));
		program = new Command().name("ncli").option("--json").option("--raw").exitOverride();
		registerProfileCommands(program, configDirectory);
		log = vi.spyOn(console, "log").mockImplementation(() => undefined);
	});

	afterEach(() => {
		log.mockRestore();
		fs.rmSync(configDirectory, { recursive: true, force: true });
	});

	it("adds and selects a profile", async () => {
		await program.parseAsync([
			"node",
			"ncli",
			"profile",
			"add",
			"work",
			"--label",
			"会社",
			"--use",
		]);
		const store = new ProfileStore(configDirectory);
		expect(store.get("work").label).toBe("会社");
		expect(store.getActive()).toBe("work");
	});

	it("lists profiles without exposing credential contents", async () => {
		const store = new ProfileStore(configDirectory);
		store.create("work");
		fs.writeFileSync(
			path.join(store.profileDirectory("work"), "tokens.json"),
			'{"access_token":"secret"}',
		);

		await program.parseAsync(["node", "ncli", "--json", "profile", "list"]);
		const output = log.mock.calls.map(([value]) => String(value)).join("\n");
		expect(output).toContain('"configured": true');
		expect(output).not.toContain("secret");
	});

	it("deletes a profile non-interactively with --force", async () => {
		const store = new ProfileStore(configDirectory);
		store.create("work");

		await program.parseAsync(["node", "ncli", "profile", "delete", "work", "--force"]);
		expect(store.exists("work")).toBe(false);
	});
});
