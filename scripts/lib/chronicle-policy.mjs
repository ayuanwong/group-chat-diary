import { createHash } from "node:crypto";
import {
  isOfficialChronicleItem,
  officialChronicleFromRecord,
  officialChronicleItems,
  officialChronicleKey,
} from "../../shared/official-chronicle.mjs";

export function isOfficialChronicle(item) {
  return isOfficialChronicleItem(item);
}

export function officialChronicles(items) {
  return officialChronicleItems(items);
}

export function chronicleReleaseKey(item) {
  return officialChronicleKey(item);
}

export function mergeOfficialChronicles(items, records) {
  const merged = new Map();
  for (const item of officialChronicles(items)) {
    const key = chronicleReleaseKey(item) ?? String(item.message_id ?? item.source_ref ?? "");
    if (key) merged.set(key, item);
  }
  for (const row of Array.isArray(records) ? records : []) {
    const item = officialChronicleFromRecord(row);
    if (!item) continue;
    item.source_ref = `sha256:${createHash("sha256").update(String(row.id ?? "")).digest("hex")}`;
    const key = chronicleReleaseKey(item) ?? item.message_id;
    const previous = merged.get(key);
    if (!previous || String(item.timestamp) < String(previous.timestamp ?? "")) merged.set(key, item);
  }
  return [...merged.values()].sort((left, right) => String(left.timestamp ?? "").localeCompare(String(right.timestamp ?? "")));
}

export function withoutRepeatedChronicles(items, previousItems) {
  const previousReleases = new Set(officialChronicles(previousItems).map(chronicleReleaseKey).filter(Boolean));
  return officialChronicles(items).filter((item) => {
    const key = chronicleReleaseKey(item);
    return !key || !previousReleases.has(key);
  });
}
