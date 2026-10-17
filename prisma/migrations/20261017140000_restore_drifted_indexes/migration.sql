-- CreateIndex
CREATE INDEX "platform_settings_default_plan_id_idx" ON "platform_settings"("default_plan_id");

-- RenameIndex
ALTER INDEX "kpi_targets_organization_id_user_id_metric_period_period_st_key" RENAME TO "kpi_targets_organization_id_user_id_metric_period_period_sta_ke";
