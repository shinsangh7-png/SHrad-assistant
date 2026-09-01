; SH Rad Assistant - 병원 판독 프로그램 붙여넣기 도우미
;
; SH Rad Assistant에서 "Copy" 버튼을 누르면 클립보드에
;   Finding<TAB>Conclusion<TAB>Recommendation
; 형식으로 복사됩니다. 이 스크립트를 실행해두고, 병원 판독 프로그램의
; Finding 입력칸에 커서를 놓은 뒤 Ctrl+Alt+V 를 누르면
; Finding 입력 -> Tab -> Conclusion 입력 -> Tab -> Recommendation 입력
; 순서로 자동으로 타이핑됩니다.
;
; {Text} 모드로 전송하므로 판독문에 +, ^, ! 같은 특수문자가 있어도
; 단축키로 오인식되지 않고 그대로 입력됩니다.

#SingleInstance Force
TrayTip, SH Rad Assistant, 붙여넣기 도우미 실행 중 (Ctrl+Alt+V), 3

^!v::
    content := Clipboard
    parts := StrSplit(content, "`t")
    total := parts.MaxIndex()
    Loop, %total%
    {
        SendInput, {Text}%parts[A_Index]%
        if (A_Index < total)
            SendInput, {Tab}
    }
return
