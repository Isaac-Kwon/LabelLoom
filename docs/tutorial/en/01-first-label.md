# 1. Your first label

[← Contents](README.md) · [한국어](../01-first-label.md) · Next: [2. Printing from a list →](02-mail-merge.md)

Put text and shapes on a blank 50×30 mm label, style them and print. It takes about ten minutes.

**Open the example**: on the start screen's **Tutorial** tab (or **F1**), **Your first label › Start the walkthrough**.
The grey text on the label is a **guide object that never prints**. It has a ⊘ mark in the layer list.

## A look around

| Where | Name | What it does |
|---|---|---|
| Top | Toolbar | File menu, undo, object tools (Text, Rectangle, Barcode…), zoom, **Print · Export** |
| Left | Layers · Paper · Design tabs | Object list and order, paper size and label grid, several designs |
| Middle | Canvas | Where you draw and move things |
| Right | Properties panel | Content, font, colour, position and size of the selected object |
| Bottom | Data | The list table (lesson 2) |

## Step 1 — Add a text box

Adding an object always takes two moves: **pick a tool → click or drag in the editing area in the middle**. Pressing the tool button alone adds nothing.

1. Press **Text** (`T`) in the toolbar.
2. Click on the label in the **editing area (canvas) in the middle**. A text box of the default size appears there and you can type right away.
   Press and drag instead to make a box of the size you drag.
3. After placing an object the tool goes back to **Select** (`V`). Press the tool again to add another.

## Step 2 — Style it in the properties panel

With the text box selected, look at the properties panel on the right.

- **Content · data binding**: the text itself. You can also **double-click** the text box on the canvas to edit it.
- **Text**: font, size (pt), bold, alignment, line wrapping, letter and line spacing.
  **Shrink to fit** is on by default: text longer than its box shrinks down to the **Min** size.
- **Position · size (mm)**: exact numbers.

## Step 3 — Add shapes

1. Press **Rectangle** (`R`) or **Line** (`L`) in the toolbar.
2. In the **editing area in the middle**, press and drag diagonally: the rectangle fills what you drag. For a line, drag from its start to its end.
   A plain click gives the default size.
3. Drag the shape to move it, use the corner handles to resize and the rotation handle to turn it.
   Hold `Shift` while dragging to move only horizontally or vertically; `Alt` turns snapping off.
4. If a shape hides the text, drag it lower in the **Layers** list, or right-click it and choose **Send to back**.

## Step 4 — Line things up

- `Shift`+click several objects and the top of the properties panel shows **align** (left, centre, right, top, middle, bottom), **distribute** and **match width / height** buttons.
- Arrow keys move by 0.5 mm, `Shift`+arrow by 5 mm.
- `Ctrl+G` groups objects so they move together.

## Step 5 — Save and undo

- Made a mistake? **Undo** (`Ctrl+Z`), up to 100 steps.
- Your work is **saved in the browser automatically**; close the tab and it is still there.
- To keep a file, use **File › Save** (`Ctrl+S`). It writes a `.labelloom.json` file that **File › Open…** (or dropping it on the window) opens again.

## Step 6 — Choose the paper

The **Paper** tab on the left sets the size of one label, how many fit on a sheet (columns × rows), and the margins and gaps.

- Store-bought sheets (Avery, Formtec and others) are listed by product code under **File › New · templates… › Ready-made label stock**.
- Keep sizes you use often with **Save as my preset**.

## Step 7 — Print

1. Press **Print · Export** (`Ctrl+P`).
2. Choose a **Format**.
   - **Print**: the browser's print window. Sharp vector output; the print window can also "Save as PDF".
   - **PDF**: a file. For vector text in fonts that aren't Latin, embed a TTF font in **File › Fonts…**.
   - **PNG (ZIP)**: one image per label.
3. In the browser's print window, keep the **scale at 100% (actual size)** and the margins at "None" or "Default".

Objects marked **Don't print (guide only)**, like the grey guide text, show on screen but never print.

---

Next: [2. Printing from a list →](02-mail-merge.md)
