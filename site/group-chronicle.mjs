function cleanText(value, limit = 360) {
  const compact = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (!compact) return "";
  return Array.from(compact).length > limit
    ? `${Array.from(compact).slice(0, limit - 1).join("")}…`
    : compact;
}

function validTimestamp(value) {
  const timestamp = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(timestamp) ? timestamp : null;
}

function normalizedQuote(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sender = cleanText(value.sender, 56);
  const time = cleanText(value.time, 16);
  const quote = cleanText(value.quote, 220);
  return sender && time && quote ? { sender, time, quote } : null;
}

function normalizedMilestone(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const time = cleanText(value.time, 16);
  const label = cleanText(value.label, 80);
  const detail = cleanText(value.detail, 240);
  return time && label ? { time, label, detail } : null;
}

function normalizedEvent(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const timestamp = validTimestamp(value.timestamp);
  const title = cleanText(value.title, 120);
  const summary = cleanText(value.summary ?? value.explanation, 520);
  if (!timestamp || !title || !summary) return null;
  const date = timestamp.slice(0, 10);
  const startClock = timestamp.slice(11, 16);
  const endClock = validTimestamp(value.endTimestamp)?.slice(11, 16);
  return {
    id: cleanText(value.id, 180) || `${timestamp}:${index}`,
    date,
    timestamp,
    endTimestamp: validTimestamp(value.endTimestamp) ?? timestamp,
    timeRange: cleanText(value.timeRange, 80)
      || `${date} · ${endClock && endClock !== startClock ? `${startClock}–${endClock}` : startClock}`,
    eventType: cleanText(value.eventType, 32) || "observed",
    status: cleanText(value.status, 32) || "observed",
    title,
    summary,
    relatedMessageCount: Math.max(1, Number(value.relatedMessageCount ?? value.signalCount) || 1),
    speakerCount: Math.max(1, Number(value.speakerCount) || 1),
    topics: [...new Set((Array.isArray(value.topics) ? value.topics : []).map((item) => cleanText(item, 48)).filter(Boolean))].slice(0, 5),
    milestones: (Array.isArray(value.milestones) ? value.milestones : []).map(normalizedMilestone).filter(Boolean).slice(0, 5),
    quotes: (Array.isArray(value.quotes) ? value.quotes : []).map(normalizedQuote).filter(Boolean).slice(0, 4),
    evidenceBoundary: cleanText(value.evidenceBoundary, 120),
  };
}

export function buildGroupChronicle(events) {
  if (!Array.isArray(events)) return [];
  const deduped = new Map();
  events.forEach((value, index) => {
    const event = normalizedEvent(value, index);
    if (event && !deduped.has(event.id)) deduped.set(event.id, event);
  });
  return [...deduped.values()].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp) || left.title.localeCompare(right.title, "zh"),
  );
}
