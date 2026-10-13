// Бизнес-ошибка модуля: сервисы бросают её, контроллер превращает в
// HTTP-ответ { error: code, ...extra }. Всё остальное — настоящий 500.
export class InventoryError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(code);
  }
}

export async function run<T>(
  set: { status?: number | string },
  fn: () => Promise<T>
): Promise<T | { error: string; [k: string]: unknown }> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof InventoryError) {
      set.status = e.status;
      return { error: e.code, ...e.extra };
    }
    throw e;
  }
}
