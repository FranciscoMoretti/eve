/**
 * The published npm package name for the eve framework.
 *
 * This module is intentionally free of side effects and heavy imports so that
 * any layer can reference the package identity without pulling in filesystem
 * or module-resolution code.
 */
export const EVE_PACKAGE_NAME = "eve";

// Distribution aliases must not change persisted workflow/step identifiers.
export function isEvePackageName(name: unknown): boolean {
  return name === EVE_PACKAGE_NAME || name === "@chat-js/eve";
}

export function normalizeEveRuntimeIdentity(identity: { name: string; version: string }): {
  name: string;
  version: string;
} {
  if (identity.name !== "@chat-js/eve") return identity;
  const version = /^(\d+\.\d+\.\d+)-chatjs\.\d+$/.exec(identity.version)?.[1];
  if (version === undefined) throw new Error(`Unsupported ChatJS eve version: ${identity.version}`);
  return { name: EVE_PACKAGE_NAME, version };
}
