import { describe, expect, it } from "vitest";
import { attachIssueReactions, githubThumbsUp } from "./issue-reactions.mjs";

describe("GitHub Issue reactions", () => {
  it("reads the +1 reaction and attaches it without changing Issue identity", () => {
    const result = attachIssueReactions(
      { version: 2, issues: [{ n: 47, title: "高赞反馈" }, { n: 48, title: "普通反馈" }] },
      [
        { number: 47, reactions: { "+1": 6, total_count: 6 } },
        { number: 48, reactions: { "+1": 0, total_count: 1 } },
      ],
    );
    expect(result.issues).toEqual([
      { n: 47, title: "高赞反馈", thumbs_up: 6 },
      { n: 48, title: "普通反馈", thumbs_up: 0 },
    ]);
    expect(result.reactions).toEqual({
      source: "github-api",
      metric: "+1",
      reacted_issue_count: 1,
      thumbs_up_total: 6,
    });
  });

  it("rejects a missing or invalid +1 field instead of publishing zeros", () => {
    expect(() => githubThumbsUp({ reactions: {} })).toThrow(/\+1 reaction/u);
    expect(() => githubThumbsUp({ reactions: { "+1": -1 } })).toThrow(/\+1 reaction/u);
    expect(() => attachIssueReactions({ issues: [{ n: 47 }] }, [])).toThrow(/#47 缺失/u);
  });
});
