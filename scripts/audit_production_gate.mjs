import { auditProductionGate } from "./lib/production-gate.mjs";

try {
  const result = await auditProductionGate();
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  const reason = error?.name === "TimeoutError" || error?.cause?.code === "UND_ERR_CONNECT_TIMEOUT"
    ? "connect-timeout"
    : "network-or-response-error";
  console.error(JSON.stringify({ passed: false, failureLayer: "production-gate", reason }));
  process.exitCode = 1;
}
