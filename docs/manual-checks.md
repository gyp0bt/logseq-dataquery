# 実機確認（Logseq OG デスクトップ）

準備: `npm install && npm run build` → Logseq の設定 → 詳細 → 開発者モード ON → `t p`（プラグイン）→ Load unpacked plugin → このリポジトリのフォルダを選ぶ。再ビルドしたらプラグインカードの Reload を押す。

## M1 ページ内ビュー
- [ ] ビュー上端のクエリ欄を直接書き換えて Enter（または欄の外をクリック）→ マクロ本文が書き換わりビューが追従する。打っている間に Logseq のショートカット（`t p` など）が暴発しない。誤ったクエリも保存され、赤枠の中の欄でそのまま直せる。
- [ ] `/Data query` を入れる → グラフ全体の property 付きブロックの表が出る。`in here` を足すと同じ親の下だけになる。
- [ ] `{{renderer :dataquery, where type = run | sort gre-thin | plot scatter x=gre-thin y=gre-thick color=seed}}` に書き換える → 散布図と並べ替えた表が出る。数値が数値として並ぶ（10 が 9 より後）。
- [ ] `where combine in (none, mean)` と `where note = "a,b"` が効く（マクロ内のカンマ。ビューは分割後の引数ではなくブロック本文を読む）。
- [ ] `from run | in [[work/nsb]]` が効く（マクロ内のリンク）。重複した run が 1 行にまとまり、値の食い違うセルに ⚠ が付く（マウスを乗せると各値と出典ページ）。表の下に説明文は出ない。
- [ ] `dataquery/types` ページを作り、ページプロパティに `gre-*:: ratio` と `seed:: category` を書く → 1.00 の破線と、セルの緑/赤が出る。
- [ ] 表のリンクと散布図の点をクリック → そのブロックまでスクロールする。
- [ ] Hide labels / Show labels を押す → マクロに `labels=off` が付く/外れる。
- [ ] `where gre-thin <` と打つ → 赤枠に ^ 印とメッセージが出る。
- [ ] run の値を書き換える → 1 秒以内にビューが追従する。
- [ ] ライト/ダークを切り替える → 読める配色のまま。
- [ ] 字の大きさが本文や Logseq 組み込みクエリの表と揃っている（設定で文字サイズを変えると追従する）。
- [ ] 行がアウトラインに書いた順に並ぶ（シャッフルされない）。
- [ ] （別名の試験）config.edn に `:macros {"dataquery" "{{renderer :dataquery, $1}}"}` を足し、`{{dataquery sort gre-thin}}` が描画されるか。動いたら README に載せる。

## M2 専用画面
- [ ] 「Open ↗」でマクロのクエリ入りの画面が開く。Esc・✕・暗い背景のクリックで閉じる。
- [ ] 値チップのチェックを外す、min/max を入れる、条件を追加する → どれもクエリ文字列と件数が書き換わる。
- [ ] クエリを打って Enter → カードが追従する。誤ったクエリは ^ 印つきのメッセージ。
- [ ] Scatter / Bar / Table only、軸の選択、Labels が効く。点をクリックすると画面が閉じてブロックへ飛ぶ。
- [ ] 列見出しクリックで並べ替え（昇順 → 降順 → なし）。型の選択で型ページに `key:: type` が書かれ、表示が変わる。
- [ ] Save to page でマクロが書き換わる。開いている間にマクロのブロックを別途編集してから保存すると「edited after this view opened」エラーになる。
- [ ] Enter を押さずに打ったクエリも Save で保存される。保存後の Revert は保存した内容に戻る。
- [ ] 専用画面もライト/ダークに追従する。
