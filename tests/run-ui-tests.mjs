import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";

const DB_FILE = resolve("backend/data/playwright-db.json");

let serverProcess;
let port;
let baseUrl;

function getFreePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/bootstrap`);
      if (response.ok) return;
    } catch {
      // The app server may still be binding the port.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
  }
  throw new Error("Playwright app server did not start");
}

function runPlaywright() {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, ["node_modules/playwright/cli.js", "test", "--global-timeout=120000"], {
      cwd: process.cwd(),
      env: { ...process.env, PLAYWRIGHT_BASE_URL: baseUrl },
      stdio: "inherit",
    });
    child.once("error", rejectRun);
    child.once("exit", (code) => resolveRun(code ?? 1));
  });
}

function stopServer() {
  return new Promise((resolveStop) => {
    if (!serverProcess || serverProcess.killed) {
      resolveStop();
      return;
    }
    const timer = setTimeout(() => {
      serverProcess.kill("SIGKILL");
      resolveStop();
    }, 3000);
    serverProcess.once("close", () => {
      clearTimeout(timer);
      resolveStop();
    });
    serverProcess.kill("SIGTERM");
  });
}

try {
  await rm(DB_FILE, { force: true });
  port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["backend/server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), DB_FILE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.on("data", (chunk) => process.stdout.write(chunk));
  serverProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForServer();
  const code = await runPlaywright();
  await stopServer();
  await rm(DB_FILE, { force: true });
  process.exitCode = code;
} catch (error) {
  await stopServer();
  await rm(DB_FILE, { force: true }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
}
