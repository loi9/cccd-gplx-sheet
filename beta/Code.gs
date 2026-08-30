const SHEET_NAME = "DATA";
const HEADERS = ["HoVaTen","NgaySinh","GioiTinh","SoCMT","NgayCapCMT","NoiCapCMT","MaDVHC_TT","ChiTiet_TT","MaDVHC_CT","ChiTiet_CT","SoGPLXDaCo","HangGPLXDaCo","NgayTTGPLXDaCo","NgayCapGPLXDaCo","DVCapGPLXDaCo","GhiChu","ClientRecordId","CreatedAt","MaKhoaHoc","DiaChiGoc","DiaChiMoi","Sales"];

function doGet(e) {
  if (e && e.parameter && e.parameter.action === "sales") {
    const sheet = getSalesSheet_();
    const sales = sheet.getLastRow() > 1 ? sheet.getRange(2,1,sheet.getLastRow()-1,1).getDisplayValues().flat().map(String).map(s => s.trim()).filter(Boolean) : [];
    return json_({ok:true,sales:sales});
  }
  return ContentService.createTextOutput(JSON.stringify({ok:true,service:"CCCD-GPLX Sheet"})).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = getSheet_();
    const idColumn = HEADERS.indexOf("ClientRecordId") + 1;
    const ids = sheet.getLastRow() > 1 ? sheet.getRange(2,idColumn,sheet.getLastRow()-1,1).getDisplayValues().flat() : [];
    if (data.ClientRecordId && ids.includes(data.ClientRecordId)) return json_({ok:true,duplicate:true});
    const row = HEADERS.map(key => "'" + String(data[key] ?? ""));
    sheet.appendRow(row);
    return json_({ok:true,row:sheet.getLastRow()});
  } catch (err) {
    return json_({ok:false,error:String(err)});
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  else sheet.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
  sheet.getRange(1,1,1,HEADERS.length).setFontWeight("bold").setBackground("#075f4b").setFontColor("#ffffff");
  sheet.setFrozenRows(1);
  return sheet;
}

function getSalesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("DM_SALES");
  if (!sheet) {
    sheet = ss.insertSheet("DM_SALES");
    sheet.getRange("A1").setValue("Sales").setFontWeight("bold").setBackground("#075f4b").setFontColor("#ffffff");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
