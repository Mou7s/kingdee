// Refresh permission state by resaving users. Read-only by default; explicit --apply writes.
// Never exports password, salt, token or other credential fields from SEC_User View.
import {createHash} from 'node:crypto';
import {K3CloudWebAPI} from '../../lib/k3/index.js';

const apply=process.argv.includes('--apply');
const resumeAt=process.argv.indexOf('--resume-from');
const resumeDir=resumeAt<0?null:process.argv[resumeAt+1];
if(resumeAt>=0&&(!resumeDir||resumeDir.startsWith('--')))throw Error('Missing --resume-from directory');
const api=new K3CloudWebAPI();await api.login();
const dir=`output/refresh-user-permissions-${Date.now()}`;
const put=(name,value)=>Bun.write(`${dir}/${name}.json`,JSON.stringify(value,null,2));
const safeKeys=['Id','Name','UserAccount','MultiLanguageText','FDescription','FForbidStatus',
  'FPRIMARYGROUP_Id','FLinkObject_Id','FOrgId_Id','FAppGroup','IsLock','FIsLockTerminal',
  'DomainUser','FType','FUserType','Email','Phone','FSex','RegState','FIsRegister',
  'FKdPassportId','FCLOUDACCOUNT','FIDENTITY','Userorg'];
const safeState=u=>Object.fromEntries(safeKeys.map(k=>[k,u[k]]));
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const roleRows=await api.executeBillQuery('SEC_KDRoles','FRoleId,FNumber,FName,FForbidStatus','',10000);
if(roleRows.length>=10000)throw Error('Role roster truncated');
const liveRoleIds=new Set(roleRows.map(r=>Number(r[0])));
const normalizedState=state=>{const value=structuredClone(state);for(const org of value.Userorg??[])
  org.EntityRole=(org.EntityRole??[]).filter(e=>!Number(e.FRoleId_Id)||liveRoleIds.has(Number(e.FRoleId_Id)));return value;};
const sameState=(x,y)=>JSON.stringify(normalizedState(x))===JSON.stringify(normalizedState(y));
const invalidLinks=state=>(state.Userorg??[]).flatMap(o=>(o.EntityRole??[]).filter(e=>Number(e.FRoleId_Id)>0&&!liveRoleIds.has(Number(e.FRoleId_Id))).map(e=>`${state.Id}|${Number(e.FRoleId_Id)}`));
const removedInvalid=(before,after)=>invalidLinks(before).filter(x=>!invalidLinks(after).includes(x));
const rows=await api.executeBillQuery('SEC_User','FUserID,FUserAccount,FName,FForbidStatus','',10000);
if(rows.length>=10000)throw Error('User query might be truncated');
const byId=new Map();
for(const row of rows){const id=Number(row[0]);if(!id)throw Error('Invalid user ID');
  const item={id,account:row[1],name:row[2],status:row[3]};
  if(byId.has(id)&&JSON.stringify(byId.get(id))!==JSON.stringify(item))throw Error('Conflicting user rows');
  byId.set(id,item);
}
// All users, including forbidden and built-in accounts; empty-account built-ins are checked last.
const users=[...byId.values()].sort((x,y)=>Number(!String(x.account).trim())-Number(!String(y.account).trim())||x.id-y.id);
const queryLinks=async()=>{const r=await api.executeBillQuery('SEC_User','FUserID,FRoleId','',10000);if(r.length>=10000)throw Error('Role mappings truncated');return [...new Set(r.filter(x=>Number(x[1])>0).map(x=>`${Number(x[0])}|${Number(x[1])}`))].sort();};
let beforeLinks=await queryLinks(),baseline=[];
for(const user of users){const v=await api.viewBill('SEC_User',user.id);
  if(Number(v.Id)!==user.id||String(v.UserAccount??'').trim()!==String(user.account??'').trim()||v.Name!==user.name||v.FForbidStatus!==user.status)throw Error(`Roster/View mismatch for ${user.id}`);
  baseline.push({...user,state:safeState(v)});
}
let priorCompleted=[];
if(resumeDir){
  const original=await Bun.file(`${resumeDir}/baseline.json`).json();
  const blocked=await Bun.file(`${resumeDir}/blocked.json`).json();
  const currentById=new Map(baseline.map(r=>[r.id,r]));
  if(original.users.length!==baseline.length||original.users.some(r=>!currentById.has(r.id)||!sameState(r.state,currentById.get(r.id).state)))throw Error('Resume baseline changed beyond missing-role cleanup');
  const allowedMissing=new Set(original.users.flatMap(r=>invalidLinks(r.state)));
  if(beforeLinks.some(x=>!original.roleMappings.includes(x))||original.roleMappings.some(x=>!beforeLinks.includes(x)&&!allowedMissing.has(x)))throw Error('Unexpected mapping difference while resuming');
  priorCompleted=blocked.completed??[];
  for(const failed of blocked.failed??[]){
    const response=await Bun.file(`${resumeDir}/save-${failed.id}.json`).json();
    const record=original.users.find(r=>r.id===failed.id),current=currentById.get(failed.id);
    if(response.Result?.ResponseStatus?.IsSuccess!==true||!record||!current||!sameState(record.state,current.state))throw Error('Prior attempted save cannot be independently accepted');
    priorCompleted.push({id:record.id,account:record.account,name:record.name,status:record.status,saved:true,
      effectiveAttributesAndRolesUnchanged:true,invalidRoleLinksRemoved:removedInvalid(record.state,current.state),acceptedAfterInvestigation:true});
  }
  beforeLinks=original.roleMappings;baseline=original.users;
}
await put('plan',{time:new Date().toISOString(),mode:apply?'APPLY':'DRY-RUN',users:users.length,
  statusCounts:users.reduce((m,u)=>(m[u.status]=(m[u.status]??0)+1,m),{}),allUsersIncluded:true,
  request:{formid:'SEC_User',data:{NeedUpDateFields:[],IsDeleteEntry:false,IsVerifyBaseDataField:true,ValidateFlag:true,IsAutoSubmitAndAudit:false,Model:{FUserID:'<current user id>'}}},userList:users});
await put('baseline',{users:baseline,roleMappings:beforeLinks,roleRows,resumeFrom:resumeDir});
console.log(JSON.stringify({mode:apply?'APPLY':'DRY-RUN',dir,total:users.length,alreadySaved:priorCompleted.length,statusCounts:users.reduce((m,u)=>(m[u.status]=(m[u.status]??0)+1,m),{}),preflight:'passed'}));
if(!apply)process.exit(0);
const completed=[...priorCompleted],failed=[];
for(const record of baseline){
  if(completed.some(c=>c.id===record.id))continue;
  try{
    const current=await api.viewBill('SEC_User',record.id);
    if(!sameState(safeState(current),record.state))throw Error('User changed since baseline; not saved');
    const result=await api.post('DynamicFormService.Save',{formid:'SEC_User',data:{NeedUpDateFields:[],IsDeleteEntry:false,IsVerifyBaseDataField:true,ValidateFlag:true,IsAutoSubmitAndAudit:false,Model:{FUserID:record.id}}});
    await put(`save-${record.id}`,result);api.raiseIfError(result);
    const after=await api.viewBill('SEC_User',record.id),afterState=safeState(after);
    if(!sameState(afterState,record.state)){
      await put(`unexpected-diff-${record.id}`,{id:record.id,changedKeys:safeKeys.filter(k=>JSON.stringify(record.state[k])!==JSON.stringify(afterState[k])),before:record.state,after:afterState});
      throw Error('Unexpected user attribute/role change; stopped');
    }
    completed.push({id:record.id,account:record.account,name:record.name,status:record.status,saved:true,effectiveAttributesAndRolesUnchanged:true,
      invalidRoleLinksRemoved:removedInvalid(record.state,afterState),stateDigest:digest(normalizedState(afterState))});
    await put('progress',{completed,failed,pending:users.filter(u=>!completed.some(c=>c.id===u.id))});
    if(completed.length%20===0||completed.length===users.length)console.log(JSON.stringify({completed:completed.length,total:users.length}));
  }catch(error){
    failed.push({id:record.id,account:record.account,name:record.name,error:String(error.message??error)});
      await put('blocked',{time:new Date().toISOString(),completed,failed,pending:users.filter(u=>!completed.some(c=>c.id===u.id)&&u.id!==record.id),roleMappings:await queryLinks()});
    console.log(JSON.stringify({dir,completed:completed.length,total:users.length,failed}));process.exitCode=1;break;
  }
}
if(failed.length)process.exit(1);
// Independent new session checks the complete roster, per-user state and all role mappings.
const verify=new K3CloudWebAPI();await verify.login();
const afterRows=await verify.executeBillQuery('SEC_User','FUserID,FUserAccount,FName,FForbidStatus','',10000);
const canon=r=>JSON.stringify(r.map(x=>JSON.stringify(x)).sort());
if(canon(afterRows)!==canon(rows))throw Error('Final user roster changed');
const invalidRemoved=[];
for(const record of baseline){const actual=await verify.viewBill('SEC_User',record.id);if(!sameState(safeState(actual),record.state))throw Error(`Independent user state mismatch ${record.id}`);invalidRemoved.push(...removedInvalid(record.state,safeState(actual)));}
const expectedLinks=beforeLinks.filter(x=>!invalidRemoved.includes(x));
if(JSON.stringify(await queryLinks())!==JSON.stringify(expectedLinks))throw Error('Unexpected final role mapping change');
const finalRoleRows=await verify.executeBillQuery('SEC_KDRoles','FRoleId,FNumber,FName,FForbidStatus','',10000);
if(canon(finalRoleRows)!==canon(roleRows))throw Error('Role definitions changed');
const report={time:new Date().toISOString(),dir,total:users.length,succeeded:completed.length,failed:0,allUsersIncluded:true,
  forbiddenUsersIncluded:users.filter(u=>u.status==='B').length,userRosterUnchanged:true,selectedUserAttributesUnchanged:true,
  validRoleMappingsUnchanged:true,invalidRoleLinksAutomaticallyRemoved:invalidRemoved,roleDefinitionsUnchanged:true,
  independentSessionVerified:true,userRuntimePermissionVerification:'Not individually tested for all accounts',completed};
await put('verified',report);console.log(JSON.stringify({...report,completed:undefined}));
