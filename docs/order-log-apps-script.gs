// ============================================================
// Paste this into Google Sheets → Extensions → Apps Script, replacing
// whatever's in the default Code.gs file. Then Deploy → New deployment →
// type "Web app" → Execute as "Me" → Who has access "Anyone" → Deploy.
// Copy the Web app URL it gives you into public/js/config.js as
// SHEET_WEBHOOK_URL.
//
// Every order placed on the site appends one row here: timestamp, order
// number, customer name, phone, items, total, notes. Adds a header row
// automatically the first time it runs against an empty sheet, and
// formats the timestamp/total columns so they read as a real date and
// currency instead of plain text.
// ============================================================

const HEADERS = ['Timestamp', 'Order #', 'Customer', 'Phone', 'Items', 'Total (EC$)', 'Notes'];

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = JSON.parse(e.postData.contents);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // Column widths matched to header index: A=Timestamp, B=Order #, ...,
    // E=Items (wider, since it's the longest field), F=Total, G=Notes.
    sheet.setColumnWidths(1, 1, 150);
    sheet.setColumnWidths(5, 1, 260);
  }

  const items = (data.items || [])
    .map(i => `${i.quantity}x ${i.item_name}${i.size ? ' (' + i.size + ')' : ''}`)
    .join(', ');

  const row = sheet.appendRow([
    new Date(),
    data.order_ref || '',
    data.customer_name || '',
    data.phone || '',
    items,
    Number(data.total_ec) || 0,
    data.notes || '',
  ]).getRange(sheet.getLastRow(), 1, 1, HEADERS.length);

  // Column A: real date/time. Column F: currency-formatted number, so it
  // sums correctly if you ever add a total row.
  row.getCell(1, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  row.getCell(1, 6).setNumberFormat('"EC$"#,##0.00');

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
