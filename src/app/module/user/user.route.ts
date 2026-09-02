import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { UserController } from "./user.controller.js";
import {
    createUserZodSchema,
    setUserPermissionsZodSchema,
    updateUserZodSchema,
} from "./user.validation.js";

const router = Router();

// Sales sees a DIRECTORY here, not the management view: the service picks a
// narrower projection for them, with no permissions and no status on it.
router.get("/", checkAuth(Role.admin, Role.project_manager, Role.sales), UserController.getAllUsers);
router.get("/:id", checkAuth(Role.admin, Role.project_manager), UserController.getSingleUser);
router.post("/", checkAuth(Role.admin), validateRequest(createUserZodSchema), UserController.createUser);
router.patch("/:id", checkAuth(Role.admin), validateRequest(updateUserZodSchema), UserController.updateUser);
router.delete("/:id", checkAuth(Role.admin), UserController.deleteUser);


// What a colleague may do inside their role. Admin only, and its own route
// rather than a field on the user update: setting access is a deliberate act,
// and an empty list means something specific - everything the role allows.
router.patch(
    "/:id/permissions",
    checkAuth(Role.admin),
    validateRequest(setUserPermissionsZodSchema),
    UserController.setPermissions
);

export const UserRoutes = router;
