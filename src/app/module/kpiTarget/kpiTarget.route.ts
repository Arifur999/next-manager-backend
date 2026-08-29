import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { KpiTargetController } from "./kpiTarget.controller.js";
import { createKpiTargetZodSchema, updateKpiTargetZodSchema } from "./kpiTarget.validation.js";

const router = Router();

// Readable by anyone signed in. A target kept from the person being measured
// against it is a number they cannot act on, which defeats the point.
router.get("/", checkAuth(), requireCompany, KpiTargetController.getAllTargets);

// Setting a target is committing the company to a number, so it stays with
// admin - a salesperson who can edit their own quota does not have one.
router.post(
    "/",
    checkAuth(Role.admin),
    validateRequest(createKpiTargetZodSchema),
    KpiTargetController.createTarget
);
router.patch(
    "/:id",
    checkAuth(Role.admin),
    validateRequest(updateKpiTargetZodSchema),
    KpiTargetController.updateTarget
);
router.delete("/:id", checkAuth(Role.admin), KpiTargetController.deleteTarget);

export const KpiTargetRoutes = router;
