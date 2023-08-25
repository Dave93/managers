import {
  CredentialsSchema,
  OrganizationSchema,
  TerminalsSchema,
} from "@backend/lib/zod";
import { z } from "zod";

export const OrganizationWithCredentials = OrganizationSchema.extend({
  credentials: z.array(CredentialsSchema),
});

export const TerminalsWithCredentials = TerminalsSchema.extend({
  credentials: z.array(CredentialsSchema),
});
