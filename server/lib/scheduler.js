/**
 * In-process background jobs. Each job runs on an interval; jobs that must not
 * overlap across app instances take their own advisory lock (see sync.js).
 * Errors are logged, never thrown, so one bad run can't take the server down.
 */
export function startScheduler(jobs, { log = console } = {}) {
  const timers = [];
  for (const job of jobs) {
    if (!job.everyMs) continue;
    const run = async () => {
      try {
        await job.run();
      } catch (err) {
        log.error(`[jobs] ${job.name} failed:`, err.message);
      }
    };
    // First run shortly after start-up, so a fresh deploy refreshes data.
    timers.push(setTimeout(run, job.firstRunMs ?? 30_000).unref());
    timers.push(setInterval(run, job.everyMs).unref());
  }
  return () => timers.forEach((t) => clearTimeout(t));
}
