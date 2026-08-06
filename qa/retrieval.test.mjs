import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultQaPlan, loadCorpus, normalizeQaPlan, retrieveCorpus, tokenize } from "./retrieval.mjs";

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
    const question = "0806 有什么内测版本更新";
    const plan = defaultQaPlan(question);
    expect(plan).toMatchObject({ intent: "release", source: "group", issueNumber: null });
    const result = retrieveCorpus(corpus, question, { plan, groupLimit: 3, issueLimit: 1 });
    expect(result.sources[0]?.kind).toBe("group");
    expect(result.sources[0]?.label).toContain("Baymax");
    expect(result.sources[0]?.label).toContain("2026-08-06");
    expect(result.sources[0]?.excerpt).toMatch(/Changelog|新增|修复|优化/u);
    expect(result.sources.every((source) => source.kind === "group")).toBe(true);
    expect(result.context.match(/^\d{4}-\d{2}-\d{2}T/gmu)).toHaveLength(result.sources.length);
  });

  it("routes speaker comparisons to balanced member profiles instead of literal phrase hits", async () => {
    const corpus = await loadCorpus(root);
    const question = "谁说话最有意思";
    const plan = defaultQaPlan(question);
    expect(plan).toMatchObject({ intent: "speaker", source: "group" });
    const result = retrieveCorpus(corpus, question, { plan });
    expect(result.sources.length).toBeGreaterThanOrEqual(8);
    expect(result.sources.every((source) => source.kind === "group" && source.label.includes("成员样本"))).toBe(true);
    expect(result.sources.filter((source) => source.excerpt.includes("有意思"))).toHaveLength(0);
    expect(result.context).toContain("按成员聚合后的平衡样本");
    expect(result.context).not.toContain("↳ 回复");
  });

  it("uses date-layered group samples for whole-corpus overview questions", async () => {
    const corpus = await loadCorpus(root);
    const question = "最近群里最关心的三个问题是什么？";
    const plan = normalizeQaPlan({ intent: "overview", source: "both", queries: ["问题 建议 实测"], days: 3 }, question);
    expect(plan.source).toBe("group");
    const result = retrieveCorpus(corpus, question, { plan });
    expect(result.sources).toHaveLength(3);
    expect(result.sources.every((source) => source.label.includes("群聊代表样本"))).toBe(true);
    expect(result.context).toContain("跨日期、跨成员");
  });
});
