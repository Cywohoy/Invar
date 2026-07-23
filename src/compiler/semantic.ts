import type {
  ArrayType,
  AssignmentStatement,
  BinaryOperator,
  Expression,
  ForStatement,
  IfStatement,
  IndexExpression,
  IndexTokenPattern,
  InputBlock,
  IntType,
  NameExpression,
  NameLineInputPattern,
  NameTokenPattern,
  Program,
  Statement,
  StringType,
  ValueDeclaration,
  ValueType,
  WhileStatement,
} from "./ast";
import type { Diagnostic } from "./diagnostic";
import type { SourceSpan } from "./source";

const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;

export interface IntegerInterval {
  readonly minimum: bigint;
  readonly maximum: bigint;
}

export type BaseType = "Int" | "String" | "Array" | "Bool" | "Unit";

export interface RefinementType {
  readonly base: BaseType;
  /** Every runtime value this expression/type can produce. */
  readonly interval: IntegerInterval | null;
  /** Values accepted for every possible evaluation of dependent bounds. */
  readonly guaranteedInterval: IntegerInterval | null;
  readonly exactBoolean: boolean | null;
  readonly arrayType: ArrayType | null;
}

export interface SymbolInfo {
  readonly id: number;
  readonly name: string;
  readonly cxxName: string;
  readonly declaration: ValueDeclaration;
  readonly valueType: ValueType;
  readonly mutable: boolean;
  readonly declarationLoopDepth: number;
  readonly interval: IntegerInterval | null;
  readonly guaranteedInterval: IntegerInterval | null;
  readonly dependencies: readonly SymbolInfo[];
  readonly provablyEmpty: boolean;
  everAssigned: boolean;
}

type ResolvableName =
  | NameExpression
  | NameTokenPattern
  | IndexTokenPattern
  | NameLineInputPattern
  | AssignmentStatement["target"];

export interface AnalyzedProgram {
  readonly program: Program;
  readonly symbols: ReadonlyMap<string, SymbolInfo>;
  readonly allSymbols: readonly SymbolInfo[];
  readonly resolvedNames: ReadonlyMap<ResolvableName, SymbolInfo>;
  readonly expressionTypes: ReadonlyMap<Expression, RefinementType>;
  readonly capturedTypeExpressions: ReadonlyMap<Expression, string>;
}

export interface AnalysisResult {
  readonly analyzed: AnalyzedProgram | null;
  readonly diagnostics: readonly Diagnostic[];
}

interface ExpressionInfo {
  readonly type: RefinementType;
  readonly dependencies: readonly SymbolInfo[];
  readonly exactInteger: bigint | null;
}

interface TypeInfo {
  readonly interval: IntegerInterval | null;
  readonly guaranteedInterval: IntegerInterval | null;
  readonly dependencies: readonly SymbolInfo[];
  readonly provablyEmpty: boolean;
}

interface FlowState {
  definitelyAssigned: Set<SymbolInfo>;
  possiblyAssigned: Set<SymbolInfo>;
  layouts: Set<InputLayout>;
}

type InputLayout = "lineStart" | "tokenLine" | "sealedLine";
type ExpressionContext = "runtime" | "type";

interface ExpressionResult {
  readonly info: ExpressionInfo | null;
  readonly state: FlowState;
}

export function analyze(program: Program): AnalysisResult {
  return new SemanticAnalyzer(program).run();
}

export function isSubtype(subtype: RefinementType, supertype: RefinementType): boolean {
  if (subtype.base !== supertype.base) {
    return false;
  }
  if (subtype.base === "Int") {
    if (supertype.guaranteedInterval === null) {
      return true;
    }
    return (
      subtype.interval !== null &&
      subtype.interval.minimum >= supertype.guaranteedInterval.minimum &&
      subtype.interval.maximum <= supertype.guaranteedInterval.maximum
    );
  }
  if (subtype.base === "String") {
    if (supertype.interval === null) {
      return true;
    }
    return (
      subtype.interval !== null &&
      supertype.guaranteedInterval !== null &&
      subtype.interval.minimum === supertype.guaranteedInterval.minimum &&
      subtype.interval.maximum === supertype.guaranteedInterval.maximum
    );
  }
  if (subtype.base === "Bool") {
    return (
      supertype.exactBoolean === null ||
      subtype.exactBoolean === supertype.exactBoolean
    );
  }
  if (subtype.base === "Array") {
    // Arrays are mutable, so both the element type and dependent length are
    // invariant rather than covariant.
    return equivalentValueTypes(subtype.arrayType!, supertype.arrayType!);
  }
  return true;
}

class SemanticAnalyzer {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly scopes: Map<string, SymbolInfo>[] = [new Map()];
  private readonly allSymbols: SymbolInfo[] = [];
  private readonly topLevelSymbols = new Map<string, SymbolInfo>();
  private readonly resolvedNames = new Map<ResolvableName, SymbolInfo>();
  private readonly expressionTypes = new Map<Expression, RefinementType>();
  private readonly capturedTypeExpressions = new Map<Expression, string>();
  private readonly typeInfos = new Map<ValueType, TypeInfo>();
  private readonly generatedNameCounts = new Map<string, number>();
  private inputBlockCount = 0;
  private loopDepth = 0;

  public constructor(private readonly program: Program) {}

  public run(): AnalysisResult {
    let state = initialFlowState();
    for (const item of this.program.items) {
      state = this.analyzeStatement(item, state);
    }

    if (this.inputBlockCount === 0) {
      this.error(
        "SEM_MISSING_INPUT_BLOCK",
        "A program must contain at least one input block.",
        this.program.span,
      );
    }
    if ([...state.layouts].some((layout) => layout !== "lineStart")) {
      this.warning(
        "SEM_MISSING_FINAL_EOLN",
        "At least one execution path reaches EOF without a final line ending.",
        this.program.span,
      );
    }
    for (const symbol of this.allSymbols) {
      if (!symbol.everAssigned) {
        this.warning(
          "SEM_VALUE_NOT_INPUT",
          `Value '${symbol.name}' is never assigned.`,
          symbol.declaration.span,
        );
      }
    }

    const hasErrors = this.diagnostics.some((diagnostic) => diagnostic.severity === "error");
    return {
      analyzed: hasErrors
        ? null
        : {
            program: this.program,
            symbols: this.topLevelSymbols,
            allSymbols: this.allSymbols,
            resolvedNames: this.resolvedNames,
            expressionTypes: this.expressionTypes,
            capturedTypeExpressions: this.capturedTypeExpressions,
          },
      diagnostics: this.diagnostics,
    };
  }

  private analyzeStatement(statement: Statement, state: FlowState): FlowState {
    switch (statement.kind) {
      case "ValDeclaration":
      case "VarDeclaration":
        return this.analyzeDeclaration(statement, state);
      case "InputBlock":
        return this.analyzeInputBlock(statement, state);
      case "AssignmentStatement":
        return this.analyzeAssignment(statement, state);
      case "IfStatement":
        return this.analyzeIfStatement(statement, state);
      case "ForStatement":
        return this.analyzeForStatement(statement, state);
      case "WhileStatement":
        return this.analyzeWhileStatement(statement, state);
      case "ExpressionStatement":
        return this.analyzeExpression(statement.expression, state, "runtime").state;
      case "EmptyStatement":
        return state;
    }
  }

  private analyzeDeclaration(
    declaration: ValueDeclaration,
    state: FlowState,
  ): FlowState {
    const typeInfo = this.analyzeType(declaration.valueType, state);
    if (declaration.valueType.kind === "ArrayType") {
      for (const dependency of typeInfo.dependencies) {
        if (!state.definitelyAssigned.has(dependency)) {
          this.error(
            "SEM_ARRAY_LENGTH_DEPENDENCY_NOT_READY",
            `Value '${dependency.name}' must be assigned before the Array is declared.`,
            declaration.valueType.span,
          );
        }
      }
    }
    const namesInDeclaration = new Set<string>();
    const next = cloneFlowState(state);
    const declaredSymbols: SymbolInfo[] = [];

    for (const name of declaration.names) {
      if (namesInDeclaration.has(name.name) || this.lookup(name.name) !== null) {
        this.error(
          "SEM_DUPLICATE_NAME",
          `Value '${name.name}' shadows or duplicates an active declaration.`,
          name.span,
        );
        continue;
      }
      namesInDeclaration.add(name.name);
      const symbol: SymbolInfo = {
        id: this.allSymbols.length,
        name: name.name,
        cxxName: this.nextCxxName(name.name),
        declaration,
        valueType: declaration.valueType,
        mutable: declaration.kind === "VarDeclaration",
        declarationLoopDepth: this.loopDepth,
        interval: typeInfo.interval,
        guaranteedInterval: typeInfo.guaranteedInterval,
        dependencies: typeInfo.dependencies,
        provablyEmpty: typeInfo.provablyEmpty,
        everAssigned:
          declaration.valueType.kind === "ArrayType" ||
          declaration.initializer !== null,
      };
      this.currentScope().set(name.name, symbol);
      this.allSymbols.push(symbol);
      declaredSymbols.push(symbol);
      if (this.scopes.length === 1) {
        this.topLevelSymbols.set(name.name, symbol);
      }
      if (
        declaration.valueType.kind === "ArrayType" &&
        declaration.initializer === null
      ) {
        next.definitelyAssigned.add(symbol);
        next.possiblyAssigned.add(symbol);
      }
    }
    if (declaration.initializer === null) {
      return next;
    }
    const symbol = declaredSymbols.length === 1 ? declaredSymbols[0]! : null;
    const initialized = this.analyzeExpression(
      declaration.initializer,
      next,
      "runtime",
    );
    if (
      symbol !== null &&
      initialized.info !== null &&
      !isSubtype(initialized.info.type, symbolType(symbol))
    ) {
      this.error(
        "SEM_ASSIGNMENT_TYPE_MISMATCH",
        `Initializer is not a subtype of '${symbol.name}'s declared refinement.`,
        declaration.initializer.span,
      );
    }
    if (symbol !== null) {
      initialized.state.definitelyAssigned.add(symbol);
      initialized.state.possiblyAssigned.add(symbol);
    }
    return initialized.state;
  }

  private analyzeType(valueType: ValueType, state: FlowState): TypeInfo {
    let result: TypeInfo;
    if (valueType.kind === "IntType") {
      result = this.analyzeIntType(valueType, state);
    } else if (valueType.kind === "StringType") {
      result = this.analyzeStringType(valueType, state);
    } else if (valueType.kind === "ArrayType") {
      result = this.analyzeArrayType(valueType, state);
    } else {
      result = {
        interval: null,
        guaranteedInterval: null,
        dependencies: [],
        provablyEmpty: false,
      };
    }
    this.typeInfos.set(valueType, result);
    return result;
  }

  private analyzeArrayType(valueType: ArrayType, state: FlowState): TypeInfo {
    const element = this.analyzeType(valueType.elementType, state);
    const length = this.analyzeExpression(valueType.length, state, "type").info;
    if (!this.expectBase(length, "Int", valueType.length.span)) {
      return {
        interval: null,
        guaranteedInterval: null,
        dependencies: element.dependencies,
        provablyEmpty: false,
      };
    }
    this.captureDynamicTypeExpression(valueType.length, length, state);
    if (length.type.interval!.minimum < 0n) {
      this.error(
        "SEM_ARRAY_LENGTH_NOT_NONNEGATIVE",
        "An Array length must be provably nonnegative at compile time.",
        valueType.length.span,
      );
    }
    return {
      interval: length.type.interval,
      guaranteedInterval: exactOnly(length.type.interval),
      dependencies: uniqueSymbols([
        ...element.dependencies,
        ...length.dependencies,
      ]),
      provablyEmpty: false,
    };
  }

  private analyzeIntType(valueType: IntType, state: FlowState): TypeInfo {
    if (valueType.range === null) {
      return {
        interval: { minimum: I64_MIN, maximum: I64_MAX },
        guaranteedInterval: { minimum: I64_MIN, maximum: I64_MAX },
        dependencies: [],
        provablyEmpty: false,
      };
    }

    const lower = this.analyzeExpression(valueType.range.lower, state, "type").info;
    const upper = this.analyzeExpression(valueType.range.upper, state, "type").info;
    if (!this.expectBase(lower, "Int", valueType.range.lower.span)) {
      return {
        interval: null,
        guaranteedInterval: null,
        dependencies: [],
        provablyEmpty: false,
      };
    }
    if (!this.expectBase(upper, "Int", valueType.range.upper.span)) {
      return {
        interval: null,
        guaranteedInterval: null,
        dependencies: [],
        provablyEmpty: false,
      };
    }
    this.captureDynamicTypeExpression(valueType.range.lower, lower, state);
    this.captureDynamicTypeExpression(valueType.range.upper, upper, state);

    const minimum =
      lower.type.interval!.minimum + (valueType.range.lowerInclusive ? 0n : 1n);
    const maximum =
      upper.type.interval!.maximum - (valueType.range.upperInclusive ? 0n : 1n);
    const guaranteedMinimum =
      lower.type.interval!.maximum + (valueType.range.lowerInclusive ? 0n : 1n);
    const guaranteedMaximum =
      upper.type.interval!.minimum - (valueType.range.upperInclusive ? 0n : 1n);
    return {
      interval: { minimum, maximum },
      guaranteedInterval: {
        minimum: guaranteedMinimum,
        maximum: guaranteedMaximum,
      },
      dependencies: uniqueSymbols([...lower.dependencies, ...upper.dependencies]),
      provablyEmpty: minimum > maximum,
    };
  }

  private analyzeStringType(valueType: StringType, state: FlowState): TypeInfo {
    if (valueType.length === null) {
      return {
        interval: null,
        guaranteedInterval: null,
        dependencies: [],
        provablyEmpty: false,
      };
    }

    const length = this.analyzeExpression(valueType.length, state, "type").info;
    if (!this.expectBase(length, "Int", valueType.length.span)) {
      return {
        interval: null,
        guaranteedInterval: null,
        dependencies: [],
        provablyEmpty: false,
      };
    }
    this.captureDynamicTypeExpression(valueType.length, length, state);
    if (length.type.interval!.minimum < 0n) {
      this.error(
        "SEM_STRING_LENGTH_NOT_NONNEGATIVE",
        "A string length must be provably nonnegative at compile time.",
        valueType.length.span,
      );
    }
    return {
      interval: length.type.interval,
      guaranteedInterval: exactOnly(length.type.interval),
      dependencies: length.dependencies,
      provablyEmpty: false,
    };
  }

  private analyzeExpression(
    expression: Expression,
    state: FlowState,
    context: ExpressionContext,
  ): ExpressionResult {
    let result: ExpressionResult;
    switch (expression.kind) {
      case "IntegerLiteral":
        result = this.analyzeIntegerLiteral(expression.value, expression.span, state);
        break;
      case "BooleanLiteral":
        result = {
          info: {
            type: booleanType(expression.value),
            dependencies: [],
            exactInteger: null,
          },
          state,
        };
        break;
      case "NameExpression":
        result = this.analyzeNameExpression(expression, state, context);
        break;
      case "IndexExpression":
        result = this.analyzeIndexExpression(expression, state, context);
        break;
      case "UnaryExpression":
        result = this.analyzeUnaryExpression(expression, state, context);
        break;
      case "BinaryExpression":
        result = this.analyzeBinaryExpression(expression, state, context);
        break;
      case "RequireExpression":
        result = this.analyzeRequireExpression(expression.condition, expression.span, state, context);
        break;
      case "IfExpression":
        result = this.analyzeIfExpression(expression, state, context);
        break;
      case "BlockExpression":
        result = this.analyzeBlockExpression(expression, state, context);
        break;
    }
    if (result.info !== null) {
      this.expressionTypes.set(expression, result.info.type);
    }
    return result;
  }

  private analyzeIntegerLiteral(
    value: bigint,
    span: SourceSpan,
    state: FlowState,
  ): ExpressionResult {
    if (value < I64_MIN || value > I64_MAX) {
      this.error(
        "SEM_INTEGER_OUT_OF_RANGE",
        "Integer literals must fit in a signed 64-bit integer.",
        span,
      );
      return { info: null, state };
    }
    return {
      info: {
        type: integerType(exactInterval(value)),
        dependencies: [],
        exactInteger: value,
      },
      state,
    };
  }

  private analyzeNameExpression(
    expression: NameExpression,
    state: FlowState,
    context: ExpressionContext,
  ): ExpressionResult {
    const symbol = this.lookup(expression.name);
    if (symbol === null) {
      this.error(
        "SEM_UNKNOWN_NAME",
        `Value '${expression.name}' must be declared before it is referenced.`,
        expression.span,
      );
      return { info: null, state };
    }
    this.resolvedNames.set(expression, symbol);
    if (context === "runtime" && !state.definitelyAssigned.has(symbol)) {
      this.error(
        "SEM_VALUE_NOT_READY",
        `Value '${expression.name}' is not assigned on every execution path.`,
        expression.span,
      );
    }
    return {
      info: {
        type: symbolType(symbol),
        dependencies: [symbol],
        exactInteger: null,
      },
      state,
    };
  }

  private analyzeIndexExpression(
    expression: IndexExpression,
    state: FlowState,
    context: ExpressionContext,
  ): ExpressionResult {
    const collection = this.analyzeExpression(
      expression.collection,
      state,
      context,
    );
    const index = this.analyzeExpression(expression.index, collection.state, context);
    if (
      !this.expectBase(collection.info, "Array", expression.collection.span) ||
      !this.expectBase(index.info, "Int", expression.index.span)
    ) {
      return { info: null, state: index.state };
    }
    const arrayType = collection.info.type.arrayType!;
    const length = this.typeInfos.get(arrayType)?.interval ?? null;
    if (
      index.info.exactInteger !== null &&
      length !== null &&
      (index.info.exactInteger < 0n ||
        index.info.exactInteger >= length.maximum)
    ) {
      this.error(
        "SEM_ARRAY_INDEX_OUT_OF_BOUNDS",
        "The array index is outside the array length on every execution path.",
        expression.index.span,
      );
    }
    return {
      info: {
        type: this.refinementForValueType(arrayType.elementType),
        dependencies: uniqueSymbols([
          ...collection.info.dependencies,
          ...index.info.dependencies,
        ]),
        exactInteger: null,
      },
      state: index.state,
    };
  }

  private refinementForValueType(valueType: ValueType): RefinementType {
    const info = this.typeInfos.get(valueType);
    switch (valueType.kind) {
      case "IntType":
        return integerType(
          info?.interval ?? null,
          info?.guaranteedInterval ?? null,
        );
      case "StringType":
        return stringType(
          info?.interval ?? null,
          info?.guaranteedInterval ?? null,
        );
      case "ArrayType":
        return arrayType(valueType, info?.interval ?? null);
      case "BoolType":
        return booleanType(null);
      case "UnitType":
        return unitType();
    }
  }

  private captureDynamicTypeExpression(
    expression: Expression,
    info: ExpressionInfo,
    state: FlowState,
  ): void {
    if (
      !info.dependencies.some((dependency) => dependency.mutable) &&
      !containsIndexExpression(expression)
    ) {
      return;
    }
    for (const dependency of info.dependencies) {
      if (!state.definitelyAssigned.has(dependency)) {
        this.error(
          "SEM_SNAPSHOT_DEPENDENCY_NOT_READY",
          `Value '${dependency.name}' must be assigned before its current value ` +
            "can be captured by a dependent type.",
          expression.span,
        );
      }
    }
    this.capturedTypeExpressions.set(
      expression,
      `_513s${expression.span.start.offset}`,
    );
  }


  private analyzeUnaryExpression(
    expression: Extract<Expression, { kind: "UnaryExpression" }>,
    state: FlowState,
    context: ExpressionContext,
  ): ExpressionResult {
    const operand = this.analyzeExpression(expression.operand, state, context);
    if (expression.operator === "not") {
      if (!this.expectBase(operand.info, "Bool", expression.operand.span)) {
        return { info: null, state: operand.state };
      }
      return {
        info: {
          type: booleanType(
            operand.info.type.exactBoolean === null
              ? null
              : !operand.info.type.exactBoolean,
          ),
          dependencies: operand.info.dependencies,
          exactInteger: null,
        },
        state: operand.state,
      };
    }

    if (!this.expectBase(operand.info, "Int", expression.operand.span)) {
      return { info: null, state: operand.state };
    }
    if (expression.operator === "plus") {
      return operand;
    }
    const exactInteger =
      operand.info.exactInteger === null ? null : -operand.info.exactInteger;
    if (
      exactInteger !== null &&
      !this.checkExpressionResult(exactInteger, expression.span)
    ) {
      return { info: null, state: operand.state };
    }
    return {
      info: {
        type: integerType(
          exactInteger === null
            ? clampInterval(
                -operand.info.type.interval!.maximum,
                -operand.info.type.interval!.minimum,
              )
            : exactInterval(exactInteger),
        ),
        dependencies: operand.info.dependencies,
        exactInteger,
      },
      state: operand.state,
    };
  }

  private analyzeBinaryExpression(
    expression: Extract<Expression, { kind: "BinaryExpression" }>,
    state: FlowState,
    context: ExpressionContext,
  ): ExpressionResult {
    const left = this.analyzeExpression(expression.left, state, context);
    const right = this.analyzeExpression(expression.right, left.state, context);
    const outputState =
      expression.operator === "logicalAnd" || expression.operator === "logicalOr"
        ? mergeFlowStates(left.state, right.state)
        : right.state;
    if (left.info === null || right.info === null) {
      return { info: null, state: outputState };
    }

    const dependencies = uniqueSymbols([
      ...left.info.dependencies,
      ...right.info.dependencies,
    ]);
    if (isArithmeticOperator(expression.operator)) {
      if (
        !this.expectBase(left.info, "Int", expression.left.span) ||
        !this.expectBase(right.info, "Int", expression.right.span)
      ) {
        return { info: null, state: outputState };
      }
      if (
        (expression.operator === "divide" || expression.operator === "modulo") &&
        right.info.exactInteger === 0n
      ) {
        this.error(
          "SEM_DIVISION_BY_ZERO",
          "Division or modulo by zero is not allowed.",
          expression.right.span,
        );
        return { info: null, state: outputState };
      }
      const exactInteger =
        left.info.exactInteger !== null && right.info.exactInteger !== null
          ? evaluateArithmetic(
              expression.operator,
              left.info.exactInteger,
              right.info.exactInteger,
            )
          : null;
      if (
        exactInteger !== null &&
        !this.checkExpressionResult(exactInteger, expression.span)
      ) {
        return { info: null, state: outputState };
      }
      return {
        info: {
          type: integerType(
            exactInteger === null
              ? arithmeticInterval(
                  expression.operator,
                  left.info.type.interval!,
                  right.info.type.interval!,
                )
              : exactInterval(exactInteger),
          ),
          dependencies,
          exactInteger,
        },
        state: outputState,
      };
    }

    if (isOrderingOperator(expression.operator)) {
      if (
        !this.expectBase(left.info, "Int", expression.left.span) ||
        !this.expectBase(right.info, "Int", expression.right.span)
      ) {
        return { info: null, state: outputState };
      }
      return {
        info: {
          type: booleanType(compareExactIntegers(
            expression.operator,
            left.info.exactInteger,
            right.info.exactInteger,
          )),
          dependencies,
          exactInteger: null,
        },
        state: outputState,
      };
    }

    if (expression.operator === "equal" || expression.operator === "notEqual") {
      if (
        left.info.type.base !== right.info.type.base ||
        left.info.type.base === "Unit" ||
        left.info.type.base === "Array"
      ) {
        this.error(
          "SEM_INVALID_EQUALITY_OPERANDS",
          "Equality operands must have the same comparable base type.",
          expression.span,
        );
        return { info: null, state: outputState };
      }
      let exact: boolean | null = null;
      if (
        left.info.exactInteger !== null &&
        right.info.exactInteger !== null
      ) {
        exact = left.info.exactInteger === right.info.exactInteger;
      } else if (
        left.info.type.exactBoolean !== null &&
        right.info.type.exactBoolean !== null
      ) {
        exact = left.info.type.exactBoolean === right.info.type.exactBoolean;
      }
      if (exact !== null && expression.operator === "notEqual") {
        exact = !exact;
      }
      return {
        info: {
          type: booleanType(exact),
          dependencies,
          exactInteger: null,
        },
        state: outputState,
      };
    }

    if (
      !this.expectBase(left.info, "Bool", expression.left.span) ||
      !this.expectBase(right.info, "Bool", expression.right.span)
    ) {
      return { info: null, state: outputState };
    }
    return {
      info: {
        type: booleanType(logicalExact(
          expression.operator,
          left.info.type.exactBoolean,
          right.info.type.exactBoolean,
        )),
        dependencies,
        exactInteger: null,
      },
      state: outputState,
    };
  }

  private analyzeRequireExpression(
    condition: Expression,
    span: SourceSpan,
    state: FlowState,
    context: ExpressionContext,
  ): ExpressionResult {
    if (context === "type") {
      this.error(
        "SEM_EFFECT_NOT_ALLOWED_IN_TYPE",
        "require(...) cannot be evaluated inside a type constraint.",
        span,
      );
    }
    const conditionResult = this.analyzeExpression(condition, state, context);
    this.expectBase(conditionResult.info, "Bool", condition.span);
    return {
      info: {
        type: unitType(),
        dependencies: conditionResult.info?.dependencies ?? [],
        exactInteger: null,
      },
      state: conditionResult.state,
    };
  }

  private analyzeIfExpression(
    expression: Extract<Expression, { kind: "IfExpression" }>,
    state: FlowState,
    context: ExpressionContext,
  ): ExpressionResult {
    const condition = this.analyzeExpression(expression.condition, state, context);
    this.expectBase(condition.info, "Bool", expression.condition.span);
    const thenResult = this.analyzeExpression(
      expression.thenBranch,
      cloneFlowState(condition.state),
      context,
    );
    const elseResult = this.analyzeExpression(
      expression.elseBranch,
      cloneFlowState(condition.state),
      context,
    );
    const unified =
      thenResult.info !== null && elseResult.info !== null
        ? unifyTypes(thenResult.info.type, elseResult.info.type)
        : null;
    if (thenResult.info !== null && elseResult.info !== null && unified === null) {
      this.error(
        "SEM_IF_BRANCH_TYPE_MISMATCH",
        `If branches have incompatible types '${thenResult.info.type.base}' and ` +
          `'${elseResult.info.type.base}'.`,
        expression.span,
      );
    }
    const exactInteger =
      thenResult.info !== null &&
      elseResult.info !== null &&
      thenResult.info.exactInteger !== null &&
      thenResult.info.exactInteger === elseResult.info.exactInteger
        ? thenResult.info.exactInteger
        : null;
    return {
      info:
        unified === null
          ? null
          : {
              type: unified,
              dependencies: uniqueSymbols([
                ...(condition.info?.dependencies ?? []),
                ...(thenResult.info?.dependencies ?? []),
                ...(elseResult.info?.dependencies ?? []),
              ]),
              exactInteger,
            },
      state: mergeFlowStates(thenResult.state, elseResult.state),
    };
  }

  private analyzeIfStatement(
    statement: IfStatement,
    state: FlowState,
  ): FlowState {
    const condition = this.analyzeExpression(
      statement.condition,
      state,
      "runtime",
    );
    this.expectBase(condition.info, "Bool", statement.condition.span);
    const thenResult = this.analyzeBlockExpression(
      statement.thenBranch,
      cloneFlowState(condition.state),
      "runtime",
    );
    const elseState =
      statement.elseBranch === null
        ? cloneFlowState(condition.state)
        : statement.elseBranch.kind === "IfStatement"
          ? this.analyzeIfStatement(
              statement.elseBranch,
              cloneFlowState(condition.state),
            )
          : this.analyzeBlockExpression(
              statement.elseBranch,
              cloneFlowState(condition.state),
              "runtime",
            ).state;
    return mergeFlowStates(thenResult.state, elseState);
  }

  private analyzeBlockExpression(
    expression: Extract<Expression, { kind: "BlockExpression" }>,
    state: FlowState,
    context: ExpressionContext,
  ): ExpressionResult {
    if (context === "type" && expression.statements.length > 0) {
      this.error(
        "SEM_EFFECT_NOT_ALLOWED_IN_TYPE",
        "Statements are not allowed in a block used as a type constraint.",
        expression.span,
      );
    }

    this.scopes.push(new Map());
    let blockState = cloneFlowState(state);
    for (const statement of expression.statements) {
      blockState = this.analyzeStatement(statement, blockState);
    }
    const tailResult =
      expression.tail === null
        ? {
            info: {
              type: unitType(),
              dependencies: [] as readonly SymbolInfo[],
              exactInteger: null,
            },
            state: blockState,
          }
        : this.analyzeExpression(expression.tail, blockState, context);
    const localSymbols = [...this.currentScope().values()];
    this.scopes.pop();
    return {
      info: tailResult.info,
      state: removeLocalSymbols(tailResult.state, localSymbols),
    };
  }

  private analyzeAssignment(
    assignment: AssignmentStatement,
    state: FlowState,
  ): FlowState {
    if (assignment.target.kind === "IndexExpression") {
      return this.analyzeElementAssignment(
        assignment.target,
        assignment.operator,
        assignment.value,
        assignment.span,
        state,
      );
    }
    const symbol = this.lookup(assignment.target.name);
    const valueResult = this.analyzeExpression(assignment.value, state, "runtime");
    if (symbol === null) {
      this.error(
        "SEM_UNKNOWN_ASSIGNMENT_NAME",
        `Assignment refers to undeclared value '${assignment.target.name}'.`,
        assignment.target.span,
      );
      return valueResult.state;
    }
    this.resolvedNames.set(assignment.target, symbol);

    if (
      !symbol.mutable &&
      this.loopDepth > symbol.declarationLoopDepth
    ) {
      this.error(
        "SEM_IMMUTABLE_ASSIGNMENT_IN_LOOP",
        `Immutable value '${symbol.name}' cannot be assigned from a surrounding loop.`,
        assignment.target.span,
      );
      return valueResult.state;
    }

    let assignedType = valueResult.info?.type ?? null;
    if (assignment.operator === "assign") {
      if (!symbol.mutable && valueResult.state.possiblyAssigned.has(symbol)) {
        this.error(
          "SEM_VALUE_ASSIGNED_TWICE",
          `Immutable value '${symbol.name}' may already have been assigned.`,
          assignment.target.span,
        );
        return valueResult.state;
      }
    } else {
      if (!symbol.mutable) {
        this.error(
          "SEM_COMPOUND_ASSIGNMENT_REQUIRES_VAR",
          "Compound assignment requires a mutable 'var Int' target.",
          assignment.target.span,
        );
        return valueResult.state;
      }
      if (!valueResult.state.definitelyAssigned.has(symbol)) {
        this.error(
          "SEM_VALUE_NOT_READY",
          `Value '${symbol.name}' must be assigned before compound assignment.`,
          assignment.target.span,
        );
        return valueResult.state;
      }
      const targetType = symbolType(symbol);
      if (
        targetType.base !== "Int" ||
        targetType.interval === null ||
        valueResult.info?.type.base !== "Int" ||
        valueResult.info.type.interval === null
      ) {
        this.error(
          "SEM_COMPOUND_ASSIGNMENT_REQUIRES_INT",
          "Arithmetic compound assignment requires Int operands.",
          assignment.span,
        );
        return valueResult.state;
      }
      const arithmeticOperator = compoundArithmeticOperator(assignment.operator);
      if (
        (arithmeticOperator === "divide" || arithmeticOperator === "modulo") &&
        valueResult.info.exactInteger === 0n
      ) {
        this.error(
          "SEM_DIVISION_BY_ZERO",
          "Division or modulo by zero is not allowed.",
          assignment.value.span,
        );
        return valueResult.state;
      }
      assignedType = integerType(
        arithmeticInterval(
          arithmeticOperator,
          targetType.interval,
          valueResult.info.type.interval,
        ),
      );
    }

    if (assignedType !== null && !isSubtype(assignedType, symbolType(symbol))) {
      this.error(
        "SEM_ASSIGNMENT_TYPE_MISMATCH",
        `Assigned value is not a subtype of '${symbol.name}'s declared refinement.`,
        assignment.value.span,
      );
      return valueResult.state;
    }

    symbol.everAssigned = true;
    const next = cloneFlowState(valueResult.state);
    next.definitelyAssigned.add(symbol);
    next.possiblyAssigned.add(symbol);
    return next;
  }

  private analyzeElementAssignment(
    targetExpression: IndexExpression,
    assignmentOperator: AssignmentStatement["operator"],
    valueExpression: Expression,
    assignmentSpan: SourceSpan,
    state: FlowState,
  ): FlowState {
    const target = this.analyzeIndexExpression(
      targetExpression,
      state,
      "runtime",
    );
    const value = this.analyzeExpression(
      valueExpression,
      target.state,
      "runtime",
    );
    if (target.info === null || value.info === null) {
      return value.state;
    }

    let assignedType = value.info.type;
    if (assignmentOperator !== "assign") {
      if (
        target.info.type.base !== "Int" ||
        target.info.type.interval === null ||
        value.info.type.base !== "Int" ||
        value.info.type.interval === null
      ) {
        this.error(
          "SEM_COMPOUND_ASSIGNMENT_REQUIRES_INT",
          "Arithmetic compound assignment requires Int operands.",
          assignmentSpan,
        );
        return value.state;
      }
      const operator = compoundArithmeticOperator(assignmentOperator);
      if (
        (operator === "divide" || operator === "modulo") &&
        value.info.exactInteger === 0n
      ) {
        this.error(
          "SEM_DIVISION_BY_ZERO",
          "Division or modulo by zero is not allowed.",
          valueExpression.span,
        );
        return value.state;
      }
      assignedType = integerType(
        arithmeticInterval(
          operator,
          target.info.type.interval,
          value.info.type.interval,
        ),
      );
    }
    if (!isSubtype(assignedType, target.info.type)) {
      this.error(
        "SEM_ASSIGNMENT_TYPE_MISMATCH",
        "Assigned value is not a subtype of the array element refinement.",
        valueExpression.span,
      );
    }
    return value.state;
  }

  private analyzeForStatement(statement: ForStatement, state: FlowState): FlowState {
    const countResult = this.analyzeExpression(statement.count, state, "runtime");
    if (!this.expectBase(countResult.info, "Int", statement.count.span)) {
      return countResult.state;
    }
    if (
      countResult.info.exactInteger !== null &&
      countResult.info.exactInteger < 0n
    ) {
      this.error(
        "SEM_NEGATIVE_LOOP_COUNT",
        "A for repetition count cannot be negative.",
        statement.count.span,
      );
    }

    this.loopDepth += 1;
    const bodyResult = this.analyzeBlockExpression(
      statement.body,
      cloneFlowState(countResult.state),
      "runtime",
    );
    this.loopDepth -= 1;
    this.checkLoopLayout(countResult.state, bodyResult.state, statement.body.span);

    const canExecute =
      countResult.info.type.interval!.maximum > 0n;
    const mustExecute =
      countResult.info.type.interval!.minimum > 0n;
    return {
      definitelyAssigned: mustExecute
        ? new Set(bodyResult.state.definitelyAssigned)
        : new Set(countResult.state.definitelyAssigned),
      possiblyAssigned: canExecute
        ? new Set([
            ...countResult.state.possiblyAssigned,
            ...bodyResult.state.possiblyAssigned,
          ])
        : new Set(countResult.state.possiblyAssigned),
      layouts: new Set(countResult.state.layouts),
    };
  }

  private analyzeWhileStatement(statement: WhileStatement, state: FlowState): FlowState {
    this.loopDepth += 1;
    const conditionResult = this.analyzeExpression(
      statement.condition,
      cloneFlowState(state),
      "runtime",
    );
    this.expectBase(conditionResult.info, "Bool", statement.condition.span);
    const bodyResult = this.analyzeBlockExpression(
      statement.body,
      cloneFlowState(conditionResult.state),
      "runtime",
    );
    this.loopDepth -= 1;

    this.checkLoopLayout(state, conditionResult.state, statement.condition.span);
    this.checkLoopLayout(state, bodyResult.state, statement.body.span);
    return {
      // A while condition is evaluated once even when the body executes zero times.
      definitelyAssigned: new Set(conditionResult.state.definitelyAssigned),
      possiblyAssigned: new Set([
        ...state.possiblyAssigned,
        ...conditionResult.state.possiblyAssigned,
        ...bodyResult.state.possiblyAssigned,
      ]),
      layouts: new Set(state.layouts),
    };
  }

  private checkLoopLayout(
    before: FlowState,
    after: FlowState,
    span: SourceSpan,
  ): void {
    if (!sameLayouts(before.layouts, after.layouts)) {
      this.error(
        "SEM_LOOP_INPUT_LAYOUT_NOT_CLOSED",
        "Each loop iteration must leave the input at the same line boundary state.",
        span,
      );
    }
  }

  private analyzeInputBlock(block: InputBlock, state: FlowState): FlowState {
    this.inputBlockCount += 1;
    let next = cloneFlowState(state);
    for (const line of block.lines) {
      if (line.kind === "TokenLineInputPattern") {
        if (next.layouts.has("sealedLine")) {
          this.error(
            "SEM_LINE_PATTERN_CANNOT_CONTINUE",
            "An unterminated whole-line input must be the final input pattern.",
            line.span,
          );
        }
        for (const token of line.tokens) {
          next = this.analyzeInputValue(token, next, false);
        }
        if (line.terminated) {
          next.layouts = new Set(["lineStart"]);
        } else if (line.tokens.length > 0) {
          next.layouts = new Set(
            [...next.layouts].map((layout) =>
              layout === "sealedLine" ? layout : "tokenLine",
            ),
          );
        }
      } else {
        if ([...next.layouts].some((layout) => layout !== "lineStart")) {
          this.error(
            "SEM_LINE_PATTERN_CANNOT_CONTINUE",
            "A whole-line input pattern must start at the beginning of a line.",
            line.span,
          );
        }
        next = this.analyzeInputValue(line.value, next, true);
        next.layouts = new Set([line.terminated ? "lineStart" : "sealedLine"]);
      }
    }
    return next;
  }

  private analyzeInputValue(
    pattern: NameTokenPattern | IndexTokenPattern | NameLineInputPattern,
    state: FlowState,
    wholeLine: boolean,
  ): FlowState {
    if (pattern.kind === "IndexTokenPattern") {
      const target = this.analyzeIndexExpression(pattern.target, state, "runtime");
      if (
        target.info !== null &&
        !this.supportsTokenInput(target.info.type)
      ) {
        this.error(
          "SEM_TYPE_NOT_INPUTTABLE",
          `Type '${target.info.type.base}' cannot be read as one input token.`,
          pattern.span,
        );
      }
      return target.state;
    }
    const symbol = this.lookup(pattern.name);
    if (symbol === null) {
      this.error(
        "SEM_UNKNOWN_INPUT_NAME",
        `Input pattern refers to undeclared value '${pattern.name}'.`,
        pattern.span,
      );
      return state;
    }
    this.resolvedNames.set(pattern, symbol);
    if (!wholeLine && !this.supportsTokenInput(symbolType(symbol))) {
      this.error(
        "SEM_TYPE_NOT_INPUTTABLE",
        `Type '${baseTypeOf(symbol.valueType)}' cannot be read as one input token.`,
        pattern.span,
      );
      return state;
    }
    if (wholeLine && !supportsLineInput(symbol.valueType)) {
      this.error(
        "SEM_LINE_INPUT_NOT_SUPPORTED",
        `Type of '${pattern.name}' does not support whole-line input.`,
        pattern.span,
      );
      return state;
    }
    if (
      symbol.valueType.kind !== "ArrayType" &&
      !symbol.mutable &&
      this.loopDepth > symbol.declarationLoopDepth
    ) {
      this.error(
        "SEM_IMMUTABLE_ASSIGNMENT_IN_LOOP",
        `Immutable value '${symbol.name}' cannot be input from a surrounding loop.`,
        pattern.span,
      );
      return state;
    }
    if (
      symbol.valueType.kind !== "ArrayType" &&
      !symbol.mutable &&
      state.possiblyAssigned.has(symbol)
    ) {
      this.error(
        "SEM_VALUE_ASSIGNED_TWICE",
        `Value '${pattern.name}' may already have been assigned on this execution path.`,
        pattern.span,
      );
      return state;
    }
    for (const dependency of symbol.dependencies) {
      if (!state.definitelyAssigned.has(dependency)) {
        this.error(
          "SEM_DEPENDENCY_NOT_READY",
          `Value '${dependency.name}' must be assigned before '${pattern.name}' is read.`,
          pattern.span,
        );
      }
    }
    if (symbol.provablyEmpty) {
      this.warning(
        "SEM_EMPTY_INPUT_TYPE",
        `Value '${pattern.name}' has a type that no input can satisfy.`,
        pattern.span,
      );
    }
    if (
      !wholeLine &&
      symbol.valueType.kind === "StringType" &&
      symbol.interval?.minimum === 0n &&
      symbol.interval.maximum === 0n
    ) {
      this.warning(
        "SEM_EMPTY_STRING_TOKEN",
        `String '${pattern.name}' requires zero bytes, which a token pattern cannot represent.`,
        pattern.span,
      );
    }

    symbol.everAssigned = true;
    const next = cloneFlowState(state);
    next.definitelyAssigned.add(symbol);
    next.possiblyAssigned.add(symbol);
    return next;
  }

  private supportsTokenInput(type: RefinementType): boolean {
    if (type.base === "Int" || type.base === "String") {
      return true;
    }
    return type.base === "Array" && this.isCompactArrayType(type.arrayType!);
  }

  private isCompactArrayType(valueType: ArrayType): boolean {
    if (valueType.elementType.kind !== "StringType") {
      return false;
    }
    const element = this.typeInfos.get(valueType.elementType);
    return (
      element?.interval !== null &&
      element?.interval?.minimum === 1n &&
      element.interval.maximum === 1n
    );
  }

  private expectBase(
    info: ExpressionInfo | null,
    expected: BaseType,
    span: SourceSpan,
  ): info is ExpressionInfo {
    if (info === null) {
      return false;
    }
    if (info.type.base === expected) {
      // A previous error can leave an Int expression without a usable
      // refinement interval. Treat it as an already-invalid expression
      // instead of dereferencing the missing interval and aborting analysis.
      if (expected === "Int" && info.type.interval === null) {
        return false;
      }
      return true;
    }
    this.error(
      "SEM_TYPE_MISMATCH",
      `Expected '${expected}' but found '${info.type.base}'.`,
      span,
    );
    return false;
  }

  private checkExpressionResult(value: bigint, span: SourceSpan): boolean {
    if (value >= I64_MIN && value <= I64_MAX) {
      return true;
    }
    this.error(
      "SEM_INTEGER_EXPRESSION_OUT_OF_RANGE",
      "Every integer expression result must fit in a signed 64-bit integer.",
      span,
    );
    return false;
  }

  private lookup(name: string): SymbolInfo | null {
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const symbol = this.scopes[index]?.get(name);
      if (symbol !== undefined) {
        return symbol;
      }
    }
    return null;
  }

  private currentScope(): Map<string, SymbolInfo> {
    return this.scopes[this.scopes.length - 1]!;
  }

  private nextCxxName(name: string): string {
    const count = (this.generatedNameCounts.get(name) ?? 0) + 1;
    this.generatedNameCounts.set(name, count);
    return count === 1 ? `_512_${name}` : `_512_${name}_${count}`;
  }

  private error(code: string, message: string, span: SourceSpan): void {
    this.diagnostics.push({
      stage: "semantic",
      severity: "error",
      code,
      message,
      span,
    });
  }

  private warning(code: string, message: string, span: SourceSpan): void {
    this.diagnostics.push({
      stage: "semantic",
      severity: "warning",
      code,
      message,
      span,
    });
  }
}

function initialFlowState(): FlowState {
  return {
    definitelyAssigned: new Set(),
    possiblyAssigned: new Set(),
    layouts: new Set(["lineStart"]),
  };
}

function cloneFlowState(state: FlowState): FlowState {
  return {
    definitelyAssigned: new Set(state.definitelyAssigned),
    possiblyAssigned: new Set(state.possiblyAssigned),
    layouts: new Set(state.layouts),
  };
}

function mergeFlowStates(left: FlowState, right: FlowState): FlowState {
  return {
    definitelyAssigned: new Set(
      [...left.definitelyAssigned].filter((symbol) =>
        right.definitelyAssigned.has(symbol),
      ),
    ),
    possiblyAssigned: new Set([
      ...left.possiblyAssigned,
      ...right.possiblyAssigned,
    ]),
    layouts: new Set([...left.layouts, ...right.layouts]),
  };
}

function removeLocalSymbols(
  state: FlowState,
  localSymbols: readonly SymbolInfo[],
): FlowState {
  const locals = new Set(localSymbols);
  return {
    definitelyAssigned: new Set(
      [...state.definitelyAssigned].filter((symbol) => !locals.has(symbol)),
    ),
    possiblyAssigned: new Set(
      [...state.possiblyAssigned].filter((symbol) => !locals.has(symbol)),
    ),
    layouts: new Set(state.layouts),
  };
}

function symbolType(symbol: SymbolInfo): RefinementType {
  switch (symbol.valueType.kind) {
    case "IntType":
      return integerType(symbol.interval, symbol.guaranteedInterval);
    case "StringType":
      return stringType(symbol.interval, symbol.guaranteedInterval);
    case "ArrayType":
      return arrayType(symbol.valueType, symbol.interval);
    case "BoolType":
      return booleanType(null);
    case "UnitType":
      return unitType();
  }
}

function baseTypeOf(valueType: ValueType): BaseType {
  switch (valueType.kind) {
    case "IntType":
      return "Int";
    case "StringType":
      return "String";
    case "ArrayType":
      return "Array";
    case "BoolType":
      return "Bool";
    case "UnitType":
      return "Unit";
  }
}

function integerType(
  interval: IntegerInterval | null,
  guaranteedInterval: IntegerInterval | null = interval,
): RefinementType {
  return {
    base: "Int",
    interval,
    guaranteedInterval,
    exactBoolean: null,
    arrayType: null,
  };
}

function stringType(
  length: IntegerInterval | null,
  guaranteedInterval: IntegerInterval | null = length,
): RefinementType {
  return {
    base: "String",
    interval: length,
    guaranteedInterval,
    exactBoolean: null,
    arrayType: null,
  };
}

function arrayType(
  valueType: ArrayType,
  length: IntegerInterval | null,
): RefinementType {
  return {
    base: "Array",
    interval: length,
    guaranteedInterval: exactOnly(length),
    exactBoolean: null,
    arrayType: valueType,
  };
}

function booleanType(value: boolean | null): RefinementType {
  return {
    base: "Bool",
    interval: null,
    guaranteedInterval: null,
    exactBoolean: value,
    arrayType: null,
  };
}

function unitType(): RefinementType {
  return {
    base: "Unit",
    interval: null,
    guaranteedInterval: null,
    exactBoolean: null,
    arrayType: null,
  };
}

function unifyTypes(left: RefinementType, right: RefinementType): RefinementType | null {
  if (left.base !== right.base) {
    return null;
  }
  if (isSubtype(left, right)) {
    return right;
  }
  if (isSubtype(right, left)) {
    return left;
  }
  if (left.base === "Int" && left.interval !== null && right.interval !== null) {
    return integerType({
      minimum: minBigInt(left.interval.minimum, right.interval.minimum),
      maximum: maxBigInt(left.interval.maximum, right.interval.maximum),
    });
  }
  if (left.base === "String") {
    return stringType(null);
  }
  if (left.base === "Bool") {
    return booleanType(null);
  }
  if (left.base === "Array") {
    return null;
  }
  return unitType();
}

function supportsLineInput(valueType: ValueType): boolean {
  return valueType.kind === "IntType" || valueType.kind === "StringType";
}

function containsIndexExpression(expression: Expression): boolean {
  switch (expression.kind) {
    case "IndexExpression":
      return true;
    case "UnaryExpression":
      return containsIndexExpression(expression.operand);
    case "BinaryExpression":
      return (
        containsIndexExpression(expression.left) ||
        containsIndexExpression(expression.right)
      );
    case "RequireExpression":
      return containsIndexExpression(expression.condition);
    case "IfExpression":
      return (
        containsIndexExpression(expression.condition) ||
        containsIndexExpression(expression.thenBranch) ||
        containsIndexExpression(expression.elseBranch)
      );
    case "BlockExpression":
      return expression.tail !== null && containsIndexExpression(expression.tail);
    case "IntegerLiteral":
    case "BooleanLiteral":
    case "NameExpression":
      return false;
  }
}

function equivalentValueTypes(left: ValueType, right: ValueType): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "IntType": {
      if (right.kind !== "IntType") return false;
      if (left.range === null || right.range === null) {
        return left.range === right.range;
      }
      return (
        left.range.lowerInclusive === right.range.lowerInclusive &&
        left.range.upperInclusive === right.range.upperInclusive &&
        equivalentExpressions(left.range.lower, right.range.lower) &&
        equivalentExpressions(left.range.upper, right.range.upper)
      );
    }
    case "StringType":
      return (
        right.kind === "StringType" &&
        (left.length === null || right.length === null
          ? left.length === right.length
          : equivalentExpressions(left.length, right.length))
      );
    case "ArrayType":
      return (
        right.kind === "ArrayType" &&
        equivalentValueTypes(left.elementType, right.elementType) &&
        equivalentExpressions(left.length, right.length)
      );
    case "BoolType":
      return right.kind === "BoolType";
    case "UnitType":
      return right.kind === "UnitType";
  }
}

function equivalentExpressions(left: Expression, right: Expression): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "IntegerLiteral":
      return right.kind === "IntegerLiteral" && left.value === right.value;
    case "BooleanLiteral":
      return right.kind === "BooleanLiteral" && left.value === right.value;
    case "NameExpression":
      return right.kind === "NameExpression" && left.name === right.name;
    case "IndexExpression":
      return (
        right.kind === "IndexExpression" &&
        equivalentExpressions(left.collection, right.collection) &&
        equivalentExpressions(left.index, right.index)
      );
    case "UnaryExpression":
      return (
        right.kind === "UnaryExpression" &&
        left.operator === right.operator &&
        equivalentExpressions(left.operand, right.operand)
      );
    case "BinaryExpression":
      return (
        right.kind === "BinaryExpression" &&
        left.operator === right.operator &&
        equivalentExpressions(left.left, right.left) &&
        equivalentExpressions(left.right, right.right)
      );
    case "RequireExpression":
      return (
        right.kind === "RequireExpression" &&
        equivalentExpressions(left.condition, right.condition)
      );
    case "IfExpression":
      return (
        right.kind === "IfExpression" &&
        equivalentExpressions(left.condition, right.condition) &&
        equivalentExpressions(left.thenBranch, right.thenBranch) &&
        equivalentExpressions(left.elseBranch, right.elseBranch)
      );
    case "BlockExpression":
      return (
        right.kind === "BlockExpression" &&
        left.statements.length === 0 &&
        right.statements.length === 0 &&
        (left.tail === null || right.tail === null
          ? left.tail === right.tail
          : equivalentExpressions(left.tail, right.tail))
      );
  }
}

function isArithmeticOperator(
  operator: BinaryOperator,
): operator is "add" | "subtract" | "multiply" | "divide" | "modulo" {
  return (
    operator === "add" ||
    operator === "subtract" ||
    operator === "multiply" ||
    operator === "divide" ||
    operator === "modulo"
  );
}

function isOrderingOperator(
  operator: BinaryOperator,
): operator is "less" | "lessEqual" | "greater" | "greaterEqual" {
  return (
    operator === "less" ||
    operator === "lessEqual" ||
    operator === "greater" ||
    operator === "greaterEqual"
  );
}

function compoundArithmeticOperator(
  operator: Exclude<AssignmentStatement["operator"], "assign">,
): "add" | "subtract" | "multiply" | "divide" | "modulo" {
  switch (operator) {
    case "addAssign":
      return "add";
    case "subtractAssign":
      return "subtract";
    case "multiplyAssign":
      return "multiply";
    case "divideAssign":
      return "divide";
    case "moduloAssign":
      return "modulo";
  }
}

function sameLayouts(
  left: ReadonlySet<InputLayout>,
  right: ReadonlySet<InputLayout>,
): boolean {
  return (
    left.size === right.size &&
    [...left].every((layout) => right.has(layout))
  );
}

function compareExactIntegers(
  operator: "less" | "lessEqual" | "greater" | "greaterEqual",
  left: bigint | null,
  right: bigint | null,
): boolean | null {
  if (left === null || right === null) {
    return null;
  }
  switch (operator) {
    case "less":
      return left < right;
    case "lessEqual":
      return left <= right;
    case "greater":
      return left > right;
    case "greaterEqual":
      return left >= right;
  }
}

function logicalExact(
  operator: "logicalAnd" | "logicalOr",
  left: boolean | null,
  right: boolean | null,
): boolean | null {
  if (operator === "logicalAnd") {
    if (left === false || right === false) return false;
    if (left === true && right === true) return true;
    return null;
  }
  if (left === true || right === true) return true;
  if (left === false && right === false) return false;
  return null;
}

function uniqueSymbols(values: readonly SymbolInfo[]): readonly SymbolInfo[] {
  return [...new Set(values)];
}

function exactInterval(value: bigint): IntegerInterval {
  return { minimum: value, maximum: value };
}

function exactOnly(
  interval: IntegerInterval | null,
): IntegerInterval | null {
  return interval !== null && interval.minimum === interval.maximum
    ? interval
    : null;
}

function clampInterval(minimum: bigint, maximum: bigint): IntegerInterval {
  const clampedMinimum = minimum < I64_MIN ? I64_MIN : minimum;
  const clampedMaximum = maximum > I64_MAX ? I64_MAX : maximum;
  if (clampedMinimum > clampedMaximum) {
    return { minimum: I64_MIN, maximum: I64_MAX };
  }
  return { minimum: clampedMinimum, maximum: clampedMaximum };
}

function arithmeticInterval(
  operator: "add" | "subtract" | "multiply" | "divide" | "modulo",
  left: IntegerInterval,
  right: IntegerInterval,
): IntegerInterval {
  if (operator === "add") {
    return clampInterval(left.minimum + right.minimum, left.maximum + right.maximum);
  }
  if (operator === "subtract") {
    return clampInterval(left.minimum - right.maximum, left.maximum - right.minimum);
  }
  if (operator === "multiply") {
    return intervalFromCandidates([
      left.minimum * right.minimum,
      left.minimum * right.maximum,
      left.maximum * right.minimum,
      left.maximum * right.maximum,
    ]);
  }
  if (right.minimum <= 0n && right.maximum >= 0n) {
    return { minimum: I64_MIN, maximum: I64_MAX };
  }
  if (operator === "modulo") {
    if (right.minimum > 0n) {
      return { minimum: 0n, maximum: minBigInt(I64_MAX, right.maximum - 1n) };
    }
    return { minimum: maxBigInt(I64_MIN, right.minimum + 1n), maximum: 0n };
  }
  return intervalFromCandidates([
    pythonFloorDivide(left.minimum, right.minimum),
    pythonFloorDivide(left.minimum, right.maximum),
    pythonFloorDivide(left.maximum, right.minimum),
    pythonFloorDivide(left.maximum, right.maximum),
  ]);
}

function intervalFromCandidates(candidates: readonly bigint[]): IntegerInterval {
  let minimum = candidates[0] ?? I64_MIN;
  let maximum = minimum;
  for (const candidate of candidates.slice(1)) {
    minimum = minBigInt(minimum, candidate);
    maximum = maxBigInt(maximum, candidate);
  }
  return clampInterval(minimum, maximum);
}

function evaluateArithmetic(
  operator: "add" | "subtract" | "multiply" | "divide" | "modulo",
  left: bigint,
  right: bigint,
): bigint {
  switch (operator) {
    case "add":
      return left + right;
    case "subtract":
      return left - right;
    case "multiply":
      return left * right;
    case "divide":
      return pythonFloorDivide(left, right);
    case "modulo":
      return pythonModulo(left, right);
  }
}

function pythonFloorDivide(left: bigint, right: bigint): bigint {
  let quotient = left / right;
  const remainder = left % right;
  if (remainder !== 0n && (remainder < 0n) !== (right < 0n)) {
    quotient -= 1n;
  }
  return quotient;
}

function pythonModulo(left: bigint, right: bigint): bigint {
  const remainder = left % right;
  if (remainder !== 0n && (remainder < 0n) !== (right < 0n)) {
    return remainder + right;
  }
  return remainder;
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
