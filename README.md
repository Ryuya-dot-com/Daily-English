# Daily English

日本語を見て3秒で英語を声に出す、自己学習用のWebアプリです。

公開先: **https://ryuya-dot-com.github.io/Daily-English/**

## 使い方

1. 練習するsectionと出題順（掲載順／ランダム）を選びます。
2. 「練習を始める」を押すと、音声の準備後に日本語が表示され、3秒のタイマーが始まります。
3. バーがなくなると、英文を表示して模範音声を再生します。
4. 「もう一度聞く」または「次へ」で進めます。「自動で次へ」を有効にすると、音声終了の2秒後に次の文へ進みます。

一時停止・再開に対応しています。別のタブやアプリへ切り替えると自動的に一時停止します。答えの再生中に停止した場合、再開時は音声の最初から再生します。録音・採点・学習履歴の保存は行いません。音声が出ないときは端末の音量を確認し、「もう一度聞く」を押してください。

## 構成

- `docs/`: GitHub Pagesで公開するHTML・CSS・JavaScript、教材JSON、MP3音声
- `Sentences/`: 教材のCSV（このフォルダの全CSVをまとめて読み込みます）
- `scripts/build.py`: CSV検証・JSON作成・音声生成
- `tests/`: タイマーや画面遷移、教材追加の検証

ブラウザ側の外部ライブラリ、APIキー、バックエンドは不要です。音声生成にはPython標準ライブラリからmacOSのローカル音声合成 `say` と `ffmpeg` を呼び出します。初期設定は米国英語のSamantha、175 words/minです。生成時も外部の音声合成サービスには送信しません。元の教材音声（Track MP3）は使用していません。

## 教材を追加・変更する

`Sentences/` のCSVを編集するか、新しいCSVを追加してください。必須列は以下です。

```csv
id,section,section_title,japanese,english
S078,05,昼休み,お昼にしよう。,Let's have lunch.
```

`id` は全CSVを通して一意の半角英数字・ハイフン・アンダースコアにしてください。同じ `section` の行は同じ場面にまとまり、`section_title` も統一する必要があります。既存CSVの `track`・`page` は保持できます。`note` は任意で、値があれば答えの下に表示します。UTF-8（BOMありも可）に対応し、カンマや改行を含むセルはCSVの引用符で囲んでください。

macOSでPython 3とffmpegを用意し、このリポジトリ内で実行します。

```sh
python3 scripts/build.py
python3 scripts/build.py --check
```

新しいsectionは自動的に選択画面へ追加されます。音声は英文・声・速度から決まるファイル名で保存し、既存の音声は再利用します。英文が変われば新しい音声を作るため、古いキャッシュとの取り違えを防ぎます。音声生成に失敗したときはJSONを更新せず、原因を直して再実行できます。削除した文の古い音声は自動削除しません。

声や速度を変更する場合は、生成とチェックの両方に同じ値を指定します。

```sh
python3 scripts/build.py --voice Samantha --rate 175
python3 scripts/build.py --check --voice Samantha --rate 175
```

更新したCSV、`docs/data.json`、追加のMP3を一緒にコミットし、`main`へpushするとGitHub Pagesへ反映されます。リポジトリ外にある元CSVを編集した場合は、先に `Sentences/` へコピーしてください。

## ローカルで開く

```sh
python3 -m http.server 8000 --directory docs
```

http://localhost:8000 を開きます。JSONと音声を取得するため、HTMLファイルの直接オープン（`file://`）では動作しません。

## 検証

```sh
python3 scripts/build.py --check
python3 -m unittest discover -s tests
node --check docs/app.js
node tests/app.test.cjs
```

JavaScriptの検証はNode.jsの標準機能で時計・音声・DOMを模擬し、3秒前の答え非表示、一時停止、音声終了後の自動送り、再生し直し、読み込み失敗時の再試行、画面切替後に届く古い応答、セッション完了を確認します。実機のブラウザ・音声出力の確認は別途必要です。

## GitHub Pages設定

リポジトリの **Settings → Pages → Build and deployment** を以下に設定します。

- Source: **Deploy from a branch**
- Branch: **main**
- Folder: **/docs**

`docs/` 内だけを公開します。すべて相対パスなので、GitHub Pagesの `/Daily-English/` 配下でも動作します。
