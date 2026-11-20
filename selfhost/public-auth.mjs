const esc = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const styles = `
*{box-sizing:border-box}body{font:16px/1.55 system-ui,sans-serif;margin:0;background:#f3f6fb;color:#193359;display:grid;min-height:100vh;min-height:100dvh;place-items:center;padding:20px}
main{width:min(100%,420px);padding:32px;border-radius:18px;background:white;border:1px solid #d8e1ee;box-shadow:0 10px 35px #1835570c}h1{font-size:25px;margin:0 0 16px}
label{display:block;font-weight:550;margin:18px 0}input,button{display:block;width:100%;font:inherit;padding:10px 12px;border-radius:8px}
input{margin-top:6px;border:1px solid #bac8d9;color:#193359}button{background:#1e4280;border:1px solid #1e4280;color:white;cursor:pointer;font-weight:600}
a{color:#184ea2}.note{color:#4e6078;font-size:14px}.error{color:#982321;background:#fff1ef;padding:8px 12px;border-radius:6px}
.secondary{display:inline-block;color:#184ea2;background:transparent;border:0;padding:0;width:auto;text-decoration:underline;font-weight:400}
footer{border-top:1px solid #e2e8f0;margin-top:20px;padding-top:16px;font-size:14px}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #4278db;outline-offset:3px}
`;
function page(res, status, title, content) {
  res.writeHead(status, { 'content-type':'text/html; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff', 'referrer-policy':'same-origin',
    'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" });
  res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Lumen</title><style>${styles}</style></head><body><main><h1>${title}</h1>${content}</main></body></html>`);
}
const notice = error => error ? `<p class="error" role="alert">${esc(error)}</p>` : '';
export function login(res, destination, error = '') {
  page(res,200,'Lumen 资源申购中心',`${notice(error)}<form method="post" action="/__host/login">
    <input type="hidden" name="returnTo" value="${esc(destination)}"><label>邮箱<input type="email" name="email" autocomplete="username" required></label>
    <label>登录密码<input type="password" name="password" autocomplete="current-password" required></label>
    <button>登录</button></form><footer>首次使用？ <a href="/__host/register">注册账号</a></footer>`);
}
export function registrationPage(res, { status=200, email='', verify=false, error='', message='' }={}) {
  const emailField = `<label>邮箱<input name="email" type="email" autocomplete="email" maxlength="254" required value="${esc(email)}"${verify?' readonly':''}></label>`;
  const form = verify ? `<form method="post" action="/__host/register/verify">${emailField}
    <label>邮箱验证码<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" minlength="6" required></label>
    <label>设置登录密码<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" aria-describedby="password-hint" required></label>
    <p id="password-hint" class="note">请使用 12–128 位密码。</p><button>注册并登录</button></form>
    <form method="post" action="/__host/register/code"><input type="hidden" name="email" value="${esc(email)}">
    <p><button class="secondary">重新发送验证码</button> · <a href="/__host/register">更换邮箱</a></p></form>`
    : `<form method="post" action="/__host/register/code">${emailField}<button>发送验证码</button></form>`;
  page(res,status,'注册 Lumen 账号',`${notice(error)}${message?`<p class="note" role="status">${esc(message)}</p>`:''}${form}<footer>已有账号？ <a href="/__host/login">登录</a></footer>`);
}
