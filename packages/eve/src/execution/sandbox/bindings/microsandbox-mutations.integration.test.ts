import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { withMicrosandboxMutation } from "#execution/sandbox/bindings/microsandbox-mutations.js";

it("holds admission through provider work and rejects a new operation after fencing", async () => {
  const appRoot = await mkdtemp(join(tmpdir(), "eve-mutation-fence-"));
  const directory = join(appRoot, ".eve", "sandbox-cache", "microsandbox", "sessions", "key");
  const scope = join(
    appRoot,
    ".eve",
    "sandbox-mutations",
    createHash("sha256").update("owner").digest("hex"),
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "owner.json"),
    JSON.stringify({
      version: 1,
      backendName: "microsandbox",
      sessionId: "owner",
      sessionKey: "key",
    }),
  );
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const pending = withMicrosandboxMutation(join(directory, "metadata.json"), async () => {
    entered.resolve();
    await release.promise;
  });
  try {
    await entered.promise;
    expect(await readdir(join(scope, "operations"))).toHaveLength(1);
    await writeFile(join(scope, "deleted"), "1\n", { flag: "wx" });
    const later = vi.fn(async () => {});
    await expect(withMicrosandboxMutation(join(directory, "metadata.json"), later)).rejects.toThrow(
      "pending deletion",
    );
    expect(later).not.toHaveBeenCalled();
    expect(await readdir(join(scope, "operations"))).toHaveLength(1);
    release.resolve();
    await pending;
    expect(await readdir(join(scope, "operations"))).toEqual([]);
  } finally {
    release.resolve();
    await pending;
    await rm(appRoot, { recursive: true, force: true });
  }
});
