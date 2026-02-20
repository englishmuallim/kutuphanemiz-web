const fs = require('fs');
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');

// --- KİMLİK DOĞRULAMA ---
function getAuthObject() {
  const credentialsPath = path.resolve(process.cwd(), 'credentials.json');
  if (fs.existsSync(credentialsPath)) return require(credentialsPath);
  
  if (!process.env.GOOGLE_PRIVATE_KEY) throw new Error("Private Key yok!");
  const cleanKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/"/g, ''); 
  return { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key: cleanKey };
}

async function getSchoolSheetID(schoolCode, schoolPass) {
  const masterID = process.env.MASTER_SHEET_ID;
  const doc = new GoogleSpreadsheet(masterID);
  await doc.useServiceAccountAuth(getAuthObject());
  await doc.loadInfo();
  
  const sheet = doc.sheetsByTitle['Schools'];
  const rows = await sheet.getRows();
  const school = rows.find(row => row.school_code == schoolCode && row.school_password == schoolPass);
  return school ? school.school_sheet_ID : null;
}

module.exports = {
  getAuthObject,
  getSchoolSheetID
};