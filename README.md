# Data Query for Logseq

Turn blocks with properties into a typed table, scatter plot or bar chart — right where you write them — and explore them in a filter panel.

```
- Seed sweep
  - {{renderer :dataquery, in here | sort score | plot scatter x=score y=loss color=seed}}
  - run-a
    seed:: 0
    score:: 0.96
    loss:: 1.27
  - run-b
    seed:: 1
    score:: 1.10
    loss:: 0.88
```

Type `/Data query` to insert the macro. Keep the comma after `:dataquery`, as with any Logseq renderer.

## Why

Logseq's built-in query tables compare property values as text, so `10 < 9`, `0.20 ≠ 0.2`, and there are no charts. Data Query reads the raw property text, infers a type per key, and compares numbers as numbers. Values are always shown exactly as you wrote them.

## Which blocks become rows

Every block in scope that has at least one property of its own. Blocks with only Logseq's built-in properties (`id`, `collapsed`, `heading`, …) and page-property blocks are skipped.

## Query language

Clauses are separated by `|`; all are optional. An empty query shows every property block in the graph.

| Clause | Meaning |
|---|---|
| `from key` | Rows are the blocks that have `key`; blocks with the same `key` value become one row. The newest journal wins; disagreements are flagged ⚠ (`merge by key` means the same) |
| `in all` · `in here` · `in page` · `in [[Page]]` | Which blocks: the whole graph (default), blocks under the macro's parent, this page, or blocks that link to a page (tags on ancestors count) |
| `where a < 1 and b in (x, y) and c has 16` | Filters. Operators: `= != < <= > >=`, `in (…)`, and `has n` for number lists such as `8/16`. Quote values containing spaces or commas: `note = "a, b"` |
| `sort a desc, b` | Typed sort; blocks missing the key go last |
| `cols a, b, prefix-*` | Table columns |
| `plot scatter x=a y=b [color=c] [labels=off]` | Scatter plot; click a point to jump to its block |
| `plot bar x=c y=a,b` | Bar chart of means per category; groups with 2+ rows show min–max whiskers |

Mistakes are shown in place with a caret under the problem.

## Types

Inferred per key across the whole graph:

- `number` — every value is a number
- `numlist` — numbers joined by `/`, e.g. `8/16`
- `string` — anything else

Override them on the types page (default `dataquery/types`, configurable in the plugin settings), as page properties at the top of the page. `*` matches any text; an exact key beats a pattern, and a longer pattern beats a shorter one.

```
seed:: category
score-*:: ratio
```

- `category` — discrete values (good for `color=` and bar `x=`), even when they look like numbers
- `ratio` — a value divided by its threshold. Charts draw a dashed line at 1.00, a scatter with both axes `ratio` shades the passing corner, and table cells turn green below 1.00 and red at or above

## Panel

Click **Open ↗** on a view to filter with cards, switch chart type and axes, sort by clicking headers and change a column's type. The panel and the query text stay in sync; **Save to page** writes the query back into the macro (it refuses if the block was edited meanwhile).

## Install (development)

```
npm install
npm run build
```

Logseq → Settings → Advanced → Developer mode on → Plugins → Load unpacked plugin → choose this folder.

Works with Logseq 0.10.x (Markdown/file graphs).

## License

MIT
