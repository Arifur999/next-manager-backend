-- DropIndex
DROP INDEX "platform_settings_default_plan_id_idx";

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "overdue_notified_at" TIMESTAMP(3);

-- RenameIndex
ALTER INDEX "kpi_targets_organization_id_user_id_metric_period_period_sta_ke" RENAME TO "kpi_targets_organization_id_user_id_metric_period_period_st_key";
