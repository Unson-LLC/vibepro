<!-- vibepro-projection story_id=story-vibepro-anonymized-value-cases feature_slug=anonymized-value-cases ownership=generated profile=feature_packet source=.vibepro/spec/story-vibepro-anonymized-value-cases/spec.json source_sha256=df141d95e932469078212ab6a61eedb24cf027c4a27385c455a41a13dece6bd7 renderer=functional_spec_markdown@1 direct_edit=false -->
- Canonical ownership: generated

# Functional Spec

- Story: story-vibepro-anonymized-value-cases
- Status: -
- Clauses: 6

## C-001

日本語VitePressは匿名事例の一覧1ページと詳細4ページを公開する。

### Origin refs

- {"anchor":"実運用の匿名事例","file":"docs/ja/cases/index.md"}
- {"case":"AC-1 AC-5 AVC-1 AVC-5 事例一覧から5件へ移動できる","file":"test/story-vibepro-anonymized-value-cases-ac-1-ac-2-ac-3-ac-4-ac-5-ac-6.test.js"}
- {"index":0,"kind":"acceptance_criteria","text_snippet":"匿名事例の一覧と4件の詳細ページ"}

## C-003

各匿名事例は、観測した問題、実装した変更、確認できた結果、VibeProの寄与、未確認の成果を分けて記載する。

### Origin refs

- {"anchor":"起きていたこと","file":"docs/ja/cases/evidence-gated-answer.md"}
- {"case":"AC-3 AC-4 AVC-3 AVC-4 各事例が事実と主張境界を分ける","file":"test/story-vibepro-anonymized-value-cases-ac-1-ac-2-ac-3-ac-4-ac-5-ac-6.test.js"}
- {"index":2,"kind":"acceptance_criteria","text_snippet":"起きていたこと"}

## C-004

日本語ナビゲーションの事例リンクは /ja/cases/ を指し、一覧から匿名事例4件と既存の /ja/cases/release-safety へ移動できる。各日本語ページの言語切替先には、日本語版を案内する英語ページが存在する。

### Origin refs

- {"anchor":"VibePro case studies","file":"docs/cases/index.md"}
- {"anchor":"{ text: '事例'","file":"docs/.vitepress/config.mjs"}
- {"case":"AC-5 AVC-5 言語切替先に英語案内ページが存在する","file":"test/story-vibepro-anonymized-value-cases-ac-1-ac-2-ac-3-ac-4-ac-5-ac-6.test.js"}
- {"index":4,"kind":"acceptance_criteria","text_snippet":"事例から一覧へ入り"}

## INV-002

匿名事例4ページは、原典の社名、製品名、リポジトリ、PR、コミット、人物、日付、URLを含まず、公開リポジトリに原典を逆引きできる対応表を置かない。

### Origin refs

- {"anchor":"匿名化について","file":"docs/ja/cases/index.md"}
- {"case":"AC-2 AVC-2 匿名事例から識別子と原典リンクを除く","file":"test/story-vibepro-anonymized-value-cases-ac-1-ac-2-ac-3-ac-4-ac-5-ac-6.test.js"}
- {"index":1,"kind":"acceptance_criteria","text_snippet":"社名、製品名、リポジトリ名、PR番号、原典URL、日付、固有の件数を除く"}

## S-001

VitePressの公開ビルドは日本語の事例一覧と5件、言語切替先となる英語案内の一覧と5件を含み、内部の生成Specは含まない。

### Origin refs

- {"anchor":"features/anonymized-value-cases/**","file":"docs/.vitepress/config.mjs"}
- {"case":"AC-6 AVC-6 内部Specを公開ビルドから除外する","file":"test/story-vibepro-anonymized-value-cases-ac-1-ac-2-ac-3-ac-4-ac-5-ac-6.test.js"}
- {"index":5,"kind":"acceptance_criteria","text_snippet":"VitePressビルドが成功する"}

## S-003

読者が匿名事例を開いたとき、ページは確認済みの到達段階を示し、売上、顧客満足度、工数削減、不具合削減率は直接計測していない限り未確認と明記する。

### Origin refs

- {"anchor":"まだ言えないこと","file":"docs/ja/cases/stable-completion-decision.md"}
- {"case":"AC-3 AC-4 AVC-3 AVC-4 各事例が事実と主張境界を分ける","file":"test/story-vibepro-anonymized-value-cases-ac-1-ac-2-ac-3-ac-4-ac-5-ac-6.test.js"}
- {"case":"AC-4 AVC-4 検証、マージ、本番反映の確認境界を固定する","file":"test/story-vibepro-anonymized-value-cases-ac-1-ac-2-ac-3-ac-4-ac-5-ac-6.test.js"}
- {"index":3,"kind":"acceptance_criteria","text_snippet":"顧客成果、売上、工数削減、不具合削減率を推定せず"}

## Diagrams

- none
