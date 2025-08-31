from pathlib import Path
from typing import BinaryIO, Union

ROOT = Path("/app/uploads")
ROOT.mkdir(parents=True, exist_ok=True)

def save_file(filename: str, fh: Union[BinaryIO, bytes, bytearray]) -> str:
    p = ROOT / filename
    with open(p, "wb") as out:
        if isinstance(fh, (bytes, bytearray)):
            out.write(fh)
        else:
            out.write(fh.read())
    return f"/uploads/{filename}"
