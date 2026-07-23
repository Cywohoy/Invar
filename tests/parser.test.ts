import { describe, expect, it } from "vitest";

import {
  parse,
  type InputBlock,
  type BinaryExpression,
  type ArrayType,
  type BlockExpression,
  type ExpressionStatement,
  type ForStatement,
  type IfExpression,
  type IfStatement,
  type IndexExpression,
  type IntType,
  type IntegerLiteral,
  type Program,
  type StringType,
  type ValDeclaration,
  type VarDeclaration,
  type WhileStatement,
} from "../src/compiler";

function parseSuccessfully(source: string): Program {
  const result = parse(source);
  expect(result.diagnostics).toEqual([]);
  if (result.program === null) {
    throw new Error("Expected parsing to succeed.");
  }
  return result.program;
}

describe("parser", () => {
  it("builds declarations, exact expressions, and constrained types", () => {
    const program = parseSuccessfully(`
      val lower: Int[- 10<..=+ 20];
      val size, count: Int;
      val text: String[size];
      val raw: String;
      input {}
    `);

    const lowerDeclaration = program.items[0] as ValDeclaration;
    const lowerType = lowerDeclaration.valueType as IntType;
    const lower = lowerType.range?.lower as IntegerLiteral;
    const upper = lowerType.range?.upper as IntegerLiteral;

    expect(lowerDeclaration.names.map((name) => name.name)).toEqual(["lower"]);
    expect(lowerType.range).toMatchObject({
      kind: "IntRange",
      lowerInclusive: false,
      upperInclusive: true,
    });
    expect(lower).toMatchObject({
      kind: "IntegerLiteral",
      sign: "minus",
      digits: "10",
      value: -10n,
    });
    expect(upper).toMatchObject({
      kind: "IntegerLiteral",
      sign: "plus",
      digits: "20",
      value: 20n,
    });

    const multipleDeclaration = program.items[1] as ValDeclaration;
    expect(multipleDeclaration.names.map((name) => name.name)).toEqual(["size", "count"]);
    expect((multipleDeclaration.valueType as IntType).range).toBeNull();

    const textType = (program.items[2] as ValDeclaration).valueType as StringType;
    expect(textType.length).toMatchObject({
      kind: "NameExpression",
      name: "size",
    });
    expect(((program.items[3] as ValDeclaration).valueType as StringType).length).toBeNull();
  });

  it("represents line and token input patterns explicitly", () => {
    const program = parseSuccessfully(`
      val a, b, c: Int;
      input {
        ;;
        a, b,;
        c,
      }
    `);
    const input = program.items[1] as InputBlock;

    expect(input.lines).toHaveLength(4);
    expect(input.lines[0]).toMatchObject({
      kind: "TokenLineInputPattern",
      tokens: [],
      terminated: true,
      trailingComma: false,
    });
    expect(input.lines[1]).toMatchObject({
      tokens: [],
      terminated: true,
    });
    expect(input.lines[2]).toMatchObject({
      tokens: [
        { kind: "NameTokenPattern", name: "a" },
        { kind: "NameTokenPattern", name: "b" },
      ],
      terminated: true,
      trailingComma: true,
    });
    expect(input.lines[3]).toMatchObject({
      tokens: [{ kind: "NameTokenPattern", name: "c" }],
      terminated: false,
      trailingComma: true,
    });
  });

  it("represents whole-line patterns separately from token-line patterns", () => {
    const program = parseSuccessfully(`
      val number: Int;
      val text: String;
      input {
        line(number);
        line(text)
      }
    `);
    const input = program.items[2] as InputBlock;

    expect(input.lines).toEqual([
      expect.objectContaining({
        kind: "ValueLineInputPattern",
        value: expect.objectContaining({
          kind: "NameLineInputPattern",
          name: "number",
        }),
        terminated: true,
      }),
      expect.objectContaining({
        kind: "ValueLineInputPattern",
        value: expect.objectContaining({
          kind: "NameLineInputPattern",
          name: "text",
        }),
        terminated: false,
      }),
    ]);
  });

  it("rejects mixing a whole-line pattern with token patterns", () => {
    const result = parse(`
      val a, b: Int;
      input { line(a), b; }
    `);

    expect(result.program).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "PARSE_EXPECTED_LINE_SEPARATOR",
    );
  });

  it("preserves separate input blocks and top-level empty statements", () => {
    const program = parseSuccessfully(`
      val a, b: Int;
      input { a }
      ;
      input { b; }
    `);

    expect(program.items.map((item) => item.kind)).toEqual([
      "ValDeclaration",
      "InputBlock",
      "EmptyStatement",
      "InputBlock",
    ]);
    expect((program.items[1] as InputBlock).lines[0]).toMatchObject({
      terminated: false,
      tokens: [{ name: "a" }],
    });
    expect((program.items[3] as InputBlock).lines[0]).toMatchObject({
      terminated: true,
      tokens: [{ name: "b" }],
    });
  });

  it("parses all four integer range boundary combinations", () => {
    const program = parseSuccessfully(`
      val a: Int[0..10];
      val b: Int[0..=10];
      val c: Int[0<..10];
      val d: Int[0<..=10];
      input {}
    `);

    const inclusivity = program.items.slice(0, 4).map((item) => {
      const range = ((item as ValDeclaration).valueType as IntType).range;
      return [range?.lowerInclusive, range?.upperInclusive];
    });

    expect(inclusivity).toEqual([
      [true, false],
      [true, true],
      [false, false],
      [false, true],
    ]);
  });

  it("does not perform semantic validation during parsing", () => {
    const program = parseSuccessfully(`
      val duplicate, duplicate: Int;
      input { duplicate, duplicate; }
    `);

    expect(program.items).toHaveLength(2);
  });

  it("parses arithmetic precedence, associativity, unary operators, and parentheses", () => {
    const program = parseSuccessfully(`
      val a, b, c: Int;
      val x: Int[-a + b * (c - 2) / +3 % 2..=10];
      input {}
    `);
    const range = ((program.items[1] as ValDeclaration).valueType as IntType).range;
    const root = range?.lower as BinaryExpression;

    expect(root.operator).toBe("add");
    expect(root.left).toMatchObject({
      kind: "UnaryExpression",
      operator: "minus",
      operand: { kind: "NameExpression", name: "a" },
    });

    const modulo = root.right as BinaryExpression;
    expect(modulo.operator).toBe("modulo");
    expect((modulo.left as BinaryExpression).operator).toBe("divide");
    expect((modulo.right as IntegerLiteral).value).toBe(2n);
  });

  it("collects recoverable parser errors across top-level items", () => {
    const result = parse(`
      val a,: Int;
      val b: Int
      input { a b; }
    `);

    expect(result.program).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "PARSE_EXPECTED_TOKEN",
      "PARSE_EXPECTED_TOKEN",
      "PARSE_EXPECTED_INPUT_SEPARATOR",
    ]);
  });

  it("rejects the obsolete declaration syntax", () => {
    const result = parse("n: Int; input {}");

    expect(result.program).toBeNull();
    expect(result.diagnostics[0]?.code).toBe("PARSE_EXPECTED_TOKEN");
  });

  it("parses Bool, require, expression blocks, and if expressions", () => {
    const program = parseSuccessfully(`
      val condition: Bool;
      input {}
      require(true && !false);
      if (true) {
        require(1 < 2);
        10
      } else if (false) {
        20
      } else {
        30;
        40
      };
    `);

    expect((program.items[0] as ValDeclaration).valueType.kind).toBe("BoolType");
    const requireStatement = program.items[2] as ExpressionStatement;
    expect(requireStatement.expression).toMatchObject({
      kind: "RequireExpression",
      condition: { kind: "BinaryExpression", operator: "logicalAnd" },
    });

    const ifExpression = (program.items[3] as ExpressionStatement)
      .expression as IfExpression;
    expect(ifExpression.kind).toBe("IfExpression");
    expect(ifExpression.thenBranch).toMatchObject({
      kind: "BlockExpression",
      statements: [
        {
          kind: "ExpressionStatement",
          expression: { kind: "RequireExpression" },
        },
      ],
      tail: { kind: "IntegerLiteral", value: 10n },
    });
    expect(ifExpression.elseBranch.kind).toBe("IfExpression");
  });

  it("distinguishes a block tail expression from a semicolon statement", () => {
    const program = parseSuccessfully(`
      input {}
      if (true) { 1 } else { 2; };
    `);
    const expression = (program.items[1] as ExpressionStatement).expression as IfExpression;
    const thenBlock = expression.thenBranch as BlockExpression;
    const elseBlock = expression.elseBranch as BlockExpression;

    expect(thenBlock.tail).toMatchObject({ kind: "IntegerLiteral", value: 1n });
    expect(thenBlock.statements).toEqual([]);
    expect(elseBlock.tail).toBeNull();
    expect(elseBlock.statements).toHaveLength(1);
  });

  it("requires parentheses, else, and a statement semicolon for if", () => {
    const noParentheses = parse("input {} if true 1 else 2;");
    const noElse = parse("input {} if (true) 1;");
    const noSemicolon = parse("input {} if (true) 1 else 2");

    expect(noParentheses.program).toBeNull();
    expect(noElse.program).toBeNull();
    expect(noSemicolon.program).toBeNull();
  });

  it("parses mutable declarations, assignments, and count-based loops", () => {
    const program = parseSuccessfully(`
      var counter: Int;
      input {}
      counter = 0;
      for (10) times {
        counter += 1;
      }
      while (counter < 20) {
        counter *= 2;
      }
    `);

    expect(program.items[0] as VarDeclaration).toMatchObject({
      kind: "VarDeclaration",
      names: [{ name: "counter" }],
    });
    expect(program.items[2]).toMatchObject({
      kind: "AssignmentStatement",
      target: { name: "counter" },
      operator: "assign",
      value: { kind: "IntegerLiteral", value: 0n },
    });
    expect(program.items[3] as ForStatement).toMatchObject({
      kind: "ForStatement",
      count: { kind: "IntegerLiteral", value: 10n },
      body: {
        statements: [
          {
            kind: "AssignmentStatement",
            operator: "addAssign",
          },
        ],
      },
    });
    expect(program.items[4] as WhileStatement).toMatchObject({
      kind: "WhileStatement",
      condition: { kind: "BinaryExpression", operator: "less" },
    });
  });

  it("parses Unit-valued if as a statement without a trailing semicolon", () => {
    const program = parseSuccessfully(`
      input {}
      if (true) {
        require(true);
      } else if (false) {
        require(false);
      } else {}
    `);

    expect(program.items[1] as IfStatement).toMatchObject({
      kind: "IfStatement",
      condition: { kind: "BooleanLiteral", value: true },
      elseBranch: {
        kind: "IfStatement",
      },
    });
  });

  it("allows statement-form if without an else branch", () => {
    const program = parseSuccessfully(`
      input {}
      if (true) {
        require(true);
      }
    `);

    expect(program.items[1] as IfStatement).toMatchObject({
      kind: "IfStatement",
      condition: { kind: "BooleanLiteral", value: true },
      thenBranch: { kind: "BlockExpression", tail: null },
      elseBranch: null,
    });
  });

  it("treats trailing semicolons after statement-form control flow as empty statements", () => {
    const statementIf = parse("input {} if (true) {} else {};");
    const forLoop = parse("input {} for (1) times {};");
    const whileLoop = parse("input {} while (true) {};");

    for (const result of [statementIf, forLoop, whileLoop]) {
      expect(result.diagnostics).toEqual([]);
      expect(result.program?.items.at(-1)).toMatchObject({
        kind: "EmptyStatement",
      });
    }
  });

  it("parses nested Array types, indexed input, and declaration initializers", () => {
    const program = parseSuccessfully(`
      val length: Int = 3;
      val matrix: Array[Array[String[1], length], 2];
      input { matrix[0][1]; }
    `);
    const length = program.items[0] as ValDeclaration;
    const matrix = (program.items[1] as ValDeclaration).valueType as ArrayType;
    const input = program.items[2] as InputBlock;

    expect(length.initializer).toMatchObject({
      kind: "IntegerLiteral",
      value: 3n,
    });
    expect(matrix).toMatchObject({
      kind: "ArrayType",
      elementType: {
        kind: "ArrayType",
        elementType: {
          kind: "StringType",
          length: { kind: "IntegerLiteral", value: 1n },
        },
      },
      length: { kind: "IntegerLiteral", value: 2n },
    });
    expect(input.lines[0]).toMatchObject({
      tokens: [
        {
          kind: "IndexTokenPattern",
          target: {
            kind: "IndexExpression",
            collection: { kind: "IndexExpression" },
          },
        },
      ],
    });
  });

  it("parses indexed assignment as a mutable element target", () => {
    const program = parseSuccessfully(`
      val values: Array[Int, 2];
      input {}
      values[0] = 1;
    `);
    const assignment = program.items[2];

    expect(assignment).toMatchObject({
      kind: "AssignmentStatement",
      target: {
        kind: "IndexExpression",
        collection: { kind: "NameExpression", name: "values" },
        index: { kind: "IntegerLiteral", value: 0n },
      },
    });
    expect(
      (assignment as { target: IndexExpression }).target.kind,
    ).toBe("IndexExpression");
  });

  it("requires one name when a declaration has an initializer", () => {
    const result = parse("val a, b: Int = 0; input {}");

    expect(result.program).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "PARSE_MULTI_DECLARATION_INITIALIZER",
    );
  });
});
