import { createHmac, randomUUID } from 'node:crypto';

export class SupplierError extends Error {
  constructor(code) {
    super('eSIMAccess request failed');
    this.code = code;
  }
}

export function createEsimSupplier(bindings, fetcher = fetch) {
  const access = bindings.ESIM_ACCESS_CODE;
  const secret = bindings.ESIM_SECRET_KEY;
  async function request(endpoint, fields) {
    if (!access || !secret) throw new SupplierError('not_configured');
    const timestamp = String(Date.now());
    const requestId = randomUUID().replaceAll('-', '');
    const body = JSON.stringify(fields);
    const signature = createHmac('sha256', secret).update(timestamp + requestId + access + body).digest('hex');
    const reply = await fetcher('https://api.esimaccess.com/api/v1/open/' + endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), body,
      headers: { 'content-type': 'application/json', 'RT-AccessCode': access, 'RT-RequestID': requestId, 'RT-Timestamp': timestamp, 'RT-Signature': signature },
    });
    if (!reply.ok) throw new SupplierError('http_failure');
    const result = await reply.json();
    if (result?.success !== true && result?.success !== 'true') throw new SupplierError(String(result?.errorCode ?? 'unknown'));
    if (!result.obj) throw new SupplierError('unknown');
    return result.obj;
  }
  return {
    async catalog() {
      const { packageList } = await request('package/list', { locationCode: '', type: 'BASE', packageCode: '', iccid: '' });
      if (!Array.isArray(packageList)) throw new SupplierError('unknown');
      return packageList;
    },
    async balance() {
      const { balance } = await request('balance/query', {});
      if (!Number.isSafeInteger(balance) || balance < 0) throw new SupplierError('unknown');
      return balance;
    },
    async order(transactionId, lines, amount) {
      const packageInfoList = lines.map(({ code, count, priceRaw, periodNum }) => ({
        packageCode: code, count, price: priceRaw, ...(periodNum ? { periodNum } : {}),
      }));
      const { orderNo } = await request('esim/order', { transactionId, amount, packageInfoList });
      if (typeof orderNo !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(orderNo)) throw new SupplierError('unknown');
      return orderNo;
    },
    async profile(esimTranNo) {
      const { esimList } = await request('esim/query', { esimTranNo, pager:{pageNum:1,pageSize:5} });
      if (!Array.isArray(esimList)) throw new SupplierError('unknown');
      return esimList.find(profile => profile.esimTranNo === esimTranNo);
    },
    async topupOffers(profile) {
      const { packageList } = await request('package/list', {
        type:'TOPUP', iccid:profile.iccid, esimTranNo:profile.esimTranNo, slug:'', packageCode:'', locationCode:'',
      });
      if (!Array.isArray(packageList)) throw new SupplierError('unknown');
      return packageList;
    },
    async topup({ resourceId, iccid, code, priceRaw, transactionId }) {
      const result = await request('esim/topup', {
        esimTranNo:resourceId, packageCode:code, transactionId, amount:priceRaw,
      });
      const receipt = result.topUpEsimTranNo || result.transactionId;
      if (result.iccid !== iccid || typeof receipt !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(receipt)) {
        throw new SupplierError('unknown');
      }
      return { receipt, expiredTime:result.expiredTime, totalVolume:result.totalVolume, totalDuration:result.totalDuration };
    },
    async profiles(orderNo) {
      const { esimList } = await request('esim/query', { orderNo, pager: { pageNum: 1, pageSize: 50 } });
      if (!Array.isArray(esimList)) throw new SupplierError('unknown');
      return esimList;
    },
  };
}
