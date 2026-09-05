import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { UserController } from "./user.controller.js";
import {
    createUserZodSchema,
    updateUserZodSchema,
} from "./user.validation.js";

const router = Router();

// Sales sees a DIRECTORY here, not the management view: the service picks a
// narrower projection for them, with no permissions and no status on it.
// Everybody in a company reads the directory. Who is allowed to CHANGE
// somebody stays admin-only below; the service hands anybody who is not admin
// or project_manager a projection with no permissions and no status on it, and
// that narrowing is what makes opening this safe.
router.get(
    "/",
    checkAuth(Role.admin, Role.project_manager, Role.sales, Role.operations),
    UserController.getAllUsers
);
router.get("/:id", checkAuth(Role.admin, Role.project_manager), UserController.getSingleUser);
router.post("/", checkAuth(Role.admin), validateRequest(createUserZodSchema), UserController.createUser);
router.patch("/:id", checkAuth(Role.admin), validateRequest(updateUserZodSchema), UserController.updateUser);
router.delete("/:id", checkAuth(Role.admin), UserController.deleteUser);


export const UserRoutes = router;
