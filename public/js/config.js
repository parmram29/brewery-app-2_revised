// ============================================================
// Site-wide config that used to live in server environment variables.
// Now that the customer-facing site has no backend calls left for
// ordering, these are just constants shipped with the code — edit and
// redeploy rather than an env var somewhere else.
// ============================================================

// Digits only, country code first, no + or spaces (e.g. "14735369931").
export const WHATSAPP_NUMBER = '14735369931';

// Paste the URL you get from deploying the Google Apps Script as a Web App
// (Extensions > Apps Script > Deploy > New deployment > Web app, "Anyone"
// access). Leave blank to skip order logging entirely — the WhatsApp
// message still works either way, this only adds the spreadsheet record.
export const SHEET_WEBHOOK_URL = '';
