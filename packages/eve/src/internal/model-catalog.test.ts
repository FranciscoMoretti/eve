import { describe, expect, it } from "vitest";

import {
  findCatalogModelBySlug,
  findCatalogModelByProviderModelId,
  normalizeCatalogModelId,
  type CatalogModel,
} from "#internal/model-catalog.js";

const MODELS: CatalogModel[] = [
  {
    slug: "anthropic/claude-opus-4.7",
    providers: [
      { provider: "anthropic", providerModelId: "claude-opus-4-7", contextWindowTokens: 200_000 },
    ],
  },
  {
    slug: "arcee-ai/trinity-large-thinking",
    providers: [
      {
        provider: "arcee-ai",
        providerModelId: "trinity-large-thinking",
        contextWindowTokens: 262_100,
      },
    ],
  },
  {
    slug: "moonshotai/kimi-k2",
    providers: [
      { provider: "moonshotai", providerModelId: "kimi-k2", contextWindowTokens: 131_072 },
    ],
  },
  {
    slug: "moonshotai/kimi-k2-thinking",
    providers: [
      { provider: "moonshotai", providerModelId: "kimi-k2-thinking", contextWindowTokens: 216_144 },
    ],
  },
];

describe("normalizeCatalogModelId", () => {
  it("strips a trailing -thinking suffix", () => {
    expect(normalizeCatalogModelId("anthropic/claude-opus-4.7-thinking")).toBe(
      "anthropic/claude-opus-4.7",
    );
  });

  it("leaves other ids untouched", () => {
    expect(normalizeCatalogModelId("openai/gpt-5.4")).toBe("openai/gpt-5.4");
    expect(normalizeCatalogModelId("openai/gpt-5.1-thinking-fast")).toBe(
      "openai/gpt-5.1-thinking-fast",
    );
  });
});

describe("findCatalogModelBySlug", () => {
  it("matches an exact slug", () => {
    expect(findCatalogModelBySlug(MODELS, "anthropic/claude-opus-4.7")?.slug).toBe(
      "anthropic/claude-opus-4.7",
    );
  });

  it("falls back to the base model for a gateway -thinking variant", () => {
    expect(findCatalogModelBySlug(MODELS, "anthropic/claude-opus-4.7-thinking")?.slug).toBe(
      "anthropic/claude-opus-4.7",
    );
  });

  it("resolves a model whose canonical slug ends in -thinking", () => {
    expect(findCatalogModelBySlug(MODELS, "arcee-ai/trinity-large-thinking")?.slug).toBe(
      "arcee-ai/trinity-large-thinking",
    );
  });

  it("prefers the exact -thinking slug over its base model", () => {
    expect(findCatalogModelBySlug(MODELS, "moonshotai/kimi-k2-thinking")?.slug).toBe(
      "moonshotai/kimi-k2-thinking",
    );
  });

  it("returns undefined for an unknown slug", () => {
    expect(findCatalogModelBySlug(MODELS, "unknown/model")).toBeUndefined();
  });
});

describe("provider model aliases", () => {
  const provider = {
    provider: "openai",
    providerModelId: "gpt-5-nano-2025-08-07",
    contextWindowTokens: 400_000,
  };
  const model: CatalogModel = {
    slug: "openai/gpt-5-nano",
    providers: [
      { provider: "azure", providerModelId: "gpt-5-nano", contextWindowTokens: 123_000 },
      provider,
    ],
  };
  const lookup = (
    models: readonly CatalogModel[],
    providerModelId = "gpt-5-nano",
    name = "openai.responses",
  ) =>
    findCatalogModelByProviderModelId({
      models,
      provider: name,
      providerModelId,
      providerAliases: { direct: "openai" },
    });
  it("resolves a slug alias to metadata from the same provider", () => {
    expect(lookup([model])).toEqual({ model, provider });
  });
  it("keeps exact dated provider IDs supported", () => {
    expect(lookup([model], provider.providerModelId)).toEqual({ model, provider });
  });
  it("prefers an exact provider ID over another model's slug alias", () => {
    const exactProvider = {
      ...provider,
      providerModelId: "gpt-5-nano",
      contextWindowTokens: 200_000,
    };
    const exactModel = { slug: "openai/other", providers: [exactProvider] };
    expect(lookup([model, exactModel])).toEqual({ model: exactModel, provider: exactProvider });
  });
  it("never takes another provider's metadata from the matching slug", () => {
    expect(lookup([{ ...model, providers: [model.providers[0]!] }])).toBeNull();
  });
  it("retains unknown IDs as unresolved", () => {
    expect(lookup([model], "unknown")).toBeNull();
  });
  it("uses configured provider aliases without changing dispatch identity", () => {
    expect(lookup([model], "gpt-5-nano", "direct.responses")).toEqual({ model, provider });
    expect(model.providers[1]!.providerModelId).toBe("gpt-5-nano-2025-08-07");
  });
});
