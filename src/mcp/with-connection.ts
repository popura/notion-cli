import { withRetry } from "../util/errors.js";
import { MCPConnection, type MCPConnectionOptions } from "./client.js";

export async function withConnection<T>(
	fn: (conn: MCPConnection) => Promise<T>,
	options: MCPConnectionOptions = {},
): Promise<T> {
	const conn = new MCPConnection(options);
	try {
		await conn.connect();
		return await withRetry(() => fn(conn));
	} catch (error) {
		process.exitCode = 1;
		throw error;
	} finally {
		await conn.disconnect();
	}
}
