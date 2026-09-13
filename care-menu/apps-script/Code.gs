/**
 * BMC 통합돌봄 신청 접수 — 구글 스프레드시트 백엔드
 * =========================================================================
 * 이 파일을 구글 스프레드시트의 [확장 프로그램 → Apps Script]에 붙여넣고
 * 웹 앱으로 배포하면, 홈페이지에서 넣은 신청서가 시트에 한 줄씩 쌓입니다.
 *
 * 배포 순서
 *  1) 구글 드라이브에서 새 스프레드시트를 만듭니다. (예: "BMC 돌봄 신청 접수")
 *  2) 확장 프로그램 → Apps Script → 이 파일 내용을 붙여넣습니다.
 *  3) 아래 ADMIN_KEY 를 아무도 모를 문자열로 바꿉니다.
 *  4) 배포 → 새 배포 → 유형 "웹 앱"
 *       - 실행 계정: 나
 *       - 액세스 권한: 모든 사용자
 *  5) 나온 웹 앱 주소(.../exec)를 care-menu/assets/config.js 의 endpoint 에,
 *     ADMIN_KEY 값을 같은 파일의 adminKey 에 적어 넣습니다.
 *
 * 개인정보가 담기는 시트입니다. 스프레드시트 공유 범위를 담당자로 제한하세요.
 * ========================================================================= */

var ADMIN_KEY = '여기에-열쇠말을-정하세요';
var SHEET_NAME = '신청접수';

var HEADERS = [
  '접수번호', '접수일시', '성함', '연락처', '생년', '성별',
  '읍면', '상세주소', '거동상태', '거주형태',
  '보호자', '관계', '보호자연락처', '지역화폐카드',
  '상담희망일', '희망시간', '월합계', '초과액', '적립포인트',
  '신청서비스', 'AI데이터참여', '개인정보동의', 'AI참여동의', '메모', '처리상태',
  '원본데이터(수정금지)'
];

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 홈페이지 신청서 접수 */
function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    var a = p.applicant || {};
    var t = p.totals || {};

    var services = (p.services || []).map(function (s) {
      return s.name + ' ×' + s.qty + ' (' + s.amount + '원)';
    }).join(' / ');
    var dataItems = (p.dataParticipation || []).map(function (s) {
      return s.name + ' ×' + s.qty + ' (+' + s.point + 'P)';
    }).join(' / ');

    getSheet_().appendRow([
      p.no, new Date(p.submittedAt), a.name, a.phone, a.birthYear, a.gender,
      a.town, a.address, a.mobility, a.living,
      a.guardianName, a.guardianRelation, a.guardianPhone, a.card,
      a.visitDate, a.visitTime, t.used, t.over, t.points,
      services, dataItems,
      a.agreePrivacy ? 'O' : 'X', a.agreeData ? 'O' : 'X',
      a.memo, '접수',
      JSON.stringify({ services: p.services || [], dataParticipation: p.dataParticipation || [] })
    ]);

    notify_(p);
    return json_({ ok: true, no: p.no });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** 운영자 화면(admin.html)에서 접수 목록 조회 */
function doGet(e) {
  var key = (e && e.parameter && e.parameter.key) || '';
  if (key !== ADMIN_KEY) return json_({ error: '열쇠말이 맞지 않습니다.' });

  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = values.length - 1; i >= 1; i--) {
    var r = values[i];
    var raw = {};
    try { raw = r[25] ? JSON.parse(r[25]) : {}; } catch (e) { raw = {}; }

    out.push({
      no: r[0],
      submittedAt: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
      applicant: {
        name: r[2], phone: r[3], birthYear: r[4], gender: r[5],
        town: r[6], address: r[7], mobility: r[8], living: r[9],
        guardianName: r[10], guardianRelation: r[11], guardianPhone: r[12],
        card: r[13], visitDate: r[14], visitTime: r[15],
        agreePrivacy: r[21] === 'O', agreeData: r[22] === 'O', memo: r[23]
      },
      services: raw.services || [],
      dataParticipation: raw.dataParticipation || [],
      totals: { used: Number(r[16]) || 0, over: Number(r[17]) || 0, points: Number(r[18]) || 0,
                available: 200000 + (Number(r[18]) || 0),
                remaining: 200000 + (Number(r[18]) || 0) - (Number(r[16]) || 0) },
      summary: r[19]
    });
  }
  return json_(out);
}

/** 담당자에게 새 신청 알림 메일 (원하지 않으면 NOTIFY_TO 를 비워 두세요) */
var NOTIFY_TO = '';
function notify_(p) {
  if (!NOTIFY_TO) return;
  var a = p.applicant || {};
  MailApp.sendEmail({
    to: NOTIFY_TO,
    subject: '[BMC 돌봄] 새 신청 ' + p.no + ' — ' + (a.name || ''),
    body: [
      '접수번호: ' + p.no,
      '어르신: ' + (a.name || '') + ' (' + (a.phone || '') + ')',
      '주소: ' + (a.town || '') + ' ' + (a.address || ''),
      '월 합계: ' + ((p.totals && p.totals.used) || 0) + '원',
      '상담 희망: ' + (a.visitDate || '협의') + ' ' + (a.visitTime || ''),
      '',
      '서비스: ' + (p.services || []).map(function (s) { return s.name + '×' + s.qty; }).join(', ')
    ].join('\n')
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
