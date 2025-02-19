import dayjs from "dayjs";
import { main } from "./getOrders";
import { main as getOrderItems } from "./getOrderItems";
import db, { closeConnection } from "./dbconnection";
const FILE_PATH = "./date.json";
const MAX_RETRIES = 3; // Максимальное количество попыток для обработки даты

const fileContent = await Bun.file(FILE_PATH).text();
const datesJson = JSON.parse(fileContent);
const { dates } = datesJson;
let lastDate = dates[dates.length - 1];

const today = dayjs();
console.log(dayjs(lastDate).add(1, "day").format("YYYY-MM-DD"));
console.log(today.format("YYYY-MM-DD"));



while (dayjs().isAfter(dayjs(lastDate).add(1, "day"), "day")) {
    const nextDate = dayjs(lastDate).add(1, "day").format("YYYY-MM-DD");
    console.time(nextDate);

    let success = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            // Выполняем команды параллельно
            await Promise.all([
                main(nextDate, db),
                getOrderItems(nextDate, db),
            ]);

            console.timeEnd(nextDate);
            dates.push(nextDate);
            await Bun.write(FILE_PATH, JSON.stringify({ dates }, null, 2));

            const result = await Bun.file("./date.json").json();
            let newDates = result.dates;
            lastDate = newDates[newDates.length - 1];
            success = true;
            break; // Выходим из цикла попыток, если успешны
        } catch (error) {
            console.error(
                `Error processing date ${nextDate} on attempt ${attempt}:`,
                error
            );

            if (attempt === MAX_RETRIES) {
                console.error(`Failed to process date ${nextDate} after ${MAX_RETRIES} attempts.`);
                process.exit(1); // Завершаем, если исчерпали все попытки
            } else {
                console.log(`Retrying date ${nextDate} (attempt ${attempt + 1})...`);
            }
        }
    }

    if (!success) {
        console.error(`Date ${nextDate} was not processed successfully.`);
        break; // Останавливаем цикл, если дата не обработана
    }
}

await closeConnection();
