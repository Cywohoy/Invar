import type {
  ArrayType,
  AssignmentOperator,
  AssignmentStatement,
  BinaryOperator,
  BlockExpression,
  Expression,
  IndexExpression,
  InputBlock,
  IntRange,
  Statement,
  StringType,
  TokenInputPattern,
  ValueType,
} from "./ast";
import type {
  AnalyzedProgram,
  RefinementType,
  SymbolInfo,
} from "./semantic";

const I64_MIN = -(1n << 63n);

export interface GenerateTestlibOptions {
  readonly includeSourceComment?: boolean;
}

export function generateTestlib(
  analyzed: AnalyzedProgram,
  options: GenerateTestlibOptions = {},
): string {
  const lines: string[] = [
    ...(options.includeSourceComment === false
      ? []
      : sourceComment(analyzed.program.source)),
    '#include "testlib.h"',
    "#include <climits>",
    "#include <string>",
    "#include <vector>",
    "",
    "struct iv_u{};",
    'iv_u iv_q(bool x,const char*s){inf.ensuref(x,"require(%s) failed.",s);return{};}',
    'void iv_o(){quitf(_fail,"Invar integer expression overflow.");}',
    "long long iv_n(long long a){if(a==LLONG_MIN)iv_o();return-a;}",
    "long long iv_a(long long a,long long b){if((b>0&&a>LLONG_MAX-b)||(b<0&&a<LLONG_MIN-b))iv_o();return a+b;}",
    "long long iv_s(long long a,long long b){if((b<0&&a>LLONG_MAX+b)||(b>0&&a<LLONG_MIN+b))iv_o();return a-b;}",
    "long long iv_m(long long a,long long b){if(!a||!b)return 0;if((a==-1&&b==LLONG_MIN)||(b==-1&&a==LLONG_MIN))iv_o();if((a>0&&b>0&&a>LLONG_MAX/b)||(a>0&&b<0&&b<LLONG_MIN/a)||(a<0&&b>0&&a<LLONG_MIN/b)||(a<0&&b<0&&a<LLONG_MAX/b))iv_o();return a*b;}",
    'long long iv_d(long long a,long long b){if(!b)quitf(_fail,"Invar integer expression divides by zero.");if(a==LLONG_MIN&&b==-1)iv_o();long long q=a/b,r=a%b;if(r&&((r<0)!=(b<0)))--q;return q;}',
    'long long iv_r(long long a,long long b){if(!b)quitf(_fail,"Invar integer expression divides by zero.");if(a==LLONG_MIN&&b==-1)return 0;long long r=a%b;if(r&&((r<0)!=(b<0)))r+=b;return r;}',
    "template<class T>struct iv_v{std::vector<T>a;std::vector<unsigned char>b;iv_v()=default;iv_v(long long n,const T&x,bool z){inf.ensuref(n>=0,\"Invar Array length cannot be negative.\");a.assign((std::size_t)n,x);b.assign((std::size_t)n,z?1:0);}void c(long long i)const{inf.ensuref(i>=0&&(std::size_t)i<a.size(),\"Invar Array index is out of bounds.\");}const T&r(long long i)const{c(i);inf.ensuref(b[(std::size_t)i],\"Invar Array element is read before initialization.\");return a[(std::size_t)i];}T&w(long long i){c(i);b[(std::size_t)i]=1;return a[(std::size_t)i];}};",
    'std::string iv_l(){std::string s;while(!inf.eof()){char c=inf.readChar();if(c==\'\\r\'||c==\'\\n\')quitf(_fail,"Expected EOF after the final Invar line input.");s+=c;}return s;}',
    "",
    "int main(int argc, char* argv[]) {",
    "    registerValidation(argc, argv);",
    "",
  ];

  for (const symbol of analyzed.allSymbols) {
    lines.push(`    ${cxxValueType(symbol.valueType)} ${symbol.cxxName};`);
  }
  lines.push("    bool _513f=false;");
  if (analyzed.allSymbols.length > 0) {
    lines.push("");
  }

  for (const statement of analyzed.program.items) {
    emitStatement(lines, statement, analyzed, 1);
  }
  lines.push("    inf.readEof();", "    return 0;", "}", "");
  return lines.join("\n");
}

function sourceComment(source: string): readonly string[] {
  return [
    "// Invar source:",
    ...source.split(/\r\n|\r|\n/).map((line) => `// ${line}`),
    "//",
    "",
  ];
}

function emitStatement(
  lines: string[],
  statement: Statement,
  analyzed: AnalyzedProgram,
  indent: number,
): void {
  switch (statement.kind) {
    case "ValDeclaration":
    case "VarDeclaration":
      emitDeclaration(lines, statement, analyzed, indent);
      return;
    case "EmptyStatement":
      return;
    case "InputBlock":
      emitInputBlock(lines, statement, analyzed, indent);
      return;
    case "ExpressionStatement":
      lines.push(`${padding(indent)}${expression(statement.expression, analyzed)};`);
      return;
    case "AssignmentStatement":
      emitAssignment(lines, statement, analyzed, indent);
      return;
    case "IfStatement":
      emitIfStatement(lines, statement, analyzed, indent);
      return;
    case "ForStatement":
      emitForStatement(lines, statement, analyzed, indent);
      return;
    case "WhileStatement":
      lines.push(
        `${padding(indent)}while (${expression(statement.condition, analyzed)}) {`,
      );
      emitBlockContents(lines, statement.body, analyzed, indent + 1);
      lines.push(`${padding(indent)}}`);
      return;
  }
}

function emitAssignment(
  lines: string[],
  assignment: AssignmentStatement,
  analyzed: AnalyzedProgram,
  indent: number,
): void {
  if (assignment.target.kind === "IndexExpression") {
    emitElementAssignment(
      lines,
      assignment.target,
      assignment.operator,
      assignment.value,
      assignment.span.start.offset,
      analyzed,
      indent,
    );
    return;
  }
  const target =
    analyzed.resolvedNames.get(assignment.target)?.cxxName ??
    `_512_${assignment.target.name}`;
  const value = expression(assignment.value, analyzed);
  const assigned =
    assignment.operator === "assign"
      ? value
      : `${compoundFunction(assignment.operator)}(${target}, ${value})`;
  lines.push(`${padding(indent)}${target} = ${assigned};`);
}

function emitElementAssignment(
  lines: string[],
  targetExpression: IndexExpression,
  operator: AssignmentOperator,
  valueExpression: Expression,
  sourceOffset: number,
  analyzed: AnalyzedProgram,
  indent: number,
): void {
  const pad = padding(indent);
  const collection = writableCollection(targetExpression.collection, analyzed);
  const index = expression(targetExpression.index, analyzed);
  const value = expression(valueExpression, analyzed);
  if (operator === "assign") {
    lines.push(`${pad}${collection}.w(${index})=${value};`);
    return;
  }
  const suffix = sourceOffset.toString();
  const collectionName = `_513t${suffix}`;
  const indexName = `_513i${suffix}`;
  const valueName = `_513v${suffix}`;
  lines.push(`${pad}{`);
  lines.push(`${pad}    auto& ${collectionName} = ${collection};`);
  lines.push(`${pad}    const long long ${indexName} = ${index};`);
  lines.push(`${pad}    const auto ${valueName} = ${value};`);
  lines.push(
    `${pad}    ${collectionName}.w(${indexName}) = ` +
      `${compoundFunction(operator)}(` +
      `${collectionName}.r(${indexName}), ${valueName});`,
  );
  lines.push(`${pad}}`);
}

function emitDeclaration(
  lines: string[],
  declaration: Extract<
    Statement,
    { kind: "ValDeclaration" | "VarDeclaration" }
  >,
  analyzed: AnalyzedProgram,
  indent: number,
): void {
  emitTypeSnapshots(lines, declaration.valueType, analyzed, indent);
  const symbols = analyzed.allSymbols.filter(
    (symbol) => symbol.declaration === declaration,
  );
  for (const symbol of symbols) {
    if (declaration.initializer !== null) {
      lines.push(
        `${padding(indent)}${symbol.cxxName} = ` +
          `${expression(declaration.initializer, analyzed)};`,
      );
    } else if (declaration.valueType.kind === "ArrayType") {
      lines.push(
        `${padding(indent)}${symbol.cxxName} = ` +
          `${arrayInitialization(declaration.valueType, analyzed)};`,
      );
    }
  }
}

function emitTypeSnapshots(
  lines: string[],
  valueType: ValueType,
  analyzed: AnalyzedProgram,
  indent: number,
): void {
  const expressions: Expression[] = [];
  collectTypeExpressions(valueType, expressions);
  for (const value of expressions) {
    const snapshot = analyzed.capturedTypeExpressions.get(value);
    if (snapshot !== undefined) {
      lines.push(
        `${padding(indent)}const long long ${snapshot} = ` +
          `${expression(value, analyzed)};`,
      );
    }
  }
}

function collectTypeExpressions(
  valueType: ValueType,
  output: Expression[],
): void {
  switch (valueType.kind) {
    case "IntType":
      if (valueType.range !== null) {
        output.push(valueType.range.lower, valueType.range.upper);
      }
      return;
    case "StringType":
      if (valueType.length !== null) {
        output.push(valueType.length);
      }
      return;
    case "ArrayType":
      collectTypeExpressions(valueType.elementType, output);
      output.push(valueType.length);
      return;
    case "BoolType":
    case "UnitType":
      return;
  }
}

function emitForStatement(
  lines: string[],
  statement: Extract<Statement, { kind: "ForStatement" }>,
  analyzed: AnalyzedProgram,
  indent: number,
): void {
  const suffix = statement.span.start.offset.toString();
  const countName = `_513c${suffix}`;
  const indexName = `_513i${suffix}`;
  const pad = padding(indent);
  lines.push(
    `${pad}const long long ${countName} = ${expression(statement.count, analyzed)};`,
  );
  lines.push(
    `${pad}inf.ensuref(${countName} >= 0, "Invar for count cannot be negative.");`,
  );
  lines.push(
    `${pad}for (long long ${indexName} = 0; ${indexName} < ${countName}; ` +
      `++${indexName}) {`,
  );
  emitBlockContents(lines, statement.body, analyzed, indent + 1);
  lines.push(`${pad}}`);
}

function emitIfStatement(
  lines: string[],
  statement: Extract<Statement, { kind: "IfStatement" }>,
  analyzed: AnalyzedProgram,
  indent: number,
  elsePrefix = false,
): void {
  const pad = padding(indent);
  const prefix = elsePrefix ? "else if" : "if";
  lines.push(`${pad}${prefix} (${expression(statement.condition, analyzed)}) {`);
  emitBlockContents(lines, statement.thenBranch, analyzed, indent + 1);
  lines.push(`${pad}}`);
  if (statement.elseBranch === null) {
    return;
  }
  if (statement.elseBranch.kind === "IfStatement") {
    emitIfStatement(lines, statement.elseBranch, analyzed, indent, true);
  } else {
    lines.push(`${pad}else {`);
    emitBlockContents(lines, statement.elseBranch, analyzed, indent + 1);
    lines.push(`${pad}}`);
  }
}

function emitBlockContents(
  lines: string[],
  block: BlockExpression,
  analyzed: AnalyzedProgram,
  indent: number,
): void {
  for (const statement of block.statements) {
    emitStatement(lines, statement, analyzed, indent);
  }
  if (block.tail !== null) {
    lines.push(`${padding(indent)}${expression(block.tail, analyzed)};`);
  }
}

function emitInputBlock(
  lines: string[],
  block: InputBlock,
  analyzed: AnalyzedProgram,
  indent: number,
): void {
  const pad = padding(indent);
  for (const line of block.lines) {
    if (line.kind === "ValueLineInputPattern") {
      const symbol = analyzed.resolvedNames.get(line.value);
      if (symbol !== undefined) {
        lines.push(`${pad}if (_513f) {`);
        lines.push(`${pad}    quitf(_fail, "Expected a whole line at line start.");`);
        lines.push(`${pad}}`);
        emitLineRead(lines, symbol, analyzed, line.terminated, indent);
        lines.push(`${pad}_513f=${line.terminated ? "false" : "true"};`);
      }
      continue;
    }

    for (const token of line.tokens) {
      lines.push(`${pad}if (_513f)inf.readSpace();`);
      emitTokenPatternRead(lines, token, analyzed, indent);
      lines.push(`${pad}_513f=true;`);
    }
    if (line.terminated) {
      lines.push(`${pad}inf.readEoln();`);
      lines.push(`${pad}_513f=false;`);
    }
  }
}

function emitTokenPatternRead(
  lines: string[],
  pattern: TokenInputPattern,
  analyzed: AnalyzedProgram,
  indent: number,
): void {
  if (pattern.kind === "NameTokenPattern") {
    const symbol = analyzed.resolvedNames.get(pattern);
    if (symbol !== undefined) {
      emitRead(
        lines,
        symbol.cxxName,
        symbol.name,
        symbol.valueType,
        analyzed,
        indent,
        pattern.span.start.offset,
      );
    }
    return;
  }
  const type = indexedValueType(pattern.target, analyzed);
  if (type === null) {
    return;
  }
  const pad = padding(indent);
  const targetName = `_513t${pattern.span.start.offset}`;
  lines.push(`${pad}{`);
  lines.push(
    `${pad}    auto& ${targetName} = ${writableElement(pattern.target, analyzed)};`,
  );
  emitRead(
    lines,
    targetName,
    "array element",
    type,
    analyzed,
    indent + 1,
    pattern.span.start.offset,
  );
  lines.push(`${pad}}`);
}

function emitLineRead(
  lines: string[],
  symbol: SymbolInfo,
  analyzed: AnalyzedProgram,
  terminated: boolean,
  indent: number,
): void {
  const pad = padding(indent);
  if (symbol.valueType.kind === "IntType") {
    emitRead(
      lines,
      symbol.cxxName,
      symbol.name,
      symbol.valueType,
      analyzed,
      indent,
      symbol.declaration.span.start.offset,
    );
    if (terminated) {
      lines.push(`${pad}inf.readEoln();`);
    }
    return;
  }
  if (symbol.valueType.kind !== "StringType") {
    return;
  }
  lines.push(
    terminated
      ? `${pad}${symbol.cxxName} = inf.readLine();`
      : `${pad}${symbol.cxxName}=iv_l();`,
  );
  emitStringLengthCheck(
    lines,
    symbol.cxxName,
    symbol.name,
    symbol.valueType,
    analyzed,
    indent,
  );
}

function emitRead(
  lines: string[],
  target: string,
  label: string,
  valueType: ValueType,
  analyzed: AnalyzedProgram,
  indent: number,
  uniqueOffset: number,
): void {
  const pad = padding(indent);
  if (valueType.kind === "IntType") {
    lines.push(`${pad}${target} = inf.readLong();`);
    if (valueType.range !== null) {
      lines.push(
        `${pad}inf.ensuref(${rangeCondition(target, valueType.range, analyzed)}, ` +
          `"Value '${label}' violates its Invar range.");`,
      );
    }
    return;
  }
  if (valueType.kind === "StringType") {
    lines.push(`${pad}${target} = inf.readToken();`);
    emitStringLengthCheck(lines, target, label, valueType, analyzed, indent);
    return;
  }
  if (valueType.kind === "ArrayType") {
    emitCompactArrayRead(
      lines,
      target,
      label,
      valueType,
      analyzed,
      indent,
      uniqueOffset,
    );
  }
}

function emitStringLengthCheck(
  lines: string[],
  target: string,
  label: string,
  valueType: StringType,
  analyzed: AnalyzedProgram,
  indent: number,
): void {
  if (valueType.length === null) {
    return;
  }
  const pad = padding(indent);
  lines.push(
    `${pad}inf.ensuref(static_cast<long long>(${target}.size()) == ` +
      `${typeExpression(valueType.length, analyzed)}, ` +
      `"String '${label}' has an invalid byte length.");`,
  );
}

function rangeCondition(
  target: string,
  range: IntRange,
  analyzed: AnalyzedProgram,
): string {
  const lowerOperator = range.lowerInclusive ? "<=" : "<";
  const upperOperator = range.upperInclusive ? "<=" : "<";
  return (
    `(${typeExpression(range.lower, analyzed)} ${lowerOperator} ${target}) && ` +
    `(${target} ${upperOperator} ${typeExpression(range.upper, analyzed)})`
  );
}

function emitCompactArrayRead(
  lines: string[],
  target: string,
  label: string,
  valueType: ArrayType,
  analyzed: AnalyzedProgram,
  indent: number,
  uniqueOffset: number,
): void {
  const pad = padding(indent);
  const token = `_513t${uniqueOffset}`;
  const index = `_513i${uniqueOffset}`;
  lines.push(`${pad}const std::string ${token} = inf.readToken();`);
  lines.push(
    `${pad}inf.ensuref(static_cast<long long>(${token}.size()) == ` +
      `${typeExpression(valueType.length, analyzed)}, ` +
      `"Array '${label}' has an invalid compact token byte length.");`,
  );
  lines.push(
    `${pad}for (long long ${index} = 0; ` +
      `${index} < static_cast<long long>(${token}.size()); ++${index}) {`,
  );
  lines.push(
    `${pad}    ${target}.w(${index}) = ` +
      `std::string(1, ${token}[static_cast<std::size_t>(${index})]);`,
  );
  lines.push(`${pad}}`);
}

function indexedValueType(
  target: IndexExpression,
  analyzed: AnalyzedProgram,
): ValueType | null {
  const collection = analyzed.expressionTypes.get(target.collection);
  return collection?.base === "Array"
    ? collection.arrayType!.elementType
    : null;
}

function readableCollection(
  collection: Expression,
  analyzed: AnalyzedProgram,
): string {
  return expression(collection, analyzed);
}

function writableCollection(
  collection: Expression,
  analyzed: AnalyzedProgram,
): string {
  if (collection.kind === "IndexExpression") {
    return (
      `${writableCollection(collection.collection, analyzed)}.w(` +
      `${expression(collection.index, analyzed)})`
    );
  }
  return expression(collection, analyzed);
}

function writableElement(
  target: IndexExpression,
  analyzed: AnalyzedProgram,
): string {
  return (
    `${writableCollection(target.collection, analyzed)}.w(` +
    `${expression(target.index, analyzed)})`
  );
}

function arrayInitialization(
  valueType: ArrayType,
  analyzed: AnalyzedProgram,
): string {
  const element = valueType.elementType;
  const initial =
    element.kind === "ArrayType"
      ? arrayInitialization(element, analyzed)
      : cxxDefaultValue(element);
  return (
    `${cxxValueType(valueType)}(${typeExpression(valueType.length, analyzed)}, ` +
    `${initial}, ${element.kind === "ArrayType" ? "true" : "false"})`
  );
}

function cxxDefaultValue(valueType: Exclude<ValueType, ArrayType>): string {
  switch (valueType.kind) {
    case "IntType":
      return "0LL";
    case "StringType":
      return "std::string{}";
    case "BoolType":
      return "false";
    case "UnitType":
      return "iv_u{}";
  }
}

function expression(value: Expression, analyzed: AnalyzedProgram): string {
  switch (value.kind) {
    case "NameExpression":
      return analyzed.resolvedNames.get(value)?.cxxName ?? `_512_${value.name}`;
    case "IndexExpression":
      return `${readableCollection(value.collection, analyzed)}.r(` +
        `${expression(value.index, analyzed)})`;
    case "IntegerLiteral":
      if (value.value === I64_MIN) {
        return "(-9223372036854775807LL - 1)";
      }
      return `${value.value.toString()}LL`;
    case "BooleanLiteral":
      return value.value ? "true" : "false";
    case "UnaryExpression": {
      const operand = expression(value.operand, analyzed);
      if (value.operator === "plus") return `(${operand})`;
      if (value.operator === "minus") return `iv_n(${operand})`;
      return `(!${operand})`;
    }
    case "BinaryExpression":
      return binaryExpression(value.operator, value.left, value.right, analyzed);
    case "RequireExpression":
      return (
        `iv_q(${expression(value.condition, analyzed)},` +
        `${cxxStringLiteral(sourceText(value.condition, analyzed))})`
      );
    case "IfExpression":
      return (
        `((${expression(value.condition, analyzed)}) ? ` +
        `(${expression(value.thenBranch, analyzed)}) : ` +
        `(${expression(value.elseBranch, analyzed)}))`
      );
    case "BlockExpression":
      return blockExpression(value, analyzed);
  }
}

function typeExpression(
  value: Expression,
  analyzed: AnalyzedProgram,
): string {
  return (
    analyzed.capturedTypeExpressions.get(value) ??
    expression(value, analyzed)
  );
}

function sourceText(
  value: Expression,
  analyzed: AnalyzedProgram,
): string {
  return analyzed.program.source.slice(
    value.span.start.offset,
    value.span.end.offset,
  );
}

function cxxStringLiteral(value: string): string {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll("\t", "\\t")
    .replaceAll("\0", "\\0")}"`;
}

function blockExpression(
  value: Extract<Expression, { kind: "BlockExpression" }>,
  analyzed: AnalyzedProgram,
): string {
  const type = analyzed.expressionTypes.get(value) ?? unitRefinement();
  const lines: string[] = [`([&]() -> ${cxxExpressionType(type)} {`];
  for (const statement of value.statements) {
    emitStatement(lines, statement, analyzed, 1);
  }
  lines.push(
    value.tail === null
      ? "    return iv_u{};"
      : `    return ${expression(value.tail, analyzed)};`,
  );
  lines.push("}())");
  return lines.join("\n");
}

function binaryExpression(
  operator: BinaryOperator,
  left: Expression,
  right: Expression,
  analyzed: AnalyzedProgram,
): string {
  const leftCode = expression(left, analyzed);
  const rightCode = expression(right, analyzed);
  switch (operator) {
    case "add":
      return `iv_a(${leftCode},${rightCode})`;
    case "subtract":
      return `iv_s(${leftCode},${rightCode})`;
    case "multiply":
      return `iv_m(${leftCode},${rightCode})`;
    case "divide":
      return `iv_d(${leftCode},${rightCode})`;
    case "modulo":
      return `iv_r(${leftCode},${rightCode})`;
    case "equal":
      return `((${leftCode}) == (${rightCode}))`;
    case "notEqual":
      return `((${leftCode}) != (${rightCode}))`;
    case "less":
      return `((${leftCode}) < (${rightCode}))`;
    case "lessEqual":
      return `((${leftCode}) <= (${rightCode}))`;
    case "greater":
      return `((${leftCode}) > (${rightCode}))`;
    case "greaterEqual":
      return `((${leftCode}) >= (${rightCode}))`;
    case "logicalAnd":
      return `((${leftCode}) && (${rightCode}))`;
    case "logicalOr":
      return `((${leftCode}) || (${rightCode}))`;
  }
}

function cxxValueType(valueType: ValueType): string {
  switch (valueType.kind) {
    case "IntType":
      return "long long";
    case "StringType":
      return "std::string";
    case "ArrayType":
      return `iv_v<${cxxValueType(valueType.elementType)}>`;
    case "BoolType":
      return "bool";
    case "UnitType":
      return "iv_u";
  }
}

function compoundFunction(
  operator: Exclude<AssignmentOperator, "assign">,
): string {
  switch (operator) {
    case "addAssign":
      return "iv_a";
    case "subtractAssign":
      return "iv_s";
    case "multiplyAssign":
      return "iv_m";
    case "divideAssign":
      return "iv_d";
    case "moduloAssign":
      return "iv_r";
  }
}

function cxxExpressionType(type: RefinementType): string {
  switch (type.base) {
    case "Int":
      return "long long";
    case "String":
      return "std::string";
    case "Bool":
      return "bool";
    case "Unit":
      return "iv_u";
    case "Array":
      return cxxValueType(type.arrayType!);
  }
}

function unitRefinement(): RefinementType {
  return {
    base: "Unit",
    interval: null,
    guaranteedInterval: null,
    exactBoolean: null,
    arrayType: null,
  };
}

function padding(level: number): string {
  return "    ".repeat(level);
}
