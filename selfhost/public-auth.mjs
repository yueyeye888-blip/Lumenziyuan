import { createHash } from 'node:crypto';

const escape = value => String(value || '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
})[c]);

const styles = `
:root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#172b48;background:#f5f7fa;font-size:16px;line-height:1.55}
*{box-sizing:border-box}body{min-height:100vh;min-height:100dvh;margin:0;display:flex;flex-direction:column}
header{height:72px;flex:none;background:white;border-bottom:1px solid #dfe6ee;display:flex;align-items:center;padding:0 max(5vw,24px)}
.brand{display:inline-flex;align-items:center;gap:11px;color:#172d4c;text-decoration:none;font-size:23px;font-weight:740;letter-spacing:-1px}
.mark{width:32px;height:32px;border-radius:9px;background:linear-gradient(145deg,#3355b0,#183a77);display:grid;place-items:center;color:white;font-size:21px;font-weight:740;line-height:1}
.brand small{font-size:14px;font-weight:550;letter-spacing:.035em;border-left:1px solid #c9d4e2;padding-left:13px;margin-left:2px;color:#46596e}
main{flex:1;display:grid;place-items:center;padding:clamp(30px,6vh,76px) 18px clamp(40px,10vh,120px);background:radial-gradient(ellipse at 12% 18%,#e7edf7 0,transparent 42%),radial-gradient(ellipse at 91% 80%,#e7f0f4 0,transparent 40%),#f5f7fa}
.card{width:min(100%,468px);padding:clamp(24px,5vw,42px);border:1px solid #dce4ed;border-radius:18px;background:#fff;box-shadow:0 3px 8px #17325306,0 18px 48px -24px #25496845}
h1{font-size:clamp(27px,4vw,33px);line-height:1.28;margin:0;color:#152841;letter-spacing:-.045em;font-weight:690}p{margin:0}
.lead{color:#55677c;font-size:15px;margin:9px 0 26px}.lead b{color:#203e60;overflow-wrap:anywhere}
.steps{list-style:none;padding:0;display:flex;gap:8px;margin:0 0 26px}.steps li{flex:1;display:grid;gap:6px;color:#647386;font-size:13px;font-weight:550}.steps li:before{content:"";height:3px;background:#dee5ee;border-radius:5px}.steps li.current,.steps li.done{color:#27568a}.steps li.current:before{background:#235698}.steps li.done:before{background:#93b4d6}
form{margin:0}.fields{display:grid;gap:18px}.field{min-width:0}label{display:block;font-weight:600;font-size:15px;margin-bottom:7px}.field-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px}.field-head a{font-size:14px}
input{width:100%;min-height:48px;border-radius:8px;border:1px solid #b9c7d8;color:#172b48;font:inherit;padding:10px 13px;transition:border-color .15s;background:#fff}input::placeholder{color:#718296;font-size:15px}
input:focus{border-color:#3265a5;outline:3px solid #dbe9f8;outline-offset:0}.password{position:relative}.password input{padding-right:60px}
button{font:inherit;cursor:pointer}.reveal{position:absolute;right:8px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:#37608e;font-size:14px;padding:8px}.reveal[hidden]{display:none}
.code{font-variant-numeric:tabular-nums;letter-spacing:.18em}.code::placeholder{letter-spacing:normal}.hint{display:block;font-size:14px;color:#596a7c;margin-top:5px}
.primary{margin-top:23px;border:1px solid #254f80;border-radius:8px;min-height:48px;width:100%;background:#244e80;color:white;font-size:16px;font-weight:630;transition:background .15s}.primary:hover{background:#183f70}
a,.link-button{color:#214f86;text-underline-offset:3px;text-decoration:none}.link-button{border:0;padding:0;background:none;font-size:14px}a:hover,.link-button:hover{text-decoration:underline}.aux{display:flex;gap:20px;align-items:center;margin-top:14px;font-size:14px}.aux input{display:none}
footer{border-top:1px solid #e4e9ef;margin-top:25px;padding-top:18px;text-align:center;color:#516378;font-size:14px}footer a{font-weight:620;margin-left:5px}.employee{margin-top:8px;font-size:13px}
.notice{border-radius:8px;padding:11px 13px;margin:0 0 18px;font-size:14px;background:#edf4f9;color:#254d69;overflow-wrap:anywhere}.error{background:#fff2ee;color:#8f3423}
a:focus-visible,button:focus-visible{outline:3px solid #3772b0;outline-offset:3px}
@media(max-width:520px){header{height:60px;padding-inline:20px}.brand{font-size:21px}main{align-items:start;padding-top:24px}.card{border-radius:14px;padding:24px 20px}.lead{margin-bottom:22px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
`;

const passwordToggle = `document.querySelectorAll('[data-reveal]').forEach(button => {
  const input = document.getElementById(button.getAttribute('aria-controls'));
  button.hidden = false;
  button.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? '隐藏' : '显示';
    button.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    button.setAttribute('aria-pressed', String(show));
  });
});`;
const scriptHash = createHash('sha256').update(passwordToggle).digest('base64');

function page(res, status, title, content) {
  res.writeHead(status, {
    'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin',
    'content-security-policy':`default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  });
  res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title} · Lumen 资源中心</title><style>${styles}</style></head><body>
    <header><a class="brand" aria-label="Lumen 资源中心首页" href="/"><span class="mark" aria-hidden="true">L</span>Lumen<small>资源中心</small></a></header>
    <main><section class="card" aria-labelledby="title"><h1 id="title">${title}</h1>${content}</section></main>
    <script>${passwordToggle}</script></body></html>`);
}

function notice(error, message) {
  if (error) return `<p class="notice error" role="alert">${escape(error)}</p>`;
  if (message) return `<p class="notice" role="status">${escape(message)}</p>`;
  return '';
}

function emailInput(autocomplete='email', email='') {
  return `<div class="field"><label for="email">邮箱地址</label><input id="email" name="email" type="email" inputmode="email"
    autocomplete="${autocomplete}" maxlength="254" placeholder="name@example.com" value="${escape(email)}" required></div>`;
}

function passwordInput(isNew, label) {
  return `<div class="field"><div class="field-head"><label for="password">${label}</label>${isNew ? '' : '<a href="/__host/forgot">忘记密码？</a>'}</div>
    <div class="password"><input id="password" name="password" type="password" autocomplete="${isNew ? 'new-password' : 'current-password'}"
    ${isNew ? 'minlength="12" aria-describedby="password-hint"' : ''} maxlength="128" required>
    <button hidden data-reveal type="button" aria-controls="password" aria-label="显示密码" aria-pressed="false" class="reveal">显示</button></div>
    ${isNew ? '<small class="hint" id="password-hint">使用 12–128 个字符。</small>' : ''}</div>`;
}

export function login(res, destination, error='', passwordChanged=false) {
  page(res,200,'登录账号',`<p class="lead">使用账号邮箱登录 Lumen 资源中心。</p>
    ${notice(error,passwordChanged?'登录密码已更新，请使用新密码登录。':'')}
    <form method="post" action="/__host/login"><input type="hidden" name="returnTo" value="${escape(destination)}">
    <div class="fields">${emailInput('username')}${passwordInput(false,'登录密码')}</div><button class="primary">登录</button></form>
    <footer>还没有账号？<a href="/__host/register">创建账号</a></footer>`);
}

export function registrationPage(res, { status=200, email='', verify=false, error='', message='', reset=false }={}) {
  const base=reset?'/__host/forgot':'/__host/register';
  const title=reset?'找回登录密码':'创建账号';
  const steps = `<ol class="steps" aria-label="${title}进度"><li class="${verify?'done':'current'}" ${verify?'':'aria-current="step"'}>填写邮箱</li>
    <li class="${verify?'current':''}" ${verify?'aria-current="step"':''}>${reset?'重设密码':'验证并注册'}</li></ol>`;
  const intro = verify
    ? `输入 <b>${escape(email)}</b> 收到的六位验证码。`
    : reset?'填写账号使用的邮箱，即可接收重置密码的验证码。':'使用邮箱注册，即可进入资源市场。';
  const hiddenEmail=`<input type="hidden" name="email" value="${escape(email)}">`;
  const form=verify ? `
    <form method="post" action="${base}/verify">${hiddenEmail}<div class="fields">
    <div class="field"><label for="code">邮箱验证码</label><input class="code" id="code" name="code" inputmode="numeric"
    autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" minlength="6" placeholder="6 位数字" required></div>
    ${passwordInput(true,reset?'新登录密码':'设置登录密码')}</div><button class="primary">${reset?'重设登录密码':'注册并登录'}</button></form>
    <form class="aux" method="post" action="${base}/code">${hiddenEmail}<button class="link-button">重新发送验证码</button><a href="${base}">更换邮箱</a></form>`
    : `<form method="post" action="${base}/code">${emailInput('email',email)}<button class="primary">发送验证码</button></form>`;
  page(res,status,title,`<p class="lead">${intro}</p>${steps}${notice(error,message)}${form}
    <footer>${reset?'<a href="/__host/login">返回登录</a>':'已有账号？<a href="/__host/login">登录</a><p class="employee">员工账号由管理员统一创建。</p>'}</footer>`);
}
