(() => {
  function addWalletLink() {
    if (document.getElementById('lumen-wallet-link')) return;
    const trigger = [...document.querySelectorAll('button,a')].find(
      (el) => /^我的购买$|^资源市场$/.test(el.textContent.trim()) && el.closest('aside,nav'),
    );
    if (!trigger) return;
    const a = document.createElement('a');
    a.href = '/__host/wallet';
    a.id = 'lumen-wallet-link';
    a.textContent = '我的钱包 · 充值';
    a.className = trigger.className;
    trigger.parentElement.append(a);
  }
  const observer = new MutationObserver(addWalletLink);
  observer.observe(document.body, { subtree: true, childList: true });
  addWalletLink();
  const financeNav = () => {
    if (document.getElementById('lumen-wallet-link')) return;
    const el = document.createElement('a');
    el.id = 'lumen-wallet-link';
    el.href = '/__host/wallet';
    el.textContent = '钱包与充值';
    el.style.cssText =
      'display:block;text-align:right;background:#edf3fb;color:#284e77;padding:.45rem 1.2rem;font:600 14px system-ui';
    document.body.prepend(el);
  };
  setTimeout(financeNav, 1200);
  function paymentPin() {
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.style.cssText =
        'margin:auto;padding:24px;border:1px solid #c9d8e8;border-radius:14px;color:#243d64;max-width:94vw';
      dialog.innerHTML =
        '<form method="dialog"><h2>地址生成 · 10 U</h2><p>提交时预留 10 U，交付完成后扣款，失败会释放余额。</p><label>六位支付密码 <input type="password" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required autocomplete="off"></label><p><a href="/__host/wallet">充值或设置支付密码</a></p><div><button value="cancel" formnovalidate>取消</button>　<button value="ok">确认提交</button></div></form>';
      document.body.append(dialog);
      dialog.onclose = () => {
        const pin = dialog.returnValue === 'ok' ? dialog.querySelector('input').value : null;
        dialog.remove();
        resolve(pin);
      };
      dialog.showModal();
      dialog.querySelector('input').focus();
    });
  }
  window.lumenSubmitAddress = async function (path, options) {
    const pin = await paymentPin();
    if (!pin) return Response.json({ error: '已取消提交。' }, { status: 400 });
    const fingerprint = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(options.body))),
      (x) => x.toString(16).padStart(2, '0'),
    ).join('');
    const name = 'lumen-address:' + fingerprint,
      key = sessionStorage.getItem(name) || crypto.randomUUID();
    sessionStorage.setItem(name, key);
    const res = await fetch(path, {
      ...options,
      headers: { ...options.headers, 'idempotency-key': key },
      body: JSON.stringify({ ...JSON.parse(options.body), pin }),
    });
    if (res.ok || (res.status >= 400 && res.status < 500)) sessionStorage.removeItem(name);
    return res;
  };
})();
