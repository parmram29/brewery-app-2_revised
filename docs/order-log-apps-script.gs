// ============================================================
// Paste this into Google Sheets → Extensions → Apps Script, replacing
// whatever's in the default Code.gs file. Then Deploy → New deployment →
// type "Web app" → Execute as "Me" → Who has access "Anyone" → Deploy.
// Copy the Web app URL it gives you into public/js/config.js as
// SHEET_WEBHOOK_URL.
//
// Every order placed on the site appends one row here: timestamp, order
// number, customer name, phone, items, total, notes.
// ============================================================

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = JSON.parse(e.postData.contents);

  const items = (data.items || [])
    .map(i => `${i.quantity}x ${i.item_name}${i.size ? ' (' + i.size + ')' : ''}`)
    .join(', ');

  sheet.appendRow([
    new Date(),
    data.order_ref || '',
    data.customer_name || '',
    data.phone || '',
    items,
    data.total_ec || '',
    data.notes || '',
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
