/* =========================================================================
   BMC 통합돌봄 서비스 메뉴 데이터 (Ver 1.0)
   kind: 'once'     — 이용할 때마다 결제 (수량 조절)
         'monthly'  — 월 정액 (수량 1 고정)
         'variable' — 금액이 주문마다 다름 (이용자가 예상 금액 입력)
         'free'     — 무료 항목 (담아도 금액 0원)
   ========================================================================= */

window.BMC_MENU = [
  {
    id: 'meal',
    no: '1',
    title: '식사 돌봄',
    tagline: '끼니 걱정 없는 마을',
    note: '주5일 도시락은 배달과 동시에 안부를 확인합니다.',
    items: [
      { id: 'meal-lunchbox',   name: '따뜻한 도시락 배달',   desc: '주5일 점심 도시락 자택 배달, 안부확인 동시 수행', unit: '1식',    price: 5500,   kind: 'once' },
      { id: 'meal-monthly',    name: '도시락 월정액 (주5일)', desc: '월 20식 정기배달 (1식당 5,500원)',              unit: '월 20식', price: 110000, kind: 'monthly' },
      { id: 'meal-banchan',    name: '밑반찬 꾸러미',        desc: '주 1회, 지역 제철재료 반찬 3종 (400g 기준)',     unit: '1회',    price: 12000,  kind: 'once' },
      { id: 'meal-soft',       name: '연하곤란 특별식',      desc: '죽·미음·다짐식 등 저작·연하 배려식',            unit: '1식',    price: 7000,   kind: 'once' },
      { id: 'meal-village',    name: '마을 공동급식 이용',    desc: '마을회관 공동식당 식사 (이동 지원 별도)',        unit: '1식',    price: 4000,   kind: 'once' },
      { id: 'meal-feast',      name: '명절·생신 특별상',      desc: '생신·명절 특별식 + 마을방송 축하 영상 기록',      unit: '1회',    price: 30000,  kind: 'once' }
    ]
  },
  {
    id: 'life',
    no: '2',
    title: '생활지원 돌봄',
    tagline: '장보기·집안일 대신 해드립니다',
    note: '장보기 배달은 자연사랑 생활장터 가격표를 그대로 적용하고 배달료를 받지 않습니다.',
    items: [
      { id: 'life-market',     name: '생활장터 장보기 배달',  desc: '생필품·식료품 주문 접수 후 자택 배송 (자연사랑 생활장터 가격표 적용)', unit: '주문 건', price: 30000, kind: 'variable', priceLabel: '상품가 그대로 (배달료 0원)', badge: '주력' },
      { id: 'life-smallfee',   name: '소액주문 취급비',      desc: '3만원 미만 주문 시 적용 (3만원 이상 무료)',      unit: '1건',    price: 2000,   kind: 'once' },
      { id: 'life-house',      name: '일상 가사지원',        desc: '청소·설거지·정리정돈·쓰레기 배출 (2시간 기준)',   unit: '2시간',  price: 32000,  kind: 'once' },
      { id: 'life-bigclean',   name: '계절 대청소·정리수납',  desc: '창문·주방·화장실 집중 청소, 묵은 짐 정리 (4시간)', unit: '1회',    price: 60000,  kind: 'once' },
      { id: 'life-laundry',    name: '세탁물 수거·배달',     desc: '주 1회 세탁물 수거 → 세탁 → 자택 반납 (세탁비 별도 실비)', unit: '1회', price: 8000, kind: 'once' },
      { id: 'life-bedding',    name: '이불·대형 빨래 대행',   desc: '이불·요·커튼 등 대형 세탁물 (건당, 세탁비 포함)',  unit: '1건',    price: 15000,  kind: 'once' },
      { id: 'life-garden',     name: '텃밭·마당 정리',       desc: '잡초 제거, 낙엽 정리, 농기구 정돈 (2시간)',       unit: '2시간',  price: 30000,  kind: 'once' }
    ]
  },
  {
    id: 'health',
    no: '3',
    title: '건강 돌봄',
    tagline: '병원 가는 길, 약 챙기는 일까지',
    note: '병원 동행은 접수·수납·진료결과 정리까지 함께합니다. 약값·교통비는 별도 실비입니다.',
    items: [
      { id: 'hl-hospital-in',  name: '병원 동행 (관내)',     desc: '보성읍·벌교 등 관내 병의원 왕복 동행, 접수·수납·결과 설명 정리 (3시간)', unit: '1회', price: 45000, kind: 'once' },
      { id: 'hl-hospital-out', name: '병원 동행 (관외)',     desc: '순천·광주 등 대형병원 왕복 동행 (6시간), 교통비 실비 별도', unit: '1회', price: 90000, kind: 'once' },
      { id: 'hl-pharmacy',     name: '약국 대리수령·배달',    desc: '처방전 접수 → 조제약 수령 → 자택 전달 (약값 별도)', unit: '1회',   price: 5000,   kind: 'once' },
      { id: 'hl-pillbox',      name: '복약관리 (IoT 약통)',   desc: '스마트 약통 임대 + 복약시간 음성알림 + 미복용 시 보호자 알림', unit: '월', price: 15000, kind: 'monthly', tech: 'IoT' },
      { id: 'hl-check',        name: '방문 건강체크',        desc: '혈압·혈당·체온·체중 측정 및 기록, 이상 시 보건지소 연계 (주 1회)', unit: '1회', price: 10000, kind: 'once' },
      { id: 'hl-rehab',        name: '재활·근력 운동 지도',   desc: '낙상예방 근력운동 방문 지도 (1시간)',            unit: '1회',    price: 20000,  kind: 'once' },
      { id: 'hl-bath',         name: '목욕·위생 지원',       desc: '방문 목욕 보조 및 세면·손발톱 정리 (1.5시간)',     unit: '1회',    price: 35000,  kind: 'once' },
      { id: 'hl-hair',         name: '이·미용 방문 서비스',   desc: '출장 이발·커트·염색 (재료비 포함)',              unit: '1회',    price: 15000,  kind: 'once' }
    ]
  },
  {
    id: 'safety',
    no: '4',
    title: '안전·주거 돌봄',
    tagline: '집이 가장 안전한 곳이 되도록',
    note: '응급안전 모니터링은 몸에 아무것도 붙이지 않는 비접촉 방식입니다.',
    items: [
      { id: 'sf-monitor',      name: '24시간 응급안전 모니터링', desc: 'Matter 표준 IoT + Wi-Fi 센싱 기반 비접촉 활동감지, 무반응 시 자동 알림 (기기 임대·설치 포함)', unit: '월', price: 25000, kind: 'monthly', tech: 'AI' },
      { id: 'sf-firegas',      name: '화재·가스 감지기 설치',  desc: '주방·보일러실 감지기 설치 및 연 1회 점검',      unit: '1대',    price: 35000,  kind: 'once' },
      { id: 'sf-fix',          name: '생활 집수리',          desc: '전구·수도꼭지·문고리·콘센트 등 소규모 수리 (자재 실비 별도)', unit: '1건', price: 15000, kind: 'once' },
      { id: 'sf-grab',         name: '안전손잡이·미끄럼방지',  desc: '화장실·현관 안전바 설치, 미끄럼방지 시공',       unit: '1개소',  price: 40000,  kind: 'once' },
      { id: 'sf-ramp',         name: '문턱 제거·경사로 설치',  desc: '휠체어·보행기 진입을 위한 단차 해소 공사',       unit: '1개소',  price: 120000, kind: 'once' },
      { id: 'sf-boiler',       name: '화목보일러 점검·청소',   desc: '연통·화구 청소, 도어 밀폐 점검, 연소효율 조정 (동절기 전 권장)', unit: '1회', price: 50000, kind: 'once' },
      { id: 'sf-filter',       name: '냉난방기 필터 청소',    desc: '에어컨·온풍기 필터 세척 및 살균',               unit: '1대',    price: 25000,  kind: 'once' },
      { id: 'sf-device',       name: '복지용구 상담·대여 연계', desc: '보행기·휠체어·욕창방지 매트 등 상담 및 장기요양 급여 연계', unit: '1회', price: 0, kind: 'free', priceLabel: '무료' }
    ]
  },
  {
    id: 'move',
    no: '5',
    title: '이동 돌봄',
    tagline: '마을 안에서는 어디든',
    note: '마을 안심이동은 모벨릭스 4륜 e-모빌리티로 운행합니다.',
    items: [
      { id: 'mv-mobelix',      name: '마을 안심이동 (모벨릭스)', desc: '4륜 e-모빌리티 기반 관내 단거리 이동 (경로당·보건지소·마을회관)', unit: '편도', price: 3000, kind: 'once' },
      { id: 'mv-shopping',     name: '장보기 동행',          desc: '읍내 시장·마트 동행 및 짐 운반 (2시간)',         unit: '1회',    price: 30000,  kind: 'once' },
      { id: 'mv-office',       name: '관공서·은행 동행',      desc: '면사무소·농협·우체국 업무 동행 및 서류 작성 지원', unit: '1회',    price: 25000,  kind: 'once' },
      { id: 'mv-ceremony',     name: '장례·경조사 동행',      desc: '경조사 참석 이동 및 동행 (반일)',               unit: '1회',    price: 40000,  kind: 'once' }
    ]
  },
  {
    id: 'emotion',
    no: '6',
    title: '정서·사회 돌봄',
    tagline: '혼자가 아니라는 것',
    note: '안부확인 콜은 보성 말씨를 학습한 로컬 sLLM 음성비서가 겁니다.',
    items: [
      { id: 'em-aicall',       name: 'AI 안부확인 콜',       desc: '로컬 sLLM 음성비서가 주 3회 안부 통화, 이상 징후 시 담당자 연결', unit: '월', price: 9000, kind: 'monthly', tech: 'AI' },
      { id: 'em-visit',        name: '말벗 방문',           desc: '담당 돌봄매니저 방문 대화 및 생활 점검 (1시간)',   unit: '1회',    price: 15000,  kind: 'once' },
      { id: 'em-call',         name: '전화 말벗 (사람)',     desc: '주 2회 정기 안부 통화 (마을 자원봉사자 연계)',     unit: '월',     price: 12000,  kind: 'monthly' },
      { id: 'em-digital',      name: '스마트폰·키오스크 교육', desc: '1:1 방문 교육 — 영상통화, 카카오톡, 병원 예약, 무인주문기 (1시간)', unit: '1회', price: 12000, kind: 'once' },
      { id: 'em-outing',       name: '나들이·문화활동 동행',  desc: '벚꽃길·녹차밭·축제 나들이 동행 (반일, 입장료 별도)', unit: '1회',   price: 40000,  kind: 'once' },
      { id: 'em-broadcast',    name: '마을방송 출연·인생기록', desc: 'BMC 마을방송국 영상 인터뷰, 가족에게 영상 전달',  unit: '1회',    price: 0, kind: 'free', priceLabel: '무료(회원)' }
    ]
  }
];

/* 7. AI 데이터 참여 — 적립 항목 (포인트가 쌓이면 그만큼 더 쓰실 수 있습니다) */
window.BMC_POINTS = {
  id: 'data',
  no: '7',
  title: 'AI 데이터 참여',
  tagline: '어르신의 말씀이 곧 자산',
  intro: '보성 지역 방언·생활 맥락 데이터 수집에 참여하시면 돌봄포인트를 적립해 드리며, 적립금은 위 모든 서비스 결제에 사용하실 수 있습니다. (개인정보 비식별 처리, 참여 동의서 필수)',
  footnote: '1포인트 = 1원 · 적립 포인트는 지역화폐 잔액과 합산하여 사용 · 현금 환급 불가',
  items: [
    { id: 'dt-dialect',   name: '방언 음성 녹음 참여',    desc: '제시 문장·구술 녹음 (30분), AI 데이터 라벨링 원천 데이터', unit: '1회', point: 10000 },
    { id: 'dt-life',      name: '인생 구술 인터뷰',       desc: '생애사·마을 역사 구술 기록 (1시간), 마을 아카이브 등재',   unit: '1회', point: 20000 },
    { id: 'dt-context',   name: '생활 맥락 데이터 제공 동의', desc: 'IoT 활동 로그 비식별 제공 동의 (월 단위 자동 적립)',    unit: '월',  point: 5000 },
    { id: 'dt-survey',    name: '돌봄 서비스 만족도 인터뷰', desc: '분기 1회 서비스 개선 인터뷰 (30분)',                  unit: '1회', point: 8000 }
  ]
};

/* 추천 패키지 — 월 20만원 지역화폐 기준 */
window.BMC_PACKAGES = [
  {
    id: 'pkg-safe',
    label: '①',
    name: '안심 생활형',
    who: '혼자 계시지만 거동은 가능한 어르신',
    lines: [
      { itemId: 'life-market', qty: 1, amount: 120000, memo: '월 4~5회' },
      { itemId: 'sf-monitor',  qty: 1, memo: '월' },
      { itemId: 'em-visit',    qty: 2, memo: '월 2회' },
      { itemId: 'sf-fix',      qty: 1, memo: '월 1건' },
      { itemId: 'em-aicall',   qty: 1, memo: '월' }
    ]
  },
  {
    id: 'pkg-meal',
    label: '②',
    name: '식사 중심형',
    who: '취사가 어렵고 끼니가 부실한 어르신',
    lines: [
      { itemId: 'meal-monthly', qty: 1, memo: '월 20식' },
      { itemId: 'meal-banchan', qty: 4, memo: '월 4회' },
      { itemId: 'life-market',  qty: 1, amount: 30000, memo: '월 1~2회' },
      { itemId: 'em-aicall',    qty: 1, memo: '월' }
    ]
  },
  {
    id: 'pkg-health',
    label: '③',
    name: '건강 중심형',
    who: '만성질환으로 통원이 잦은 어르신',
    lines: [
      { itemId: 'hl-hospital-in', qty: 2, memo: '월 2회' },
      { itemId: 'hl-check',       qty: 4, memo: '월 4회' },
      { itemId: 'life-market',    qty: 1, amount: 40000, memo: '월 1~2회' },
      { itemId: 'hl-pillbox',     qty: 1, memo: '월' },
      { itemId: 'hl-pharmacy',    qty: 2, memo: '월 2회' }
    ]
  }
];

/* 운영·정산 기준 (내부용) */
window.BMC_OPS = [
  ['결제 수단',   '보성군 기본소득 지역화폐 카드 (방문 카드결제기 / 가맹점 결제)'],
  ['결제 주기',   '월 1회 선결제 원칙 (1회성 서비스는 이용 시 차감)'],
  ['정산 주기',   '일 단위 정산 (지역화폐 매출 → 익영업일 입금)'],
  ['인건비 기준', '직접 서비스 시간당 15,000~16,000원 (가사간병·일상돌봄 바우처 단가 준용)'],
  ['원가 구조',   '인건비 60~65% / 이동·차량 10% / 기기·자재 10% / 관리운영 15~20%'],
  ['서비스 인력', '마을 주민 돌봄매니저 (BMC 마을방송국 네트워크 기반 채용·교육)'],
  ['기록·데이터', '서비스 제공 시 앱으로 이용기록 입력 → 통합돌봄 온톨로지 DB 축적 → 월간 리포트 가족 발송'],
  ['취소·환불',   '서비스 24시간 전 취소 시 전액 환불, 당일 취소 시 50% 부과']
];

/* 이용 방법 3단계 */
window.BMC_STEPS = [
  { n: '1단계', t: '신청', d: '전화 또는 마을 담당자에게 신청 → 어르신 댁 방문 상담 → 필요 서비스 선택' },
  { n: '2단계', t: '결제', d: '보성군 기본소득 지역화폐 카드로 월 20만원 한도 내 결제 (방문 카드결제기 또는 자택 결제)' },
  { n: '3단계', t: '이용', d: '선택한 서비스를 월 단위로 제공, 이용내역은 문자·마을방송으로 안내' }
];
