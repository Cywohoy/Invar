import { describe, expect, it } from "vitest";

import { compile, parse } from "../src/compiler";

describe("extended value types and expressions", () => {
  it("uses UTF-8 byte length for String and one byte for Byte", () => {
    const result = compile(`
      val text: String[4] = "가a";
      val letter: Byte = 'a';
      input {}
      require(text.length == 4);
      require(text[3] == letter);
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("iv_b({234u,176u,128u,97u})");
    expect(result.code).toContain("iv_c(_512_text,3LL)");
    expect(result.code).toContain("static_cast<unsigned char>(97)");
  });

  it("rejects a multi-byte Byte and String byte assignment", () => {
    const badByte = compile(`
      val letter: Byte = '가';
      input {}
    `);
    const stringMutation = compile(`
      val text: String = "abc";
      text[0] = 'x';
      input {}
    `);

    expect(badByte.code).toBeNull();
    expect(badByte.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "PARSE_BYTE_LENGTH",
    );
    expect(stringMutation.code).toBeNull();
    expect(stringMutation.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_STRING_IS_READ_ONLY",
    );
  });

  it("supports fixed and dynamic lengths and Array_v shallow storage", () => {
    const result = compile(`
      val fixed: Array[Int, 2];
      fixed[0] = 7;
      val values: Array_v[Int] = [];
      values.push(1);
      values.resize(3);
      values[1] = fixed[0];
      val alias: Array_v[Int] = values;
      alias.push(9);
      val last: Int = values.pop();
      input {}
      require(fixed.length == 2);
      require(values.length == 3);
      require(last == 9);
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("std::shared_ptr<S>");
    expect(result.code).toContain("_512_values.p(1LL)");
    expect(result.code).toContain("_512_values.z(3LL)");
    expect(result.code).toContain("_512_alias.p(9LL)");
    expect(result.code).toContain("_512_values.o()");
    expect(result.code).toContain("_512_fixed.n()");
  });

  it("uses the surrounding Array_v type for empty literals", () => {
    const result = compile(`
      fn empty(): Array_v[Int] { [] }
      val first: Array_v[Int];
      first = [];
      val second: Array_v[Int] = if (true) [] else empty();
      input {}
      require(first.length == 0 && second.length == 0);
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("iv_w<long long>{}");
  });

  it("contextually types non-empty fixed and dynamic array literals", () => {
    const valid = compile(`
      val fixed: Array[Int[0..=9], 3] = [1, 2, 3];
      val dynamic: Array_v[String] = ["a", "b"];
      input {}
      require(fixed.length == 3 && dynamic.length == 2);
    `);
    const noContext = compile(`
      [1, 2];
      input {}
    `);
    const wrongLength = compile(`
      val fixed: Array[Int, 2] = [1];
      input {}
    `);

    expect(valid.diagnostics).toEqual([]);
    expect(valid.code).toContain("iv_v<long long>{1LL,2LL,3LL}");
    expect(valid.code).toContain("iv_w<std::string>{iv_b({97u}),iv_b({98u})}");
    expect(noContext.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_ARRAY_LITERAL_NEEDS_CONTEXT",
    );
    expect(wrongLength.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_ARRAY_LITERAL_LENGTH_MISMATCH",
    );
  });

  it("orders Byte, String, and fixed/dynamic arrays lexicographically", () => {
    const result = compile(`
      val fixed: Array[Int, 2] = [1, 2];
      val dynamic: Array_v[Int] = [1, 3];
      input {}
      require('a' < 'b');
      require("abc" < "abd");
      require(fixed < dynamic);
      require(dynamic != fixed);
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("iv_g(static_cast<unsigned char>(97)");
    expect(result.code).toContain("iv_g(iv_b({97u,98u,99u})");
    expect(result.code).toContain("iv_g(_512_fixed,_512_dynamic)<0");
    expect(result.code).toContain("iv_g(_512_dynamic,_512_fixed)!=0");
  });

  it("allows equality but not ordering for Bool arrays", () => {
    const equality = compile(`
      val fixed: Array[Bool, 1] = [false];
      val dynamic: Array_v[Bool] = [true];
      input {}
      require(fixed != dynamic);
    `);
    const ordering = compile(`
      val fixed: Array[Bool, 1] = [false];
      val dynamic: Array_v[Bool] = [true];
      input {}
      require(fixed < dynamic);
    `);

    expect(equality.diagnostics).toEqual([]);
    expect(equality.code).toContain("iv_g(_512_fixed,_512_dynamic)!=0");
    expect(ordering.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_INVALID_ORDERING_OPERANDS",
    );
  });

  it("provides signed 64-bit boundary constants", () => {
    const result = compile(`
      val minimum: Int = INT64_MIN;
      val maximum: Int = INT64_MAX;
      input {}
      require(minimum < maximum);
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("_512_minimum = LLONG_MIN;");
    expect(result.code).toContain("_512_maximum = LLONG_MAX;");
  });
});

describe("literal input and regex", () => {
  it("parses exact token and whole-line input literals", () => {
    const parsed = parse("val n: Int; input { `BEGIN`, n; ``finished``; }");
    const result = compile("val n: Int; input { `BEGIN`, n; ``finished``; }");

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.program?.items[1]).toMatchObject({
      kind: "InputBlock",
      lines: [
        {
          kind: "TokenLineInputPattern",
          tokens: [{ kind: "LiteralTokenPattern" }, { kind: "NameTokenPattern" }],
        },
        { kind: "LiteralLineInputPattern" },
      ],
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("does not equal the required literal");
    expect(result.code).toContain("does not equal the required Invar literal");
  });

  it("generates testlib pattern matching through matches", () => {
    const result = compile(`
      val word: String;
      val lowercase: Regex = r"[a-z]+";
      input { word; }
      require(matches(word, lowercase));
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("pattern(r.s).matches(s)");
    expect(result.code).toContain("iv_e(_512_word,_512_lowercase)");
  });
});

describe("user functions", () => {
  it("supports forward declarations, mutual recursion, and tail expressions", () => {
    const result = compile(`
      fn even(n: Int): Bool;
      fn odd(n: Int): Bool;
      fn even(n: Int): Bool {
        if (n == 0) true else odd(n - 1)
      }
      fn odd(n: Int): Bool {
        if (n == 0) false else even(n - 1)
      }
      val n: Int[0..=100];
      input { n; }
      require(even(n));
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("std::function<bool(long long)> _514_0_even");
    expect(result.code).toContain("std::function<bool(long long)> _514_1_odd");
    expect(result.code).toContain("_514_1_odd(iv_s(");
    expect(result.code).toMatch(/_514_0_even\(_512_n(?:_\d+)?\)/);
  });

  it("supports an explicit early return and rejects calls before declarations", () => {
    const earlyReturn = compile(`
      fn absolute(n: Int): Int {
        if (n < 0) {
          return -n;
        }
        n
      }
      val n: Int;
      input { n; }
      require(absolute(n) >= 0);
    `);
    const tooEarly = compile(`
      val result: Int = identity(1);
      fn identity(value: Int): Int { value }
      input {}
    `);

    expect(earlyReturn.diagnostics).toEqual([]);
    expect(earlyReturn.code).toContain("return iv_n(");
    expect(tooEarly.code).toBeNull();
    expect(tooEarly.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_UNKNOWN_FUNCTION",
    );
  });

  it("allows input and require inside a function body", () => {
    const result = compile(`
      fn read_positive(): Int {
        val value: Int;
        input { value; }
        require(value > 0);
        value
      }
      val answer: Int = read_positive();
      require(answer > 0);
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("inf.readLong(LLONG_MIN, LLONG_MAX, \"value\")");
    expect(result.code).toContain("iv_q(");
  });

  it("defers function line-layout errors to runtime and applies captured var input effects", () => {
    const unfinished = compile(`
      fn read_value(): Int {
        val value: Int;
        input { value }
        value
      }
      val answer: Int = read_value();
    `);
    const capturedInput = compile(`
      var value: Int;
      fn read_value(): Unit {
        input { value; }
      }
      read_value();
    `);

    expect(unfinished.code).not.toBeNull();
    expect(unfinished.code).toContain("bool _513f=false;");
    expect(capturedInput.diagnostics).toEqual([]);
    expect(capturedInput.code).toContain("_512_value = inf.readLong");
  });

  it("substitutes arguments into dependent parameter and return refinements", () => {
    const valid = compile(`
      fn bounded(n: Int, value: Int[0..=n]): Int[0..=n] { value }
      val answer: Int[0..=3] = bounded(3, 2);
      input {}
      require(answer == 2);
    `);
    const invalid = compile(`
      fn bounded(n: Int, value: Int[0..=n]): Int[0..=n] { value }
      val answer: Int = bounded(3, 4);
      input {}
    `);

    expect(valid.diagnostics).toEqual([]);
    expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_ARGUMENT_TYPE_MISMATCH",
    );
  });

  it("supports lexical nested functions, mutual recursion, and captured var mutation", () => {
    const result = compile(`
      fn count_down(n: Int[0..=10]): Int {
        var current: Int = n;
        fn even(): Bool;
        fn odd(): Bool;
        fn even(): Bool {
          if (current == 0) true else {
            current -= 1;
            odd()
          }
        }
        fn odd(): Bool {
          if (current == 0) false else {
            current -= 1;
            even()
          }
        }
        require(even() || !even());
        current
      }
      val answer: Int = count_down(4);
      input {}
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("std::function<bool()> _514_1_even;");
    expect(result.code).toContain("std::function<bool()> _514_2_odd;");
    expect(result.code).toContain("[&]() -> bool");
    expect(result.code).toContain("_512_current = iv_s(");
  });

  it("computes captured assignment effects to a fixed point", () => {
    const result = compile(`
      var value: Int;
      fn first(): Unit;
      fn second(): Unit;
      fn first(): Unit { second(); }
      fn second(): Unit {
        value = 7;
        if (false) { first(); }
      }
      first();
      input {}
      require(value == 7);
    `);
    const immutable = compile(`
      val value: Int;
      fn set_value(): Unit { value = 1; }
      input {}
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("_514_0_first()");
    expect(immutable.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "SEM_CAPTURED_VAL_ASSIGNMENT",
    );
  });
});

describe("loop exits", () => {
  it("generates break and continue only inside loops", () => {
    const valid = compile(`
      var count: Int = 0;
      input {}
      while (count < 10) {
        count += 1;
        if (count == 2) { continue; }
        if (count == 3) { break; }
      }
    `);
    const invalid = compile(`
      input {}
      break;
      continue;
    `);

    expect(valid.diagnostics).toEqual([]);
    expect(valid.code).toContain("continue;");
    expect(valid.code).toContain("break;");
    expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "SEM_BREAK_OUTSIDE_LOOP",
        "SEM_CONTINUE_OUTSIDE_LOOP",
      ]),
    );
  });
});
