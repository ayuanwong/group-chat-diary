import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildGroupChronicle } from "../../site/group-chronicle.mjs";

const siteHtml = readFileSync(new URL("../../site/index.html", import.meta.url), "utf8");
const syncScript = readFileSync(new URL("../sync_group_data.mjs", import.meta.url), "utf8");
const refreshScript = readFileSync(new URL("../refresh_group_day.sh", import.meta.url), "utf8");
const liveMigration = readFileSync(new URL("../../content-migrations/0003_live_group.sql", import.meta.url), "utf8");

describe("group chronicle timeline", () => {
  it("splits different topics inside one Beijing day period and sorts newest first", () => {
    const result = buildGroupChronicle([
      {
        message_id: "morning-1",
        timestamp: "2026-08-10T09:15:00+08:00",
        sender: "成员甲",
        text: "上午讨论插件安装。",
        topics: ["插件与生态"],
        score: 8,
      },
      {
        message_id: "evening-1",
        timestamp: "2026-08-10T18:12:00+08:00",
        sender: "成员乙",
        text: "晚间先核对 Issue 状态。↳ 回复 某成员：不应进入代表性原话。",
        topics: ["Issue 与协作", "产品体验"],
        score: 9,
      },
      {
        message_id: "evening-2",
        timestamp: "2026-08-10T22:10:00+08:00",
        sender: "成员丙",
        text: "补充 Web UI 的复现步骤。",
        topics: ["Web UI", "Issue 与协作"],
        score: 10,
      },
      {
        message_id: "prior-day",
        timestamp: "2026-08-09T23:55:00+08:00",
        sender: "成员丁",
        text: "前一天的模型调用讨论。",
        topics: ["模型与调用"],
        score: 7,
      },
    ]);

    expect(result).toHaveLength(4);
    expect(result.map((item) => item.timeRange)).toEqual([
      "2026-08-10 · 晚间 22:10",
      "2026-08-10 · 晚间 18:12",
      "2026-08-10 · 上午 09:15",
      "2026-08-09 · 晚间 23:55",
    ]);
    expect(result[0]).toMatchObject({
      title: "Web UI复现步骤与定位证据被补全",
      signalCount: 1,
      speakerCount: 1,
      topics: ["Web UI · 复现与定位"],
    });
    expect(result[0].explanation).not.toBe(result[0].title);
    expect(result[1].topics).toEqual(["Issue / PR · 协作与流转"]);
    expect(result[1].quotes[0]?.quote).toBe("晚间先核对 Issue 状态。");
  });

  it("uses distinct speakers first and skips unusable records", () => {
    const result = buildGroupChronicle([
      { message_id: "a1", time: "2026-08-10 13:00", sender: "成员甲", text: "高分发言", cat: "产品体验", score: 10 },
      { message_id: "a2", time: "2026-08-10 13:20", sender: "成员甲", text: "同成员第二条", cat: "产品体验", score: 9 },
      { message_id: "b1", time: "2026-08-10 14:00", sender: "成员乙", text: "另一位成员", cat: "产品体验", score: 8 },
      { message_id: "invalid-time", time: "not-a-time", sender: "成员丙", text: "无效时间", cat: "产品体验", score: 20 },
      { message_id: "empty", time: "2026-08-10 14:30", sender: "成员丁", text: "", cat: "产品体验", score: 20 },
    ], { maxQuotes: 2 });

    expect(result).toHaveLength(1);
    expect(result[0].quotes.map((quote) => quote.sender)).toEqual(["成员甲", "成员乙"]);
    expect(result[0]).toMatchObject({
      title: "产品体验需求与使用反馈被提出",
      signalCount: 3,
      speakerCount: 2,
      topics: ["产品体验 · 需求与反馈"],
    });
  });

  it("uses fine-grained categories while keeping title and explanation semantically distinct", () => {
    const result = buildGroupChronicle([
      {
        message_id: "tui-failure",
        timestamp: "2026-08-10T00:10:00+08:00",
        sender: "成员甲",
        text: "TUI 越用越卡，内存最后会爆掉。",
        topics: ["CLI/TUI", "性能稳定性"],
        score: 10,
      },
      {
        message_id: "tui-evidence",
        timestamp: "2026-08-10T00:22:00+08:00",
        sender: "成员乙",
        text: "实测 TUI 进程内存占用正常，没有出现写放大。",
        topics: ["CLI/TUI", "性能稳定性"],
        score: 9,
      },
      {
        message_id: "plugin-release",
        timestamp: "2026-08-10T01:40:00+08:00",
        sender: "成员丙",
        text: "插件 dsh-demo 已经发布，欢迎安装试用。",
        topics: ["插件与生态"],
        score: 8,
      },
    ]);

    expect(result).toHaveLength(2);
    expect(new Set(result.map((item) => item.title)).size).toBe(2);
    expect(result.every((item) => item.topics.every((topic) => topic.includes(" · ")))).toBe(true);
    expect(result.every((item) => item.explanation !== item.title)).toBe(true);
    expect(result.every((item) => !item.explanation.startsWith("讨论主要围绕"))).toBe(true);
    expect(result.find((item) => item.title.includes("相反实测"))?.signalCount).toBe(2);
  });

  it("explains parallel concerns with evidence instead of repeating category labels", () => {
    const result = buildGroupChronicle([
      {
        message_id: "plugin-compatibility",
        timestamp: "2026-08-10T18:10:00+08:00",
        sender: "成员甲",
        text: "插件在不同环境和版本下需要适配。",
        topics: ["插件与生态"],
        score: 10,
      },
      {
        message_id: "plugin-access",
        timestamp: "2026-08-10T18:30:00+08:00",
        sender: "成员乙",
        text: "建议明确插件访问资格和权限边界。",
        topics: ["插件与生态"],
        score: 9,
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("插件适配边界被核对，接入权限被说明");
    expect(result[0].title).not.toContain("出现两条主线");
    expect(result[0].title).not.toContain("同时聚焦");
    expect(result[0].explanation).toContain("一组发言在核对");
    expect(result[0].explanation).toContain("证据结构：2 条精选发言");
  });
});

describe("group chronicle live refresh", () => {
  it("keeps completed overview days separate from the latest Chronicle collection", () => {
    expect(liveMigration).toContain("content_active_live_group");
    expect(syncScript).toContain('const liveDate = argValue("--live-date")');
    expect(syncScript).toContain("INSERT INTO content_active_live_group");
    expect(syncScript).toContain("DELETE FROM content_active_group_days WHERE date >=");
    expect(refreshScript).toContain('--date "$TARGET_DATE" --live-date "$TODAY"');
    expect(refreshScript).toContain('：${TARGET_DATE}；纪事实时流');
    expect(siteHtml).toContain('"completed-days-plus-live"');
    expect(siteHtml).toContain('id="chronicleFreshness"');
    expect(siteHtml).toContain("最新采集至");
    expect(siteHtml).toContain("数据总览日期");
    expect(siteHtml).toContain("侧栏日期只影响数据总览");
    expect(siteHtml).toContain("const messageCount = state.history?.stats?.accepted_messages ?? 0;");
  });

  it("reloads a selected day when its active revision changes without coupling content polls to QA polls", () => {
    expect(siteHtml).toContain("const activeGroupDayRevision = (manifest, date) =>");
    expect(siteHtml).toContain("const selectedDayChanged = activeGroupDayRevision(nextManifest, SELECTED_DATE)");
    expect(siteHtml).toContain("if (datesChanged || selectedDayChanged)");
    expect(siteHtml).toContain("if (!liveContent || document.hidden || state.busy || checkingContentRevision) return;");
    expect(siteHtml).not.toContain("state.busy || qaState.busy || checkingContentRevision");
    expect(siteHtml).toContain("manifest.liveChronicle?.activatedAt ?? null");
    expect(siteHtml).toContain("setInterval(checkForContentUpdate, 60 * 1000);");
  });
});
