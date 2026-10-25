# 4. Running an event

[← Contents](README.md) · [한국어](../04-event.md) · Previous: [3. Barcodes, QR codes and serial numbers](03-codes.md)

Prepare badges for a conference or event, and reprint them at the door. Lesson 2 (Printing from a list) makes this one easier to follow.

**Open the example**: on the start screen's **Tutorial** tab (or **F1**), **Running an event › Start the walkthrough**.
A conference badge and 10 attendees open. There are two designs: **Standard badge** and **Speaker badge**.

## Step 1 — Conditional styles

Select the coloured band at the top or bottom of the badge and open **Conditional style** at the bottom of the properties panel.

- A rule reads like "if **Role** equals **Speaker** → colour red".
- Conditions: equals, not equal, contains, is empty, is not empty, contains Hangul, Latin only, length >.
- What a rule can change: colour, size, content, hidden.
- **＋** adds a rule. Rules apply from the top down.

In the example each role (Speaker, Chair, Student, Staff) gets its own band colour, and the name box has a rule that makes Latin-only names smaller.
Objects with a ◆ mark in the layer list carry rules.

## Step 2 — Check by stepping through rows

Step through the rows with **◀ ▶** above the canvas. The band colour follows the role, and speaker rows show "→ this row uses "Speaker badge"".

## Step 3 — Design rules

Open the **Design** tab on the left.

- A project can hold several designs. The top one is the **Default**.
- **Design rules**: "Role = Speaker → Speaker badge". Rows that match no rule use the default design.
- When printing, each row gets its design, all in one run.

Use one design with conditional styles when only colours change; split into designs when the layout differs (a photo or talk title for speakers, for instance).

## Step 4 — Printer alignment (once, before the event)

Printers are often off by a millimetre or two. Correct it before printing on label sheets.

1. Open **File › Printer alignment…**.
2. Print the **Alignment test page** on plain paper, then hold it over a label sheet or measure it with a ruler.
3. If the print lands right / low, enter a **negative** X / Y offset; if it lands left / high, a **positive** one. If the 50 mm scale measures differently, adjust the scale.
4. The correction is saved in the project and applies to printing and PDF.

## Step 5 — On-site reprint and registration

Open **On-site reprint** in the toolbar.

- **Reprint**: search by name, affiliation or ID and press **Print** for that one badge.
  Print either **One label-size page (label printer)** or **A chosen label on the current sheet**.
- **On-site registration**: for walk-ins, fill in the fields below and press **Register and print**. They are added to the list and printed straight away.
- Printed rows get a print record, so they are skipped when you later print **Rows not printed yet**.

## Step 6 — Quick print

**Quick print** is a screen with no editor: **type the values → preview → print**.

- The fields come from the design's `{{column name}}`s.
- Print one at a time, or **Add to list** and print them together.
- Leave this screen open on the registration desk PC and nobody changes the design by accident.
- Add `?quick` to the address (for example `https://isaac-kwon.github.io/LabelLoom/?quick`) to start on the quick print screen, then open a saved `.labelloom.json` template there.

## Pasting a list

You can also bring in a list through the clipboard instead of a file. Copy a range from Excel or Google Sheets, header row included, or press the copy button of your conference management site, then press **Ctrl+V** (**⌘V** on a Mac) in the **Import (xlsx·csv)** window, or press **Paste from clipboard**. The button may make the browser ask for permission to read the clipboard; if you did not allow it, or opened `index.html` as a file, use Ctrl+V instead. Pasted content is read only inside the browser and is not sent anywhere. Tab- or comma-separated text is read as a table and you get the same column mapping screen as for a file. When the list changes and you paste it again, choose **Append** and keep a **Key column** (ID by default): people already in the table only get their values updated (print checks and print history stay) and only new registrations are added at the end. Pasted data is not refreshed automatically the way a URL is.

## Event-day checklist

- [ ] Import the final list and run **More › Find duplicates…**
- [ ] Printer alignment, one test print
- [ ] Bulk print with **Print · Export › Rows: Rows checked for printing**
- [ ] At the door use **On-site reprint**; afterwards print the rest with **Rows not printed yet**
- [ ] When done, **File › Save** and **Export › xlsx (with print record)** to keep the record

---

[← Back to contents](README.md)
