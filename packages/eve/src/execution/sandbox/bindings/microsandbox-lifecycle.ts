import { withMicrosandboxMutation } from "#execution/sandbox/bindings/microsandbox-mutations.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  createFileBackedInternalSandboxSession,
  touchDirectory,
  writeSandboxSeedFiles,
} from "#execution/sandbox/bindings/local-backend-utils.js";
import {
  MICROSANDBOX_METADATA_VERSION,
  readSessionMetadata,
  readSessionMetadataRecord,
  readTemplateMetadata,
  resolveMicrosandboxMetadataPath,
  writeTemplateMetadata,
} from "#execution/sandbox/bindings/microsandbox-metadata.js";
import { loadMicrosandboxModule } from "#execution/sandbox/bindings/microsandbox-module.js";
import type { ResolvedMicrosandboxOptions } from "#execution/sandbox/bindings/microsandbox-options.js";
import {
  connectMicrosandbox,
  createPreparedMicrosandbox,
  createProviderName,
  doesPathExist,
  isMicrosandboxNotFoundError,
  type MicrosandboxVm,
  recordMicrosandboxResource,
  removeSnapshotIfExists,
  sandboxExists,
  snapshotExists,
} from "#execution/sandbox/bindings/microsandbox-runtime.js";
import {
  resolveMicrosandboxSessionRootPath,
  resolveMicrosandboxTemplateRootPath,
} from "#execution/sandbox/bindings/microsandbox-templates.js";
import { withDevelopmentSandboxMetadataPathTag } from "#execution/sandbox/development-run.js";
import { createLoggingSandboxSession } from "#execution/sandbox/logging-session.js";
import { buildSandboxSession } from "#execution/sandbox/session.js";
import { resolveSandboxCacheDirectory } from "#internal/application/paths.js";
import type {
  SandboxBackendCreateInput,
  SandboxBackendHandle,
  SandboxBackendPrewarmInput,
  SandboxBackendPrewarmResult,
} from "#public/definitions/sandbox-backend.js";
import { SandboxTemplateNotProvisionedError } from "#public/definitions/sandbox-backend.js";
import type {
  MicrosandboxBootstrapUseOptions,
  MicrosandboxSessionUseOptions,
} from "#public/sandbox/microsandbox-sandbox.js";
import type { InternalSandboxSession } from "#shared/sandbox-session.js";

const activeMicrosandboxSessionHandles = new Map<
  string,
  SandboxBackendHandle<MicrosandboxSessionUseOptions>
>();

export async function prewarmMicrosandboxTemplate(input: {
  readonly backendName: string;
  readonly options: ResolvedMicrosandboxOptions;
  readonly optionsHash: string;
  readonly prewarmInput: SandboxBackendPrewarmInput<MicrosandboxBootstrapUseOptions>;
}): Promise<SandboxBackendPrewarmResult> {
  input.prewarmInput.log?.("loading microsandbox runtime");
  const module = await loadMicrosandboxModule({
    appRoot: input.prewarmInput.runtimeContext.appRoot,
    log: input.prewarmInput.log,
    options: input.options,
  });
  const cacheDirectory = resolveSandboxCacheDirectory(input.prewarmInput.runtimeContext.appRoot);
  const templateRootPath = resolveMicrosandboxTemplateRootPath(
    cacheDirectory,
    input.prewarmInput.templateKey,
  );
  const metadataPath = resolveMicrosandboxMetadataPath(templateRootPath);
  input.prewarmInput.log?.("checking cached snapshot");
  const existing = await readTemplateMetadata(metadataPath);

  if (
    existing?.optionsHash === input.optionsHash &&
    (await snapshotExists(module, existing.snapshotName))
  ) {
    input.prewarmInput.log?.("reusing cached snapshot");
    await touchDirectory(templateRootPath);
    return { reused: true };
  }

  const snapshotName = createProviderName(
    "eve-sbx-tpl",
    input.prewarmInput.templateKey,
    input.optionsHash,
  );
  const temporaryTemplateRootPath = `${templateRootPath}.${randomUUID()}.tmp`;
  const temporarySandboxName = createProviderName(
    "eve-sbx-tpl-tmp",
    `${input.prewarmInput.templateKey}:${randomUUID()}`,
  );

  await removeSnapshotIfExists(module, snapshotName);
  await rm(temporaryTemplateRootPath, { force: true, recursive: true });
  await mkdir(temporaryTemplateRootPath, { recursive: true });

  input.prewarmInput.log?.(`creating template VM from image "${input.options.image}"`);
  const templateSandbox = await createPreparedMicrosandbox({
    log: input.prewarmInput.log,
    module,
    name: temporarySandboxName,
    networkPolicy: input.options.networkPolicy,
    options: input.options,
    sessionKey: input.prewarmInput.templateKey,
    setupBaseRuntime: true,
    tags: undefined,
  });
  const templateSession = buildSandboxSession(
    createMicrosandboxInternalSession(templateSandbox),
    async (policy) => {
      await templateSandbox.setNetworkPolicy(policy);
    },
  );

  try {
    if (input.prewarmInput.seedFiles.length > 0) {
      input.prewarmInput.log?.(`writing ${input.prewarmInput.seedFiles.length} seed file(s)`);
    }
    await writeSandboxSeedFiles(templateSession, input.prewarmInput.seedFiles);

    if (input.prewarmInput.bootstrap !== undefined) {
      input.prewarmInput.log?.("running sandbox bootstrap");
      await input.prewarmInput.bootstrap({
        use: async (useOptions?: MicrosandboxBootstrapUseOptions) => {
          if (useOptions?.networkPolicy !== undefined) {
            await templateSandbox.setNetworkPolicy(useOptions.networkPolicy);
          }
          return createLoggingSandboxSession({
            log: input.prewarmInput.log,
            session: templateSession,
          });
        },
      });
    }

    input.prewarmInput.log?.("snapshotting template VM");
    await templateSandbox.stopAndSnapshot(snapshotName);
    await writeTemplateMetadata(resolveMicrosandboxMetadataPath(temporaryTemplateRootPath), {
      optionsHash: input.optionsHash,
      snapshotName,
      version: MICROSANDBOX_METADATA_VERSION,
    });

    await mkdir(dirname(templateRootPath), { recursive: true });
    await rm(templateRootPath, { force: true, recursive: true });
    try {
      await rename(temporaryTemplateRootPath, templateRootPath);
    } catch (error) {
      if (await doesPathExist(templateRootPath)) {
        return { reused: true };
      }
      throw error;
    }
  } finally {
    await templateSandbox.removePersisted();
    await rm(temporaryTemplateRootPath, { force: true, recursive: true }).catch(() => {});
  }

  return { reused: false };
}

export async function createMicrosandboxHandle(input: {
  readonly backendName: string;
  readonly createInput: SandboxBackendCreateInput;
  readonly options: ResolvedMicrosandboxOptions;
  readonly optionsHash: string;
}): Promise<SandboxBackendHandle<MicrosandboxSessionUseOptions>> {
  const mutationMetadataPath = resolveMicrosandboxMetadataPath(
    resolveMicrosandboxSessionRootPath(
      resolveSandboxCacheDirectory(input.createInput.runtimeContext.appRoot),
      input.createInput.sessionKey,
    ),
  );
  return await withMicrosandboxMutation(mutationMetadataPath, async () => {
    const module = await loadMicrosandboxModule({
      appRoot: input.createInput.runtimeContext.appRoot,
      options: input.options,
    });
    const cacheDirectory = resolveSandboxCacheDirectory(input.createInput.runtimeContext.appRoot);
    const sessionRootPath = resolveMicrosandboxSessionRootPath(
      cacheDirectory,
      input.createInput.sessionKey,
    );
    const activeSessionKey = createActiveMicrosandboxSessionKey(sessionRootPath, input.optionsHash);
    const activeHandle = activeMicrosandboxSessionHandles.get(activeSessionKey);

    const metadataPath = resolveMicrosandboxMetadataPath(sessionRootPath);
    const existingMetadata =
      readSessionMetadataRecord(input.createInput.existingMetadata) ??
      (await readSessionMetadata(metadataPath));
    const forkCheckpoint = input.createInput.forkCheckpoint;
    let forkSnapshotName: string | undefined;
    if (forkCheckpoint !== undefined) {
      if (
        forkCheckpoint.version !== 1 ||
        forkCheckpoint.optionsHash !== input.optionsHash ||
        typeof forkCheckpoint.snapshotName !== "string" ||
        !/^eve-sbx-fork-[a-f0-9]{32}$/.test(forkCheckpoint.snapshotName)
      ) {
        throw new Error("Invalid microsandbox fork checkpoint or changed sandbox configuration.");
      }
      forkSnapshotName = forkCheckpoint.snapshotName;
      const marker = join(sessionRootPath, "fork-checkpoint.json");
      let previous: string | undefined;
      try {
        previous = await readFile(marker, "utf8");
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      const identity = JSON.stringify([forkSnapshotName, input.optionsHash]);
      if (previous !== undefined) {
        if (previous !== identity)
          throw new Error("Sandbox session already has a different fork checkpoint.");
      } else {
        if (activeHandle !== undefined || existingMetadata !== null)
          throw new Error("Existing sandbox has no matching fork checkpoint.");
        await mkdir(sessionRootPath, { recursive: true });
        try {
          await writeFile(marker, identity, { flag: "wx" });
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
          if ((await readFile(marker, "utf8")) !== identity)
            throw new Error("Sandbox session already has a different fork checkpoint.");
        }
      }
    }
    if (activeHandle !== undefined) return activeHandle;
    const sessionTags = withDevelopmentSandboxMetadataPathTag(input.createInput.tags, metadataPath);

    if (
      existingMetadata?.optionsHash === input.optionsHash &&
      ((await sandboxExists(module, existingMetadata.sandboxName)) ||
        (existingMetadata.stateSnapshotName !== undefined &&
          (await snapshotExists(module, existingMetadata.stateSnapshotName))))
    ) {
      const sandbox = await connectMicrosandbox({
        metadata: existingMetadata,
        metadataPath,
        module,
        options: input.options,
        sessionKey: input.createInput.sessionKey,
        tags: sessionTags,
      });
      if (sandbox !== null) {
        return cacheHandle(
          activeSessionKey,
          createHandle(sandbox, input.backendName, input.optionsHash, () => {
            activeMicrosandboxSessionHandles.delete(activeSessionKey);
          }),
        );
      }
    }

    let snapshotName: string | null = null;
    if (forkCheckpoint !== undefined) {
      snapshotName = forkSnapshotName!;
    } else if (input.createInput.templateKey !== null) {
      const templateRootPath = resolveMicrosandboxTemplateRootPath(
        cacheDirectory,
        input.createInput.templateKey,
      );
      const templateMetadata = await readTemplateMetadata(
        resolveMicrosandboxMetadataPath(templateRootPath),
      );

      if (
        templateMetadata === null ||
        templateMetadata.optionsHash !== input.optionsHash ||
        !(await snapshotExists(module, templateMetadata.snapshotName))
      ) {
        throw new SandboxTemplateNotProvisionedError({
          backendName: input.backendName,
          templateKey: input.createInput.templateKey,
        });
      }

      snapshotName = templateMetadata.snapshotName;
    }

    const sandboxName = createProviderName(
      "eve-sbx-ses",
      `${input.createInput.sessionKey}:${randomUUID()}`,
    );
    await recordMicrosandboxResource(metadataPath, "sandbox", sandboxName);
    let sandbox: MicrosandboxVm;
    try {
      sandbox = await createPreparedMicrosandbox({
        fromSnapshot: snapshotName ?? undefined,
        module,
        name: sandboxName,
        networkPolicy: input.options.networkPolicy,
        options: input.options,
        sessionKey: input.createInput.sessionKey,
        setupBaseRuntime: snapshotName === null,
        tags: sessionTags,
      });
    } catch (error) {
      if (
        snapshotName !== null &&
        input.createInput.templateKey !== null &&
        isMicrosandboxNotFoundError(error)
      ) {
        throw new SandboxTemplateNotProvisionedError({
          backendName: input.backendName,
          templateKey: input.createInput.templateKey,
        });
      }
      throw error;
    }

    await sandbox.writeMetadata(metadataPath, input.optionsHash);
    return cacheHandle(
      activeSessionKey,
      createHandle(sandbox, input.backendName, input.optionsHash, () => {
        activeMicrosandboxSessionHandles.delete(activeSessionKey);
      }),
    );
  });
}

function createHandle(
  sandbox: MicrosandboxVm,
  backendName: string,
  optionsHash: string,
  onShutdown?: () => void,
): SandboxBackendHandle<MicrosandboxSessionUseOptions> {
  const session = buildSandboxSession(
    createMicrosandboxInternalSession(sandbox),
    async (policy) => {
      await sandbox.setNetworkPolicy(policy);
    },
  );
  return {
    session,
    useSessionFn: async (options?: MicrosandboxSessionUseOptions) => {
      if (options?.networkPolicy !== undefined) {
        await sandbox.setNetworkPolicy(options.networkPolicy);
      }
      return buildSandboxSession(createMicrosandboxInternalSession(sandbox), async (policy) => {
        await sandbox.setNetworkPolicy(policy);
      });
    },
    async captureForkCheckpoint(checkpointKey) {
      return await sandbox.captureForkCheckpoint(checkpointKey, optionsHash);
    },
    async captureState() {
      const metadata = await sandbox.captureState(optionsHash);
      return {
        backendName,
        metadata: { ...metadata },
        sessionKey: sandbox.id,
      };
    },
    async delete() {
      await sandbox.shutdown();
      await sandbox.removePersisted();
      onShutdown?.();
    },
    async stop() {
      await sandbox.stop();
      onShutdown?.();
    },
    async shutdown() {
      onShutdown?.();
      await sandbox.shutdown();
    },
  };
}

function createMicrosandboxInternalSession(sandbox: MicrosandboxVm): InternalSandboxSession {
  return createFileBackedInternalSandboxSession({ id: sandbox.id, sandbox });
}

function createActiveMicrosandboxSessionKey(sessionRootPath: string, optionsHash: string): string {
  return `${sessionRootPath}\0${optionsHash}`;
}

function cacheHandle(
  key: string,
  handle: SandboxBackendHandle<MicrosandboxSessionUseOptions>,
): SandboxBackendHandle<MicrosandboxSessionUseOptions> {
  activeMicrosandboxSessionHandles.set(key, handle);
  return handle;
}

export function clearActiveMicrosandboxSessionHandlesForTest(): void {
  activeMicrosandboxSessionHandles.clear();
}
