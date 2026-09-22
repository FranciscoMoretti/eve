import { describe, expect, it } from "vitest";
import { normalizeEveRuntimeIdentity } from "#internal/package-name.js";

describe("eve distribution identity", () => {
  it("preserves persisted runtime identity across fork package revisions", () => {
    for (const version of ["0.61.0-chatjs.0", "0.61.0-chatjs.12"]) {
      expect(normalizeEveRuntimeIdentity({ name: "@chat-js/eve", version })).toEqual({
        name: "eve",
        version: "0.61.0",
      });
    }
  });
  it("does not canonicalize other packages", () => {
    expect(normalizeEveRuntimeIdentity({ name: "@other/eve", version: "0.61.0-chatjs.0" })).toEqual(
      { name: "@other/eve", version: "0.61.0-chatjs.0" },
    );
  });
  it("rejects a fork version without an explicit upstream base", () => {
    expect(() => normalizeEveRuntimeIdentity({ name: "@chat-js/eve", version: "1.0.0" })).toThrow(
      "Unsupported ChatJS eve version",
    );
  });
});
