import { nomenclature_element, organization } from "backend/drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export interface ProductGroupsListDto {
    id: string;
    name: string | null;
    group_id: string;
    organization: InferSelectModel<typeof organization>[];
}