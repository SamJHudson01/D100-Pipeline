import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

const DEV_SCOPE = "dev-supervisor";
const DEV_PORT = "3005";
const WORKER_DISABLE_ENV = "DISABLE_OPENROUTER_WORKER";
const SHUTDOWN_GRACE_MS = 5_000;

function logEvent(
  event: string,
  details: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({
      scope: DEV_SCOPE,
      event,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

function logError(
  event: string,
  details: Record<string, unknown> = {},
): void {
  console.error(
    JSON.stringify({
      scope: DEV_SCOPE,
      event,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

function spawnNodeProcess(name: string, args: string[]): ChildProcess {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  child.on("spawn", () => {
    logEvent("child_spawned", {
      name,
      pid: child.pid ?? null,
      args,
    });
  });

  child.on("error", (error) => {
    logError("child_error", {
      name,
      message: error.message,
    });
  });

  return child;
}

function killChild(child: ChildProcess | null, signal: NodeJS.Signals): void {
  if (!child?.pid || child.killed) {
    return;
  }

  try {
    child.kill(signal);
  } catch (error) {
    logError("child_kill_error", {
      pid: child.pid,
      signal,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function main(): Promise<void> {
  const nextBinPath = path.resolve(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  const workerScriptPath = path.resolve(process.cwd(), "scripts", "openrouter-worker.ts");
  const disableWorker = process.env[WORKER_DISABLE_ENV] === "1";

  logEvent("startup", {
    cwd: process.cwd(),
    nextBinPath,
    workerScriptPath,
    disableWorker,
  });

  const nextProcess = spawnNodeProcess("next-dev", [
    nextBinPath,
    "dev",
    "--port",
    DEV_PORT,
  ]);

  const workerProcess = disableWorker
    ? null
    : spawnNodeProcess("openrouter-worker", [
        "--experimental-strip-types",
        workerScriptPath,
      ]);

  if (disableWorker) {
    logEvent("worker_skipped", {
      reason: `${WORKER_DISABLE_ENV}=1`,
    });
  }

  let shuttingDown = false;

  const shutdown = (reason: string, exitCode = 0): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    process.exitCode = exitCode;
    logEvent("shutdown", {
      reason,
      exitCode,
    });

    killChild(workerProcess, "SIGTERM");
    killChild(nextProcess, "SIGTERM");

    setTimeout(() => {
      killChild(workerProcess, "SIGKILL");
      killChild(nextProcess, "SIGKILL");
    }, SHUTDOWN_GRACE_MS).unref();
  };

  process.on("SIGINT", () => shutdown("signal:SIGINT"));
  process.on("SIGTERM", () => shutdown("signal:SIGTERM"));

  nextProcess.on("exit", (code, signal) => {
    logEvent("child_exit", {
      name: "next-dev",
      code,
      signal,
    });

    if (!shuttingDown) {
      shutdown("next-dev exited", code ?? (signal ? 1 : 0));
    }
  });

  workerProcess?.on("exit", (code, signal) => {
    logEvent("child_exit", {
      name: "openrouter-worker",
      code,
      signal,
    });

    if (!shuttingDown) {
      logError("worker_stopped", {
        code,
        signal,
        message:
          "OpenRouter jobs will stay pending until the worker is restarted or run manually.",
      });
    }
  });
}

main().catch((error) => {
  logError("fatal_error", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
