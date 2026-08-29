import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { LeadSourceController } from "./leadSource.controller.js";
import {
    createLeadSourceZodSchema,
    updateLeadSourceZodSchema,
} from "./leadSource.validation.js";

const router = Router();

// Sales curates its own list - these are the places sales lands work, and
// admin sees them because pipeline source feeds company reporting.
router.get("/", checkAuth(Role.admin, Role.sales), LeadSourceController.getAll);
router.post(
    "/",
    checkAuth(Role.admin, Role.sales),
    validateRequest(createLeadSourceZodSchema),
    LeadSourceController.create
);
router.patch(
    "/:id",
    checkAuth(Role.admin, Role.sales),
    validateRequest(updateLeadSourceZodSchema),
    LeadSourceController.update
);

// Deleting one is refused once leads point at it, so this only ever removes a
// list entry nobody used. Admin-only anyway: it is a reporting dimension.
router.delete("/:id", checkAuth(Role.admin), LeadSourceController.remove);

export const LeadSourceRoutes = router;
