import { describe, expect, it, vi } from "vitest";
import { contentGroupHistory } from "./content";

const payload = {
  version: 2,
  snapshotDate: "2026-08-12",
  group: {
    version: 3,
    source: { group: "【官方】DSH内测群" },
    stats: {
      source_messages: 5,
      accepted_messages: 5,
      excluded_messages: 0,
      date_start: "2026-08-12T23:20:00+08:00",
      date_end: "2026-08-12T23:50:00+08:00",
      type_breakdown: { 文本: 5 },
    },
    signals: [],
    chronicles: [],
    timeline: [
      { id: "event-later", timestamp: "2026-08-12T23:47:00+08:00", title: "后续决定", summary: "形成后续决定。" },
      { id: "event-earlier", timestamp: "2026-08-12T23:23:00+08:00", title: "先发生的发布", summary: "发布先发生。" },
    ],
    members: [{ name: "成员甲", count: 5, signals: 0, traits: [], self: false }],
  },
  publication: { status: "complete" },
  generatedAt: "2026-08-13T00:01:00.000Z",
};

function contentDb() {
  return {
    prepare: vi.fn((sql: string) => {
      const statement = {
        bind: vi.fn(() => statement),
        first: vi.fn(async () => null),
        all: vi.fn(async () => {
          if (sql.includes("FROM content_active_group_days")) return { results: [{
            date: "2026-08-12",
            ingest_id: "timeline-sync",
            generated_at: payload.generatedAt,
            source_message_count: 5,
            accepted_message_count: 5,
            signal_count: 0,
            participant_count: 1,
            chronicle_count: 0,
            payload: JSON.stringify(payload),
            activated_at: payload.generatedAt,
          }] };
          return { results: [] };
        }),
      };
      return statement;
    }),
  } as unknown as D1Database;
}

function qaDb() {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({ all: vi.fn(async () => ({ results: [] })) })),
      all: vi.fn(async () => ({ results: [] })),
    })),
  } as unknown as D1Database;
}

describe("content group event timeline", () => {
  it("returns stored complete-message events newest first", async () => {
    const history = await contentGroupHistory({ CONTENT_DB: contentDb(), QA_DB: qaDb() });
    expect(history).toMatchObject({
      stats: { timeline_event_count: 2 },
      timeline: [
        { id: "event-later", title: "后续决定" },
        { id: "event-earlier", title: "先发生的发布" },
      ],
    });
  });
});
