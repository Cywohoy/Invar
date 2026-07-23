import type {
  ArrayType,
  AssignmentOperator,
  AssignmentStatement,
  BinaryOperator,
  BlockExpression,
  CallExpression,
  Expression,
  FunctionDeclaration,
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
    "#include <functional>",
    "#include <initializer_list>",
    "#include <memory>",
    "#include <string>",
    "#include <vector>",
    "",
    "struct iv_u{};",
    "std::string iv_b(std::initializer_list<unsigned int>x){std::string s;s.reserve(x.size());for(unsigned int c:x)s.push_back(static_cast<char>(c));return s;}",
    "struct iv_x{std::string s;};",
    "bool iv_e(const std::string&s,const iv_x&r){return pattern(r.s).matches(s);}",
    'iv_u iv_q(bool x,const char*s){inf.ensuref(x,"require(%s) failed.",s);return{};}',
    'void iv_o(){quitf(_fail,"Invar integer expression overflow.");}',
    "long long iv_n(long long a){if(a==LLONG_MIN)iv_o();return-a;}",
    "long long iv_a(long long a,long long b){if((b>0&&a>LLONG_MAX-b)||(b<0&&a<LLONG_MIN-b))iv_o();return a+b;}",
    "long long iv_s(long long a,long long b){if((b<0&&a>LLONG_MAX+b)||(b>0&&a<LLONG_MIN+b))iv_o();return a-b;}",
    "long long iv_m(long long a,long long b){if(!a||!b)return 0;if((a==-1&&b==LLONG_MIN)||(b==-1&&a==LLONG_MIN))iv_o();if((a>0&&b>0&&a>LLONG_MAX/b)||(a>0&&b<0&&b<LLONG_MIN/a)||(a<0&&b>0&&a<LLONG_MIN/b)||(a<0&&b<0&&a<LLONG_MAX/b))iv_o();return a*b;}",
    'long long iv_d(long long a,long long b){if(!b)quitf(_fail,"Invar integer expression divides by zero.");if(a==LLONG_MIN&&b==-1)iv_o();long long q=a/b,r=a%b;if(r&&((r<0)!=(b<0)))--q;return q;}',
    'long long iv_r(long long a,long long b){if(!b)quitf(_fail,"Invar integer expression divides by zero.");if(a==LLONG_MIN&&b==-1)return 0;long long r=a%b;if(r&&((r<0)!=(b<0)))r+=b;return r;}',
    "long long iv_bl(long long x){return x==LLONG_MAX?x:x+1;}",
    "long long iv_bu(long long x){return x==LLONG_MIN?x:x-1;}",
    'void iv_z(const std::string&s,long long n,const char*x,const char*k){inf.ensuref(n>=0&&s.size()==static_cast<std::size_t>(n),"%s \'%s\' has byte length %llu; expected %lld.",k,x,static_cast<unsigned long long>(s.size()),n);}',
    'template<class T>struct iv_v{struct S{std::vector<T>a;std::vector<unsigned char>b;};std::shared_ptr<S>s=std::make_shared<S>();iv_v()=default;iv_v(std::initializer_list<T>x){s->a.assign(x);s->b.assign(x.size(),1);}iv_v(long long n,const T&x,bool z){inf.ensuref(n>=0,"Invar Array length is %lld; expected a non-negative length.",n);s->a.assign((std::size_t)n,x);s->b.assign((std::size_t)n,z?1:0);}void c(long long i)const{inf.ensuref(i>=0&&(std::size_t)i<s->a.size(),"Invar Array index %lld is out of bounds for length %llu.",i,static_cast<unsigned long long>(s->a.size()));}T r(long long i)const{c(i);inf.ensuref(s->b[(std::size_t)i],"Invar Array element at index %lld is read before initialization.",i);return s->a[(std::size_t)i];}T&w(long long i){c(i);s->b[(std::size_t)i]=1;return s->a[(std::size_t)i];}long long n()const{return static_cast<long long>(s->a.size());}};',
    'template<class T>struct iv_w{struct S{std::vector<T>a;std::vector<unsigned char>b;};std::shared_ptr<S>s=std::make_shared<S>();iv_w()=default;iv_w(std::initializer_list<T>x){s->a.assign(x);s->b.assign(x.size(),1);}void c(long long i)const{inf.ensuref(i>=0&&(std::size_t)i<s->a.size(),"Invar Array_v index %lld is out of bounds for length %llu.",i,static_cast<unsigned long long>(s->a.size()));}T r(long long i)const{c(i);inf.ensuref(s->b[(std::size_t)i],"Invar Array_v element at index %lld is read before initialization.",i);return s->a[(std::size_t)i];}T&w(long long i){c(i);s->b[(std::size_t)i]=1;return s->a[(std::size_t)i];}long long n()const{return static_cast<long long>(s->a.size());}iv_u p(const T&x){s->a.push_back(x);s->b.push_back(1);return{};}T o(){inf.ensuref(!s->a.empty(),"Cannot pop from an empty Invar Array_v.");std::size_t i=s->a.size()-1;inf.ensuref(s->b[i],"Cannot pop uninitialized Array_v element at index %llu.",static_cast<unsigned long long>(i));T x=s->a[i];s->a.pop_back();s->b.pop_back();return x;}iv_u z(long long n){inf.ensuref(n>=0,"Invar Array_v resize length is %lld; expected a non-negative length.",n);s->a.resize(static_cast<std::size_t>(n));s->b.resize(static_cast<std::size_t>(n),0);return{};}};',
    "template<class A,class B>int iv_g(const A&a,const B&b);",
    "template<class A,class B>int iv_g(const iv_v<A>&a,const iv_v<B>&b);",
    "template<class A,class B>int iv_g(const iv_v<A>&a,const iv_w<B>&b);",
    "template<class A,class B>int iv_g(const iv_w<A>&a,const iv_v<B>&b);",
    "template<class A,class B>int iv_g(const iv_w<A>&a,const iv_w<B>&b);",
    'int iv_g(const std::string&a,const std::string&b){std::size_t n=a.size()<b.size()?a.size():b.size();for(std::size_t i=0;i<n;++i){unsigned char x=static_cast<unsigned char>(a[i]),y=static_cast<unsigned char>(b[i]);if(x<y)return-1;if(y<x)return 1;}return a.size()<b.size()?-1:(b.size()<a.size()?1:0);}',
    "template<class A,class B>int iv_g(const A&a,const B&b){return a<b?-1:(b<a?1:0);}",
    "template<class A,class B>int iv_h(const A&a,const B&b){long long n=a.n()<b.n()?a.n():b.n();for(long long i=0;i<n;++i){int c=iv_g(a.r(i),b.r(i));if(c)return c;}return a.n()<b.n()?-1:(b.n()<a.n()?1:0);}",
    "template<class A,class B>int iv_g(const iv_v<A>&a,const iv_v<B>&b){return iv_h(a,b);}",
    "template<class A,class B>int iv_g(const iv_v<A>&a,const iv_w<B>&b){return iv_h(a,b);}",
    "template<class A,class B>int iv_g(const iv_w<A>&a,const iv_v<B>&b){return iv_h(a,b);}",
    "template<class A,class B>int iv_g(const iv_w<A>&a,const iv_w<B>&b){return iv_h(a,b);}",
    'unsigned char iv_c(const std::string&s,long long i){inf.ensuref(i>=0&&(std::size_t)i<s.size(),"Invar String byte index %lld is out of bounds for byte length %llu.",i,static_cast<unsigned long long>(s.size()));return static_cast<unsigned char>(s[(std::size_t)i]);}',
    'std::string iv_l(){std::string s;while(!inf.eof()){char c=inf.readChar();if(c==\'\\r\'||c==\'\\n\')quitf(_fail,"Expected EOF after the final Invar line input.");s+=c;}return s;}',
    "",
    "int main(int argc, char* argv[]) {",
    "    registerValidation(argc, argv);",
    "",
  ];

  for (const symbol of analyzed.allSymbols.filter(
    (value) => value.ownerFunction === null,
  )) {
    lines.push(`    ${cxxValueType(symbol.valueType)} ${symbol.cxxName};`);
  }
  lines.push(
    '    const pattern _513p("[^\\\\ ]+");',
    '    const pattern _513l("[^\\r\\n]*");',
  );
  lines.push("    bool _513f=false;");
  if (analyzed.allSymbols.length > 0) {
    lines.push("");
  }
  const topLevelFunctions = analyzed.functions.filter(
    (info) => info.ownerFunction === null,
  );
  for (const info of topLevelFunctions) {
    lines.push(
      `    std::function<${cxxValueType(info.returnType)}(` +
        `${info.parameters.map((parameter) => cxxValueType(parameter.valueType)).join(",")})> ` +
        `${info.cxxName};`,
    );
  }
  for (const info of topLevelFunctions) {
    if (info.definition !== null) {
      emitFunctionDefinition(lines, info.definition, analyzed, 1);
    }
  }
  if (topLevelFunctions.length > 0) lines.push("");

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
    case "FunctionDeclaration":
      emitNestedFunctionScope(lines, statement, analyzed, indent);
      return;
    case "ReturnStatement":
      lines.push(
        statement.value === null
          ? `${padding(indent)}return iv_u{};`
          : `${padding(indent)}return ${expression(statement.value, analyzed)};`,
      );
      return;
    case "BreakStatement":
      lines.push(`${padding(indent)}break;`);
      return;
    case "ContinueStatement":
      lines.push(`${padding(indent)}continue;`);
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

function emitNestedFunctionScope(
  lines: string[],
  declaration: FunctionDeclaration,
  analyzed: AnalyzedProgram,
  indent: number,
): void {
  const current = analyzed.resolvedFunctionDeclarations.get(declaration);
  if (current === undefined || current.ownerFunction === null) return;
  const functions = analyzed.functions.filter(
    (info) => info.scopeId === current.scopeId,
  );
  const first = functions.reduce(
    (earliest, info) =>
      info.declaration.span.start.offset < earliest.span.start.offset
        ? info.declaration
        : earliest,
    functions[0]!.declaration,
  );
  if (declaration !== first) return;

  const pad = padding(indent);
  for (const info of functions) {
    lines.push(
      `${pad}std::function<${cxxValueType(info.returnType)}(` +
        `${info.parameters.map((parameter) => cxxValueType(parameter.valueType)).join(",")})> ` +
        `${info.cxxName};`,
    );
  }
  for (const info of functions) {
    if (info.definition !== null) {
      emitFunctionDefinition(lines, info.definition, analyzed, indent);
    }
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
    if (symbol.ownerFunction !== null) {
      lines.push(
        `${padding(indent)}${cxxValueType(symbol.valueType)} ${symbol.cxxName};`,
      );
    }
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

function emitFunctionDefinition(
  lines: string[],
  declaration: FunctionDeclaration,
  analyzed: AnalyzedProgram,
  indent: number,
): void {
  const info = analyzed.resolvedFunctionDeclarations.get(declaration);
  if (info === undefined) return;
  const pad = padding(indent);
  if (declaration.body === null) return;

  const parameters = declaration.parameters.map((parameter) => {
    const symbol = analyzed.allSymbols.find(
      (candidate) => candidate.declaration === parameter,
    );
    return `${cxxValueType(parameter.valueType)} ${symbol?.cxxName ?? `_512_${parameter.name.name}`}`;
  });
  lines.push(
    `${pad}${info.cxxName} = [&](${parameters.join(",")}) -> ` +
      `${cxxValueType(declaration.returnType)} {`,
  );
  for (const statement of declaration.body.statements) {
    emitStatement(lines, statement, analyzed, indent + 1);
  }
  if (declaration.body.tail !== null) {
    lines.push(
      `${padding(indent + 1)}return ${expression(declaration.body.tail, analyzed)};`,
    );
  } else if (declaration.returnType.kind === "UnitType") {
    lines.push(`${padding(indent + 1)}return iv_u{};`);
  }
  lines.push(`${pad}};`);
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
    case "DynamicArrayType":
      collectTypeExpressions(valueType.elementType, output);
      return;
    case "ByteType":
    case "RegexType":
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
    `${pad}inf.ensuref(${countName} >= 0, ` +
      `"Invar for count is %lld; expected a non-negative count.", ${countName});`,
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
        emitLineRead(
          lines,
          symbol,
          analyzed,
          line.terminated,
          indent,
          line.span.start.offset,
        );
        lines.push(`${pad}_513f=${line.terminated ? "false" : "true"};`);
      }
      continue;
    }
    if (line.kind === "LiteralLineInputPattern") {
      emitLiteralLineRead(lines, line.bytes, line.terminated, line.span.start.offset, indent);
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

function emitLiteralLineRead(
  lines: string[],
  bytes: readonly number[],
  terminated: boolean,
  offset: number,
  indent: number,
): void {
  const pad = padding(indent);
  const temporary = `_513k${offset}`;
  lines.push(
    `${pad}if (_513f)quitf(_fail,"Expected a whole line at line start.");`,
    terminated
      ? `${pad}const std::string ${temporary}=inf.readLine(_513l,"literal line");`
      : `${pad}const std::string ${temporary}=iv_l();`,
    `${pad}inf.ensuref(${temporary}==${byteString(bytes)},` +
      `"Input line '%s' does not equal the required Invar literal.",${temporary}.c_str());`,
    `${pad}_513f=${terminated ? "false" : "true"};`,
  );
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
  if (pattern.kind === "LiteralTokenPattern") {
    const pad = padding(indent);
    const temporary = `_513k${pattern.span.start.offset}`;
    const label = sourceText(pattern, analyzed);
    lines.push(
      `${pad}const std::string ${temporary}=inf.readToken(_513p,${cxxStringLiteral(label)});`,
      `${pad}inf.ensuref(${temporary}==${byteString(pattern.bytes)},` +
        `"Input token '%s' does not equal the required literal '%s'.",` +
        `${temporary}.c_str(),${cxxStringLiteral(label)});`,
    );
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
    sourceText(pattern.target, analyzed),
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
  uniqueOffset: number,
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
      uniqueOffset,
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
      ? `${pad}${symbol.cxxName} = inf.readLine(` +
        `${stringLinePattern(symbol.valueType, analyzed)}, ` +
        `${cxxStringLiteral(symbol.name)});`
      : `${pad}${symbol.cxxName}=iv_l();`,
  );
  if (!terminated) {
    emitStringLengthCheck(
      lines,
      symbol.cxxName,
      symbol.name,
      symbol.valueType,
      analyzed,
      indent,
    );
  }
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
    emitIntegerRead(
      lines,
      target,
      label,
      valueType.range,
      analyzed,
      indent,
      uniqueOffset,
    );
    return;
  }
  if (valueType.kind === "StringType") {
    lines.push(
      `${pad}${target} = inf.readToken(` +
        `${stringTokenPattern(valueType, analyzed)}, ` +
        `${cxxStringLiteral(label)});`,
    );
    return;
  }
  if (valueType.kind === "ArrayType") {
    return;
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
    `${pad}iv_z(${target},${typeExpression(valueType.length, analyzed)},` +
      `${cxxStringLiteral(label)},"String");`,
  );
}

function emitIntegerRead(
  lines: string[],
  target: string,
  label: string,
  range: IntRange | null,
  analyzed: AnalyzedProgram,
  indent: number,
  uniqueOffset: number,
): void {
  const pad = padding(indent);
  const name = cxxStringLiteral(label);
  if (range === null) {
    lines.push(`${pad}${target} = inf.readLong(LLONG_MIN, LLONG_MAX, ${name});`);
    return;
  }

  const suffix = uniqueOffset.toString();
  const lower = `_513l${suffix}`;
  const upper = `_513u${suffix}`;
  const minimum = `_513m${suffix}`;
  const maximum = `_513x${suffix}`;
  lines.push(
    `${pad}const long long ${lower}=${typeExpression(range.lower, analyzed)};`,
    `${pad}const long long ${upper}=${typeExpression(range.upper, analyzed)};`,
    `${pad}const long long ${minimum}=` +
      `${range.lowerInclusive ? lower : `iv_bl(${lower})`};`,
    `${pad}const long long ${maximum}=` +
      `${range.upperInclusive ? upper : `iv_bu(${upper})`};`,
  );
  const lowerExists = range.lowerInclusive ? "true" : `${lower}!=LLONG_MAX`;
  const upperExists = range.upperInclusive ? "true" : `${upper}!=LLONG_MIN`;
  lines.push(
    `${pad}inf.ensuref(${lowerExists}&&${upperExists}&&${minimum}<=${maximum},` +
      `"Integer '%s' has an empty Invar range after evaluating its bounds ` +
      `to %lld and %lld.",${name},${lower},${upper});`,
    `${pad}${target} = inf.readLong(${minimum}, ${maximum}, ${name});`,
  );
}

function stringTokenPattern(
  valueType: StringType,
  analyzed: AnalyzedProgram,
): string {
  return valueType.length === null
    ? "_513p"
    : exactTokenPattern(valueType.length, analyzed);
}

function exactTokenPattern(
  length: Expression,
  analyzed: AnalyzedProgram,
): string {
  return `format("[^\\\\ ]{%lld}",${typeExpression(length, analyzed)})`;
}

function stringLinePattern(
  valueType: StringType,
  analyzed: AnalyzedProgram,
): string {
  return valueType.length === null
    ? "_513l"
    : `format("[^\\r\\n]{%lld}",${typeExpression(valueType.length, analyzed)})`;
}

function indexedValueType(
  target: IndexExpression,
  analyzed: AnalyzedProgram,
): ValueType | null {
  const collection = analyzed.expressionTypes.get(target.collection);
  if (collection?.base === "Array") return collection.arrayType!.elementType;
  if (collection?.base === "ArrayV") {
    return collection.dynamicArrayType!.elementType;
  }
  return null;
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
    case "DynamicArrayType":
      return `${cxxValueType(valueType)}{}`;
    case "ByteType":
      return "static_cast<unsigned char>(0)";
    case "RegexType":
      return "iv_x{}";
    case "BoolType":
      return "false";
    case "UnitType":
      return "iv_u{}";
  }
}

function expression(value: Expression, analyzed: AnalyzedProgram): string {
  switch (value.kind) {
    case "NameExpression":
      if (value.name === "INT64_MIN") return "LLONG_MIN";
      if (value.name === "INT64_MAX") return "LLONG_MAX";
      return analyzed.resolvedNames.get(value)?.cxxName ?? `_512_${value.name}`;
    case "IndexExpression": {
      const collection = readableCollection(value.collection, analyzed);
      const type = analyzed.expressionTypes.get(value.collection);
      return type?.base === "String"
        ? `iv_c(${collection},${expression(value.index, analyzed)})`
        : `${collection}.r(${expression(value.index, analyzed)})`;
    }
    case "IntegerLiteral":
      if (value.value === I64_MIN) {
        return "(-9223372036854775807LL - 1)";
      }
      return `${value.value.toString()}LL`;
    case "BooleanLiteral":
      return value.value ? "true" : "false";
    case "ByteLiteral":
      return `static_cast<unsigned char>(${value.value})`;
    case "StringLiteral":
      return byteString(value.bytes);
    case "RegexLiteral":
      return `iv_x{${byteString(value.bytes)}}`;
    case "ArrayLiteral": {
      const type = analyzed.expressionTypes.get(value) ?? unitRefinement();
      return (
        `${cxxExpressionType(type)}{` +
        `${value.elements.map((element) => expression(element, analyzed)).join(",")}}`
      );
    }
    case "MemberExpression": {
      const object = expression(value.object, analyzed);
      const type = analyzed.expressionTypes.get(value.object);
      return type?.base === "String"
        ? `static_cast<long long>(${object}.size())`
        : `${object}.n()`;
    }
    case "CallExpression":
      return callExpression(value, analyzed);
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
  value: { readonly span: Expression["span"] },
  analyzed: AnalyzedProgram,
): string {
  return analyzed.program.source.slice(
    value.span.start.offset,
    value.span.end.offset,
  );
}

function byteString(bytes: readonly number[]): string {
  return `iv_b({${bytes.map((value) => `${value}u`).join(",")}})`;
}

function callExpression(
  value: CallExpression,
  analyzed: AnalyzedProgram,
): string {
  const arguments_ = value.arguments
    .map((argument) => expression(argument, analyzed))
    .join(",");
  if (
    value.callee.kind === "NameExpression" &&
    value.callee.name === "matches"
  ) {
    return `iv_e(${arguments_})`;
  }
  if (value.callee.kind === "MemberExpression") {
    const object = expression(value.callee.object, analyzed);
    const method =
      value.callee.member.name === "push"
        ? "p"
        : value.callee.member.name === "pop"
          ? "o"
          : "z";
    return `${object}.${method}(${arguments_})`;
  }
  const functionInfo = analyzed.resolvedFunctions.get(value);
  return `${functionInfo?.cxxName ?? "_514_unknown"}(${arguments_})`;
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
      return `(iv_g(${leftCode},${rightCode})==0)`;
    case "notEqual":
      return `(iv_g(${leftCode},${rightCode})!=0)`;
    case "less":
      return `(iv_g(${leftCode},${rightCode})<0)`;
    case "lessEqual":
      return `(iv_g(${leftCode},${rightCode})<=0)`;
    case "greater":
      return `(iv_g(${leftCode},${rightCode})>0)`;
    case "greaterEqual":
      return `(iv_g(${leftCode},${rightCode})>=0)`;
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
    case "DynamicArrayType":
      return `iv_w<${cxxValueType(valueType.elementType)}>`;
    case "ByteType":
      return "unsigned char";
    case "RegexType":
      return "iv_x";
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
    case "ArrayV":
      return cxxValueType(type.dynamicArrayType!);
    case "Byte":
      return "unsigned char";
    case "Regex":
      return "iv_x";
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
