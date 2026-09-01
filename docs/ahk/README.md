# 병원 컴퓨터 붙여넣기 도우미 (AutoHotkey)

SH Rad Assistant의 "Copy" 버튼은 클립보드에 Finding / Conclusion / Recommendation을
Tab 문자로 구분해서 복사합니다. 하지만 대부분의 프로그램은 붙여넣기(Ctrl+V) 할 때
Tab 문자가 있어도 자동으로 다음 입력칸으로 넘어가지 않습니다 — 그래서 이 작은
자동화 스크립트가 필요합니다.

## 설치 (한 번만)

1. [AutoHotkey](https://www.autohotkey.com/) 사이트에서 설치 파일을 받아 설치합니다
   (v1.1 버전, 약 2MB — 가벼운 자동화 툴이고 관리자 권한 없이도 설치되는 경우가 많습니다).
2. 이 폴더의 `hospital-paste.ahk` 파일을 더블클릭해서 실행합니다.
   - 우측 하단에 "붙여넣기 도우미 실행 중" 알림이 뜨면 정상 동작 중입니다.
3. (선택) 컴퓨터를 켤 때마다 자동 실행되게 하려면, 이 `.ahk` 파일의 바로가기를
   `Win+R` → `shell:startup` 입력 → 열리는 폴더에 붙여넣으세요.

## 사용법

1. SH Rad Assistant에서 판독 작성 후 **Copy** 버튼 클릭
2. 병원 판독 프로그램에서 **Finding 입력칸에 마우스로 클릭**해서 커서를 놓기
3. **Ctrl+Alt+V** 누르기 → Finding 입력 → Tab → Conclusion 입력 → Tab →
   Recommendation 입력까지 자동으로 진행됩니다

## 참고

- 판독 프로그램마다 Tab으로 다음 칸 이동이 안 되는 경우가 있을 수 있습니다 —
  실제 병원 프로그램에서 한 번 테스트해보시고, 만약 Tab 이동이 안 맞으면
  알려주시면 스크립트를 그 프로그램에 맞게 조정할 수 있습니다.
- 단축키를 바꾸고 싶으면 `hospital-paste.ahk` 파일 안의 `^!v::`
  (Ctrl+Alt+V) 부분을 원하는 키 조합으로 수정하면 됩니다.
