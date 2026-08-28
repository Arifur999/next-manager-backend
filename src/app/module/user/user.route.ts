import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { UserController } from "./user.controller.js";
import { createUserZodSchema, updateUserZodSchema } from "./user.validation.js";

const router = Router();

router.get("/", checkAuth(Role.admin, Role.project_manager), UserController.getAllUsers);
router.get("/:id", checkAuth(Role.admin, Role.project_manager), UserController.getSingleUser);
router.post("/", checkAuth(Role.admin), validateRequest(createUserZodSchema), UserController.createUser);
router.patch("/:id", checkAuth(Role.admin), validateRequest(updateUserZodSchema), UserController.updateUser);
router.delete("/:id", checkAuth(Role.admin), UserController.deleteUser);

export const UserRoutes = router;
