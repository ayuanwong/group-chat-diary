import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildGroupEventTimeline, sanitizeEvidence } from "../../shared/group-event-timeline.mjs";
import { buildGroupChronicle } from "../../site/group-chronicle.mjs";

const siteHtml = readFileSync(new URL("../../site/index.html", import.meta.url), "utf8");
const syncScript = readFileSync(new URL("../sync_group_data.mjs", import.meta.url), "utf8");
const refreshScript = readFileSync(new URL("../refresh_group_day.sh", import.meta.url), "utf8");
const liveMigration = readFileSync(new URL("../../content-migrations/0003_live_group.sql", import.meta.url), "utf8");

function row(id, timestamp, sender, text) {
  return { id, timestamp, sender, side: sender === "少女阿原" ? "right" : "left", text, messageType: "文本" };
}

describe("group event timeline", () => {
  it("reconstructs release, discussion and official next steps in chronological order", () => {
    const rows = [
      row("v4-1", "2026-08-12T23:42:00+08:00", "成员甲", "DeepSeek V4 Pro 已开放 API，可以开始调用。"),
      row("v4-2", "2026-08-12T23:43:00+08:00", "成员乙", "开始试用 V4 Pro，重点看代码能力和速度。"),
      row("v4-3", "2026-08-12T23:44:00+08:00", "成员丙", "DeepSeek V4 Pro 实测效果很好，继续跑评测。"),
      row("v4-4", "2026-08-12T23:45:00+08:00", "成员丁", "V4 Pro 的 API 延迟和 token 消耗也需要继续观察。"),
      row("official", "2026-08-12T23:47:42+08:00", "Baymax", "今夜晚些时候会推送dsh的最后一个内测版本，0813计划发布dsh公测版，届时插件可以公开。"),
      row("response-1", "2026-08-12T23:47:50+08:00", "成员戊", "收到，开始改 DSH 插件兼容。"),
      row("response-2", "2026-08-12T23:48:10+08:00", "成员己", "DSH 仓库会补 #dsh topic。"),
    ];
    const officialChronicles = [{
      message_id: "official",
      event_key: "official:2026-08-12:plan:test",
      event_type: "plan",
      status: "planned",
      title: "官方计划与安排",
      timestamp: "2026-08-12T23:47:42+08:00",
      sender: "Baymax",
      quote: "今夜晚些时候会推送dsh的最后一个内测版本，0813计划发布dsh公测版，届时插件可以公开。",
      detail: "官方明确计划｜今夜晚些时候会推送dsh的最后一个内测版本，0813计划发布dsh公测版。",
    }, {
      message_id: "official",
      title: "官方计划与安排",
      timestamp: "2026-08-12T23:47:42+08:00",
      sender: "Baymax",
      quote: "今夜晚些时候会推送dsh的最后一个内测版本，0813计划发布dsh公测版。",
      detail: "旧摘要候选，与同一条正式事件重复。",
    }];

    const result = buildGroupEventTimeline(rows, { date: "2026-08-12", officialChronicles });

    expect(result.map((item) => item.title)).toEqual([
      expect.stringMatching(/V4.*实测|实测.*V4/u),
      "DSH最后一个内测版本与公测排期确定",
    ]);
    expect(result[0]).toMatchObject({
      relatedMessageCount: 4,
      speakerCount: 4,
    });
    expect(result[0].topics).toContain("DeepSeek V4 Pro");
    expect(result[0].summary).toContain("DeepSeek V4 Pro");
    expect(result[0].summary).toContain("连续交流");
    expect(result[1].summary).toContain("最后一个内测版本");
    expect(result[1].summary).toContain("2026-08-13");
    expect(result[1].milestones).toEqual([
      expect.objectContaining({ label: "最后一个内测版本确定" }),
      expect.objectContaining({ time: "2026-08-13", label: "公测发布节点明确" }),
    ]);
  });

  it("does not manufacture an event from a single mention and redacts sensitive evidence", () => {
    const result = buildGroupEventTimeline([
      row("single", "2026-08-10T12:00:00+08:00", "成员甲", "听说过 DeepSeek V4 Pro。"),
    ], { date: "2026-08-10" });
    expect(result).toEqual([]);
    expect(sanitizeEvidence("密钥是 abcdefghijk，路径 /Users/test/private/data，Bearer secret-token-value"))
      .toBe("密钥是 [凭据已脱敏]，路径 [本机路径]，Bearer [凭据已脱敏]");
    expect(sanitizeEvidence('<?xml version="1.0"?><msg antispamticket="secret" />'))
      .toBe("[微信消息元数据已脱敏]");
  });

  it("keeps one richer event when legacy and generated official entries share a source message", () => {
    const rows = [row("official", "2026-08-01T21:13:43+08:00", "Baymax", "DSH 新版本已发布并推送。")];
    const result = buildGroupEventTimeline(rows, {
      date: "2026-08-01",
      officialChronicles: [{
        message_id: "official",
        title: "内测版本更新",
        timestamp: rows[0].timestamp,
        sender: "Baymax",
        quote: "DSH 新版本已发布并推送。",
      }, {
        message_id: "official",
        event_key: "official:2026-08-01:release:test",
        event_type: "release",
        status: "completed",
        title: "版本与产品发布",
        timestamp: rows[0].timestamp,
        sender: "Baymax",
        quote: "DSH 新版本已发布并推送。",
      }],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: "DSH版本更新完成", eventType: "release" });
  });

  it("discovers unrelated daily topics without a fixed entity list", () => {
    const rows = [
      row("plugin-1", "2026-08-09T10:00:00+08:00", "成员甲", "插件签名校验在 Windows 上失败，先核对证书链。"),
      row("plugin-2", "2026-08-09T10:03:00+08:00", "成员乙", "插件签名的证书链我也复现了，Windows 安装会报错。"),
      row("plugin-3", "2026-08-09T10:06:00+08:00", "成员丙", "插件签名失败和证书链缓存有关，清理后恢复。"),
      row("plugin-4", "2026-08-09T10:08:00+08:00", "成员丁", "Windows 插件签名问题已记录，继续补测试。"),
      row("news-1", "2026-08-09T15:00:00+08:00", "成员戊", "芯片出口新规刚宣布，新闻里提到新的算力限制。"),
      row("news-2", "2026-08-09T15:03:00+08:00", "成员己", "芯片出口新规会影响算力采购，这条政策值得看。"),
      row("news-3", "2026-08-09T15:06:00+08:00", "成员庚", "新闻报道的芯片出口新规细则还要等正式文件。"),
      row("news-4", "2026-08-09T15:08:00+08:00", "成员辛", "芯片出口新规不只影响训练卡，推理卡也在讨论。"),
    ];

    const result = buildGroupEventTimeline(rows, { date: "2026-08-09", maximum: 6 });

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.title).join("\n")).toMatch(/插件签名|证书链|签名与证书|签名与插件兼容/u);
    expect(result.map((item) => item.title).join("\n")).toMatch(/芯片出口新规|算力限制/u);
    expect(result.every((item) => item.relatedMessageCount >= 4 && item.speakerCount >= 4)).toBe(true);
    expect(result.some((item) => item.eventType === "release")).toBe(false);
  });

  it("does not turn release questions or hearsay into a release event", () => {
    const rows = [
      row("rumor-1", "2026-08-09T20:00:00+08:00", "成员甲", "Nova 模型是不是发布了？"),
      row("rumor-2", "2026-08-09T20:02:00+08:00", "成员乙", "听说 Nova 模型可能出了，我还没看到公告。"),
      row("rumor-3", "2026-08-09T20:04:00+08:00", "成员丙", "Nova 模型真的发了吗？"),
      row("rumor-4", "2026-08-09T20:06:00+08:00", "成员丁", "Nova 模型貌似只是传闻。"),
    ];
    const result = buildGroupEventTimeline(rows, { date: "2026-08-09" });
    expect(result).toHaveLength(1);
    expect(result[0].eventType).not.toBe("release");
    expect(result[0].title).not.toContain("发布后");
  });

  it("keeps the stored event narrative instead of rebuilding abstract topics from selected signals", () => {
    const events = [{
      id: "event-1",
      timestamp: "2026-08-12T23:42:00+08:00",
      endTimestamp: "2026-08-12T23:48:00+08:00",
      title: "DeepSeek V4 Pro 发布并引发群内讨论",
      summary: "先发布，随后围绕能力和 API 展开讨论。",
      relatedMessageCount: 20,
      speakerCount: 12,
      topics: ["DeepSeek V4 Pro", "API 调用"],
      milestones: [{ time: "23:42", label: "发布信息出现", detail: "API 已可调用" }],
      quotes: [{ sender: "成员甲", time: "23:42", quote: "V4 Pro 已可调用。" }],
    }];
    const result = buildGroupChronicle(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: events[0].title,
      summary: events[0].summary,
      relatedMessageCount: 20,
      speakerCount: 12,
    });
    expect(result[0]).not.toHaveProperty("explanation");
    expect(result[0].summary).not.toContain("证据结构");
    expect(result[0].summary).not.toContain("一组发言在核对");
  });

  it("presents events newest first", () => {
    const result = buildGroupChronicle([
      { id: "later", timestamp: "2026-08-12T23:47:00+08:00", title: "后续决定", summary: "形成后续决定。" },
      { id: "earlier", timestamp: "2026-08-12T23:23:00+08:00", title: "先发生的发布", summary: "发布先发生。" },
    ]);
    expect(result.map((item) => item.id)).toEqual(["later", "earlier"]);
  });
});

describe("group chronicle live refresh", () => {
  it("keeps completed overview days separate from the latest Chronicle collection", () => {
    expect(liveMigration).toContain("content_active_live_group");
    expect(syncScript).toContain('const liveDate = argValue("--live-date")');
    expect(syncScript).toContain("INSERT INTO content_active_live_group");
    expect(syncScript).toContain("DELETE FROM content_active_group_days WHERE date >=");
    expect(syncScript).toContain("buildGroupEventTimeline(rows");
    expect(syncScript).toContain("group-day-v6-open-topic-timeline");
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
