import cluster from "node:cluster";
import { cpus } from "node:os";
import process from "node:process";
import app from "./app";
import { startInternalCreditApp } from "./modules/credit/internal-app";
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

if (process.env.NODE_ENV === "development") {
  app.listen(process.env.PORT || 3000);
  console.log(
    `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
  );
  startCreditSocket();
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
  } else {
    app.listen(process.env.PORT || 3000);

    console.log(
      `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
    );
  }
}
