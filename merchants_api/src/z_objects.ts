import { z } from "zod";

export const paymeReportInputSchema = z.object({
  date: z.string(),
  serviceIds: z.array(z.string()),
  businessId: z.string(),
  time: z.string().nullish(),
});

export const clickReportInputSchema = z.object({
  date: z.string(),
  serviceIds: z.array(z.string()),
  time: z.string().nullish(),
});

export const yandexReportInputSchema = z.object({
  date: z.string(),
  serviceIds: z.array(z.string()),
  organization_code: z.string(),
  time: z.string().nullish(),
});

export const iikoCachierReportInputSchema = z.object({
  date: z.string(),
  groupId: z.string(),
});

export const expressReportInputSchema = z.object({
  date: z.string(),
  terminal_id: z.string(),
  organization_code: z.string(),
  time: z.string().nullish(),
});

export const arrytReportInputSchema = z.object({
  date: z.string(),
  terminal_id: z.string(),
  time: z.string().nullish(),
});
