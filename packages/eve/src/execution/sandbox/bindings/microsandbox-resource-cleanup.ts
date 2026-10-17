import { readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { RouteHandlerArgs } from "#channel/routes.js";
import { requireLocalSandboxAppRoot } from "#internal/nitro/routes/channel-route-context.js";
import { resolveSandboxCacheDirectory } from "#internal/application/paths.js";
import {
  readSessionMetadata,
  type MicrosandboxResourceMetadata,
} from "#execution/sandbox/bindings/microsandbox-metadata.js";
import {
  retireMicrosandboxResourceOwner,
  withMicrosandboxSessionLock,
  withMicrosandboxResourceOperation,
} from "#execution/sandbox/bindings/microsandbox-resource-metadata.js";
import {
  loadMicrosandboxWithoutInstall,
  removeMicrosandboxResource,
} from "#execution/sandbox/bindings/microsandbox-runtime.js";

const MAX_SESSION_DIRECTORIES = 10_000;
const MAX_METADATA_BYTES = 1_048_576;

async function readResourceOwners(
  providerRoot: string,
): Promise<readonly { path: string; resources: MicrosandboxResourceMetadata }[]> {
  const directory = join(providerRoot, "sessions");
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  if (entries.length > MAX_SESSION_DIRECTORIES)
    throw new Error("Microsandbox session inventory limit exceeded.");
  const owners = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) throw new Error("Unattributed microsandbox session resource.");
    const path = join(directory, entry.name, "metadata.json");
    if ((await realpath(path)) !== path || (await stat(path)).size > MAX_METADATA_BYTES)
      throw new Error("Invalid microsandbox resource metadata.");
    const metadata = await readSessionMetadata(path);
    if (metadata?.resources === undefined || metadata.resources.authority !== providerRoot)
      throw new Error("Unattributed microsandbox session resource.");
    owners.push({ path, resources: metadata.resources });
  }
  return owners;
}

/**
 * Local worker resource control. The application must authorize the session and
 * fence admission before calling. Release fork snapshots only after its retained
 * checkpoints and accepted, pending and live copy references are retired.
 *
 * Supported only by the local development host with explicit MSB_BACKEND=local.
 * expectedAppRoot verifies locality; it never selects the worker's cache.
 * No distributed fencing or recovery of interrupted allocations is implied.
 */
export async function manageLocalMicrosandboxResources(
  context: RouteHandlerArgs,
  input: {
    readonly sessionId: string;
    readonly expectedAppRoot: string;
    readonly action: "retire" | "purge";
    readonly releaseForkSnapshots?: boolean;
  },
): Promise<{
  readonly appRoot: string;
  readonly sessionId: string;
  readonly retired: true;
  readonly remaining: number;
}> {
  const appRoot = await realpath(requireLocalSandboxAppRoot(context));
  if (appRoot !== input.expectedAppRoot)
    throw new Error("Microsandbox worker cache authority mismatch.");
  if (input.sessionId.length === 0 || input.sessionId.length > 512)
    throw new Error("Invalid microsandbox resource owner.");
  const providerRoot = join(resolveSandboxCacheDirectory(appRoot), "microsandbox");
  await retireMicrosandboxResourceOwner(providerRoot, input.sessionId);
  const owners = await readResourceOwners(await realpath(providerRoot));
  const owned = owners.filter(({ resources }) => resources.sessionId === input.sessionId);
  if (input.action === "retire")
    return {
      appRoot,
      sessionId: input.sessionId,
      retired: true,
      remaining: owned.reduce(
        (count, owner) =>
          count + owner.resources.entries.filter((entry) => entry.phase !== "removed").length,
        0,
      ),
    };
  const module = await loadMicrosandboxWithoutInstall(appRoot);
  let remaining = 0;
  for (const owner of owned) {
    for (const resource of owner.resources.entries) {
      if (resource.phase === "removed") continue;
      if (resource.phase === "allocating")
        throw new Error("Microsandbox allocation remains unknown; retain its resources.");
      if (resource.kind === "fork-snapshot") {
        if (input.releaseForkSnapshots !== true) {
          remaining += 1;
          continue;
        }
        let retained = false;
        for (const borrower of owners.filter(
          ({ resources }) => resources.borrowedForkSnapshot === resource.name,
        )) {
          retained ||= await withMicrosandboxSessionLock(
            providerRoot,
            borrower.resources.sessionId,
            async (_authority, retired) => {
              const current = await readSessionMetadata(borrower.path);
              if (current?.resources === undefined)
                throw new Error("Microsandbox consumer ownership disappeared.");
              return (
                !retired || current.resources.entries.some((entry) => entry.phase !== "removed")
              );
            },
          );
        }
        if (retained) {
          remaining += 1;
          continue;
        }
      }
      if (module === null)
        throw new Error("Microsandbox runtime is unavailable; removal is unconfirmed.");
      await withMicrosandboxResourceOperation({
        path: owner.path,
        sessionId: input.sessionId,
        resource,
        operation: "remove",
        run: (_live, nativeId) => removeMicrosandboxResource(module, { ...resource, nativeId }),
      });
    }
  }
  return { appRoot, sessionId: input.sessionId, retired: true, remaining };
}
