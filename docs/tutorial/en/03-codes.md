# 3. Barcodes, QR codes and serial numbers

[← Contents](README.md) · [한국어](../03-codes.md) · Previous: [2. Printing from a list](02-mail-merge.md) · Next: [4. Running an event →](04-event.md)

Add barcodes and QR codes, and give every label its own number and date.

**Open the example**: on the start screen's **Tutorial** tab (or **F1**), **Barcodes, QR codes and serial numbers › Start the walkthrough**.
An asset tag and a list of 12 assets open. The barcode and the QR code both hold `{{Asset no.}}`.

## Step 1 — Choose a barcode type

Select the barcode on the canvas and look at the **Barcode** section of the properties panel.

- **Type**: pick the symbology your scanner or partner expects.

  | Symbology | Typical use |
  |---|---|
  | Code128 | In-house IDs, shipping. Any letters and digits (the default) |
  | EAN-13 / UPC-A | Retail products. 12–13 digits |
  | GS1-128 | Logistics labels with expiry dates and lot numbers |
  | Code39, ITF, Codabar … | When existing equipment only reads that one |

- A value that doesn't fit the symbology (letters in an EAN-13, say) shows a warning, and that code prints blank.
- On small labels you get a warning when the bars get too thin for scanners. Widen the barcode or shorten the value.
- **Show text** turns the human-readable digits under the bars on or off.

## Step 2 — Add a QR code

1. Pick **QR code** (`Q`) in the toolbar and place it in an empty spot.
2. In **QR / 2D code**, choose the type (QR, Data Matrix, PDF417 …) and the **Error correction** level.
   With a **Logo** in the middle, raise error correction to Q or H.
3. The content can be a URL, contact details, Wi‑Fi settings or any `{{column name}}`.

## Step 3 — Fields

The **Field** list next to the content box inserts values worked out at print time.

| Field | Result |
|---|---|
| `{{#seq}}` | 1, 2, 3 … in print order (the start number is under **Serial number** in the **Design** tab) |
| `{{#seq:0000}}` | Zero-padded: 0001, 0002 … |
| `{{#row}}` | The data row number |
| `{{@date:YYYY-MM-DD}}` | The date of printing. Other formats work too: `DD/MM/YYYY`, `YY.MM.DD` |
| `{{@time:HH:mm}}` | The time of printing |
| `{{^GS}}` | The GS separator for GS1 barcodes |

Example: with barcode content `IT-{{#seq:0000}}`, the labels print IT-0001, IT-0002 and so on.

## Step 4 — A serial number column

You don't need a list to print numbered labels.

1. Press **Serial numbers** in the data bar.
2. Set **Column name**, **Start**, **Step**, **Digits**, **Count**, **Prefix** and **Suffix**.
   Example: prefix `A-`, start 1, digits 3, count 100 → A-001 … A-100
3. **Apply** adds a number column to the data table.
4. Put `{{that column name}}` in a barcode or text box and every label gets its own number.

The difference from `{{#seq}}`: a serial number **column** keeps its values in the table, so you can export them or reprint a particular number. `{{#seq}}` needs no table and simply counts in print order.

---

Next: [4. Running an event →](04-event.md)
