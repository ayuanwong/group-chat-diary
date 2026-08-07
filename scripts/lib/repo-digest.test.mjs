import { describe, expect, it } from "vitest";
import { buildRepositoryDigest, enrichRepository } from "./repo-digest.mjs";

const NOW = "2026-08-07T12:00:00.000Z";

function repository(overrides = {}) {
  return {
    id: 1,
    name: "dsh-browser",
    fullName: "dsh-external/dsh-browser",
    description: "Chrome 侧边栏浏览器插件",
    archived: false,
    disabled: false,
    createdAt: "2026-08-06T09:00:00.000Z",
    pushedAt: "2026-08-07T10:00:00.000Z",
    topics: [],
    latestCommit: {
      sha: "a".repeat(40),
      headline: "feat: 支持语义定位点击",
      committedAt: "2026-08-07T10:00:00.000Z",
    },
    ...overrides,
  };
}

describe("Repo digest", () => {
  it("turns GitHub metadata into a source-backed explanation", () => {
    const result = enrichRepository(repository(), NOW);
    expect(result).toMatchObject({
      category: "browser-media",
      categoryName: "浏览器、文件与多模态",
      summary: "Chrome 侧边栏浏览器插件",
      activity: "24 小时内更新：feat: 支持语义定位点击",
      explanationSource: "GitHub 仓库说明、状态与默认分支最新提交",
    });
    expect(result.why).toContain("真实网页、图片和本地文件任务");
    expect(result.attention.label).toBe("优先看");
  });

  it("uses the latest commit when GitHub has no repository description", () => {
    const result = enrichRepository(repository({ description: null }), NOW);
    expect(result.summary).toBe("GitHub 暂未填写仓库说明；最新提交是「feat: 支持语义定位点击」。");
  });

  it("groups every repository exactly once and ranks active repositories first", () => {
    const digest = buildRepositoryDigest([
      repository(),
      repository({
        id: 2,
        name: "session-chatlog",
        fullName: "dsh-external/session-chatlog",
        description: "会话聊天记录读取工具",
        createdAt: "2026-08-04T10:00:00.000Z",
        pushedAt: "2026-08-06T10:00:00.000Z",
        latestCommit: { sha: "b".repeat(40), headline: "docs: 补充使用说明", committedAt: "2026-08-06T10:00:00.000Z" },
      }),
      repository({
        id: 3,
        name: "dsh-desktop",
        fullName: "dsh-external/dsh-desktop",
        description: "旧桌面端原型",
        archived: true,
        latestCommit: null,
      }),
    ], NOW);
    expect(digest.repositories).toHaveLength(3);
    expect(digest.groups.reduce((sum, group) => sum + group.count, 0)).toBe(3);
    expect(digest.quality.groupedOnce).toBe(true);
    expect(digest.repositories.at(-1)?.attention.label).toBe("历史参考");
    expect(digest.highlights).not.toContain(3);
  });

  it("recognizes underscore crawlers and generic UI repositories", () => {
    expect(enrichRepository(repository({ name: "ds_web_craw", description: "" }), NOW).category).toBe("browser-media");
    expect(enrichRepository(repository({ name: "turtle-ui", description: "" }), NOW).category).toBe("experience");
  });
});
