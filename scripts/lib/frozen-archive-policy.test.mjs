import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const projectRoot = new URL("../../", import.meta.url);
const scriptsRoot = new URL("../", import.meta.url);
const guardedScripts = [
  "sync_group_data.mjs",
  "sync_github_data.mjs",
  "sync_qa_corpus.mjs",
  "export_group_day.mjs",
  "export_private_corpus.mjs",
];

describe("fixed archive mutation policy", () => {
  it("rejects ordinary archive writes before any data work starts", () => {
    const result = spawnSync(process.execPath, ["scripts/frozen_source_guard.mjs", "测试数据"], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("已固定封存");
  });

  it("guards every former group and GitHub writer at module entry", () => {
    for (const name of guardedScripts) {
      const source = readFileSync(new URL(name, scriptsRoot), "utf8");
      expect(source).toContain("enforceFixedArchive(");
      expect(source.indexOf("enforceFixedArchive(")).toBeLessThan(2_000);
    }
  });
});
