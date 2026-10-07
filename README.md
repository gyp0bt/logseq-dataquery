# Data Query for Logseq

Turn blocks with properties into a typed table, scatter plot or bar chart — right where you write them.

```
- Seed sweep
  - {{renderer :DQscatter, #work/nsb x:score y:loss color:seed}}
  - run-a #work/nsb
    seed:: 0
    score:: 0.96
    loss:: 1.27/1.31/1.29
  - run-b #work/nsb
    seed:: 1
    score:: 1.10
    loss:: 0.88
```

Three macros, inserted with `/DQ table`, `/DQ scatter` and `/DQ bar`:

| Macro | Shows | Buttons on the right |
|---|---|---|
| `{{renderer :DQtable, …}}` | table | CSV |
| `{{renderer :DQscatter, …}}` | scatter plot + table | X▾ Y▾ Color▾ ± ▤ ⟲ ⤢ CSV |
| `{{renderer :DQbar, …}}` | bar chart (means, min–max whiskers) + table | X▾ Y▾ ⤢ CSV |

Keep the comma after the macro name, as with any Logseq renderer.

## Why

Logseq's built-in query tables compare property values as text, so `10 < 9`, `0.20 ≠ 0.2`, and there are no charts. Data Query reads the raw property text, infers a type per key, and compares numbers as numbers. Values are always shown exactly as you wrote them.

## Which blocks become rows

Every block in the graph that has at least one property of its own. Blocks with only Logseq's built-in properties (`id`, `collapsed`, `heading`, …) and page-property blocks are skipped.

## Query

Terms are separated by spaces and all must hold. An empty query shows every property block in the graph.

| Term | Meaning | Example |
|---|---|---|
| `#tag` `#[[a b]]` `[[page]]` | Blocks that reference the page (tags on ancestors count) | `#work/nsb` |
| `key op value` | Filter. `op` is `== != < <= > >=` (`=` means `==`) | `seed==0` `gre-interp<0` |
| `name:value` | Setting (below) | `x:gre-thin` `sort:-r2` |
| `key` | Blocks that have the property | `gre-thin` |

- Numeric columns compare as numbers. `key==a,b` means a or b. On a number-list column such as `8/16`, `==16` means "contains 16". `<`, `>` and friends compare the mean of a multi-valued cell.
- Quote values with spaces or commas: `note=="8 cells, seed"`.

| Setting | Meaning | Default |
|---|---|---|
| `x:` `y:` | Axes. A bar chart takes several: `y:a,b` | Scatter: 1st and 2nd numeric column. Bar: x = 1st category/text column, y = 1st numeric column |
| `color:` | Scatter colour groups (one legend entry per group) | the `by:` value if set, else one colour |
| `sort:key` / `sort:-key` | Ascending / descending; clicking a table header cycles it | outline order |
| `by:run` | Blocks with the same `run` become one row; the newest journal wins and disagreeing cells get ⚠ | no merge |
| `labels:on` | Write every point's name on the chart | names on hover |
| `err:band` / `err:off` | How multi-valued cells are drawn (below) | error bars |

Edit the query right in the view: change the line at the top and press Enter to write it back into the macro (Esc cancels). Mistakes are shown under the line with a caret, and nothing is saved until the query is valid. Click blank space in the view to edit the block's raw text, as with Logseq's own renderers.

## Several values in one cell

A property such as `loss:: 1.27/1.31/1.29` (or `1.27, 1.31`) holds several numbers, e.g. one per seed. Charts draw it at the mean and show the min–max:

- **Scatter, `err:bar` (default):** a vertical bar when y has several values, a horizontal one when x does. Single values are plain points.
- **Scatter, `err:band`:** per colour, means joined in x order over a translucent min–max band (like plotly's `fill='tonexty'`).
- **Scatter, `err:off`:** points only.
- **Bar:** each row counts at its mean; whiskers span the rows of a category.
- Hover shows mean, min, max and n. The table shows the text as written and sorts by the mean.

## Buttons and pointer

- **X▾ Y▾ Color▾** pick a column (a bar chart's X takes any column). **±** (error bars) and **▤** (band) are on/off toggles; the lit one is active, pressing it turns both off (`err:off`). These and table-header clicks rewrite the macro, so the view is saved with the page; any other text you wrote in the query stays as it was.
- **⟲** resets zoom and shows hidden traces; **⤢** enlarges the chart. Both are temporary and do not touch the macro.
- **CSV** copies the rows and columns on screen to the clipboard.
- Charts: hover for values (the title is the `by:` value when set), drag to zoom, double-click blank plot area to reset, click a point to highlight its table row.
- Axis handles (scatter): drag the left or right quarter of the x axis to move only that end, the middle to pan; the same for the y axis (bottom end, top end, middle).
- **Ctrl + wheel** over a chart scales markers, lines and text (0.5×–3×). A plain wheel scrolls the page.
- **Double-click** a legend entry, or a marker, line, band or bar of a trace, to hide that trace; its legend entry stays greyed so you can double-click it back.
- Bar charts with many categories keep each category at least 56 px wide and scroll sideways.
- Zoom, scale and hidden traces are temporary but survive the view being redrawn.
- Tables: hold the middle button and drag to scroll sideways (the table moves against the pointer, like a scrollbar thumb). The middle click does not paste on Linux.

The old `{{renderer :dataquery, …}}` macro is no longer drawn; replace it with one of the three above.

## Types

Inferred per key across the whole graph:

- `number` — every value is a number
- `numlist` — numbers joined by `/` or `,`, e.g. `8/16`
- `string` — anything else

Override them on the types page (default `dataquery/types`, configurable in the plugin settings), as page properties at the top of the page. `*` matches any text; an exact key beats a pattern, and a longer pattern beats a shorter one.

```
seed:: category
score-*:: ratio
```

- `category` — discrete values (good for `color:` and bar `x:`), even when they look like numbers
- `ratio` — a value divided by its threshold. Charts draw a dashed line at 1.00, a scatter with both axes `ratio` shades the passing corner, and table cells turn green below 1.00 and red at or above

## Install (development)

```
npm install
npm run build
```

Logseq → Settings → Advanced → Developer mode on → Plugins → Load unpacked plugin → choose this folder.

Works with Logseq 0.10.x (Markdown/file graphs).

## License

MIT
