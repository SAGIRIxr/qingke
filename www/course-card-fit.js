/** Round down to complete line boxes; a clipped half-line must never be shown. */
export function wholeTextLines(available,lineHeight,limit=20){
  if(!Number.isFinite(available)||!Number.isFinite(lineHeight)||lineHeight<=0)return 0;
  return Math.max(0,Math.min(limit,Math.floor((available+0.01)/lineHeight)));
}

const fitted=new WeakMap();
const number=value=>parseFloat(value)||0;
const lineHeight=element=>{const style=getComputedStyle(element);return number(style.lineHeight)||number(style.fontSize)*1.4;};
const visible=element=>getComputedStyle(element).display!=='none'&&!element.hidden;
function contentHeight(element){const style=getComputedStyle(element);return element.getBoundingClientRect().height-number(style.paddingTop)-number(style.paddingBottom)-number(style.borderTopWidth)-number(style.borderBottomWidth);}
function typographyKey(card){
  return [...card.querySelectorAll('strong,small,.room-label,[data-live-label]')].map(element=>{
    const style=getComputedStyle(element);
    return [style.fontFamily,style.fontSize,style.lineHeight,style.fontWeight,style.letterSpacing].join(',');
  }).join(';');
}

/** Fixed timetable cells use flex, whose shrink can otherwise cut a glyph in half.
 * Recompute only on a size/status change, reserving complete lines for the title.
 */
export function fitCourseCardText(card){
  const main=card.querySelector('.course-main')||card,name=main.querySelector(':scope > strong');
  if(!name)return;
  const box=card.getBoundingClientRect(),key=[box.width,box.height,card.className,card.querySelector('[data-live-label]')?.textContent,typographyKey(card)].join('|');
  const previous=fitted.get(card);if(previous?.key===key)return;
  for(const item of previous?.changed||[]){item.style.removeProperty('display');item.style.removeProperty('max-height');item.style.removeProperty('-webkit-line-clamp');}
  name.style.removeProperty('max-height');name.style.removeProperty('-webkit-line-clamp');
  const cssLimit=number(getComputedStyle(name).webkitLineClamp)||20,lh=lineHeight(name),gap=number(getComputedStyle(main).rowGap);
  const others=[...main.children].filter(item=>item!==name),changed=[];
  const available=()=>{const shown=others.filter(visible);return contentHeight(main)-shown.reduce((sum,item)=>sum+item.getBoundingClientRect().height,0)-shown.length*gap;};
  // Keep the course title readable first. Less essential lines yield whole rows.
  const donors=card.classList.contains('course-block')?[main.querySelector('.actual-time'),main.querySelector('.room-label')]:['.conflict-member-place','.conflict-member-time','.conflict-member-origin','.course-progress','[data-live-label]'].map(selector=>main.querySelector(selector));
  for(const item of donors.filter(Boolean)){
    if(available()>=lh-0.01)break;
    if(!visible(item))continue;
    const itemLine=lineHeight(item),itemLines=wholeTextLines(item.getBoundingClientRect().height,itemLine);
    const keep=Math.max(0,itemLines-Math.ceil((lh-available())/itemLine));
    if(keep){item.style.maxHeight=`${keep*itemLine}px`;item.style.webkitLineClamp=String(keep);}else item.style.display='none';
    changed.push(item);
  }
  const lines=wholeTextLines(available(),lh,cssLimit);
  name.style.webkitLineClamp=String(Math.max(1,lines));name.style.maxHeight=`${lines*lh}px`;
  fitted.set(card,{key,changed});
}
