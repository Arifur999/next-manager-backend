import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { ExpenseCategoryController } from "./expenseCategory.controller.js";
import { createExpenseCategoryZodSchema, updateExpenseCategoryZodSchema } from "./expenseCategory.validation.js";

const router = Router();

router.get("/", checkAuth(Role.owner, Role.admin, Role.manager), ExpenseCategoryController.getAllCategories);
router.post("/", checkAuth(Role.owner, Role.admin), validateRequest(createExpenseCategoryZodSchema), ExpenseCategoryController.createCategory);
router.patch("/:id", checkAuth(Role.owner, Role.admin), validateRequest(updateExpenseCategoryZodSchema), ExpenseCategoryController.updateCategory);
router.delete("/:id", checkAuth(Role.owner), ExpenseCategoryController.deleteCategory);

export const ExpenseCategoryRoutes = router;
