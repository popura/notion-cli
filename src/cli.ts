import { Command } from "commander";

declare const __NCLI_VERSION__: string;
const version = typeof __NCLI_VERSION__ !== "undefined" ? __NCLI_VERSION__ : "0.0.0-dev";

import { registerApiCommand } from "./commands/api.js";
import { registerCommentCommands } from "./commands/comment.js";
import { registerDbCommands } from "./commands/db.js";
import { registerFetchCommands } from "./commands/fetch.js";
import { registerFileCommands } from "./commands/file.js";
import { registerLoginCommands } from "./commands/login.js";
import { registerMeetingNotesCommands } from "./commands/meeting-notes.js";
import { registerPageCommands } from "./commands/page.js";
import { registerProfileCommands } from "./commands/profile.js";
import { registerRestCommands } from "./commands/rest.js";
import { registerSearchCommands } from "./commands/search.js";
import { registerTeamCommands, registerUserCommands } from "./commands/user.js";
import { registerViewCommands } from "./commands/view.js";
import { setRuntimeProfile } from "./profile/runtime.js";

const program = new Command()
	.name("ncli")
	.version(version)
	.description(
		"ncli — read and write Notion from the terminal.\nMCP commands use OAuth. REST API commands (rest, file) use integration token.",
	)
	.option("-p, --profile <name>", "Use the specified Notion profile for this command")
	.option("--json", "Output as JSON (structured, parseable)")
	.option("--raw", "Output raw response (full server payload)")
	.option("--verbose", "Verbose output")
	.option("--no-color", "Disable colors")
	.configureOutput({
		writeErr: (str) => {
			process.stderr.write(str);
			if (str.includes("error:")) {
				process.stderr.write(
					'Run "ncli --help" for usage, or "ncli <command> --help" for details.\n',
				);
			}
		},
	})
	.addHelpText(
		"after",
		`
Profiles:
  ncli profile add work --use                 # Create and select a profile
  ncli --profile work login                   # Authenticate that profile
  ncli --profile work login --headless        # Authenticate without a local browser/listener
  ncli profile list                           # Inspect local profiles
  NCLI_PROFILE=work ncli search "keyword"     # Select via environment

Quick start (MCP — OAuth auth):
  ncli search "keyword"                        # Find pages/databases
  ncli fetch <id>                              # Get content (use ID from search results)
  ncli page create --title "New" --parent <id> # Create a page
  ncli page update <id> --prop "Status=Done"   # Update properties

Quick start (REST API — integration token):
  ncli rest login                              # Save integration token for selected profile
  ncli rest GET /users/me                      # Verify auth
  ncli rest GET /pages/<id>                    # Get page via REST API
  ncli file upload ./image.png                 # Upload a file

Profile selection: --profile > NCLI_PROFILE > active profile > default.
Workflow: search → fetch (get IDs/schema) → create/update/query
For databases: always "ncli fetch <db-id>" first to get data_source_id.
Use --json for structured output. Errors include recovery hints.
Run "ncli <command> --help" for details, examples, and tips (e.g. "ncli db create --help").`,
	);

program.hook("preAction", (_thisCommand, actionCommand) => {
	const opts = actionCommand.optsWithGlobals() as { profile?: string };
	setRuntimeProfile(opts.profile);
});

registerProfileCommands(program);
registerLoginCommands(program);
registerSearchCommands(program);
registerFetchCommands(program);
registerPageCommands(program);
registerDbCommands(program);
registerViewCommands(program);
registerCommentCommands(program);
registerUserCommands(program);
registerTeamCommands(program);
registerMeetingNotesCommands(program);
registerApiCommand(program);
registerRestCommands(program);
registerFileCommands(program);

export { program };
