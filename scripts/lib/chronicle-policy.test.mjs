import { describe, expect, it } from "vitest";
import {
  chronicleReleaseKey,
  mergeOfficialChronicles,
  withoutRepeatedChronicles,
} from "./chronicle-policy.mjs";

function row(overrides = {}) {
  return {
    id: "message-1",
    sender: "Baymax",
    timestamp: "2026-08-09T22:37:16+08:00",
    text: "✨ 新增\n新增一项能力\n🐛 修复\n修复一个回归问题",
    ...overrides,
  };
}

function officialPost(overrides = {}) {
  return {
    id: "official-message",
    sender: "Baymax",
    timestamp: "2026-08-12T23:47:42+08:00",
    text: "DSH 已推送新的协作能力，现已可以使用。",
    ...overrides,
  };
}

describe("official chronicle policy", () => {
  it("uses the source natural day for a structured official update without a dated header", () => {
    const chronicles = mergeOfficialChronicles([], [row()]);

    expect(chronicles).toHaveLength(1);
    expect(chronicles[0]).toMatchObject({
      message_id: "message-1",
      sender: "Baymax",
      quote: "Changelog 2026-08-09",
      basis: "官方账号结构化更新原话 + 消息自然日",
    });
    expect(chronicles[0]?.detail).toContain("新增：新增一项能力");
    expect(chronicles[0]?.detail).toContain("修复：修复一个回归问题");
    expect(chronicleReleaseKey(chronicles[0])).toBe("changelog:2026-08-09");
  });

  it("keeps an explicit Changelog date authoritative", () => {
    const chronicles = mergeOfficialChronicles([], [row({
      text: "DeepSeek Harness Changelog 2026-08-08\n✨ 新增\n新增一项能力\n🐛 修复\n修复一个问题",
    })]);

    expect(chronicles[0]).toMatchObject({
      quote: "Changelog 2026-08-08",
      basis: "官方账号正式发布原话",
    });
  });

  it("does not broaden fallback matching to ordinary members and still deduplicates releases", () => {
    expect(mergeOfficialChronicles([], [row({ sender: "普通成员" })])).toEqual([]);

    const current = mergeOfficialChronicles([], [row()]);
    const previous = [{
      message_id: "previous-release",
      sender: "崔小天",
      title: "内测版本更新",
      quote: "Changelog 2026-08-09",
      detail: "DeepSeek Harness Changelog 2026-08-09",
    }];
    expect(withoutRepeatedChronicles(current, previous)).toEqual([]);
  });

  it("records formal official information without requiring a Changelog template", () => {
    const chronicles = mergeOfficialChronicles([], [officialPost()]);

    expect(chronicles).toHaveLength(1);
    expect(chronicles[0]).toMatchObject({
      message_id: "official-message",
      sender: "Baymax",
      title: "版本与产品发布",
      status: "completed",
      event_type: "release",
      official_provenance: "official-account",
    });
  });

  it("keeps explicit official plans as plans instead of claiming completion", () => {
    const chronicles = mergeOfficialChronicles([], [officialPost({
      text: "DSH 计划发布新的协作入口，时间安排已经明确。",
    })]);

    expect(chronicles).toHaveLength(1);
    expect(chronicles[0]).toMatchObject({
      title: "官方计划与安排",
      status: "planned",
      event_type: "plan",
    });
    expect(chronicles[0]?.detail).toContain("官方明确计划");
  });

  it("accepts curator announcements only when an official DSH repository proves provenance", () => {
    const official = mergeOfficialChronicles([], [officialPost({
      sender: "少女阿原",
      text: "正式发布 DSH 官方工具：https://github.com/dsh-external/example-tool",
    })]);
    const personal = mergeOfficialChronicles([], [officialPost({
      sender: "少女阿原",
      text: "正式发布个人工具：https://github.com/personal/example-tool",
    })]);

    expect(official).toHaveLength(1);
    expect(official[0]).toMatchObject({
      sender: "少女阿原",
      event_type: "repository",
      official_provenance: "official-repository",
    });
    expect(personal).toEqual([]);
  });

  it("does not promote curator questions or speculation about official repositories", () => {
    const question = officialPost({
      sender: "少女阿原",
      text: "https://github.com/dsh-external/issues/issues 发布前必修的 issue 还有哪些？",
    });
    const speculation = officialPost({
      id: "speculation",
      sender: "少女阿原",
      text: "https://github.com/dsh-external/issues/issues 大家看看，估计正式发布拖不了多久了。",
    });
    expect(mergeOfficialChronicles([], [question, speculation])).toEqual([]);
  });

  it("excludes questions, hearsay and ordinary member projects", () => {
    expect(mergeOfficialChronicles([], [officialPost({ text: "DSH 什么时候发布新的协作入口？" })])).toEqual([]);
    expect(mergeOfficialChronicles([], [officialPost({ text: "听说 DSH 可能会发布新的协作入口。" })])).toEqual([]);
    expect(mergeOfficialChronicles([], [officialPost({ sender: "普通成员" })])).toEqual([]);
  });
});
