import { type ResolvedMicrosandboxOptions } from "#execution/sandbox/bindings/microsandbox-options.js";
import { assertMicrosandboxPlatformCandidate } from "#execution/sandbox/bindings/microsandbox-platform.js";
import {
  importInstalledEnginePackage,
  isEveDevEnvironment,
  loadOptionalEnginePackage,
} from "#internal/application/optional-package-install.js";

type MicrosandboxModule = typeof import("microsandbox");
const MICROSANDBOX_PACKAGE_NAME = "microsandbox";
const MICROSANDBOX_MISSING_PACKAGE_MESSAGE =
  "The microsandbox sandbox backend requires the `microsandbox` package, which is not bundled " +
  "with eve. Install it in your application (for example `pnpm add -D microsandbox`), or use " +
  "docker() / vercel() instead.";

/**
 * Loads the microsandbox npm package and ensures its VM runtime is
 * installed. During `eve dev`, both are installed automatically when
 * missing (unless `setup.autoInstall: false`): the package with the
 * project's package manager, the runtime via microsandbox's installer.
 * Production processes never install — they fail with actionable
 * errors instead.
 */
export async function loadMicrosandboxModule(input: {
  readonly appRoot: string;
  readonly log?: (message: string) => void;
  readonly options: ResolvedMicrosandboxOptions;
}): Promise<MicrosandboxModule> {
  input.log?.("checking microsandbox platform support");
  await assertMicrosandboxPlatformCandidate();

  const module = await withProgressHeartbeat("loading microsandbox npm package", input.log, () =>
    loadOptionalEnginePackage<MicrosandboxModule>({
      appRoot: input.appRoot,
      autoInstall: input.options.setup.autoInstall,
      importModule: async () => await import("microsandbox"),
      missingMessage: MICROSANDBOX_MISSING_PACKAGE_MESSAGE,
      packageName: MICROSANDBOX_PACKAGE_NAME,
    }),
  );

  input.log?.("checking microsandbox VM runtime");
  if (!module.isInstalled()) {
    if (!input.options.setup.autoInstall || !isEveDevEnvironment()) {
      throw new Error(
        "The microsandbox VM runtime is not installed. Run `npx microsandbox install`, set " +
          "MSB_PATH for a custom install, or let `eve dev` install it automatically with " +
          "microsandbox({ setup: { autoInstall: true } }).",
      );
    }

    await withProgressHeartbeat("installing microsandbox VM runtime", input.log, async () => {
      await module.setup().skipVerify(input.options.setup.skipVerify).install();
    });
  }

  input.log?.("microsandbox runtime ready");
  return module;
}

export async function withProgressHeartbeat<T>(
  message: string,
  log: ((message: string) => void) | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  log?.(message);
  if (log === undefined) {
    return await callback();
  }

  const startedAt = Date.now();
  const timer = setInterval(() => {
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    log(`${message} (${elapsedSeconds}s elapsed)`);
  }, 10_000);
  timer.unref?.();

  try {
    return await callback();
  } finally {
    clearInterval(timer);
  }
}

/**
 * Loads microsandbox only when its package and runtime are already
 * present — used by cleanup paths that must never trigger installs.
 */
export async function loadMicrosandboxWithoutInstall(
  appRoot: string,
): Promise<MicrosandboxModule | null> {
  try {
    const module = await importInstalledEnginePackage<MicrosandboxModule>({
      appRoot,
      packageName: MICROSANDBOX_PACKAGE_NAME,
    });
    return module.isInstalled() ? module : null;
  } catch {
    return null;
  }
}
