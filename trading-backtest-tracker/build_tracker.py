"""Build the themed trading backtest tracker template.

Layout is deliberately compact and uses NO frozen panes: Google Sheets refuses
to scroll at all when the frozen region is taller than the viewport, which
breaks the sheet on small screens (Chromebooks, tablets).
"""

import os

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule

wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Backtest Tracker"

# ---- Theme colors ----
NAVY = "1B2A4A"
TEAL = "0F766E"
GOLD = "C9A227"
LIGHT_ROW = "F4F6F8"
WHITE = "FFFFFF"
DARK_TEXT = "1B2A4A"
MUTED = "6B7280"
BORDER_COLOR = "D9DEE4"

FONT_NAME = "Calibri"

thin = Side(style="thin", color=BORDER_COLOR)
border_all = Border(left=thin, right=thin, top=thin, bottom=thin)

CONF_ROWS = 10
TRADE_ROWS = 50


def set_row_height(row, height):
    ws.row_dimensions[row].height = height


def banner(row, text, fill, size, color=WHITE, italic=False, height=24, indent=1,
           align="left"):
    """Write a full-width merged section banner across A:D."""
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=4)
    cell = ws.cell(row=row, column=1, value=text)
    cell.font = Font(name=FONT_NAME, size=size, bold=not italic, italic=italic,
                     color=color)
    if fill:
        cell.fill = PatternFill("solid", fgColor=fill)
    cell.alignment = Alignment(horizontal=align, vertical="center", indent=indent)
    set_row_height(row, height)
    return cell


# Narrow enough that all four columns fit a small laptop screen without
# horizontal scrolling.
for col, width in (("A", 14), ("B", 40), ("C", 18), ("D", 18)):
    ws.column_dimensions[col].width = width

# ---- Row 1: title ----
banner(1, "TRADING STRATEGY BACKTEST TRACKER", NAVY, 14, height=30,
       align="center", indent=0)

# ---- Confluence checklist ----
banner(2, "CONFLUENCE CHECKLIST", TEAL, 11, height=22)

conf_header = 3
ws.merge_cells(start_row=conf_header, start_column=3, end_row=conf_header, end_column=4)
for idx, text in enumerate(["#", "Confluence Factor", "Description / Notes"], start=1):
    cell = ws.cell(row=conf_header, column=idx, value=text)
    cell.font = Font(name=FONT_NAME, size=10, bold=True, color=WHITE)
    cell.fill = PatternFill("solid", fgColor=GOLD)
    cell.alignment = Alignment(horizontal="center", vertical="center")
    cell.border = border_all
ws.cell(row=conf_header, column=4).border = border_all
set_row_height(conf_header, 18)

conf_start = conf_header + 1
for i in range(CONF_ROWS):
    r = conf_start + i
    ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=4)
    shade = WHITE if i % 2 == 0 else LIGHT_ROW
    for col in range(1, 5):
        cell = ws.cell(row=r, column=col)
        cell.fill = PatternFill("solid", fgColor=shade)
        cell.border = border_all
        cell.font = Font(name=FONT_NAME, size=10, color=DARK_TEXT)
    num = ws.cell(row=r, column=1, value=i + 1)
    num.alignment = Alignment(horizontal="center", vertical="center")
    set_row_height(r, 17)

conf_end = conf_start + CONF_ROWS - 1

# ---- Backtest trade log ----
spacer1 = conf_end + 1
set_row_height(spacer1, 8)

banner(spacer1 + 1, "BACKTEST TRADE LOG", TEAL, 11, height=22)

table_header = spacer1 + 2
for idx, text in enumerate(
    ["Stock", "Reasoning for Trade Entry", "Timeframe(s) Used", "Result"], start=1
):
    cell = ws.cell(row=table_header, column=idx, value=text)
    cell.font = Font(name=FONT_NAME, size=10, bold=True, color=WHITE)
    cell.fill = PatternFill("solid", fgColor=NAVY)
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    cell.border = border_all
set_row_height(table_header, 20)

data_start = table_header + 1
data_end = data_start + TRADE_ROWS - 1

dv = DataValidation(type="list", formula1='"Success,Fail"', allow_blank=True,
                    showDropDown=False)
ws.add_data_validation(dv)

for i in range(TRADE_ROWS):
    r = data_start + i
    shade = WHITE if i % 2 == 0 else LIGHT_ROW
    for col in range(1, 5):
        cell = ws.cell(row=r, column=col)
        cell.fill = PatternFill("solid", fgColor=shade)
        cell.border = border_all
        cell.font = Font(name=FONT_NAME, size=10, color=DARK_TEXT)
        cell.alignment = Alignment(
            horizontal="left" if col == 2 else "center",
            vertical="center",
            wrap_text=(col == 2),
        )
    dv.add(ws.cell(row=r, column=4))
    set_row_height(r, 17)

# Rows ship blank as a template; these rules color the Result cell once it's filled in.
ws.conditional_formatting.add(
    f"D{data_start}:D{data_end}",
    CellIsRule(operator="equal", formula=['"Success"'],
               fill=PatternFill("solid", fgColor="D1FAE5"),
               font=Font(name=FONT_NAME, size=10, color="065F46", bold=True)),
)
ws.conditional_formatting.add(
    f"D{data_start}:D{data_end}",
    CellIsRule(operator="equal", formula=['"Fail"'],
               fill=PatternFill("solid", fgColor="FEE2E2"),
               font=Font(name=FONT_NAME, size=10, color="991B1B", bold=True)),
)

# ---- Summary stats ----
spacer2 = data_end + 1
set_row_height(spacer2, 8)

banner(spacer2 + 1, "SUMMARY STATS", GOLD, 11, height=22)

stats_start = spacer2 + 2
rng = f"D{data_start}:D{data_end}"
stats = [
    ("Total Trades Logged",
     f'=COUNTIF({rng},"Success")+COUNTIF({rng},"Fail")', None),
    ("Wins", f'=COUNTIF({rng},"Success")', None),
    ("Losses", f'=COUNTIF({rng},"Fail")', None),
    ("Win Rate", f"=IFERROR(C{stats_start + 1}/C{stats_start}, 0)", "0.0%"),
]

for i, (label, formula, fmt) in enumerate(stats):
    r = stats_start + i
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
    lbl = ws.cell(row=r, column=1, value=label)
    lbl.font = Font(name=FONT_NAME, size=10, bold=True, color=DARK_TEXT)
    lbl.fill = PatternFill("solid", fgColor=LIGHT_ROW)
    lbl.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    lbl.border = border_all
    ws.cell(row=r, column=2).fill = PatternFill("solid", fgColor=LIGHT_ROW)
    ws.cell(row=r, column=2).border = border_all

    ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=4)
    val = ws.cell(row=r, column=3, value=formula)
    val.font = Font(name=FONT_NAME, size=10, bold=True, color=DARK_TEXT)
    val.fill = PatternFill("solid", fgColor=WHITE)
    val.alignment = Alignment(horizontal="center", vertical="center")
    val.border = border_all
    if fmt:
        val.number_format = fmt
    ws.cell(row=r, column=4).border = border_all
    set_row_height(r, 17)

# No freeze_panes on purpose - see module docstring.
ws.freeze_panes = None
ws.sheet_view.showGridLines = False

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "Trading_Backtest_Tracker.xlsx")
wb.save(OUT)
print("saved", OUT)
print(f"confluence {conf_start}-{conf_end} | trades {data_start}-{data_end} "
      f"| stats {stats_start}-{stats_start + 3} | last row {stats_start + 3}")
