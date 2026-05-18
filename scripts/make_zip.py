from zipfile import ZipFile, ZIP_DEFLATED
from pathlib import Path
base = Path('../backend').resolve()
out = Path('../backend_fixed.zip').resolve()
if out.exists(): out.unlink()
with ZipFile(out, 'w', compression=ZIP_DEFLATED) as z:
    for p in base.rglob('*'):
        if p.is_file():
            arcname = p.relative_to(base).as_posix()
            z.write(p, arcname)
print('Wrote', out)
