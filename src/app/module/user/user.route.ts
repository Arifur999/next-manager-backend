import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { UserController } from "./user.controller.js";
import { createUserZodSchema, updateUserZodSchema } from "./user.validation.js";

const router = Router();

router.get("/", checkAuth(Role.owner, Role.manager), UserController.getAllUsers);
router.get("/:id", checkAuth(Role.owner, Role.manager), UserController.getSingleUser);
router.post("/", checkAuth(Role.owner), validateRequest(createUserZodSchema), UserController.createUser);
router.patch("/:id", checkAuth(Role.owner), validateRequest(updateUserZodSchema), UserController.updateUser);
router.delete("/:id", checkAuth(Role.owner), UserController.deleteUser);

export const UserRoutes = router;
