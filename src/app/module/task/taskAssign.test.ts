import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assignRefusal } from "./taskAssign.js";

const caller = "user-caller";
const colleague = "user-colleague";

describe("assignRefusal", () => {
    it("lets 'all' hand a task to anybody", () => {
        assert.equal(assignRefusal("all", { assigneeId: colleague, callerId: caller, onProject: false }), null);
    });

    it("refuses every assignment at 'none', even to yourself or to nobody", () => {
        for (const assigneeId of [colleague, caller, null]) {
            assert.match(assignRefusal("none", { assigneeId, callerId: caller, onProject: true }) ?? "", /tasks — assign/);
        }
    });

    it("lets 'own' take a task or clear it, and nothing else", () => {
        assert.equal(assignRefusal("own", { assigneeId: caller, callerId: caller, onProject: false }), null);
        assert.equal(assignRefusal("own", { assigneeId: null, callerId: caller, onProject: false }), null);
        assert.match(assignRefusal("own", { assigneeId: colleague, callerId: caller, onProject: true }) ?? "", /yourself/);
    });

    it("lets 'assigned' hand a task only to somebody on its project", () => {
        assert.equal(assignRefusal("assigned", { assigneeId: colleague, callerId: caller, onProject: true }), null);
        assert.match(assignRefusal("assigned", { assigneeId: colleague, callerId: caller, onProject: false }) ?? "", /on its project/);
    });
});
