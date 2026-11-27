import test from 'node:test';
import assert from 'node:assert/strict';
import { filterMailRecords, formatMailTime, mailKindLabel, mailRecordTimes } from '../lib/mail-delivery-records.mjs';

test('delivery operation timestamps retain seconds and use UTC+8, including old SQLite timestamps', () => {
  assert.equal(formatMailTime('2026-11-27 00:01:02'), '2026-11-27 08:01:02 (UTC+8)');
  assert.equal(formatMailTime('2026-11-27T08:01:02+08:00'), '2026-11-27 08:01:02 (UTC+8)');
  assert.equal(formatMailTime('2026-11-27T00:01:02Z'), '2026-11-27 08:01:02 (UTC+8)');
  assert.equal(formatMailTime(null), '未记录');
  assert.equal(formatMailTime('invalid'), '未记录');
  assert.deepEqual(mailRecordTimes({kind:'address_order',createdAt:'2026-11-27 00:01:02',updatedAt:'2026-11-27 00:10:11',delivery:{code:'delivered'}}), [
    ['提交时间：','2026-11-27 08:01:02 (UTC+8)'], ['状态更新时间：','2026-11-27 08:10:11 (UTC+8)'],
  ]);
  assert.deepEqual(mailRecordTimes({kind:'esim_workbook',createdAt:'2026-11-27 00:01:02',delivery:{code:'accepted'}}), [
    ['发送请求时间：','2026-11-27 08:01:02 (UTC+8)'], ['发送结果记录时间：','未记录'],
  ]);
  assert.deepEqual(mailRecordTimes({kind:'warehouse',createdAt:'2026-11-27 00:01:02',delivery:{code:'pending'}}), [
    ['认领时间：','2026-11-27 08:01:02 (UTC+8)'],
  ]);
});

test('resource category, delivery status and ID/email search compose without discarding existing kinds', () => {
  const records = [
    {id:'ADDR-1',kind:'address_order',name:'Address Order',delivery:{code:'failed'}},
    {id:'ESIM-2',kind:'esim_workbook',name:'eSIM',recipientEmail:'buyer@example.invalid',delivery:{code:'accepted'}},
    {id:'STOCK-3',kind:'warehouse',name:'Stock',delivery:{code:'accepted'}},
    {id:'TEST-4',kind:'sample',name:'Test file',delivery:{code:'accepted'}},
    {id:'EXTRA-5',kind:'future',name:'New resource',delivery:{code:'pending'}},
  ];
  assert.equal(mailKindLabel('address_order'),'地址生成器');
  assert.equal(mailKindLabel('esim_workbook'),'eSIM 流量卡');
  assert.equal(mailKindLabel('future'),'其他资源');
  assert.deepEqual(filterMailRecords(records,'all','all',''),records);
  assert.deepEqual(filterMailRecords(records,'esim_workbook','accepted','buyer@example.invalid'),[records[1]]);
  assert.deepEqual(filterMailRecords(records,'warehouse','accepted','STOCK-3'),[records[2]]);
  assert.deepEqual(filterMailRecords(records,'esim_workbook','failed',''),[]);
  assert.deepEqual(filterMailRecords(records,'other','all',''),[records[4]]);
});
