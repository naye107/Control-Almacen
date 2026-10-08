(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.JapurimaXlsx=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function escapeXml(value) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xlsxColumnName(index) {
  let name = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - remainder) / 26);
  }
  return name;
}

function xlsxText(value, style = 0) {
  return { type: "string", value, style };
}

function xlsxNumber(value, precision = 2) {
  const number = Number(value || 0);
  return {
    type: "number",
    value: Number((Number.isFinite(number) ? number : 0).toFixed(precision)),
    style: 1
  };
}

function xlsxCellXml(cell, rowIndex, columnIndex) {
  const value = cell && typeof cell === "object" && "value" in cell ? cell.value : cell;
  const type = cell && typeof cell === "object" && cell.type ? cell.type : "string";
  const style = cell && typeof cell === "object" && cell.style ? cell.style : 0;
  const reference = `${xlsxColumnName(columnIndex + 1)}${rowIndex + 1}`;
  const styleAttribute = style ? ` s="${style}"` : "";

  if (value === "" || value === null || value === undefined) {
    return `<c r="${reference}"${styleAttribute}/>`;
  }

  if (type === "number") {
    return `<c r="${reference}" s="${style || 1}"><v>${value}</v></c>`;
  }

  const text = String(value);
  const preserveSpace = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
  return `<c r="${reference}" t="inlineStr"${styleAttribute}><is><t${preserveSpace}>${escapeXml(text)}</t></is></c>`;
}

function buildWorksheetXml(rows) {
  const maxColumns = Math.max(1, ...rows.map((row) => row.length));
  const lastCell = `${xlsxColumnName(maxColumns)}${Math.max(rows.length, 1)}`;
  const columnWidths = [26, 26, 18, 22, 12, 12, 12, 12, 18, 12, 16];
  const columns = columnWidths.map((width, index) => {
    const column = index + 1;
    return `<col min="${column}" max="${column}" width="${width}" customWidth="1"/>`;
  }).join("");
  const sheetRows = rows.map((row, rowIndex) => {
    return `<row r="${rowIndex + 1}">${row.map((cell, columnIndex) => xlsxCellXml(cell, rowIndex, columnIndex)).join("")}</row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:${lastCell}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${columns}</cols>
  <sheetData>${sheetRows}</sheetData>
</worksheet>`;
}

function buildWorkbookXml(sheetName) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

function buildXlsxStylesXml(precision = 2) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="${precision ? '0.'+'#'.repeat(precision) : '0'}"/></numFmts>
  <fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF3ED"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9E0D8"/></left><right style="thin"><color rgb="FFD9E0D8"/></right><top style="thin"><color rgb="FFD9E0D8"/></top><bottom style="thin"><color rgb="FFD9E0D8"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function crc32(bytes) {
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  }));
  let crc = 0xffffffff;
  bytes.forEach((byte) => {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });
  return (crc ^ 0xffffffff) >>> 0;
}

function pushUint16(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushUint32(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function getDosDateTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function createZipBlob(files, type) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  const records = [];
  const modified = getDosDateTime(new Date());
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    const crc = crc32(dataBytes);
    const header = [];
    pushUint32(header, 0x04034b50);
    pushUint16(header, 20);
    pushUint16(header, 0);
    pushUint16(header, 0);
    pushUint16(header, modified.time);
    pushUint16(header, modified.date);
    pushUint32(header, crc);
    pushUint32(header, dataBytes.length);
    pushUint32(header, dataBytes.length);
    pushUint16(header, nameBytes.length);
    pushUint16(header, 0);
    localParts.push(new Uint8Array(header), nameBytes, dataBytes);
    records.push({ nameBytes, crc, size: dataBytes.length, offset });
    offset += header.length + nameBytes.length + dataBytes.length;
  });

  const centralOffset = offset;
  let centralSize = 0;
  records.forEach((record) => {
    const header = [];
    pushUint32(header, 0x02014b50);
    pushUint16(header, 20);
    pushUint16(header, 20);
    pushUint16(header, 0);
    pushUint16(header, 0);
    pushUint16(header, modified.time);
    pushUint16(header, modified.date);
    pushUint32(header, record.crc);
    pushUint32(header, record.size);
    pushUint32(header, record.size);
    pushUint16(header, record.nameBytes.length);
    pushUint16(header, 0);
    pushUint16(header, 0);
    pushUint16(header, 0);
    pushUint16(header, 0);
    pushUint32(header, 0);
    pushUint32(header, record.offset);
    centralParts.push(new Uint8Array(header), record.nameBytes);
    centralSize += header.length + record.nameBytes.length;
  });

  const end = [];
  pushUint32(end, 0x06054b50);
  pushUint16(end, 0);
  pushUint16(end, 0);
  pushUint16(end, records.length);
  pushUint16(end, records.length);
  pushUint32(end, centralSize);
  pushUint32(end, centralOffset);
  pushUint16(end, 0);

  return new Blob([...localParts, ...centralParts, new Uint8Array(end)], { type });
}

function createXlsxBlob(rows, sheetName = "Existencias", precision = 2) {
  const safeSheetName = String(sheetName || "Hoja1").replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Hoja1";
  const createdAt = new Date().toISOString();
  const files = [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`
    },
    {
      name: "docProps/app.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>JAPURIMA</Application></Properties>`
    },
    {
      name: "docProps/core.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>JAPURIMA</dc:creator><cp:lastModifiedBy>JAPURIMA</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified></cp:coreProperties>`
    },
    {
      name: "xl/workbook.xml",
      content: buildWorkbookXml(safeSheetName)
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    },
    {
      name: "xl/styles.xml",
      content: buildXlsxStylesXml(precision)
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: buildWorksheetXml(rows)
    }
  ];

  return createZipBlob(files, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}


return {createXlsxBlob,xlsxText,xlsxNumber};
});
