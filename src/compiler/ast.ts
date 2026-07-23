import type { SourceSpan } from "./source";

export interface Program {
  readonly kind: "Program";
  readonly source: string;
  readonly items: readonly Statement[];
  readonly span: SourceSpan;
}

export type TopLevelItem = Statement;

export type Statement =
  | ValDeclaration
  | VarDeclaration
  | InputBlock
  | AssignmentStatement
  | IfStatement
  | ForStatement
  | WhileStatement
  | ExpressionStatement
  | EmptyStatement;

export interface EmptyStatement {
  readonly kind: "EmptyStatement";
  readonly span: SourceSpan;
}

export interface ExpressionStatement {
  readonly kind: "ExpressionStatement";
  readonly expression: Expression;
  readonly span: SourceSpan;
}

export interface ValDeclaration {
  readonly kind: "ValDeclaration";
  readonly names: readonly Identifier[];
  readonly valueType: ValueType;
  readonly initializer: Expression | null;
  readonly span: SourceSpan;
}

export interface VarDeclaration {
  readonly kind: "VarDeclaration";
  readonly names: readonly Identifier[];
  readonly valueType: ValueType;
  readonly initializer: Expression | null;
  readonly span: SourceSpan;
}

export type ValueDeclaration = ValDeclaration | VarDeclaration;

export type AssignmentOperator =
  | "assign"
  | "addAssign"
  | "subtractAssign"
  | "multiplyAssign"
  | "divideAssign"
  | "moduloAssign";

export interface AssignmentStatement {
  readonly kind: "AssignmentStatement";
  readonly target: AssignmentTarget;
  readonly operator: AssignmentOperator;
  readonly value: Expression;
  readonly span: SourceSpan;
}

export type AssignmentTarget = Identifier | IndexExpression;

export interface IfStatement {
  readonly kind: "IfStatement";
  readonly condition: Expression;
  readonly thenBranch: BlockExpression;
  readonly elseBranch: BlockExpression | IfStatement | null;
  readonly span: SourceSpan;
}

export interface ForStatement {
  readonly kind: "ForStatement";
  readonly count: Expression;
  readonly body: BlockExpression;
  readonly span: SourceSpan;
}

export interface WhileStatement {
  readonly kind: "WhileStatement";
  readonly condition: Expression;
  readonly body: BlockExpression;
  readonly span: SourceSpan;
}

export interface Identifier {
  readonly kind: "Identifier";
  readonly name: string;
  readonly span: SourceSpan;
}

export type ValueType = IntType | StringType | ArrayType | BoolType | UnitType;

export interface IntType {
  readonly kind: "IntType";
  readonly range: IntRange | null;
  readonly span: SourceSpan;
}

export interface StringType {
  readonly kind: "StringType";
  readonly length: Expression | null;
  readonly span: SourceSpan;
}

export interface ArrayType {
  readonly kind: "ArrayType";
  readonly elementType: ValueType;
  readonly length: Expression;
  readonly span: SourceSpan;
}

export interface BoolType {
  readonly kind: "BoolType";
  readonly span: SourceSpan;
}

export interface UnitType {
  readonly kind: "UnitType";
  readonly span: SourceSpan;
}

export interface IntRange {
  readonly kind: "IntRange";
  readonly lower: Expression;
  readonly lowerInclusive: boolean;
  readonly upper: Expression;
  readonly upperInclusive: boolean;
  readonly span: SourceSpan;
}

export type Expression =
  | IntegerLiteral
  | BooleanLiteral
  | NameExpression
  | IndexExpression
  | UnaryExpression
  | BinaryExpression
  | RequireExpression
  | IfExpression
  | BlockExpression;

export type IntExpression = Expression;

export type IntegerSign = "none" | "plus" | "minus";

export interface IntegerLiteral {
  readonly kind: "IntegerLiteral";
  readonly sign: IntegerSign;
  readonly digits: string;
  readonly value: bigint;
  readonly span: SourceSpan;
}

export interface BooleanLiteral {
  readonly kind: "BooleanLiteral";
  readonly value: boolean;
  readonly span: SourceSpan;
}

export interface NameExpression {
  readonly kind: "NameExpression";
  readonly name: string;
  readonly span: SourceSpan;
}

export interface IndexExpression {
  readonly kind: "IndexExpression";
  readonly collection: Expression;
  readonly index: Expression;
  readonly span: SourceSpan;
}

export type UnaryOperator = "plus" | "minus" | "not";

export interface UnaryExpression {
  readonly kind: "UnaryExpression";
  readonly operator: UnaryOperator;
  readonly operand: Expression;
  readonly span: SourceSpan;
}

export type BinaryOperator =
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "modulo"
  | "equal"
  | "notEqual"
  | "less"
  | "lessEqual"
  | "greater"
  | "greaterEqual"
  | "logicalAnd"
  | "logicalOr";

export interface BinaryExpression {
  readonly kind: "BinaryExpression";
  readonly operator: BinaryOperator;
  readonly left: Expression;
  readonly right: Expression;
  readonly span: SourceSpan;
}

export interface RequireExpression {
  readonly kind: "RequireExpression";
  readonly condition: Expression;
  readonly span: SourceSpan;
}

export interface IfExpression {
  readonly kind: "IfExpression";
  readonly condition: Expression;
  readonly thenBranch: Expression;
  readonly elseBranch: Expression;
  readonly span: SourceSpan;
}

export interface BlockExpression {
  readonly kind: "BlockExpression";
  readonly statements: readonly Statement[];
  readonly tail: Expression | null;
  readonly span: SourceSpan;
}

export interface InputBlock {
  readonly kind: "InputBlock";
  readonly lines: readonly LineInputPattern[];
  readonly span: SourceSpan;
}

export type LineInputPattern = TokenLineInputPattern | ValueLineInputPattern;

export interface TokenLineInputPattern {
  readonly kind: "TokenLineInputPattern";
  readonly tokens: readonly TokenInputPattern[];
  readonly terminated: boolean;
  readonly trailingComma: boolean;
  readonly span: SourceSpan;
}

export interface ValueLineInputPattern {
  readonly kind: "ValueLineInputPattern";
  readonly value: NameLineInputPattern;
  readonly terminated: boolean;
  readonly span: SourceSpan;
}

export interface NameLineInputPattern {
  readonly kind: "NameLineInputPattern";
  readonly name: string;
  readonly span: SourceSpan;
}

export type TokenInputPattern = NameTokenPattern | IndexTokenPattern;

export interface NameTokenPattern {
  readonly kind: "NameTokenPattern";
  readonly name: string;
  readonly span: SourceSpan;
}

export interface IndexTokenPattern {
  readonly kind: "IndexTokenPattern";
  readonly target: IndexExpression;
  readonly span: SourceSpan;
}
