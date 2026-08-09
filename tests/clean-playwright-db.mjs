import { rm } from "node:fs/promises";
import { resolve } from "node:path";

await rm(resolve("backend/data/playwright-db.json"), { force: true });
