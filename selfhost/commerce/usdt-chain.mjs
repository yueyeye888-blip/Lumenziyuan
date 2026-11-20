import { createHash } from 'node:crypto';

const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const chains = Object.freeze({
  TRON: {
    label: 'TRON（TRC20）',
    chainId: 728126428,
    decimals: 6,
    contract: '0xa614f803b6fd780986a42c78ec9c7f77e6ded13c',
  },
  ETH: { label: 'Ethereum（ERC20）', chainId: 1, decimals: 6, contract: '0xdac17f958d2ee523a2206206994597c13d831ec7' },
  BSC: {
    label: 'BNB Smart Chain（BEP20）',
    chainId: 56,
    decimals: 18,
    contract: '0x55d398326f99059ff775485246999027b3197955',
  },
});

const sha256 = (bytes) => createHash('sha256').update(bytes).digest();
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function receivingAddress(network, address) {
  if (typeof address !== 'string') throw new Error('收款地址格式有误');
  let hex;
  if (network === 'TRON') {
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) throw new Error('TRON 需要 Base58Check 地址');
    let n = 0n;
    for (const digit of address) n = n * 58n + BigInt(alphabet.indexOf(digit));
    const bytes = Buffer.from(n.toString(16).padStart(50, '0'), 'hex');
    if (
      bytes.length !== 25 ||
      bytes[0] !== 0x41 ||
      !sha256(sha256(bytes.subarray(0, 21)))
        .subarray(0, 4)
        .equals(bytes.subarray(21))
    )
      throw new Error('TRON 地址校验失败');
    hex = '0x' + bytes.subarray(1, 21).toString('hex');
  } else {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error('EVM 地址格式有误');
    hex = address.toLowerCase();
  }
  if (/^0x0{40}$/.test(hex) || Object.values(chains).some((chain) => chain.contract === hex))
    throw new Error('收款地址不能使用零地址或 USDT 合约地址');
  return hex;
}

const quantity = (n) => '0x' + n.toString(16);
const word = /^0x[0-9a-fA-F]{64}$/;
const isWord = (value) => typeof value === 'string' && word.test(value);
function integer(hex) {
  if (typeof hex !== 'string' || !/^0x[\da-f]+$/i.test(hex)) throw new Error('RPC 响应缺少有效整数');
  const value = Number(BigInt(hex));
  if (!Number.isSafeInteger(value)) throw new Error('RPC 数值超出范围');
  return value;
}
function header(data, height) {
  if (!data || !isWord(data.hash)) throw new Error('无法验证区块');
  const block = { number: integer(data.number), timestamp: integer(data.timestamp), hash: data.hash.toLowerCase() };
  if (height !== undefined && block.number !== height) throw new Error('区块高度不一致');
  return block;
}
function parsedLog(log, spec, allowed, from, to) {
  if (!log || typeof log !== 'object') throw new Error('无效的链上日志');
  const topics = log.topics;
  if (log.address?.toLowerCase() !== spec.contract || topics?.[0]?.toLowerCase() !== transferTopic) return null;
  if (
    !Array.isArray(topics) ||
    topics.length !== 3 ||
    !isWord(topics[1]) ||
    !isWord(topics[2]) ||
    !/^0x0{24}/i.test(topics[1]) ||
    !/^0x0{24}/i.test(topics[2]) ||
    !isWord(log.data)
  )
    throw new Error('无效的 Transfer 事件');
  const receiver = '0x' + topics[2].slice(-40).toLowerCase();
  if (!allowed.has(receiver)) return null;
  const number = integer(log.blockNumber);
  if (number < from || number > to || log.removed || !isWord(log.transactionHash) || !isWord(log.blockHash))
    throw new Error('日志区块待核对');
  return {
    receiver,
    number,
    blockHash: log.blockHash.toLowerCase(),
    txHash: log.transactionHash.toLowerCase(),
    logIndex: integer(log.logIndex),
    units: BigInt(log.data).toString(),
  };
}

// All three pinned mainnets expose JSON-RPC logs, receipts and the finalized block tag.
function singleReader({ network, config, fetchImpl }) {
  const spec = chains[network];
  const endpoint = new URL(config.rpcUrl);
  if (
    endpoint.protocol !== 'https:' &&
    !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))
  ) {
    throw new Error('RPC 须使用 HTTPS 或本机节点');
  }
  const span = config.blockSpan ?? 120;
  if (!Number.isSafeInteger(span) || span < 1 || span > 2000) throw new Error('blockSpan 须为 1 至 2000');
  async function rpc(method, params) {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
      headers: { ...config.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!response.ok) throw new Error('RPC HTTP ' + response.status);
    const json = await response.json();
    if (json.id !== 1 || json.error || !('result' in json))
      throw new Error('RPC 不支持请求或暂时不可用（' + method + '）');
    return json.result;
  }
  async function heads() {
    const [id, current, final] = await Promise.all([
      rpc('eth_chainId', []),
      rpc('eth_getBlockByNumber', ['latest', false]),
      rpc('eth_getBlockByNumber', ['finalized', false]),
    ]);
    if (integer(id) !== spec.chainId) throw new Error('RPC 主网链 ID 不匹配');
    const latest = header(current),
      finalized = header(final);
    if (finalized.number > latest.number) throw new Error('RPC 区块高度有误');
    return { latest, finalized };
  }
  async function read(from, to, recipients) {
    const events = [],
      blocks = new Map(),
      receipts = new Map();
    for (let i = 0; i < recipients.length; i += 60) {
      const group = recipients.slice(i, i + 60),
        allowed = new Set(group);
      const result = await rpc('eth_getLogs', [
        {
          fromBlock: quantity(from),
          toBlock: quantity(to),
          address: spec.contract,
          topics: [transferTopic, null, group.map((address) => '0x' + address.slice(2).padStart(64, '0'))],
        },
      ]);
      if (!Array.isArray(result)) throw new Error('RPC 未返回日志列表');
      for (const log of result) {
        const evt = parsedLog(log, spec, allowed, from, to);
        if (!evt) continue;
        if (!blocks.has(evt.number))
          blocks.set(evt.number, header(await rpc('eth_getBlockByNumber', [quantity(evt.number), false]), evt.number));
        const block = blocks.get(evt.number);
        if (block.hash !== evt.blockHash) throw new Error('区块已重组，稍后重查');
        if (!receipts.has(evt.txHash)) receipts.set(evt.txHash, await rpc('eth_getTransactionReceipt', [evt.txHash]));
        const receipt = receipts.get(evt.txHash);
        if (
          !receipt ||
          receipt.blockHash?.toLowerCase() !== block.hash ||
          receipt.transactionHash?.toLowerCase() !== evt.txHash ||
          integer(receipt.blockNumber) !== evt.number ||
          !Array.isArray(receipt.logs)
        )
          throw new Error('交易回执待核实');
        if (integer(receipt.status) !== 1) continue;
        const matches = receipt.logs.some((item) => {
          const verified = parsedLog(item, spec, allowed, from, to);
          return (
            verified &&
            verified.logIndex === evt.logIndex &&
            verified.txHash === evt.txHash &&
            verified.blockHash === evt.blockHash &&
            verified.receiver === evt.receiver &&
            verified.units === evt.units
          );
        });
        if (!matches) throw new Error('回执与 Transfer 事件不符');
        events.push({ ...evt, timestamp: block.timestamp });
      }
    }
    return events.sort((a, b) => a.number - b.number || a.logIndex - b.logIndex);
  }
  return { heads, read, span };
}

export function createChainReader({ network, config, fetchImpl = fetch }) {
  const clients = [config, ...(config.fallbackRpcs ?? [])].map((options) =>
    singleReader({ network, config: options, fetchImpl })
  );
  let preferred = 0;
  async function withFallback(method, args) {
    const start = preferred;
    let error;
    for (let i = 0; i < clients.length; i++) {
      const index = (start + i) % clients.length,
        client = clients[index];
      try {
        if (i > 0 && method === 'read') await client.heads();
        const result = await client[method](...args);
        preferred = index;
        return result;
      } catch (err) {
        error = err;
      }
    }
    throw error;
  }
  return {
    span: Math.min(...clients.map((c) => c.span)),
    heads: () => withFallback('heads', []),
    read: (...args) => withFallback('read', args),
  };
}
