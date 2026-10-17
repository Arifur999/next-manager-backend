import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { taskListQueryZodSchema } from "./task.validation.js";

describe("taskListQueryZodSchema", () => {
    it("reads unassigned=true as the flag, and anything else as off", () => {
        assert.equal(taskListQueryZodSchema.parse({ unassigned: "true" }).unassigned, true);
        for (const unassigned of [undefined, "", "false", "1"]) {
            assert.equal(taskListQueryZodSchema.parse({ unassigned }).unassigned, false, `unassigned=${unassigned}`);
        }
    });

    it("keeps a status name as typed, for the service to match case-insensitively", () => {
        assert.equal(taskListQueryZodSchema.parse({ status: "In Progress" }).status, "In Progress");
    });

    it("treats an empty status as no filter and refuses one past 60 characters", () => {
        assert.equal(taskListQueryZodSchema.parse({ status: "" }).status, undefined);
        assert.equal(taskListQueryZodSchema.safeParse({ status: "x".repeat(61) }).success, false);
    });
});
