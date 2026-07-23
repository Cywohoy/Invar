import type { SourceSpan } from "./source";

export type DiagnosticStage = "lexer" | "parser" | "semantic";

export interface Diagnostic {
  readonly stage: DiagnosticStage;
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly span: SourceSpan;
}
