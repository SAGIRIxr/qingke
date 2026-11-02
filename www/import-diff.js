import { createCourse } from './core.js';
import { uid } from './engine.js';

const FIELDS=['name','day','startPeriod','endPeriod','weeks','teacher','location'];
const SCHEDULE_FIELDS=['day','startPeriod','endPeriod','weeks'];
const clone=value=>JSON.parse(JSON.stringify(value));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const snapshot=value=>Object.fromEntries(FIELDS.map(field=>[field,field==='weeks'?[...value.weeks].sort((a,b)=>a-b):value[field]??'']));
// Matching-only normalization: retain the original text for display and local edits.
const compact=value=>String(value??'').normalize('NFKC').replace(/[\s\u200B-\u200D\u2060\uFEFF]/gu,'');
const nameKey=value=>compact(value).replace(/[*★☆]+$/u,'');
const teacherKey=value=>compact(value).replace(/^(?:任课教师|授课教师|教师|老师)[:：]/u,'');
function locationKey(value){
  const text=compact(value).replace(/^(?:上课地点|教学地点|上课教室|教室|地点|场地)[:：]/u,'');
  const match=text.match(/^[\[(【]?([^\[\]()【】:：,，/]{1,20}校区)[\])】:：,，/·-]*(.+)$/u);
  return match?{campus:match[1],room:match[2]}:{campus:'',room:text};
}
function locationEqual(a,b){
  const left=locationKey(a),right=locationKey(b);
  return left.room===right.room&&(!left.campus||!right.campus||left.campus===right.campus);
}
const sameTime=(a,b)=>a.day===b.day&&a.startPeriod===b.startPeriod&&a.endPeriod===b.endPeriod;
const weekKey=value=>JSON.stringify([...new Set(value.weeks)].sort((a,b)=>a-b));
function sameArrangement(a,b){
  // Missing metadata is not evidence of a room or teacher change. Exact time
  // and weeks are mandatory; multiple compatible rows are kept ambiguous.
  const at=teacherKey(a.teacher),bt=teacherKey(b.teacher),al=compact(a.location),bl=compact(b.location);
  return nameKey(a.name)===nameKey(b.name)&&sameTime(a,b)&&weekKey(a)===weekKey(b)
    &&(!at||!bt||at===bt)&&(!al||!bl||locationEqual(a.location,b.location));
}
const signature=value=>JSON.stringify([nameKey(value.name),value.day,value.startPeriod,value.endPeriod,weekKey(value),teacherKey(value.teacher),locationKey(value.location)]);
const assessmentOf=value=>String(value??'').trim()||'未设置';
function importedCourse(raw){
  const course=createCourse(raw);
  // This marker belongs to the import preview only, never persisted courses
  // or importSource snapshots. A parser conflict must survive deduplication.
  return raw.assessmentConflict===true?{...course,assessment:'未设置',assessmentConflict:true}:course;
}
function sourceOptions(options={}){
  const kind=options.kind??'text';
  if(!['web','pdf','text'].includes(kind))throw new Error('导入来源类型无效');
  return {kind,source:String(options.source??'课表导入').trim().slice(0,100)||'课表导入'};
}
function existingRows(semester){
  return semester.courses.flatMap(course=>course.sessions.map(session=>({
    course,session,courseId:course.id,sessionId:session.id,
    current:snapshot({...session,name:course.name}),
    baseline:session.importSource?.snapshot?clone(session.importSource.snapshot):null,
  })));
}
function affinity(before,incoming){
  if(nameKey(before.name)!==nameKey(incoming.name)||!sameTime(before,incoming))return 0;
  const sameTeacher=!!teacherKey(before.teacher)&&teacherKey(before.teacher)===teacherKey(incoming.teacher);
  const sameLocation=!!compact(before.location)&&locationEqual(before.location,incoming.location);
  const sameWeeks=weekKey(before)===weekKey(incoming);
  // Never infer identity between two different recurring times from a name,
  // teacher and room: these are commonly shared by separate weekly sessions.
  return 10+(sameTeacher?3:0)+(sameLocation?2:0)+(sameWeeks?1:0);
}

function assessmentChanges(items,rows,candidates,warnings){
  const courses=new Map(rows.map(row=>[row.courseId,row.course])),groups=new Map();
  for(const item of items){
    const course=courses.get(item.courseId),current=assessmentOf(course?.assessment);
    // Assessment is course-level metadata. Keep it out of persisted session
    // snapshots so old imports and shared data retain the same schema.
    if(item.before)item.before.assessment=current;
    if(item.after)item.after.assessment=course?current:assessmentOf(item.incoming?.assessment);
    if(course&&item.incoming&&['same','changed'].includes(item.status)){
      if(!groups.has(course.id))groups.set(course.id,[]);
      groups.get(course.id).push(item);
    }
  }
  for(const [courseId,group] of groups){
    const course=courses.get(courseId),current=assessmentOf(course.assessment);
    const values=[...new Set(group.flatMap(item=>[...candidates.get(item.incoming)]))].sort();
    if(values.length>1||group.some(item=>item.incoming.assessmentConflict===true)){
      const message=`“${course.name}”的导入条目包含冲突的考核方式${values.length>1?`（${values.join('、')}）`:''}，已保留现有设置，请核对后手动填写。`;
      warnings.push(message);
      for(const item of group){item.message+=` ${message}`;if(item.status==='changed')item.protectedFields=[...new Set([...(item.protectedFields??[]),'assessment'])];}
      continue;
    }
    if(!values.length)continue;
    const incoming=values[0];
    if(current!=='未设置'&&current!==incoming){
      const message=`“${course.name}”已有考核方式“${current}”，来源为“${incoming}”；已保留现有设置。`;
      warnings.push(message);
      for(const item of group){
        if(!candidates.get(item.incoming).size)continue;
        item.message+=` ${message}`;
        if(item.status==='changed')item.protectedFields=[...new Set([...(item.protectedFields??[]),'assessment'])];
      }
    }else if(current==='未设置'){
      for(const item of group){
        // Only an explicitly selected row carrying the metadata may fill it.
        // A sibling session with no assessment does not grant that consent.
        if(!candidates.get(item.incoming).size)continue;
        item.after.assessment=incoming;
        if(item.status==='same'){
          item.status='changed';item.protectedFields=[];
          item.message='发现未填写的考核方式；勾选后补入，原有安排与手动修改保持不变。';
        }else item.message+=' 勾选后同时补入未填写的考核方式。';
      }
    }
  }
}

/** Conservative re-import plan. No writes occur before applyImport. */
export function diffImport(semester,flatCourses,options={}){
  if(!semester||!Array.isArray(semester.courses)||!Array.isArray(flatCourses)||flatCourses.length>500)throw new Error('导入课程格式无效或超过 500 条');
  const source=sourceOptions(options),rows=existingRows(semester),used=new Set(),items=[],warnings=[],seen=new Map(),assessmentCandidates=new Map(),sourceIdsByIncoming=new Map();
  const incomingRows=[];
  for(const raw of flatCourses){
    const incoming=importedCourse(raw);
    if(incoming.weeks.some(week=>week>semester.totalWeeks))throw new Error(`“${incoming.name}”周次超出学期范围`);
    const key=signature(incoming),existing=seen.get(key);
    if(existing){
      sourceIdsByIncoming.get(existing).add(incoming.id);
      const values=assessmentCandidates.get(existing);
      if(incoming.assessment!=='未设置')values.add(incoming.assessment);
      if(incoming.assessmentConflict===true||values.size>1)existing.assessmentConflict=true;
      existing.assessment=!existing.assessmentConflict&&values.size===1?[...values][0]:'未设置';
      warnings.push(`“${incoming.name}”有重复导入条目，已合并。`);
      continue;
    }
    seen.set(key,incoming);sourceIdsByIncoming.set(incoming,new Set([incoming.id]));assessmentCandidates.set(incoming,new Set(incoming.assessment==='未设置'?[]:[incoming.assessment]));incomingRows.push(incoming);
  }
  for(const incoming of incomingRows)if(incoming.assessmentConflict===true)warnings.push(`“${incoming.name}”的导入考核方式存在冲突，未自动采用；请核对后手动填写。`);
  // Reserve exact matches first so a changed row cannot steal another row's
  // unchanged arrangement merely because the input order differs.
  const plans=incomingRows.map(incoming=>({incoming,exact:rows.filter(row=>sameArrangement(row.current,incoming)||row.baseline&&sameArrangement(row.baseline,incoming))}));
  for(const plan of plans){if(plan.exact.length===1&&!used.has(plan.exact[0].sessionId)){plan.match=plan.exact[0];used.add(plan.match.sessionId);}}
  let ordinal=0;
  for(const plan of plans){
    const {incoming}=plan;let match=plan.match;
    const key=`import-${ordinal++}`;
    if(match){
      items.push({key,status:'same',incoming,courseId:match.courseId,sessionId:match.sessionId,before:clone(match.current),after:clone(match.current),message:equal(match.current,snapshot(incoming))?'与现有安排相同，将跳过。':'教务安排未变；保留你的手动修改。'});continue;
    }
    if(plan.exact.length){items.push({key,status:'ambiguous',incoming,message:'存在多个相同或已匹配的安排，无法唯一对应；请手动核对。'});continue;}
    const candidates=rows.filter(row=>!used.has(row.sessionId)&&(nameKey(row.current.name)===nameKey(incoming.name)||row.baseline&&nameKey(row.baseline.name)===nameKey(incoming.name)));
    const scored=candidates.filter(row=>row.baseline).map(row=>({row,score:affinity(row.baseline,incoming)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score);
    if(scored.length&&(!scored[1]||scored[0].score>scored[1].score))match=scored[0].row;
    if(match){
      used.add(match.sessionId);
      const protectedFields=FIELDS.filter(field=>!equal(match.current[field],match.baseline[field]));
      if((semester.exceptions??[]).some(exception=>exception.sessionId===match.sessionId)){
        for(const field of SCHEDULE_FIELDS)if(!protectedFields.includes(field))protectedFields.push(field);
      }
      // Name is shared by all sessions. Renaming a whole course from one row
      // could mutate unrelated/manual sessions, so course names stay local.
      if(match.course.sessions.length>1&&!protectedFields.includes('name'))protectedFields.push('name');
      const after=snapshot(incoming);
      for(const field of protectedFields)after[field]=clone(match.current[field]);
      items.push({key,status:'changed',incoming,courseId:match.courseId,sessionId:match.sessionId,before:clone(match.current),after,protectedFields,
        message:protectedFields.length?'发现教务变更；已保护手动修改或单次调课关联字段，核对后选择更新。':'发现教务变更，勾选后更新原安排。'});
    }else if(candidates.length){
      items.push({key,status:'ambiguous',incoming,candidates:candidates.map(row=>({courseId:row.courseId,sessionId:row.sessionId,before:clone(row.current)})),message:'同名安排缺少唯一对应依据，不会覆盖；可明确选择作为独立课程新增。'});
    }else{
      items.push({key,status:'new',incoming,after:snapshot(incoming),message:'新增独立课程安排。'});
    }
  }
  for(const row of rows){
    if(used.has(row.sessionId)||!row.baseline)continue;
    // Only report disappearance from this source, never imply a PDF fragment
    // has permission to remove rows imported from another source.
    if(row.session.importSource.kind!==source.kind||row.session.importSource.source!==source.source)continue;
    items.push({key:`import-${ordinal++}`,status:'missing',courseId:row.courseId,sessionId:row.sessionId,before:clone(row.current),message:'本次文件未包含此安排；原课程与调课记录均保留，不自动删除。'});
  }
  // Preview edits need every normalized duplicate's origin so an explicit
  // correction is not undone by an otherwise invisible sibling input row.
  for(const item of items)if(item.incoming)item.sourceIds=[...sourceIdsByIncoming.get(item.incoming)];
  assessmentChanges(items,rows,assessmentCandidates,warnings);
  const counts=Object.fromEntries(['new','same','changed','missing','ambiguous'].map(status=>[status,items.filter(item=>item.status===status).length]));
  return {items,warnings:[...new Set(warnings)],counts,source,baseSignature:JSON.stringify(semester)};
}

/** selections: omitted => new only; key[] => chosen new/changed; an explicit
 * {key, action:'add'} may add an ambiguous row as an independent course.
 * Missing rows and exceptions are never deleted. Input objects stay untouched.
 */
export function applyImport(semester,diff,selections){
  if(!diff||!Array.isArray(diff.items)||diff.baseSignature!==JSON.stringify(semester))throw new Error('课表已变化，请重新生成导入预览后再确认。');
  const chosen=selections===undefined?diff.items.filter(item=>item.status==='new').map(item=>item.key):selections;
  if(!Array.isArray(chosen))throw new Error('导入选择格式无效');
  const actions=new Map(chosen.map(value=>typeof value==='string'?[value,'apply']:[value?.key,value?.action??'apply']));
  const next=clone(semester),source=sourceOptions(diff.source);
  for(const item of diff.items){
    if(!actions.has(item.key)||['same','missing'].includes(item.status))continue;
    if(item.status==='ambiguous'&&actions.get(item.key)!=='add')continue;
    const incoming=importedCourse(item.incoming);
    if(item.status==='new'||item.status==='ambiguous'){
      if(next.courses.length>=500)throw new Error('课程超过 500 条，请清理后再导入。');
      const sessionId=uid();
      next.courses.push({id:uid(),name:incoming.name,shortName:'',color:incoming.color,assessment:incoming.assessment,nature:'',note:incoming.note,
        sessions:[{id:sessionId,day:incoming.day,startPeriod:incoming.startPeriod,endPeriod:incoming.endPeriod,weeks:[...incoming.weeks],teacher:incoming.teacher,location:incoming.location,breakMode:'normal',
          importSource:{...source,key:sessionId,snapshot:snapshot(incoming)}}]});
    }else if(item.status==='changed'){
      const course=next.courses.find(course=>course.id===item.courseId),session=course?.sessions.find(session=>session.id===item.sessionId);
      if(!session)throw new Error('导入对应的上课安排不存在，请重新预览。');
      const after=item.after;
      course.name=after.name;
      if(assessmentOf(course.assessment)==='未设置'&&assessmentOf(after.assessment)!=='未设置')course.assessment=after.assessment;
      for(const field of FIELDS.filter(field=>field!=='name'))session[field]=clone(after[field]);
      session.importSource={...source,key:session.importSource?.key??session.id,snapshot:snapshot(incoming)};
    }
  }
  return next;
}
