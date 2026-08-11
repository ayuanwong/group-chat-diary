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
      basis: "官方账号完成态 Changelog 原话",
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
});
