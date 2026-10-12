import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { ExpenseCategoryController } from "./expenseCategory.controller.js";
import { createExpenseCategoryZodSchema, updateExpenseCategoryZodSchema } from "./expenseCategory.validation.js";
import { idParams } from "../../shared/requestSchemas.js";

const router = Router();

router.get("/", checkAuth(Role.admin), ExpenseCategoryController.getAllCategories);
router.post("/", checkAuth(Role.admin), validateRequest(createExpenseCategoryZodSchema), ExpenseCategoryController.createCategory);
router.patch("/:id", checkAuth(Role.admin), validateRequest({ params: idParams, body: updateExpenseCategoryZodSchema }), ExpenseCategoryController.updateCategory);
router.delete("/:id", checkAuth(Role.admin), validateRequest({ params: idParams }), ExpenseCategoryController.deleteCategory);

export const ExpenseCategoryRoutes = router;
