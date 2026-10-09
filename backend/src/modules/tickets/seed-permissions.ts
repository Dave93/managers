import { drizzleDb } from "../../lib/db";
import { permissions } from "backend/drizzle/schema";
import { eq, sql } from "drizzle-orm";

// description — varchar(60), длиннее не влезет.
//
// Описание права — единственное, что видит человек в редакторе ролей, когда
// решает, что выдать. tickets.list_all снимает ограничение по филиалам во всех
// действиях с заявками (включая решения по оплате, приём, возврат и отмену), а
// не только в просмотре, и текст должен говорить об этом прямо.
//
// Приём остальных seed-скриптов («существующее не трогаем», потому что текст
// мог поправить человек в админке) нарушен осознанно и только для двух прав,
// перечисленных в REFRESH_DESCRIPTION. Их прежние описания стали ложными: право
// перестало быть «разделом» и стало полномочием, а руками в продовую таблицу
// прав мы не лезем, поэтому без перезаписи деплой живую строку не исправил бы.
// Описания остальных шести прав правду не потеряли, и у сида нет причины их
// трогать. НЕ расширяйте список «для единообразия»: каждый код в нём — это
// право, у которого чужая ручная правка текста будет молча затёрта. Включайте
// туда код только когда его описание стало неверным по смыслу. Помимо
// description сид ничего в существующей строке не трогает (active, связи с
// ролями).
const REFRESH_DESCRIPTION = new Set(["tickets.list", "tickets.list_all"]);

const SLUGS: { slug: string; description: string }[] = [
  { slug: "tickets.create", description: "Заявки: создание с планшета" },
  { slug: "tickets.list", description: "Заявки: просмотр, комментарии; свои филиалы без list_all" },
  { slug: "tickets.close", description: "Заявки: приёмка и возврат в работу" },
  { slug: "tickets.cancel", description: "Заявки: отмена" },
  { slug: "tickets.list_all", description: "Заявки: все филиалы во всех действиях, вкл. оплату и приём" },
  { slug: "tickets.payment.approve", description: "Заявки: утверждение сумм" },
  { slug: "tickets.types.manage", description: "Заявки: типы и схемы полей" },
  { slug: "tickets.contractors.manage", description: "Заявки: фирмы и исполнители" },
];

async function main() {
  for (const s of SLUGS) {
    if (s.description.length > 60) throw new Error(`${s.slug}: description длиннее 60 знаков`);
  }
  for (const s of SLUGS) {
    const existing = await drizzleDb
      .select({ id: permissions.id, description: permissions.description })
      .from(permissions)
      .where(eq(permissions.slug, s.slug))
      .execute();
    if (existing.length) {
      if (REFRESH_DESCRIPTION.has(s.slug) && existing[0].description !== s.description) {
        await drizzleDb
          .update(permissions)
          .set({ description: s.description, updated_at: sql`now()` })
          .where(eq(permissions.id, existing[0].id))
          .execute();
        console.log(`updated ${s.slug} (description)`);
      } else {
        console.log(`skip ${s.slug} (exists)`);
      }
      continue;
    }
    await drizzleDb.insert(permissions).values({ slug: s.slug, description: s.description, active: true }).execute();
    console.log(`inserted ${s.slug}`);
  }
  console.log("done");
  process.exit(0);
}

main();
