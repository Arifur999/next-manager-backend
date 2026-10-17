import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isPlatformPermission } from "../module/platform/platform.permissions.js";
import {
    ACTIONS,
    defaultPermissionRows,
    isAction,
    isEnforced,
    isModule,
    MODULE_ACTIONS,
    MODULES,
    ROLE_DEFAULTS,
    UNENFORCED_SQUARES,
} from "./permissionCatalogue.js";

const appDir = join(import.meta.dirname, "..");
const moduleDir = join(appDir, "module");

/** Every *.route.ts file's text, by path. */
const routeFiles = (): Array<{ path: string; text: string }> =>
    readdirSync(moduleDir, { recursive: true, encoding: "utf8" })
        .filter((name) => name.endsWith(".route.ts"))
        .map((name) => ({ path: name, text: readFileSync(join(moduleDir, name), "utf8") }));

/** Every non-test source file under src/app, by path. */
const sourceFiles = (): Array<{ path: string; text: string }> =>
    readdirSync(appDir, { recursive: true, encoding: "utf8" })
        .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
        .map((name) => ({ path: name, text: readFileSync(join(appDir, name), "utf8") }));

/** Every square something reads: requireScope on a route or resolveScope in a service. */
const checkedSquares = () => {
    const squares = new Set<string>();
    const patterns = [
        /requireScope\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g,
        /resolveScope\(\s*[\w.]+\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g,
    ];

    for (const { text } of sourceFiles()) {
        for (const pattern of patterns) {
            for (const match of text.matchAll(pattern)) squares.add(`${match[1]}.${match[2]}`);
        }
    }

    return squares;
};

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

describe("enforcement", () => {
    it("lists only real squares as unenforced", () => {
        for (const square of UNENFORCED_SQUARES) {
            const [module, action] = square.split(".");
            assert.ok(isModule(module) && isAction(action) && MODULE_ACTIONS[module].includes(action), `${square} is not a square`);
        }
    });

    it("checks every enforced square somewhere, so no square on the grid is a picker that does nothing", () => {
        const checked = checkedSquares();
        const missing = MODULES.flatMap((module) =>
            MODULE_ACTIONS[module].filter((action) => isEnforced(module, action) && !checked.has(`${module}.${action}`)).map((action) => `${module}.${action}`)
        );

        assert.deepEqual(missing, [], "enforced squares nothing reads; check them or mark them unenforced");
    });

    it("never reads a square it calls unenforced, so the locked ones on the screen are honest", () => {
        const checked = checkedSquares();
        assert.deepEqual(UNENFORCED_SQUARES.filter((square) => checked.has(square)), []);
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
