import cluster from "node:cluster";
import { cpus } from "node:os";
import process from "node:process";
import app from "./app";
import { startInternalCreditApp } from "./modules/credit/internal-app";
import { startCreditJobs } from "./modules/credit/jobs";
import { getCreditDb } from "./modules/credit/db";

// Start the credit internal unix-socket API exactly once regardless of how many
// HTTP workers this process forks below, and never let a credit-socket failure
// (missing DATABASE_URL, EACCES on the run/ dir, a stale socket file owned by
// another user, etc.) stop the public API from booting — the public HTTP surface
// is the more critical dependency and must come up regardless.
//
// Placement: two listeners bound to the same socket path would race (each
// unlink()s + listen()s the path; the second bind silently orphans the first's
// fd with no error, so connections would land unpredictably on whichever process
// bound last). Called from the cluster primary (which never serves HTTP itself)
// and from the dev branch (which never forks), never from the forked HTTP
// worker branch.
function startCreditSocket() {
  try {
    startInternalCreditApp(
      getCreditDb(),
      process.env.CREDIT_SOCKET_PATH ?? "/home/davr/managers/run/credit-internal.sock"
    );
  } catch (e) {
    console.error("credit internal socket failed to start; public API continues without it", e);
  }
}

// Same one-shot-per-process reasoning as startCreditSocket: BullMQ's repeatable
// jobs are registered by jobId, so a second startCreditJobs() call from a forked
// HTTP worker would just re-add the same repeatables (harmless) but would also
// spin up a redundant Worker consuming the same queue — never call this from the
// forked worker branch. A failure here (Redis down, bad connection config) must
// never stop the public API from booting, hence the try/catch.
function startCreditJobsSafe() {
  try {
    startCreditJobs(getCreditDb(), {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || "6379"),
      maxRetriesPerRequest: null,
    });
  } catch (e) {
    console.error("credit jobs failed to start; public API continues without them", e);
  }
}

if (process.env.NODE_ENV === "development") {
  app.listen(process.env.PORT || 3000);
  console.log(
    `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
  );
  startCreditSocket();
  startCreditJobsSafe();
} else {
  if (cluster.isPrimary) {
    console.log(`Primary ${process.pid} is running`);

    // Start N workers for the number of CPUs
    for (let i = 0; i < 2; i++) {
      cluster.fork();
    }

    cluster.on("exit", (worker, code, signal) => {
      console.log(`Worker ${worker.process.pid} exited`);
    });

    startCreditSocket();
    startCreditJobsSafe();
  } else {
    app.listen(process.env.PORT || 3000);

    console.log(
      `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
    );
  }
}
