from pathlib import Path
from typing import BinaryIO

ROOT = Path("/app/uploads")
ROOT.mkdir(parents=True, exist_ok=True)

def save_file(filename: str, fh: BinaryIO) -> str:
    p = ROOT / filename
    with open(p, "wb") as out:
        out.write(fh.read())
    return f"/uploads/{filename}"
