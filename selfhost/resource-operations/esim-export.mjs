import JSZip from './jszip.cjs';

const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const xml = String.raw;
const escape = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const localTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Singapore', dateStyle: 'short', timeStyle: 'medium' });
const dateText = value => Number.isFinite(Date.parse(value)) ? localTime.format(new Date(value)) : '';
const mib = value => typeof value === 'number' && Number.isFinite(value) ? Math.round(value / 1048576 * 100) / 100 : '';
const cols = ['二维码', '商品名称', 'ICCID', 'eSIM 交易号', '订单号', '状态', '国家 / 地区', '已用 (MiB)', '总量 (MiB)', '激活时间 (UTC+8)', '套餐到期 (UTC+8)', '最晚激活 (UTC+8)', '购买时间 (UTC+8)'];
const widths = [18, 35, 26, 23, 23, 16, 17, 15, 15, 23, 23, 23, 23];
const status = { GOT_RESOURCE: '已交付', IN_USE: '使用中', USED_UP: '已用尽', USED_EXPIRED: '已过期', UNUSED_EXPIRED: '未激活已过期', CANCEL: '已取消', SUSPENDED: '已暂停' };

async function officialQr(value, fetcher) {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://p.qrsim.net' || url.username || url.password) return null;
    const reply = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(12000) });
    if (!reply.ok || !reply.headers.get('content-type')?.startsWith('image/png') || Number(reply.headers.get('content-length')) > 100_000) return null;
    const reader = reply.body.getReader();
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value: bytes } = await reader.read();
      if (done) break;
      size += bytes.length;
      if (size > 100_000) { await reader.cancel(); return null; }
      chunks.push(Buffer.from(bytes));
    }
    const result = Buffer.concat(chunks);
    return result.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? result : null;
  } catch { return null; }
}

function cell(value, row, column) {
  const name = `${String.fromCharCode(65 + column)}${row}`;
  return typeof value === 'number' ? `<c r="${name}"><v>${value}</v></c>` : `<c r="${name}" t="inlineStr"${row === 1 ? ' s="1"' : ''}><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
}

export async function makeEsimWorkbook(profiles, fetcher = fetch) {
  const zip = new JSZip();
  const images = new Array(profiles.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(profiles.length, 10) }, async () => {
    while (cursor < profiles.length) {
      const index = cursor++;
      if (profiles[index].qrCodeUrl) images[index] = await officialQr(profiles[index].qrCodeUrl, fetcher);
    }
  });
  await Promise.all(workers);
  const anchors = [], mediaRelationships = [];
  const rows = profiles.map((item, index) => {
    const row = index + 2;
    const image = images[index];
    if (image) {
      const id = index + 1;
      zip.file(`xl/media/qr${id}.png`, image);
      mediaRelationships.push(`<Relationship Id="rId${id}" Type="${relationships}/image" Target="../media/qr${id}.png"/>`);
      anchors.push(xml`<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>95000</xdr:colOff><xdr:row>${row - 1}</xdr:row><xdr:rowOff>45000</xdr:rowOff></xdr:from><xdr:ext cx="914400" cy="914400"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="eSIM QR ${row - 1}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${id}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`);
    }
    const values = ['', item.packageName, item.iccid, item.esimTranNo, item.orderNo, status[item.esimStatus] || item.esimStatus, item.locationCode, mib(item.orderUsage), mib(item.totalVolume), dateText(item.activateTime), item.expiryKind === 'activation' ? '' : dateText(item.expiredTime), item.expiryKind === 'activation' ? dateText(item.expiredTime) : '', dateText(item.createTime)];
    return `<row r="${row}" ht="80" customHeight="1">${values.map((value, i) => cell(value, row, i)).join('')}</row>`;
  });
  const rels = entries => `<Relationships xmlns="${packageRelationships}">${entries}</Relationships>`;
  zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${anchors.length ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ''}</Types>`);
  zip.file('_rels/.rels', rels(`<Relationship Id="rId1" Type="${relationships}/officeDocument" Target="xl/workbook.xml"/>`));
  zip.file('xl/workbook.xml', `<workbook xmlns="${spreadsheet}" xmlns:r="${relationships}"><sheets><sheet name="eSIM 二维码" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', rels(`<Relationship Id="rId1" Type="${relationships}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relationships}/styles" Target="styles.xml"/>`));
  zip.file('xl/styles.xml', `<styleSheet xmlns="${spreadsheet}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1D3B72"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  const lastColumn = String.fromCharCode(64 + cols.length);
  zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="${spreadsheet}" xmlns:r="${relationships}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData><row r="1" ht="25" customHeight="1">${cols.map((label, i) => cell(label, 1, i)).join('')}</row>${rows.join('')}</sheetData><autoFilter ref="A1:${lastColumn}${profiles.length + 1}"/>${anchors.length ? '<drawing r:id="rId1"/>' : ''}</worksheet>`);
  if (anchors.length) {
    zip.file('xl/worksheets/_rels/sheet1.xml.rels', rels(`<Relationship Id="rId1" Type="${relationships}/drawing" Target="../drawings/drawing1.xml"/>`));
    zip.file('xl/drawings/drawing1.xml', `<xdr:wsDr xmlns:xdr="${drawing}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${relationships}">${anchors.join('')}</xdr:wsDr>`);
    zip.file('xl/drawings/_rels/drawing1.xml.rels', rels(mediaRelationships.join('')));
  }
  return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), embedded: anchors.length };
}
