# Invar 언어 사양

상태: 초안

이 문서는 논의를 통해 확정된 언어 규칙과 향후 방향을 기록한다.
확정되지 않은 문법은 구현 과정에서 임의로 결정하지 않는다.

## 1. 언어의 목적

Invar는 경쟁 프로그래밍 문제의 입력 Validator를 작성하기 위한 전용
언어다. 입력값의 타입과 제약, 실제 입력 순서, 공백 및 줄바꿈 구조를
선언하면 `testlib.h`를 사용하는 C++ Validator 코드를 생성한다.

## 2. 어휘 규칙

### 2.1 식별자

- 식별자는 ASCII 문자로 제한한다.
- 첫 문자는 영문자 또는 밑줄이다.
- 이후 문자는 영문자, 숫자 또는 밑줄이다.
- 대문자와 소문자를 구분한다.

정규식으로 표현하면 `[A-Za-z_][A-Za-z0-9_]*`이다.

### 2.2 예약어

현재 확정된 예약어와 타입 이름은 정확한 대소문자를 사용한다.

- `input`
- `line`
- `require`
- `if`
- `else`
- `true`
- `false`
- `val`
- `var`
- `fn`
- `return`
- `for`
- `times`
- `while`
- `break`
- `continue`
- `Int`
- `String`
- `Array`
- `Array_v`
- `Byte`
- `Regex`
- `Bool`
- `Unit`

예약어와 타입 이름은 식별자로 사용할 수 없다.

### 2.3 소스 공백

Invar 소스에서 토큰 사이의 스페이스, 탭, 줄바꿈은 동일한 공백으로
취급하며 의미에 영향을 주지 않는다.

```invar
val n: Int[1..=10];
```

위 선언은 다음과 같은 의미다.

```invar
val n
  : Int [ 1 ..= 10 ]
  ;
```

`input` 블록 안의 `,`와 `;`는 Invar 소스의 공백이 아니라 생성되는
Validator가 검사할 입력 데이터의 구조를 나타내는 토큰이다.

### 2.4 주석

`//`로 시작하는 한 줄 주석을 지원한다. 주석은 줄바꿈 또는 Invar
소스의 끝까지 이어진다.

블록 주석 문법은 아직 결정하지 않았다.

### 2.5 정수 리터럴

- 음수를 허용한다.
- 양수를 나타내는 `+`도 허용한다.
- 십진수만 사용한다.
- `0`, `-0`, `+0`을 허용한다.
- 그 밖의 정수 리터럴에는 앞자리 `0`을 허용하지 않는다.

따라서 `00`, `01`, `-00`, `-01`, `+00`, `+01`은 유효하지 않다.
정수 리터럴의 부호가 올 수 있는 모든 위치에 `+`와 `-`를 모두
사용할 수 있다.

부호와 숫자 사이에도 소스 공백을 허용한다.

```invar
val n: Int[- 10..=+ 10];
```

`+`와 `-`는 정수 리터럴의 부호와 단항 연산자로 사용할 수 있다.
따라서 `+n`, `-n`, `-(n + 1)`도 유효하다.

`INT64_MIN`과 `INT64_MAX`는 각각 부호 있는 64비트 정수의 최솟값과
최댓값을 나타내는 내장 이름이다. 값이나 함수 이름으로 다시 선언할 수
없다.

### 2.6 값 리터럴과 이스케이프

- 작은따옴표 `'...'`는 `Byte` 리터럴이다.
- 큰따옴표 `"..."`는 `String` 리터럴이다.
- `r"..."`는 testlib 문법을 그대로 보관하는 `Regex` 리터럴이다.
- `[a, b]`는 문맥으로 원소 타입과 컨테이너 종류가 정해지는 배열
  리터럴이다.

`Byte`와 `String`에는 `\\`, `\'`, `\"`, ``\` ``, `\n`, `\r`, `\t`,
`\0`, `\xNN` 이스케이프를 사용할 수 있다. 여러 줄 리터럴은 지원하지
않는다. 직접 작성한 String 문자는 생성 C++에 UTF-8 바이트열로
보존한다.

## 3. 선언과 타입

### 3.1 값 선언

모든 값 선언은 불변 값을 뜻하는 `val` 또는 가변 값을 뜻하는 `var`로
시작해야 한다.

```invar
val 이름: 타입;
var 이름: 타입;
```

`val`이 없는 이전의 임시 선언 문법은 더 이상 유효하지 않다.

같은 타입과 제약을 갖는 여러 이름을 한 번에 선언할 수 있다.

```invar
val n, m: Int[1..=200000];
```

위 선언은 `n`과 `m`이 각각 같은 타입과 제약을 갖는 유효한
선언이다.

`val`은 실행 경로당 한 번만 값을 지정할 수 있다. 입력 패턴과 일반
대입 모두 값 지정으로 센다. `var`는 여러 번 값을 지정할 수 있다.
한 이름을 선언할 때는 선언 뒤에서 즉시 값을 정할 수 있다.

```invar
val answer: Int = 42;
var index: Int = 0;
```

initializer의 타입은 선언 타입 또는 그 refinement의 서브타입이어야
한다. 여러 이름을 한 선언에 묶은 경우 initializer는 허용하지 않는다.
initializer가 없는 스칼라 값은 별도 입력 패턴 또는 대입문으로 값을
정한다.

### 3.2 `Int`

`Int`는 부호 있는 64비트 정수 입력값 또는 정수 값을 나타낸다. 제약이
없는 `Int`의 범위는 `-2^63` 이상 `2^63 - 1` 이하이다.

정수 범위와 문자열 길이처럼 정수가 필요한 위치에는 결과 타입이
`Int`인 일반 expression을 사용할 수 있다. 따라서 정수 리터럴,
`Int` 이름, 산술식뿐 아니라 `Int`를 반환하는 `if`나 블록 expression도
사용할 수 있다.

`*`, `/`, `%`는 `+`, `-`보다 우선순위가 높다. 같은 우선순위의 이항
연산자는 왼쪽부터 결합한다. 단항 `+`, `-`는 이항 연산자보다
우선순위가 높으며 괄호로 평가 순서를 명시할 수 있다.

나눗셈과 나머지는 Python 정수 연산과 같은 바닥 나눗셈을 사용한다.
몫 `q`와 나머지 `r`은 `a = b * q + r`을 만족하며, 0이 아닌 `b`에
대해 `r`은 `b`와 같은 부호를 갖는다. 특히 `b > 0`이면
`0 <= r < b`이다.

```invar
-5 / 2  // -3
-5 % 2  // 1
5 / -2  // -3
5 % -2  // -1
```

0으로 나누는 상수식은 컴파일 오류다. 제수가 변수에 의존하면 생성된
Validator가 식을 평가하는 시점에 0인지 검사하고 해당 입력을
거부한다.

모든 중간 정수식 결과는 부호 있는 64비트 정수 범위에 들어가야 한다.
상수식의 오버플로는 컴파일 오류이며, 변수에 의존하는 식의 오버플로는
생성된 Validator가 검사하여 해당 입력을 거부한다. 이는 C++의 signed
integer overflow에 의존하지 않기 위한 규칙이다.

정수 범위의 두 경계에는 유효한 정수식을 사용할 수 있다. 한쪽 경계가
없는 범위는 지원하지 않는다. 향후 `I32_MAX`, `I64_MAX` 같은 이름
있는 한계값을 도입하여 무제한에 가까운 범위를 명시적으로 표현한다.

정수 리터럴과 범위 경계의 평가 결과는 모두 부호 있는 64비트 정수
범위 안에 있어야 한다.

범위 표기와 의미는 다음과 같다. 아래에서 `x`는 검사할 값이다.

| 표기 | 의미 |
|---|---|
| `Int[a..b]` | `a <= x && x < b` |
| `Int[a..=b]` | `a <= x && x <= b` |
| `Int[a<..b]` | `a < x && x < b` |
| `Int[a<..=b]` | `a < x && x <= b` |

상한은 기존의 Rust식 `..`와 `..=`로 제외 여부를 나타낸다. 하한 앞의
`<`는 `a < x`처럼 읽으며 하한을 제외한다. 이 표기는 향후 실수 타입의
열린 범위에도 같은 의미로 사용한다.

리터럴 경계만으로 범위가 비어 있음을 알 수 있어도 컴파일 오류로
처리하지 않는다. 해당 값이 `input`에서 입력된다면 어떤 입력도 통과할
수 없는 제약이라는 경고를 생성한다.

### 3.3 `String`

`String[length]`는 길이가 정확히 `length`인 문자열을 나타낸다.

문자열 길이는 입력된 바이트열의 바이트 수로 계산한다. UTF-8로
해석했을 때 유효한지는 검사하지 않으며, 문자 집합 제약을 도입할 때
별도로 다룬다.

`length`에는 현재 정수식 문법으로 유효한 모든 식을 사용할 수 있다.
따라서 정수 리터럴, `Int` 값 참조와 정수 산술식을 사용할 수 있다.

문자열 길이는 항상 음이 아닌 정수여야 한다. 컴파일러는 `length`가
음수가 될 수 없음을 컴파일 시간에 증명해야 한다.

- 리터럴 길이가 음수이면 오류다.
- 변수 길이가 음수가 될 가능성이 있거나, 비음수임을 증명할 수
  없으면 오류다.
- 실행 시점의 값에 맡겨 두는 동적 길이 검사는 허용하지 않는다.

현재 비음수 증명은 정수 리터럴과 `Int` 변수의 선언된 하한을
재귀적으로 따라가는 보수적인 범위 분석을 사용한다. 증명할 수 없으면
오류다.

정수의 이산성도 증명에 사용한다. 예를 들어 `n`이
`Int[-1<..=100]`이면 `n`의 가능한 최솟값은 0이므로 `String[n]`은
유효하다.

`String` 타입 자체는 공백 없는 토큰이나 한 줄 전체 같은 구체적인
입력 방식을 결정하지 않는다. 값을 어떤 방식으로 읽을지는 `input`
블록의 입력 패턴이 결정한다. 이름을 토큰 패턴으로 쓰면 공백 없는
토큰 하나를 읽고, `line(s)`로 쓰면 빈 문자열과 공백을 포함할 수 있는
줄 전체를 읽는다.

문자열의 내부 내용은 읽기 전용이다. `var`로 선언한 문자열은 문자열
값 전체를 다시 대입할 수 있다는 뜻이며, 문자열 안의 특정 바이트를
대입 대상으로 사용할 수 있다는 뜻은 아니다. `s[i]`는 0부터 시작하는
UTF-8 바이트 인덱스로 `Byte` 값을 반환하며 lvalue가 아니다. 범위는
생성된 Validator가 실행 중 검사한다.

`s.length`는 문자열의 현재 바이트 길이를 `Int`로 반환한다.
`String[n]` 값의 `.length` 타입은 정확히 `Int[n..=n]`이다.

빈 문자열은 유효한 `String` 값이다. 다만 사용하는 입력 패턴으로 빈
문자열을 표현할 수 없다면 통과 가능한 입력이 없다는 경고를 생성한다.

문자열의 문자 집합 제약은 아직 결정하지 않았다.

### 3.4 `Array`

배열 타입은 원소 타입과 길이를 함께 명시한다.

```invar
val values: Array[Int, 10];
val matrix: Array[Array[Int, columns], rows];
```

`Array[T, length]`의 `T`에는 현재 유효한 모든 값 타입을 사용할 수
있으므로 배열을 중첩할 수 있다. `length`는 `Int` expression이며 배열
선언이 실행되는 시점에 값이 준비되어 있어야 한다. 길이가 음이 아님을
컴파일 시간에 증명할 수 있어야 한다. 준비된 `var`와 배열 원소는
아래의 snapshot 규칙에 따라 길이에 사용할 수 있다.

배열 선언은 해당 길이의 저장소를 만들지만 스칼라 원소는 초기화하지
않는다. 원소를 처음 읽기 전에 대입 또는 입력으로 값을 정해야 한다.
정적으로 추적할 수 없는 인덱스별 초기화 상태는 생성된 Validator가
실행 중 검사한다. 중첩 배열의 내부 저장소는 선언과 함께 만들어진다.

원소는 대괄호로 접근하며 여러 차원을 연속해서 쓸 수 있다.

```invar
values[i] = 10;
matrix[row][column] += 1;
require(values[i] > 0);
```

배열이 `val`로 선언되어도 내부 원소는 항상 가변적이다. `val`은 배열
값 자체를 다른 배열로 다시 대입할 수 없다는 뜻이다. `var` 배열은
배열 값 자체도 다시 대입할 수 있다.

인덱스는 `Int`여야 한다. 항상 범위를 벗어남을 정적으로 알 수 있으면
컴파일 오류이며, 입력 등에 따라 달라지는 경우 생성 Validator가
`0 <= index < length`를 검사한다.

일반 배열 전체는 하나의 입력 토큰으로 읽을 수 없다.
`input { values[i]; }`처럼 원소 단위로 입력한다. `line(array)`도 현재
지원하지 않는다. `array.length`는 고정 길이를 정확한 `Int` refinement로
반환한다.

### 3.5 `Array_v`

`Array_v[T]`는 실행 중 길이가 달라질 수 있는 배열이다. 배열 리터럴은
기대 타입이 `Array[T, n]` 또는 `Array_v[T]`인 위치에서만 사용할 수
있다. 고정 배열 문맥에서는 원소 수가 선언 길이와 정확히 같아야 한다.
기대 타입이 없는 배열 리터럴은 원소가 비어 있지 않아도 오류다.

```invar
val fixed: Array[Int, 3] = [1, 2, 3];
val values: Array_v[Int] = [];
values.push(10);
values.resize(3);
values[1] = 20;
val last: Int = values.pop();
```

`.length`는 현재 길이를 반환한다. `push(value)`는 끝에 초기화된 원소를
추가하고, `pop()`은 마지막 원소를 제거하여 반환하며, `resize(length)`는
길이를 바꾼다. 확장으로 생긴 원소는 초기화되지 않은 상태이므로 읽기
전에 대입해야 한다. 음수 크기, 빈 배열의 `pop`, 범위를 벗어난 인덱스와
미초기화 원소 읽기는 Validator 실행 중 거부한다.

고정 배열과 `Array_v`의 복사는 저장소를 공유하는 얕은 복사다. 복사한
배열의 원소나 길이를 변경하면 별칭을 통해 같은 변경을 볼 수 있다.
`Array_v` 전체를 읽는 입력 패턴은 현재 없다.

### 3.6 `Byte`, `Regex`, `Bool`과 `Unit`

`Byte`는 문자열 인덱싱 단위와 같은 한 바이트 값이다. 작은따옴표
리터럴은 이스케이프 처리 후 정확히 한 바이트여야 한다. 따라서
`'a'`와 `'\x61'`은 유효하지만, UTF-8에서 여러 바이트인 직접 작성
문자는 하나의 `Byte`가 될 수 없다. `Byte`는 입력 패턴으로 직접 읽을
수 없으며 한 바이트 문자열 입력이 필요하면 `String[1]`을 사용한다.

`Regex`는 testlib `pattern` 문법의 정규식을 보관하는 내부 타입이다.
`r"..."`가 `Regex` 값을 만들며 `matches(string, regex)`가 일치 여부를
`Bool`로 반환한다. 정규식 refinement 타입은 두지 않고 필요한 검사는
`require(matches(...))`로 작성한다.

`Bool`은 `true`와 `false`를 값으로 갖는 내장 타입이다. 문제 입력에서
직접 읽을 수 없으며 조건식과 논리 연산의 결과로 사용한다.

`Unit`은 의미 있는 반환값이 없음을 나타내는 내장 타입이다. `Bool`과
마찬가지로 문제 입력에서 직접 읽을 수 없다. `require(...)`, tail
expression이 없는 블록과 expression이 세미콜론으로 끝나는 블록의
결과 타입은 `Unit`이다.

### 3.7 refinement와 서브타이핑

Invar에는 상속이나 서로 다른 기본 타입 사이의 서브타이핑이 없다.
다만 같은 기본 타입 계열의 refinement 사이에는 제약의 포함 관계에
따른 서브타이핑을 허용한다.

```text
Refine(B, P) <: Refine(B, Q)  if P implies Q
B = Refine(B, true)
```

예를 들어 다음 관계가 성립한다.

```text
Int[1..=5] <: Int[0..=10] <: Int
String[3] <: String
```

`Int`와 `String`, `Bool`, `Unit` 사이에는 서브타이핑이나 암시적 변환이
없다. 컴파일러가 제약 포함 관계를 증명할 수 없으면 서브타입으로
간주하지 않는다.

값 선언과 함수 서명에는 타입을 항상 명시한다. 다만 컴파일러는
리터럴과 expression 결과의 refinement를 구문 주도로 계산한다. 이는
선언 타입을 생략하게 하는 타입 추론이 아니라 타입 검사의 일부다.
일반 대입, 초기화와 함수 호출에서 필요한 refinement 포함 관계는
컴파일 시간에 증명해야 한다. 동적 refinement 검사는 선언된 값을
`input` 패턴으로 읽을 때만 허용한다. `require`나 `if` 조건은 이후
값의 refinement를 좁히는 증거로 사용하지 않는다.

### 3.7 이름 참조와 선언 순서

타입 제약과 식에서 참조하는 값은 참조 지점보다 먼저 선언되어야 한다.
선언 전에 이름을 참조하면, 나중에 같은 이름의 선언이 나오더라도
오류다.

같은 `val` 선언에서 선언 중인 이름도 해당 선언의 타입 제약에서는
참조할 수 없다.

```invar
val lower, x: Int[lower..=10]; // 오류
```

참조하려면 선언을 분리해야 한다.

실제 Validator 실행 시점에 필요한 값이 준비되어 있는지는 `input`
블록의 입력 순서와 향후 상수 또는 계산된 값의 평가 순서를 바탕으로
추가로 검사한다.

refinement expression이 `var`를 참조하면 타입 선언 시 expression의
현재 결과를 숨은 불변 값으로 한 번 저장한다. 이후 `var`가 바뀌어도
이미 선언된 타입의 경계나 길이는 이 snapshot을 사용한다. snapshot을
만드는 데 필요한 모든 값은 타입 선언 시점에 준비되어 있어야 한다.

```invar
var upper: Int[1..=10] = 5;
val value: Int[1..=upper]; // upper의 현재 값 5를 저장
upper = 10;                // value의 상한은 계속 5
```

정적 구간 분석은 dependent 경계의 가능한 값 구간과 모든 경우에
보장되는 구간을 구분한다. 예를 들어 `upper: Int[1..=10]`을 사용한
`Int[1..=upper]`은 실행별로 최대 10까지의 값을 가질 수 있다. 하지만
모든 가능한 `upper`에서 항상 허용된다고 증명할 수 있는 상한은 1이다.
대입의 refinement 서브타이핑 증명에는 후자의 보장 구간을 사용한다.
관계를 더 정확히 증명하지 못하면 안전하게 오류로 처리한다.

배열 원소 접근도 expression 전체를 선언 시 한 번 평가하여 snapshot
대상으로 삼는다. 컴파일러가 동적 인덱스의 범위나 해당 원소의 초기화
여부를 증명할 필요는 없다. 생성 Validator가 snapshot을 만드는 시점에
인덱스 범위와 원소 초기화를 검사하며, 실패하면 입력을 거부한다.

## 4. `input` 블록

`input` 블록은 값이 입력 파일에서 나타나는 순서와 줄바꿈 구조를
정의한다.
한 소스에 여러 `input` 블록을 둘 수 있다.

현재 프로그램의 최상위에는 `val`/`var` 선언, 대입문, `input` 블록,
제어문, 빈 문과 expression statement를 둘 수 있다. 이들을 자유롭게
섞을 수 있으며 소스에 작성된 순서대로 처리한다.

```invar
val n: Int;
input { n; }

val s: String[n];
input { s; }
```

이름은 항상 참조 전에 선언되어야 하고, 값을 사용하는 시점에는 이전
입력 블록에서 값이 정해져 있어야 한다.

타입 제약에 필요한 값이 아직 입력되지 않았다면 오류다.

```invar
val lower: Int;
val x: Int[lower..=10];

input {
    x;     // lower의 값이 아직 없으므로 오류
    lower;
}
```

프로그램에는 빈 블록을 포함하여 `input` 블록이 최소 하나 있어야
한다.

```invar
input {
    n, m;
    s;
    t;
}
```

### 4.1 줄 단위 패턴과 토큰 단위 패턴

- `input`의 내용은 줄 단위 입력 패턴들로 구성된다.
- `;`는 줄 단위 입력 패턴의 끝을 나타낸다.
- 줄 단위 입력 패턴은 현재 0개 이상의 토큰 단위 입력 패턴으로
  구성되거나, `line(x)` 전체 줄 값 패턴 하나로 구성된다.
- `,`는 같은 줄에 있는 토큰 단위 입력 패턴을 구분한다.
- `,` 자체가 문제 입력의 특정 문자 하나를 뜻하지는 않는다.
- `;` 하나마다 완성된 줄 단위 입력 패턴에 이어 입력 데이터의
  줄바꿈 하나를 검사한다.
- 입력 블록의 끝 자체는 문제 입력의 문자를 소비하지 않는다.
- 프로그램의 문장을 모두 실행한 뒤 EOF를 검사한다.

현재 토큰 단위 입력 패턴은 변수 이름이다. 이 패턴은 대상 testlib의
엄격한 Validator 토큰 읽기 규칙에 따라 토큰 하나를 읽는다. 토큰
앞뒤에 허용되는 실제 공백의 종류와 개수는 Invar가 별도로 정의하지
않고 대상 testlib의 동작을 따른다.

따라서 위 예제는 같은 줄에서 연속해서 읽는 토큰 `n`과 `m`, 그 뒤의
명시적인 줄바꿈, 다음 줄의 토큰 `s`, 줄바꿈, 다음 줄의 토큰 `t`,
줄바꿈과 EOF를 요구한다.

마지막으로 입력되는 값 뒤의 `;`를 생략하면 그 값을 읽은 직후 EOF를
검사한다. 이는 유효하지만 마지막 줄바꿈이 없는 입력 형식이라는
경고를 생성한다.

마지막 블록보다 앞에 있는 블록의 마지막 줄바꿈도 작성된 그대로
적용된다. 예를 들어 다음 소스는 `a`, 줄바꿈, `b`, 줄바꿈, EOF를
요구한다.

```invar
val a, b: Int;
input { a; }
input { b; }
```

토큰 단위 입력 패턴이 0개인 줄 단위 입력 패턴도 유효하다. 따라서
세미콜론을 연속해서 사용할 수 있다.

```invar
input { ;; }  // 빈 줄 두 개
input { n;; } // n, 줄바꿈, 빈 줄 하나
```

블록 경계는 완성되지 않은 줄 단위 입력 패턴을 끝내지 않는다. 앞
블록의 마지막 줄 패턴과 다음 블록의 첫 줄 패턴 사이에 `;`가 없으면
두 패턴의 토큰 목록을 합친다. 따라서 다음 두 형식은 같은 줄 단위
입력 패턴으로 간주한다.

```invar
input { a, b; }
```

```invar
input { a }
input { b; }
```

쉼표 앞에는 토큰 단위 입력 패턴이 있어야 한다. 토큰 목록 끝의
trailing comma는 허용하며 빈 토큰 패턴을 만들지 않는다.

```invar
input { a, }
input { a, b, ; }
```

따라서 `input { ,n; }`과 `input { a,,b; }`은 오류지만
`input { a,; }`은 유효하다.

같은 `input` 블록의 동일한 줄 패턴에 속한 토큰 패턴 사이에는
쉼표가 필수다.

```invar
input { a, b; } // 유효
input { a b; }  // 구문 오류
```

trailing comma는 의미에 영향을 주지 않는다. 따라서 다음 세 형식은
같은 입력을 요구한다.

```invar
input { a, b; }
input { a, b,; }
input { a, b, ; }
```

### 4.2 전체 줄 값 패턴

`line(x)`는 매크로나 함수 호출이 아니라 `input` 블록에서만 사용하는
**전체 줄 값 입력 패턴**이다.

```invar
val n: Int;
val s: String;

input {
    line(n);
    line(s);
}
```

`x`의 타입은 줄 입력을 지원해야 한다. 현재 타입인 `Int`와 `String`은
모두 줄 입력을 지원한다.

- `line(s)`에서 `String` 값은 공백과 빈 문자열을 포함하여 해당 줄의
  내용 전체를 받는다. 줄바꿈 문자는 값에 포함하지 않는다.
- `line(n)`에서 `Int` 값은 정수 하나만 있는 줄을 받는다. 같은 줄에
  다른 토큰이나 문자가 남으면 입력을 거부한다.
- 타입 제약, 의존성 순서와 한 번만 값을 지정할 수 있다는 규칙은
  토큰 패턴과 똑같이 적용된다.
- `String[0]`은 `line(s)`로 빈 줄을 표현할 수 있으므로 빈 문자열
  토큰 경고를 생성하지 않는다.

전체 줄 값 패턴은 토큰 패턴 목록과 같은 줄에서 섞을 수 없다.

```invar
input { line(a), b; } // 구문 오류
input { a, line(b); } // 구문 오류
```

뒤의 `;`는 다른 줄 패턴과 마찬가지로 입력의 줄바꿈을 요구한다.
마지막 `line(x)` 뒤에서 `;`를 생략하면 줄바꿈 없이 값 직후 EOF를
요구하고 `SEM_MISSING_FINAL_EOLN` 경고를 생성한다.

토큰 패턴과 달리 전체 줄 패턴은 다음 `input` 블록과 같은 줄로 이어
붙일 수 없다. `line(x)` 뒤의 `;`를 생략한 뒤 다른 입력 패턴이 나오면
오류다.

### 4.3 줄바꿈

Validator가 검사하는 입력 데이터의 줄바꿈은 LF와 CRLF를 모두 하나의
줄바꿈으로 인정한다.

### 4.4 Invar 소스의 끝

마지막 `}` 뒤에는 스페이스, 탭, 줄바꿈 및 `//` 주석을 허용한다.
그 뒤에 의미 있는 다른 토큰이 나오면 오류다.

### 4.5 토큰 단위 입력 패턴과 값 지정

토큰 단위 입력 패턴은 변수 이름, 배열 원소 접근 또는 백틱 리터럴이다.
`` `literal` ``은 문제 입력의 토큰 하나를 소비하며 그 바이트열이
리터럴과 정확히 같은지 검사한다. 빈 토큰 리터럴은 허용하지 않는다.

두 개의 백틱으로 감싼 `` ``literal`` ``은 줄 단위 입력 패턴이다. 줄
시작에서 줄바꿈을 제외한 내용 전체를 소비하고 바이트열이 정확히 같은지
검사한다. 값 전체 줄 패턴인 `line(x)`와 마찬가지로 다른 토큰 패턴과
한 줄에 섞을 수 없다.

```invar
input {
    n, m;
    values[i];
}
```

토큰 단위 입력 패턴에 값이 들어오면 해당 이름에 한 번의 대입이
일어난 것으로 간주한다. `val`을 같은 실행 경로에서 두 번 입력하면
오류다. `var`는 반복 입력을 포함해 여러 번 입력할 수 있다.

향후 구조 분해 대입을 도입하면 튜플 같은 패턴을 추가할 수 있지만
현재 문법과 구현에는 포함하지 않는다.

`String`을 공백 없는 토큰, 한 줄 전체 또는 다른 형식으로 읽는지는
타입이 아니라 입력 패턴의 종류에 따라 결정한다. 현재 변수 이름 토큰
패턴으로 `String`을 읽으면 공백 없는 토큰 하나를 읽는다.

따라서 `String[0]`을 현재 변수 이름 패턴으로 입력받으면 빈 문자열을
표현할 수 없다는 경고를 생성한다. 향후 `line(s)`처럼 빈 문자열을
표현할 수 있는 줄 단위 패턴에서는 같은 경고를 생성하지 않는다.

실제 문제 입력에 나타나는 `Int`의 문자열 형식은 대상 testlib의
엄격한 Validator 읽기 규칙을 따른다. Invar 소스의 정수 리터럴
문법과 문제 입력의 정수 표기 규칙은 서로 별개다.

### 4.6 변수 사용 횟수

- 선언된 값이 어떤 입력이나 대입에도 등장하지 않아도 컴파일은
  성공한다.
- 값이 한 번도 정해지지 않은 선언에는 경고를 생성한다.
- `val`을 같은 실행 경로에서 두 번 이상 정하는 것은 오류다.
- `var`는 여러 번 정할 수 있다.

향후 상수나 계산된 값처럼 입력될 필요가 없는 값에는 이 경고를
적용하지 않는 방향을 고려해야 한다.

### 4.7 의존성

어떤 입력값을 검증하는 데 다른 입력값이 필요하면 의존 대상이 먼저
입력되어 있어야 한다.

예를 들어 `s: String[n]`이면 `input` 블록에서 `n`이 `s`보다 먼저
입력되어야 한다. 이는 `n`이 `s`의 선언보다 먼저 나와야 한다는 이름
참조 규칙에 더해 적용되는 별도의 값 준비 순서 검사다.

변수 경계가 실행 시점에 빈 범위를 만들더라도 경계를 미리 검사하지
않는다. 해당 타입의 값을 입력받는 시점에 그 값을 통과시킬 수 없으므로
Validator가 거부한다.

### 4.8 빈 입력 블록

빈 `input` 블록을 허용한다.

```invar
input {
}
```

빈 블록은 어떤 값이나 줄바꿈도 소비하지 않는다. 여러 입력 블록이
있을 때 마지막 블록이 비어 있으면 그 블록의 위치에서 EOF를
검사한다.

세미콜론 하나만 있는 입력 블록도 허용한다.

```invar
input {
    ;
}
```

이 블록은 빈 줄 하나를 입력받는다. 세미콜론을 연속해서 사용하면
여러 빈 줄을 입력받는다.

## 5. 컴파일 결과와 진단

- 경고가 있어도 컴파일은 성공한다.
- 성공 결과에는 생성된 C++ 코드와 경고를 함께 포함한다.
- 오류가 있으면 C++ 코드를 생성하지 않는다.
- 복구 가능한 오류와 경고는 가능한 범위에서 여러 개 수집한다.
- 잘못된 토큰 등으로 현재 단계를 계속할 수 없으면 해당 단계는
  중단한다.

현재 확정된 경고 사례:

- 선언했지만 값을 입력받지 않은 `val`
- 마지막 입력 항목 뒤의 `;`를 생략하여 마지막 줄바꿈을 요구하지 않음
- 정적으로 빈 타입의 값을 표현할 수 없는 입력 패턴으로 입력받음

현재 확정된 오류 사례:

- 중복된 값 이름
- 선언 목록 끝의 쉼표
- 예약어 또는 타입 이름을 식별자로 사용
- 문자열 길이가 정적으로 비음수임을 증명할 수 없음
- 허용되지 않은 빈 입력 위치
- 상수 정수식의 0 나눗셈
- 상수 정수식 또는 정수 리터럴이 부호 있는 64비트 범위를 벗어남
- `Bool` 또는 `Unit`을 입력 패턴에서 읽으려 함
- `if` 조건이 `Bool`이 아님
- `if` 양쪽 분기의 기본 타입을 통합할 수 없음
- 모든 실행 경로에서 값이 정해지기 전에 expression에서 사용함
- 활성화된 바깥 선언을 블록 안에서 shadowing함
- mutable snapshot에 필요한 값이 타입 선언 시점에 준비되지 않음
- 선언된 refinement를 벗어날 수 있는 값을 대입함
- 초기화되지 않은 `var`에 복합 대입함
- 반복문의 조건 또는 횟수 타입이 잘못됨
- 배열 길이가 선언 시점에 준비되지 않았거나 비음수임을 증명할 수 없음
- 정적으로 항상 범위를 벗어나는 배열 인덱스
- 초기화되지 않은 배열 원소를 실행 중 읽음
- 압축 토큰 입력을 지원하지 않는 배열 전체를 입력받으려 함

### 5.1 최상위 빈 문

`input` 블록 밖의 독립된 `;`는 빈 문이며 허용한다.

```invar
val n: Int;
;
input { n; }
```

`val` 선언 자체를 끝내는 `;`는 항상 필수다.

## 6. Expression과 제어 흐름

### 6.1 조건식

`true`와 `false`는 `Bool` 리터럴이다. 지원하는 조건 연산자는 다음과
같다.

| 피연산자 | 연산자 | 결과 |
|---|---|---|
| `Int`, `Int` | `==`, `!=`, `<`, `<=`, `>`, `>=` | `Bool` |
| `Byte`, `Byte` | `==`, `!=`, `<`, `<=`, `>`, `>=` | `Bool` |
| `String`, `String` | `==`, `!=`, `<`, `<=`, `>`, `>=` | `Bool` |
| 비교 가능한 원소의 `Array`/`Array_v` | `==`, `!=`, `<`, `<=`, `>`, `>=` | `Bool` |
| `Bool`, `Bool` | `==`, `!=`, `&&`, `||` | `Bool` |
| `Bool` | 단항 `!` | `Bool` |

배열은 사전식으로 비교한다. 고정 `Array`와 `Array_v` 사이에도 원소
타입을 비교할 수 있으면 비교할 수 있으며, 중첩 배열에도 같은 규칙을
재귀 적용한다. Bool 원소 배열에는 동등 비교만 사용할 수 있다.
서로 다른 스칼라 기본 타입 사이의 비교와 `Unit`의 동등 비교는
허용하지 않는다. `&&`와 `||`는 C++와 마찬가지로 왼쪽부터 평가하며
short-circuit한다.

연산자 우선순위는 높은 순서대로 단항 연산자, 곱셈 계열, 덧셈 계열,
순서 비교, 동등 비교, `&&`, `||`이다.

### 6.2 `require`

`require`는 `Bool -> Unit`인 내장 expression이다.

```invar
require(lower <= upper);
```

조건이 거짓이면 생성된 Validator가 해당 입력을 거부한다.
이때 실패 메시지에는 `require`에 전달한 조건식의 원본 소스 텍스트가
포함된다.
`require(...)` 자체의 결과값은 `Unit`이며, statement로 사용할 때는
뒤에 세미콜론을 쓴다. 조건을 통해 이후 expression의 refinement를
좁히는 flow-sensitive narrowing은 아직 수행하지 않는다.

### 6.3 블록 expression

중괄호 블록은 lexical scope를 만드는 expression이다. 내부에는
`val`/`var`, 대입문, `input`, 제어문, expression statement와 빈 문을
둘 수 있다.

마지막 expression에 세미콜론이 없으면 그 expression의 값과 타입이
블록의 결과다. tail expression이 없거나 마지막 expression이
세미콜론으로 끝나면 결과 타입은 `Unit`이다.

```invar
{ 10 }                  // Int
{ 10; }                 // Unit
{ require(true); 10 }   // Int
{ require(true); }      // Unit
```

블록의 `val`은 블록 밖에서 참조할 수 없다. 바깥에서 활성화된 이름을
블록 안에서 shadowing하는 것은 허용하지 않는다. 서로 다른 형제
블록에서는 같은 지역 이름을 각각 선언할 수 있다.

### 6.4 `if` expression

`if`는 `else`가 항상 필요한 expression이며 조건 괄호를 생략할 수
없다.

```text
if (condition) then-expression else else-expression
```

조건은 `Bool`이어야 한다. 여러 statement를 실행하는 분기는 블록
expression으로 작성한다. `else if`는 `else` 뒤에 중첩된 다른 `if`
expression이 온 것으로 해석한다.

두 분기의 타입은 같은 기본 타입 계열에서 공통 상위 refinement로
통합한다. 포함 관계가 있으면 더 넓은 타입을 사용하고, 두 `Int`
구간이면 안전한 구간 외피를 사용한다. 정확한 공통 refinement를
표현하거나 증명할 수 없으면 같은 기본 타입으로 넓힌다. 기본 타입이
다르면 오류다.

### 6.5 분기와 입력 대입

분기별 대입 상태는 실행 경로를 고려하여 분석한다.

- 두 분기 모두에서 입력된 값은 분기 뒤에서 사용할 수 있다.
- 한 분기에서만 입력된 값은 분기 뒤에서 사용할 수 없다.
- 같은 값을 양쪽 분기에서 각각 한 번 입력하는 것은 실행 경로당 한
  번의 대입이므로 허용한다.
- 분기 전에 이미 입력된 값은 어느 분기에서도 다시 입력할 수 없다.

조건에 의해 refinement를 좁히는 분석은 현재 수행하지 않는다.

### 6.6 대입문과 가변 값

일반 대입은 선언과 분리된 statement이며 세미콜론이 필요하다.

```invar
val fixed: Int;
var counter: Int;

fixed = 10;
counter = 0;
counter += 1;
```

`=`은 `val`과 `var`에 사용할 수 있다. `val`은 실행 경로당 한 번만
대입할 수 있고 `var`는 다시 대입할 수 있다. 대입할 expression의
타입은 대상의 선언 타입 또는 그 refinement의 서브타입이어야 한다.

`+=`, `-=`, `*=`, `/=`, `%=`는 이미 값이 정해진 `var Int`에만 사용할
수 있다. 산술 의미, 0 나눗셈과 오버플로 검사는 일반 정수식과 같다.
복합 대입의 가능한 결과가 선언된 refinement 안에 있음을 정적으로
증명할 수 없으면 오류다.

### 6.7 statement 형태의 `if`

참 분기가 tail expression이 없는 블록이고, `else`가 있다면 그
분기도 같은 형태이면 `if` 전체를 statement로 취급한다. statement
형태에서는 `else`를 생략할 수 있으며 닫는 블록만으로 statement가
완결된다. `else if`의 각 분기도 같은 조건을 만족해야 한다.

닫는 블록 뒤에 세미콜론을 써도 유효하다. 이 세미콜론은 `if` 자체의
일부가 아니라 뒤따르는 빈 statement로 처리한다.

```invar
if (condition) {
    require(true);
} else {
    require(false);
}

if (condition) {
    require(true);
}
```

참 분기나 `else` 분기가 값을 내면 기존 `if` expression이다. 값을
결정하려면 두 경로가 모두 필요하므로 expression 형태에서는 `else`가
여전히 필수이고, expression statement로 쓸 때 마지막 세미콜론도
필요하다.

### 6.8 반복문

이터레이터 없는 횟수 반복은 다음 형태다.

```invar
for (count) times {
    // count번 실행
}
```

`count`는 `Int` expression이며 반복문에 들어갈 때 한 번 평가한다.
음수임이 정적으로 확정되면 컴파일 오류이고, 동적 값이면 생성
Validator가 음수 값을 거부한다. 0이면 본문을 실행하지 않는다.
`for`는 항상 statement이다. 블록 뒤의 세미콜론은 별도의 빈
statement로 허용한다.

`while`도 항상 statement다. 조건은 반복할 때마다 평가되는 `Bool`
expression이고 본문은 블록이어야 한다.

```invar
while (condition) {
    // statements
}
```

`while` 뒤의 세미콜론도 별도의 빈 statement로 허용한다. `break;`는
가장 가까운 반복문을 끝내고 `continue;`는 가장 가까운 반복문의 다음
반복으로 넘어간다. 두 문장은 반복문 안에서만 사용할 수 있으며 중첩
함수 경계를 넘어 바깥 반복문에 적용되지 않는다. for 이터레이터
문법은 아직 지원하지 않는다.

반복 전에 선언된 `val`은 반복 본문에서 대입하거나 입력받을 수 없다.
그렇게 하면 같은 실행 경로에서 여러 번 대입될 수 있기 때문이다.
반복 본문 안에서 선언한 `val`은 각 반복마다 새로 생기므로 한 번
대입할 수 있다. `var`는 반복 본문에서 대입과 입력을 반복할 수 있다.

반복 뒤의 definite-assignment 분석은 0회 실행 가능성을 고려한다.
`for` 횟수의 선언된 최솟값이 1 이상일 때만 본문에서 정해진 값이
반복 뒤에도 반드시 정해졌다고 본다. `while`은 항상 0회 실행 가능성이
있다고 본다.

입력 줄 상태는 분기, 반복과 함수 호출의 모든 경로를 정적으로
고정점 분석하여 컴파일 오류로 만들지 않는다. 줄 중간에서
`line(x)`나 줄 리터럴을 실행하거나 미완성 토큰 줄을 부적절하게
이어가는 경우 생성된 Validator가 실제 실행 시점의 상태를 검사하여
거부한다.

## 7. 사용자 정의 함수

함수의 모든 매개변수와 반환 타입은 명시한다. 세미콜론으로 끝나는
선언과 본문이 있는 정의를 분리할 수 있다.

```invar
fn is_even(n: Int): Bool;
fn is_odd(n: Int): Bool;

fn is_even(n: Int): Bool {
    if (n == 0) true else is_odd(n - 1)
}
```

함수는 호출 전에 선언되어야 하지만 정의 전에 호출하는 것은
허용한다. 재귀와, 먼저 선언된 함수들 사이의 상호 재귀를 허용하며
오버로딩은 지원하지 않는다. 선언과 정의의 매개변수 및 반환 타입은
정확히 일치해야 한다.

본문 블록의 마지막 식이 반환값이다. `return expression;`은 본문
중간에서 값을 반환하며 `Unit` 함수에서는 `return;`도 사용할 수 있다.
배열 인수는 값으로 전달하지만 저장소는 공유하므로 얕은 복사 의미를
갖는다. 함수 본문에는 `input`과 `require`를 사용할 수 있다.

함수는 블록 안에 중첩할 수 있으며 lexical scope의 외부 값을 참조로
캡처한다. 캡처한 `val` 바인딩은 읽을 수 있지만 대입하거나 입력받을
수 없다. 캡처한 `var` 바인딩과 `val`을 포함한 배열의 원소는 변경할
수 있다. 함수는 아직 일급 값이 아니므로 반환하거나 변수와 배열에
저장할 수 없고, 중첩 함수는 선언된 lexical scope를 벗어나지 않는다.

외부 값의 대입 효과는 함수 호출 관계를 따라 전파한다. 조건문,
반복문, 재귀와 상호 재귀가 있으면 가능한 대입과 반드시 일어나는
대입의 상태 관계가 변하지 않을 때까지 고정점으로 계산한다.

뒤쪽 매개변수 타입과 반환 타입은 앞쪽 매개변수를 참조할 수 있다.
호출 시 실제 인수 expression을 해당 매개변수 참조에 대입한 뒤
refinement를 검사한다.

```invar
fn bounded(n: Int, x: Int[0..=n]): Int[0..=n] {
    x
}

val answer: Int[0..=3] = bounded(3, 2);
```

함수 안의 `input`은 함수가 호출된 현재 입력 위치에서 시작하고 끝날
수 있으며 입력 구조를 바꿀 수 있다. 줄 경계가 잘못된 실행 경로는
생성 Validator가 런타임에 거부한다.

## 8. testlib과의 경계

생성된 C++ Validator는 testlib의 `readEoln()`과 `readEof()` 같은
기능을 사용하여 입력 데이터를 검사할 수 있다.

testlib은 생성된 Validator가 읽는 **문제 입력 파일**만 처리한다.
Invar 소스의 뒤쪽 공백, 주석, 구문 오류는 TypeScript로 작성된 Invar
Lexer와 Parser가 처리해야 한다.

생성 C++ 파일은 기본적으로 맨 위에 원본 Invar 소스를 줄 주석으로
보존한다. 이는 Validator의 동작에는 영향을 주지 않는 코드 생성
옵션이며 웹 UI에서 끌 수 있다.

testlib가 직접 표현할 수 있는 입력 제약은 가능한 한 testlib의 이름
있는 읽기 함수를 사용한다. 정수는 `readLong(min, max, name)`으로
읽고, 문자열 토큰과 줄은 각각 이름을 전달한 pattern 기반
`readToken`과 `readLine`으로 읽는다. 오류에 표시되는 이름은 난독화된
C++ 이름이 아니라 원본 Invar 이름 또는 `values[index]` 같은 원본 입력
대상 표기다. testlib 읽기 함수로 표현할 수 없어 생성기가 직접
검사하는 조건의 오류에는 가능한 경우 실제 값과 기대값을 모두
포함한다.

구체적으로 사용할 testlib API와 버전은 코드 생성 단계를 설계할 때
확정한다.

## 9. 현재 최소 문법

아래 문법은 현재 구현 대상의 구조를 EBNF에 가까운 표기로 정리한
것이다. 소스 공백과 `//` 주석은 토큰 사이에서 생략된다.

```text
program
    := statement* EOF

statement
    := value-declaration
     | function-declaration
     | return-statement
     | break-statement
     | continue-statement
     | input-block
     | assignment
     | if-statement
     | for-statement
     | while-statement
     | expression ";"
     | ";"

value-declaration
    := ("val" | "var") identifier ("," identifier)* ":" type
       ("=" expression)? ";"

function-declaration
    := "fn" identifier "(" parameter-list? ")" ":" type
       (";" | block-expression)

parameter-list
    := identifier ":" type ("," identifier ":" type)*

return-statement
    := "return" expression? ";"

break-statement
    := "break" ";"

continue-statement
    := "continue" ";"

assignment
    := assignment-target ("=" | "+=" | "-=" | "*=" | "/=" | "%=")
       expression ";"

assignment-target
    := identifier ("[" expression "]")*

if-statement
    := statement-if-expression

statement-if-expression
    := "if" "(" expression ")" unit-block
       ("else" (unit-block | statement-if-expression))?

for-statement
    := "for" "(" expression ")" "times" block-expression

while-statement
    := "while" "(" expression ")" block-expression

unit-block
    := "{" statement* "}"

type
    := int-type
     | string-type
     | array-type
     | dynamic-array-type
     | "Byte"
     | "Regex"
     | "Bool"
     | "Unit"

int-type
    := "Int" ("[" int-range "]")?

int-range
    := expression ".." expression
     | expression "..=" expression
     | expression "<.." expression
     | expression "<..=" expression

string-type
    := "String" ("[" expression "]")?

array-type
    := "Array" "[" type "," expression "]"

dynamic-array-type
    := "Array_v" "[" type "]"

expression
    := if-expression
     | logical-or-expr

if-expression
    := "if" "(" expression ")" expression "else" expression

logical-or-expr
    := logical-and-expr ("||" logical-and-expr)*

logical-and-expr
    := equality-expr ("&&" equality-expr)*

equality-expr
    := comparison-expr (("==" | "!=") comparison-expr)*

comparison-expr
    := additive-expr (("<" | "<=" | ">" | ">=") additive-expr)*

additive-expr
    := multiplicative-expr (("+" | "-") multiplicative-expr)*

multiplicative-expr
    := unary-expr (("*" | "/" | "%") unary-expr)*

unary-expr
    := ("+" | "-" | "!") unary-expr
     | postfix-expr

postfix-expr
    := primary-expr
       (("[" expression "]")
       | ("." identifier)
       | ("(" argument-list? ")"))*

argument-list
    := expression ("," expression)*

primary-expr
    := signed-integer-literal
     | "true"
     | "false"
     | byte-literal
     | string-literal
     | regex-literal
     | array-literal
     | identifier
     | "require" "(" expression ")"
     | block-expression
     | if-expression
     | "(" expression ")"

block-expression
    := "{" statement* expression? "}"

signed-integer-literal
    := ("+" | "-")? decimal-integer

byte-literal
    := "'" escaped-byte-or-source-character "'"

array-literal
    := "[" (expression ("," expression)* ","?)? "]"

string-literal
    := '"' escaped-byte-or-source-character* '"'

regex-literal
    := 'r"' testlib-pattern-source* '"'

input-block
    := "input" "{" input-content "}"

input-content
    := (line-input-pattern ";")* token-input-pattern-list?

line-input-pattern
    := token-input-pattern-list?
     | whole-line-value-pattern
     | line-literal

whole-line-value-pattern
    := "line" "(" identifier ")"

token-input-pattern-list
    := token-input-pattern
       ("," token-input-pattern)* ","?

token-input-pattern
    := identifier ("[" expression "]")*
     | token-literal

token-literal
    := "`" escaped-byte-or-source-character+ "`"

line-literal
    := "``" escaped-byte-or-source-character* "``"
```

추가 의미 규칙:

- 프로그램에는 `input` 블록이 최소 하나 있어야 한다.
- 줄 단위 입력 패턴은 현재 0개 이상의 토큰 단위 입력 패턴이다.
- 같은 블록의 토큰 패턴 사이에는 쉼표가 필요하지만 블록 경계에서는
  쉼표 없이 미완성 줄 패턴이 이어질 수 있다.
- 선언과 입력 블록은 소스 순서대로 처리한다.
- 이름은 선언 전에 참조할 수 없다.
- 토큰 단위 입력 패턴은 해당 값에 한 번의 대입을 수행한다.
- 마지막 입력 블록 뒤에서 EOF를 검사한다.
- `Bool`과 `Unit`은 입력 패턴에서 사용할 수 없다.
- `Byte`는 직접 입력할 수 없으며 필요한 경우 `String[1]`을 사용한다.
- expression statement는 세미콜론이 필요하다.
- 블록의 세미콜론 없는 tail expression만 블록의 값을 결정한다.
- `if` 양쪽 분기는 같은 기본 타입 계열로 통합할 수 있어야 한다.
- `var`를 참조하는 refinement expression은 선언 시 현재 결과를
  불변 snapshot으로 저장한다.
- 배열 원소를 참조하는 refinement expression도 선언 시 현재 결과를
  snapshot으로 저장하고 동적 경계·초기화를 Validator에서 검사한다.
- 배열 길이는 선언 시점에 값이 준비되어 있고 정적으로 비음수임을
  증명할 수 있어야 한다.
- 배열 전체를 하나의 입력 패턴으로 읽을 수 없다.
- 배열 리터럴에는 항상 명시적 기대 타입이 필요하며 고정 배열 문맥의
  원소 수는 선언 길이와 같아야 한다.
- 고정 배열과 `Array_v`는 원소 타입이 비교 가능하면 서로 사전식으로
  비교할 수 있다.
- 함수 호출은 실제 인수를 dependent 매개변수와 반환 타입에 대입한
  뒤 정적으로 refinement를 검사한다.
- 일반 expression의 동적 refinement 증명은 허용하지 않으며
  `input`만 선언 타입을 런타임에 검사한다.
- 입력 줄 경계의 동적 불일치는 생성 Validator가 런타임에 검사한다.
- statement 형태의 `if`, `for`, `while` 뒤의 세미콜론은 별도의 빈
  statement로 처리한다.

## 10. 아직 결정하지 않은 사항

- 대상 testlib 버전
- 문자열 문자 집합 제약
- 일반 refinement 제약
- 레코드와 여러 테스트 케이스
- 블록 주석
- 세부 오류와 경고 메시지
- CLI 및 npm 배포 방식
- 탈출 가능한 일급 함수와 클로저 값
- for 이터레이터
