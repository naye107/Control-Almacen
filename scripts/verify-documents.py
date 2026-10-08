"""Validate and render fictitious Phase 4 PDFs. Never opens a database."""
import os
import subprocess
from pathlib import Path
from pypdf import PdfReader
from openpyxl import load_workbook

root = Path(__file__).resolve().parent.parent
output = root / "output" / "pdf"
evidence = root / "docs" / "evidencias-fase4-pdf"
evidence.mkdir(parents=True, exist_ok=True)
poppler = Path(os.environ.get("POPPLER_BIN", "")) / ("pdftoppm.exe" if os.name == "nt" else "pdftoppm")
reports = []
for file in sorted(output.glob("*.pdf")):
    reader = PdfReader(file)
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert "AGRÍCOLA JAPURIMA S.A." in text, file.name
    assert "clave privada" not in text.lower(), file.name
    assert "Firma" in text, file.name
    assert len(reader.pages) > 1 if "multipagina" in file.name else len(reader.pages) >= 1
    for i, page in enumerate(reader.pages):
        assert abs(float(page.mediabox.width) - 595.28) < 1
        assert abs(float(page.mediabox.height) - 841.89) < 1
        content = page.extract_text() or ""
        assert f"{i + 1} / {len(reader.pages)}" in content, (file.name, i)
        assert "PEDIDO DE ALMACÉN" in content or "CONSTANCIA DE DESPACHO" in content
    if "multipagina" in file.name:
        assert "Producto 50" in text
        assert sum("Total solicitado" in (p.extract_text() or "") for p in reader.pages) >= 2
    if "despacho-parcial" in file.name:
        assert "0.125" in text
    if "pedido-almacen" in file.name:
        assert "María Núñez & Pérez" in text and "0.125" in text
    (evidence / (file.stem + ".txt")).write_text(text, encoding="utf-8")
    subprocess.run([str(poppler), "-r", "100", "-png", str(file), str(evidence / file.stem)], check=True)
    reports.append(f"PASS {file.name}: {len(reader.pages)} páginas A4, texto, firmas y numeración.")

workbook = load_workbook(output / "reporte-historial.xlsx", data_only=False)
cells = [cell for sheet in workbook for row in sheet for cell in row]
assert not any(cell.data_type == "f" for cell in cells)
assert any(cell.value == 0.125 for cell in cells)
assert any(cell.number_format == "0.######" for cell in cells)
reports.append("PASS XLSX: abierto con openpyxl, 0.125 numérico, formato 6 decimales, sin fórmulas.")
assert len(list(output.glob("*.pdf"))) == 5
result = "\n".join(reports)
(root / "docs" / "pruebas-fase4-documentos.txt").write_text(result + "\n", encoding="utf-8")
print(result)
