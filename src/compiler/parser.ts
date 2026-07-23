import type {
  BinaryExpression,
  BinaryOperator,
  BlockExpression,
  BooleanLiteral,
  BoolType,
  AssignmentOperator,
  AssignmentStatement,
  AssignmentTarget,
  ArrayType,
  EmptyStatement,
  Expression,
  ExpressionStatement,
  Identifier,
  ForStatement,
  IfExpression,
  IfStatement,
  IndexExpression,
  IndexTokenPattern,
  InputBlock,
  IntRange,
  IntType,
  IntegerLiteral,
  IntegerSign,
  LineInputPattern,
  NameExpression,
  NameLineInputPattern,
  NameTokenPattern,
  Program,
  RequireExpression,
  Statement,
  StringType,
  TokenLineInputPattern,
  TokenInputPattern,
  UnaryExpression,
  UnaryOperator,
  UnitType,
  ValDeclaration,
  VarDeclaration,
  ValueDeclaration,
  ValueLineInputPattern,
  ValueType,
  WhileStatement,
} from "./ast";
import type { Diagnostic } from "./diagnostic";
import { lex } from "./lexer";
import { spanFrom } from "./source";
import { TokenKind, type Token, type TokenKind as TokenKindType } from "./token";

export interface ParseResult {
  readonly program: Program | null;
  readonly diagnostics: readonly Diagnostic[];
}

export function parse(source: string): ParseResult {
  const lexResult = lex(source);
  const parser = new Parser(source, lexResult.tokens);
  const program = parser.parseProgram();
  const diagnostics = [...lexResult.diagnostics, ...parser.getDiagnostics()];
  return {
    program: diagnostics.length === 0 ? program : null,
    diagnostics,
  };
}

class ParseAbort {}

class Parser {
  private current = 0;
  private readonly diagnostics: Diagnostic[] = [];

  public constructor(
    private readonly source: string,
    private readonly tokens: readonly Token[],
  ) {}

  public getDiagnostics(): readonly Diagnostic[] {
    return this.diagnostics;
  }

  public parseProgram(): Program {
    const items: Statement[] = [];
    const start = this.peek().span.start;

    while (!this.check(TokenKind.EndOfFile)) {
      const recoveryOffset = this.current;
      try {
        items.push(this.parseStatement());
      } catch (error: unknown) {
        if (!(error instanceof ParseAbort)) {
          throw error;
        }
        this.synchronize();
        if (this.current === recoveryOffset && !this.check(TokenKind.EndOfFile)) {
          this.advance();
        }
      }
    }

    return {
      kind: "Program",
      source: this.source,
      items,
      span: spanFrom(start, this.peek().span.end),
    };
  }

  private parseStatement(): Statement {
    if (this.match(TokenKind.Val)) {
      return this.parseValueDeclaration(this.previous(), false);
    }
    if (this.match(TokenKind.Var)) {
      return this.parseValueDeclaration(this.previous(), true);
    }
    if (this.match(TokenKind.Input)) {
      return this.parseInputBlock(this.previous());
    }
    if (this.match(TokenKind.For)) {
      return this.parseForStatement(this.previous());
    }
    if (this.match(TokenKind.While)) {
      return this.parseWhileStatement(this.previous());
    }
    if (this.match(TokenKind.If)) {
      const conditional = this.parseIfStatementOrExpression(this.previous());
      if (conditional.kind === "IfStatement") {
        this.rejectTrailingControlSemicolon("statement-form if");
        return conditional;
      }
      const semicolon = this.consume(
        TokenKind.Semicolon,
        "Expected ';' after an expression used as a statement.",
      );
      return {
        kind: "ExpressionStatement",
        expression: conditional,
        span: spanFrom(conditional.span.start, semicolon.span.end),
      };
    }
    if (this.isAssignmentStart()) {
      return this.parseAssignmentStatement();
    }
    if (this.match(TokenKind.Semicolon)) {
      const statement: EmptyStatement = {
        kind: "EmptyStatement",
        span: this.previous().span,
      };
      return statement;
    }

    const expression = this.parseExpression();
    const semicolon = this.consume(
      TokenKind.Semicolon,
      "Expected ';' after an expression used as a statement.",
    );
    return {
      kind: "ExpressionStatement",
      expression,
      span: spanFrom(expression.span.start, semicolon.span.end),
    };
  }

  private parseValueDeclaration(
    keywordToken: Token,
    mutable: boolean,
  ): ValueDeclaration {
    const keyword = mutable ? "var" : "val";
    const names: Identifier[] = [
      this.parseIdentifier(`Expected a name after '${keyword}'.`),
    ];
    while (this.match(TokenKind.Comma)) {
      names.push(this.parseIdentifier("Expected a name after ','."));
    }

    this.consume(TokenKind.Colon, "Expected ':' after the declared name list.");
    const valueType = this.parseType();
    let initializer: Expression | null = null;
    if (this.match(TokenKind.Assign)) {
      if (names.length !== 1) {
        return this.fail(
          this.previous(),
          "PARSE_MULTI_DECLARATION_INITIALIZER",
          "A declaration initializer requires exactly one declared name.",
        );
      }
      initializer = this.parseExpression();
    }
    const semicolon = this.consume(
      TokenKind.Semicolon,
      "Expected ';' after a value declaration.",
    );
    const common = {
      names,
      valueType,
      initializer,
      span: spanFrom(keywordToken.span.start, semicolon.span.end),
    };
    if (mutable) {
      const declaration: VarDeclaration = {
        kind: "VarDeclaration",
        ...common,
      };
      return declaration;
    }
    const declaration: ValDeclaration = {
      kind: "ValDeclaration",
      ...common,
    };
    return declaration;
  }

  private parseAssignmentStatement(): AssignmentStatement {
    const identifier = this.parseIdentifier("Expected an assignment target.");
    let target: AssignmentTarget = identifier;
    if (this.check(TokenKind.LeftBracket)) {
      target = this.parseIndexSuffix({
        kind: "NameExpression",
        name: identifier.name,
        span: identifier.span,
      });
    }
    const operatorToken = this.advance();
    const operator = assignmentOperator(operatorToken);
    const value = this.parseExpression();
    const semicolon = this.consume(
      TokenKind.Semicolon,
      "Expected ';' after an assignment.",
    );
    return {
      kind: "AssignmentStatement",
      target,
      operator,
      value,
      span: spanFrom(target.span.start, semicolon.span.end),
    };
  }

  private parseForStatement(forToken: Token): ForStatement {
    this.consume(TokenKind.LeftParen, "Expected '(' after 'for'.");
    const count = this.parseExpression();
    this.consume(TokenKind.RightParen, "Expected ')' after the repetition count.");
    this.consume(TokenKind.Times, "Expected 'times' after the repetition count.");
    const body = this.parseRequiredBlock("Expected a block after 'times'.");
    this.rejectTrailingControlSemicolon("for");
    return {
      kind: "ForStatement",
      count,
      body,
      span: spanFrom(forToken.span.start, body.span.end),
    };
  }

  private parseWhileStatement(whileToken: Token): WhileStatement {
    this.consume(TokenKind.LeftParen, "Expected '(' after 'while'.");
    const condition = this.parseExpression();
    this.consume(TokenKind.RightParen, "Expected ')' after the while condition.");
    const body = this.parseRequiredBlock("Expected a block after the while condition.");
    this.rejectTrailingControlSemicolon("while");
    return {
      kind: "WhileStatement",
      condition,
      body,
      span: spanFrom(whileToken.span.start, body.span.end),
    };
  }

  private parseRequiredBlock(message: string): BlockExpression {
    const leftBrace = this.consume(TokenKind.LeftBrace, message);
    return this.parseBlockExpression(leftBrace);
  }

  private parseType(): ValueType {
    if (this.match(TokenKind.Int)) {
      return this.parseIntType(this.previous());
    }
    if (this.match(TokenKind.String)) {
      return this.parseStringType(this.previous());
    }
    if (this.match(TokenKind.Array)) {
      return this.parseArrayType(this.previous());
    }
    if (this.match(TokenKind.Bool)) {
      const type: BoolType = { kind: "BoolType", span: this.previous().span };
      return type;
    }
    if (this.match(TokenKind.Unit)) {
      const type: UnitType = { kind: "UnitType", span: this.previous().span };
      return type;
    }
    return this.fail(
      this.peek(),
      "PARSE_EXPECTED_TYPE",
      "Expected 'Int', 'String', 'Array', 'Bool', or 'Unit' after ':'.",
    );
  }

  private parseArrayType(arrayToken: Token): ArrayType {
    this.consume(TokenKind.LeftBracket, "Expected '[' after 'Array'.");
    const elementType = this.parseType();
    this.consume(TokenKind.Comma, "Expected ',' after the Array element type.");
    const length = this.parseExpression();
    const rightBracket = this.consume(
      TokenKind.RightBracket,
      "Expected ']' after the Array length.",
    );
    return {
      kind: "ArrayType",
      elementType,
      length,
      span: spanFrom(arrayToken.span.start, rightBracket.span.end),
    };
  }

  private parseIntType(intToken: Token): IntType {
    let range: IntRange | null = null;
    let end = intToken.span.end;
    if (this.match(TokenKind.LeftBracket)) {
      range = this.parseIntRange();
      const rightBracket = this.consume(
        TokenKind.RightBracket,
        "Expected ']' after the integer range.",
      );
      end = rightBracket.span.end;
    }
    return {
      kind: "IntType",
      range,
      span: spanFrom(intToken.span.start, end),
    };
  }

  private parseIntRange(): IntRange {
    const lower = this.parseExpression();
    const lowerInclusive = !this.match(TokenKind.Less);

    let upperInclusive: boolean;
    if (this.match(TokenKind.DotDotEqual)) {
      upperInclusive = true;
    } else if (this.match(TokenKind.DotDot)) {
      upperInclusive = false;
    } else {
      return this.fail(
        this.peek(),
        "PARSE_EXPECTED_RANGE_OPERATOR",
        "Expected '..' or '..=' in the integer range.",
      );
    }

    const upper = this.parseExpression();
    return {
      kind: "IntRange",
      lower,
      lowerInclusive,
      upper,
      upperInclusive,
      span: spanFrom(lower.span.start, upper.span.end),
    };
  }

  private parseStringType(stringToken: Token): StringType {
    let length: Expression | null = null;
    let end = stringToken.span.end;
    if (this.match(TokenKind.LeftBracket)) {
      length = this.parseExpression();
      const rightBracket = this.consume(
        TokenKind.RightBracket,
        "Expected ']' after the string length.",
      );
      end = rightBracket.span.end;
    }
    return {
      kind: "StringType",
      length,
      span: spanFrom(stringToken.span.start, end),
    };
  }

  private parseExpression(): Expression {
    if (this.match(TokenKind.If)) {
      return this.parseIfExpression(this.previous());
    }
    return this.parseLogicalOrExpression();
  }

  private parseIfExpression(ifToken: Token): IfExpression {
    this.consume(TokenKind.LeftParen, "Expected '(' after 'if'.");
    const condition = this.parseExpression();
    this.consume(TokenKind.RightParen, "Expected ')' after the if condition.");
    const thenBranch = this.parseExpression();
    this.consume(TokenKind.Else, "Expected 'else' after the true branch.");
    const elseBranch = this.parseExpression();
    return {
      kind: "IfExpression",
      condition,
      thenBranch,
      elseBranch,
      span: spanFrom(ifToken.span.start, elseBranch.span.end),
    };
  }

  private parseIfStatementOrExpression(
    ifToken: Token,
  ): IfStatement | IfExpression {
    this.consume(TokenKind.LeftParen, "Expected '(' after 'if'.");
    const condition = this.parseExpression();
    this.consume(TokenKind.RightParen, "Expected ')' after the if condition.");
    const thenBranch = this.parseExpression();

    let elseBranch: Expression | IfStatement | null = null;
    if (this.match(TokenKind.Else)) {
      elseBranch = this.match(TokenKind.If)
        ? this.parseIfStatementOrExpression(this.previous())
        : this.parseExpression();
    }

    if (
      isUnitBlock(thenBranch) &&
      (elseBranch === null ||
        (elseBranch.kind === "IfStatement") ||
        isUnitBlock(elseBranch))
    ) {
      return {
        kind: "IfStatement",
        condition,
        thenBranch,
        elseBranch,
        span: spanFrom(
          ifToken.span.start,
          elseBranch?.span.end ?? thenBranch.span.end,
        ),
      };
    }

    if (elseBranch === null) {
      return this.fail(
        this.peek(),
        "PARSE_EXPECTED_TOKEN",
        "Expected 'else' after the true branch of an if expression.",
      );
    }
    if (elseBranch.kind === "IfStatement") {
      return this.fail(
        this.peek(),
        "PARSE_EXPECTED_EXPRESSION",
        "An if expression cannot use a statement-form else-if branch.",
      );
    }
    return {
      kind: "IfExpression",
      condition,
      thenBranch,
      elseBranch,
      span: spanFrom(ifToken.span.start, elseBranch.span.end),
    };
  }

  private parseLogicalOrExpression(): Expression {
    let expression = this.parseLogicalAndExpression();
    while (this.match(TokenKind.OrOr)) {
      expression = this.binary(
        "logicalOr",
        expression,
        this.parseLogicalAndExpression(),
      );
    }
    return expression;
  }

  private parseLogicalAndExpression(): Expression {
    let expression = this.parseEqualityExpression();
    while (this.match(TokenKind.AndAnd)) {
      expression = this.binary("logicalAnd", expression, this.parseEqualityExpression());
    }
    return expression;
  }

  private parseEqualityExpression(): Expression {
    let expression = this.parseComparisonExpression();
    while (this.check(TokenKind.EqualEqual) || this.check(TokenKind.BangEqual)) {
      const operator =
        this.advance().kind === TokenKind.EqualEqual ? "equal" : "notEqual";
      expression = this.binary(operator, expression, this.parseComparisonExpression());
    }
    return expression;
  }

  private parseComparisonExpression(): Expression {
    let expression = this.parseAdditiveExpression();
    while (
      !this.isLowerExclusiveRangeMarker() &&
      (this.check(TokenKind.Less) ||
        this.check(TokenKind.LessEqual) ||
        this.check(TokenKind.Greater) ||
        this.check(TokenKind.GreaterEqual))
    ) {
      const kind = this.advance().kind;
      const operator: BinaryOperator =
        kind === TokenKind.Less
          ? "less"
          : kind === TokenKind.LessEqual
            ? "lessEqual"
            : kind === TokenKind.Greater
              ? "greater"
              : "greaterEqual";
      expression = this.binary(operator, expression, this.parseAdditiveExpression());
    }
    return expression;
  }

  private parseAdditiveExpression(): Expression {
    let expression = this.parseMultiplicativeExpression();
    while (this.check(TokenKind.Plus) || this.check(TokenKind.Minus)) {
      const operator: BinaryOperator =
        this.advance().kind === TokenKind.Plus ? "add" : "subtract";
      expression = this.binary(operator, expression, this.parseMultiplicativeExpression());
    }
    return expression;
  }

  private parseMultiplicativeExpression(): Expression {
    let expression = this.parseUnaryExpression();
    while (
      this.check(TokenKind.Star) ||
      this.check(TokenKind.Slash) ||
      this.check(TokenKind.Percent)
    ) {
      const kind = this.advance().kind;
      const operator: BinaryOperator =
        kind === TokenKind.Star
          ? "multiply"
          : kind === TokenKind.Slash
            ? "divide"
            : "modulo";
      expression = this.binary(operator, expression, this.parseUnaryExpression());
    }
    return expression;
  }

  private parseUnaryExpression(): Expression {
    let operator: UnaryOperator | null = null;
    let operatorToken: Token | null = null;
    if (this.match(TokenKind.Plus)) {
      operator = "plus";
      operatorToken = this.previous();
    } else if (this.match(TokenKind.Minus)) {
      operator = "minus";
      operatorToken = this.previous();
    } else if (this.match(TokenKind.Bang)) {
      operator = "not";
      operatorToken = this.previous();
    }

    if (
      operatorToken !== null &&
      operator !== "not" &&
      this.match(TokenKind.Integer)
    ) {
      const integerToken = this.previous();
      const sign: IntegerSign = operator === "plus" ? "plus" : "minus";
      const unsignedValue = BigInt(integerToken.lexeme);
      const literal: IntegerLiteral = {
        kind: "IntegerLiteral",
        sign,
        digits: integerToken.lexeme,
        value: sign === "minus" ? -unsignedValue : unsignedValue,
        span: spanFrom(operatorToken.span.start, integerToken.span.end),
      };
      return literal;
    }

    if (operatorToken !== null && operator !== null) {
      const operand = this.parseUnaryExpression();
      const unary: UnaryExpression = {
        kind: "UnaryExpression",
        operator,
        operand,
        span: spanFrom(operatorToken.span.start, operand.span.end),
      };
      return unary;
    }
    return this.parsePostfixExpression();
  }

  private parsePostfixExpression(): Expression {
    let expression = this.parsePrimaryExpression();
    while (this.match(TokenKind.LeftBracket)) {
      const index = this.parseExpression();
      const rightBracket = this.consume(
        TokenKind.RightBracket,
        "Expected ']' after the array index.",
      );
      const indexed: IndexExpression = {
        kind: "IndexExpression",
        collection: expression,
        index,
        span: spanFrom(expression.span.start, rightBracket.span.end),
      };
      expression = indexed;
    }
    return expression;
  }

  private parsePrimaryExpression(): Expression {
    if (this.match(TokenKind.Integer)) {
      const token = this.previous();
      const literal: IntegerLiteral = {
        kind: "IntegerLiteral",
        sign: "none",
        digits: token.lexeme,
        value: BigInt(token.lexeme),
        span: token.span,
      };
      return literal;
    }
    if (this.match(TokenKind.True) || this.match(TokenKind.False)) {
      const token = this.previous();
      const literal: BooleanLiteral = {
        kind: "BooleanLiteral",
        value: token.kind === TokenKind.True,
        span: token.span,
      };
      return literal;
    }
    if (this.match(TokenKind.Identifier)) {
      const token = this.previous();
      const expression: NameExpression = {
        kind: "NameExpression",
        name: token.lexeme,
        span: token.span,
      };
      return expression;
    }
    if (this.match(TokenKind.Require)) {
      return this.parseRequireExpression(this.previous());
    }
    if (this.match(TokenKind.If)) {
      return this.parseIfExpression(this.previous());
    }
    if (this.match(TokenKind.LeftBrace)) {
      return this.parseBlockExpression(this.previous());
    }
    if (this.match(TokenKind.LeftParen)) {
      const leftParen = this.previous();
      const expression = this.parseExpression();
      const rightParen = this.consume(
        TokenKind.RightParen,
        "Expected ')' after the expression.",
      );
      return {
        ...expression,
        span: spanFrom(leftParen.span.start, rightParen.span.end),
      };
    }
    return this.fail(
      this.peek(),
      "PARSE_EXPECTED_EXPRESSION",
      "Expected an expression.",
    );
  }

  private parseRequireExpression(requireToken: Token): RequireExpression {
    this.consume(TokenKind.LeftParen, "Expected '(' after 'require'.");
    const condition = this.parseExpression();
    const rightParen = this.consume(
      TokenKind.RightParen,
      "Expected ')' after the require condition.",
    );
    return {
      kind: "RequireExpression",
      condition,
      span: spanFrom(requireToken.span.start, rightParen.span.end),
    };
  }

  private parseBlockExpression(leftBrace: Token): BlockExpression {
    const statements: Statement[] = [];
    let tail: Expression | null = null;

    while (!this.check(TokenKind.RightBrace) && !this.check(TokenKind.EndOfFile)) {
      if (
        this.check(TokenKind.Val) ||
        this.check(TokenKind.Var) ||
        this.check(TokenKind.Input) ||
        this.check(TokenKind.For) ||
        this.check(TokenKind.While) ||
        this.isAssignmentStart() ||
        this.check(TokenKind.Semicolon)
      ) {
        statements.push(this.parseStatement());
        continue;
      }

      const expression = this.match(TokenKind.If)
        ? this.parseIfStatementOrExpression(this.previous())
        : this.parseExpression();
      if (expression.kind === "IfStatement") {
        this.rejectTrailingControlSemicolon("statement-form if");
        statements.push(expression);
        continue;
      }
      if (this.match(TokenKind.Semicolon)) {
        const statement: ExpressionStatement = {
          kind: "ExpressionStatement",
          expression,
          span: spanFrom(expression.span.start, this.previous().span.end),
        };
        statements.push(statement);
        continue;
      }
      tail = expression;
      if (!this.check(TokenKind.RightBrace)) {
        return this.fail(
          this.peek(),
          "PARSE_EXPECTED_BLOCK_SEPARATOR",
          "Expected ';' or '}' after an expression in a block.",
        );
      }
    }

    const rightBrace = this.consume(TokenKind.RightBrace, "Expected '}' after the block.");
    return {
      kind: "BlockExpression",
      statements,
      tail,
      span: spanFrom(leftBrace.span.start, rightBrace.span.end),
    };
  }

  private binary(
    operator: BinaryOperator,
    left: Expression,
    right: Expression,
  ): BinaryExpression {
    return {
      kind: "BinaryExpression",
      operator,
      left,
      right,
      span: spanFrom(left.span.start, right.span.end),
    };
  }

  private parseInputBlock(inputToken: Token): InputBlock {
    this.consume(TokenKind.LeftBrace, "Expected '{' after 'input'.");
    const lines: LineInputPattern[] = [];
    while (!this.check(TokenKind.RightBrace) && !this.check(TokenKind.EndOfFile)) {
      lines.push(this.parseLineInputPattern());
    }
    const rightBrace = this.consume(TokenKind.RightBrace, "Expected '}' after the input block.");
    return {
      kind: "InputBlock",
      lines,
      span: spanFrom(inputToken.span.start, rightBrace.span.end),
    };
  }

  private parseLineInputPattern(): LineInputPattern {
    if (this.match(TokenKind.Line)) {
      return this.parseValueLineInputPattern(this.previous());
    }
    if (this.match(TokenKind.Semicolon)) {
      return {
        kind: "TokenLineInputPattern",
        tokens: [],
        terminated: true,
        trailingComma: false,
        span: this.previous().span,
      };
    }

    const tokens: TokenInputPattern[] = [this.parseTokenInputPattern()];
    let trailingComma = false;
    while (this.match(TokenKind.Comma)) {
      trailingComma = true;
      if (this.check(TokenKind.Identifier)) {
        tokens.push(this.parseTokenInputPattern());
        trailingComma = false;
        continue;
      }
      if (this.check(TokenKind.Semicolon) || this.check(TokenKind.RightBrace)) {
        break;
      }
      return this.fail(
        this.peek(),
        "PARSE_EXPECTED_TOKEN_PATTERN",
        "Expected a token input pattern after ','.",
      );
    }

    const start = tokens[0]?.span.start ?? this.peek().span.start;
    if (this.match(TokenKind.Semicolon)) {
      const line: TokenLineInputPattern = {
        kind: "TokenLineInputPattern",
        tokens,
        terminated: true,
        trailingComma,
        span: spanFrom(start, this.previous().span.end),
      };
      return line;
    }
    if (this.check(TokenKind.RightBrace)) {
      const end = trailingComma ? this.previous().span.end : tokens[tokens.length - 1]?.span.end;
      return {
        kind: "TokenLineInputPattern",
        tokens,
        terminated: false,
        trailingComma,
        span: spanFrom(start, end ?? start),
      };
    }
    return this.fail(
      this.peek(),
      "PARSE_EXPECTED_INPUT_SEPARATOR",
      "Expected ',', ';', or '}' after a token input pattern.",
    );
  }

  private parseValueLineInputPattern(lineToken: Token): ValueLineInputPattern {
    this.consume(TokenKind.LeftParen, "Expected '(' after 'line'.");
    const name = this.consume(
      TokenKind.Identifier,
      "Expected a value name inside 'line(...)'.",
    );
    const rightParen = this.consume(
      TokenKind.RightParen,
      "Expected ')' after the value name in 'line(...)'.",
    );
    const value: NameLineInputPattern = {
      kind: "NameLineInputPattern",
      name: name.lexeme,
      span: name.span,
    };

    if (this.match(TokenKind.Semicolon)) {
      return {
        kind: "ValueLineInputPattern",
        value,
        terminated: true,
        span: spanFrom(lineToken.span.start, this.previous().span.end),
      };
    }
    if (this.check(TokenKind.RightBrace)) {
      return {
        kind: "ValueLineInputPattern",
        value,
        terminated: false,
        span: spanFrom(lineToken.span.start, rightParen.span.end),
      };
    }
    return this.fail(
      this.peek(),
      "PARSE_EXPECTED_LINE_SEPARATOR",
      "Expected ';' or '}' after a line input pattern.",
    );
  }

  private parseTokenInputPattern(): TokenInputPattern {
    const token = this.consume(
      TokenKind.Identifier,
      "Expected a name as the token input pattern.",
    );
    const namePattern: NameTokenPattern = {
      kind: "NameTokenPattern",
      name: token.lexeme,
      span: token.span,
    };
    if (!this.check(TokenKind.LeftBracket)) {
      return namePattern;
    }
    const target = this.parseIndexSuffix({
      kind: "NameExpression",
      name: token.lexeme,
      span: token.span,
    });
    const pattern: IndexTokenPattern = {
      kind: "IndexTokenPattern",
      target,
      span: target.span,
    };
    return pattern;
  }

  private parseIndexSuffix(collection: Expression): IndexExpression {
    let current = collection;
    do {
      this.consume(TokenKind.LeftBracket, "Expected '[' before the array index.");
      const index = this.parseExpression();
      const rightBracket = this.consume(
        TokenKind.RightBracket,
        "Expected ']' after the array index.",
      );
      current = {
        kind: "IndexExpression",
        collection: current,
        index,
        span: spanFrom(current.span.start, rightBracket.span.end),
      };
    } while (this.check(TokenKind.LeftBracket));
    return current as IndexExpression;
  }

  private parseIdentifier(message: string): Identifier {
    const token = this.consume(TokenKind.Identifier, message);
    return { kind: "Identifier", name: token.lexeme, span: token.span };
  }

  private isLowerExclusiveRangeMarker(): boolean {
    return (
      this.check(TokenKind.Less) &&
      (this.peekNext().kind === TokenKind.DotDot ||
        this.peekNext().kind === TokenKind.DotDotEqual)
    );
  }

  private isAssignmentStart(): boolean {
    if (!this.check(TokenKind.Identifier)) {
      return false;
    }
    let offset = this.current + 1;
    while (this.tokens[offset]?.kind === TokenKind.LeftBracket) {
      let depth = 0;
      do {
        const kind = this.tokens[offset]?.kind;
        if (kind === TokenKind.LeftBracket) depth += 1;
        if (kind === TokenKind.RightBracket) depth -= 1;
        offset += 1;
        if (kind === TokenKind.EndOfFile) return false;
      } while (depth > 0);
    }
    return isAssignmentToken(this.tokens[offset]?.kind ?? TokenKind.EndOfFile);
  }

  private rejectTrailingControlSemicolon(name: string): void {
    if (this.check(TokenKind.Semicolon)) {
      this.fail(
        this.peek(),
        "PARSE_UNEXPECTED_STATEMENT_SEMICOLON",
        `A ${name} statement must not be followed by ';'.`,
      );
    }
  }

  private consume(kind: TokenKindType, message: string): Token {
    if (this.check(kind)) {
      return this.advance();
    }
    return this.fail(this.peek(), "PARSE_EXPECTED_TOKEN", message);
  }

  private synchronize(): void {
    while (!this.check(TokenKind.EndOfFile)) {
      if (this.previous().kind === TokenKind.Semicolon) {
        if (this.check(TokenKind.RightBrace)) {
          this.advance();
        }
        return;
      }
      if (
        this.check(TokenKind.Val) ||
        this.check(TokenKind.Var) ||
        this.check(TokenKind.Input) ||
        this.check(TokenKind.For) ||
        this.check(TokenKind.While) ||
        this.check(TokenKind.Require) ||
        this.check(TokenKind.If)
      ) {
        return;
      }
      this.advance();
    }
  }

  private fail(token: Token, code: string, message: string): never {
    this.diagnostics.push({
      stage: "parser",
      severity: "error",
      code,
      message,
      span: token.span,
    });
    throw new ParseAbort();
  }

  private match(kind: TokenKindType): boolean {
    if (!this.check(kind)) {
      return false;
    }
    this.advance();
    return true;
  }

  private check(kind: TokenKindType): boolean {
    return this.peek().kind === kind;
  }

  private advance(): Token {
    if (!this.check(TokenKind.EndOfFile)) {
      this.current += 1;
    }
    return this.previous();
  }

  private peek(): Token {
    return this.tokens[this.current] ?? this.tokens[this.tokens.length - 1]!;
  }

  private peekNext(): Token {
    return this.tokens[this.current + 1] ?? this.tokens[this.tokens.length - 1]!;
  }

  private previous(): Token {
    return this.tokens[this.current - 1] ?? this.tokens[0]!;
  }
}

function isAssignmentToken(kind: TokenKindType): boolean {
  return (
    kind === TokenKind.Assign ||
    kind === TokenKind.PlusEqual ||
    kind === TokenKind.MinusEqual ||
    kind === TokenKind.StarEqual ||
    kind === TokenKind.SlashEqual ||
    kind === TokenKind.PercentEqual
  );
}

function assignmentOperator(token: Token): AssignmentOperator {
  switch (token.kind) {
    case TokenKind.Assign:
      return "assign";
    case TokenKind.PlusEqual:
      return "addAssign";
    case TokenKind.MinusEqual:
      return "subtractAssign";
    case TokenKind.StarEqual:
      return "multiplyAssign";
    case TokenKind.SlashEqual:
      return "divideAssign";
    case TokenKind.PercentEqual:
      return "moduloAssign";
    default:
      throw new Error("Parser called assignmentOperator with a non-assignment token.");
  }
}

function isUnitBlock(
  value: Expression | IfStatement,
): value is BlockExpression {
  return value.kind === "BlockExpression" && value.tail === null;
}
