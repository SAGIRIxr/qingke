import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,uid} from '../www/engine.js';
import {sharePayload,importedSemester} from '../www/share-ui.js';

function fixture(){
  const s=createState().semesters[0];s.startDate='2026-09-07';
  s.courses=[{id:'course',name:'测试课程<script>',shortName:'',color:0,assessment:'考试',nature:'必修',note:'私人课程笔记',sessions:[{id:'session',day:1,startPeriod:1,endPeriod:2,weeks:[1,2,3],teacher:'测试教师',location:'测试A101',breakMode:'normal',importSource:{kind:'web',source:'私有来源地址',key:'private',snapshot:{}}}]}];
  s.exceptions=[{id:'exception',sessionId:'session',sourceDate:'2026-09-07',type:'modify',location:'测试B202',note:'私人调课备注',cookie:'不能发出'}];
  s.dayRules=[{id:'off',date:'2026-09-08',type:'off',label:'私人调休说明',token:'不能发出'}];
  s.exams=[{id:'exam',courseId:'course',name:'独立考试',date:'2026-09-20',startTime:'08:20',endTime:'09:50',location:'座位12',note:'私人考试备注',secret:'不能发出'}];
  s.holidayLabels=[{id:'holiday',date:'2026-09-09',name:'校庆',sessionCookie:'不能发出'}];
  s.preferences={schoolUrl:'https://private.example',notifications:{enabled:true}};
  return s;
}
test('分享在客户端先剥离来源、备注、考试和未知字段，不把隐私交给服务器再过滤',()=>{
  const original=fixture(),before=JSON.stringify(original),payload=sharePayload(original),text=JSON.stringify(payload);
  assert.equal(payload.semester.courses[0].note,'');assert.deepEqual(payload.semester.exams,[]);
  for(const secret of ['私人','不能发出','private.example','importSource','preferences','cookie','token','sessionCookie'])assert.equal(text.includes(secret),false,secret);
  assert.equal(payload.semester.courses[0].name,'测试课程<script>');assert.equal(JSON.stringify(original),before);
});
test('仅显式勾选备注和考试时分享所选字段，未知属性始终不发送',()=>{
  const payload=sharePayload(fixture(),{includeNotes:true,includeExams:true,expiresInDays:30});
  assert.equal(payload.semester.courses[0].note,'私人课程笔记');assert.equal(payload.semester.exams[0].note,'私人考试备注');assert.equal(payload.semester.dayRules[0].label,'私人调休说明');
  assert.equal(JSON.stringify(payload).includes('不能发出'),false);assert.equal(payload.expiresInDays,30);
});
test('分享导入新建全部实体身份，保留相互引用且不执行名称中的HTML',()=>{
  const payload=sharePayload(fixture(),{includeNotes:true,includeExams:true}),s=importedSemester(payload);
  assert.notEqual(s.id,payload.semester.id);assert.notEqual(s.courses[0].id,'course');assert.notEqual(s.courses[0].sessions[0].id,'session');
  assert.equal(s.exceptions[0].sessionId,s.courses[0].sessions[0].id);assert.equal(s.exams[0].courseId,s.courses[0].id);
  assert.equal(s.courses[0].name,'测试课程<script>');assert.equal(s.courses[0].sessions[0].importSource,undefined);
  assert.throws(()=>importedSemester({format:'other',version:1,semester:payload.semester}),/格式/);
});
