import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const blockedContent = [
  /file:\/\/\//iu,
  /\/Users\/[^/]+\//u,
  /[A-Za-z]:\\Users\\[^\\]+\\/iu,
  /github_pat_[A-Za-z0-9_]+/u,
  /gh[pousr]_[A-Za-z0-9_]+/u,
  /\bsk-[A-Za-z0-9_-]{16,}\b/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /<msg\b|<appmsg\b|\baeskey\s*=/iu,
];

export function assertPrivateContent(text, label) {
  if (blockedContent.some((pattern) => pattern.test(text))) {
    throw new Error(`${label} 命中隐私或凭据保护规则；拒绝同步。`);
  }
}

export function sanitizeText(value) {
  const original = String(value ?? "").replace(/\r\n?/gu, "\n");
  return original
    .replace(/<\?xml[^>]*\?>/giu, "")
    .replace(/<msg\b[\s\S]*?<\/msg>/giu, "[微信引用内容已隐去]")
    .replace(/<msg\b[\s\S]*$/giu, "[微信引用内容已隐去]")
    .replace(/file:\/\/\/[^\s<>"'，。；)）]+/giu, "[本机文件地址已隐去]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu, "[私钥已隐去]")
    .replace(/(?<![\w:])\/Users\/[^\s<>"'，。；)）]+/giu, "[本机路径已隐去]")
    .replace(/\b[A-Za-z]:\\Users\\[^\s<>"'，。；)）]+/giu, "[本机路径已隐去]")
    .replace(/\/Users\//giu, "[本机路径已隐去]/")
    .replace(/[A-Za-z]:\\Users\\/giu, "[本机路径已隐去]\\")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/gu, "[GitHub 凭据已隐去]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/gu, "[GitHub 凭据已隐去]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/giu, "[API Key 已隐去]")
    .replace(/((?:api[_ -]?key|access[_ -]?token|bearer|secret|password|密码|口令)\s*(?:是|为|[:：=])\s*)([^\s,，;；]{6,})/giu, "$1[已隐去]")
    .replace(/[ \t]+$/gmu, "")
    .replace(/\n{4,}/gu, "\n\n\n")
    .trim();
}

export function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

export function d1Target() {
  return process.env.DSH_D1_TARGET === "local" ? "--local" : "--remote";
}

export function runWrangler(args, options = {}) {
  return run("npx", ["wrangler", ...args], options);
}

export function queryD1(binding, sql) {
  const output = runWrangler(["d1", "execute", binding, d1Target(), "--command", sql, "--json", "--yes"]);
  const payload = JSON.parse(output);
  return payload.flatMap((entry) => Array.isArray(entry.results) ? entry.results : []);
}

export function executeSqlFile(binding, sql, prefix = "dsh-data-") {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  const sqlFile = path.join(directory, "sync.sql");
  try {
    writeFileSync(sqlFile, sql, { encoding: "utf8", mode: 0o600 });
    try {
      return runWrangler(["d1", "execute", binding, d1Target(), "--file", sqlFile, "--yes"]);
    } catch (error) {
      const output = [error?.stdout, error?.stderr, error?.message].filter(Boolean).join("\n");
      // Large remote imports can finish successfully just before Wrangler's final
      // poll and return this transient state. Callers always verify staged rows
      // and counts before activating, so let that verification decide the result.
      if (d1Target() === "--remote"
        && /Processed\s+\d+\s+queries/iu.test(output)
        && /Not currently importing anything/iu.test(output)) return output;
      throw error;
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function sqlString(value) {
  return `'${String(value ?? "").replaceAll("\0", "").replaceAll("'", "''")}'`;
}

export function splitSqlText(value, maxEncodedBytes = 20_000) {
  if (!Number.isInteger(maxEncodedBytes) || maxEncodedBytes <= 0) {
    throw new Error("SQL 文本分块上限必须是正整数。");
  }
  const chunks = [];
  let chunk = "";
  let encodedBytes = 0;
  for (const character of String(value ?? "").replaceAll("\0", "")) {
    const characterBytes = Buffer.byteLength(character, "utf8") + (character === "'" ? 1 : 0);
    if (chunk && encodedBytes + characterBytes > maxEncodedBytes) {
      chunks.push(chunk);
      chunk = "";
      encodedBytes = 0;
    }
    chunk += character;
    encodedBytes += characterBytes;
  }
  if (chunk || !chunks.length) chunks.push(chunk);
  return chunks;
}

export function nullableString(value) {
  return value === null || value === undefined || value === "" ? "NULL" : sqlString(value);
}

export function nullableInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : "NULL";
}

export function trimText(value, limit = 900) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function hashJson(...values) {
  const hash = createHash("sha256");
  for (const value of values) hash.update(typeof value === "string" ? value : JSON.stringify(value));
  return hash.digest("hex").slice(0, 24);
}

export function insertStatements(table, columns, rows, maxRows = 30, maxCharacters = 80_000) {
  const statements = [];
  let chunk = [];
  let characters = 0;
  const flush = () => {
    if (!chunk.length) return;
    statements.push(`INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES\n${chunk.join(",\n")};`);
    chunk = [];
    characters = 0;
  };
  for (const row of rows) {
    if (chunk.length && (chunk.length >= maxRows || characters + row.length > maxCharacters)) flush();
    chunk.push(row);
    characters += row.length;
  }
  flush();
  return statements;
}
