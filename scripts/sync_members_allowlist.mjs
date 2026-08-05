import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const organization = process.env.DSH_GITHUB_ORG || "dsh-external";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

let pages;
try {
  pages = JSON.parse(run("gh", [
    "api",
    "--paginate",
    "--slurp",
    `orgs/${organization}/members?filter=all&per_page=100`,
  ]));
} catch {
  throw new Error(`无法读取 ${organization} 的完整成员列表；白名单保持不变。`);
}

const members = [...new Map(
  pages
    .flat()
    .map((member) => [Number(member.id), String(member.login || "")])
    .filter(([id, login]) => Number.isSafeInteger(id) && id > 0 && login),
).entries()]
  .map(([githubId, login]) => ({ githubId, login }))
  .sort((left, right) => left.githubId - right.githubId);

if (members.length === 0) {
  throw new Error(`读取到的 ${organization} 成员列表为空；拒绝覆盖现有白名单。`);
}

const values = members
  .map(({ githubId, login }) => `(${githubId}, ${sqlString(login)}, 1, CURRENT_TIMESTAMP)`)
  .join(",\n");
const syncedAt = new Date().toISOString();
const sql = `
UPDATE access_allowlist SET active = 0, updated_at = CURRENT_TIMESTAMP;
INSERT INTO access_allowlist (github_id, login, active, updated_at)
VALUES
${values}
ON CONFLICT(github_id) DO UPDATE SET
  login = excluded.login,
  active = 1,
  updated_at = CURRENT_TIMESTAMP;
INSERT INTO access_sync_meta (key, value, updated_at)
VALUES ('last_sync_at', ${sqlString(syncedAt)}, CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;
INSERT INTO access_sync_meta (key, value, updated_at)
VALUES ('member_count', ${sqlString(members.length)}, CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;
`;

const temporaryDirectory = mkdtempSync(join(tmpdir(), "dsh-access-sync-"));
const sqlFile = join(temporaryDirectory, "sync.sql");
try {
  writeFileSync(sqlFile, sql, { encoding: "utf8", mode: 0o600 });
  run("npx", ["wrangler", "d1", "execute", "ACCESS_DB", "--remote", "--file", sqlFile, "--yes"], {
    stdio: "inherit",
  });
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log(`已同步 ${members.length} 位 ${organization} 成员到访问白名单。`);
