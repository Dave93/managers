// Единый источник «сейчас» для бизнес-логики KPI. Подмена времени работает
// только в тестовом окружении, в проде KPI_FAKE_NOW игнорируется.
export function now(): Date {
  const fake = process.env.KPI_FAKE_NOW;
  if (process.env.PROJECT_PREFIX === "managers_test_" && fake) return new Date(fake);
  return new Date();
}
