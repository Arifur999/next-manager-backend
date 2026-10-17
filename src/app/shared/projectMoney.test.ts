import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Role } from "../../generated/prisma/enums.js";
import { projectMoneyOmit } from "./projectMoney.js";

describe("projectMoneyOmit", () => {
    it("drops every money column for operations", () => {
        assert.deepEqual(projectMoneyOmit({ role: Role.operations }), {
            contract_value_usd: true,
            baseline_value_usd: true,
        });
    });

    it("keeps them for the roles that sell, run or own the work", () => {
        for (const role of [Role.admin, Role.sales, Role.project_manager]) {
            assert.equal(projectMoneyOmit({ role }), undefined, role);
        }
    });
});
