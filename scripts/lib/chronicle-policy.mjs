const OFFICIAL_PRODUCT_SENDERS = new Set(["Baymax"]);

const OFFICIAL_DSH_SUBJECT = /deepseek\s+harness|dsh(?:2026|-external)|snapshot-\d{8}|changelog\s+\d{4}-\d{2}-\d{2}|内测版代码|github\s+repo.{0,40}(?:新版本|推送)|issues\s+repo/iu;

export function isOfficialChronicle(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const sender = String(item.sender ?? "").trim();
  if (!OFFICIAL_PRODUCT_SENDERS.has(sender)) return false;
  const evidence = [item.title, item.quote, item.detail]
    .map((value) => String(value ?? ""))
    .join("\n");
  return OFFICIAL_DSH_SUBJECT.test(evidence);
}

export function officialChronicles(items) {
  return Array.isArray(items) ? items.filter(isOfficialChronicle) : [];
}
