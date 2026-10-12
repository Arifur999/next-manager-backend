import { Router } from "express";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { KpiController } from "./kpi.controller.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { kpiScopeParams } from "./kpi.validation.js";

const router = Router();

// One route, four scopes. The scope itself carries the role check - it is
// decided in the service alongside the query that produces the numbers, so a
// scope cannot be added here without deciding who may read it.
router.get("/:scope", checkAuth(), requireCompany, validateRequest({ params: kpiScopeParams }), KpiController.getScope);

export const KpiRoutes = router;
