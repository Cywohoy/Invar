import type { Diagnostic } from "./diagnostic";
import { spanFrom, type SourcePosition } from "./source";
import { TokenKind, type Token, type TokenKind as TokenKindType } from "./token";

export interface LexResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
}

const KEYWORDS: Readonly<Record<string, TokenKindType>> = {
  val: TokenKind.Val,
  var: TokenKind.Var,
  fn: TokenKind.Fn,
  return: TokenKind.Return,
  break: TokenKind.Break,
  continue: TokenKind.Continue,
  for: TokenKind.For,
  times: TokenKind.Times,
  while: TokenKind.While,
  input: TokenKind.Input,
  line: TokenKind.Line,
  require: TokenKind.Require,
  if: TokenKind.If,
  else: TokenKind.Else,
  true: TokenKind.True,
  false: TokenKind.False,
  Int: TokenKind.Int,
  String: TokenKind.String,
  Array: TokenKind.Array,
  Array_v: TokenKind.ArrayV,
  Byte: TokenKind.Byte,
  Regex: TokenKind.Regex,
  Bool: TokenKind.Bool,
  Unit: TokenKind.Unit,
};

export function lex(source: string): LexResult {
  const scanner = new Lexer(source);
  return scanner.scan();
}

class Lexer {
  private offset = 0;
  private line = 1;
  private column = 1;
  private readonly tokens: Token[] = [];
  private readonly diagnostics: Diagnostic[] = [];

  public constructor(private readonly source: string) {}

  public scan(): LexResult {
    while (!this.isAtEnd()) {
      this.skipTrivia();
      if (this.isAtEnd()) {
        break;
      }
      this.scanToken();
    }

    const position = this.position();
    this.tokens.push({
      kind: TokenKind.EndOfFile,
      lexeme: "",
      span: spanFrom(position, position),
    });

    return {
      tokens: this.tokens,
      diagnostics: this.diagnostics,
    };
  }

  private scanToken(): void {
    const start = this.position();
    const character = this.peek();

    if (character === "r" && this.peekNext() === "\"") {
      this.advance();
      this.scanQuotedLiteral(start, "\"", TokenKind.RegexLiteral);
      return;
    }

    if (isIdentifierStart(character)) {
      this.scanIdentifier(start);
      return;
    }

    if (isDigit(character)) {
      this.scanInteger(start);
      return;
    }

    switch (character) {
      case "'":
        this.scanQuotedLiteral(start, "'", TokenKind.ByteLiteral);
        return;
      case "\"":
        this.scanQuotedLiteral(start, "\"", TokenKind.StringLiteral);
        return;
      case "`":
        this.scanInputLiteral(start);
        return;
      case ":":
        this.singleCharacterToken(TokenKind.Colon, start);
        return;
      case ",":
        this.singleCharacterToken(TokenKind.Comma, start);
        return;
      case ";":
        this.singleCharacterToken(TokenKind.Semicolon, start);
        return;
      case "[":
        this.singleCharacterToken(TokenKind.LeftBracket, start);
        return;
      case "]":
        this.singleCharacterToken(TokenKind.RightBracket, start);
        return;
      case "{":
        this.singleCharacterToken(TokenKind.LeftBrace, start);
        return;
      case "}":
        this.singleCharacterToken(TokenKind.RightBrace, start);
        return;
      case "+":
        this.scanOptionalEqual(TokenKind.Plus, TokenKind.PlusEqual, start);
        return;
      case "-":
        this.scanOptionalEqual(TokenKind.Minus, TokenKind.MinusEqual, start);
        return;
      case "*":
        this.scanOptionalEqual(TokenKind.Star, TokenKind.StarEqual, start);
        return;
      case "/":
        this.scanOptionalEqual(TokenKind.Slash, TokenKind.SlashEqual, start);
        return;
      case "%":
        this.scanOptionalEqual(TokenKind.Percent, TokenKind.PercentEqual, start);
        return;
      case "(":
        this.singleCharacterToken(TokenKind.LeftParen, start);
        return;
      case ")":
        this.singleCharacterToken(TokenKind.RightParen, start);
        return;
      case "<":
        this.scanOptionalEqual(TokenKind.Less, TokenKind.LessEqual, start);
        return;
      case ">":
        this.scanOptionalEqual(TokenKind.Greater, TokenKind.GreaterEqual, start);
        return;
      case "!":
        this.scanOptionalEqual(TokenKind.Bang, TokenKind.BangEqual, start);
        return;
      case "=":
        this.scanOptionalEqual(TokenKind.Assign, TokenKind.EqualEqual, start);
        return;
      case "&":
        this.scanRequiredPair("&", TokenKind.AndAnd, start);
        return;
      case "|":
        this.scanRequiredPair("|", TokenKind.OrOr, start);
        return;
      case ".":
        this.scanRangeOperator(start);
        return;
      default:
        this.advance();
        this.diagnostics.push({
          stage: "lexer",
          severity: "error",
          code: "LEX_UNEXPECTED_CHARACTER",
          message: `Unexpected character ${JSON.stringify(character)}.`,
          span: spanFrom(start, this.position()),
        });
    }
  }

  private scanIdentifier(start: SourcePosition): void {
    this.advance();
    while (isIdentifierContinue(this.peek())) {
      this.advance();
    }

    const lexeme = this.source.slice(start.offset, this.offset);
    this.addToken(KEYWORDS[lexeme] ?? TokenKind.Identifier, start, lexeme);
  }

  private scanInteger(start: SourcePosition): void {
    this.advance();
    while (isDigit(this.peek())) {
      this.advance();
    }

    const lexeme = this.source.slice(start.offset, this.offset);
    this.addToken(TokenKind.Integer, start, lexeme);

    if (lexeme.length > 1 && lexeme.startsWith("0")) {
      this.diagnostics.push({
        stage: "lexer",
        severity: "error",
        code: "LEX_LEADING_ZERO",
        message: "Integer literals cannot contain leading zeroes.",
        span: spanFrom(start, this.position()),
      });
    }
  }

  private scanRangeOperator(start: SourcePosition): void {
    this.advance();
    if (this.peek() !== ".") {
      this.addToken(TokenKind.Dot, start);
      return;
    }

    this.advance();
    if (this.peek() === "=") {
      this.advance();
      this.addToken(TokenKind.DotDotEqual, start);
      return;
    }

    this.addToken(TokenKind.DotDot, start);
  }

  private scanQuotedLiteral(
    start: SourcePosition,
    delimiter: "'" | "\"",
    kind: TokenKindType,
  ): void {
    this.advance();
    let escaped = false;
    while (!this.isAtEnd()) {
      const character = this.peek();
      if (character === "\r" || character === "\n") {
        break;
      }
      this.advance();
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === delimiter) {
        this.addToken(kind, start);
        return;
      }
    }
    this.diagnostics.push({
      stage: "lexer",
      severity: "error",
      code: "LEX_UNTERMINATED_LITERAL",
      message: "Literal must be closed before the end of the line.",
      span: spanFrom(start, this.position()),
    });
  }

  private scanInputLiteral(start: SourcePosition): void {
    this.advance();
    const isLine = this.peek() === "`";
    if (isLine) this.advance();
    const delimiterLength = isLine ? 2 : 1;
    let escaped = false;
    while (!this.isAtEnd()) {
      const character = this.peek();
      if (character === "\r" || character === "\n") break;
      if (!escaped && character === "`") {
        this.advance();
        if (delimiterLength === 1 || this.peek() === "`") {
          if (delimiterLength === 2) this.advance();
          this.addToken(
            isLine ? TokenKind.LineInputLiteral : TokenKind.TokenInputLiteral,
            start,
          );
          return;
        }
        continue;
      }
      this.advance();
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
    }
    this.diagnostics.push({
      stage: "lexer",
      severity: "error",
      code: "LEX_UNTERMINATED_LITERAL",
      message: "Input literal must be closed before the end of the line.",
      span: spanFrom(start, this.position()),
    });
  }

  private scanOptionalEqual(
    single: TokenKindType,
    paired: TokenKindType,
    start: SourcePosition,
  ): void {
    this.advance();
    if (this.peek() === "=") {
      this.advance();
      this.addToken(paired, start);
      return;
    }
    this.addToken(single, start);
  }

  private scanRequiredPair(
    expected: string,
    kind: TokenKindType,
    start: SourcePosition,
  ): void {
    const first = this.advance();
    if (this.peek() === expected) {
      this.advance();
      this.addToken(kind, start);
      return;
    }
    this.diagnostics.push({
      stage: "lexer",
      severity: "error",
      code: "LEX_UNEXPECTED_CHARACTER",
      message: `A single ${JSON.stringify(first)} is not valid here.`,
      span: spanFrom(start, this.position()),
    });
  }

  private skipTrivia(): void {
    let skipped = true;
    while (skipped && !this.isAtEnd()) {
      skipped = false;

      while (isWhitespace(this.peek())) {
        this.advance();
        skipped = true;
      }

      if (this.peek() === "/" && this.peekNext() === "/") {
        skipped = true;
        this.advance();
        this.advance();
        while (!this.isAtEnd() && this.peek() !== "\r" && this.peek() !== "\n") {
          this.advance();
        }
      }
    }
  }

  private singleCharacterToken(kind: TokenKindType, start: SourcePosition): void {
    this.advance();
    this.addToken(kind, start);
  }

  private addToken(
    kind: TokenKindType,
    start: SourcePosition,
    lexeme = this.source.slice(start.offset, this.offset),
  ): void {
    this.tokens.push({
      kind,
      lexeme,
      span: spanFrom(start, this.position()),
    });
  }

  private advance(): string {
    if (this.isAtEnd()) {
      return "";
    }

    const character = this.source[this.offset] ?? "";
    if (character === "\r") {
      this.offset += 1;
      if (this.source[this.offset] === "\n") {
        this.offset += 1;
      }
      this.line += 1;
      this.column = 1;
      return character;
    }

    this.offset += 1;
    if (character === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return character;
  }

  private peek(): string {
    return this.source[this.offset] ?? "";
  }

  private peekNext(): string {
    return this.source[this.offset + 1] ?? "";
  }

  private isAtEnd(): boolean {
    return this.offset >= this.source.length;
  }

  private position(): SourcePosition {
    return {
      offset: this.offset,
      line: this.line,
      column: this.column,
    };
  }
}

function isIdentifierStart(character: string): boolean {
  return (
    character === "_" ||
    (character >= "A" && character <= "Z") ||
    (character >= "a" && character <= "z")
  );
}

function isIdentifierContinue(character: string): boolean {
  return isIdentifierStart(character) || isDigit(character);
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\r" || character === "\n";
}
