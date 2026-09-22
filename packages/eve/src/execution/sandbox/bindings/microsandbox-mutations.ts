import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Admission precedes the fence check. A fence waits for every admitted provider operation. */
export async function withMicrosandboxMutation<T>(
  metadataPath: string | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  if (metadataPath === undefined) return await callback();
  const directory = dirname(metadataPath);
  let scope = join(directory, "mutations");
  const raw = await readFile(join(directory, "owner.json"), "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (raw !== undefined) {
    const owner = JSON.parse(raw);
    if (
      owner.version !== 1 ||
      owner.backendName !== "microsandbox" ||
      owner.sessionKey !== basename(directory) ||
      typeof owner.sessionId !== "string"
    ) {
      throw new Error("Sandbox ownership is invalid.");
    }
    const eveDirectory = dirname(dirname(dirname(dirname(directory))));
    scope = join(
      eveDirectory,
      "sandbox-mutations",
      createHash("sha256").update(owner.sessionId).digest("hex"),
    );
  }
  const operations = join(scope, "operations");
  await mkdir(operations, { recursive: true });
  const lease = join(operations, `${randomUUID()}.json`);
  await writeFile(lease, JSON.stringify({ version: 1, pid: process.pid }), {
    flag: "wx",
    mode: 0o600,
  });
  try {
    const fenced = await access(join(scope, "deleted"))
      .then(() => true)
      .catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
        throw error;
      });
    if (fenced) throw new Error("Sandbox session is pending deletion.");
    return await callback();
  } finally {
    await rm(lease, { force: true });
  }
}
