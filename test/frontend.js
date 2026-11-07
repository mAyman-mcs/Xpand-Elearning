function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  
  var studentID = 'Student';
  var email = '';
  var mobile = '';
  var portal = '';
  var override = false;
  
  if (e && e.parameter) {
    if (e.parameter.studentID) { studentID = e.parameter.studentID; }
    if (e.parameter.email) { email = e.parameter.email; }
    if (e.parameter.mobile) { mobile = e.parameter.mobile; }
    if (e.parameter.portal) { portal = e.parameter.portal; }
    if (e.parameter.override === 'true' || e.parameter.override === '1') { override = true; }
  }
  
  var submitted = false;
  if (studentID !== 'Student' && !override) {
    submitted = checkIfStudentSubmitted(studentID);
  }
  
  template.studentID = studentID;
  template.email = email;
  template.mobile = mobile;
  template.portal = portal;
  template.alreadySubmitted = submitted;
  
  var output = template.evaluate();
  output.setTitle('Network Fundamentals Assessment - Xpand CS Academy');
  output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  output.addMetaTag('viewport', 'width=device-width, initial-scale=1');
  
  return output;
}

function checkIfStudentSubmitted(studentID) {
  try {
    var ss = SpreadsheetApp.openById("1VGDOGKOtYrvSMKXuVcSAQwFMfffXHvX3Reoh-EjfR6k");
    var sheet = ss.getSheetByName("Network_Fund_Submissions");
    if (!sheet) { return false; }
    
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim() === String(studentID).trim()) {
        return true;
      }
    }
  } catch (err) {
    console.error(err);
  }
  return false;
}

function processExamSubmission(submissionData) {
  try {
    var ss = SpreadsheetApp.openById("1VGDOGKOtYrvSMKXuVcSAQwFMfffXHvX3Reoh-EjfR6k");
    var sheet = ss.getSheetByName("Network_Fund_Submissions");
    
    if (!sheet) {
      sheet = ss.insertSheet("Network_Fund_Submissions");
      sheet.appendRow(["Timestamp", "Student ID", "Submission Type", "Strikes", "Answers JSON"]);
      sheet.getRange("A1:E1").setFontWeight("bold");
    }
    
    sheet.appendRow([
      new Date(),
      submissionData.studentId,
      submissionData.reason,
      submissionData.strikes,
      JSON.stringify(submissionData.answers)
    ]);
    
    var folder = DriveApp.getFolderById("1aq2umJ0XiJl4INHhlI1UZtO6gNmU9nyk");
    var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd_HH-mm-ss");
    folder.createFile("Submission_" + submissionData.studentId + "_" + timestamp + ".json", JSON.stringify(submissionData, null, 2), MimeType.PLAIN_TEXT);
    
    return { status: "success", message: "Answers locked, recorded, and backed up to Drive." };
  } catch (err) {
    throw new Error("Failed to save submission: " + err.toString());
  }
}

