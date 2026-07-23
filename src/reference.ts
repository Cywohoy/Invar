export interface ReferenceBlock {
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly code?: string;
  readonly items?: readonly string[];
}

export interface ReferencePage {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly blocks: readonly ReferenceBlock[];
}

export const REFERENCE_PAGES: readonly ReferencePage[] = [
  {
    slug: "source",
    title: "소스와 어휘 규칙",
    summary: "식별자, 예약어, 공백, 주석과 정수 리터럴의 규칙을 설명합니다.",
    blocks: [
      {
        title: "식별자와 예약어",
        paragraphs: [
          "식별자는 영문자 또는 밑줄로 시작하며, 이후에는 영문자·숫자·밑줄을 사용할 수 있습니다. 대소문자를 구분합니다.",
          "예약어는 이름으로 사용할 수 없습니다.",
        ],
        code: `val answer_1: Int;
var currentIndex: Int = 0;

// 주요 예약어
val var fn return input line Int String Array Array_v
Byte Regex Bool Unit true false require
if else for times while break continue`,
      },
      {
        title: "공백과 주석",
        paragraphs: [
          "일반 소스에서는 스페이스, 탭과 줄바꿈을 토큰 사이의 공백으로 처리합니다. 따라서 선언을 여러 줄로 나누어 작성할 수 있습니다.",
          "두 개의 슬래시로 시작한 내용은 해당 소스 줄의 끝까지 주석으로 처리합니다. input 블록 안의 쉼표와 세미콜론은 입력 형식을 나타내므로 일반 공백과 다릅니다.",
        ],
        code: `val n
    : Int[1..=100]; // 줄 끝 주석

input { n; }`,
      },
      {
        title: "정수 리터럴",
        paragraphs: [
          "10진 정수만 지원합니다. 양수 부호와 음수 부호를 사용할 수 있으며 0과 -0은 유효합니다.",
          "0 이외의 정수에는 앞자리 0을 사용할 수 없습니다. 리터럴은 부호 있는 64비트 정수 범위 안에 있어야 합니다.",
          "INT64_MIN과 INT64_MAX는 각각 부호 있는 64비트 정수의 최솟값과 최댓값을 나타내는 내장 상수입니다.",
        ],
        code: `0
-0
+42
-9223372036854775808`,
      },
    ],
  },
  {
    slug: "types",
    title: "선언과 기본 타입",
    summary: "val·var 선언, Int 범위, String 길이, Bool과 Unit을 설명합니다.",
    blocks: [
      {
        title: "값 선언",
        paragraphs: [
          "모든 선언에는 타입을 명시하십시오. 여러 이름에 같은 타입을 한 번에 선언할 수 있습니다.",
          "val은 값을 한 번만 정할 수 있고 var는 다시 대입할 수 있습니다. 선언과 동시에 초기값을 지정할 수도 있습니다.",
        ],
        code: `val n, m: Int[1..=200000];
val answer: Int = 42;
var index: Int = 0;`,
      },
      {
        title: "Int와 refinement 범위",
        paragraphs: [
          "Int는 부호 있는 64비트 정수입니다. 대괄호 안의 범위는 기본 Int에 추가되는 refinement 제약입니다.",
          "양쪽 경계는 모두 필요하며 유효한 Int 식을 사용할 수 있습니다. 경계에서 참조하는 이름은 먼저 선언되어 있어야 합니다.",
        ],
        code: `Int[a..b]      // a <= x < b
Int[a..=b]     // a <= x <= b
Int[a<..b]     // a < x < b
Int[a<..=b]    // a < x <= b`,
      },
      {
        title: "String, Byte, Regex, Bool과 Unit",
        paragraphs: [
          "String[length]는 UTF-8 바이트 길이가 정확히 length인 문자열입니다. 길이는 선언 시점에 음수가 아님을 증명할 수 있어야 합니다.",
          "String은 읽기 전용이며 text[i]는 Byte를 반환합니다. text.length도 UTF-8 바이트 수입니다. Regex는 r\"...\" 리터럴로 만들고 matches에서 사용하십시오.",
          "Bool은 true 또는 false이며 Unit은 값이 없는 식의 결과 타입입니다. Bool과 Unit은 문제 입력에서 직접 읽을 수 없습니다.",
        ],
        code: `val length: Int[0..=100];
input { length; }

val text: String[length];
val marker: Byte = '!';
val digits: Regex = r"[0-9]+";
val enabled: Bool = true;`,
      },
      {
        title: "의존 타입과 가변 값",
        paragraphs: [
          "타입이 다른 값에 의존하면 그 이름은 먼저 선언되어야 합니다. 실제 입력 시점에는 제약 계산에 필요한 값도 이미 정해져 있어야 합니다.",
          "var 또는 배열 원소를 refinement에서 참조하면 선언 시점의 현재 값을 불변 snapshot으로 저장합니다.",
        ],
        code: `var upper: Int[1..=10] = 5;
val value: Int[1..=upper];

upper = 8; // value의 상한 snapshot은 5입니다.`,
      },
    ],
  },
  {
    slug: "arrays",
    title: "배열",
    summary: "Array 타입, 원소 접근, 가변성, 입력과 refinement snapshot을 설명합니다.",
    blocks: [
      {
        title: "선언과 중첩",
        paragraphs: [
          "Array[Type, length]로 배열을 선언합니다. 길이는 선언 시점에 값이 준비되어 있어야 하며 음수가 아님을 정적으로 증명할 수 있어야 합니다.",
          "배열은 중첩할 수 있습니다. 배열 리터럴은 항상 기대 타입이 있는 위치에서만 사용하며 고정 배열의 원소 수는 선언된 길이와 정확히 일치해야 합니다.",
        ],
        code: `val values: Array[Int, 3] = [1, 2, 3];
val matrix: Array[Array[Int, columns], rows];`,
      },
      {
        title: "원소 접근과 가변성",
        paragraphs: [
          "대괄호로 0부터 시작하는 인덱스의 원소에 접근합니다. val로 선언한 배열도 내부 원소는 항상 가변적입니다.",
          "정적으로 불가능한 인덱스는 컴파일 오류입니다. 동적 인덱스는 생성된 Validator가 실행 중에 검사합니다.",
        ],
        code: `val values: Array[Int, 3];
values[0] = 10;
values[0] += 2;
require(values[0] == 12);`,
      },
      {
        title: "배열 입력",
        paragraphs: [
          "일반 배열 전체를 하나의 입력 패턴으로 읽을 수 없습니다. values[i]처럼 원소별로 입력하십시오.",
        ],
        code: `val values: Array[Int, 2];
input { values[0], values[1]; }`,
      },
      {
        title: "가변 길이 Array_v",
        paragraphs: [
          "Array_v[Type]은 실행 중 길이가 바뀌는 배열입니다. [a, b] 형태의 문맥형 배열 리터럴을 만들고 push, pop, resize, 인덱싱과 .length를 사용할 수 있습니다.",
          "확장으로 생긴 원소, 음수 resize, 빈 배열 pop과 범위를 벗어난 인덱스는 실행 중 검사합니다. 배열 복사는 저장소를 공유하는 얕은 복사입니다.",
        ],
        code: `val values: Array_v[Int] = [1, 2];
values.push(10);
values.resize(3);
values[1] = 20;
val last: Int = values.pop();`,
      },
      {
        title: "refinement에서 배열 원소 사용",
        paragraphs: [
          "초기화된 배열 원소를 타입 경계나 길이에 사용할 수 있습니다. 선언 시점의 원소 값을 snapshot으로 저장합니다.",
          "인덱스가 동적이면 경계와 원소 초기화 여부를 생성된 Validator가 snapshot 생성 시점에 검사합니다.",
        ],
        code: `val bounds: Array[Int[0..=10], 1];
bounds[0] = 3;

val value: Int[0..=bounds[0]];`,
      },
    ],
  },
  {
    slug: "input",
    title: "입력 구조",
    summary: "input 블록의 줄·토큰 패턴, line, EOF와 의존성 규칙을 설명합니다.",
    blocks: [
      {
        title: "input 블록",
        paragraphs: [
          "프로그램에는 input 블록이 하나 이상 필요합니다. input 블록은 여러 개 사용할 수 있으며 소스에 나타난 순서대로 입력을 처리합니다.",
          "입력 패턴은 대상 값에 한 번의 대입을 수행합니다. val은 한 번만 입력할 수 있고, 반복 입력이 필요하면 var 또는 반복문 안의 지역 val을 사용하십시오.",
        ],
        code: `val n: Int;
input { n; }

val text: String[n];
input { text; }`,
      },
      {
        title: "토큰과 줄",
        paragraphs: [
          "쉼표는 같은 줄에서 다음 토큰 패턴을 이어갑니다. 세미콜론은 줄바꿈 하나를 검사합니다.",
          "줄 패턴은 토큰 패턴을 0개 이상 포함할 수 있으므로 빈 줄도 표현할 수 있습니다. 마지막 쉼표 하나는 허용합니다.",
        ],
        code: `input {
    n, m;  // 토큰 두 개와 줄바꿈
    text;  // 토큰 하나와 줄바꿈
    ;      // 빈 줄
}`,
      },
      {
        title: "전체 줄을 읽는 line",
        paragraphs: [
          "line(x)는 input 블록에서만 사용하는 전체 줄 값 패턴입니다. 현재 Int와 String이 전체 줄 입력을 지원합니다.",
          "String은 공백과 빈 문자열을 포함할 수 있습니다. Int 줄에는 정수 하나만 있어야 합니다. line 패턴과 다른 토큰 패턴을 같은 줄에 섞을 수 없습니다.",
          "함수·분기·반복 때문에 전체 줄 패턴이 줄 중간에서 실행되는지는 컴파일 오류로 추측하지 않습니다. 생성된 Validator가 실제 실행 경로의 줄 상태를 검사하여 거부합니다.",
        ],
        code: `val number: Int;
val text: String;

input {
    line(number);
    line(text);
}`,
      },
      {
        title: "고정 입력 리터럴",
        paragraphs: [
          "백틱 하나로 감싼 리터럴은 토큰 하나를 소비하고 정확히 일치하는지 검사합니다. 백틱 두 개로 감싼 리터럴은 줄 전체를 검사합니다.",
          "토큰 리터럴은 빈 값일 수 없습니다. 줄 리터럴은 다른 토큰 패턴과 같은 줄에 섞지 마십시오.",
        ],
        code: `input {
    \`BEGIN\`, n;
    \`\`finished\`\`;
}`,
      },
      {
        title: "마지막 줄과 EOF",
        paragraphs: [
          "input 블록의 마지막 세미콜론은 줄바꿈을 검사합니다. 마지막 세미콜론을 생략하면 값 직후 EOF가 오는 형식으로 처리하며 경고를 생성합니다.",
          "모든 input 블록 처리가 끝나면 파일 끝을 검사합니다. 마지막 블록 이후에는 추가 입력을 허용하지 않습니다.",
        ],
        code: `input { n; } // n, 줄바꿈, EOF
input { n }  // n 직후 EOF, 경고`,
      },
    ],
  },
  {
    slug: "expressions",
    title: "식과 조건",
    summary: "정수 연산, 비교·논리 연산, require, 블록과 if 식을 설명합니다.",
    blocks: [
      {
        title: "정수 산술식",
        paragraphs: [
          "단항 +와 - 및 이항 +, -, *, /, %를 지원합니다. 괄호와 일반적인 산술 우선순위를 사용합니다.",
          "나눗셈과 나머지는 Python식 바닥 나눗셈 규칙을 따릅니다. 0 나눗셈과 부호 있는 64비트 오버플로는 정적으로 판정하거나 Validator 실행 중에 거부합니다.",
        ],
        code: `val half: Int = n / 2;
val remainder: Int = n % modulus;
val value: Int = -(n + 1) * 2;`,
      },
      {
        title: "비교와 논리 연산",
        paragraphs: [
          "Int, Byte와 String에는 ==, !=, <, <=, >, >=를 사용할 수 있습니다. String은 UTF-8 바이트열 순서로 비교합니다.",
          "Array와 Array_v도 원소 타입을 비교할 수 있으면 사전식 비교를 지원합니다. 고정·가변 컨테이너를 서로 비교할 수 있으며 Bool 배열은 동등 비교만 가능합니다.",
          "Bool에는 ==, !=, &&, ||와 단항 !를 사용할 수 있습니다. &&와 ||는 왼쪽부터 short-circuit 평가합니다.",
        ],
        code: `n >= 1 && n <= 100
text != other
fixedValues < dynamicValues
enabled || !disabled`,
      },
      {
        title: "정규식 일치",
        paragraphs: [
          "Regex 리터럴은 testlib pattern 문법을 그대로 사용합니다. 문자열 타입에 정규식 refinement를 붙이지 말고 require와 matches를 조합하십시오.",
        ],
        code: `val name: String;
val identifier: Regex = r"[A-Za-z_][A-Za-z0-9_]*";
input { name; }
require(matches(name, identifier));`,
      },
      {
        title: "require",
        paragraphs: [
          "require는 Bool을 받아 Unit을 반환합니다. 조건이 거짓이면 생성된 Validator가 입력을 거부합니다.",
          "실패 메시지에는 전달한 조건식의 원본 Invar 소스 텍스트가 포함됩니다. require를 문장으로 사용할 때는 뒤에 세미콜론을 쓰십시오.",
        ],
        code: `require(lower <= upper);
require(values[index] > 0);`,
      },
      {
        title: "블록과 if 식",
        paragraphs: [
          "중괄호 블록은 lexical scope를 만드는 식입니다. 마지막 식에 세미콜론이 없으면 그 값이 블록의 결과이며, 그렇지 않으면 Unit입니다.",
          "값을 반환하는 if 식에는 else가 반드시 필요합니다. 조건에는 괄호를 사용하고 두 분기의 타입은 공통 타입으로 통합할 수 있어야 합니다.",
        ],
        code: `val result: Int = if (n > 0) {
    n
} else {
    0
};`,
      },
    ],
  },
  {
    slug: "statements",
    title: "문장과 제어 흐름",
    summary: "대입, statement if, 횟수 반복과 while의 규칙을 설명합니다.",
    blocks: [
      {
        title: "대입과 복합 대입",
        paragraphs: [
          "일반 이름에는 =으로 값을 대입합니다. val에는 한 번만 대입할 수 있고 var에는 다시 대입할 수 있습니다.",
          "+=, -=, *=, /=, %=는 이미 초기화된 var Int 또는 가변 배열 원소에 사용할 수 있습니다. 대입 결과는 선언된 refinement를 만족해야 합니다.",
        ],
        code: `var total: Int = 0;
total += value;

val values: Array[Int, 1];
values[0] = 10;`,
      },
      {
        title: "statement 형태의 if",
        paragraphs: [
          "두 분기가 모두 Unit 블록이면 if를 문장으로 사용할 수 있습니다. 이때 else는 생략할 수 있습니다.",
          "statement if 뒤의 세미콜론은 허용하며 별도의 빈 문장으로 처리합니다. else if는 else 뒤에 다른 if를 중첩한 것으로 처리합니다.",
        ],
        code: `if (kind == 1) {
    input { value; }
} else if (kind == 2) {
    require(value > 0);
}`,
      },
      {
        title: "횟수 반복",
        paragraphs: [
          "for (count) times 블록은 count를 한 번 평가한 뒤 정확히 그 횟수만큼 실행합니다. 횟수가 음수이면 거부하며 0이면 본문을 실행하지 않습니다.",
          "닫는 중괄호 뒤의 세미콜론은 별도의 빈 문장으로 허용합니다.",
        ],
        code: `for (count) times {
    input { value; }
    total += value;
}`,
      },
      {
        title: "조건 반복",
        paragraphs: [
          "while은 각 반복 전에 Bool 조건을 평가합니다. break;는 가장 가까운 반복을 끝내고 continue;는 다음 반복으로 넘어갑니다.",
          "break와 continue는 함수 경계를 넘지 않습니다. 입력 줄 상태가 반복 경로마다 달라지는 경우에도 생성된 Validator가 실제 실행 시점에 검사합니다.",
        ],
        code: `while (index < count) {
    if (done) { break; }
    index += 1;
}`,
      },
    ],
  },
  {
    slug: "functions",
    title: "사용자 정의 함수",
    summary: "함수 선언과 정의, 호출, 반환 및 재귀 규칙을 설명합니다.",
    blocks: [
      {
        title: "서명과 호출 순서",
        paragraphs: [
          "모든 매개변수와 반환 타입을 명시하십시오. 함수는 호출 전에 선언되어야 하며 오버로딩은 지원하지 않습니다.",
          "세미콜론으로 선언만 먼저 작성한 뒤 같은 서명으로 정의할 수 있습니다.",
        ],
        code: `fn is_even(n: Int): Bool;
fn is_odd(n: Int): Bool;`,
      },
      {
        title: "반환",
        paragraphs: [
          "본문 블록의 마지막 식이 반환값입니다. 중간 반환이 필요하면 return expression;을 사용하십시오.",
          "Unit 함수에서는 return;을 사용할 수 있습니다.",
        ],
        code: `fn absolute(n: Int): Int {
    if (n < 0) {
        return -n;
    }
    n
}`,
      },
      {
        title: "재귀와 효과",
        paragraphs: [
          "재귀와 먼저 선언된 함수 사이의 상호 재귀를 허용합니다. input과 require도 함수 본문에서 사용할 수 있습니다.",
          "중첩된 이름 있는 함수를 허용하며 외부 값을 참조로 캡처합니다. 캡처한 val 바인딩에는 대입할 수 없지만 var와 배열 원소는 변경할 수 있습니다. 재귀 호출을 포함한 대입 효과는 고정점까지 계산합니다.",
          "배열 인수는 저장소를 공유하는 얕은 복사입니다. 함수는 현재 일급 값이 아니므로 반환하거나 컨테이너에 저장할 수 없습니다.",
        ],
        code: `fn positive(n: Int): Bool {
    require(n != 0);
    n > 0
}`,
      },
      {
        title: "dependent 함수 타입",
        paragraphs: [
          "뒤 매개변수와 반환 타입은 앞 매개변수를 참조할 수 있습니다. 호출할 때 실제 인수 식을 서명에 대입한 뒤 refinement를 검사합니다.",
          "일반 대입·초기화·함수 호출에서는 refinement를 정적으로 증명해야 합니다. 동적 값 검사는 선언된 값을 읽는 input 패턴에서만 허용하며 require나 if 조건은 타입을 좁히지 않습니다.",
        ],
        code: `fn bounded(n: Int, x: Int[0..=n]): Int[0..=n] {
    x
}

val answer: Int[0..=3] = bounded(3, 2);`,
      },
    ],
  },
  {
    slug: "validator",
    title: "Validator 생성과 진단",
    summary: "컴파일 오류·경고와 생성된 testlib Validator의 동작을 설명합니다.",
    blocks: [
      {
        title: "오류와 경고",
        paragraphs: [
          "구문 오류, 알 수 없는 이름, 타입 불일치, 준비되지 않은 의존 값처럼 안전한 Validator를 만들 수 없는 문제는 컴파일 오류입니다. 오류가 있으면 C++ 코드를 생성하지 않습니다.",
          "선언했지만 입력하지 않은 값, 마지막 줄바꿈 생략, 통과할 수 없는 빈 문자열 토큰처럼 코드는 생성할 수 있지만 주의가 필요한 문제는 경고입니다.",
        ],
      },
      {
        title: "입력 검사",
        paragraphs: [
          "생성된 C++ 코드는 testlib.h를 사용합니다. 토큰, 공백, 줄바꿈과 EOF를 input 블록에 작성한 순서대로 엄격하게 검사합니다.",
          "정수와 문자열의 실제 입력 형식은 사용하는 testlib의 엄격한 읽기 규칙을 따릅니다.",
        ],
        code: `input {
    n, m;
    text;
}`,
      },
      {
        title: "생성 코드 옵션",
        paragraphs: [
          "생성 C++ 파일 맨 위에는 기본적으로 원본 Invar 소스를 줄 주석으로 보존합니다. 편집기의 원본 주석 포함 옵션으로 끌 수 있습니다.",
          "require 실패 메시지에는 조건식의 원본 텍스트가 들어갑니다. 배열의 동적 경계와 미초기화 원소 접근도 실행 중에 검사합니다.",
        ],
      },
    ],
  },
];

export function referenceSlugFromHash(hash: string): string | null {
  if (hash === "#/reference" || hash === "#/reference/") {
    return "";
  }
  const prefix = "#/reference/";
  if (!hash.startsWith(prefix)) {
    return null;
  }
  const slug = hash.slice(prefix.length);
  return REFERENCE_PAGES.some((page) => page.slug === slug) ? slug : "";
}

export function findReferencePage(slug: string): ReferencePage | null {
  return REFERENCE_PAGES.find((page) => page.slug === slug) ?? null;
}
