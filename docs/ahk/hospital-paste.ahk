; SH Rad Assistant -- hospital PACS paste helper
;
; The app's Copy button puts "Finding<TAB>Conclusion<TAB>Recommendation" on the
; clipboard. Pasting that directly into one focused text field just inserts a
; literal tab character (or nothing) -- it does not move focus to the next
; field. This script splits the clipboard on tab characters and pastes each
; part in turn, pressing a real Tab key press in between so focus actually
; advances field-to-field in the hospital reporting system.
;
; Each part is pasted via Ctrl+V rather than typed out, so punctuation and
; symbols in the report text are never misread as AHK key syntax.
;
; Usage: run this script (double-click), click into the report's Finding
; field, copy from SH Rad with the Copy button, then press Ctrl+Alt+V.

^!v::
    originalClipboard := Clipboard
    parts := StrSplit(originalClipboard, "`t")
    for index, part in parts
    {
        Clipboard := part
        ClipWait, 1
        Send, ^v
        Sleep, 100
        if (index < parts.MaxIndex())
        {
            Send, {Tab}
            Sleep, 100
        }
    }
    Clipboard := originalClipboard
return
