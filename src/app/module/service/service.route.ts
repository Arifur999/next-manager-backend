import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { ServiceController } from "./service.controller.js";
import {
    createServiceCategoryZodSchema,
    createServiceTemplateZodSchema,
    createServiceZodSchema,
    updateServiceCategoryZodSchema,
    updateServiceTemplateZodSchema,
    updateServiceZodSchema,
} from "./service.validation.js";

const router = Router();

// Readable by anyone who raises an invoice or opens a project - the catalogue
// is a picker on both. Shaped by admin and sales, who are the two roles that
// decide what the agency sells and for how much.
const seller = [Role.admin, Role.sales] as const;

// Specific paths before "/:id", or "categories" is read as a service id.
router.get("/categories", checkAuth(), requireCompany, ServiceController.getCategories);
router.post(
    "/categories",
    checkAuth(...seller),
    validateRequest(createServiceCategoryZodSchema),
    ServiceController.createCategory
);
router.patch(
    "/categories/:id",
    checkAuth(...seller),
    validateRequest(updateServiceCategoryZodSchema),
    ServiceController.updateCategory
);
router.delete("/categories/:id", checkAuth(Role.admin), ServiceController.deleteCategory);

router.get("/templates", checkAuth(), requireCompany, ServiceController.getTemplates);
router.post(
    "/templates",
    checkAuth(...seller),
    validateRequest(createServiceTemplateZodSchema),
    ServiceController.createTemplate
);
router.patch(
    "/templates/:id",
    checkAuth(...seller),
    validateRequest(updateServiceTemplateZodSchema),
    ServiceController.updateTemplate
);
router.delete("/templates/:id", checkAuth(Role.admin), ServiceController.deleteTemplate);

// What each service has been billed. Money, so admin alone.
router.get("/revenue", checkAuth(Role.admin), requireCompany, ServiceController.getRevenue);

router.get("/", checkAuth(), requireCompany, ServiceController.getServices);
router.post(
    "/",
    checkAuth(...seller),
    validateRequest(createServiceZodSchema),
    ServiceController.createService
);
router.patch(
    "/:id",
    checkAuth(...seller),
    validateRequest(updateServiceZodSchema),
    ServiceController.updateService
);
// Deleting is refused once anything has been billed against it, so this only
// ever removes a catalogue entry nobody used. Admin-only regardless.
router.delete("/:id", checkAuth(Role.admin), ServiceController.deleteService);

export const ServiceRoutes = router;
