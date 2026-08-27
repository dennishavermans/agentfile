import { describe, expect, it } from "vitest";
import {
  ancestorDirectories,
  compareGlobSpecificity,
  dirnameOf,
  expandDirectoryPattern,
  globSpecificity,
  isWithin,
  matchesAnyPattern,
  matchesPattern,
  matchingPatterns,
  normalizePath,
  pathDepth,
  ROOT_PATH,
  sortByGlobSpecificity,
  splitGlobList,
} from "../src/paths/index.ts";

describe("normalizePath", () => {
  it("converts Windows separators to POSIX", () => {
    expect(normalizePath("apps\\mobile\\src")).toBe("apps/mobile/src");
  });

  it("strips a leading ./", () => {
    expect(normalizePath("./src/index.ts")).toBe("src/index.ts");
  });

  it("strips a trailing slash", () => {
    expect(normalizePath("src/components/")).toBe("src/components");
  });

  it("collapses repeated separators", () => {
    expect(normalizePath("src//components///Button.tsx")).toBe("src/components/Button.tsx");
  });

  it("drops interior . segments", () => {
    expect(normalizePath("src/./components")).toBe("src/components");
  });

  it("preserves absolute paths as absolute", () => {
    expect(normalizePath("/Users/dev/project")).toBe("/Users/dev/project");
  });

  it("maps an empty path to the root", () => {
    expect(normalizePath("")).toBe(ROOT_PATH);
    expect(normalizePath("./")).toBe(ROOT_PATH);
  });
});

describe("dirnameOf", () => {
  it("returns the containing directory", () => {
    expect(dirnameOf("apps/mobile/src/Login.tsx")).toBe("apps/mobile/src");
  });

  it("returns the root for a top-level file", () => {
    expect(dirnameOf("AGENTS.md")).toBe(ROOT_PATH);
  });
});

describe("pathDepth", () => {
  it("counts the root as zero", () => {
    expect(pathDepth(ROOT_PATH)).toBe(0);
  });

  it("counts segments", () => {
    expect(pathDepth("apps")).toBe(1);
    expect(pathDepth("apps/mobile/src")).toBe(3);
  });
});

describe("ancestorDirectories", () => {
  it("lists containing directories root first", () => {
    expect(ancestorDirectories("apps/mobile/src/Login.tsx")).toEqual([
      ROOT_PATH,
      "apps",
      "apps/mobile",
      "apps/mobile/src",
    ]);
  });

  it("returns just the root for a top-level file", () => {
    expect(ancestorDirectories("AGENTS.md")).toEqual([ROOT_PATH]);
  });
});

describe("isWithin", () => {
  it("treats the root as containing everything", () => {
    expect(isWithin(ROOT_PATH, "apps/mobile/src/Login.tsx")).toBe(true);
  });

  it("matches a nested path", () => {
    expect(isWithin("apps/mobile", "apps/mobile/src/Login.tsx")).toBe(true);
  });

  it("rejects a sibling directory", () => {
    expect(isWithin("apps/mobile", "apps/web/src/Login.tsx")).toBe(false);
  });

  it("does not match on a shared prefix that is not a path boundary", () => {
    expect(isWithin("apps/mob", "apps/mobile/src")).toBe(false);
  });

  it("treats a directory as within itself", () => {
    expect(isWithin("apps/mobile", "apps/mobile")).toBe(true);
  });
});

describe("expandDirectoryPattern", () => {
  it("expands a trailing slash into a subtree glob", () => {
    expect(expandDirectoryPattern("dist/")).toBe("dist/**");
  });

  it("leaves other patterns alone", () => {
    expect(expandDirectoryPattern("src/**/*.ts")).toBe("src/**/*.ts");
  });
});

describe("matchesPattern", () => {
  it("matches a globstar across segments", () => {
    expect(matchesPattern("src/api/handlers/users.ts", "src/api/**/*.ts")).toBe(true);
  });

  it("does not let a single star cross a separator", () => {
    expect(matchesPattern("src/a/x.ts", "src/*.ts")).toBe(false);
    expect(matchesPattern("src/x.ts", "src/*.ts")).toBe(true);
  });

  it("supports brace alternatives", () => {
    expect(matchesPattern("src/ui/Button.tsx", "src/**/*.{ts,tsx}")).toBe(true);
    expect(matchesPattern("src/ui/Button.css", "src/**/*.{ts,tsx}")).toBe(false);
  });

  it("matches a directory pattern written with a trailing slash", () => {
    expect(matchesPattern("apps/mobile/src/Login.tsx", "apps/mobile/")).toBe(true);
  });

  it("normalizes the path before matching", () => {
    expect(matchesPattern("./src/x.ts", "src/*.ts")).toBe(true);
    expect(matchesPattern("src\\x.ts", "src/*.ts")).toBe(true);
  });

  // Documented behaviour: a leading star does not match a leading dot, so dot
  // directories must be named explicitly. Locked down so a matcher swap cannot
  // change it silently.
  it("does not match dot directories with a bare globstar", () => {
    expect(matchesPattern(".claude/rules/style.md", "**/*.md")).toBe(false);
    expect(matchesPattern(".claude/rules/style.md", ".claude/**/*.md")).toBe(true);
  });
});

describe("matchesAnyPattern", () => {
  it("returns false for an empty pattern list", () => {
    expect(matchesAnyPattern("src/x.ts", [])).toBe(false);
  });

  it("returns true when any pattern matches", () => {
    expect(matchesAnyPattern("src/x.ts", ["docs/**", "src/*.ts"])).toBe(true);
  });
});

describe("matchingPatterns", () => {
  it("returns every matching pattern in declaration order", () => {
    expect(matchingPatterns("src/api/x.ts", ["**/*.ts", "src/**", "docs/**"])).toEqual(["**/*.ts", "src/**"]);
  });
});

describe("globSpecificity", () => {
  it("counts literal and wildcard segments", () => {
    expect(globSpecificity("src/api/**/*.ts")).toEqual({
      literalSegments: 2,
      wildcardSegments: 2,
      hasGlobstar: true,
      length: 15,
    });
  });

  it("treats a braced segment as a wildcard", () => {
    expect(globSpecificity("src/*.{ts,tsx}").wildcardSegments).toBe(1);
  });
});

describe("compareGlobSpecificity", () => {
  it("ranks more literal segments as more specific", () => {
    expect(compareGlobSpecificity("src/**", "src/api/**")).toBeLessThan(0);
  });

  it("ranks a pattern without a globstar as more specific", () => {
    expect(compareGlobSpecificity("src/**", "src/*.ts")).toBeLessThan(0);
  });

  it("is a total order with a stable tiebreaker", () => {
    expect(compareGlobSpecificity("src/*.ts", "src/*.ts")).toBe(0);
    expect(compareGlobSpecificity("a/*.ts", "b/*.ts")).toBeLessThan(0);
  });

  it("sorts least specific first", () => {
    expect(sortByGlobSpecificity(["src/api/users/*.ts", "**/*.ts", "src/**", "src/api/**"])).toEqual([
      "**/*.ts",
      "src/**",
      "src/api/**",
      "src/api/users/*.ts",
    ]);
  });
});

describe("splitGlobList", () => {
  it("splits a comma-separated list", () => {
    expect(splitGlobList("**/*.ts,**/*.tsx")).toEqual(["**/*.ts", "**/*.tsx"]);
  });

  it("keeps a brace group intact", () => {
    expect(splitGlobList("src/**/*.{ts,tsx}")).toEqual(["src/**/*.{ts,tsx}"]);
  });

  it("splits between patterns while keeping their brace groups", () => {
    expect(splitGlobList("src/**/*.{ts,tsx}, lib/**/*.{js,mjs}")).toEqual(["src/**/*.{ts,tsx}", "lib/**/*.{js,mjs}"]);
  });

  it("keeps a bracket expression intact", () => {
    expect(splitGlobList("photos/[a,b]/*.png")).toEqual(["photos/[a,b]/*.png"]);
  });

  it("handles nested brace groups", () => {
    expect(splitGlobList("{a,{b,c}}/*.ts,x/*.ts")).toEqual(["{a,{b,c}}/*.ts", "x/*.ts"]);
  });

  it("does not split on whitespace, since a path may contain a space", () => {
    expect(splitGlobList("my folder/**/*.ts")).toEqual(["my folder/**/*.ts"]);
  });

  it("trims surrounding whitespace and drops empty entries", () => {
    expect(splitGlobList("  a/*.ts ,, b/*.ts  ,")).toEqual(["a/*.ts", "b/*.ts"]);
  });

  it("returns an empty list for an empty string", () => {
    expect(splitGlobList("")).toEqual([]);
  });

  it("tolerates an unbalanced brace rather than throwing", () => {
    expect(splitGlobList("src/{ts,tsx")).toEqual(["src/{ts,tsx"]);
  });
});
