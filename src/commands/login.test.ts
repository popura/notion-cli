import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CliError } from "../util/errors.js";
import {
	assertHeadlessInteractiveInput,
	parseAuthorizationTimeoutSeconds,
	registerLoginCommands,
} from "./login.js";

const withConnectionMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../mcp/with-connection.js", () => ({
	withConnection: withConnectionMock,
}));

describe("registerLoginCommands", () => {
	beforeEach(() => {
		withConnectionMock.mockClear();
	});

	function createProgram(): Command {
		const program = new Command().name("ncli").option("--json").option("--raw").exitOverride();
		registerLoginCommands(program, {
			isInteractiveInput: () => true,
			resolveProfileName: () => "work",
		});
		return program;
	}

	it("registers login, logout, and whoami commands", () => {
		const program = createProgram();
		const names = program.commands.map((c) => c.name());
		expect(names).toContain("login");
		expect(names).toContain("logout");
		expect(names).toContain("whoami");
	});

	/**
	 * Preconditions: The user explicitly selects manual headless OAuth in an interactive terminal.
	 * Prerequisites: The authorization wait limit is a valid number of seconds.
	 * Verification: The login action forwards headless mode and milliseconds to MCPConnection.
	 */
	it("maps --headless and --auth-timeout to connection options", async () => {
		const program = createProgram();

		await program.parseAsync(["node", "ncli", "login", "--headless", "--auth-timeout", "45"]);

		expect(withConnectionMock).toHaveBeenCalledOnce();
		expect(withConnectionMock.mock.calls[0]?.[1]).toEqual({
			authorizationMode: "headless",
			authorizationTimeoutMs: 45_000,
		});
	});

	it.each([
		"0",
		"-1",
		"601",
		"1.5",
		"not-a-number",
	])("rejects an unsafe authorization timeout: %s", (value) => {
		expect(() => parseAuthorizationTimeoutSeconds(value)).toThrow(CliError);
	});

	/**
	 * Preconditions: A caller requests headless OAuth while stdin is redirected or closed.
	 * Prerequisites: No secure interactive TTY is available for the callback URL.
	 * Verification: Validation fails immediately with the selected profile in the recovery hint.
	 */
	it("rejects headless login without an interactive stdin", () => {
		expect(() => assertHeadlessInteractiveInput(false, "work")).toThrow(
			"Headless login requires an interactive terminal",
		);
		expect(() => assertHeadlessInteractiveInput(true, "work")).not.toThrow();
	});
});
