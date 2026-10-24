# 2. Printing from a list

[← Contents](README.md) · [한국어](../02-mail-merge.md) · Previous: [1. Your first label](01-first-label.md) · Next: [3. Barcodes, QR codes and serial numbers →](03-codes.md)

Turn each row of a spreadsheet into one label. Use it for badges, address labels, certificates: hundreds of labels that differ only in their text.

**Open the example**: on the start screen's **Tutorial** tab (or **F1**), **Printing from a list › Start the walkthrough**.
A simple badge design and a list of 10 attendees open.

## Step 1 — The data table

The **Data** table at the bottom of the window is the list.

- The header holds the **column names** (Name, Affiliation, Title…); each row below it is one label.
- Click a cell to edit it. **＋ Row** and **＋ Column** add more; double-click a column name to rename it.
- Each row has a **print** checkbox and a number of **Copies**. Set copies to 2 for two badges of the same person.

## Step 2 — Bring in your own list

Press **Import (xlsx·csv)**, or simply drop the spreadsheet onto the window.

- xlsx, xls and csv are read. Korean CSV files (CP949) are recognised automatically.
- **The first row must hold the column names.** Merged cells trigger a warning; unmerge them in the original file.
- **Column mapping** links your columns to the names the design uses: `Full name` goes to `Name`, `Organisation` to `Affiliation`, and so on. Change any that are wrong.
- **Mode**: **Replace existing data** or **Append**.

## Step 3 — `{{column name}}` fields

Select the name text box on the canvas and look at **Content · data binding** in the properties panel.

- The content is `{{Name}}`. A column name in double braces is replaced by that row's value when printing.
- Mix it with text: `Dear {{Name}}`, `{{Affiliation}} · {{Title}}`.
- Pick a column from the list next to it to insert `{{column name}}` at the cursor.
- The grey box below shows the **value for the current row**.
- To drop the text box entirely on rows where the value is empty, turn on **Hide when empty** (the Title box in the example).

Objects with a ⛓ mark in the layer list are bound to data.

## Step 4 — Step through the rows

Use **Preview ◀ ▶** above the canvas, or `PageUp`/`PageDown`, to see other people's badges.
Clicking a row in the data table previews it too.

Long names still fit thanks to **shrink to fit**. If they get too small, widen the box or change the minimum size.

## Step 5 — Choose which rows to print

Open **Print · Export** and pick the **Rows**.

| Rows | When |
|---|---|
| Rows checked for printing | The default. Unchecked rows are left out |
| Rows not printed yet | Printing late registrations only |
| Current filter result | Only the people you searched or filtered for in the data table |
| Row range | Printing in batches, such as rows 1–40 |
| Current row only | Reprinting one label |

On a sheet that is partly used, click the first free label under **Start at label** and printing starts there.

## Step 6 — The print record

Printing or exporting stamps the time in each row's **Printed** column.

- Next time, choose **Rows not printed yet** and nobody gets a badge twice.
- Click a Printed cell to set or clear it by hand. **More › Clear print record** clears them all.
- **Export › xlsx (with print record)** in the data bar saves who was printed when.

## More

- **Find duplicates**: **More › Find duplicates…** marks rows with the same name or e-mail.
- **Load from a URL** (experimental): give the import window a CSV or Google Sheets link and it is fetched again on an interval, adding new rows.

---

Next: [3. Barcodes, QR codes and serial numbers →](03-codes.md)
