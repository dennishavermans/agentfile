import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  capability,
  diagnoseCapability,
  FEATURES,
  featureMeta,
  KNOWN_TARGETS,
  supports,
  targetCapabilities,
} from "../src/capabilities/index.ts";

describe("registry integrity", () => {
  it("attributes every claim to a documentation URL", () => {
    for (const row of CAPABILITIES) {
      expect(row.source, `${row.target}/${row.feature} has no source`).toMatch(/^https:\/\//);
    }
  });

  it("explains every claim", () => {
    for (const row of CAPABILITIES) {
      expect(row.note.length, `${row.target}/${row.feature} has no note`).toBeGreaterThan(10);
    }
  });

  it("only references known features", () => {
    const known = new Set(FEATURES.map((feature) => feature.id));
    for (const row of CAPABILITIES) {
      expect(known.has(row.feature)).toBe(true);
    }
  });

  it("has no duplicate rows for a target and feature", () => {
    const keys = CAPABILITIES.map((row) => `${row.target} ${row.feature}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps feature ids unique", () => {
    const ids = FEATURES.map((feature) => feature.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lists the researched targets", () => {
    expect(KNOWN_TARGETS).toEqual(["agents-md", "claude", "codex", "copilot", "cursor"]);
  });
});

describe("capability lookup", () => {
  it("returns a verified row", () => {
    const row = capability("claude", "skills");
    expect(row.level).toBe("supported");
    expect(row.source).toContain("code.claude.com");
  });

  it("reports an unverified combination as unknown rather than guessing", () => {
    const row = capability("codex", "hooks");
    expect(row.level).toBe("unknown");
    expect(row.source).toBe("");
  });

  it("reports an unknown target as unknown", () => {
    expect(capability("some-future-ide", "skills").level).toBe("unknown");
  });

  it("records that plain AGENTS.md cannot express path scoping", () => {
    expect(capability("agents-md", "instructions.path-scoped").level).toBe("unsupported");
  });

  it("records that Claude Code reads AGENTS.md only through a bridge", () => {
    expect(capability("claude", "instructions.agents-md").level).toBe("emulated");
  });

  it("records that Copilot path-scoped instructions reach only some surfaces", () => {
    expect(capability("copilot", "instructions.path-scoped").level).toBe("degraded");
  });

  it("treats only a verified native implementation as supported", () => {
    expect(supports("cursor", "instructions.path-scoped")).toBe(true);
    expect(supports("claude", "instructions.agents-md")).toBe(false);
    expect(supports("agents-md", "skills")).toBe(false);
  });

  it("lists a target's rows ordered by feature", () => {
    const features = targetCapabilities("cursor").map((row) => row.feature);
    expect(features).toEqual([...features].sort());
  });

  it("exposes feature metadata for messages", () => {
    expect(featureMeta("skills")?.title).toBe("Agent Skills");
    expect(featureMeta("nope" as "skills")).toBeUndefined();
  });
});

describe("diagnoseCapability", () => {
  const context = { subject: 'skill "react-native"', location: { file: "ai/contract.yaml", line: 12 } };

  it("reports nothing for a supported feature", () => {
    expect(diagnoseCapability("claude", "skills", context)).toBeNull();
  });

  it("raises AGF201 for an unsupported feature", () => {
    const found = diagnoseCapability("agents-md", "skills", context);
    expect(found?.code).toBe("AGF201");
    expect(found?.severity).toBe("error");
    expect(found?.message).toContain("does not support");
    expect(found?.location).toEqual(context.location);
  });

  it("raises AGF202 for an emulated feature", () => {
    const found = diagnoseCapability("claude", "instructions.agents-md", context);
    expect(found?.code).toBe("AGF202");
    expect(found?.severity).toBe("warning");
    expect(found?.message).toContain("emulated rather than native");
  });

  it("raises AGF202 for a degraded feature", () => {
    const found = diagnoseCapability("copilot", "instructions.path-scoped", context);
    expect(found?.code).toBe("AGF202");
    expect(found?.message).toContain("narrower than elsewhere");
  });

  it("raises AGF203 for an unverified feature", () => {
    const found = diagnoseCapability("codex", "hooks", context);
    expect(found?.code).toBe("AGF203");
    expect(found?.severity).toBe("info");
    expect(found?.suggestion).toContain("Verify the behaviour");
  });

  it("cites the target's documentation when there is a source", () => {
    expect(diagnoseCapability("agents-md", "skills", context)?.explanation).toContain("https://agents.md/");
  });

  it("carries machine-readable data", () => {
    expect(diagnoseCapability("agents-md", "hooks", context)?.data).toEqual({
      target: "agents-md",
      feature: "hooks",
      level: "unsupported",
      subject: 'skill "react-native"',
    });
  });
});
