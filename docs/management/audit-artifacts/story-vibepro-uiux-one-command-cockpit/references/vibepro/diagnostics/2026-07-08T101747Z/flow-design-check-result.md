# Flow Design Check

| 項目 | 内容 |
|------|------|
| Run ID | 2026-07-08T101747Z |
| Status | block |
| Profile | generic |
| UI走査ファイル | 0件 |
| Interaction | 0件 |
| Silent noop | 0件 |
| Selection side effect | 0件 |
| Question dead end | 0件 |
| Dead UI state | 0件 |
| Interactive contract | 0件 |
| Value alignment | 1件 |

## Silent noop

- なし

## Selection side effect

- なし

## Question dead end

- なし

## Dead UI state

- なし

## Interactive contract

- なし

## Value alignment

- -:- ui_story_without_code_scan severity=Critical gate_effect=block UI Storyとして扱うべきStoryだが、flow-designが走査できるUIコードが0件だった。

## Runtime probe plan

- uiux-cockpit-static: UI/UX cockpit static artifact
