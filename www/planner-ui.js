import {getProfile,localDate,occurrencesOn} from './engine.js';
import {courseLive,axisDate} from './course-live.js';
import {esc,icon,button} from './ui.js';
import {conflictGroups,arrangementOrigin,conflictSummary} from './conflict-ui.js';

export const liveMarkup=id=>`<span class="course-live-label" data-live-label hidden></span><span class="course-progress" role="progressbar" aria-label="授课进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><i></i></span>`;
const shortPlace=value=>value.replace(/^.*?校区\s*/,'').trim()||value||'地点待定';

export function renderCourseGrid({semester,dates,groups,maxPeriods}){
  const reference=axisDate(dates,localDate()),profile=getProfile(semester,reference),mixed=dates.some(d=>getProfile(semester,d).id!==profile.id);
  const caption=mixed?`<div class="axis-reference"><span>左侧时间：${esc(profile.name)} · ${Number(reference.slice(5,7))}/${Number(reference.slice(8))}</span>${button('axis-help','查看各日作息','text-button')}</div>`:'';
  return `${caption}<div class="timetable" style="--days:${dates.length};--periods:${maxPeriods};grid-template-rows:repeat(${maxPeriods},var(--row-height))">${Array.from({length:maxPeriods},(_,i)=>`<div class="period-label" style="grid-row:${i+1}"><strong>${String(i+1).padStart(2,'0')}</strong><time>${profile.periods[i]?.start||'—'}</time><small>${profile.periods[i]?.end||''}</small></div>`).join('')}${groups.map((items,day)=>{
    // The exam strip stays separate, but its actual times participate in grouping.
    const exams=(semester.exams||[]).some(e=>e.date===dates[day])?occurrencesOn(semester,dates[day]).filter(o=>o.kind==='exam'):[];
    const overlaps=conflictGroups([...items,...exams]).filter(g=>g.courses.length),covered=new Set(overlaps.flatMap(g=>g.courses.map(c=>c.id)));
    const ordinary=items.filter(c=>!covered.has(c.id)).map(c=>{
      const span=c.endPeriod-c.startPeriod+1,different=mixed&&getProfile(semester,dates[day]).id!==profile.id;
      return `<button class="course-block c${c.color}" data-action="detail" data-id="${esc(c.id)}" data-live-id="${esc(c.id)}" style="grid-column:${day+2};grid-row:${c.startPeriod}/span ${span}" aria-label="${esc(c.name)}，${esc(c.location)}，${c.startPeriod}到${c.endPeriod}节"><strong>${esc(c.shortName||c.name.replace(/[★☆]+$/u,'').trim())}</strong><span class="room-label">${esc(shortPlace(c.location))}</span>${different?`<small class="actual-time">${c.segments[0].start}<br>${c.segments.at(-1).end}</small>`:''}${c.assessment&&c.assessment!=='未设置'?`<small class="assessment">${esc(c.assessment)}</small>`:''}${c.changeLabel?'<small class="change-mark">调</small>':''}${liveMarkup(c.id)}</button>`;
    }).join('');
    return ordinary+overlaps.map(group=>conflictCard(semester,group,day)).join('');
  }).join('')}</div>`;
}

function conflictCard(semester,group,day){
  const span=group.endPeriod-group.startPeriod+1,inline=span>=2&&group.courses.length<=2;
  const title=conflictSummary(group),label=group.exams.length?`${group.items.length}项重叠`:`${group.courses.length}门重叠`,extra=`data-date="${esc(group.date)}" data-id="${esc(group.id)}"`;
  return `<section class="conflict-stack ${inline?'has-members':'is-folded'} ${span===1?'is-short':''} ${inline&&span<=2?'is-compact':''}" data-conflict-ids="${esc(JSON.stringify(group.courses.map(c=>c.id)))}" style="grid-column:${day+2};grid-row:${group.startPeriod}/span ${span}" aria-label="${esc(title)}">${button('conflict-detail',`<strong>${label}</strong><small>${group.exams.length?'含独立考试':'点此核对'}</small>`,'conflict-stack-heading',`${extra} aria-label="${esc(title)}，查看完整清单"`)}${inline?`<div class="conflict-members">${group.courses.map(c=>{const origin=arrangementOrigin(semester,c);return `<button type="button" class="conflict-member c${c.color}" data-action="detail" data-id="${esc(c.id)}" data-live-id="${esc(c.id)}" data-origin="${({original:'原',moved:'调入',makeup:'补课',modified:'调整'})[origin.kind]||origin.label}" aria-label="${esc(c.name)}，${esc(origin.label)}，第${c.startPeriod}到${c.endPeriod}节，${c.segments[0].start}至${c.segments.at(-1).end}，${esc(c.location)}"><strong title="${esc(c.name)}">${esc(c.shortName||c.name)}</strong><small class="conflict-member-origin">${esc(origin.label)}</small>${span>=4?`<small class="conflict-member-time">${c.startPeriod}–${c.endPeriod}节<br>${c.segments[0].start}–${c.segments.at(-1).end}</small><small class="conflict-member-place">${esc(shortPlace(c.location))}</small>`:''}${liveMarkup(c.id)}</button>`;}).join('')}</div>`:`<div class="conflict-folded-current" data-conflict-current hidden></div>${button('conflict-detail',`查看全部<br>${group.items.length} 项安排`,'conflict-stack-open',extra)}`}</section>`;
}

export function refreshCourseProgress(root,occurrences,now=Date.now()){
  for(const group of root.querySelectorAll('.conflict-stack')){
    const ids=JSON.parse(group.dataset.conflictIds),active=ids.map(id=>occurrences.get(id)).filter(Boolean).map(item=>({item,live:courseLive(item,now)})).filter(x=>x.live.active).sort((a,b)=>a.item.endMs-b.item.endMs||a.item.id.localeCompare(b.item.id));
    group.classList.toggle('has-current',active.length>0);
    const slot=group.querySelector('[data-conflict-current]');
    if(slot){const first=active[0];slot.hidden=!first;group.classList.toggle('folded-live',Boolean(first));
      if(first&&slot.dataset.currentId!==first.item.id){const c=first.item;slot.dataset.currentId=c.id;slot.innerHTML=`<button type="button" class="conflict-member c${c.color}" data-action="detail" data-id="${esc(c.id)}" data-live-id="${esc(c.id)}" aria-label="当前课程：${esc(c.name)}"><strong>${esc(c.shortName||c.name)}</strong>${liveMarkup(c.id)}</button>`;}
      if(first)slot.title=`${active.map(x=>x.item.name).join('、')}正在进行，点击组标题查看全部`;
    }
  }
  for(const card of root.querySelectorAll('[data-live-id]')){
    const item=occurrences.get(card.dataset.liveId);if(!item)continue;
    const live=courseLive(item,now),label=card.querySelector('[data-live-label]'),bar=card.querySelector('.course-progress');
    card.classList.toggle('is-current',live.active);card.classList.toggle('is-break',live.active&&live.phase==='break');
    if(live.active)card.setAttribute('aria-current','true');else card.removeAttribute('aria-current');
    const badge=card.querySelector('.conflict-now');if(badge){badge.hidden=!live.active;badge.textContent=live.phase==='break'?'课间':'进行中';}
    if(label){label.hidden=!live.active;label.textContent=card.classList.contains('agenda-card')||card.classList.contains('conflict-detail-item')?live.detail:card.dataset.origin?`${card.dataset.origin}·${live.phase==='break'?'课间':'上课'}`:live.label;label.title=live.detail;}
    if(bar){bar.hidden=!live.active;bar.setAttribute('aria-valuenow',String(Math.round(live.progress)));bar.setAttribute('aria-label',live.aria);bar.style.setProperty('--lesson-progress',`${live.progress.toFixed(3)}%`);}
  }
}

const row=(action,i,title,description,trailing='')=>`<button class="setting-row" data-action="${action}"><span class="setting-icon">${icon(i)}</span><span class="row-text"><strong>${title}</strong><small>${description}</small></span>${trailing||icon('right',15)}</button>`;
const group=(name,content)=>`<section class="settings-section"><h2>${name}</h2><div class="setting-group">${content}</div></section>`;
export function renderSettingsPage(state,version='3.2.0'){
  const s=state.semesters.find(s=>s.id===state.activeSemesterId);
  return `<div class="section-heading"><h1>设置</h1></div>${group('课程与考试',row('import','school','导入课程','正方教务 / PDF / 文字')+row('all-courses','grid','管理课程',`${s.courses.length} 门课程 · 添加、编辑和删除`)+row('exams','note','考试安排',`${s.exams.length} 场 · 独立日期与考场`))}${group('学期与校历',row('semesters','calendar','学期管理',`${esc(s.name)} · 切换、编辑和删除`)+row('profiles','clock','上课作息',`${s.profiles.length} 套 · 夏冬切换与分时段联动`)+row('calendar','swap','调休与调课','勾选日期停补课 / 移动某一次课程'))}${group('提醒与显示',row('notifications','bell','提醒与课程状态',state.preferences.notifications.enabled?'课前提醒已开启 · 计时方式与权限':'提醒时间、课间提醒和通知权限')+row('toggle-weekend','grid','周视图显示周末','开启后显示周六和周日',`<span class="switch ${s.showWeekend?'on':''}" role="switch" aria-checked="${s.showWeekend}"></span>`))}${group('分享与数据',row('share-home','swap','分享与跟随','口令分享、导入朋友课表及同步状态')+row('backup-menu','download','备份与恢复','导出文件、恢复备份和历史版本'))}${group('应用',row('app-update','download','检查更新',`当前版本 ${version} · GitHub 更新与代理`))}<div class="about-mark"><img src="./icon.svg" alt="清课图标"><p>清课 ${version}</p></div>`;
}
