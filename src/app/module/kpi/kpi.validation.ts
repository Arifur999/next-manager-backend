import z from "zod";
import { KPI_SCOPES } from "./kpi.service.js";

export const kpiScopeParams = z.object({
    scope: z.enum(KPI_SCOPES, `Unknown scope. Use one of: ${KPI_SCOPES.join(", ")}`),
});
