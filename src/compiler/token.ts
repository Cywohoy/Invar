import type { SourceSpan } from "./source";

export const TokenKind = {
  Identifier: "Identifier",
  Integer: "Integer",
  Val: "Val",
  Var: "Var",
  For: "For",
  Times: "Times",
  While: "While",
  Input: "Input",
  Line: "Line",
  Require: "Require",
  If: "If",
  Else: "Else",
  True: "True",
  False: "False",
  Int: "Int",
  String: "String",
  Array: "Array",
  Bool: "Bool",
  Unit: "Unit",
  Colon: "Colon",
  Comma: "Comma",
  Semicolon: "Semicolon",
  LeftBracket: "LeftBracket",
  RightBracket: "RightBracket",
  LeftBrace: "LeftBrace",
  RightBrace: "RightBrace",
  Plus: "Plus",
  PlusEqual: "PlusEqual",
  Minus: "Minus",
  MinusEqual: "MinusEqual",
  Star: "Star",
  StarEqual: "StarEqual",
  Slash: "Slash",
  SlashEqual: "SlashEqual",
  Percent: "Percent",
  PercentEqual: "PercentEqual",
  LeftParen: "LeftParen",
  RightParen: "RightParen",
  Bang: "Bang",
  BangEqual: "BangEqual",
  EqualEqual: "EqualEqual",
  Assign: "Assign",
  Less: "Less",
  LessEqual: "LessEqual",
  Greater: "Greater",
  GreaterEqual: "GreaterEqual",
  AndAnd: "AndAnd",
  OrOr: "OrOr",
  DotDot: "DotDot",
  DotDotEqual: "DotDotEqual",
  EndOfFile: "EndOfFile",
} as const;

export type TokenKind = (typeof TokenKind)[keyof typeof TokenKind];

export interface Token {
  readonly kind: TokenKind;
  readonly lexeme: string;
  readonly span: SourceSpan;
}
