import { parseSchedule } from './importer.js';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 30;
const MAX_ITEMS = 50000;
const DAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const dayOf = value => {
  const match = clean(value).replace(/\s/g, '').match(/^(?:星期|周)([一二三四五六日天1-7])(?:[（(].*[）)])?$/);
  return match ? DAY_NAMES.indexOf(match[1]) + 1 || (match[1] === '天' ? 7 : Number(match[1])) : null;
};
const hasWeeks = text => /\d\s*(?:[（(]周[）)]|周)/.test(text) || /周次\s*[:：]/.test(text);
const hasPeriods = text => /\d\s*(?:[（(]节[）)]|节)/.test(text) || /节次\s*[:：]/.test(text);
const metaLine = text => /^(?:周次|节次|教师|老师|任课教师|教室|地点|上课地点|教学班|学分|考核|备注|星期)\s*[:：]/.test(text) || hasWeeks(text) || hasPeriods(text);

function linesOf(items) {
  const rows = [];
  for (const item of [...items].sort((a,b) => a.y - b.y || a.x - b.x)) {
    const last = rows.at(-1);
    const row = last && Math.abs(last.y-item.y) <= Math.max(2, Math.min(last.height,item.height)*0.3) ? last : null;
    if (row) { row.items.push(item); row.height=Math.max(row.height,item.height); }
    else rows.push({y:item.y,height:item.height,items:[item]});
  }
  return rows.map(row => {
    const ordered=row.items.sort((a,b)=>a.x-b.x);
    let text='',end=-Infinity;
    for(const item of ordered){
      if(text && item.x-end > Math.max(2,item.height*0.55))text+=' ';
      text+=item.text;end=item.x+item.width;
    }
    return {...row,text:clean(text),x:ordered[0].x,width:end-ordered[0].x};
  }).sort((a,b)=>a.y-b.y);
}

function splitBlocks(lines) {
  // Blank vertical space is a delimiter; within one cell, a new name followed
  // by a second week expression starts another arrangement.
  const groups=[];let current=[];
  for(const line of lines){
    const last=current.at(-1);
    if(last && line.y-last.y>Math.max(last.height,line.height)*2.6){groups.push(current);current=[];}
    current.push(line);
  }
  if(current.length)groups.push(current);
  return groups.flatMap(group=>{
    const result=[];let start=0,seenWeeks=false;
    for(let index=0;index<group.length;index++){
      if(!hasWeeks(group[index].text))continue;
      if(seenWeeks){
        let name=index-1;
        while(name>=start && metaLine(group[name].text))name--;
        if(name>=start && group.slice(start,name).some(line=>hasWeeks(line.text))){
          result.push(group.slice(start,name));start=name;
        }
      }
      seenWeeks=true;
    }
    result.push(group.slice(start));return result;
  });
}

/** Pure coordinate parser, exported for deterministic fixtures and browser QA.
 * Coordinates must be top-left page coordinates, as normalized by parsePdf.
 */
export function parsePdfTextPages(pages,{totalWeeks=20,name='课表 PDF'}={}) {
  const result={courses:[],warnings:[],source:clean(name).slice(0,100)||'课表 PDF'};
  const fingerprints=new Set();let textPages=0;
  if(!Array.isArray(pages)||pages.length>MAX_PAGES) return {...result,warnings:[`PDF 最多支持 ${MAX_PAGES} 页。`]};
  if(!Number.isInteger(totalWeeks)||totalWeeks<1||totalWeeks>30)return {...result,warnings:['学期周数应为 1—30。']};
  const warn=text=>{if(result.warnings.length<80)result.warnings.push(text);};
  const add=(parsed,page)=>{
    parsed.warnings.forEach(warning=>warn(`第 ${page} 页：${warning}`));
    for(const course of parsed.courses){
      const key=JSON.stringify([course.name,course.teacher,course.location,course.day,course.startPeriod,course.endPeriod,course.weeks]);
      if(!fingerprints.has(key)&&result.courses.length<500){fingerprints.add(key);result.courses.push(course);}
    }
  };
  pages.forEach((page,pageIndex)=>{
    const pageNumber=pageIndex+1;
    const items=(page.items??[]).filter(item=>clean(item.text)&&[item.x,item.y,item.width,item.height].every(Number.isFinite)).map(item=>({...item,text:clean(item.text),height:Math.max(1,item.height)}));
    if(!items.length){warn(`第 ${pageNumber} 页没有可读取的文字；扫描图片暂不支持 OCR。`);return;}
    if(items.length>MAX_ITEMS){warn(`第 ${pageNumber} 页文字过多，已跳过。`);return;}
    textPages++;
    const allLines=linesOf(items);
    // A header may be one item or individual Chinese glyphs.
    const candidates=items.map(item=>({...item,day:dayOf(item.text)})).filter(item=>item.day);
    for(const line of allLines){
      for(const run of clusterByGap(line.items)){
        const text=run.map(item=>item.text).join('');const day=dayOf(text);
        if(day&&!candidates.some(candidate=>candidate.day===day&&Math.abs(candidate.y-line.y)<3))candidates.push({...run[0],width:run.at(-1).x+run.at(-1).width-run[0].x,day});
      }
    }
    const headers=[];
    for(const item of candidates.sort((a,b)=>a.y-b.y)){
      const row=candidates.filter(candidate=>Math.abs(candidate.y-item.y)<Math.max(4,item.height*0.6)).sort((a,b)=>a.x-b.x);
      if(new Set(row.map(candidate=>candidate.day)).size<3||row.some((candidate,i)=>i&&candidate.day<=row[i-1].day))continue;
      if(!headers.some(header=>Math.abs(header.y-item.y)<5))headers.push({y:item.y,height:item.height,columns:row});
    }
    if(!headers.length){
      // Free-form exports can still import when every course explicitly names
      // its own weekday, periods and weeks. Never infer weekday from column index.
      const text=allLines.map(line=>line.text).join('\n');
      if(/(?:星期|周)[一二三四五六日天1-7]/.test(text)&&hasWeeks(text))add(parseSchedule({text,title:result.source},totalWeeks),pageNumber);
      else warn(`第 ${pageNumber} 页未识别到星期表头，请使用含完整星期、节次和周次的文字型课表 PDF。`);
      return;
    }
    headers.forEach((header,index)=>{
      const nextY=headers[index+1]?.y??page.height??Infinity;
      const centers=header.columns.map(column=>column.x+column.width/2);
      const gaps=centers.slice(1).map((center,i)=>center-centers[i]);
      const firstEdge=centers[0]-gaps[0]/2;
      const lastEdge=centers.at(-1)+gaps.at(-1)/2;
      const periodLabels=linesOf(items.filter(item=>item.x+item.width<=firstEdge+2&&item.y>header.y+header.height&&item.y<nextY))
        .map(line=>({...line,match:line.text.replace(/\s/g,'').match(/^第?(\d{1,2})(?:[-—–~～至](\d{1,2}))?节?$/)}))
        .filter(line=>line.match&&Number(line.match[1])>=1&&Number(line.match[2]??line.match[1])<=12);
      header.columns.forEach((column,columnIndex)=>{
        const left=columnIndex?(centers[columnIndex-1]+centers[columnIndex])/2:firstEdge;
        const right=columnIndex===centers.length-1?lastEdge:(centers[columnIndex]+centers[columnIndex+1])/2;
        const content=items.filter(item=>item.x>=left-2&&item.x<right-2&&item.y>header.y+header.height*0.8&&item.y<nextY-header.height);
        const lines=linesOf(content);
        for(const block of splitBlocks(lines)){
          let text=block.map(line=>line.text).join('\n');
          if(!hasWeeks(text)){
            if(hasPeriods(text)||/(?:教师|老师|教室|地点)\s*[:：]/.test(text))warn(`第 ${pageNumber} 页：一个课程区块缺少明确周次，已跳过，请核对原课表。`);
            continue;
          }
          // Row labels give only an explicit section range, never a guessed span.
          if(!hasPeriods(text)){
            const center=(block[0].y+block.at(-1).y)/2;
            const nearest=[...periodLabels].sort((a,b)=>Math.abs(a.y-center)-Math.abs(b.y-center))[0];
            const distance=nearest?Math.abs(nearest.y-center):Infinity;
            const spacing=periodLabels.length>1?Math.min(...periodLabels.slice(1).map((row,i)=>row.y-periodLabels[i].y)):0;
            if(nearest&&nearest.match[2]&&distance<spacing/2)text+=`\n节次：${nearest.match[1]}-${nearest.match[2]}节`;
          }
          text+=`\n星期：周${DAY_NAMES[column.day-1]}`;
          add(parseSchedule({text,title:result.source},totalWeeks),pageNumber);
        }
      });
    });
  });
  if(!result.courses.length&&textPages)warn('未识别到完整课程；请核对 PDF 是否包含课程名、星期、节次和周次。');
  result.warnings=[...new Set(result.warnings)];
  result.courses.sort((a,b)=>a.day-b.day||a.startPeriod-b.startPeriod||a.name.localeCompare(b.name,'zh-CN'));
  return result;
}

function clusterByGap(items){
  const groups=[];let group=[],end=-Infinity;
  for(const item of [...items].sort((a,b)=>a.x-b.x)){
    if(group.length&&item.x-end>Math.max(4,item.height)){groups.push(group);group=[];}
    group.push(item);end=item.x+item.width;
  }
  if(group.length)groups.push(group);return groups;
}

function timed(promise,milliseconds){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('PDF 解析耗时过长，请只导出课程表页后重试。')),milliseconds);})]).finally(()=>clearTimeout(timer));
}

/** Local-only PDF.js extraction. Never pass a user-provided URL to PDF.js. */
export async function parsePdf(input,{totalWeeks=20,name='课表 PDF'}={}) {
  const source=clean(name).slice(0,100)||'课表 PDF';
  const failure=message=>({courses:[],warnings:[message],source});
  const bytes=input instanceof Uint8Array?input:input instanceof ArrayBuffer?new Uint8Array(input):null;
  if(!bytes||!bytes.length)return failure('请选择有效的 PDF 文件。');
  if(bytes.byteLength>MAX_BYTES)return failure('PDF 超过 20 MB，请导出仅包含课程表的文件。');
  if(!new TextDecoder('ascii').decode(bytes.subarray(0,1024)).includes('%PDF-'))return failure('文件不是有效的 PDF。');
  let loadingTask;
  try{
    const pdfjs=await import('./vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.min.mjs',import.meta.url).href;
    loadingTask=pdfjs.getDocument({
      data:bytes.slice(),cMapUrl:new URL('./vendor/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,
      standardFontDataUrl:new URL('./vendor/pdfjs/standard_fonts/',import.meta.url).href,
      isEvalSupported:false,useWasm:false,useSystemFonts:false,disableFontFace:true,
      stopAtErrors:true,enableXfa:false,verbosity:0,
    });
    const pdf=await timed(loadingTask.promise,15000);
    if(pdf.numPages>MAX_PAGES)return failure(`PDF 有 ${pdf.numPages} 页，最多支持 ${MAX_PAGES} 页，请只导出课程表。`);
    const pages=[],started=Date.now();
    for(let number=1;number<=pdf.numPages;number++){
      if(Date.now()-started>45000)throw new Error('PDF 解析耗时过长，请只导出课程表页后重试。');
      const page=await timed(pdf.getPage(number),15000),viewport=page.getViewport({scale:1});
      const content=await timed(page.getTextContent(),15000);
      if(content.items.length>MAX_ITEMS)throw new Error(`第 ${number} 页文字过多，请简化 PDF 后重试。`);
      pages.push({width:viewport.width,height:viewport.height,items:content.items.filter(item=>typeof item.str==='string').map(item=>{
        const matrix=pdfjs.Util.transform(viewport.transform,item.transform);
        return {text:item.str,x:matrix[4],y:matrix[5],width:Math.abs(item.width),height:Math.max(Math.abs(item.height),Math.hypot(matrix[2],matrix[3]))};
      })});
      page.cleanup();
    }
    return parsePdfTextPages(pages,{totalWeeks,name:source});
  }catch(error){
    if(error?.name==='PasswordException')return failure('PDF 已加密，请先在学校系统导出不带密码的课表。');
    if(error?.name==='InvalidPDFException')return failure('PDF 已损坏或格式不受支持，请重新导出。');
    return failure(`PDF 读取失败：${clean(error?.message||'文件无法解析').slice(0,180)}`);
  }finally{await loadingTask?.destroy().catch(()=>{});}
}
