import type {
  ArrayType,
  AssignmentStatement,
  BinaryOperator,
  CallExpression,
  DynamicArrayType,
  Expression,
  ForStatement,
  FunctionDeclaration,
  FunctionParameter,
  IfStatement,
  IndexExpression,
  IndexTokenPattern,
  InputBlock,
  IntType,
  NameExpression,
  NameLineInputPattern,
  NameTokenPattern,
  Program,
  ReturnStatement,
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
export type ExtendedBaseType = BaseType | "ArrayV" | "Byte" | "Regex";

export interface RefinementType {
  readonly base: ExtendedBaseType;
  /** Every runtime value this expression/type can produce. */
  readonly interval: IntegerInterval | null;
  /** Values accepted for every possible evaluation of dependent bounds. */
  readonly guaranteedInterval: IntegerInterval | null;
  readonly exactBoolean: boolean | null;
  readonly arrayType: ArrayType | null;
  readonly dynamicArrayType?: DynamicArrayType | null;
}

export interface SymbolInfo {
  readonly id: number;
  readonly name: string;
  readonly cxxName: string;
  readonly declaration: ValueDeclaration | FunctionParameter;
  readonly valueType: ValueType;
  readonly mutable: boolean;
  readonly declarationLoopDepth: number;
  readonly interval: IntegerInterval | null;
  readonly guaranteedInterval: IntegerInterval | null;
  readonly dependencies: readonly SymbolInfo[];
  readonly provablyEmpty: boolean;
  readonly ownerFunction: FunctionInfo | null;
  everAssigned: boolean;
}

export interface FunctionInfo {
  readonly id: number;
  readonly name: string;
  readonly cxxName: string;
  readonly parameters: readonly FunctionParameter[];
  readonly returnType: ValueType;
  readonly ownerFunction: FunctionInfo | null;
  readonly scopeId: number;
  declaration: FunctionDeclaration;
  definition: FunctionDeclaration | null;
  definitelyAssignedCaptures: Set<SymbolInfo>;
  possiblyAssignedCaptures: Set<SymbolInfo>;
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
  readonly functions: readonly FunctionInfo[];
  readonly resolvedFunctions: ReadonlyMap<CallExpression, FunctionInfo>;
  readonly resolvedFunctionDeclarations: ReadonlyMap<FunctionDeclaration, FunctionInfo>;
}

export interface AnalysisResult {
  readonly analyzed: AnalyzedProgram | null;
  readonly diagnostics: readonly Diagnostic[];
}

interface FunctionEffectSummary {
  readonly definitelyAssigned: ReadonlySet<string>;
  readonly possiblyAssigned: ReadonlySet<string>;
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
  let effects = new Map<number, FunctionEffectSummary>();
  let result: AnalysisResult | null = null;
  for (let iteration = 0; iteration <= program.items.length + 32; iteration += 1) {
    const analyzer = new SemanticAnalyzer(program, effects);
    result = analyzer.run();
    const nextEffects = analyzer.functionEffects();
    if (equivalentFunctionEffects(effects, nextEffects)) {
      return result;
    }
    effects = nextEffects;
  }
  return result!;
}

export function isSubtype(subtype: RefinementType, supertype: RefinementType): boolean {
  if (subtype.base !== supertype.base) {
    return false;
  }
  if (subtype.base === "Int") {
    if (
      sameInterval(subtype.interval, supertype.interval) &&
      sameInterval(subtype.guaranteedInterval, supertype.guaranteedInterval)
    ) {
      return true;
    }
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
    if (
      sameInterval(subtype.interval, supertype.interval) &&
      sameInterval(subtype.guaranteedInterval, supertype.guaranteedInterval)
    ) {
      return true;
    }
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
  if (subtype.base === "ArrayV") {
    return equivalentValueTypes(
      subtype.dynamicArrayType!,
      supertype.dynamicArrayType!,
    );
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
  private readonly functionScopes: Map<string, FunctionInfo>[] = [new Map()];
  private readonly functionScopeIds: number[] = [0];
  private readonly allFunctions: FunctionInfo[] = [];
  private readonly resolvedFunctions = new Map<CallExpression, FunctionInfo>();
  private readonly resolvedFunctionDeclarations = new Map<FunctionDeclaration, FunctionInfo>();
  private currentFunction: FunctionInfo | null = null;
  private nextFunctionScopeId = 1;
  private inputBlockCount = 0;
  private loopDepth = 0;

  public constructor(
    private readonly program: Program,
    private readonly seededFunctionEffects: ReadonlyMap<
      number,
      FunctionEffectSummary
    >,
  ) {}

  public functionEffects(): Map<number, FunctionEffectSummary> {
    return new Map(
      this.allFunctions.map((info) => [
        info.declaration.span.start.offset,
        {
          definitelyAssigned: new Set(
            [...info.definitelyAssignedCaptures].map(symbolEffectKey),
          ),
          possiblyAssigned: new Set(
            [...info.possiblyAssignedCaptures].map(symbolEffectKey),
          ),
        },
      ]),
    );
  }

  public run(): AnalysisResult {
    let state = initialFlowState();
    for (const item of this.program.items) {
      state = this.analyzeStatement(item, state);
    }
    for (const functionInfo of this.allFunctions) {
      if (functionInfo.definition === null) {
        this.error(
          "SEM_FUNCTION_NOT_DEFINED",
          `Function '${functionInfo.name}' is declared but never defined.`,
          functionInfo.declaration.span,
        );
      }
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
            functions: this.allFunctions,
            resolvedFunctions: this.resolvedFunctions,
            resolvedFunctionDeclarations: this.resolvedFunctionDeclarations,
          },
      diagnostics: this.diagnostics,
    };
  }

  private analyzeStatement(statement: Statement, state: FlowState): FlowState {
    switch (statement.kind) {
      case "ValDeclaration":
      case "VarDeclaration":
        return this.analyzeDeclaration(statement, state);
      case "FunctionDeclaration":
        return this.analyzeFunctionDeclaration(statement, state);
      case "ReturnStatement":
        return this.analyzeReturnStatement(statement, state);
      case "BreakStatement":
        if (this.loopDepth === 0) {
          this.error(
            "SEM_BREAK_OUTSIDE_LOOP",
            "'break' can only be used inside a loop.",
            statement.span,
          );
        }
        return state;
      case "ContinueStatement":
        if (this.loopDepth === 0) {
          this.error(
            "SEM_CONTINUE_OUTSIDE_LOOP",
            "'continue' can only be used inside a loop.",
            statement.span,
          );
        }
        return state;
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

  private analyzeFunctionDeclaration(
    declaration: FunctionDeclaration,
    state: FlowState,
  ): FlowState {
    if (declaration.name.name === "matches") {
      this.error(
        "SEM_RESERVED_FUNCTION_NAME",
        "'matches' is the built-in regex predicate and cannot be redeclared.",
        declaration.name.span,
      );
      return state;
    }
    if (isBuiltinName(declaration.name.name)) {
      this.error(
        "SEM_RESERVED_BUILTIN_NAME",
        `Built-in name '${declaration.name.name}' cannot be redeclared.`,
        declaration.name.span,
      );
      return state;
    }
    if (this.lookup(declaration.name.name) !== null) {
      this.error(
        "SEM_DUPLICATE_NAME",
        `Function '${declaration.name.name}' conflicts with a value declaration.`,
        declaration.name.span,
      );
      return state;
    }

    const currentFunctionScope = this.currentFunctionScope();
    let info = currentFunctionScope.get(declaration.name.name) ?? null;
    const outerFunction =
      info === null ? this.lookupFunction(declaration.name.name) : null;
    if (outerFunction !== null) {
      this.error(
        "SEM_DUPLICATE_FUNCTION_NAME",
        `Function '${declaration.name.name}' shadows an active function declaration.`,
        declaration.name.span,
      );
      return state;
    }
    if (info === null) {
      const seeded =
        this.seededFunctionEffects.get(declaration.span.start.offset) ?? null;
      info = {
        id: this.allFunctions.length,
        name: declaration.name.name,
        cxxName: this.nextFunctionCxxName(declaration.name.name),
        parameters: declaration.parameters,
        returnType: declaration.returnType,
        ownerFunction: this.currentFunction,
        scopeId: this.currentFunctionScopeId(),
        declaration,
        definition: declaration.body === null ? null : declaration,
        definitelyAssignedCaptures: new Set(
          this.allSymbols.filter((symbol) =>
            seeded?.definitelyAssigned.has(symbolEffectKey(symbol)),
          ),
        ),
        possiblyAssignedCaptures: new Set(
          this.allSymbols.filter((symbol) =>
            seeded?.possiblyAssigned.has(symbolEffectKey(symbol)),
          ),
        ),
      };
      currentFunctionScope.set(info.name, info);
      this.allFunctions.push(info);
    } else {
      if (!equivalentFunctionSignature(info, declaration)) {
        this.error(
          "SEM_FUNCTION_SIGNATURE_MISMATCH",
          `Declaration of function '${info.name}' does not match its first signature.`,
          declaration.span,
        );
        this.resolvedFunctionDeclarations.set(declaration, info);
        return state;
      }
      if (declaration.body === null) {
        this.error(
          "SEM_DUPLICATE_FUNCTION_DECLARATION",
          `Function '${info.name}' is declared more than once.`,
          declaration.span,
        );
      } else if (info.definition !== null) {
        this.error(
          "SEM_DUPLICATE_FUNCTION_DEFINITION",
          `Function '${info.name}' is defined more than once.`,
          declaration.span,
        );
      } else {
        info.definition = declaration;
      }
    }
    this.resolvedFunctionDeclarations.set(declaration, info);

    const parentFunction = this.currentFunction;
    const parentLoopDepth = this.loopDepth;
    this.currentFunction = info;
    this.loopDepth = 0;
    this.scopes.push(new Map());
    this.functionScopes.push(new Map());
    this.functionScopeIds.push(this.nextFunctionScopeId++);
    let functionState = cloneFlowState(state);
    for (const parameter of declaration.parameters) {
      const typeInfo = this.analyzeType(parameter.valueType, functionState);
      if (this.currentScope().has(parameter.name.name)) {
        this.error(
          "SEM_DUPLICATE_PARAMETER",
          `Parameter '${parameter.name.name}' is declared more than once.`,
          parameter.name.span,
        );
        continue;
      }
      const symbol: SymbolInfo = {
        id: this.allSymbols.length,
        name: parameter.name.name,
        cxxName: this.nextCxxName(parameter.name.name),
        declaration: parameter,
        valueType: parameter.valueType,
        mutable: false,
        declarationLoopDepth: 0,
        interval: typeInfo.interval,
        guaranteedInterval: typeInfo.guaranteedInterval,
        dependencies: typeInfo.dependencies,
        provablyEmpty: typeInfo.provablyEmpty,
        ownerFunction: info,
        everAssigned: true,
      };
      this.currentScope().set(symbol.name, symbol);
      this.allSymbols.push(symbol);
      functionState.definitelyAssigned.add(symbol);
      functionState.possiblyAssigned.add(symbol);
    }
    this.analyzeType(declaration.returnType, functionState);

    if (declaration.body !== null) {
      const body = this.analyzeBlockExpression(
        declaration.body,
        functionState,
        "runtime",
        this.refinementForValueType(declaration.returnType),
      );
      const expected = this.refinementForValueType(declaration.returnType);
      const bodyType = body.info?.type ?? null;
      if (
        expected.base !== "Unit" &&
        !blockAlwaysReturns(declaration.body) &&
        (bodyType === null || !isSubtype(bodyType, expected))
      ) {
        this.error(
          "SEM_FUNCTION_RETURN_TYPE_MISMATCH",
          `The final expression of function '${info.name}' is not a subtype of its declared return type.`,
          declaration.body.span,
        );
      } else if (
        expected.base === "Unit" &&
        bodyType !== null &&
        bodyType.base !== "Unit"
      ) {
        this.error(
          "SEM_FUNCTION_RETURN_TYPE_MISMATCH",
          `Function '${info.name}' declares Unit but its final expression has type '${bodyType.base}'.`,
          declaration.body.span,
        );
      }
      info.definitelyAssignedCaptures = new Set(
        [...body.state.definitelyAssigned].filter(
          (symbol) =>
            !blockContainsReturnStatement(declaration.body!) &&
            symbol.ownerFunction !== info &&
            !functionState.definitelyAssigned.has(symbol),
        ),
      );
      info.possiblyAssignedCaptures = new Set(
        [...body.state.possiblyAssigned].filter(
          (symbol) =>
            symbol.ownerFunction !== info &&
            !functionState.possiblyAssigned.has(symbol),
        ),
      );
    }
    this.scopes.pop();
    this.functionScopes.pop();
    this.functionScopeIds.pop();
    this.loopDepth = parentLoopDepth;
    this.currentFunction = parentFunction;
    return state;
  }

  private analyzeReturnStatement(
    statement: ReturnStatement,
    state: FlowState,
  ): FlowState {
    if (this.currentFunction === null) {
      this.error(
        "SEM_RETURN_OUTSIDE_FUNCTION",
        "'return' can only be used inside a function body.",
        statement.span,
      );
      return state;
    }
    const expected = this.refinementForValueType(this.currentFunction.returnType);
    if (statement.value === null) {
      if (expected.base !== "Unit") {
        this.error(
          "SEM_RETURN_TYPE_MISMATCH",
          `Function '${this.currentFunction.name}' must return '${expected.base}', not Unit.`,
          statement.span,
        );
      }
      return state;
    }
    const value = this.analyzeExpression(
      statement.value,
      state,
      "runtime",
      expected,
    );
    if (
      value.info !== null &&
      !isSubtype(value.info.type, expected)
    ) {
      this.error(
        "SEM_RETURN_TYPE_MISMATCH",
        `Returned '${value.info.type.base}' is not a subtype of the declared '${expected.base}' return type.`,
        statement.value.span,
      );
    }
    return value.state;
  }

  private analyzeUserFunctionCall(
    expression: CallExpression,
    state: FlowState,
    context: ExpressionContext,
  ): ExpressionResult {
    const callee = expression.callee as NameExpression;
    const info = this.lookupFunction(callee.name);
    if (info === null) {
      this.error(
        "SEM_UNKNOWN_FUNCTION",
        `Function '${callee.name}' must be declared before it is called.`,
        callee.span,
      );
      let next = state;
      for (const argument of expression.arguments) {
        next = this.analyzeExpression(argument, next, context).state;
      }
      return { info: null, state: next };
    }
    this.resolvedFunctions.set(expression, info);
    if (expression.arguments.length !== info.parameters.length) {
      this.error(
        "SEM_ARGUMENT_COUNT",
        `Function '${info.name}' expects ${info.parameters.length} argument(s), but received ${expression.arguments.length}.`,
        expression.span,
      );
    }
    let next = state;
    const dependencies: SymbolInfo[] = [];
    const parameterArguments = new Map<FunctionParameter, Expression>();
    for (let index = 0; index < expression.arguments.length; index += 1) {
      const argument = expression.arguments[index]!;
      const parameter = info.parameters[index];
      let expected: RefinementType | null = null;
      if (parameter !== undefined) {
        const instantiated = this.instantiateValueType(
          parameter.valueType,
          parameterArguments,
        );
        this.analyzeType(instantiated, next);
        expected = this.refinementForValueType(instantiated);
      }
      const result = this.analyzeExpression(argument, next, context, expected);
      next = result.state;
      dependencies.push(...(result.info?.dependencies ?? []));
      if (parameter !== undefined) {
        parameterArguments.set(parameter, argument);
      }
      if (
        expected !== null &&
        result.info !== null &&
        !isSubtype(result.info.type, expected)
      ) {
        this.error(
          "SEM_ARGUMENT_TYPE_MISMATCH",
          `Argument ${index + 1} of '${info.name}' is not a subtype of parameter '${parameter!.name.name}'.`,
          argument.span,
        );
      }
    }
    const instantiatedReturn = this.instantiateValueType(
      info.returnType,
      parameterArguments,
    );
    this.analyzeType(instantiatedReturn, next);
    for (const symbol of info.possiblyAssignedCaptures) {
      next.possiblyAssigned.add(symbol);
      symbol.everAssigned = true;
    }
    for (const symbol of info.definitelyAssignedCaptures) {
      next.definitelyAssigned.add(symbol);
      next.possiblyAssigned.add(symbol);
      symbol.everAssigned = true;
    }
    return {
      info: {
        type: this.refinementForValueType(instantiatedReturn),
        dependencies: uniqueSymbols(dependencies),
        exactInteger: null,
      },
      state: next,
    };
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
      if (
        namesInDeclaration.has(name.name) ||
        this.lookup(name.name) !== null ||
        this.lookupFunction(name.name) !== null ||
        isBuiltinName(name.name)
      ) {
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
        ownerFunction: this.currentFunction,
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
      symbol === null ? null : symbolType(symbol),
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
    } else if (valueType.kind === "DynamicArrayType") {
      const element = this.analyzeType(valueType.elementType, state);
      result = {
        interval: { minimum: 0n, maximum: I64_MAX },
        guaranteedInterval: null,
        dependencies: element.dependencies,
        provablyEmpty: false,
      };
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
    expectedType: RefinementType | null = null,
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
      case "ByteLiteral":
        result = literalResult(byteType(), state);
        break;
      case "StringLiteral":
        result = literalResult(
          stringType(exactInterval(BigInt(expression.bytes.length))),
          state,
        );
        break;
      case "RegexLiteral":
        result = literalResult(regexType(), state);
        break;
      case "ArrayLiteral":
        result = this.analyzeArrayLiteral(expression, state, context, expectedType);
        break;
      case "NameExpression":
        result = this.analyzeNameExpression(expression, state, context);
        break;
      case "IndexExpression":
        result = this.analyzeIndexExpression(expression, state, context);
        break;
      case "MemberExpression":
        result = this.analyzeMemberExpression(expression, state, context);
        break;
      case "CallExpression":
        result = this.analyzeCallExpression(expression, state, context);
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
        result = this.analyzeIfExpression(expression, state, context, expectedType);
        break;
      case "BlockExpression":
        result = this.analyzeBlockExpression(expression, state, context, expectedType);
        break;
    }
    if (result.info !== null) {
      this.expressionTypes.set(expression, result.info.type);
    }
    return result;
  }

  private analyzeArrayLiteral(
    expression: Extract<Expression, { kind: "ArrayLiteral" }>,
    state: FlowState,
    context: ExpressionContext,
    expectedType: RefinementType | null,
  ): ExpressionResult {
    if (
      expectedType?.base !== "Array" &&
      expectedType?.base !== "ArrayV"
    ) {
      this.error(
        "SEM_ARRAY_LITERAL_NEEDS_CONTEXT",
        "An array literal requires an explicit expected Array or Array_v type.",
        expression.span,
      );
      let next = state;
      for (const element of expression.elements) {
        next = this.analyzeExpression(element, next, context).state;
      }
      return { info: null, state: next };
    }

    const valueType =
      expectedType.base === "Array"
        ? expectedType.arrayType!
        : expectedType.dynamicArrayType!;
    const elementType = this.refinementForValueType(valueType.elementType);
    if (expectedType.base === "Array") {
      const expectedLength = expectedType.guaranteedInterval;
      const actualLength = BigInt(expression.elements.length);
      if (
        expectedLength === null ||
        expectedLength.minimum !== actualLength ||
        expectedLength.maximum !== actualLength
      ) {
        this.error(
          "SEM_ARRAY_LITERAL_LENGTH_MISMATCH",
          `Array literal has length ${expression.elements.length}, but the fixed Array length is not statically proven to be exactly that value.`,
          expression.span,
        );
      }
    }

    let next = state;
    const dependencies: SymbolInfo[] = [];
    for (const element of expression.elements) {
      const result = this.analyzeExpression(
        element,
        next,
        context,
        elementType,
      );
      next = result.state;
      dependencies.push(...(result.info?.dependencies ?? []));
      if (
        result.info !== null &&
        !isSubtype(result.info.type, elementType)
      ) {
        this.error(
          "SEM_ARRAY_LITERAL_ELEMENT_TYPE_MISMATCH",
          `Array literal element of type '${result.info.type.base}' is not a subtype of the expected '${elementType.base}' element type.`,
          element.span,
        );
      }
    }
    return {
      info: {
        type: expectedType,
        dependencies: uniqueSymbols(dependencies),
        exactInteger: null,
      },
      state: next,
    };
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
    if (expression.name === "INT64_MIN" || expression.name === "INT64_MAX") {
      return {
        info: {
          type: integerType(
            exactInterval(expression.name === "INT64_MIN" ? I64_MIN : I64_MAX),
          ),
          dependencies: [],
          exactInteger: expression.name === "INT64_MIN" ? I64_MIN : I64_MAX,
        },
        state,
      };
    }
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
    const activeFunction = this.currentFunction;
    if (
      activeFunction !== null &&
      activeFunction.ownerFunction !== null &&
      activeFunction.ownerFunction === symbol.ownerFunction &&
      symbol.declaration.span.start.offset >
        activeFunction.declaration.span.start.offset
    ) {
      this.error(
        "SEM_CAPTURE_DECLARED_AFTER_FUNCTION",
        `Nested function '${activeFunction.name}' cannot capture '${symbol.name}' because it is declared after the function's first declaration.`,
        expression.span,
      );
    }
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
        exactInteger:
          symbol.interval !== null &&
          symbol.interval.minimum === symbol.interval.maximum
            ? symbol.interval.minimum
            : null,
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
    if (!this.expectBase(index.info, "Int", expression.index.span)) {
      return { info: null, state: index.state };
    }
    if (collection.info === null) {
      return { info: null, state: index.state };
    }
    const collectionType = collection.info.type;
    if (
      collectionType.base !== "Array" &&
      collectionType.base !== "ArrayV" &&
      collectionType.base !== "String"
    ) {
      this.error(
        "SEM_TYPE_NOT_INDEXABLE",
        `Type '${collectionType.base}' does not support indexing.`,
        expression.collection.span,
      );
      return { info: null, state: index.state };
    }
    const length =
      collectionType.base === "Array"
        ? this.typeInfos.get(collectionType.arrayType!)?.interval ?? null
        : collectionType.base === "String"
          ? collectionType.interval
          : null;
    if (
      index.info.exactInteger !== null &&
      length !== null &&
      (index.info.exactInteger < 0n ||
        index.info.exactInteger >= length.maximum)
    ) {
      this.error(
        "SEM_INDEX_OUT_OF_BOUNDS",
        "The index is outside the value length on every execution path.",
        expression.index.span,
      );
    }
    const elementType =
      collectionType.base === "String"
        ? byteType()
        : this.refinementForValueType(
            collectionType.base === "Array"
              ? collectionType.arrayType!.elementType
              : collectionType.dynamicArrayType!.elementType,
          );
    return {
      info: {
        type: elementType,
        dependencies: uniqueSymbols([
          ...collection.info.dependencies,
          ...index.info.dependencies,
        ]),
        exactInteger: null,
      },
      state: index.state,
    };
  }

  private analyzeMemberExpression(
    expression: Extract<Expression, { kind: "MemberExpression" }>,
    state: FlowState,
    context: ExpressionContext,
  ): ExpressionResult {
    const object = this.analyzeExpression(expression.object, state, context);
    if (object.info === null) return object;
    if (expression.member.name !== "length") {
      this.error(
        "SEM_UNKNOWN_MEMBER",
        `Type '${object.info.type.base}' has no value member '${expression.member.name}'.`,
        expression.member.span,
      );
      return { info: null, state: object.state };
    }
    const type = object.info.type;
    if (type.base !== "String" && type.base !== "Array" && type.base !== "ArrayV") {
      this.error(
        "SEM_UNKNOWN_MEMBER",
        `Type '${type.base}' has no '.length' member.`,
        expression.span,
      );
      return { info: null, state: object.state };
    }
    const interval =
      type.base === "ArrayV"
        ? { minimum: 0n, maximum: I64_MAX }
        : type.interval ?? { minimum: 0n, maximum: I64_MAX };
    return {
      info: {
        type: integerType(interval, exactOnly(interval)),
        dependencies: object.info.dependencies,
        exactInteger:
          interval.minimum === interval.maximum ? interval.minimum : null,
      },
      state: object.state,
    };
  }

  private analyzeCallExpression(
    expression: CallExpression,
    state: FlowState,
    context: ExpressionContext,
  ): ExpressionResult {
    if (
      expression.callee.kind === "NameExpression" &&
      expression.callee.name === "matches"
    ) {
      if (expression.arguments.length !== 2) {
        this.error(
          "SEM_ARGUMENT_COUNT",
          "matches(...) requires exactly two arguments.",
          expression.span,
        );
      }
      let next = state;
      const first = expression.arguments[0];
      const second = expression.arguments[1];
      const stringResult =
        first === undefined
          ? null
          : this.analyzeExpression(first, next, context);
      if (stringResult !== null) next = stringResult.state;
      const regexResult =
        second === undefined
          ? null
          : this.analyzeExpression(second, next, context);
      if (regexResult !== null) next = regexResult.state;
      if (stringResult !== null) {
        this.expectBase(stringResult.info, "String", first!.span);
      }
      if (regexResult !== null) {
        this.expectBase(regexResult.info, "Regex", second!.span);
      }
      return {
        info: {
          type: booleanType(null),
          dependencies: uniqueSymbols([
            ...(stringResult?.info?.dependencies ?? []),
            ...(regexResult?.info?.dependencies ?? []),
          ]),
          exactInteger: null,
        },
        state: next,
      };
    }

    if (expression.callee.kind === "MemberExpression") {
      return this.analyzeArrayMethodCall(expression, state, context);
    }

    if (expression.callee.kind !== "NameExpression") {
      this.error(
        "SEM_NOT_CALLABLE",
        "Only a named function or an Array_v method can be called.",
        expression.callee.span,
      );
      return { info: null, state };
    }
    return this.analyzeUserFunctionCall(expression, state, context);
  }

  private analyzeArrayMethodCall(
    expression: CallExpression,
    state: FlowState,
    context: ExpressionContext,
  ): ExpressionResult {
    const callee = expression.callee as Extract<Expression, { kind: "MemberExpression" }>;
    const object = this.analyzeExpression(callee.object, state, context);
    if (object.info?.type.base !== "ArrayV") {
      this.error(
        "SEM_NOT_CALLABLE",
        `Method '${callee.member.name}' is only available on Array_v.`,
        callee.span,
      );
      return { info: null, state: object.state };
    }
    const element = this.refinementForValueType(
      object.info.type.dynamicArrayType!.elementType,
    );
    const expectedCount =
      callee.member.name === "push" || callee.member.name === "resize" ? 1 : 0;
    if (
      callee.member.name !== "push" &&
      callee.member.name !== "pop" &&
      callee.member.name !== "resize"
    ) {
      this.error(
        "SEM_UNKNOWN_MEMBER",
        `Array_v has no method '${callee.member.name}'.`,
        callee.member.span,
      );
      return { info: null, state: object.state };
    }
    if (expression.arguments.length !== expectedCount) {
      this.error(
        "SEM_ARGUMENT_COUNT",
        `Array_v.${callee.member.name}(...) requires ${expectedCount} argument(s).`,
        expression.span,
      );
    }
    let next = object.state;
    for (let index = 0; index < expression.arguments.length; index += 1) {
      const argument = expression.arguments[index]!;
      const expected =
        callee.member.name === "push"
          ? element
          : callee.member.name === "resize"
            ? integerType({ minimum: I64_MIN, maximum: I64_MAX })
            : null;
      const result = this.analyzeExpression(argument, next, context, expected);
      next = result.state;
      if (
        expected !== null &&
        result.info !== null &&
        !isSubtype(result.info.type, expected)
      ) {
        this.error(
          "SEM_ARGUMENT_TYPE_MISMATCH",
          `Argument ${index + 1} is not valid for Array_v.${callee.member.name}(...).`,
          argument.span,
        );
      }
    }
    return {
      info: {
        type: callee.member.name === "pop" ? element : unitType(),
        dependencies: object.info.dependencies,
        exactInteger: null,
      },
      state: next,
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
      case "DynamicArrayType":
        return dynamicArrayType(valueType);
      case "ByteType":
        return byteType();
      case "RegexType":
        return regexType();
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
      if (!areOrderComparable(left.info.type, right.info.type)) {
        this.error(
          "SEM_INVALID_ORDERING_OPERANDS",
          `Types '${left.info.type.base}' and '${right.info.type.base}' cannot be ordered.`,
          expression.span,
        );
        return { info: null, state: outputState };
      }
      return {
        info: {
          type: booleanType(
            left.info.type.base === "Int" &&
              right.info.type.base === "Int"
              ? compareExactIntegers(
                  expression.operator,
                  left.info.exactInteger,
                  right.info.exactInteger,
                )
              : null,
          ),
          dependencies,
          exactInteger: null,
        },
        state: outputState,
      };
    }

    if (expression.operator === "equal" || expression.operator === "notEqual") {
      if (!areEqualityComparable(left.info.type, right.info.type)) {
        this.error(
          "SEM_INVALID_EQUALITY_OPERANDS",
          `Types '${left.info.type.base}' and '${right.info.type.base}' cannot be compared for equality.`,
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
    expectedType: RefinementType | null = null,
  ): ExpressionResult {
    const condition = this.analyzeExpression(expression.condition, state, context);
    this.expectBase(condition.info, "Bool", expression.condition.span);
    const thenResult = this.analyzeExpression(
      expression.thenBranch,
      cloneFlowState(condition.state),
      context,
      expectedType,
    );
    const elseResult = this.analyzeExpression(
      expression.elseBranch,
      cloneFlowState(condition.state),
      context,
      expectedType,
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
    expectedType: RefinementType | null = null,
  ): ExpressionResult {
    if (context === "type" && expression.statements.length > 0) {
      this.error(
        "SEM_EFFECT_NOT_ALLOWED_IN_TYPE",
        "Statements are not allowed in a block used as a type constraint.",
        expression.span,
      );
    }

    this.scopes.push(new Map());
    this.functionScopes.push(new Map());
    this.functionScopeIds.push(this.nextFunctionScopeId++);
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
        : this.analyzeExpression(expression.tail, blockState, context, expectedType);
    const localSymbols = [...this.currentScope().values()];
    this.scopes.pop();
    this.functionScopes.pop();
    this.functionScopeIds.pop();
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
    const valueResult = this.analyzeExpression(
      assignment.value,
      state,
      "runtime",
      symbol === null ? null : symbolType(symbol),
    );
    if (symbol === null) {
      this.error(
        "SEM_UNKNOWN_ASSIGNMENT_NAME",
        `Assignment refers to undeclared value '${assignment.target.name}'.`,
        assignment.target.span,
      );
      return valueResult.state;
    }
    if (
      this.currentFunction !== null &&
      symbol.ownerFunction !== this.currentFunction
    ) {
      if (!symbol.mutable) {
        this.error(
          "SEM_CAPTURED_VAL_ASSIGNMENT",
          `Function '${this.currentFunction.name}' cannot assign captured immutable value '${symbol.name}'.`,
          assignment.target.span,
        );
        return valueResult.state;
      }
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
      target.info?.type ?? null,
    );
    if (
      this.expressionTypes.get(targetExpression.collection)?.base === "String"
    ) {
      this.error(
        "SEM_STRING_IS_READ_ONLY",
        "String bytes are read-only; assign a new String value instead.",
        targetExpression.span,
      );
      return value.state;
    }
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

    const canExecute =
      countResult.info.type.interval!.maximum > 0n;
    const mustExecute =
      countResult.info.type.interval!.minimum > 0n &&
      !blockContainsLoopExit(statement.body);
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

  private analyzeInputBlock(block: InputBlock, state: FlowState): FlowState {
    this.inputBlockCount += 1;
    let next = cloneFlowState(state);
    for (const line of block.lines) {
      if (line.kind === "TokenLineInputPattern") {
        for (const token of line.tokens) {
          if (token.kind !== "LiteralTokenPattern") {
            next = this.analyzeInputValue(token, next, false);
          }
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
      } else if (line.kind === "ValueLineInputPattern") {
        next = this.analyzeInputValue(line.value, next, true);
        next.layouts = new Set([line.terminated ? "lineStart" : "sealedLine"]);
      } else {
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
    if (
      this.currentFunction !== null &&
      symbol.ownerFunction !== this.currentFunction
    ) {
      if (!symbol.mutable && symbol.valueType.kind !== "ArrayType") {
        this.error(
          "SEM_CAPTURED_VAL_ASSIGNMENT",
          `Function '${this.currentFunction.name}' cannot input into captured immutable value '${symbol.name}'.`,
          pattern.span,
        );
        return state;
      }
    }
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
    return type.base === "Int" || type.base === "String";
  }

  private expectBase(
    info: ExpressionInfo | null,
    expected: ExtendedBaseType,
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

  private lookupFunction(name: string): FunctionInfo | null {
    for (let index = this.functionScopes.length - 1; index >= 0; index -= 1) {
      const info = this.functionScopes[index]?.get(name);
      if (info !== undefined) {
        return info;
      }
    }
    return null;
  }

  private currentFunctionScope(): Map<string, FunctionInfo> {
    return this.functionScopes[this.functionScopes.length - 1]!;
  }

  private currentFunctionScopeId(): number {
    return this.functionScopeIds[this.functionScopeIds.length - 1]!;
  }

  private instantiateValueType(
    valueType: ValueType,
    argumentsByParameter: ReadonlyMap<FunctionParameter, Expression>,
  ): ValueType {
    switch (valueType.kind) {
      case "IntType":
        return valueType.range === null
          ? valueType
          : {
              ...valueType,
              range: {
                ...valueType.range,
                lower: this.substituteParameterExpressions(
                  valueType.range.lower,
                  argumentsByParameter,
                ),
                upper: this.substituteParameterExpressions(
                  valueType.range.upper,
                  argumentsByParameter,
                ),
              },
            };
      case "StringType":
        return valueType.length === null
          ? valueType
          : {
              ...valueType,
              length: this.substituteParameterExpressions(
                valueType.length,
                argumentsByParameter,
              ),
            };
      case "ArrayType":
        return {
          ...valueType,
          elementType: this.instantiateValueType(
            valueType.elementType,
            argumentsByParameter,
          ),
          length: this.substituteParameterExpressions(
            valueType.length,
            argumentsByParameter,
          ),
        };
      case "DynamicArrayType":
        return {
          ...valueType,
          elementType: this.instantiateValueType(
            valueType.elementType,
            argumentsByParameter,
          ),
        };
      case "ByteType":
      case "RegexType":
      case "BoolType":
      case "UnitType":
        return valueType;
    }
  }

  private substituteParameterExpressions(
    expression: Expression,
    argumentsByParameter: ReadonlyMap<FunctionParameter, Expression>,
  ): Expression {
    if (expression.kind === "NameExpression") {
      const symbol = this.resolvedNames.get(expression);
      if (symbol?.declaration.kind === "FunctionParameter") {
        return argumentsByParameter.get(symbol.declaration) ?? expression;
      }
      return expression;
    }
    switch (expression.kind) {
      case "IndexExpression":
        return {
          ...expression,
          collection: this.substituteParameterExpressions(
            expression.collection,
            argumentsByParameter,
          ),
          index: this.substituteParameterExpressions(
            expression.index,
            argumentsByParameter,
          ),
        };
      case "MemberExpression":
        return {
          ...expression,
          object: this.substituteParameterExpressions(
            expression.object,
            argumentsByParameter,
          ),
        };
      case "CallExpression":
        return {
          ...expression,
          callee: this.substituteParameterExpressions(
            expression.callee,
            argumentsByParameter,
          ),
          arguments: expression.arguments.map((argument) =>
            this.substituteParameterExpressions(
              argument,
              argumentsByParameter,
            ),
          ),
        };
      case "UnaryExpression":
        return {
          ...expression,
          operand: this.substituteParameterExpressions(
            expression.operand,
            argumentsByParameter,
          ),
        };
      case "BinaryExpression":
        return {
          ...expression,
          left: this.substituteParameterExpressions(
            expression.left,
            argumentsByParameter,
          ),
          right: this.substituteParameterExpressions(
            expression.right,
            argumentsByParameter,
          ),
        };
      case "RequireExpression":
        return {
          ...expression,
          condition: this.substituteParameterExpressions(
            expression.condition,
            argumentsByParameter,
          ),
        };
      case "IfExpression":
        return {
          ...expression,
          condition: this.substituteParameterExpressions(
            expression.condition,
            argumentsByParameter,
          ),
          thenBranch: this.substituteParameterExpressions(
            expression.thenBranch,
            argumentsByParameter,
          ),
          elseBranch: this.substituteParameterExpressions(
            expression.elseBranch,
            argumentsByParameter,
          ),
        };
      case "BlockExpression":
        return {
          ...expression,
          tail:
            expression.tail === null
              ? null
              : this.substituteParameterExpressions(
                  expression.tail,
                  argumentsByParameter,
                ),
        };
      case "ArrayLiteral":
        return {
          ...expression,
          elements: expression.elements.map((element) =>
            this.substituteParameterExpressions(
              element,
              argumentsByParameter,
            ),
          ),
        };
      case "IntegerLiteral":
      case "BooleanLiteral":
      case "ByteLiteral":
      case "StringLiteral":
      case "RegexLiteral":
        return expression;
    }
  }

  private nextCxxName(name: string): string {
    const count = (this.generatedNameCounts.get(name) ?? 0) + 1;
    this.generatedNameCounts.set(name, count);
    return count === 1 ? `_512_${name}` : `_512_${name}_${count}`;
  }

  private nextFunctionCxxName(name: string): string {
    return `_514_${this.allFunctions.length}_${name}`;
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

function symbolEffectKey(symbol: SymbolInfo): string {
  return `${symbol.declaration.span.start.offset}:${symbol.name}`;
}

function equivalentFunctionEffects(
  left: ReadonlyMap<number, FunctionEffectSummary>,
  right: ReadonlyMap<number, FunctionEffectSummary>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, leftSummary] of left) {
    const rightSummary = right.get(key);
    if (
      rightSummary === undefined ||
      !sameStringSet(
        leftSummary.definitelyAssigned,
        rightSummary.definitelyAssigned,
      ) ||
      !sameStringSet(
        leftSummary.possiblyAssigned,
        rightSummary.possiblyAssigned,
      )
    ) {
      return false;
    }
  }
  return true;
}

function sameStringSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return (
    left.size === right.size &&
    [...left].every((value) => right.has(value))
  );
}

function sameInterval(
  left: IntegerInterval | null,
  right: IntegerInterval | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.minimum === right.minimum &&
      left.maximum === right.maximum)
  );
}

function literalResult(
  type: RefinementType,
  state: FlowState,
): ExpressionResult {
  return {
    info: { type, dependencies: [], exactInteger: null },
    state,
  };
}

function equivalentFunctionSignature(
  info: FunctionInfo,
  declaration: FunctionDeclaration,
): boolean {
  return (
    info.parameters.length === declaration.parameters.length &&
    info.parameters.every((parameter, index) =>
      equivalentValueTypes(
        parameter.valueType,
        declaration.parameters[index]!.valueType,
      ),
    ) &&
    equivalentValueTypes(info.returnType, declaration.returnType)
  );
}

function blockAlwaysReturns(block: Extract<Expression, { kind: "BlockExpression" }>): boolean {
  return block.statements.some(statementAlwaysReturns);
}

function statementAlwaysReturns(statement: Statement): boolean {
  if (statement.kind === "ReturnStatement") return true;
  if (statement.kind !== "IfStatement" || statement.elseBranch === null) {
    return false;
  }
  const thenReturns = blockAlwaysReturns(statement.thenBranch);
  const elseReturns =
    statement.elseBranch.kind === "IfStatement"
      ? statementAlwaysReturns(statement.elseBranch)
      : blockAlwaysReturns(statement.elseBranch);
  return thenReturns && elseReturns;
}

function sameBytes(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function blockContainsLoopExit(
  block: Extract<Expression, { kind: "BlockExpression" }>,
): boolean {
  return block.statements.some(statementContainsLoopExit);
}

function blockContainsReturnStatement(
  block: Extract<Expression, { kind: "BlockExpression" }>,
): boolean {
  return block.statements.some(statementContainsReturnStatement);
}

function statementContainsReturnStatement(statement: Statement): boolean {
  switch (statement.kind) {
    case "ReturnStatement":
      return true;
    case "IfStatement":
      return (
        blockContainsReturnStatement(statement.thenBranch) ||
        (statement.elseBranch !== null &&
          (statement.elseBranch.kind === "IfStatement"
            ? statementContainsReturnStatement(statement.elseBranch)
            : blockContainsReturnStatement(statement.elseBranch)))
      );
    case "ForStatement":
    case "WhileStatement":
      return blockContainsReturnStatement(statement.body);
    case "ExpressionStatement":
      return expressionContainsReturnStatement(statement.expression);
    case "ValDeclaration":
    case "VarDeclaration":
      return (
        statement.initializer !== null &&
        expressionContainsReturnStatement(statement.initializer)
      );
    case "AssignmentStatement":
      return expressionContainsReturnStatement(statement.value);
    case "FunctionDeclaration":
    case "InputBlock":
    case "BreakStatement":
    case "ContinueStatement":
    case "EmptyStatement":
      return false;
  }
}

function expressionContainsReturnStatement(expression: Expression): boolean {
  switch (expression.kind) {
    case "BlockExpression":
      return blockContainsReturnStatement(expression);
    case "IfExpression":
      return (
        expressionContainsReturnStatement(expression.condition) ||
        expressionContainsReturnStatement(expression.thenBranch) ||
        expressionContainsReturnStatement(expression.elseBranch)
      );
    case "ArrayLiteral":
      return expression.elements.some(expressionContainsReturnStatement);
    case "IndexExpression":
      return (
        expressionContainsReturnStatement(expression.collection) ||
        expressionContainsReturnStatement(expression.index)
      );
    case "MemberExpression":
      return expressionContainsReturnStatement(expression.object);
    case "CallExpression":
      return (
        expressionContainsReturnStatement(expression.callee) ||
        expression.arguments.some(expressionContainsReturnStatement)
      );
    case "UnaryExpression":
      return expressionContainsReturnStatement(expression.operand);
    case "BinaryExpression":
      return (
        expressionContainsReturnStatement(expression.left) ||
        expressionContainsReturnStatement(expression.right)
      );
    case "RequireExpression":
      return expressionContainsReturnStatement(expression.condition);
    case "IntegerLiteral":
    case "BooleanLiteral":
    case "ByteLiteral":
    case "StringLiteral":
    case "RegexLiteral":
    case "NameExpression":
      return false;
  }
}

function statementContainsLoopExit(statement: Statement): boolean {
  switch (statement.kind) {
    case "BreakStatement":
    case "ContinueStatement":
      return true;
    case "IfStatement":
      return (
        blockContainsLoopExit(statement.thenBranch) ||
        (statement.elseBranch !== null &&
          (statement.elseBranch.kind === "IfStatement"
            ? statementContainsLoopExit(statement.elseBranch)
            : blockContainsLoopExit(statement.elseBranch)))
      );
    case "ExpressionStatement":
      return expressionContainsLoopExit(statement.expression);
    case "ValDeclaration":
    case "VarDeclaration":
      return (
        statement.initializer !== null &&
        expressionContainsLoopExit(statement.initializer)
      );
    case "AssignmentStatement":
      return expressionContainsLoopExit(statement.value);
    case "ReturnStatement":
      return (
        statement.value !== null &&
        expressionContainsLoopExit(statement.value)
      );
    case "ForStatement":
    case "WhileStatement":
    case "FunctionDeclaration":
    case "InputBlock":
    case "EmptyStatement":
      return false;
  }
}

function expressionContainsLoopExit(expression: Expression): boolean {
  switch (expression.kind) {
    case "BlockExpression":
      return blockContainsLoopExit(expression);
    case "IfExpression":
      return (
        expressionContainsLoopExit(expression.condition) ||
        expressionContainsLoopExit(expression.thenBranch) ||
        expressionContainsLoopExit(expression.elseBranch)
      );
    case "ArrayLiteral":
      return expression.elements.some(expressionContainsLoopExit);
    case "IndexExpression":
      return (
        expressionContainsLoopExit(expression.collection) ||
        expressionContainsLoopExit(expression.index)
      );
    case "MemberExpression":
      return expressionContainsLoopExit(expression.object);
    case "CallExpression":
      return (
        expressionContainsLoopExit(expression.callee) ||
        expression.arguments.some(expressionContainsLoopExit)
      );
    case "UnaryExpression":
      return expressionContainsLoopExit(expression.operand);
    case "BinaryExpression":
      return (
        expressionContainsLoopExit(expression.left) ||
        expressionContainsLoopExit(expression.right)
      );
    case "RequireExpression":
      return expressionContainsLoopExit(expression.condition);
    case "IntegerLiteral":
    case "BooleanLiteral":
    case "ByteLiteral":
    case "StringLiteral":
    case "RegexLiteral":
    case "NameExpression":
      return false;
  }
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
    case "DynamicArrayType":
      return dynamicArrayType(symbol.valueType);
    case "ByteType":
      return byteType();
    case "RegexType":
      return regexType();
    case "BoolType":
      return booleanType(null);
    case "UnitType":
      return unitType();
  }
}

function baseTypeOf(valueType: ValueType): ExtendedBaseType {
  switch (valueType.kind) {
    case "IntType":
      return "Int";
    case "StringType":
      return "String";
    case "ArrayType":
      return "Array";
    case "DynamicArrayType":
      return "ArrayV";
    case "ByteType":
      return "Byte";
    case "RegexType":
      return "Regex";
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

function dynamicArrayType(valueType: DynamicArrayType): RefinementType {
  return {
    base: "ArrayV",
    interval: { minimum: 0n, maximum: I64_MAX },
    guaranteedInterval: null,
    exactBoolean: null,
    arrayType: null,
    dynamicArrayType: valueType,
  };
}

function byteType(): RefinementType {
  return {
    base: "Byte",
    interval: null,
    guaranteedInterval: null,
    exactBoolean: null,
    arrayType: null,
    dynamicArrayType: null,
  };
}

function regexType(): RefinementType {
  return {
    base: "Regex",
    interval: null,
    guaranteedInterval: null,
    exactBoolean: null,
    arrayType: null,
    dynamicArrayType: null,
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
  if (left.base === "ArrayV") {
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
    case "MemberExpression":
      return containsIndexExpression(expression.object);
    case "CallExpression":
      return (
        containsIndexExpression(expression.callee) ||
        expression.arguments.some(containsIndexExpression)
      );
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
    case "ArrayLiteral":
      return expression.elements.some(containsIndexExpression);
    case "IntegerLiteral":
    case "BooleanLiteral":
    case "ByteLiteral":
    case "StringLiteral":
    case "RegexLiteral":
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
    case "DynamicArrayType":
      return (
        right.kind === "DynamicArrayType" &&
        equivalentValueTypes(left.elementType, right.elementType)
      );
    case "ByteType":
      return right.kind === "ByteType";
    case "RegexType":
      return right.kind === "RegexType";
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
    case "ByteLiteral":
      return right.kind === "ByteLiteral" && left.value === right.value;
    case "StringLiteral":
      return (
        right.kind === "StringLiteral" &&
        sameBytes(left.bytes, right.bytes)
      );
    case "RegexLiteral":
      return right.kind === "RegexLiteral" && sameBytes(left.bytes, right.bytes);
    case "ArrayLiteral":
      return (
        right.kind === "ArrayLiteral" &&
        left.elements.length === right.elements.length &&
        left.elements.every((element, index) =>
          equivalentExpressions(element, right.elements[index]!),
        )
      );
    case "NameExpression":
      return right.kind === "NameExpression" && left.name === right.name;
    case "IndexExpression":
      return (
        right.kind === "IndexExpression" &&
        equivalentExpressions(left.collection, right.collection) &&
        equivalentExpressions(left.index, right.index)
      );
    case "MemberExpression":
      return (
        right.kind === "MemberExpression" &&
        left.member.name === right.member.name &&
        equivalentExpressions(left.object, right.object)
      );
    case "CallExpression":
      return (
        right.kind === "CallExpression" &&
        equivalentExpressions(left.callee, right.callee) &&
        left.arguments.length === right.arguments.length &&
        left.arguments.every((argument, index) =>
          equivalentExpressions(argument, right.arguments[index]!),
        )
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

function areEqualityComparable(
  left: RefinementType,
  right: RefinementType,
): boolean {
  const leftElement = sequenceElementType(left);
  const rightElement = sequenceElementType(right);
  if (leftElement !== null || rightElement !== null) {
    return (
      leftElement !== null &&
      rightElement !== null &&
      areValueTypesComparable(leftElement, rightElement, false)
    );
  }
  return (
    left.base === right.base &&
    (left.base === "Int" ||
      left.base === "Byte" ||
      left.base === "String" ||
      left.base === "Bool")
  );
}

function areOrderComparable(
  left: RefinementType,
  right: RefinementType,
): boolean {
  const leftElement = sequenceElementType(left);
  const rightElement = sequenceElementType(right);
  if (leftElement !== null || rightElement !== null) {
    return (
      leftElement !== null &&
      rightElement !== null &&
      areValueTypesComparable(leftElement, rightElement, true)
    );
  }
  return (
    left.base === right.base &&
    (left.base === "Int" ||
      left.base === "Byte" ||
      left.base === "String")
  );
}

function sequenceElementType(type: RefinementType): ValueType | null {
  if (type.base === "Array") return type.arrayType!.elementType;
  if (type.base === "ArrayV") return type.dynamicArrayType!.elementType;
  return null;
}

function areValueTypesComparable(
  left: ValueType,
  right: ValueType,
  ordering: boolean,
): boolean {
  if (
    (left.kind === "ArrayType" || left.kind === "DynamicArrayType") &&
    (right.kind === "ArrayType" || right.kind === "DynamicArrayType")
  ) {
    return areValueTypesComparable(
      left.elementType,
      right.elementType,
      ordering,
    );
  }
  if (left.kind !== right.kind) return false;
  if (
    left.kind === "IntType" ||
    left.kind === "ByteType" ||
    left.kind === "StringType"
  ) {
    return true;
  }
  return !ordering && left.kind === "BoolType";
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

function isBuiltinName(name: string): boolean {
  return name === "INT64_MIN" || name === "INT64_MAX";
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
