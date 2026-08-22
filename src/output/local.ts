import type { OutputOptions } from "./json.js";

export function formatLocalOutput(value: unknown, opts: OutputOptions): string {
	return opts.raw ? JSON.stringify(value) : JSON.stringify(value, null, 2);
}

export function printLocalOutput(value: unknown, opts: OutputOptions): void {
	console.log(formatLocalOutput(value, opts));
}
