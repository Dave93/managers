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
      // Дефолт pm2 (1600мс) не хватает на один в-полёте вызов Telegram API —
      // SIGTERM должен успеть дать worker.close() дождаться его завершения
      // (см. shutdown() в tickets_worker.ts), а не оборваться kill -9.
      kill_timeout: 10000,
    },
  ],
};
