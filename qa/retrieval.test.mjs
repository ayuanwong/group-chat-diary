import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus, retrieveCorpus, tokenize } from "./retrieval.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("private QA corpus retrieval", () => {
  it("tokenizes Chinese and technical terms without sending data anywhere", () => {
    const tokens = tokenize("插件 MCP 与 Agent 的最新反馈");
    expect(tokens).toContain("插件");
    expect(tokens).toContain("mcp");
    expect(tokens).toContain("agent");
  });

  it("loads the complete private corpus and retrieves both source families", async () => {
    const corpus = await loadCorpus(root);
    expect(corpus.stats.messageCount).toBe(13_078);
    expect(corpus.stats.issueCount).toBe(357);
    const result = retrieveCorpus(corpus, "插件与 Issue 反馈");
    expect(result.sources.some((source) => source.kind === "group")).toBe(true);
    expect(result.sources.some((source) => source.kind === "issue")).toBe(true);
    expect(result.context).toContain("[G1]");
    expect(result.context).toContain("[I1]");
  });

  it("ranks explicit changelogs above member questions for version-update queries", async () => {
    const corpus = await loadCorpus(root);
    const result = retrieveCorpus(corpus, "最近版本更新", { groupLimit: 3, issueLimit: 1 });
    expect(result.sources[0]?.kind).toBe("group");
    expect(result.sources[0]?.label).toContain("Baymax");
    expect(result.sources[0]?.label).toContain("2026-08-06");
    expect(result.sources[0]?.excerpt).toMatch(/Changelog|新增|修复|优化/u);
  });
});
