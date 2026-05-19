---
story_id: story-vibepro-gesture-interaction-contract
title: ジェスチャー操作品質をVibePro診断で検出する
view: dev
period: 2026-05
architecture_docs:
  reason: UI診断の検査粒度拡張であり、既存Flow Design/Component Style/Playwright verificationの境界に追加する
---

# Story: ジェスチャー操作品質をVibePro診断で検出する

## 背景

VibeProはクリック可能UI、API契約、UI style、flow上の一般的な不整合を検出できる。
一方で、map・carousel・drag・touchのような実操作ベースのUX品質は検出粒度が不足している。

実際に、以下のような問題を既存診断で拾えなかった。

- `touch-action: pan-x pan-y pinch-zoom` がcarouselとmap操作を曖昧にする
- mobile drag stateを取得しているのにclick suppressionに使っていない
- visual card sizeではなくhit areaが不足している
- map overlayがpointer/touchを奪う
- markerのcontrast/collision/zIndexが地図操作感に影響する
- スワイプしたつもりがタップ扱いになる

## 方針

- `gesture_interaction` checkをUI系診断に追加する。
- 静的診断ではtouch-action、overlay pointer-events、drag/tap state接続、carousel hit area/snap/threshold、map marker layeringを検出する。
- Playwright flow verificationではdrag/touch操作、URL不変、scrollLeft変化、elementFromPoint確認をstepとして記録できるようにする。
- 静的検出は原則 `needs_review` とし、実操作probeで誤遷移やscroll不能が出た場合にblock級証跡として扱う。

## 受け入れ基準

- [x] `vibepro check ui/all/launch-readiness` にGesture Interactionが出る
- [x] carousel/map/touch/drag関連の静的リスクが`check.json`に残る
- [x] drag stateがclick suppressionに接続されていない候補を検出できる
- [x] map overlayがpointer/touchを奪う候補を検出できる
- [x] markerのcollision/zIndex/contrast不足候補を検出できる
- [x] Playwright probeでdrag後のURL不変、scrollLeft変化、hit targetを確認できる
