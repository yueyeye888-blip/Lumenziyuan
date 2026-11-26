import { withLocale } from './commerce/locale-html.mjs';
import { createHash } from 'node:crypto';

const escape = value => String(value || '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
})[c]);

const styles = `
:root {
  color-scheme: light;
  --canvas: #f4f7fb;
  --surface: #fff;
  --ink: #14233e;
  --muted: #53637a;
  --line: #e6ebf3;
  --accent: #2457e6;
  --accent-dark: #1e46bd;
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--ink);
  background: var(--canvas);
  font-size: 16px;
  line-height: 1.55;
}
* { box-sizing: border-box; }
body { margin: 0; min-width: 0; min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; }
header { background: var(--surface); border-bottom: 1px solid var(--line); }
.masthead {
  width: min(100% - 64px, 1200px);
  height: 68px;
  margin: 0 auto;
  display: flex;
  align-items: center;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: var(--ink);
  font-size: 21px;
  font-weight: 760;
  letter-spacing: -.055em;
  text-decoration: none;
}
.brand:hover { text-decoration: none; }
.mark {
  display: grid;
  place-items: center;
  width: 33px;
  height: 33px;
  border-radius: 10px;
  background: var(--accent);
  color: white;
  font-size: 20px;
  line-height: 1;
}
.brand small {
  padding-left: 12px;
  border-left: 1px solid #dce3ef;
  color: var(--muted);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: .025em;
}
main {
  flex: 1;
  display: grid;
  place-items: center;
  padding: clamp(30px, 6vh, 88px) 24px clamp(36px, 9vh, 112px);
  background: radial-gradient(ellipse at 15% 0%, #e9effc 0%, transparent 65%), var(--canvas);
}
.auth-layout {
  display: grid;
  grid-template-columns: minmax(0, .92fr) minmax(0, 1.08fr);
  width: min(100%, 1016px);
  min-height: 550px;
  border: 1px solid #dce5f1;
  border-radius: 24px;
  background: var(--surface);
  box-shadow: 0 24px 70px -42px #203b7952, 0 3px 12px #152a5508;
}
.welcome {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border-radius: 23px 0 0 23px;
  padding: clamp(34px, 4.8vw, 60px);
  color: #fff;
  background: radial-gradient(ellipse at 70% 96%, #274aa5 0%, transparent 70%), linear-gradient(150deg, #122350 6%, #172e75 100%);
}
.welcome::before {
  position: absolute;
  z-index: -1;
  inset: 0;
  content: "";
  background:
    repeating-linear-gradient(to right, #c2d3ff10 0 1px, transparent 1px 31px),
    repeating-linear-gradient(to bottom, #c2d3ff10 0 1px, transparent 1px 31px);
  mask-image: linear-gradient(transparent 16%, #000 100%);
}
.welcome-name {
  display: block;
  margin: 4px 0 18px;
  color: #d0dcfd;
  font-size: 14px;
  font-weight: 650;
}
.welcome-heading {
  font-size: clamp(30px, 3.2vw, 43px);
  font-weight: 720;
  letter-spacing: -.045em;
  line-height: 1.24;
}
.welcome-heading span { display: block; }
.orbit {
  position: absolute;
  z-index: -1;
  bottom: -125px;
  left: 28%;
  width: min(110%, 530px);
  aspect-ratio: 1;
  border: 1px solid #bed2ff4d;
  border-radius: 50%;
  transform: rotate(-24deg) scaleY(.8);
  background: radial-gradient(circle, #8eafff42 0%, transparent 55%);
}
.orbit::before,
.orbit::after {
  position: absolute;
  content: "";
  border: 1px solid #bed2ff53;
  border-radius: 50%;
  inset: 14%;
}
.orbit::after { inset: 29%; }
.orbit span {
  position: absolute;
  top: 9%;
  left: 23%;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #c6d8ff;
  box-shadow: 0 0 20px 2px #94b4ff73;
}
.card {
  align-self: center;
  width: 100%;
  min-width: 0;
  padding: clamp(32px, 5.4vw, 72px);
}
h1 {
  margin: 0;
  font-size: clamp(29px, 3.5vw, 38px);
  font-weight: 730;
  line-height: 1.2;
  letter-spacing: -.05em;
  overflow-wrap: break-word;
}
p { margin: 0; }
.lead { color: var(--muted); font-size: 15px; margin: 12px 0 26px; }
.lead b { color: var(--ink); overflow-wrap: anywhere; }
.steps { list-style: none; padding: 0; display: flex; gap: 10px; margin: 0 0 23px; }
.steps li { flex: 1; display: grid; gap: 8px; color: var(--muted); font-size: 13px; font-weight: 550; }
.steps li::before { content: ""; height: 3px; background: #e3eaf4; border-radius: 5px; }
.steps li.current, .steps li.done { color: var(--accent-dark); }
.steps li.current::before { background: var(--accent); }
.steps li.done::before { background: #88a4f7; }
form { margin: 0; }
.fields { display: grid; gap: 18px; }
.field { min-width: 0; }
label { display: block; font-weight: 650; font-size: 14px; margin-bottom: 7px; }
.field-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.field-head a { font-size: 13px; }
input {
  width: 100%;
  min-height: 50px;
  padding: 11px 14px;
  border: 1px solid #c8d4e5;
  border-radius: 11px;
  color: var(--ink);
  background: var(--surface);
  font: inherit;
  transition: border-color .15s, box-shadow .15s;
}
input::placeholder { color: #65748b; font-size: 14px; }
input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px #2457e620; }
.password { position: relative; }
.password input { padding-right: 67px; }
button { font: inherit; cursor: pointer; }
.reveal {
  position: absolute;
  top: 50%;
  right: 5px;
  min-width: 46px;
  min-height: 40px;
  padding: 5px;
  transform: translateY(-50%);
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--accent-dark);
  font-size: 13px;
}
.reveal:hover { background: #eff4ff; }
.reveal[hidden] { display: none; }
.code { font-variant-numeric: tabular-nums; letter-spacing: .18em; }
.code::placeholder { letter-spacing: normal; }
.hint { display: block; color: var(--muted); margin-top: 6px; font-size: 13px; }
.primary {
  width: 100%;
  min-height: 50px;
  margin-top: 23px;
  padding: 10px 14px;
  border: 1px solid var(--accent);
  border-radius: 11px;
  background: var(--accent);
  color: white;
  font-size: 15px;
  font-weight: 650;
  transition: background .15s, border-color .15s;
}
.primary:hover { background: var(--accent-dark); border-color: var(--accent-dark); }
a, .link-button { color: var(--accent-dark); font-weight: 620; text-underline-offset: 3px; text-decoration: none; }
.link-button { border: 0; padding: 0; background: none; font-size: inherit; }
a:hover, .link-button:hover { text-decoration: underline; }
.aux { display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: center; margin-top: 15px; font-size: 14px; }
footer { border-top: 1px solid var(--line); margin-top: 25px; padding-top: 20px; color: var(--muted); text-align: center; font-size: 14px; }
.employee { margin-top: 8px; font-size: 13px; }
.notice { border: 1px solid #d5e2fa; border-radius: 10px; padding: 11px 13px; margin: 0 0 18px; background: #eff5ff; color: #234575; font-size: 14px; overflow-wrap: anywhere; }
.error { border-color: #f0d5d2; background: #fff3f1; color: #972d29; }
a:focus-visible, button:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
@media (max-width: 720px) {
  .masthead { width: calc(100% - 40px); height: 62px; }
  .auth-layout { display: block; width: min(100%, 450px); min-height: 0; border-radius: 19px; }
  .welcome { display: none; }
  .card { padding: 28px 27px; }
}
@media (max-width: 420px) {
  main { align-items: start; padding: 24px 14px 36px; }
  .masthead { width: calc(100% - 32px); }
  .card { padding: 25px 20px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; }
}
`;

const authScript = `document.querySelectorAll('[data-reveal]').forEach(button => {
  const input = document.getElementById(button.getAttribute('aria-controls'));
  button.hidden = false;
  button.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? '隐藏' : '显示';
    button.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    button.setAttribute('aria-pressed', String(show));
  });
});
const loginForm = document.querySelector('[data-fresh-login]');
if (loginForm) {
  const fields = loginForm.querySelectorAll('input:not([type="hidden"])');
  function resetLoginFields() {
    loginForm.reset();
    fields.forEach(input => {
      if (document.activeElement === input) input.blur();
      input.readOnly = true;
    });
  }
  resetLoginFields();
  fields.forEach(input => {
    const enableEntry = () => { input.readOnly = false; };
    input.addEventListener('pointerdown', enableEntry);
    input.addEventListener('focus', enableEntry);
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) resetLoginFields();
  });
}`;
const scriptHash = createHash('sha256').update(authScript).digest('base64');

function page(res, status, title, content) {
  res.writeHead(status, {
    'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin',
    'content-security-policy':`default-src 'none'; script-src 'self' 'sha256-${scriptHash}'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  });
  res.end(withLocale(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title} · Yorke AI 资源中心</title><style>${styles}</style></head><body>
    <header><div class="masthead"><a class="brand" aria-label="Yorke AI 资源中心首页" href="/"><span class="mark" aria-hidden="true">Y</span>Yorke AI<small>资源中心</small></a></div></header>
    <main><div class="auth-layout">
      <div class="welcome" aria-hidden="true">
        <span class="welcome-name">Yorke AI 资源中心</span>
        <p class="welcome-heading"><span>选购资源</span><span>管理余额与订单</span></p>
        <div class="orbit"><span></span></div>
      </div>
      <section class="card" aria-labelledby="title"><h1 id="title">${title}</h1>${content}</section>
    </div></main>
    <script>${authScript}</script></body></html>`));
}

function notice(error, message) {
  if (error) return `<p class="notice error" role="alert">${escape(error)}</p>`;
  if (message) return `<p class="notice" role="status">${escape(message)}</p>`;
  return '';
}

function emailInput(email='') {
  return `<div class="field"><label for="email">邮箱地址</label><input id="email" name="email" type="email" inputmode="email" autocapitalize="none" spellcheck="false"
    autocomplete="off" maxlength="254" placeholder="请输入邮箱地址"${email ? ` value="${escape(email)}"` : ''} required></div>`;
}

function passwordInput(isNew, label) {
  // The sign-in form starts blank. The new-password hint discourages credential autofill.
  return `<div class="field"><div class="field-head"><label for="password">${label}</label>${isNew ? '' : '<a href="/__host/forgot">忘记密码？</a>'}</div>
    <div class="password"><input id="password" name="password" type="password" autocomplete="new-password"
    ${isNew ? 'minlength="12" aria-describedby="password-hint"' : ''} maxlength="128" required>
    <button hidden data-reveal type="button" aria-controls="password" aria-label="显示密码" aria-pressed="false" class="reveal">显示</button></div>
    ${isNew ? '<small class="hint" id="password-hint">使用 12–128 个字符。</small>' : ''}</div>`;
}

export function login(res, destination, error='', passwordChanged=false) {
  page(res,200,'登录账号',`<p class="lead">使用账号邮箱登录 Yorke AI 资源中心。</p>
    ${notice(error,passwordChanged?'登录密码已更新，请使用新密码登录。':'')}
    <form method="post" action="/__host/login" autocomplete="off" data-fresh-login><input type="hidden" name="returnTo" value="${escape(destination)}">
    <div class="fields">${emailInput()}${passwordInput(false,'登录密码')}</div><button class="primary">登录</button></form>
    <footer>还没有账号？ <a href="/__host/register">创建账号</a></footer>`);
}

export function registrationPage(res, { status=200, email='', verify=false, error='', message='', reset=false }={}) {
  const base=reset?'/__host/forgot':'/__host/register';
  const title=reset?'找回登录密码':'创建账号';
  const steps = `<ol class="steps" aria-label="${title}进度"><li class="${verify?'done':'current'}" ${verify?'':'aria-current="step"'}>填写邮箱</li>
    <li class="${verify?'current':''}" ${verify?'aria-current="step"':''}>${reset?'重设密码':'验证并注册'}</li></ol>`;
  const intro = verify
    ? `输入 <b>${escape(email)}</b> 收到的六位验证码。`
    : reset?'填写账号使用的邮箱，即可接收重置密码的验证码。':'使用邮箱注册，即可进入资源工作台。';
  const hiddenEmail=`<input type="hidden" name="email" value="${escape(email)}">`;
  const form=verify ? `
    <form method="post" action="${base}/verify">${hiddenEmail}<div class="fields">
    <div class="field"><label for="code">邮箱验证码</label><input class="code" id="code" name="code" inputmode="numeric"
    autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" minlength="6" placeholder="6 位数字" required></div>
    ${passwordInput(true,reset?'新登录密码':'设置登录密码')}</div><button class="primary">${reset?'重设登录密码':'注册并登录'}</button></form>
    <form class="aux" method="post" action="${base}/code">${hiddenEmail}<button class="link-button">重新发送验证码</button><a href="${base}">更换邮箱</a></form>`
    : `<form method="post" action="${base}/code" autocomplete="off">${emailInput(email)}<button class="primary">发送验证码</button></form>`;
  page(res,status,title,`<p class="lead">${intro}</p>${steps}${notice(error,message)}${form}
    <footer>${reset?'<a href="/__host/login">返回登录</a>':'已有账号？ <a href="/__host/login">登录</a><p class="employee">合伙人账号由管理员统一创建。</p>'}</footer>`);
}
