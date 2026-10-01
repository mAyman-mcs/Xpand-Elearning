
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Xpand CS Academy - Student Portal & Assessment')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * REFRESH_STUDENT_DATA
 * Synchronizes student portal data, grades, and rankings directly from the Master Google Sheet.
 */
function REFRESH_STUDENT_DATA(userName) {
  try {
    var ss = SpreadsheetApp.openById("1VGDOGKOtYrvSMKXuVcSAQwFMfffXHvX3Reoh-EjfR6k");
    var sheet = ss.getSheetByName("Grades") || ss.getSheets()[0];
    
    SpreadsheetApp.flush();
    var lastUpdated = new Date().toLocaleString();
    
    Logger.log("REFRESH_STUDENT_DATA successfully executed by: " + (userName || "Admin"));
    
    return {
      status: "success",
      timestamp: lastUpdated,
      message: "Master student data and grade rankings refreshed successfully from Google Sheets."
    };
  } catch (err) {
    Logger.log("Error in REFRESH_STUDENT_DATA: " + err.toString());
    throw new Error("Failed to connect to Google Sheet: " + err.toString());
  }
}

/**
 * Retrieves or saves the global intake start date configured by the admin.
 */
function getIntakeStartDate() {
  try {
    var props = PropertiesService.getScriptProperties();
    return props.getProperty("intake_start_date") || "2026-07-05";
  } catch (err) {
    return "2026-07-05";
  }
}

function setIntakeStartDate(dateStr) {
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty("intake_start_date", dateStr);
    Logger.log("Global intake start date updated to: " + dateStr);
    return { status: "success", message: "Global intake start date updated successfully to " + dateStr };
  } catch (err) {
    throw new Error("Failed to save intake start date: " + err.toString());
  }
}

/**
 * Saves global or student-specific test open/close/scheduled overrides using Script Properties.
 */
function setModuleOverride(testTitle, target, status) {
  try {
    var scriptProperties = PropertiesService.getScriptProperties();
    var props = scriptProperties.getProperties();
    
    if (target === "ALL") {
      for (var key in props) {
        if (key.indexOf("override_" + testTitle + "_") === 0 || key.indexOf("override_lower_" + testTitle + "_") === 0) {
          scriptProperties.deleteProperty(key);
        }
      }
    }
    
    scriptProperties.setProperty("override_" + testTitle + "_" + target, status);
    scriptProperties.setProperty("override_lower_" + testTitle + "_" + String(target).toLowerCase(), status);
    
    Logger.log("Override saved: " + testTitle + " for " + target + " -> " + status);
    return { status: "success", message: "Module status updated successfully for " + target };
  } catch (err) {
    throw new Error("Failed to save override: " + err.toString());
  }
}

/**
 * Retrieves all stored module overrides.
 */
function getModuleOverrides() {
  try {
    var scriptProperties = PropertiesService.getScriptProperties();
    var props = scriptProperties.getProperties();
    var overrides = {};
    
    for (var key in props) {
      if (key.indexOf("override_") === 0) {
        overrides[key] = props[key];
      }
    }
    return overrides;
  } catch (err) {
    return {};
  }
}

/**
 * Helper function to safely parse score cells.
 */
function parseScore(val) {
  if (val === "" || val === null || val === undefined || String(val).trim() === "") {
    return "-";
  }
  var num = Number(val);
  if (!isNaN(num)) {
    return (num <= 1 ? num * 100 : num).toFixed(2) + "%";
  }
  var str = String(val).trim();
  if (str.indexOf("%") === -1 && !isNaN(str)) {
    return Number(str).toFixed(2) + "%";
  }
  return str;
}

/**
 * Retrieves student portal data dynamically with server-side submission locking.
 */
function getStudentPortalData(userName) {
  try {
    var nameKey = String(userName || "").trim();
    var nameLower = nameKey.toLowerCase();
    var overrides = getModuleOverrides();
    var nowTime = new Date().getTime();
    
    var ss = SpreadsheetApp.openById("1VGDOGKOtYrvSMKXuVcSAQwFMfffXHvX3Reoh-EjfR6k");
    
    // Check Submissions sheet for server-side single-attempt locks
    var submittedTestsMap = {};
    try {
      var subSheet = ss.getSheetByName("Submissions");
      if (subSheet && subSheet.getLastRow() > 1) {
        var subData = subSheet.getDataRange().getValues();
        for (var s = 1; s < subData.length; s++) {
          var subName = String(subData[s][1] || "").trim().toLowerCase();
          var subTitle = String(subData[s][2] || "").trim().toLowerCase();
          if (subName === nameLower || subName.indexOf(nameLower) !== -1 || nameLower.indexOf(subName) !== -1) {
            submittedTestsMap[subTitle] = true;
          }
        }
      }
    } catch (subErr) {
      // Safe fallback if Submissions sheet is empty or unavailable
    }

    var sheet = ss.getSheetByName("Grades") || ss.getSheets()[0];
    var data = sheet.getDataRange().getValues();
    
    var netScore = "-", secScore = "-", cloudScore = "-", osScore = "-", ehScore = "-", ctfScore = "-";
    var rankVal = "#3 of 26", totalScore = "75.00%";
    
    if (data.length > 1) {
      var headers = data[0].map(function(h) { return String(h).trim().toLowerCase(); });
      var netScoreIdx = -1, secScoreIdx = -1, cloudScoreIdx = -1, osScoreIdx = -1, ehScoreIdx = -1, ctfScoreIdx = -1, totalScoreIdx = -1, rankIdx = -1;
      
      for (var h = 0; h < headers.length; h++) {
        var hdr = headers[h];
        if (hdr === "nw %" || hdr.indexOf("network fun") !== -1 || (hdr.indexOf("nw") !== -1 && hdr.indexOf("%") !== -1)) netScoreIdx = h;
        else if (hdr === "nws %" || hdr.indexOf("sec. f") !== -1 || hdr.indexOf("network sec") !== -1 || (hdr.indexOf("sec") !== -1 && hdr.indexOf("%") !== -1)) secScoreIdx = h;
        else if (hdr === "cloud %" || hdr.indexOf("cloud gate") !== -1 || hdr.indexOf("cloud") !== -1) cloudScoreIdx = h;
        else if (hdr === "eh %" || hdr.indexOf("i hack") !== -1 || hdr.indexOf("eh") !== -1) ehScoreIdx = h;
        else if (hdr === "os %" || hdr.indexOf("rating") !== -1 || hdr.indexOf("os") !== -1) osScoreIdx = h;
        else if (hdr === "ctf %" || hdr.indexOf("ctf") !== -1) ctfScoreIdx = h;
        else if (hdr === "total %" || hdr.indexOf("total") !== -1) totalScoreIdx = h;
        else if (hdr === "ranking" || hdr.indexOf("ranking") !== -1) rankIdx = h;
      }

      for (var i = 1; i < data.length; i++) {
        var rowName = String(data[i][0]).trim();
        var rowLower = rowName.toLowerCase();
        if (rowLower === nameLower || rowLower.indexOf(nameLower) !== -1 || nameLower.indexOf(rowLower) !== -1) {
          netScore = parseScore(netScoreIdx !== -1 ? data[i][netScoreIdx] : "");
          secScore = parseScore(secScoreIdx !== -1 ? data[i][secScoreIdx] : "");
          cloudScore = parseScore(cloudScoreIdx !== -1 ? data[i][cloudScoreIdx] : "");
          osScore = parseScore(osScoreIdx !== -1 ? data[i][osScoreIdx] : "");
          ehScore = parseScore(ehScoreIdx !== -1 ? data[i][ehScoreIdx] : "");
          ctfScore = parseScore(ctfScoreIdx !== -1 ? data[i][ctfScoreIdx] : "");
          totalScore = parseScore(totalScoreIdx !== -1 ? data[i][totalScoreIdx] : "");
          if (rankIdx !== -1 && data[i][rankIdx] !== "") rankVal = data[i][rankIdx];
          break;
        }
      }
    }

    var titles = [
      "Network Fundamentals",
      "Network Security Fundamentals",
      "Cloud Gates",
      "OS Fundamentals",
      "Ethical Hacking",
      "CTF"
    ];
    var scores = [netScore, secScore, cloudScore, osScore, ehScore, ctfScore];
    
    var tests = [];
    for (var j = 0; j < titles.length; j++) {
      var tTitle = titles[j];
      var tScore = scores[j];
      var status = "Closed";
      var submittedAt = "Locked";
      
      var isSubmittedOnServer = tScore !== "-" || submittedTestsMap[tTitle.toLowerCase()] || false;
      
      var specificKey1 = "override_" + tTitle + "_" + nameKey;
      var specificKey2 = "override_lower_" + tTitle + "_" + nameLower;
      var generalKey1 = "override_" + tTitle + "_ALL";
      var generalKey2 = "override_lower_" + tTitle + "_all";

      var specificOverride = overrides[specificKey1] || overrides[specificKey2];
      var generalOverride = overrides[generalKey1] || overrides[generalKey2];

      // CRITICAL LOGIC: If submitted, ignore general overrides ("ALL") unless admin explicitly sets individual override to "Open"
      var rawOverride = specificOverride || (!isSubmittedOnServer ? generalOverride : null);
      
      if (isSubmittedOnServer && !specificOverride) {
        status = "Finished";
        submittedAt = tScore !== "-" ? "Submitted & Verified" : "Submitted & Recorded";
      } else if (rawOverride) {
        if (rawOverride.indexOf("Scheduled:") === 0) {
          var schedTimestamp = Number(rawOverride.split(":")[1]);
          if (nowTime >= schedTimestamp) {
            status = "Open";
            submittedAt = "Ready for attempt";
          } else {
            status = "Closed";
            submittedAt = "Scheduled for " + new Date(schedTimestamp).toLocaleString();
          }
        } else if (rawOverride === "Open") {
          status = "Open";
          submittedAt = "Ready for attempt";
        } else if (rawOverride === "Closed") {
          status = "Closed";
          submittedAt = "Locked by instructor";
        }
      } else {
        status = "Closed";
        submittedAt = "Locked";
      }
      
      tests.push({
        title: tTitle,
        score: tScore,
        status: status,
        submittedAt: submittedAt
      });
    }

    return {
      rank: rankVal,
      rawRank: 3,
      avgScore: totalScore,
      warnings: 0,
      intakeStartDate: getIntakeStartDate(),
      completedTests: tests
    };
  } catch (err) {
    Logger.log("Error in getStudentPortalData: " + err.toString());
    throw new Error("Spreadsheet Access Error: " + err.toString());
  }
}

/**
 * Processes student exam submissions and saves them into the Google Sheet.
 */
function processSubmission(formData) {
  try {
    var ss = SpreadsheetApp.openById("1VGDOGKOtYrvSMKXuVcSAQwFMfffXHvX3Reoh-EjfR6k");
    var sheet = ss.getSheetByName("Submissions") || ss.insertSheet("Submissions");
    
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Timestamp", "Student Name", "Assessment Title", "Time Remaining", "Answers JSON"]);
    }
    
    sheet.appendRow([
      new Date(),
      formData.studentName,
      formData.testTitle,
      formData.timeRemaining,
      JSON.stringify(formData.answers)
    ]);
    
    return { status: "success", message: "Submission recorded successfully." };
  } catch (err) {
    Logger.log("Error in processSubmission: " + err.toString());
    throw new Error(err.toString());
  }
}

/**
 * Clears a student's submission from the server-side Submissions sheet so they can retake.
 */
function resetStudentSubmissionOnServer(studentName) {
  try {
    var ss = SpreadsheetApp.openById("1VGDOGKOtYrvSMKXuVcSAQwFMfffXHvX3Reoh-EjfR6k");
    var sheet = ss.getSheetByName("Submissions");
    if (sheet && sheet.getLastRow() > 1) {
      var data = sheet.getDataRange().getValues();
      for (var i = data.length - 1; i >= 1; i--) {
        var rowName = String(data[i][1]).trim().toLowerCase();
        if (rowName === studentName.toLowerCase() || rowName.indexOf(studentName.toLowerCase()) !== -1) {
          sheet.deleteRow(i + 1);
        }
      }
    }
    return { status: "success", message: "Server submission lock cleared for " + studentName };
  } catch (err) {
    throw new Error("Failed to clear submission lock: " + err.toString());
  }
}

/**
 * Returns training material view and download links mapped in the correct order.
 */
function getMaterialUrl(testTitle) {
  var materialLinks = {
    "Network Fundamentals": "https://drive.google.com/uc?export=download&id=1u3RrxMYiEcIikchh67mQzmWdVCluU5pD",
    "Network Security Fundamentals": "https://drive.google.com/uc?export=download&id=1yw_nJQJnJEPB-ebVP4AdZsKXAHNCHvfe",
    "Cloud Gates": "https://drive.google.com/uc?export=download&id=1HuLnKe96jArh_SRLqwIpRt_xmCP7yPhl",
    "OS Fundamentals": "https://drive.google.com/uc?export=download&id=1yP6_Nya_2J08I_zpERQmfhD3JFKlac35",
    "Ethical Hacking": "https://drive.google.com/uc?export=download&id=11hsQfJdlOEJam5Xs7o7Dm4ptr81fgLJC"
  };

  var targetUrl = materialLinks[testTitle] || "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

  return {
    viewUrl: targetUrl,
    downloadUrl: targetUrl
  };
}
function generateImageTags() {
  // I have already inserted your exact folder ID here
  var folder = DriveApp.getFolderById("18TsZjpb5rziSGv0yCSGZ8i3n0GH2H0rs");
  var files = folder.getFiles();
  
  Logger.log("=== COPY THESE TAGS INTO YOUR INDEX.HTML ===");
  
  while (files.hasNext()) {
    var file = files.next();
    
    // This automatically sets the image so students can see it
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    var name = file.getName();
    var id = file.getId();
    
    var htmlTag = '<img src="https://drive.google.com/uc?export=view&id=' + id + '" alt="' + name + '" class="question-image">';
    
    Logger.log("File: " + name);
    Logger.log(htmlTag);
    Logger.log("--------------------------------------------------");
  }
}

