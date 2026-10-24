// 매주 금요일 GitHub Actions 에서 자동 실행
// 1) 다음 주 신청 일정 만들기  2) 오후 2시 30분 마감 뒤 배정안 만들기  3) 오후 4시 발표 + 결과 메일
// 실행 시각이 조금 일러도 해당 시각까지 기다렸다가 진행하고, 이미 끝난 단계는 건너뜁니다.
const nodemailer = require('nodemailer');
const P = require('../parking-core.js');

const APP_URL = 'https://cgn210-alt.github.io/cgn-parking/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(t) {
  const ms = t - Date.now();
  if (ms > 0) { console.log(`${Math.round(ms / 1000)}초 기다림`); await sleep(ms); }
}

// Firebase 데이터베이스 비밀번호로 REST API 에 접속 (조직 정책으로 서비스 계정 키를 만들 수 없어서 이 방식을 씀)
// parking-core.js 가 쓰는 ref().once / set / transaction / orderByKey().startAt().endAt() 만 흉내 냄
const DB_URL = process.env.FIREBASE_DATABASE_URL.replace(/\/$/, '');
const SECRET = process.env.FIREBASE_DB_SECRET;
function url(path, q) {
  const u = new URL(`${DB_URL}/${path}.json`);
  u.searchParams.set('auth', SECRET);
  Object.entries(q || {}).forEach(([k, v]) => u.searchParams.set(k, JSON.stringify(v)));
  return u;
}
async function req(method, path, body, headers, q) {
  const res = await fetch(url(path, q), { method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 412) return { conflict: true };
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return { data: await res.json(), etag: res.headers.get('etag') };
}
const snap = (v) => ({ val: () => v });
function ref(path, q) {
  return {
    orderByKey: () => ref(path, Object.assign({}, q, { orderBy: '$key' })),
    startAt: (v) => ref(path, Object.assign({}, q, { startAt: v })),
    endAt: (v) => ref(path, Object.assign({}, q, { endAt: v })),
    once: async () => snap((await req('GET', path, undefined, {}, q)).data),
    set: async (v) => { await req('PUT', path, v); },
    // 읽은 뒤 바뀌지 않았을 때만 쓰기 (ETag), 그사이 바뀌었으면 다시 읽어서 재시도
    transaction: async (fn) => {
      for (let i = 0; i < 10; i++) {
        const cur = await req('GET', path, undefined, { 'X-Firebase-ETag': 'true' });
        const next = fn(cur.data);
        if (next === undefined) return { committed: false };
        const r = await req('PUT', path, next, { 'if-match': cur.etag });
        if (!r.conflict) return { committed: true };
      }
      throw new Error('transaction 재시도 초과: ' + path);
    },
  };
}
const db = { ref: (path) => ref(path) };
const get = async (path) => (await P.ref(db, path).once('value')).val();

async function main() {
  const wk = P.nextWeek();
  console.log(`대상 주: ${wk} (지금 ${new Date().toISOString()})`);

  // 1) 신청 일정 (마스터가 미리 바꿔 둔 일정이 있으면 그대로 두고 그 시각을 따름)
  if (!(await get('weeks/' + wk)) && Date.now() >= P.schedule(wk).openAt - 3600000) await P.ensureWeek(db, wk);
  const week = await get('weeks/' + wk);
  if (!week) { console.log('아직 신청 일정 전'); return; }
  const sc = P.schedule(wk, week);
  console.log(`일정: 신청 ${P.when(sc.openAt)} ~ ${P.when(sc.closeAt)}, 발표 ${P.when(sc.publishAt)}`);
  if (week.publishedAt) { await sendMails(wk); return; }   // 이미 발표된 주 → 못 보낸 메일만
  if (Date.now() < sc.closeAt - 20 * 60000) { console.log('신청 일정 확인 완료'); return; }

  // 2) 마감 뒤 배정안
  await waitUntil(sc.closeAt + 5000);
  const users = (await get('users')) || {};
  await P.ensureDraft(db, wk, users);
  console.log('배정안 확인 완료');
  if (Date.now() < sc.publishAt - 30 * 60000) return;

  // 3) 오후 4시 발표 + 메일
  await waitUntil(sc.publishAt + 5000);
  await P.publish(db, wk, (await get('users')) || {});
  console.log('발표 완료');
  await sendMails(wk);
}

function transport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: +(process.env.SMTP_PORT || 587),
    secure: +(process.env.SMTP_PORT || 587) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

// 수동 실행에서 test-mail 을 고르면: 배정은 건드리지 않고 시험 메일 한 통만 보냄
async function testMail() {
  if (!process.env.SMTP_HOST) throw new Error('SMTP_HOST 가 없습니다');
  const tr = transport();
  await tr.verify();
  console.log('메일 서버 로그인 성공');
  const info = await tr.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.TEST_TO,
    subject: '[CGN 주차] 시험 메일',
    text: '주차 배정 결과 메일 발송 시험입니다.\n이 메일이 보이면 금요일 오후 4시 결과 메일도 같은 방법으로 발송됩니다.\n\n' + APP_URL,
  });
  console.log(`시험 메일 발송: ${process.env.TEST_TO} (${info.response})`);
}

async function sendMails(wk) {
  const week = await get('weeks/' + wk);
  if (!week || !week.publishedAt) return console.log('발표 전이라 메일을 보내지 않음');
  if (!process.env.SMTP_HOST) return console.log('SMTP 설정이 없어 메일을 보내지 않음');
  const tr = transport();
  const users = (await get('users')) || {};
  const apps = (await get('apps/' + wk)) || {};
  const dates = Object.keys(week.days || {}).sort();
  const days = {};
  for (const k of dates) days[k] = (await get('days/' + k)) || {};
  const mailed = week.mailed || {};
  const pen = ((await get('drafts/' + wk)) || {}).penalized || {};
  const range = `${P.shortLabel(wk)}~${P.shortLabel(P.addDays(wk, 4))}`;
  let sent = 0;

  for (const uid of Object.keys(apps)) {
    const u = users[uid];
    if (!u || !u.email || mailed[uid]) continue;
    const lines = dates.filter((k) => apps[uid].dates && apps[uid].dates[k]).map((k) => {
      const s = days[k].seats && days[k].seats[uid];
      const r = !s ? (pen[uid] ? '미도착 패널티로 제외' : '미배정') : s.lot === 'wait' ? `대기 ${s.order}번` : s.lot === 'annex' ? '별관' : '남경';
      return `${P.label(k)}  ${r}`;
    });
    const hasAnnex = lines.some((l) => l.endsWith('별관'));
    const text = [
      `${u.name} 님, 다음 주(${range}) 주차 배정 결과입니다.`, '',
      ...lines, '',
      hasAnnex ? '별관은 주차 후 퇴근 시까지 출차가 어렵습니다.' : '',
      pen[uid] ? `${pen[uid].map(P.shortLabel).join(', ')} 배정을 반납 없이 이용하지 않아 이번 주는 배정에서 제외되었습니다.` : '',
      '못 오게 되면 앱에서 반납해 주세요. 당일 오전 9시까지 \'주차 완료\'를 누르지 않으면 대기자에게 넘어갑니다.',
      '대기 순번은 반납이나 미도착 해제가 생기면 자동으로 올라갑니다.', '',
      APP_URL,
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
    try {
      await tr.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: u.email, subject: `[CGN 주차] 다음 주(${range}) 배정 결과`, text });
      await P.ref(db, `weeks/${wk}/mailed/${uid}`).set(true);
      sent++;
    } catch (e) {
      console.error(`메일 실패: ${u.email} ${e.message}`);
    }
  }
  await P.ref(db, `weeks/${wk}/emailedAt`).set(Date.now());
  console.log(`메일 ${sent}통 발송`);
}

(process.env.MODE === 'test-mail' ? testMail() : main()).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
