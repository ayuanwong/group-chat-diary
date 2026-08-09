function issueNumber(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error("Issue 编号无效。");
  return number;
}

export function githubThumbsUp(issue) {
  const count = Number(issue?.reactions?.["+1"]);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("GitHub Issue 缺少有效的 +1 reaction 数量。");
  }
  return count;
}

export function attachIssueReactions(classified, rawIssues) {
  if (!classified || !Array.isArray(classified.issues) || !Array.isArray(rawIssues)) {
    throw new Error("Issue 点赞合并输入格式错误。");
  }
  const rawByNumber = new Map();
  for (const rawIssue of rawIssues) {
    const number = issueNumber(rawIssue?.number);
    if (rawByNumber.has(number)) throw new Error(`GitHub Issue #${number} 重复。`);
    rawByNumber.set(number, rawIssue);
  }
  const issues = classified.issues.map((issue) => {
    const number = issueNumber(issue?.n);
    const rawIssue = rawByNumber.get(number);
    if (!rawIssue) throw new Error(`GitHub Issue #${number} 缺失。`);
    return { ...issue, thumbs_up: githubThumbsUp(rawIssue) };
  });
  const reactedIssueCount = issues.filter((issue) => issue.thumbs_up > 0).length;
  const thumbsUpTotal = issues.reduce((total, issue) => total + issue.thumbs_up, 0);
  return {
    ...classified,
    issues,
    reactions: {
      source: "github-api",
      metric: "+1",
      reacted_issue_count: reactedIssueCount,
      thumbs_up_total: thumbsUpTotal,
    },
  };
}
