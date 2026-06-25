import sys, openpyxl
f = sys.argv[1]
maxr = int(sys.argv[2]) if len(sys.argv) > 2 else 16
wb = openpyxl.load_workbook(f, data_only=True, read_only=True)
print("SHEETS:", wb.sheetnames)
for name in wb.sheetnames:
    ws = wb[name]
    print(f"\n===== {name} =====")
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i >= maxr:
            print(f"... (troncato a {maxr} righe)")
            break
        print(i, [("" if c is None else c) for c in row])
