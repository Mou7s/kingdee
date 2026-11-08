# 销售链重建后的核验参考

## 适用范围

用于客户主体、税率或已删除下游单据导致的销售链重建：

`销售订单 → 发货通知 → 销售出库 → 应收 → 收款/核销`

本参考只记录可复用的核验方法，不把某一次业务的单号或临时状态当作模板。

## 已验证的本账套转换规则探查方法

不要猜 `RuleId`。在只读 SQL 中查询 `T_META_CONVERTRULE`：

```sql
select FID, FSOURCEFORMID, FTARGETFORMID,
       FSTATUS, FISDEFAULT, FISDEFAULTCUST
from T_META_CONVERTRULE
where FSOURCEFORMID = '源表单'
  and FTARGETFORMID = '目标表单'
  and FSTATUS = '1'
order by FID;
```

典型销售链规则的实际形式为：

| 源表单 | 目标表单 | RuleId 形态 |
|---|---|---|
| `SAL_SaleOrder` | `SAL_DELIVERYNOTICE` | `SaleOrder-DeliveryNotice` |
| `SAL_DELIVERYNOTICE` | `SAL_OUTSTOCK` | `DeliveryNotice-OutStock` |
| `SAL_OUTSTOCK` | `AR_receivable` | `AR_OutStockToReceivableMap` |

调用 `DynamicFormService.Push` 时，源/目标 FormId 的大小写要以账套规则表为准。成功后保存返回的目标 FID 和单号，立刻 `View`；不要只相信 Push 的 HTTP/API 成功。

## 新建销售订单的字段要点

- 标准销售订单新建报文使用 `FSaleOrderEntry` 作为明细实体，不能想当然使用 `FEntity`。
- `FSaleOrderFinance` 在该账套的新建报文中是对象，不是数组。
- 明细必须明确填写：`FMaterialId`、销售单位、计价单位、库存单位、基本单位、`FQty`、`FPrice`、`FTaxPrice`、`FTaxRate`、未税金额、税额和价税合计。
- 含税总额固定时，先用账套金额精度计算未税金额和税额，再通过 View 回查实际落库值；不要把含税单价误改成未税单价。
- 价格来源检查可能返回交互提示，而不是硬错误。使用原始 `DynamicFormService.Save` 请求时，按返回的交互标识提交确认；本账套账套实测需要同时关注 `SAL_CHECKPRICESOURCEFB` 以及 `IgnoreInteractionFlag`/兼容旧拼写字段。确认前后都要按候选单号回查，避免把“已分配单号但返回报错”误判为未创建。

## 逐级回查的最小验收集

每张单都要检查：

1. `FID`、单号、`FDocumentStatus`；
2. 客户编码和完整名称；
3. 物料编码、数量和单位；
4. 税率、未税金额、税额、价税合计；
5. 结算币别；
6. 下游/上游来源字段和链接分录。

来源链应使用链接表交叉验证，而不是只看单据备注：

- 发货通知明细的 `FEntity_Link`：源销售订单 FID、源分录 ID、RuleId；
- 出库明细的 `FEntity_Link`：源发货通知 FID、源分录 ID、RuleId；
- 应收明细的 `FEntityDetail_Link`：源销售出库 FID、源分录 ID、RuleId；同时核对 `SourceBillNo` 和 `FSOURCETYPE`。

库存出库还必须回查仓库、仓位、批号，以及 `MustQty/RealQty/BaseUnitQty`。带分录的查询可能一单多行，按 FID/单号去重后再判断是否重复。

## 日期和付款条件的独立检查

从历史订单重新下推时，订单日期和下游日期可能不同：保存订单时保留历史日期，但 Push 生成的发货通知、出库和应收可能自动使用当前日期。因此最终报告必须逐单列出 `FDate/FDATE`，不能只说“整链已重建”。若财务要求还原原交易日，先确认会计期间，再按标准反审核→修改→提交→审核处理，禁止 SQL 改日期。

付款条件同理：新客户档案默认值不等于订单原值。若选择保留原订单的付款条件，应明确列出：旧订单条件、新客户默认条件、四张新单最终条件，并交财务确认。

## 应收和收款的重复保护

应收下推接口可能在最终响应阶段报错，但目标应收已经生成；遇到这类错误时：

1. 不要立即重试 Push；
2. 按返回 FID、来源出库单号、金额和客户查询 `AR_receivable`；
3. 查看应收明细的 `SourceBillNo`、`FSOURCETYPE`、`FEntityDetail_Link`；
4. 只有确认没有目标应收时才重试。

收款录入前：

- 按新订单号、应收号、源出库号和银行流水检索 `AR_RECEIVEBILL`；
- 同时查看 `AR_Match`，确认没有既有核销；
- 金额相同不能证明是同一笔收款，必须结合来源和流水。

账套有多个公司银行账户时，不能使用默认账户或历史收款单样例账户代替回单账户。先核对实际收款账号；若回单缺失或无法识别，暂停收款写入，把应收单交财务处理。

## 结果报告建议

最终报告分成三段：

1. **已验证无误**：四单状态、客户、数量、币别、税率、金额、来源链接、库存维度；
2. **需要财务确认**：下游日期、付款条件、收款银行账户、付款方与客户的法定名称关系；
3. **未执行事项**：没有收款单或核销时，明确写“尚未录入”，不能把应收已审核说成款项已收。

## 取消销售订单的删除评估（2026-10-21 XSDD030228）

- 未出库不代表整链无业务。先以订单分录ID追踪发货通知及采购申请，再沿采购订单、入库、暂估应付、财务应付精确关联；各层必须View核对整单全部分录，识别混单，不只看命中分录。
- 本案5行17.5K销售未出库；两张发货通知均未出库；2行3K经过CGSQ010290、TK20260514024、CGRK14320、AP00109425进入财务应付AP00113318。相关203元，但入库混有其他4K、财务应付为51行91793元；整单删除会影响范围外业务，不能按客户取消销售自动级联删除库存财务。
- AP表单按实时FSetAccountType区分：本案暂估2、财务3；核销/付款累计字段不等同实际银行付款完成。采购退料累计字段与实际退料单不一致时保留未验证，不猜实物流向。
- 本案仅调查评估，未写业务数据。证据与边界见仓库output/XSDD030228-delete-assessment.md及其引用快照；易变状态复用前重新查。若目标只是不再履约，另行核验销售订单与既有发货通知关闭，保留采购库存财务历史。
