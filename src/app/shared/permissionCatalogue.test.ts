import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isPlatformPermission } from "../module/platform/platform.permissions.js";
import { ACTIONS, defaultPermissionRows, isAction, isModule, MODULE_ACTIONS, MODULES, ROLE_DEFAULTS } from "./permissionCatalogue.js";

const moduleDir = join(import.meta.dirname, "..", "module");

/** Every *.route.ts file's text, by path. */
const routeFiles = (): Array<{ path: string; text: string }> =>
    readdirSync(moduleDir, { recursive: true, encoding: "utf8" })
        .filter((name) => name.endsWith(".route.ts"))
        .map((name) => ({ path: name, text: readFileSync(join(moduleDir, name), "utf8") }));

describe("the permission catalogue", () => {
    it("gives every role default an action its module really has", () => {
        for (const [role, defaults] of Object.entries(ROLE_DEFAULTS)) {
            for (const [module, actions] of Object.entries(defaults)) {
                assert.ok(isModule(module), `${role}: unknown module ${module}`);
                for (const action of Object.keys(actions ?? {})) {
                    assert.ok(isAction(action), `${role}.${module}: unknown action ${action}`);
                    assert.ok(MODULE_ACTIONS[module].includes(action), `${role}.${module}.${action} is not a square on the grid`);
                }
            }
        }
    });

    it("only lists real actions per module", () => {
        for (const module of MODULES) {
            for (const action of MODULE_ACTIONS[module]) {
                assert.ok((ACTIONS as readonly string[]).includes(action));
            }
        }
    });

    it("seeds every role x module x action square exactly once", () => {
        const rows = defaultPermissionRows();
        const keys = rows.map((row) => `${row.role}.${row.module}.${row.action}`);
        const squares = MODULES.reduce((sum, module) => sum + MODULE_ACTIONS[module].length, 0);

        assert.equal(new Set(keys).size, keys.length, "a square is seeded twice");
        assert.equal(rows.length, Object.keys(ROLE_DEFAULTS).length * squares);
        assert.ok(!keys.some((key) => key.startsWith("super_admin.")), "super_admin has no company grid");
    });
});

describe("the route files", () => {
    it("only ask requireScope for squares that exist", () => {
        const calls = routeFiles().flatMap(({ path, text }) =>
            [...text.matchAll(/requireScope\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g)].map((match) => ({ path, module: match[1], action: match[2] }))
        );

        assert.ok(calls.length > 0, "no requireScope calls found; the scan is broken");
        for (const { path, module, action } of calls) {
            assert.ok(isModule(module), `${path}: unknown module ${module}`);
            assert.ok(isAction(action) && MODULE_ACTIONS[module].includes(action), `${path}: ${module}.${action} is not a square on the grid`);
        }
    });

    it("only ask requirePermission for platform permissions that exist", () => {
        const names = routeFiles().flatMap(({ path, text }) =>
            [...text.matchAll(/requirePermission\(([^)]*)\)/g)].flatMap((match) =>
                [...match[1].matchAll(/"([^"]+)"/g)].map((name) => ({ path, name: name[1] }))
            )
        );

        assert.ok(names.length > 0, "no requirePermission calls found; the scan is broken");
        for (const { path, name } of names) {
            assert.ok(isPlatformPermission(name), `${path}: unknown platform permission ${name}`);
        }
    });
});
