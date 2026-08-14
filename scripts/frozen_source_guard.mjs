#!/usr/bin/env node

import { enforceFixedArchive } from "./lib/frozen-archive-policy.mjs";

enforceFixedArchive(process.argv[2] || "档案");
