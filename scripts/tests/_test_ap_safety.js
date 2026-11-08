import {K3CloudWebAPI,assertApPayableWriteAllowed} from '../../lib/k3/index.js';
let count=0;function check(ok,msg){if(!ok)throw Error(msg);count++;}
async function rejects(fn){try{await fn();}catch(e){check(String(e.message).includes('[SAFETY]'),'安全错误标识');return;}throw Error('应拦截');}
for(const types of [[],['3'],['2','3'],[''],['1']])await rejects(()=>assertApPayableWriteAllowed('DynamicFormService.Audit','AP_PAYABLE',null,types));
assertApPayableWriteAllowed('DynamicFormService.Submit','ap_payable',null,['2']);count++;
await rejects(()=>assertApPayableWriteAllowed('DynamicFormService.ExcuteOperation','AP_PAYABLE','StartWorkflow',['2']));
const originalFetch=globalThis.fetch;let sent=0;globalThis.fetch=async()=>{sent++;return {ok:true,headers:{getSetCookie:()=>[]},json:async()=>({Result:{ResponseStatus:{IsSuccess:true}}})};};
try{
 const api=new K3CloudWebAPI();let records=[[1,'A1','2'],[2,'A2','3']];api.executeBillQuery=async()=>records;
 await api.submitBill('AP_PAYABLE',1);check(sent===1,'暂估提交应发送');await api.auditBill('AP_PAYABLE',1);check(sent===2,'暂估审核应发送');
 await rejects(()=>api.auditBill('AP_PAYABLE',2));await rejects(()=>api.post('DynamicFormService.Submit',{formid:'AP_PAYABLE',data:{Ids:'1,2'}}));
 records=[];await rejects(()=>api.auditBill('AP_PAYABLE',1));records=[[1,'A1','2'],[1,'A1','2']];await rejects(()=>api.auditBill('AP_PAYABLE',1));
 records=[[1,'A1','2']];await rejects(()=>api.post('DynamicFormService.Audit',{formid:'AP_PAYABLE',data:{}}));await rejects(()=>api.post('DynamicFormService.Save',{formid:'AP_PAYABLE',data:{IsAutoSubmitAndAudit:true}}));
 await rejects(()=>api.executeOperation('AP_PAYABLE','WorkflowSubmit',{Ids:'1'}));check(sent===2,'被阻止操作不得发送写请求');
 await api.post('DynamicFormService.Audit',{formid:'AP_PAYABLE',data:{Numbers:['A1']}});check(sent===3,'按单号核验暂估');await api.saveBill('AP_PAYABLE',{FID:2});check(sent===4,'财务Save不拦截');
}finally{globalThis.fetch=originalFetch;}
console.log(`全部通过：${count}项类型与真实发送路径安全检查`);
