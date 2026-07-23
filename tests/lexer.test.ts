import { describe, expect, it } from "vitest";

import { lex, TokenKind } from "../src/compiler";

describe("lexer", () => {
  it("tokenizes the current syntax and skips comments", () => {
    const result = lex(`
      val n: Int[- 10<..=+ 20]; // bounds
      val s: String[n];
      input { n, s,; }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.map((token) => token.kind)).toEqual([
      TokenKind.Val,
      TokenKind.Identifier,
      TokenKind.Colon,
      TokenKind.Int,
      TokenKind.LeftBracket,
      TokenKind.Minus,
      TokenKind.Integer,
      TokenKind.Less,
      TokenKind.DotDotEqual,
      TokenKind.Plus,
      TokenKind.Integer,
      TokenKind.RightBracket,
      TokenKind.Semicolon,
      TokenKind.Val,
      TokenKind.Identifier,
      TokenKind.Colon,
      TokenKind.String,
      TokenKind.LeftBracket,
      TokenKind.Identifier,
      TokenKind.RightBracket,
      TokenKind.Semicolon,
      TokenKind.Input,
      TokenKind.LeftBrace,
      TokenKind.Identifier,
      TokenKind.Comma,
      TokenKind.Identifier,
      TokenKind.Comma,
      TokenKind.Semicolon,
      TokenKind.RightBrace,
      TokenKind.EndOfFile,
    ]);
  });

  it("reserves line as the whole-line input pattern keyword", () => {
    const result = lex("input { line(value); }");

    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.map((token) => token.kind)).toEqual([
      TokenKind.Input,
      TokenKind.LeftBrace,
      TokenKind.Line,
      TokenKind.LeftParen,
      TokenKind.Identifier,
      TokenKind.RightParen,
      TokenKind.Semicolon,
      TokenKind.RightBrace,
      TokenKind.EndOfFile,
    ]);
  });

  it("tracks one-based lines and columns across CRLF", () => {
    const result = lex("// comment\r\nval n: Int;\r\ninput {}");
    const valToken = result.tokens.find((token) => token.kind === TokenKind.Val);
    const inputToken = result.tokens.find((token) => token.kind === TokenKind.Input);

    expect(valToken?.span.start).toMatchObject({ line: 2, column: 1 });
    expect(inputToken?.span.start).toMatchObject({ line: 3, column: 1 });
  });

  it("collects recoverable lexical errors", () => {
    const result = lex("val a: Int[01..2]; @ val b: Int;");

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "LEX_LEADING_ZERO",
      "LEX_UNEXPECTED_CHARACTER",
    ]);
    expect(result.tokens.some((token) => token.lexeme === "b")).toBe(true);
  });

  it("uses longest matches for range operators", () => {
    const result = lex(".. ..=");

    expect(result.tokens.map((token) => token.kind)).toEqual([
      TokenKind.DotDot,
      TokenKind.DotDotEqual,
      TokenKind.EndOfFile,
    ]);
  });

  it("tokenizes every integer arithmetic operator and parentheses", () => {
    const result = lex("(a + b) * c / d % e - -f");

    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.map((token) => token.kind)).toEqual([
      TokenKind.LeftParen,
      TokenKind.Identifier,
      TokenKind.Plus,
      TokenKind.Identifier,
      TokenKind.RightParen,
      TokenKind.Star,
      TokenKind.Identifier,
      TokenKind.Slash,
      TokenKind.Identifier,
      TokenKind.Percent,
      TokenKind.Identifier,
      TokenKind.Minus,
      TokenKind.Minus,
      TokenKind.Identifier,
      TokenKind.EndOfFile,
    ]);
  });

  it("tokenizes Bool, control-flow keywords, and condition operators", () => {
    const result = lex(
      "val b: Bool; require(if (true && !false) 1 <= 2 else 3 != 4); Unit || a > b",
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.map((token) => token.kind)).toEqual(
      expect.arrayContaining([
        TokenKind.Bool,
        TokenKind.Require,
        TokenKind.If,
        TokenKind.True,
        TokenKind.AndAnd,
        TokenKind.Bang,
        TokenKind.False,
        TokenKind.LessEqual,
        TokenKind.Else,
        TokenKind.BangEqual,
        TokenKind.Unit,
        TokenKind.OrOr,
        TokenKind.Greater,
      ]),
    );
  });

  it("tokenizes mutable declarations, loops, and assignment operators", () => {
    const result = lex(
      "var x: Int; x = 1; x += 2; x -= 3; x *= 4; x /= 5; x %= 6; for (x) times {} while (true) {}",
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.map((token) => token.kind)).toEqual(
      expect.arrayContaining([
        TokenKind.Var,
        TokenKind.Assign,
        TokenKind.PlusEqual,
        TokenKind.MinusEqual,
        TokenKind.StarEqual,
        TokenKind.SlashEqual,
        TokenKind.PercentEqual,
        TokenKind.For,
        TokenKind.Times,
        TokenKind.While,
      ]),
    );
  });

  it("reserves Array and tokenizes indexed access", () => {
    const result = lex("val values: Array[String[1], 3]; values[0]");

    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.map((token) => token.kind)).toEqual(
      expect.arrayContaining([
        TokenKind.Array,
        TokenKind.String,
        TokenKind.LeftBracket,
        TokenKind.RightBracket,
      ]),
    );
  });
});
