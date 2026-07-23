import "./style.css";

import { compile, type Diagnostic } from "./compiler";

const EXAMPLE_SOURCE = `val n: Int[1..=200000];
val m: Int[1..=200000];

val s: String[n];
val t: String[m];

input {
    n, m;
    s;
    t;
}`;

const app = document.querySelector<HTMLElement>("#app");

if (app === null) {
  throw new Error("Missing #app element");
}

app.innerHTML = `
  <header class="site-header">
    <div>
      <p class="eyebrow">Validator language playground</p>
      <h1>Invar</h1>
    </div>
    <p class="header-copy">
      입력 형식을 선언하고 testlib.h 기반 C++ Validator를 즉시 생성합니다.
    </p>
  </header>

  <main class="workspace">
    <section class="panel editor-panel" aria-labelledby="source-title">
      <div class="panel-header">
        <div>
          <span class="step">01</span>
          <h2 id="source-title">Invar source</h2>
        </div>
        <div class="panel-actions">
          <label class="source-comment-option">
            <input id="source-comment-checkbox" type="checkbox" checked />
            원본 주석 포함
          </label>
          <button id="example-button" class="button button-secondary" type="button">
            예제 복원
          </button>
        </div>
      </div>
      <div class="editor-shell">
        <div
          id="source-line-numbers"
          class="line-numbers"
          aria-hidden="true"
        ></div>
        <textarea
          id="source-editor"
          class="code-editor source-editor"
          wrap="off"
          spellcheck="false"
          aria-label="Invar source code"
        ></textarea>
      </div>
      <div class="editor-footer">
        <span>Ctrl + Enter로 생성</span>
        <button id="compile-button" class="button button-primary" type="button">
          C++ 생성
        </button>
      </div>
    </section>

    <section class="panel output-panel" aria-labelledby="output-title">
      <div class="panel-header">
        <div>
          <span class="step">02</span>
          <h2 id="output-title">testlib validator</h2>
        </div>
        <button id="copy-button" class="button button-secondary" type="button" disabled>
          복사
        </button>
      </div>
      <textarea
        id="output-editor"
        class="code-editor output-editor"
        readonly
        spellcheck="false"
        aria-label="Generated C++ validator"
      ></textarea>
      <div id="status" class="status" role="status" aria-live="polite"></div>
    </section>
  </main>

  <section class="diagnostics-section" aria-labelledby="diagnostics-title">
    <div class="diagnostics-heading">
      <div>
        <span class="step">03</span>
        <h2 id="diagnostics-title">Diagnostics</h2>
      </div>
      <span id="diagnostic-count" class="diagnostic-count">0</span>
    </div>
    <ol id="diagnostics" class="diagnostics-list"></ol>
  </section>
`;

const sourceEditor = element<HTMLTextAreaElement>("source-editor");
const sourceLineNumbers = element<HTMLElement>("source-line-numbers");
const outputEditor = element<HTMLTextAreaElement>("output-editor");
const compileButton = element<HTMLButtonElement>("compile-button");
const exampleButton = element<HTMLButtonElement>("example-button");
const sourceCommentCheckbox = element<HTMLInputElement>("source-comment-checkbox");
const copyButton = element<HTMLButtonElement>("copy-button");
const status = element<HTMLElement>("status");
const diagnosticCount = element<HTMLElement>("diagnostic-count");
const diagnosticsList = element<HTMLOListElement>("diagnostics");

sourceEditor.value = EXAMPLE_SOURCE;
let renderedLineCount = 0;

function updateLineNumbers(): void {
  const lineCount = sourceEditor.value.split("\n").length;
  if (lineCount !== renderedLineCount) {
    sourceLineNumbers.textContent = Array.from(
      { length: lineCount },
      (_, index) => String(index + 1),
    ).join("\n");
    renderedLineCount = lineCount;
  }
  sourceEditor.style.height = "auto";
  sourceEditor.style.height = `${sourceEditor.scrollHeight}px`;
  outputEditor.style.height = `${sourceEditor.offsetHeight}px`;
}

function runCompiler(): void {
  const result = compile(sourceEditor.value, {
    includeSourceComment: sourceCommentCheckbox.checked,
  });
  outputEditor.value = result.code ?? "";
  copyButton.disabled = result.code === null;
  renderDiagnostics(result.diagnostics);

  const errorCount = result.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const warningCount = result.diagnostics.length - errorCount;

  if (result.code !== null) {
    status.className = "status status-success";
    status.textContent =
      warningCount === 0
        ? "Validator가 생성되었습니다."
        : `Validator가 생성되었습니다. 경고 ${warningCount}개를 확인하세요.`;
  } else {
    status.className = "status status-error";
    status.textContent = `생성하지 못했습니다. 오류 ${errorCount}개를 확인하세요.`;
  }
}

function renderDiagnostics(diagnostics: readonly Diagnostic[]): void {
  diagnosticsList.replaceChildren();
  diagnosticCount.textContent = String(diagnostics.length);
  diagnosticCount.className =
    diagnostics.length === 0 ? "diagnostic-count" : "diagnostic-count has-items";

  if (diagnostics.length === 0) {
    const item = document.createElement("li");
    item.className = "diagnostic-empty";
    item.textContent = "문제가 없습니다.";
    diagnosticsList.append(item);
    return;
  }

  for (const diagnostic of diagnostics) {
    const item = document.createElement("li");
    item.className = `diagnostic diagnostic-${diagnostic.severity}`;

    const badge = document.createElement("span");
    badge.className = "diagnostic-badge";
    badge.textContent = diagnostic.severity;

    const message = document.createElement("span");
    message.className = "diagnostic-message";
    message.textContent = diagnostic.message;

    const location = document.createElement("span");
    location.className = "diagnostic-location";
    location.textContent =
      `${diagnostic.stage} · ${diagnostic.span.start.line}:${diagnostic.span.start.column}`;

    item.append(badge, message, location);
    diagnosticsList.append(item);
  }
}

compileButton.addEventListener("click", runCompiler);
exampleButton.addEventListener("click", () => {
  sourceEditor.value = EXAMPLE_SOURCE;
  updateLineNumbers();
  runCompiler();
  sourceEditor.focus();
});
sourceEditor.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") {
    event.preventDefault();
    runCompiler();
  }
});
sourceEditor.addEventListener("input", updateLineNumbers);
window.addEventListener("resize", updateLineNumbers);
sourceCommentCheckbox.addEventListener("change", runCompiler);
copyButton.addEventListener("click", () => {
  void copyOutput();
});

async function copyOutput(): Promise<void> {
  if (outputEditor.value.length === 0) {
    return;
  }
  try {
    await navigator.clipboard.writeText(outputEditor.value);
    copyButton.textContent = "복사됨";
    window.setTimeout(() => {
      copyButton.textContent = "복사";
    }, 1200);
  } catch {
    status.className = "status status-error";
    status.textContent = "클립보드에 접근할 수 없습니다. 출력 영역에서 직접 복사해 주세요.";
  }
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (value === null) {
    throw new Error(`Missing #${id} element`);
  }
  return value as T;
}

updateLineNumbers();
runCompiler();
