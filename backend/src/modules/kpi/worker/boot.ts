// Запуск расписания воркера. Без зарегистрированных расписаний процесс жив, но тихо ничего не делает
// (ни подметалки, ни напоминаний), поэтому провал регистрации завершает процесс: PM2 его перезапустит.
export function startScheduling(deps: {
  register: () => Promise<unknown>;
  catchUp: () => Promise<unknown>;
  log: (msg: string, e: unknown) => void;
  exit: (code: number) => void;
}): Promise<void> {
  return deps
    .register()
    .then(
      () =>
        // Процесс мог быть остановлен в 10:00: догоняем сразу; сбой догонялки не фатален, его повторит подметалка.
        deps.catchUp().catch((e) => deps.log("kpi worker: ежедневная задача при старте не удалась", e))
    )
    .then(
      () => undefined,
      (e) => {
        deps.log("kpi worker: регистрация расписания не удалась, выходим для перезапуска", e);
        deps.exit(1);
      }
    );
}
