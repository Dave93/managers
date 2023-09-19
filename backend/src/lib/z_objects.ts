import { z } from "zod";

/**
 * A Zod object schema representing a paginated response.
 * @property {number} [skip] - The number of items to skip.
 * @property {number} [take] - The number of items to take.
 * @property {string} [cursor] - The cursor to use for pagination.
 */
export const paginatedZodObj = z.object({
  skip: z.number().optional(),
  take: z.number().optional(),
  cursor: z.string().optional(),
});

export const UniqueReportsByDayInputSchema = z.object({
  date: z.string(),
  terminal_id: z.string(),
  time: z.string().nullish(),
});

export const UniqueReportsByDayOutputSchema = z.object({
  terminal_name: z.string(),
  terminal_id: z.string(),
  totalCashier: z.number(),
  editable: z.boolean(),
  incomes: z.array(
    z.object({
      type: z.string(),
      amount: z.number().nullish(),
      error: z.string().nullable(),
      readonly: z.boolean(),
      label: z.string(),
    })
  ),
  expenses: z.array(
    z.object({
      type: z.string(),
      amount: z.number().nullish(),
      error: z.string().nullable(),
      label: z.string(),
    })
  ),
});

export const UniqueSetReportDataInputSchema = z.object({
  date: z.string(),
  terminal_id: z.string(),
  incomes: z.array(
    z.object({
      type: z.string(),
      amount: z.number().nullish(),
      error: z.string().nullish(),
      readonly: z.boolean(),
      label: z.string(),
    })
  ),
  expenses: z.array(
    z.object({
      type: z.string(),
      amount: z.number().nullish(),
      error: z.string().nullish(),
      label: z.string(),
    })
  ),
});
