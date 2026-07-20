import { describe, expect, it } from "bun:test";
import { buildSyncJob } from "./job";

describe("buildSyncJob", () => {
  it("строит jobId из type и date", () => {
    const job = buildSyncJob("writeoff", "2026-07-20");
    expect(job.name).toBe("writeoff-2026-07-20");
    expect(job.opts.jobId).toBe("writeoff-2026-07-20");
    expect(job.data).toEqual({ type: "writeoff", date: "2026-07-20" });
  });
  it("задаёт delay, attempts и backoff", () => {
    const job = buildSyncJob("internal_transfer", "2026-07-20");
    expect(job.opts.delay).toBe(30_000);
    expect(job.opts.attempts).toBe(5);
    expect(job.opts.backoff).toEqual({ type: "exponential", delay: 60_000 });
    expect(job.opts.removeOnComplete).toBe(true);
    expect(job.opts.removeOnFail).toEqual({ age: 3600 });
  });
});
