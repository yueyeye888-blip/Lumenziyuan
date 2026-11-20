# USDT 充值设置

在受限的 `config/usdt.json` 配置每条链的公开收款地址和支持历史日志的 HTTPS JSON-RPC 服务，然后重启本站。钱包的保管和转出由收款方自行管理。充值模块只执行链上读取操作。

```json
{
  "networks": {
    "TRON": {
      "mode": "shared",
      "addresses": [],
      "rpcUrl": "https://tron-rpc.publicnode.com/jsonrpc",
      "fallbackRpcs": [{ "rpcUrl": "https://tron.drpc.org" }]
    },
    "ETH": {
      "mode": "shared",
      "addresses": [],
      "rpcUrl": "https://ethereum-rpc.publicnode.com",
      "fallbackRpcs": [{ "rpcUrl": "https://eth.drpc.org" }]
    },
    "BSC": {
      "mode": "shared",
      "addresses": [],
      "rpcUrl": "https://bsc-rpc.publicnode.com"
    }
  }
}
```

将每个空数组替换为一个经钱包核对的该链主网收款地址，TRON 使用以 T 开头的 Base58Check 地址。示例中的空地址会关闭该链。每个节点可独立设置 `headers` 和 `blockSpan`（默认 120，单位为区块），备用节点使用自身配置的认证信息。公开节点可受速率及区块范围限制，可替换为自己的服务。节点需支持 `eth_chainId`、带 `finalized` 标签的 `eth_getBlockByNumber`、按合约和主题查询的 `eth_getLogs` 和 `eth_getTransactionReceipt`。

| 主网 | 识别的代币 | 显示精度 |
|---|---|---|
| TRON | Tether USD₮，`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | 合约 6 位 |
| Ethereum | Tether USD₮，`0xdac17f958d2ee523a2206206994597c13d831ec7` | 合约 6 位 |
| BNB Smart Chain | Binance-Peg USDT（BSC-USD），`0x55d398326f99059ff775485246999027b3197955` | 合约 18 位 |

## 订单与入账

用户可以选择预设金额，或点击「更多」输入最低 5 U、最多两位小数的本金。同一账号在同一网络可以同时保留多笔充值，每笔订单对应单独的应付金额。系统分配 30 分钟有效的非整数应付金额，用户须扣除交易所手续费后，使收款钱包收到精确的显示金额。例如应付 50.04 USDT，到账后增加 50 U。共享地址的同一本金优先使用两位小数，实际应付金额也会避开相邻本金已获分配的金额。尾数在所有精度上都不超过 0.09 USDT。9 个两位尾数全部使用后，系统按需扩展至三至六位。系统持久保存分配记录，每条链的同一地址不会把历史应付金额发给其他订单。更换数据库或迁移时，务必保留完整钱包及充值数据库，否则应换用新的收款地址。

后台约每 12 秒检查新区块。未最终确认的转账显示“确认中”。确认后核对成功回执、主网链 ID、合约、收款地址、应付金额、日志索引和首次打包时间。即使之后才达到最终确认，只要在有效期内成功上链仍可入账。进程重启后会从持久化高度补扫。付款哈希可辅助查账，事件以链、哈希和日志索引识别。首次启用共享地址时开始监控新转入，历史上与本站无关的付款不自动导入。

管理员可以核对已最终确认的异常款项，备注原因、关联账号或订单并入账，或者登记已线下处理。重复操作会核对上一次处理结果。共享地址按链、代币和精确金额归属订单，付款人务必照单转账，主动向其他人订单的精确金额付款可能给该订单入账。查看公开的交易哈希不能证明付款人的订单归属。

也可以将 `mode` 设置为 `unique` 并填入一组钱包离线生成的收款地址。每个地址仅分配给一个订单，过期后也会继续关注它的到账记录。已有订单的地址应保留其原分配模式。

代币资料见 [Tether 支持网络](https://tether.to/en/supported-protocols/) 和 [BNB Chain SDK 代币说明](https://github.com/bnb-chain/mpp-sdk)。节点语义见 [Ethereum JSON-RPC](https://ethereum.org/developers/docs/apis/json-rpc/)、[TRON JSON-RPC](https://developers.tron.network/reference/json-rpc-api-overview) 和 [BNB Smart Chain Finality API](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/bsc-api-list/)。
