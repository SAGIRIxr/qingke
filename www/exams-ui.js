import {uid,localDate,occurrencesOn} from './engine.js';
import {esc,clone,icon,button,field,input,select,submit,sheet,closeSheet,toast} from './ui.js';

export function createExamUI(ctx){
  const current=()=>ctx.getSemester();
  function list(){
    const exams=[...(current().exams||[])].sort((a,b)=>(a.date+a.startTime).localeCompare(b.date+b.startTime));
    sheet('考试安排',`<p class="sheet-subtitle">考试使用独立日期和时间，不随作息、停课或补课自动移动。</p>${button('exam-add',`${icon('plus',17)} 添加考试`,'primary full-width')}<div class="exam-list">${exams.map(e=>`<button class="course-list-item" data-action="exam-detail" data-id="${esc(e.id)}"><i class="course-dot c6"></i><div><strong>${esc(e.name)}</strong><small>${e.date} · ${e.startTime}–${e.endTime}<br>${esc(e.location||'考场待定')}${e.date<localDate()?' · 已结束':''}</small></div>${icon('right',15)}</button>`).join('')||'<p class="helper-box">还没有考试。可关联已有课程，也可独立填写。</p>'}</div>`);
  }
  function edit(id,date){
    const e=current().exams?.find(e=>e.id===id)||{id:uid(),name:'',date:date||localDate(),startTime:'09:00',endTime:'11:00',location:'',note:'',courseId:''};
    sheet(id?'编辑考试':'添加考试',`<form id="exam-form" data-id="${esc(e.id)}">${field('关联课程（可选）',select('courseId',[['','独立考试'],...current().courses.map(c=>[c.id,c.name])],e.courseId||''))}${field('考试名称',input('name',e.name,'text','required maxlength="100" placeholder="例如 高等数学期末考试"'))}${field('考试日期',input('date',e.date,'date','required'))}<div class="form-row">${field('开始时间',input('startTime',e.startTime,'time','required'))}${field('结束时间',input('endTime',e.endTime,'time','required'))}</div>${field('考场 / 教室',input('location',e.location,'text','maxlength="150" placeholder="例如 理科楼 203"'))}${field('备注',`<textarea name="note" rows="3" maxlength="2000" placeholder="座位号、需携带的证件等">${esc(e.note)}</textarea>`)}<p class="source-note">修改作息不会改变这里的时间。提醒沿用“提醒与课程状态”中的开关和提前量。</p>${submit('保存考试')}</form>`);
  }
  function detail(id){
    const e=current().exams?.find(e=>e.id===id);if(!e)return;
    const occurrence=occurrencesOn(current(),e.date).find(o=>o.examId===id);
    const conflicts=occurrencesOn(current(),e.date).filter(o=>occurrence?.conflicts.includes(o.id));
    sheet('考试详情',`<span class="pill exam-pill">考试</span><h3 class="detail-name" style="margin-top:14px">${esc(e.name)}</h3><div class="detail-row">${icon('calendar')}<span>${e.date}<br><strong>${e.startTime}–${e.endTime}</strong></span></div><div class="detail-row">${icon('pin')}<span>${esc(e.location||'考场待定')}</span></div>${e.note?`<p class="helper-box">${esc(e.note)}</p>`:''}${conflicts.length?`<p class="helper-box warning-box">与 ${conflicts.map(o=>esc(o.name)).join('、')} 时间重叠，请核对。</p>`:''}<p class="source-note">独立考试时间，不受作息方案与整日教学调整影响。</p><div class="sheet-actions">${button('exam-delete','删除考试','danger',`data-id="${esc(e.id)}"`)}${button('exam-edit','编辑考试','primary',`data-id="${esc(e.id)}"`)}</div>`);
  }
  function click(action,el){
    if(action==='exams'){list();return true;}
    if(action==='exam-add'){edit(undefined,el.dataset.date);return true;}
    if(action==='exam-edit'){edit(el.dataset.id);return true;}
    if(action==='exam-detail'){detail(el.dataset.id);return true;}
    if(action==='exam-delete'){
      const s=clone(current()),e=s.exams.find(e=>e.id===el.dataset.id);if(!e)return true;
      s.exams=s.exams.filter(x=>x.id!==e.id);ctx.reviewSemester(s,'删除考试前',`删除「${esc(e.name)}」在 ${e.date} 的考试及对应提醒。`,[e.date]);return true;
    }
    return false;
  }
  function change(target){
    if(target.closest('#exam-form')&&target.name==='courseId'){
      const c=current().courses.find(c=>c.id===target.value),name=document.querySelector('#exam-form [name="name"]');
      if(c&&(!name.value||name.dataset.autofill===name.value)){name.value=`${c.name}考试`;name.dataset.autofill=name.value;}return true;
    }
    return false;
  }
  function submitForm(form,values){
    if(form.id!=='exam-form')return false;
    const s=clone(current()),e={id:form.dataset.id,name:values.name,date:values.date,startTime:values.startTime,endTime:values.endTime,location:values.location,note:values.note};
    if(values.courseId)e.courseId=values.courseId;
    s.exams=[...(s.exams||[]).filter(x=>x.id!==e.id),e];
    ctx.reviewSemester(s,'保存考试前',`「${esc(e.name)}」：${e.date} ${e.startTime}–${e.endTime}，${esc(e.location||'考场待定')}。`,[e.date]);return true;
  }
  return {click,change,submit:submitForm,detail};
}
