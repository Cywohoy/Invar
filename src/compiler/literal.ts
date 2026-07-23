export interface DecodedLiteral {
  readonly bytes: readonly number[];
  readonly error: string | null;
}

export function decodeEscapedLiteral(text: string): DecodedLiteral {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; ) {
    const character = text[index]!;
    if (character !== "\\") {
      const codePoint = text.codePointAt(index)!;
      appendUtf8(bytes, codePoint);
      index += codePoint > 0xffff ? 2 : 1;
      continue;
    }

    index += 1;
    if (index >= text.length) {
      return { bytes, error: "A literal cannot end with an unfinished escape sequence." };
    }
    const escaped = text[index]!;
    index += 1;
    const simple = SIMPLE_ESCAPES[escaped];
    if (simple !== undefined) {
      bytes.push(simple);
      continue;
    }
    if (escaped === "x") {
      const digits = text.slice(index, index + 2);
      if (!/^[0-9A-Fa-f]{2}$/.test(digits)) {
        return { bytes, error: "The '\\x' escape requires exactly two hexadecimal digits." };
      }
      bytes.push(Number.parseInt(digits, 16));
      index += 2;
      continue;
    }
    return { bytes, error: `Unsupported escape sequence '\\${escaped}'.` };
  }
  return { bytes, error: null };
}

export function decodeRawRegexLiteral(text: string): DecodedLiteral {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index)!;
    appendUtf8(bytes, codePoint);
    index += codePoint > 0xffff ? 2 : 1;
  }
  return { bytes, error: null };
}

const SIMPLE_ESCAPES: Readonly<Record<string, number>> = {
  "0": 0,
  "n": 10,
  "r": 13,
  "t": 9,
  "\\": 92,
  "'": 39,
  "\"": 34,
  "`": 96,
};

function appendUtf8(output: number[], codePoint: number): void {
  if (codePoint <= 0x7f) {
    output.push(codePoint);
  } else if (codePoint <= 0x7ff) {
    output.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
  } else if (codePoint <= 0xffff) {
    output.push(
      0xe0 | (codePoint >> 12),
      0x80 | ((codePoint >> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    );
  } else {
    output.push(
      0xf0 | (codePoint >> 18),
      0x80 | ((codePoint >> 12) & 0x3f),
      0x80 | ((codePoint >> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    );
  }
}
