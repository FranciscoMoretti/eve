import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  DOCKER_SANDBOX_LABEL,
  stopDockerContainerIfRunning,
} from "#execution/sandbox/bindings/docker-container.js";
import { createDockerCli, DockerUnavailableError } from "#execution/sandbox/bindings/docker-cli.js";
import { readSessionMetadata } from "#execution/sandbox/bindings/microsandbox-metadata.js";
import {
  updateMicrosandboxMaterialization,
  withMicrosandboxResourceOperation,
} from "#execution/sandbox/bindings/microsandbox-resource-metadata.js";
import {
  createProviderName,
  loadMicrosandboxWithoutInstall,
  removeMicrosandboxResource,
  stopAndSnapshotMicrosandboxSandbox,
} from "#execution/sandbox/bindings/microsandbox-runtime.js";
import {
  EVE_DEVELOPMENT_SANDBOX_METADATA_PATH_TAG,
  EVE_DEVELOPMENT_SANDBOX_RUN_ID_TAG,
} from "#execution/sandbox/development-run.js";
import { toErrorMessage } from "#shared/errors.js";

export async function stopDevelopmentSandboxResources(input: {
  readonly appRoot: string;
  readonly devRunId: string;
  readonly log?: (message: string) => void;
}): Promise<void> {
  const errors = await Promise.allSettled([
    stopDevelopmentDockerResources(input.devRunId),
    stopDevelopmentMicrosandboxResources(input.appRoot, input.devRunId, input.log),
  ]);

  for (const error of errors) {
    if (error.status === "rejected") {
      input.log?.(`failed to stop development sandbox resources: ${toErrorMessage(error.reason)}`);
    }
  }
}

async function stopDevelopmentDockerResources(devRunId: string): Promise<void> {
  const cli = createDockerCli();
  const labelFilters = [
    `label=${DOCKER_SANDBOX_LABEL}=1`,
    `label=${DOCKER_SANDBOX_LABEL}.tag.${EVE_DEVELOPMENT_SANDBOX_RUN_ID_TAG}=${devRunId}`,
  ];
  let running;
  try {
    running = await cli.run([
      "ps",
      "-q",
      ...labelFilters.flatMap((filter) => ["--filter", filter]),
    ]);
  } catch (error) {
    if (error instanceof DockerUnavailableError) {
      return;
    }
    throw error;
  }
  if (running.exitCode !== 0) {
    return;
  }

  const containerIds = running.stdout.trim().split(/\s+/u).filter(Boolean);
  await Promise.all(
    containerIds.map((containerId) => stopDockerContainerIfRunning(cli, containerId)),
  );
}

async function stopDevelopmentMicrosandboxResources(
  appRoot: string,
  devRunId: string,
  log: ((message: string) => void) | undefined,
): Promise<void> {
  const module = await loadMicrosandboxWithoutInstall(appRoot);
  if (module === null) {
    return;
  }

  const sandboxes = [];
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    const page = await module.Sandbox.listWith((list) => {
      const scoped = list.labels({
        "eve.provider": "microsandbox",
        [EVE_DEVELOPMENT_SANDBOX_RUN_ID_TAG]: devRunId,
      });
      return cursor === undefined ? scoped : scoped.cursor(cursor);
    });
    sandboxes.push(...page.sandboxes);
    cursor = page.nextCursor;
    if (cursor !== undefined && cursors.has(cursor))
      throw new Error("Microsandbox cleanup pagination did not advance.");
    if (cursor !== undefined) cursors.add(cursor);
  } while (cursor !== undefined);

  await Promise.all(
    sandboxes
      .filter(
        (sandbox) =>
          (sandbox.status === "running" || sandbox.status === "draining") &&
          getMicrosandboxLabel(sandbox.configJson, "eve.provider") === "microsandbox" &&
          getMicrosandboxLabel(sandbox.configJson, EVE_DEVELOPMENT_SANDBOX_RUN_ID_TAG) === devRunId,
      )
      .map(async (sandbox) => {
        const metadataPath = getMicrosandboxLabel(
          sandbox.configJson,
          EVE_DEVELOPMENT_SANDBOX_METADATA_PATH_TAG,
        );
        if (metadataPath === undefined) {
          const handle = await module.Sandbox.get(sandbox.name);
          await handle.stopWithTimeout(10_000).catch(() => {});
          return;
        }

        const metadata = await readSessionMetadata(metadataPath);
        const resources = metadata?.resources;
        const authority = join(await realpath(appRoot), ".eve/sandbox-cache/microsandbox");
        const vm = resources?.entries.find(
          (entry) =>
            entry.kind === "sandbox" && entry.name === sandbox.name && entry.phase === "live",
        );
        if (
          metadata === null ||
          metadata.sandboxName !== sandbox.name ||
          resources?.authority !== authority ||
          vm?.nativeId === undefined ||
          dirname(dirname(dirname(metadataPath))) !== authority ||
          (await realpath(metadataPath)) !== metadataPath
        )
          throw new Error("Development microsandbox resource ownership is unavailable.");

        log?.(`snapshotting development microsandbox session "${sandbox.name}" before shutdown`);
        const previousStateSnapshotName = metadata.stateSnapshotName;
        const stateSnapshotName = createProviderName(
          "eve-sbx-state",
          `${metadata.sandboxName}:${randomUUID()}`,
        );
        await withMicrosandboxResourceOperation({
          path: metadataPath,
          sessionId: resources.sessionId,
          resource: { kind: "state-snapshot", name: stateSnapshotName },
          operation: "allocate",
          run: async () =>
            await stopAndSnapshotMicrosandboxSandbox(
              module,
              sandbox.name,
              stateSnapshotName,
              vm.nativeId,
            ),
          identify: async (snapshot) => ({ nativeId: snapshot.digest, nativePath: snapshot.path }),
        });
        await updateMicrosandboxMaterialization(metadataPath, resources.sessionId, {
          ...metadata,
          stateSnapshotName,
        });
        if (previousStateSnapshotName !== undefined) {
          const previous = resources.entries.find(
            (entry) => entry.kind === "state-snapshot" && entry.name === previousStateSnapshotName,
          );
          if (previous === undefined)
            throw new Error("Development microsandbox state ownership is unavailable.");
          await withMicrosandboxResourceOperation({
            path: metadataPath,
            sessionId: resources.sessionId,
            resource: previous,
            operation: "remove",
            run: async () => await removeMicrosandboxResource(module, previous),
          });
        }
      }),
  );
}

function getMicrosandboxLabel(configJson: string, key: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(configJson);
  } catch {
    return undefined;
  }

  return findLabel(parsed, key);
}

function findLabel(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const direct = value[key];
  if (typeof direct === "string") {
    return direct;
  }

  const labels = value.labels;
  if (isRecord(labels) && typeof labels[key] === "string") {
    return labels[key];
  }

  if (typeof value.labelsJson === "string") {
    const parsedLabels = parseJsonRecord(value.labelsJson);
    if (parsedLabels !== null && typeof parsedLabels[key] === "string") {
      return parsedLabels[key];
    }
  }

  for (const child of Object.values(value)) {
    const found = findLabel(child, key);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
