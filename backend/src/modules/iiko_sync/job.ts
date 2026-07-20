export type SyncDocumentType = "writeoff" | "internal_transfer";

export function buildSyncJob(type: SyncDocumentType, date: string) {
  const jobId = `${type}-${date}`;
  return {
    name: jobId,
    data: { type, date },
    opts: {
      jobId,
      delay: 30_000,
      attempts: 5,
      backoff: { type: "exponential" as const, delay: 60_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  };
}
