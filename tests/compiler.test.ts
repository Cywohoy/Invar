import { describe, expect, it } from "vitest";

import { compile, isSubtype, type RefinementType } from "../src/compiler";

describe("testlib generator", () => {
  it("generates a complete validator for the current example", () => {
    const result = compile(`
      val n: Int[1..=200000];
      val m: Int[1..=200000];
      val s: String[n];
      val t: String[m];

      input {
        n, m;
        s;
        t;
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('#include "testlib.h"');
    expect(result.code).toContain("registerValidation(argc, argv);");
    expect(result.code).toContain("long long _512_n;");
    expect(result.code).toContain("std::string _512_s;");
    expect(result.code).toMatch(
      /_512_n = inf\.readLong\(_513m\d+, _513x\d+, "n"\);/,
    );
    expect(result.code).toContain("inf.readSpace();");
    expect(result.code).toContain(
      'inf.readToken(format("[^\\\\ ]{%lld}",_512_n), "s")',
    );
    expect(result.code).toContain("inf.readEoln();");
    expect(result.code).toContain("inf.readEof();");
  });

  it("uses named testlib readers instead of unnamed validator reads", () => {
    const result = compile(`
      val unrestricted: Int;
      val bounded: Int[1..10];
      val token: String[3];
      input { unrestricted, bounded, token; }
    `);

    expect(result.diagnostics).toEqual([]);
    const code = result.code ?? "";
    expect(code).toContain(
      '_512_unrestricted = inf.readLong(LLONG_MIN, LLONG_MAX, "unrestricted");',
    );
    expect(code).toMatch(
      /_512_bounded = inf\.readLong\(_513m\d+, _513x\d+, "bounded"\);/,
    );
    expect(code).toContain(
      '_512_token = inf.readToken(format("[^\\\\ ]{%lld}",3LL), "token");',
    );
    expect(code).not.toContain("inf.readLong();");
    expect(code).not.toContain("inf.readToken();");
  });

  it("includes the original source as comments unless disabled", () => {
    const source = "input {} // trailing \\";
    const commented = compile(source);
    const compact = compile(source, { includeSourceComment: false });

    expect(commented.diagnostics).toEqual([]);
    expect(commented.code?.split("\n").slice(0, 5)).toEqual([
      "// Invar source:",
      "// input {} // trailing \\",
      "//",
      "",
      '#include "testlib.h"',
    ]);
    expect(compact.diagnostics).toEqual([]);
    expect(compact.code?.startsWith('#include "testlib.h"')).toBe(true);
  });

  it("generates safe comparisons for open and 64-bit boundary ranges", () => {
    const result = compile(`
      val n: Int[-9223372036854775808<..=9223372036854775807];
      input { n; }
    `);

    expect(result.diagnostics.map((diagnostic) => diagnostic.severity)).toEqual([]);
    expect(result.code).toMatch(/_513m\d+=iv_bl\(_513l\d+\);/);
    expect(result.code).toMatch(
      /_512_n = inf\.readLong\(_513m\d+, _513x\d+, "n"\);/,
    );
  });

  it("returns generated code together with non-fatal warnings", () => {
    const result = compile(`
      val unused: Int;
      val impossible: String[0];
      input { impossible }
    `);

    expect(result.code).not.toBeNull();
    expect(result.diagnostics).toHaveLength(3);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "SEM_MISSING_FINAL_EOLN",
        "SEM_VALUE_NOT_INPUT",
        "SEM_EMPTY_STRING_TOKEN",
      ]),
    );
    expect(result.diagnostics.every((diagnostic) => diagnostic.severity === "warning")).toBe(
      true,
    );
  });

  it("stops generation when semantic errors are present", () => {
    const result = compile(`
      val n: Int;
      val s: String[n];
      input { s; n; }
    `);

    expect(result.code).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_STRING_LENGTH_NOT_NONNEGATIVE",
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_DEPENDENCY_NOT_READY",
    );
  });

  it("requires declared names and a single input assignment", () => {
    const result = compile(`
      val n: Int;
      input { n, n, missing; }
    `);

    expect(result.code).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "SEM_VALUE_ASSIGNED_TWICE",
      "SEM_UNKNOWN_INPUT_NAME",
    ]);
  });

  it("continues unfinished lines across input block boundaries", () => {
    const result = compile(`
      val a, b: Int;
      input { ; a }
      input { b;; }
    `);

    expect(result.diagnostics).toEqual([]);
    const code = result.code ?? "";
    const operations = [
      "inf.readEoln();",
      '_512_a = inf.readLong(LLONG_MIN, LLONG_MAX, "a");',
      "inf.readSpace();",
      '_512_b = inf.readLong(LLONG_MIN, LLONG_MAX, "b");',
      "inf.readEoln();",
      "inf.readEoln();",
      "inf.readEof();",
    ];
    let previousIndex = -1;
    for (const operation of operations) {
      const index = code.indexOf(operation, previousIndex + 1);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });

  it("keeps generated source names separate from internal temporaries", () => {
    const result = compile(`
      val f: Int;
      input { f; }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("long long _512_f;");
    expect(result.code).toContain("bool _513f=false;");
  });

  it("requires at least one input block", () => {
    const result = compile("val n: Int;");

    expect(result.code).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_MISSING_INPUT_BLOCK",
    );
  });

  it("generates checked arithmetic and Python-style floor division helpers", () => {
    const result = compile(`
      val n: Int[-100..=100];
      val modulus: Int[1..=10];
      val text: String[n % modulus];
      val value: Int[n / modulus..=n + modulus * 2];
      input { n, modulus, text, value; }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(
      "iv_r(_512_n,_512_modulus)",
    );
    expect(result.code).toContain(
      "iv_d(_512_n,_512_modulus)",
    );
    expect(result.code).toContain(
      "if(r&&((r<0)!=(b<0)))--q;",
    );
    expect(result.code).toContain(
      "if(r&&((r<0)!=(b<0)))r+=b;",
    );
    expect(result.code).toContain("iv_m(_512_modulus,2LL)");
    expect(result.code).toContain("iv_a(");
  });

  it("uses Python results when checking constant arithmetic expressions", () => {
    const result = compile(`
      val value: Int[-5 / 2..=-5 % 2];
      input { value; }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("iv_d(-5LL,2LL)");
    expect(result.code).toContain("iv_r(-5LL,2LL)");
  });

  it("rejects statically known division by zero and arithmetic overflow", () => {
    const divisionByZero = compile(`
      val value: Int[1 / 0..=10];
      input { value; }
    `);
    const overflow = compile(`
      val text: String[9223372036854775807 + 1];
      input { text; }
    `);

    expect(divisionByZero.code).toBeNull();
    expect(divisionByZero.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_DIVISION_BY_ZERO",
    );
    expect(overflow.code).toBeNull();
    expect(overflow.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_INTEGER_EXPRESSION_OUT_OF_RANGE",
    );
  });

  it("generates whole-line input for both String and Int values", () => {
    const result = compile(`
      val length: Int[0..=100];
      val text: String[length];
      input {
        line(length);
        line(text);
      }
    `);

    expect(result.diagnostics).toEqual([]);
    const code = result.code ?? "";
    expect(code).toMatch(
      /_512_length = inf\.readLong\(_513m\d+, _513x\d+, "length"\);/,
    );
    expect(code).toContain(
      'inf.readLine(format("[^\\r\\n]{%lld}",_512_length), "text")',
    );
    expect(code).not.toContain("SEM_EMPTY_STRING_TOKEN");
  });

  it("allows a zero-byte String through a whole-line pattern", () => {
    const result = compile(`
      val empty: String[0];
      input { line(empty); }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(
      '_512_empty = inf.readLine(format("[^\\r\\n]{%lld}",0LL), "empty");',
    );
  });

  it("supports an unterminated final whole-line String", () => {
    const result = compile(`
      val text: String;
      input { line(text) }
    `);

    expect(result.code).toContain("_512_text=iv_l();");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "SEM_MISSING_FINAL_EOLN",
    ]);
  });

  it("reports actual and expected byte lengths for custom final-line reads", () => {
    const result = compile(`
      val text: String[3];
      input { line(text) }
    `);

    expect(result.code).toContain('_512_text=iv_l();');
    expect(result.code).toContain('iv_z(_512_text,3LL,"text","String");');
    expect(result.code).toContain(
      "%s '%s' has byte length %llu; expected %lld.",
    );
  });

  it("applies ordinary name, assignment, and dependency checks to line patterns", () => {
    const result = compile(`
      val n: Int[0..=10];
      val text: String[n];
      input {
        line(text);
        line(n);
        line(n);
        line(missing);
      }
    `);

    expect(result.code).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "SEM_DEPENDENCY_NOT_READY",
        "SEM_VALUE_ASSIGNED_TWICE",
        "SEM_UNKNOWN_INPUT_NAME",
      ]),
    );
  });

  it("defers continuing an unterminated whole-line pattern to runtime", () => {
    const result = compile(`
      val a, b: String;
      input { line(a) }
      input { line(b); }
    `);

    expect(result.code).not.toBeNull();
    expect(result.code).toContain('quitf(_fail, "Expected a whole line at line start.")');
  });

  it("generates Bool conditions, require, and logical operators", () => {
    const result = compile(`
      val n: Int[-10..=10];
      val text: String;
      input { n; text; }
      require(n >= -5 && n <= 5);
      require(text == text || false);
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("iv_q(");
    expect(result.code).toContain("iv_g(_512_n,-5LL)>=0");
    expect(result.code).toContain("&&");
    expect(result.code).toContain("iv_g(_512_text,_512_text)==0");
    expect(result.code).toContain("||");
    expect(result.code).toContain('"n >= -5 && n <= 5"');
  });

  it("escapes the original require argument text into the Validator message", () => {
    const result = compile(`
      val n: Int = 1;
      input {}
      require(
        n > 0 &&
        n < 2
      );
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(
      '"n > 0 &&\\n        n < 2"',
    );
    expect(result.code).toContain('require(%s) failed.');
  });

  it("allows mutually exclusive branches to assign the same value", () => {
    const result = compile(`
      val selector: Int[0..=1];
      val x: Int;
      input { selector; }
      if (selector == 0) {
        input { x; }
      } else {
        input { x; }
      }
      require(x > 0);
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("if ((iv_g(_512_selector,0LL)==0)) {");
    expect(result.code).toContain(
      '_512_x = inf.readLong(LLONG_MIN, LLONG_MAX, "x");',
    );
    expect(result.code).toContain("iv_q((iv_g(_512_x,0LL)>0)");
  });

  it("rejects a value that is assigned in only one branch after the if", () => {
    const result = compile(`
      val selector: Int[0..=1];
      val x: Int;
      input { selector; }
      if (selector == 0) {
        input { x; }
      } else {}
      require(x > 0);
    `);

    expect(result.code).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_VALUE_NOT_READY",
    );
  });

  it("supports statement-form if without else and keeps the skipped path", () => {
    const valid = compile(`
      val selector: Int[0..=1];
      input { selector; }
      if (selector == 0) {
        require(selector == 0);
      }
    `);
    const maybeAssigned = compile(`
      val selector: Int[0..=1];
      val value: Int;
      input { selector; }
      if (selector == 0) {
        value = 1;
      }
      require(value == 1);
    `);

    expect(valid.diagnostics).toEqual([]);
    expect(valid.code).toContain("if ((iv_g(_512_selector,0LL)==0)) {");
    expect(valid.code).not.toContain("}\n    else {");
    expect(maybeAssigned.code).toBeNull();
    expect(maybeAssigned.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_VALUE_NOT_READY",
    );
  });

  it("rejects Bool and Unit input patterns", () => {
    const result = compile(`
      val flag: Bool;
      val nothing: Unit;
      input { flag, nothing; }
    `);

    expect(result.code).toBeNull();
    expect(result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "SEM_TYPE_NOT_INPUTTABLE",
    )).toHaveLength(2);
  });

  it("requires if branches to have a common base type", () => {
    const result = compile(`
      input {}
      if (true) 1 else false;
    `);

    expect(result.code).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_IF_BRANCH_TYPE_MISMATCH",
    );
  });

  it("uses lexical block scopes without allowing shadowing", () => {
    const siblingLocals = compile(`
      input {}
      if (true) {
        val local: Int;
      } else {
        val local: Int;
      }
    `);
    const shadowing = compile(`
      val value: Int;
      input { value; }
      if (true) {
        val value: Int;
      } else {}
    `);

    expect(siblingLocals.code).not.toBeNull();
    expect(shadowing.code).toBeNull();
    expect(shadowing.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_DUPLICATE_NAME",
    );
  });

  it("supports refinement subtyping only inside one base-type family", () => {
    const narrow: RefinementType = {
      base: "Int",
      interval: { minimum: 1n, maximum: 5n },
      guaranteedInterval: { minimum: 1n, maximum: 5n },
      exactBoolean: null,
      arrayType: null,
    };
    const wide: RefinementType = {
      base: "Int",
      interval: { minimum: 0n, maximum: 10n },
      guaranteedInterval: { minimum: 0n, maximum: 10n },
      exactBoolean: null,
      arrayType: null,
    };
    const string: RefinementType = {
      base: "String",
      interval: null,
      guaranteedInterval: null,
      exactBoolean: null,
      arrayType: null,
    };

    expect(isSubtype(narrow, wide)).toBe(true);
    expect(isSubtype(wide, narrow)).toBe(false);
    expect(isSubtype(narrow, string)).toBe(false);
  });

  it("reports an out-of-range bound even when a later type depends on it", () => {
    expect(() =>
      compile(`
        val n: Int[1..=1000000000000000000000000000000000];
        val m: Int[1..=200000];

        val s: String[n];
        val t: String[m];

        input {
          n, m;
          s;
          t;
        }
      `),
    ).not.toThrow();

    const result = compile(`
      val n: Int[1..=1000000000000000000000000000000000];
      val m: Int[1..=200000];

      val s: String[n];
      val t: String[m];

      input {
        n, m;
        s;
        t;
      }
    `);

    expect(result.code).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_INTEGER_OUT_OF_RANGE",
    );
  });

  it("generates mutable assignments and count-based loops", () => {
    const result = compile(`
      val n: Int[0..=10];
      var counter: Int;
      input { n; }
      counter = 0;
      for (n) times {
        counter += 1;
      }
      while (counter < n + 2) {
        counter += 1;
      }
      require(counter == n + 2);
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("long long _512_counter;");
    expect(result.code).toContain("_512_counter = 0LL;");
    expect(result.code).toContain("const long long _513c");
    expect(result.code).toContain("for (long long _513i");
    expect(result.code).toContain(
      "_512_counter = iv_a(_512_counter, 1LL);",
    );
    expect(result.code).toContain("while (");
  });

  it("allows repeated input only through var and loop-local val", () => {
    const mutableInput = compile(`
      val count: Int[0..=10];
      var value: Int;
      input { count; }
      for (count) times {
        input { value; }
      }
    `);
    const loopLocal = compile(`
      val count: Int[0..=10];
      input { count; }
      for (count) times {
        val value: Int;
        input { value; }
      }
    `);
    const outerVal = compile(`
      val count: Int[0..=10];
      val value: Int;
      input { count; }
      for (count) times {
        input { value; }
      }
    `);

    expect(mutableInput.code).not.toBeNull();
    expect(loopLocal.code).not.toBeNull();
    expect(outerVal.code).toBeNull();
    expect(outerVal.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_IMMUTABLE_ASSIGNMENT_IN_LOOP",
    );
  });

  it("enforces assignment mutability, initialization, and refinements", () => {
    const compoundVal = compile(`
      val value: Int;
      input { value; }
      value += 1;
    `);
    const uninitialized = compile(`
      var value: Int;
      input {}
      value += 1;
    `);
    const outsideRefinement = compile(`
      var value: Int[0..=10];
      input {}
      value = 11;
    `);

    expect(compoundVal.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_COMPOUND_ASSIGNMENT_REQUIRES_VAR",
    );
    expect(uninitialized.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_VALUE_NOT_READY",
    );
    expect(outsideRefinement.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_ASSIGNMENT_TYPE_MISMATCH",
    );
  });

  it("captures a mutable value when declaring a dependent type", () => {
    const result = compile(`
      var length: Int[0..=10] = 3;
      val text: String[length];
      length = 5;
      input { text; }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(
      "const long long _513s",
    );
    expect(result.code).toMatch(
      /inf\.readToken\(format\("\[\^\\\\ \]\{%lld\}",_513s\d+\), "text"\)/,
    );
  });

  it("uses loop bounds for definite-assignment flow", () => {
    const guaranteed = compile(`
      val count: Int[1..=3];
      var value: Int;
      input { count; }
      for (count) times {
        value = 1;
      }
      require(value == 1);
    `);
    const maybeSkipped = compile(`
      val count: Int[0..=3];
      var value: Int;
      input { count; }
      for (count) times {
        value = 1;
      }
      require(value == 1);
    `);

    expect(guaranteed.diagnostics).toEqual([]);
    expect(maybeSkipped.code).toBeNull();
    expect(maybeSkipped.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_VALUE_NOT_READY",
    );
  });

  it("rejects negative fixed counts and non-Bool while conditions", () => {
    const negative = compile(`
      input {}
      for (-1) times {}
    `);
    const nonBoolean = compile(`
      input {}
      while (1) {}
    `);

    expect(negative.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_NEGATIVE_LOOP_COUNT",
    );
    expect(nonBoolean.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_TYPE_MISMATCH",
    );
  });

  it("defers loop input line-layout failures to runtime", () => {
    const result = compile(`
      val count: Int[1..=3];
      var value: Int;
      input { count; }
      for (count) times {
        input { value }
      }
    `);

    expect(result.code).not.toBeNull();
    expect(result.code).toContain("if (_513f)inf.readSpace();");
  });

  it("keeps assignments from the first while condition evaluation", () => {
    const result = compile(`
      var checked: Bool;
      input {}
      while ({
        checked = true;
        false
      }) {}
      require(checked);
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("while (([&]() -> bool {");
    expect(result.code).toContain("_512_checked = true;");
  });

  it("initializes val and var declarations with refinement checks", () => {
    const valid = compile(`
      val fixed: Int[0..=10] = 3;
      var changing: Int = fixed;
      changing += 1;
      input {}
      require(changing == 4);
    `);
    const invalid = compile(`
      val value: Int[0..=10] = 11;
      input {}
    `);

    expect(valid.diagnostics).toEqual([]);
    expect(valid.code).toContain("_512_fixed = 3LL;");
    expect(valid.code).toContain("_512_changing = _512_fixed;");
    expect(invalid.code).toBeNull();
    expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_ASSIGNMENT_TYPE_MISMATCH",
    );
  });

  it("constructs nested arrays and generates checked element access", () => {
    const result = compile(`
      val rows: Int[1..=3] = 2;
      val columns: Int[1..=4] = 3;
      val matrix: Array[Array[Int, columns], rows];
      matrix[0][1] = 7;
      input {}
      require(matrix[0][1] == 7);
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(
      "iv_v<iv_v<long long>> _512_matrix;",
    );
    expect(result.code).toContain(
      "iv_v<iv_v<long long>>(_512_rows,",
    );
    expect(result.code).toContain(".w(0LL).w(1LL)=7LL;");
    expect(result.code).toContain(".r(0LL).r(1LL)");
    expect(result.code).toContain(
      "Invar Array element at index %lld is read before initialization.",
    );
  });

  it("uses a valid C++ expression for an Int Array default element", () => {
    const result = compile(`
      val n: Int[1..=10];
      input { n; }
      val values: Array[Int, n];
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(
      "_512_values = iv_v<long long>(_512_n, 0LL, false);",
    );
    expect(result.code).not.toContain("long long{}");
  });

  it("allows mutable elements of a val array, including compound assignment", () => {
    const result = compile(`
      val values: Array[Int, 1];
      values[0] = 2;
      values[0] += 3;
      input {}
      require(values[0] == 5);
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("_513t");
    expect(result.code).toContain("iv_a(");
  });

  it("keeps the val array binding immutable while allowing var array replacement", () => {
    const immutable = compile(`
      val left: Array[Int, 2];
      val right: Array[Int, 2];
      left = right;
      input {}
    `);
    const mutable = compile(`
      var left: Array[Int, 2];
      val right: Array[Int, 2];
      left = right;
      input {}
    `);

    expect(immutable.code).toBeNull();
    expect(immutable.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_VALUE_ASSIGNED_TWICE",
    );
    expect(mutable.diagnostics).toEqual([]);
    expect(mutable.code).toContain("_512_left = _512_right;");
  });

  it("requires array lengths to be ready and provably nonnegative", () => {
    const notReady = compile(`
      val length: Int[0..=10];
      val values: Array[Int, length];
      input { length; }
    `);
    const negative = compile(`
      val values: Array[Int, -1];
      input {}
    `);

    expect(notReady.code).toBeNull();
    expect(notReady.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_ARRAY_LENGTH_DEPENDENCY_NOT_READY",
    );
    expect(negative.code).toBeNull();
    expect(negative.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_ARRAY_LENGTH_NOT_NONNEGATIVE",
    );
  });

  it("rejects statically impossible array indexes and checks dynamic indexes", () => {
    const staticFailure = compile(`
      val values: Array[Int, 2];
      values[2] = 1;
      input {}
    `);
    const dynamic = compile(`
      val index: Int[0..=2];
      val values: Array[Int, 2];
      input { index; values[index]; }
    `);

    expect(staticFailure.code).toBeNull();
    expect(staticFailure.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_INDEX_OUT_OF_BOUNDS",
    );
    expect(dynamic.diagnostics).toEqual([]);
    expect(dynamic.code).toContain(".w(_512_index)");
    expect(dynamic.code).toContain(
      "Invar Array index %lld is out of bounds for length %llu.",
    );
  });

  it("does not give fixed Arrays a special compact-token input form", () => {
    const compact = compile(`
      val length: Int[1..=10];
      input { length; }
      val letters: Array[String[1], length];
      input { letters; }
      require(letters[0] == letters[0]);
    `);
    const ordinaryArray = compile(`
      val values: Array[Int, 2];
      input { values; }
    `);

    expect(compact.code).toBeNull();
    expect(compact.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_TYPE_NOT_INPUTTABLE",
    );
    expect(ordinaryArray.code).toBeNull();
    expect(ordinaryArray.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_TYPE_NOT_INPUTTABLE",
    );
  });

  it("reads individual refined elements through indexed input patterns", () => {
    const result = compile(`
      var index: Int[0..=1] = 0;
      val values: Array[Int[1..=9], 2];
      input { values[index], values[1]; }
      require(values[0] >= 1);
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("auto& _513t");
    expect(result.code).toMatch(
      /inf\.readLong\(_513m\d+, _513x\d+, "values\[index\]"\)/,
    );
    expect(result.code).toMatch(
      /inf\.readLong\(_513m\d+, _513x\d+, "values\[1\]"\)/,
    );
  });

  it("uses the declared var interval as the possible dependent bound", () => {
    const safe = compile(`
      var upper: Int[5..=10] = 7;
      val value: Int[1..=upper] = 4;
      input {}
      require(value <= 10);
    `);
    const notProvable = compile(`
      var upper: Int[1..=10] = 7;
      val value: Int[1..=upper] = 8;
      input {}
    `);

    expect(safe.diagnostics).toEqual([]);
    expect(notProvable.code).toBeNull();
    expect(notProvable.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_ASSIGNMENT_TYPE_MISMATCH",
    );
  });

  it("requires mutable snapshot dependencies to be ready", () => {
    const result = compile(`
      var upper: Int[1..=10];
      val value: Int[1..=upper];
      input { upper; value; }
    `);

    expect(result.code).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_SNAPSHOT_DEPENDENCY_NOT_READY",
    );
  });

  it("captures a mutable Array length before later mutation", () => {
    const result = compile(`
      var length: Int[1..=10] = 3;
      val letters: Array[String[1], length];
      length = 5;
      input {}
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toMatch(
      /const long long (_513s\d+) = _512_length;/,
    );
    expect(result.code).toMatch(
      /iv_v<std::string>\(_513s\d+,/,
    );
  });

  it("captures initialized Array elements in refinements", () => {
    const result = compile(`
      val bounds: Array[Int[0..=10], 1];
      bounds[0] = 3;
      val value: Int[0..=bounds[0]];
      input { value; }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toMatch(
      /const long long _513s\d+ = _512_bounds\.r\(0LL\);/,
    );
  });

  it("defers dynamic Array index and initialization checks to the Validator", () => {
    const result = compile(`
      val bounds: Array[Int[1..=10], 2];
      var index: Int[0..=1] = 1;
      val value: Int[1..=bounds[index]];
      input { value; }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toMatch(
      /const long long _513s\d+ = _512_bounds\.r\(_512_index\);/,
    );
    expect(result.code).toContain(
      "Invar Array index %lld is out of bounds for length %llu.",
    );
    expect(result.code).toContain(
      "Invar Array element at index %lld is read before initialization.",
    );
  });

});
