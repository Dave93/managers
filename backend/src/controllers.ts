import Elysia from "elysia";
import { ApiTokensController } from "./modules/api_tokens/controllers";
import { usersController } from "./modules/users/controller";
import { credentialsController } from "./modules/credentials/controller";
import { organizationController } from "./modules/organization/controller";
import { permissionsController } from "./modules/permissions/controller";
import { reportsController } from "./modules/reports/controller";
import { reportsItemsController } from "./modules/reports_items/controller";
import { reportsStatusController } from "./modules/reports_status/controller";
import { rolesController } from "./modules/roles/controller";
import { rolesPermissionsController } from "./modules/roles_permissions/controller";
import { scheduledReportsController } from "./modules/scheduled_reports/controller";
import { sessionController } from "./modules/sessions/controller";
import { settingsController } from "./modules/settings/controller";
import { terminalsController } from "./modules/terminals/controller";
import { timesheetController } from "./modules/timesheet/controller";
import { usersPermissionsController } from "./modules/users_permissions/controller";
import { usersRolesController } from "./modules/users_roles/controller";
import { usersTerminalsController } from "./modules/users_terminals/controller";
import { usersWorkSchedulesController } from "./modules/users_work_schedules/controller";
import { workScheduleEntriesController } from "./modules/work_schedule_entries/controller";
import { workSchedulesController } from "./modules/work_schedules/controller";
import { stopListController } from "./modules/stoplist/controller";
import { usersSroresController } from "./modules/users_stores/controller";
import { invoicesController } from "./modules/invoices/controller";
import { invoiceItemsController } from "./modules/invoice_items/controller";
import { writeItemsOffController } from "./modules/writeoff_items/controller";
import { internalTransferOffController } from "./modules/internal_transfer/controller";
import { internalTransferItemsController } from "./modules/internal_transfer_items/controller";
import { productGroupsController } from "./modules/product_groups/controller";
import { nomenclatureElementOrganizationController } from "./modules/nomenclature_element_organization/controller";
import { reportOlapController } from "./modules/report_olap/controller";

export const apiController = new Elysia({
  name: "@api",
  prefix: "/api",
})
  .use(ApiTokensController)
  .use(usersController)
  .use(credentialsController)
  .use(organizationController)
  .use(permissionsController)
  .use(reportsController)
  .use(reportsItemsController)
  .use(reportsStatusController)
  .use(rolesController)
  .use(rolesPermissionsController)
  .use(scheduledReportsController)
  .use(sessionController)
  .use(settingsController)
  .use(terminalsController)
  .use(timesheetController)
  .use(usersPermissionsController)
  .use(usersRolesController)
  .use(usersTerminalsController)
  .use(usersWorkSchedulesController)
  .use(workScheduleEntriesController)
  .use(workSchedulesController)
  .use(stopListController)
  .use(usersSroresController)
  .use(invoicesController)
  .use(invoiceItemsController)
  .use(writeItemsOffController)
  .use(internalTransferOffController)
  .use(internalTransferItemsController)
  .use(productGroupsController)
  .use(nomenclatureElementOrganizationController)
  .use(reportOlapController);
