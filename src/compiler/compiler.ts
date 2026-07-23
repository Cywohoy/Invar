import type { Diagnostic } from "./diagnostic";
import { generateTestlib } from "./codegen";
import { parse } from "./parser";
import { analyze } from "./semantic";

export interface CompileResult {
  readonly code: string | null;
  readonly diagnostics: readonly Diagnostic[];
}

export interface CompileOptions {
  readonly includeSourceComment?: boolean;
}

export function compile(
  source: string,
  options: CompileOptions = {},
): CompileResult {
  const parseResult = parse(source);
  if (parseResult.program === null) {
    return {
      code: null,
      diagnostics: parseResult.diagnostics,
    };
  }

  const analysisResult = analyze(parseResult.program);
  const diagnostics = [...parseResult.diagnostics, ...analysisResult.diagnostics];
  if (analysisResult.analyzed === null) {
    return { code: null, diagnostics };
  }

  return {
    code: generateTestlib(analysisResult.analyzed, {
      includeSourceComment: options.includeSourceComment,
    }),
    diagnostics,
  };
}
