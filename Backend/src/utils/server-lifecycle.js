export function configureServerLifecycle(server, pool, stopWorkers) {
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true;
    for (const stopWorker of stopWorkers) stopWorker();
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    server.close(async () => {
      await pool.end();
      clearTimeout(deadline);
    });
  }
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
