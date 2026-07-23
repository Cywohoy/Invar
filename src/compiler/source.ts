export interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export function spanFrom(start: SourcePosition, end: SourcePosition): SourceSpan {
  return { start, end };
}
