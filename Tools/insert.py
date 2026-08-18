import sys, io

path, anchor, payload_path = sys.argv[1], sys.argv[2], sys.argv[3]
with io.open(path, encoding="utf-8") as f:
    src = f.read()
with io.open(payload_path, encoding="utf-8") as f:
    payload = f.read()

if anchor not in src:
    sys.exit("anchor not found: %r" % anchor)
if src.count(anchor) != 1:
    sys.exit("anchor not unique (%d): %r" % (src.count(anchor), anchor))

src = src.replace(anchor, payload + anchor)
with io.open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("inserted %d chars into %s" % (len(payload), path))
