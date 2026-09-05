# hospital-paste.ahk

SH Rad Assistant의 Copy 버튼은 Finding / Conclusion / Recommendation을 Tab 문자로
구분해서 클립보드에 넣습니다. 그런데 이걸 병원 판독 프로그램의 한 입력창에 그냥
붙여넣기(Ctrl+V) 하면, tab 문자가 다음 입력창으로 커서를 옮겨주는 게 아니라 그냥
탭 공백처럼 한 칸에 다 들어가 버리는 경우가 많습니다. 이 스크립트는 클립보드를
tab 기준으로 나눠서 한 조각씩 붙여넣고, 그 사이사이에 진짜 Tab 키를 눌러줘서
커서가 실제로 다음 입력창으로 넘어가게 해줍니다.

## 설치

1. [AutoHotkey](https://www.autohotkey.com/) 설치 (v1.1, 설치 파일 2MB 정도).
2. 이 폴더의 `hospital-paste.ahk`를 병원 컴퓨터에 다운로드.
3. 더블클릭해서 실행 (트레이에 초록색 아이콘이 뜨면 실행 중).

## 사용법

1. SH Rad Assistant에서 Copy 버튼 클릭.
2. 병원 판독 프로그램에서 Finding 입력창에 커서 놓기.
3. `Ctrl+Alt+V` 누르기 → Finding 붙여넣기 → Tab → Conclusion 붙여넣기 → Tab →
   Recommendation 붙여넣기, 순서로 자동 진행됩니다.

컴퓨터를 켤 때마다 자동으로 실행되게 하려면, 이 `.ahk` 파일의 바로가기를
`시작프로그램` 폴더(`Win+R` → `shell:startup`)에 넣어두면 됩니다.

## 참고

- 판독 프로그램마다 입력창 사이 이동이 Tab이 아닐 수 있습니다 (예: Enter로 이동하는
  프로그램이라면 스크립트의 `Send, {Tab}` 부분을 `Send, {Enter}`로 바꿔야 합니다).
- 붙여넣기 사이 딜레이(100ms)가 너무 짧아서 씹히면 스크립트의 `Sleep, 100` 값을
  늘려보세요.
