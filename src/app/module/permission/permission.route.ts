import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { PermissionController } from "./permission.controller.js";
import {
    setRolePermissionZodSchema,
    setUserPermissionZodSchema,
} from "./permission.validation.js";

const router = Router();

// Deciding who may do what is the admin's alone, and always has been. Opening
// it to anybody else would let them widen themselves, which is the one thing a
// permission system must never allow.
const admin = [checkAuth(Role.admin), requireCompany] as const;

router.get("/", ...admin, PermissionController.getGrid);

router.patch(
    "/roles",
    ...admin,
    validateRequest(setRolePermissionZodSchema),
    PermissionController.setRolePermission
);

router.patch(
    "/users/:userId",
    ...admin,
    validateRequest(setUserPermissionZodSchema),
    PermissionController.setUserPermission
);

// Removing an override, so they inherit their role again. A delete rather than
// a write, because "inherits" is a different fact from "is set to the same
// thing the role happens to say today".
router.delete("/users/:userId/:module/:action", ...admin, PermissionController.clearUserPermission);

export const PermissionRoutes = router;
