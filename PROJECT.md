# Invar

> **문서 기준:** 아래의 초기 메모보다
> [`LANGUAGE_SPEC.md`](./LANGUAGE_SPEC.md)의 확정된 사양과
> [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md)의 계획을 우선한다.
> 현재 구현에는 Lexer, 재귀 하강 Parser, AST, 최소 의미 분석,
> 정수 산술식, `line(x)` 전체 줄 입력, testlib C++ 코드 생성과
> 브라우저 테스트 페이지가 포함된다. `Bool`, `Unit`, `require`,
> refinement 서브타이핑과 expression 기반 블록 및 `if`도 지원한다.
> `var`, 대입, 복합 대입, 횟수 기반 `for`와 `while`도 지원한다.
> 중첩 가능한 `Array[T, length]`, 원소 접근과 선언 initializer도
> 지원한다. 현재는 `Byte`와 문자열 리터럴, 문자열의 읽기 전용 바이트
> 인덱싱, `.length`, `Array_v[T]`, 입력 리터럴, testlib 정규식과
> 사용자 정의 함수도 지원한다. 문맥형 배열 리터럴, 문자열·바이트·배열
> 비교, `break`/`continue`, 중첩 함수와 dependent 함수 타입도 지원한다.

Invar는 경쟁 프로그래밍 문제의 입력 Validator를 작성하기 위한
타입 및 제약 기반 전용 언어다.

## 목표

- 입력값의 제약을 타입처럼 선언한다.
- 파일 마지막의 `input` 블록에서 입력 순서와 레이아웃을 기술한다.
- Invar 소스를 testlib.h를 사용하는 C++ Validator로 변환한다.
- 컴파일러 코어는 TypeScript로 작성한다.
- 브라우저와 Node.js 양쪽에서 같은 코어를 사용한다.
- 웹 버전은 GitHub Pages에서 실행할 수 있게 한다.

## 현재 문법 예

```invar
val n: Int[1..=200000];
val m: Int[1..=200000];

val s: String[n];
val t: String[m];

input {
    n, m;
    s;
    t;
}
```

## 문법의 의미

- 선언부는 변수의 타입과 제약을 정의한다.
- `String[n]`은 바이트 길이가 정확히 `n`인 문자열이다.
- `input` 블록은 값이 입력 파일에 나타나는 순서를 정의한다.
- `,`는 같은 줄의 다음 토큰 입력 패턴을 구분한다.
- `input` 안의 `;`는 줄바꿈을 의미한다.
- 모든 문장을 실행한 뒤 파일 끝을 검사한다.
- 타입에서 참조하는 변수는 해당 값을 읽기 전에 먼저 입력되어야 한다.

예를 들어 다음은 오류다.

```invar
val s: String[n];
val n: Int[1..=200000];

input {
    s;
    n;
}
```

`s`를 읽을 때 길이 제약에 필요한 `n`이 아직 읽히지 않았기 때문이다.

## 구현 방향

- 구현 언어: TypeScript
- 웹 빌드: Vite
- UI: 순수 HTML/CSS/TypeScript
- UI 프레임워크는 초기에는 사용하지 않는다.
- TypeScript strict 모드를 사용한다.
- Lexer와 재귀 하강 Parser를 직접 작성한다.
- 출력은 testlib.h 기반 C++ 코드다.
- 컴파일러 코어에서는 DOM, Node.js 파일 시스템 등의 환경별 API를 사용하지 않는다.

## 예상 컴파일 과정

1. Lexer
2. Parser
3. AST
4. 이름 해석
5. 타입 및 의존성 검사
6. testlib C++ 코드 생성

## 초기 구현 범위

첫 번째 문법 목표는 다음 코드다.

```invar
val n: Int[1..=200000];
val s: String[n];

input {
    n;
    s;
}
```

구현은 다음 순서로 진행한다.

1. 토큰 및 소스 위치
2. Lexer
3. 변수 선언 Parser
4. `input` 블록 Parser
5. 이름 및 의존성 검사
6. C++ 코드 생성
7. 웹 인터페이스
8. GitHub Pages 배포
9. Node.js CLI

## 아직 확정하지 않은 사항

- 문자열 문자 집합 제약 문법
- 사용자 정의 레코드 타입
- `where` 제약 문법
- 여러 테스트 케이스 표현
- 정확한 오류 메시지 형식
- npm 패키지명과 CLI 배포 방식

이 사항들은 Codex가 임의로 확정하지 않고 TODO로 남겨야 한다.
