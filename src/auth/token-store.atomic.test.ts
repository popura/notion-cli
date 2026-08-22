import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TokenStore } from "./token-store.js";

describe("TokenStore atomic writes", () => {
	let directory: string;
	let store: TokenStore;

	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "ncli-token-atomic-test-"));
		store = new TokenStore(directory);
	});

	afterEach(() => {
		fs.rmSync(directory, { recursive: true, force: true });
	});

	it("replaces token files without leaving temporary files", () => {
		store.saveTokens({ access_token: "first" });
		store.saveTokens({ access_token: "second" });

		expect(store.readTokens()).toEqual({ access_token: "second" });
		expect(fs.readdirSync(directory).filter((name) => name.endsWith(".tmp"))).toEqual([]);
	});
});
