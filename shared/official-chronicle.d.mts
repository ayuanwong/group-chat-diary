export interface OfficialInformationClassification {
  date: string;
  sourceDate: string;
  status: "completed" | "planned" | "announced";
  eventType: "release" | "repository" | "notice" | "announcement" | "plan";
  title: string;
  provenance: "official-account" | "official-repository";
  explicitChangelog: boolean;
  structuredChangelog: boolean;
}

export function authoredOfficialText(value: unknown): string;
export function classifyOfficialInformation(row: object): OfficialInformationClassification | null;
export function isOfficialInformationRecord(row: object): boolean;
export function officialChronicleFromRecord(row: object): Record<string, unknown> | null;
export function isOfficialChronicleItem(value: unknown): value is Record<string, unknown>;
export function officialChronicleItems(value: unknown): Record<string, unknown>[];
export function officialChronicleKey(item: Record<string, unknown>): string | null;
