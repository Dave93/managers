module.exports = {
  apps: [
    {
      name: "office_cron",
      script: "src/index.ts",
      interpreter: "bun",
    },
    {
      name: "iiko_document_worker",
      script: "iiko_document_worker.ts",
      interpreter: "bun",
    },
    {
      name: "office_tickets_worker",
      script: "tickets_worker.ts",
      interpreter: "bun",
    },
  ],
};
