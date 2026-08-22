import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

export async function confirm(message: string): Promise<boolean> {
	const readline = createInterface({ input, output });
	try {
		const answer = (await readline.question(`${message} [y/N] `)).trim().toLowerCase();
		return answer === "y" || answer === "yes";
	} finally {
		readline.close();
	}
}
