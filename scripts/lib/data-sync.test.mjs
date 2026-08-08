import { describe, expect, it } from "vitest";
import { splitSqlText, sqlString } from "./data-sync.mjs";

describe("splitSqlText", () => {
  it("keeps every SQL literal below the configured byte budget", () => {
    const source = `${"群聊'消息🙂".repeat(4_000)}tail`;
    const chunks = splitSqlText(source, 2_000);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(source);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(sqlString(chunk), "utf8")).toBeLessThanOrEqual(2_002);
    }
  });

  it("returns one empty chunk for an empty value", () => {
    expect(splitSqlText("")).toEqual([""]);
  });

  it("rejects invalid byte budgets", () => {
    expect(() => splitSqlText("value", 0)).toThrow(/正整数/u);
  });
});
