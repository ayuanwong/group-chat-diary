import { describe, expect, it } from "vitest";
import {
  FROZEN_MEMBER_REPRESENTATIVES,
  FROZEN_STAR_CARD_SOURCE,
} from "./member-star-representatives";

describe("frozen member star cards", () => {
  it("covers every reviewed member from the complete fixed corpus", () => {
    const entries = Object.entries(FROZEN_MEMBER_REPRESENTATIVES);
    const sampleNotes = entries.filter(([, value]) => value.category === "样本说明");
    const representatives = entries.filter(([, value]) => value.category !== "样本说明");

    expect(FROZEN_STAR_CARD_SOURCE).toMatchObject({
      policy: "frozen-full-corpus-individual-review",
      sourceMessageCount: 66_187,
      latestGroupDate: "2026-08-13",
      memberCount: 268,
      reviewedMemberCount: 268,
      candidateSentenceCount: 70_661,
      representativeCount: 205,
      sampleNoteCount: 63,
    });
    expect(entries).toHaveLength(FROZEN_STAR_CARD_SOURCE.memberCount);
    expect(representatives).toHaveLength(FROZEN_STAR_CARD_SOURCE.representativeCount);
    expect(sampleNotes).toHaveLength(FROZEN_STAR_CARD_SOURCE.sampleNoteCount);
  });

  it("publishes only self-contained, sanitized decisions", () => {
    const representatives = Object.values(FROZEN_MEMBER_REPRESENTATIVES)
      .filter((value) => value.category !== "样本说明");
    expect(representatives.every((value) => value.excerpt.trim().length >= 2)).toBe(true);
    expect(representatives.every((value) => !/[?？]\s*$/u.test(value.excerpt))).toBe(true);
    expect(representatives.every((value) =>
      !/file:\/\/\/|\/Users\/|github_pat_|gh[pousr]_|<msg\b|<appmsg\b|aeskey\s*=|local_id=/iu.test(value.excerpt))).toBe(true);
    expect(new Set(representatives.map((value) => value.excerpt)).size).toBe(representatives.length);
  });
});
