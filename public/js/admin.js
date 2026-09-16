'use strict';

/* 운영자 화면 로직 */

const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { view: 'dashboard', intake: { items: [], member: null }, catalog: null };

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) { showLogin(); throw new Error('로그인이 필요합니다.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청 처리 실패');
  return data;
}

function showLogin() { $('loginView').classList.remove('hidden'); $('appView').classList.add('hidden'); }
function showApp() { $('loginView').classList.add('hidden'); $('appView').classList.remove('hidden'); }

async function doLogin() {
  try {
    await api('/api/admin/login', { method: 'POST', body: { password: $('pw').value } });
    showApp();
    await boot();
  } catch (err) {
    $('loginMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function doLogout() {
  await api('/api/admin/logout', { method: 'POST' });
  location.reload();
}

async function boot() {
  state.catalog = await api('/api/catalog');
  document.querySelectorAll('.admin-nav button').forEach((b) => {
    b.onclick = () => switchView(b.dataset.view);
  });
  switchView('dashboard');
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.admin-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.admin-wrap > section').forEach((s) => s.classList.toggle('hidden', s.id !== `view-${view}`));
  ({ dashboard: renderDashboard, orders: renderOrders, intake: renderIntake, members: renderMembers,
     prices: renderPrices, menus: renderMenus, settlement: renderSettlement, settings: renderSettings }[view])();
}

/* ── 잔액 대시보드 ── */
async function renderDashboard() {
  const d = await api('/api/admin/dashboard');
  $('ymLabel').textContent = `${d.ym} 기준`;
  const statusRows = Object.entries(d.byStatus).map(([s, v]) =>
    `<tr><td><span class="badge b-${s}">${s}</span></td><td class="num">${v.count}건</td><td class="num">${won(v.amount)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="muted">이번 달 접수 내역이 없습니다.</td></tr>';

  $('view-dashboard').innerHTML = `
    <div class="kpi-grid">
      <div class="kpi"><div class="k">등록 회원</div><div class="v">${d.memberCount}명</div></div>
      <div class="kpi"><div class="k">이번 달 총 한도(이월·포인트 포함)</div><div class="v">${won(d.totalLimit)}</div></div>
      <div class="kpi"><div class="k">이번 달 사용액</div><div class="v">${won(d.totalUsed)}</div></div>
      <div class="kpi ${d.usageRate >= 80 ? 'warn' : ''}"><div class="k">전체 사용률</div><div class="v">${d.usageRate}%</div></div>
      <div class="kpi warn"><div class="k">한도 임박(80% 이상)</div><div class="v">${d.nearLimit.length}명</div></div>
      <div class="kpi danger"><div class="k">잔액 소진</div><div class="v">${d.exhausted.length}명</div></div>
    </div>

    <div class="panel">
      <h3>상태별 접수 현황 (${d.ym})</h3>
      <table><thead><tr><th>상태</th><th class="num">건수</th><th class="num">금액</th></tr></thead><tbody>${statusRows}</tbody></table>
    </div>

    <div class="panel">
      <h3>유형별 매출</h3>
      <table><thead><tr><th>유형</th><th class="num">건수</th><th class="num">금액</th></tr></thead><tbody>
        ${d.byType.map((t) => `<tr><td>${esc(t.type)}</td><td class="num">${t.c}건</td><td class="num">${won(t.amount)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">내역 없음</td></tr>'}
      </tbody></table>
    </div>

    <div class="panel">
      <h3>한도 임박 · 소진 회원 알림</h3>
      ${[...d.nearLimit, ...d.exhausted].length ? `
      <table><thead><tr><th>회원</th><th>연락처</th><th class="num">한도</th><th class="num">사용</th><th class="num">잔액</th><th class="num">사용률</th></tr></thead><tbody>
        ${[...d.exhausted, ...d.nearLimit].map((m) => `<tr>
          <td>${esc(m.name)}</td><td>${esc(m.phone)}</td>
          <td class="num">${won(m.limit + m.carryover)}</td><td class="num">${won(m.used)}</td>
          <td class="num"><b style="color:${m.available <= 0 ? 'var(--red-600)' : 'var(--amber-600)'}">${won(m.available)}</b></td>
          <td class="num">${m.usageRate}%</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">해당 회원이 없습니다.</p>'}
    </div>

    <div class="panel">
      <h3>사용액 상위 회원</h3>
      <table><thead><tr><th>회원</th><th class="num">사용액</th><th class="num">잔액</th><th class="num">사용률</th></tr></thead><tbody>
        ${d.top.map((m) => `<tr><td>${esc(m.name)}</td><td class="num">${won(m.used)}</td><td class="num">${won(m.available)}</td><td class="num">${m.usageRate}%</td></tr>`).join('') || '<tr><td colspan="4" class="muted">내역 없음</td></tr>'}
      </tbody></table>
    </div>`;
}

/* ── 접수 현황 ── */
let orderFilter = { status: '', type: '', q: '' };

async function renderOrders() {
  const params = new URLSearchParams();
  Object.entries(orderFilter).forEach(([k, v]) => { if (v) params.set(k, v); });
  const d = await api(`/api/admin/orders?${params}`);

  $('view-orders').innerHTML = `
    <div class="toolbar">
      <input id="oq" placeholder="이름·연락처·접수번호 검색" value="${esc(orderFilter.q)}">
      <select id="ostatus">
        <option value="">전체 상태</option>
        ${d.statuses.map((s) => `<option value="${s}" ${orderFilter.status === s ? 'selected' : ''}>${s} (${d.counts[s]})</option>`).join('')}
      </select>
      <select id="otype">
        <option value="">전체 유형</option>
        ${['돌봄서비스', '장보기', '통합'].map((t) => `<option value="${t}" ${orderFilter.type === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <button class="btn btn-sm btn-primary" onclick="applyOrderFilter()">조회</button>
      <span class="mini">총 ${d.total}건</span>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>접수번호</th><th>접수일시</th><th>회원</th><th>연락처</th><th>유형</th>
          <th class="num">돌봄</th><th class="num">장보기</th><th class="num">합계</th><th>상태</th><th>경로</th><th></th>
        </tr></thead>
        <tbody>
          ${d.orders.map((o) => `<tr>
            <td><b>${esc(o.order_no)}</b></td>
            <td class="mini">${esc(o.created_at)}</td>
            <td>${esc(o.applicant_name)}</td>
            <td class="mini">${esc(o.applicant_phone)}</td>
            <td>${esc(o.type)}</td>
            <td class="num">${won(o.care_amount)}</td>
            <td class="num">${won(o.market_amount)}</td>
            <td class="num"><b>${won(o.total_amount)}</b></td>
            <td>
              <select onchange="changeStatus(${o.id}, this.value)">
                ${d.statuses.map((s) => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </td>
            <td class="mini">${esc(o.channel)}</td>
            <td><button class="btn btn-sm btn-outline" onclick="openOrder(${o.id})">상세</button></td>
          </tr>`).join('') || '<tr><td colspan="11" class="muted">접수 내역이 없습니다.</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

function applyOrderFilter() {
  orderFilter = { q: $('oq').value.trim(), status: $('ostatus').value, type: $('otype').value };
  renderOrders();
}

async function changeStatus(id, status) {
  const body = { status };
  if (status === '취소') {
    // 운영 기준: 서비스 24시간 전 취소는 전액 환불, 당일 취소는 50% 부과
    const sameDay = confirm(
      '취소 처리 방식을 선택하세요.\n\n' +
      '[확인] 당일 취소 — 이용료의 50%를 위약금으로 부과하고 나머지만 잔액으로 돌려줍니다.\n' +
      '[취소] 24시간 전 취소 — 전액 환불(잔액 전부 복원)합니다.'
    );
    body.refundType = sameDay ? '당일취소' : '전액환불';
  }
  try {
    const d = await api(`/api/admin/orders/${id}/status`, { method: 'PATCH', body });
    if (d.cancelFee) alert(`위약금 ${won(d.cancelFee)}을 부과하고 나머지를 환불 처리했습니다.`);
    renderOrders();
  } catch (err) { alert(err.message); renderOrders(); }
}

async function openOrder(id) {
  const d = await api(`/api/admin/orders/${id}`);
  $('dlgTitle').textContent = `주문 상세 — ${d.order.order_no}`;
  $('dlgBody').innerHTML = `
    <div class="row-form" style="margin-bottom:14px">
      <div><b>회원</b><br>${esc(d.order.applicant_name)} (${esc(d.order.applicant_phone)})</div>
      <div><b>생년월일</b><br>${esc(d.order.applicant_birth) || '-'}</div>
      <div><b>비상연락처</b><br>${esc(d.order.emergency_phone) || '-'}</div>
      <div><b>대리 신청</b><br>${d.order.proxy_name ? `${esc(d.order.proxy_name)} (${esc(d.order.proxy_relation) || '-'}, ${esc(d.order.proxy_phone) || '-'})` : '-'}</div>
    </div>
    <p><b>주소</b> ${esc(d.order.address) || '-'}</p>
    <p><b>요청사항</b> ${esc(d.order.note) || '-'}</p>
    ${d.balance ? `<p class="mini">${d.order.ym} 한도 ${won(d.balance.limit + d.balance.carryover)} · 사용 ${won(d.balance.used)} · 잔액 ${won(d.balance.available)}</p>` : ''}

    <h4>신청 항목</h4>
    <table><thead><tr><th>구분</th><th>항목</th><th class="num">단가</th><th class="num">수량</th><th class="num">금액</th></tr></thead><tbody>
      ${d.items.map((i) => `<tr><td>${i.source === 'market' ? '장보기' : '돌봄'}</td><td>${esc(i.name)}</td>
        <td class="num">${won(i.unit_price)}</td><td class="num">${i.qty}</td><td class="num">${won(i.subtotal)}</td></tr>`).join('')}
      <tr><td colspan="4" class="num"><b>합계</b></td><td class="num"><b>${won(d.order.total_amount)}</b></td></tr>
    </tbody></table>

    <h4 style="margin-top:16px">결제 요청</h4>
    <p>${d.payment ? `${esc(d.payment.method)} · 상태 <span class="badge b-${d.order.status}">${esc(d.payment.status)}</span> · ${won(d.payment.amount)}` : '없음'}</p>
    <p class="mini">2단계에서 지역화폐 카드결제기 연동 시 이 영역이 실제 승인 결과로 대체됩니다.</p>

    <h4 style="margin-top:16px">개인정보 동의 기록</h4>
    <table><thead><tr><th>항목</th><th>필수</th><th>동의</th><th>일시</th></tr></thead><tbody>
      ${d.consents.map((c) => `<tr><td class="mini">${esc(c.item_label)}</td><td>${c.required ? '필수' : '선택'}</td>
        <td>${c.agreed ? '동의' : '미동의'}</td><td class="mini">${esc(c.agreed_at) || '-'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">기록 없음</td></tr>'}
    </tbody></table>

    <h4 style="margin-top:16px">처리 이력</h4>
    <table><tbody>
      ${d.logs.map((l) => `<tr><td class="mini">${esc(l.created_at)}</td><td>${esc(l.from_status) || '-'} → <b>${esc(l.to_status)}</b></td><td class="mini">${esc(l.memo) || ''}</td></tr>`).join('')}
    </tbody></table>`;
  $('dlgFoot').innerHTML = `<button class="btn btn-sm btn-ghost" onclick="detailDlg.close()">닫기</button>`;
  detailDlg.showModal();
}

/* ── 카톡 접수 ── */
function renderIntake() {
  $('view-intake').innerHTML = `
    <div class="panel">
      <h3>카카오톡 주문 문장 붙여넣기</h3>
      <textarea id="kkText" rows="5" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:9px"
        placeholder="김순자 010-1234-5678&#10;백미 10kg 1포, 계란 2판&#10;두부 3모"></textarea>
      <div style="margin-top:10px"><button class="btn btn-sm btn-primary" onclick="doParse()">문장 분석</button></div>
      <div id="parseOut"></div>
    </div>
    <div class="panel" id="intakeForm"></div>`;
}

async function doParse() {
  const d = await api('/api/admin/parse', { method: 'POST', body: { text: $('kkText').value } });
  state.intake.items = d.items.map((i) => ({ source: 'market', refId: i.priceItemId, name: i.name, qty: i.qty, price: i.unitPrice }));
  state.intake.member = d.member;
  $('parseOut').innerHTML = `
    <div class="alert ${d.items.length ? 'alert-ok' : 'alert-warn'}">
      품목 ${d.items.length}건 인식${d.unmatched.length ? ` · 미인식: ${esc(d.unmatched.join(', '))}` : ''}
    </div>`;
  renderIntakeForm(d);
}

function renderIntakeForm(parsed = {}) {
  const menu = state.catalog.categories.flatMap((c) => c.items);
  const priceItems = state.catalog.priceItems;
  const rows = state.intake.items.map((it, idx) => `<tr>
      <td>${it.source === 'market' ? '장보기' : '돌봄'}</td><td>${esc(it.name)}</td>
      <td class="num">${won(it.price)}</td>
      <td class="num"><input type="number" min="1" value="${it.qty}" style="width:70px" onchange="state.intake.items[${idx}].qty=Number(this.value);renderIntakeForm()"></td>
      <td class="num">${won(it.price * it.qty)}</td>
      <td><button class="btn btn-sm btn-ghost" onclick="state.intake.items.splice(${idx},1);renderIntakeForm()">삭제</button></td>
    </tr>`).join('');
  const total = state.intake.items.reduce((a, b) => a + b.price * b.qty, 0);

  $('intakeForm').innerHTML = `
    <h3>접수 내용 확인</h3>
    <div class="row-form" style="margin-bottom:12px">
      <div><label class="mini">회원 이름</label><input id="ikName" value="${esc(parsed.name || state.intake.member?.name || '')}"></div>
      <div><label class="mini">연락처</label><input id="ikPhone" value="${esc(parsed.phone || state.intake.member?.phone || '')}"></div>
      <div><label class="mini">배송지</label><input id="ikAddress" value="${esc(state.intake.member?.address || '')}"></div>
      <div><label class="mini">접수 경로</label>
        <select id="ikChannel"><option>카카오톡</option><option>전화</option><option>방문</option><option>마을담당자</option></select></div>
    </div>
    ${state.intake.member ? `<p class="mini">기존 회원 매칭됨 · 이번 달 잔액 ${won(parsed.balance?.available ?? 0)}</p>` : '<p class="mini">신규 회원으로 자동 등록됩니다.</p>'}

    <div class="row-form" style="margin-bottom:12px">
      <div><label class="mini">장보기 품목 추가</label>
        <select id="addMarket" onchange="addIntakeItem('market', this.value); this.value='';">
          <option value="">선택…</option>
          ${priceItems.map((p) => `<option value="${p.id}">${esc(p.name)} — ${won(p.sale_price)}</option>`).join('')}
        </select></div>
      <div><label class="mini">돌봄 서비스 추가</label>
        <select id="addCare" onchange="addIntakeItem('care', this.value); this.value='';">
          <option value="">선택…</option>
          ${menu.map((m) => `<option value="${m.id}">[${esc(m.category)}] ${esc(m.name)} — ${won(m.price)}</option>`).join('')}
        </select></div>
    </div>

    <table><thead><tr><th>구분</th><th>항목</th><th class="num">단가</th><th class="num">수량</th><th class="num">금액</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="muted">항목이 없습니다.</td></tr>'}</tbody></table>
    <p style="text-align:right;font-size:1.15rem"><b>합계 ${won(total)}</b></p>
    <label class="mini"><input type="checkbox" id="ikForce"> 한도 초과 접수 허용</label>
    <div style="margin-top:10px">
      <button class="btn btn-sm btn-primary" onclick="submitIntake()">접수 등록</button>
      <button class="btn btn-sm btn-ghost" onclick="state.intake.items=[];renderIntakeForm()">비우기</button>
    </div>
    <div id="intakeMsg"></div>`;
}

function addIntakeItem(source, id) {
  if (!id) return;
  const numId = Number(id);
  const item = source === 'market'
    ? state.catalog.priceItems.find((p) => p.id === numId)
    : state.catalog.categories.flatMap((c) => c.items).find((m) => m.id === numId);
  if (!item) return;
  const existing = state.intake.items.find((i) => i.source === source && i.refId === numId);
  if (existing) existing.qty += 1;
  else state.intake.items.push({ source, refId: numId, name: item.name, qty: 1, price: source === 'market' ? item.sale_price : item.price });
  renderIntakeForm();
}

async function submitIntake() {
  try {
    const d = await api('/api/admin/orders', {
      method: 'POST',
      body: {
        name: $('ikName').value.trim(), phone: $('ikPhone').value.trim(),
        address: $('ikAddress').value.trim(), channel: $('ikChannel').value,
        force: $('ikForce').checked,
        items: state.intake.items.map((i) => ({ source: i.source, refId: i.refId, qty: i.qty })),
      },
    });
    state.intake = { items: [], member: null };
    $('kkText').value = '';
    $('parseOut').innerHTML = '';
    renderIntakeForm();
    $('intakeMsg').innerHTML = `<div class="alert alert-ok">접수 완료 · 접수번호 ${esc(d.orderNo)} · 합계 ${won(d.total)} · 남은 잔액 ${won(d.balance.available)}</div>`;
  } catch (err) {
    $('intakeMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

/* ── 회원 관리 ── */
let memberQuery = '';

async function renderMembers() {
  const d = await api(`/api/admin/members?q=${encodeURIComponent(memberQuery)}`);
  $('view-members').innerHTML = `
    <div class="toolbar">
      <input id="mq" placeholder="이름·연락처 검색" value="${esc(memberQuery)}">
      <button class="btn btn-sm btn-primary" onclick="memberQuery=$('mq').value.trim();renderMembers()">조회</button>
      <a class="btn btn-sm btn-outline" href="/api/admin/members.csv?ym=${d.ym}">회원·잔액 CSV</a>
      <button class="btn btn-sm btn-outline" onclick="openMemberForm()">회원 추가</button>
      <span class="mini">${d.ym} 기준 · ${d.members.length}명</span>
    </div>
    <div class="table-scroll"><table>
      <thead><tr><th>이름</th><th>연락처</th><th>주소</th><th class="num">월 한도</th><th class="num">이월</th>
        <th class="num">포인트</th><th class="num">사용액</th><th class="num">잔액</th><th class="num">사용률</th><th>비고</th><th></th></tr></thead>
      <tbody>${d.members.map((m) => `<tr>
        <td><b>${esc(m.name)}</b>${m.active ? '' : ' <span class="mini">(비활성)</span>'}</td>
        <td class="mini">${esc(m.phone)}</td>
        <td class="mini">${esc(m.address) || '-'}</td>
        <td class="num">${won(m.monthly_limit)}</td>
        <td class="num">${won(m.balance.carryover)}</td>
        <td class="num">${Number(m.points).toLocaleString('ko-KR')}P</td>
        <td class="num">${won(m.balance.used)}</td>
        <td class="num"><b style="color:${m.balance.available <= 0 ? 'var(--red-600)' : m.balance.usageRate >= 80 ? 'var(--amber-600)' : 'var(--green-700)'}">${won(m.balance.available)}</b></td>
        <td class="num">${m.balance.usageRate}%</td>
        <td class="mini">${esc(m.note) || ''}</td>
        <td><button class="btn btn-sm btn-outline" onclick='openMemberForm(${JSON.stringify(m).replace(/'/g, "&#39;")})'>수정</button></td>
      </tr>`).join('') || '<tr><td colspan="11" class="muted">등록된 회원이 없습니다.</td></tr>'}</tbody>
    </table></div>`;
}

function openMemberForm(m) {
  const isNew = !m;
  $('dlgTitle').textContent = isNew ? '회원 추가' : `회원 수정 — ${m.name}`;
  $('dlgBody').innerHTML = `<div class="row-form">
      <div><label class="mini">이름 *</label><input id="mfName" value="${esc(m?.name)}"></div>
      <div><label class="mini">연락처 *</label><input id="mfPhone" value="${esc(m?.phone)}"></div>
      <div><label class="mini">생년월일</label><input id="mfBirth" value="${esc(m?.birth)}"></div>
      <div><label class="mini">비상연락처</label><input id="mfEmergency" value="${esc(m?.emergency_phone)}"></div>
      <div style="grid-column:1/-1"><label class="mini">주소</label><input id="mfAddress" value="${esc(m?.address)}"></div>
      <div><label class="mini">월 지역화폐 한도</label><input id="mfLimit" type="number" step="10000" value="${m?.monthly_limit ?? 200000}"></div>
      <div><label class="mini">보유 포인트</label><input id="mfPoints" type="number" value="${m?.points ?? 0}"></div>
      <div style="grid-column:1/-1"><label class="mini">비고</label><input id="mfNote" value="${esc(m?.note)}"></div>
    </div>
    <div id="mfMsg"></div>`;
  $('dlgFoot').innerHTML = `
    ${isNew ? '' : `<button class="btn btn-sm btn-danger" onclick="deleteMember(${m.id})">삭제</button>`}
    <button class="btn btn-sm btn-ghost" onclick="detailDlg.close()">취소</button>
    <button class="btn btn-sm btn-primary" onclick="saveMember(${isNew ? 'null' : m.id})">저장</button>`;
  detailDlg.showModal();
}

async function saveMember(id) {
  const body = {
    name: $('mfName').value.trim(), phone: $('mfPhone').value.trim(), birth: $('mfBirth').value.trim(),
    emergencyPhone: $('mfEmergency').value.trim(), address: $('mfAddress').value.trim(),
    monthlyLimit: Number($('mfLimit').value), points: Number($('mfPoints').value), note: $('mfNote').value.trim(),
  };
  try {
    if (id) await api(`/api/admin/members/${id}`, { method: 'PUT', body });
    else await api('/api/admin/members', { method: 'POST', body });
    detailDlg.close();
    renderMembers();
  } catch (err) {
    $('mfMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function deleteMember(id) {
  if (!confirm('이 회원을 삭제(또는 비활성)하시겠습니까?')) return;
  const d = await api(`/api/admin/members/${id}`, { method: 'DELETE' });
  detailDlg.close();
  if (d.message) alert(d.message);
  renderMembers();
}

/* ── 가격표 관리 ── */
async function renderPrices() {
  const d = await api('/api/admin/price-items');
  $('view-prices').innerHTML = `
    <div class="panel">
      <h3>품목 추가</h3>
      <div class="row-form">
        <input id="pfName" placeholder="품목명">
        <input id="pfCategory" placeholder="분류 (예: 신선식품)">
        <input id="pfUnit" placeholder="단위 (예: 1봉)">
        <input id="pfCost" type="number" placeholder="매입가">
        <input id="pfMargin" type="number" step="0.01" placeholder="마진율 (0.12 = 12%)">
        <button class="btn btn-sm btn-primary" onclick="addPriceItem()">추가</button>
      </div>
      <p class="mini">판매가를 비워 두면 매입가 × (1+마진율) 을 10원 단위로 반올림해 자동 계산합니다.</p>
    </div>
    <div class="table-scroll"><table>
      <thead><tr><th>품목명</th><th>분류</th><th>단위</th><th class="num">매입가</th><th class="num">마진율</th><th class="num">판매가</th><th class="num">마진액</th><th>사용</th><th></th></tr></thead>
      <tbody>${d.items.map((p) => `<tr data-id="${p.id}">
        <td><input class="inline-edit" value="${esc(p.name)}" data-f="name"></td>
        <td><input class="inline-edit" value="${esc(p.category)}" data-f="category"></td>
        <td><input class="inline-edit" value="${esc(p.unit)}" data-f="unit"></td>
        <td class="num"><input class="inline-edit num" type="number" value="${p.cost_price}" data-f="costPrice" style="text-align:right"></td>
        <td class="num"><input class="inline-edit" type="number" step="0.01" value="${p.margin_rate}" data-f="marginRate" style="text-align:right"></td>
        <td class="num"><input class="inline-edit" type="number" value="${p.sale_price}" data-f="salePrice" style="text-align:right"></td>
        <td class="num">${won(p.sale_price - p.cost_price)}</td>
        <td>${p.active ? '사용중' : '중지'}</td>
        <td><button class="btn btn-sm btn-primary" onclick="savePriceItem(${p.id})">저장</button>
            <button class="btn btn-sm btn-ghost" onclick="disablePriceItem(${p.id})">중지</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

function rowValues(id) {
  const tr = document.querySelector(`tr[data-id="${id}"]`);
  const out = {};
  tr.querySelectorAll('[data-f]').forEach((el) => { out[el.dataset.f] = el.value; });
  return out;
}

async function savePriceItem(id) {
  await api(`/api/admin/price-items/${id}`, { method: 'PUT', body: rowValues(id) });
  renderPrices();
}
async function disablePriceItem(id) {
  if (!confirm('이 품목을 판매 중지하시겠습니까?')) return;
  await api(`/api/admin/price-items/${id}`, { method: 'DELETE' });
  renderPrices();
}
async function addPriceItem() {
  try {
    await api('/api/admin/price-items', {
      method: 'POST',
      body: { name: $('pfName').value.trim(), category: $('pfCategory').value.trim(), unit: $('pfUnit').value.trim(),
              costPrice: Number($('pfCost').value || 0), marginRate: Number($('pfMargin').value || 0) },
    });
    renderPrices();
  } catch (err) { alert(err.message); }
}

/* ── 돌봄 메뉴 단가 ── */
async function renderMenus() {
  const d = await api('/api/admin/menu-items');
  $('view-menus').innerHTML = `
    <div class="panel">
      <h3>메뉴 항목 추가</h3>
      <div class="row-form">
        <input id="nfCategory" placeholder="분류 (예: 건강돌봄)">
        <input id="nfName" placeholder="서비스명">
        <input id="nfUnit" placeholder="단위 (예: 1회)">
        <input id="nfPrice" type="number" placeholder="단가">
        <input id="nfCost" type="number" placeholder="원가(인건비 등)">
        <input id="nfPoint" type="number" placeholder="적립 포인트">
        <button class="btn btn-sm btn-primary" onclick="addMenuItem()">추가</button>
      </div>
      <p class="mini" style="margin-top:8px">
        원가는 정산 마진 계산에 쓰입니다. 돌봄서비스는 인건비가 주 원가이며,
        운영 기준상 직접 서비스 인건비는 시간당 15,000~16,000원(가사간병·일상돌봄 바우처 단가 준용)입니다.
        원가를 비워 두면 정산에서 해당 항목의 마진이 매출과 같게 잡히므로 과대 계상됩니다.
      </p>
    </div>
    <div class="table-scroll"><table>
      <thead><tr><th>분류</th><th>서비스명</th><th>설명</th><th>단위</th><th class="num">단가</th>
        <th class="num">원가</th><th class="num">마진</th><th class="num">적립P</th><th>사용</th><th></th></tr></thead>
      <tbody>${d.items.map((m) => `<tr data-id="${m.id}">
        <td><input class="inline-edit" value="${esc(m.category)}" data-f="category" style="width:110px"></td>
        <td><input class="inline-edit" value="${esc(m.name)}" data-f="name"></td>
        <td><input class="inline-edit mini" value="${esc(m.description)}" data-f="description"></td>
        <td><input class="inline-edit" value="${esc(m.unit)}" data-f="unit" style="width:80px"></td>
        <td class="num"><input class="inline-edit" type="number" value="${m.price}" data-f="price" style="text-align:right;width:100px"></td>
        <td class="num"><input class="inline-edit" type="number" value="${m.cost_price || 0}" data-f="costPrice" style="text-align:right;width:100px"></td>
        <td class="num">${m.price > 0 && !m.cost_price
          ? '<span class="mini" style="color:var(--amber-600)">원가 미입력</span>'
          : `${won(m.price - (m.cost_price || 0))}${m.price > 0 ? ` <span class="mini">(${Math.round(((m.price - (m.cost_price || 0)) / m.price) * 100)}%)</span>` : ''}`}</td>
        <td class="num"><input class="inline-edit" type="number" value="${m.point_earn}" data-f="pointEarn" style="text-align:right;width:90px"></td>
        <td>${m.active ? '사용중' : '중지'}</td>
        <td><button class="btn btn-sm btn-primary" onclick="saveMenuItem(${m.id})">저장</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

async function saveMenuItem(id) {
  await api(`/api/admin/menu-items/${id}`, { method: 'PUT', body: rowValues(id) });
  renderMenus();
}
async function addMenuItem() {
  try {
    await api('/api/admin/menu-items', {
      method: 'POST',
      body: { category: $('nfCategory').value.trim(), name: $('nfName').value.trim(), unit: $('nfUnit').value.trim(),
              price: Number($('nfPrice').value || 0), costPrice: Number($('nfCost').value || 0),
              pointEarn: Number($('nfPoint').value || 0) },
    });
    renderMenus();
  } catch (err) { alert(err.message); }
}

/* ── 정산 ── */
function thisMonthRange() {
  const d = new Date();
  const first = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return [first, `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`];
}

async function renderSettlement(from, to) {
  const [df, dt] = thisMonthRange();
  from = from || df; to = to || dt;
  const d = await api(`/api/admin/settlement?from=${from}&to=${to}`);
  $('view-settlement').innerHTML = `
    <div class="toolbar">
      <input id="sf" type="date" value="${from}"> ~ <input id="st" type="date" value="${to}">
      <button class="btn btn-sm btn-primary" onclick="renderSettlement($('sf').value, $('st').value)">조회</button>
      <a class="btn btn-sm btn-outline" href="/api/admin/settlement.csv?from=${from}&to=${to}">CSV 내보내기 (지역화폐 사용내역 증빙용)</a>
    </div>
    <div class="kpi-grid">
      <div class="kpi"><div class="k">접수 건수</div><div class="v">${d.totals.orders}건</div></div>
      <div class="kpi"><div class="k">수납액(매출)</div><div class="v">${won(d.totals.revenue)}</div></div>
      <div class="kpi"><div class="k">매입원가</div><div class="v">${won(d.totals.cost)}</div></div>
      <div class="kpi"><div class="k">마진</div><div class="v">${won(d.totals.margin)}</div></div>
      <div class="kpi"><div class="k">돌봄서비스</div><div class="v">${won(d.totals.care)}</div></div>
      <div class="kpi"><div class="k">장보기</div><div class="v">${won(d.totals.market)}</div></div>
      ${d.totals.cancelFee ? `<div class="kpi warn"><div class="k">취소 위약금 (${d.totals.cancelCount}건)</div><div class="v">${won(d.totals.cancelFee)}</div></div>` : ''}
    </div>
    ${d.costWarning ? `<div class="alert alert-warn">
      원가가 입력되지 않은 돌봄서비스 항목 ${d.costWarning.count}종(매출 ${won(d.costWarning.amount)})이 있어 마진이 실제보다 크게 잡힙니다.
      <br><span class="mini">${d.costWarning.names.map(esc).join(', ')}${d.costWarning.count > d.costWarning.names.length ? ' 외' : ''}
      → "돌봄 메뉴 단가" 화면에서 원가를 입력해 주세요.</span>
    </div>` : ''}
    <div class="panel">
      <h3>회원별 집계</h3>
      <table><thead><tr><th>회원</th><th>연락처</th><th class="num">건수</th><th class="num">돌봄</th><th class="num">장보기</th><th class="num">합계</th><th class="num">매입원가</th><th class="num">마진</th></tr></thead>
      <tbody>${d.byMember.map((m) => `<tr><td>${esc(m.member)}</td><td class="mini">${esc(m.phone)}</td>
        <td class="num">${m.orders}</td><td class="num">${won(m.care)}</td><td class="num">${won(m.market)}</td>
        <td class="num"><b>${won(m.revenue)}</b></td><td class="num">${won(m.cost)}</td><td class="num">${won(m.margin)}</td></tr>`).join('')
        || '<tr><td colspan="8" class="muted">해당 기간 내역이 없습니다.</td></tr>'}</tbody></table>
    </div>
    <div class="panel">
      <h3>상세 내역 (${d.lines.length}행)</h3>
      <div class="table-scroll"><table>
        <thead><tr><th>접수번호</th><th>일시</th><th>회원</th><th>구분</th><th>항목</th><th class="num">단가</th><th class="num">수량</th><th class="num">금액</th></tr></thead>
        <tbody>${d.lines.map((l) => `<tr><td class="mini">${esc(l.order_no)}</td><td class="mini">${esc(l.created_at)}</td>
          <td>${esc(l.member_name)}</td><td>${l.source === 'market' ? '장보기' : '돌봄'}</td><td>${esc(l.item_name)}</td>
          <td class="num">${won(l.unit_price)}</td><td class="num">${l.qty}</td><td class="num">${won(l.subtotal)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
}

/* ── 설정 ── */
async function renderSettings() {
  const s = await api('/api/admin/settings');
  $('view-settings').innerHTML = `
    <div class="panel">
      <h3>운영 설정</h3>
      <div class="row-form">
        <div><label class="mini">기본 월 지역화폐 한도</label><input id="stLimit" type="number" step="10000" value="${s.defaultMonthlyLimit}"></div>
        <div><label class="mini">이월 사용</label>
          <select id="stCarry"><option value="1" ${s.carryoverEnabled ? 'selected' : ''}>사용</option><option value="0" ${s.carryoverEnabled ? '' : 'selected'}>사용 안 함</option></select></div>
        <div><label class="mini">이월 최대 금액</label><input id="stCarryMax" type="number" step="10000" value="${s.carryoverMax}"></div>
        <div><label class="mini">소액주문 취급비</label><input id="stFee" type="number" value="${s.smallOrderFee}"></div>
        <div><label class="mini">소액주문 기준 금액</label><input id="stThreshold" type="number" value="${s.smallOrderThreshold}"></div>
        <div><label class="mini">서비스명</label><input id="stService" value="${esc(s.serviceName)}"></div>
        <div><label class="mini">운영 기관명</label><input id="stOrg" value="${esc(s.orgName)}"></div>
      </div>
      <div style="margin-top:12px"><button class="btn btn-sm btn-primary" onclick="saveSettings()">저장</button></div>
      <div id="stMsg"></div>
      <p class="mini" style="margin-top:14px">
        · 이월 규칙: 전월 자기 한도의 미사용분을 1회, 최대 금액까지 다음 달로 이월합니다(설계서 1단계 반영).<br>
        · 관리자 비밀번호는 서버 환경변수 <code>ADMIN_PASSWORD</code> 로 변경합니다.
      </p>
    </div>`;
}

async function saveSettings() {
  try {
    await api('/api/admin/settings', {
      method: 'PUT',
      body: {
        defaultMonthlyLimit: Number($('stLimit').value), carryoverEnabled: $('stCarry').value === '1',
        carryoverMax: Number($('stCarryMax').value), smallOrderFee: Number($('stFee').value),
        smallOrderThreshold: Number($('stThreshold').value),
        serviceName: $('stService').value, orgName: $('stOrg').value,
      },
    });
    $('stMsg').innerHTML = '<div class="alert alert-ok">저장했습니다.</div>';
  } catch (err) {
    $('stMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

/* ── 시작 ── */
(async function start() {
  const me = await fetch('/api/admin/me').then((r) => r.json()).catch(() => ({ authenticated: false }));
  if (me.authenticated) { showApp(); boot(); } else { showLogin(); }
})();
