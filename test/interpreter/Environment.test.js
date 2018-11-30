const { Environment, Scope } = require("../../lib/interpreter/Environment");
const { Lexeme, BrsTypes } = require("brs");
const { BrsString } = BrsTypes;

describe("Environment", () => {
    let env;
    let lineNumber;

    /** Creates an identifier with the given text. */
    let identifier = (text) => ({ kind: Lexeme.Identifier, text: text, line: lineNumber++ });

    beforeEach(() => {
        env = new Environment();
        lineNumber = 0;
    });

    it("gets and sets from Function scope", () => {
        let val = new BrsString("functionScope");
        env.define(Scope.Function, "foo", val);

        expect(
            env.get({ kind: Lexeme.Identifier, text: "foo", line: 1 })
        ).toBe(val);
    });

    it("gets and sets from Module scope", () => {
        let val = new BrsString("moduleScope");
        env.define(Scope.Module, "foo", val);

        expect(
            env.get({ kind: Lexeme.Identifier, text: "foo", line: 1 })
        ).toBe(val);
    });

    it("gets and sets from Module scope", () => {
        let val = new BrsString("globalScope");
        env.define(Scope.Global, "foo", val);

        expect(
            env.get({ kind: Lexeme.Identifier, text: "foo", line: 1 })
        ).toBe(val);
    });

    it("checks all sources for existence", () => {
        let foo = new BrsString("function scope");
        let bar = new BrsString("module scope");
        let baz = new BrsString("global scope");

        env.define(Scope.Function, "foo", foo);
        env.define(Scope.Module, "bar", bar);
        env.define(Scope.Global, "baz", baz);

        expect(env.has(identifier("foo"))).toBe(true);
        expect(env.has(identifier("bar"))).toBe(true);
        expect(env.has(identifier("baz"))).toBe(true);
    });

    it("removes only from Function scope", () => {
        let foo = new BrsString("function scope");
        let bar = new BrsString("module scope");
        let baz = new BrsString("global scope");

        env.define(Scope.Function, "foo", foo);
        env.define(Scope.Module, "bar", bar);
        env.define(Scope.Global, "baz", baz);

        env.remove("foo");
        env.remove("bar");
        env.remove("baz");

        expect(env.has(identifier("foo"))).toBe(false);
        expect(env.has(identifier("bar"))).toBe(true);
        expect(env.has(identifier("baz"))).toBe(true);
    });

    it("creates sub-environments without Function-scoped variables", () => {
        env.define(Scope.Function, "funcScoped", new BrsString("funcScoped"));
        env.define(Scope.Module, "moduleScoped", new BrsString("module-scoped"));
        env.define(Scope.Global, "globalScoped", new BrsString("global-scoped"));

        let subEnv = env.createSubEnvironment();

        expect(subEnv.has(identifier("funcScoped"))).toBe(false);
        expect(subEnv.has(identifier("moduleScoped"))).toBe(true);
        expect(subEnv.has(identifier("globalScoped"))).toBe(true);
    });
});