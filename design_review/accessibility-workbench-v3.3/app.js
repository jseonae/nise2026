const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let sourceText="", fileName="", testWin=null, findings=[], chartReports=[], layoutReports=[], mode="all", staticFindings=[];
let autoRead=false, targetFocusHandler=null, speechRate=1.0;

$("#fileInput").addEventListener("change", async e=>{
  const f=e.target.files[0]; if(!f)return;
  sourceText=await f.text(); fileName=f.name;
  $("#fileMeta").textContent=`${f.name} · ${(f.size/1024/1024).toFixed(2)} MB`;
  $("#openTestWindow").disabled=false;
  staticFindings=scanStatic(sourceText);
  findings=[...staticFindings];
  renderFindings(); updateMetrics();
});

$("#openTestWindow").addEventListener("click",()=>openTargetWindow());
$("#scanWindow").addEventListener("click",()=>scanTargetWindow());
$("#focusWindow").addEventListener("click",()=>{if(testWin&&!testWin.closed)testWin.focus()});
$("#severityFilter").addEventListener("change",renderFindings);
$("#searchFilter").addEventListener("input",renderFindings);

$$(".mode").forEach(b=>b.addEventListener("click",()=>{
  $$(".mode").forEach(x=>x.classList.remove("active"));b.classList.add("active");mode=b.dataset.mode;renderFindings();
}));
$$(".view-btn").forEach(b=>b.addEventListener("click",()=>setTargetView(b.dataset.view)));
$("#exportJson").addEventListener("click",()=>download("accessibility-v3-report.json",JSON.stringify({file:fileName,manual:getManual(),findings,charts:chartReports,layout:layoutReports},null,2),"application/json"));
$("#exportCsv").addEventListener("click",()=>download("accessibility-v3-report.csv",csv(findings),"text/csv;charset=utf-8"));
$("#readCurrentFocus").addEventListener("click",()=>readCurrentTargetFocus());
$("#toggleAutoRead").addEventListener("click",()=>{
  autoRead=!autoRead;
  const b=$("#toggleAutoRead");
  b.setAttribute("aria-pressed",String(autoRead));
  b.textContent=`자동 읽기: ${autoRead?"ON":"OFF"}`;
  updateTtsStatus(autoRead?"자동 읽기 켜짐":"자동 읽기 꺼짐",false);
});
$("#stopSpeech").addEventListener("click",()=>stopSpeech());
$("#speechRate").addEventListener("input",e=>{
  speechRate=Number(e.target.value)||1;
  $("#speechRateValue").textContent=speechRate.toFixed(1)+"×";
});

function openTargetWindow(){
  if(!sourceText)return;
  if(testWin&&!testWin.closed) testWin.close();
  testWin=window.open("about:blank","a11yRuntimeTarget","width=1440,height=960,resizable=yes,scrollbars=yes");
  if(!testWin){alert("팝업이 차단되었습니다. 이 페이지의 팝업을 허용해 주세요.");return}
  try{
    testWin.document.open();
    testWin.document.write(sourceText);
    testWin.document.close();
    testWin.focus();
    $("#scanWindow").disabled=false; $("#focusWindow").disabled=false;
    $("#readCurrentFocus").disabled=false; $("#toggleAutoRead").disabled=false;
    attachTargetFocusReader();
    setWindowState(true,"테스트 창이 열렸습니다.","별도 창에서 그래프 카드를 클릭하고 키보드로 직접 조작하세요.");
    setTimeout(updateCurrentPage,700);
  }catch(err){
    setWindowState(false,"테스트 창 실행 실패",String(err));
  }
}

function scanStatic(html){
 const d=new DOMParser().parseFromString(html,"text/html"), out=[];
 const add=(severity,category,title,detail,suggestion,modes=["all"],selector="")=>out.push({severity,category,title,detail,suggestion,modes,selector,source:"static"});
 add(d.documentElement.getAttribute("lang")?"pass":"fail","문서 구조","문서 기본 언어",d.documentElement.getAttribute("lang")?`lang="${d.documentElement.getAttribute("lang")}"`:"lang 속성 없음",d.documentElement.getAttribute("lang")?"유지하세요.":"<html lang=\"ko\">를 선언하세요.",["blind","all"],"html");
 [...d.images].forEach(img=>add(img.hasAttribute("alt")?"pass":"fail","대체텍스트","이미지 alt",img.hasAttribute("alt")?`alt="${img.getAttribute("alt")}"`:"alt 없음",img.hasAttribute("alt")?"내용 적절성 수동 확인":"정보성 이미지는 alt를 제공하세요.",["blind","all"],sel(img)));
 const hasKeyboard=/keydown|aria-keyshortcuts|enableChartKeyboardNavigation|data-chart-keyboard/i.test(html);
 add(hasKeyboard?"pass":"warn","차트","키보드 구현 코드",hasKeyboard?"키보드 관련 코드 발견":"키보드 관련 코드 미발견","실행 화면에서 실제 동작을 확인하세요.",["blind","motor","all"],"source");
 const hasPressed=/aria-pressed/i.test(html);
 add(hasPressed?"pass":"warn","상태 전달","aria-pressed 사용",hasPressed?"토글 상태 속성 발견":"aria-pressed 미발견","범례/토글 버튼 상태가 접근성 API에 전달되는지 확인하세요.",["blind","all"],"source");

 // 청각장애: 정적 멀티미디어 검사
 const videos=[...d.querySelectorAll("video")], audios=[...d.querySelectorAll("audio")];
 const media=[...videos,...audios];
 if(media.length===0){
   add("pass","청각장애","멀티미디어 요소 없음","video/audio 요소가 없습니다.","현재 문서에서 자동 탐지되는 음성·영상 콘텐츠는 없습니다.",["hearing","all"],"media");
 }else{
   media.forEach(m=>{
     const tracks=[...m.querySelectorAll('track[kind="captions"],track[kind="subtitles"]')];
     const isVideo=m.tagName==="VIDEO";
     add(
       isVideo ? (tracks.length?"pass":"warn") : "warn",
       "청각장애",
       isVideo ? "영상 자막 제공 여부" : "음성 콘텐츠 대체수단",
       isVideo ? (tracks.length?`자막/subtitles track ${tracks.length}개 발견`:"자막/subtitles track을 찾지 못함") : "audio 요소가 있습니다.",
       isVideo ? (tracks.length?"실제 자막 내용과 동기화 품질을 수동 확인하세요.":"자막, 수어, 대본 등 동등한 대체수단을 제공하세요.") : "음성 내용을 텍스트 대본 등으로 동일하게 제공하는지 확인하세요.",
       ["hearing","all"], sel(m)
     );
     if(m.hasAttribute("autoplay")){
       add(
         m.hasAttribute("controls")?"warn":"fail",
         "청각장애",
         "자동재생 미디어 제어",
         `autoplay=${m.hasAttribute("autoplay")} / controls=${m.hasAttribute("controls")}`,
         m.hasAttribute("controls")?"사용자가 즉시 정지·음소거할 수 있는지 실제로 확인하세요.":"자동재생 소리를 사용자가 즉시 멈추거나 음소거할 수 있도록 controls 또는 별도 제어를 제공하세요.",
         ["hearing","all"], sel(m)
       );
     }
   });
 }
 const possibleSoundOnly = /new\s+Audio\s*\(|\.play\s*\(|AudioContext|webkitAudioContext/i.test(html);
 if(possibleSoundOnly){
   add("warn","청각장애","소리 전용 알림 가능성","스크립트에서 오디오 재생 관련 코드가 발견되었습니다.","알림음·성공음·경고음이 있다면 동일한 시각적 텍스트/아이콘/상태 메시지도 제공하는지 수동 확인하세요.",["hearing","all"],"source");
 }
 return out;
}

async function scanTargetWindow(){
 if(!testWin||testWin.closed){setWindowState(false,"테스트 창이 닫혀 있습니다.","다시 별도 테스트 창을 열어주세요.");return}
 setScanStatus("running","검사 중");
 findings=[...staticFindings]; chartReports=[]; layoutReports=[];
 try{
   const doc=testWin.document, win=testWin;
   updateCurrentPage();
   const charts=discoverCharts(doc,win);
   $("#chartCount").textContent=charts.length;
   for(let i=0;i<charts.length;i++) chartReports.push(await testChart(charts[i],doc,win,i));
   layoutReports=scanLayout(doc,win);
   layoutReports.forEach(x=>addRuntime(x.status,"화면 오류",x.title,x.detail,x.suggestion,x.modes,x.selector));
   testRuntimeSemantics(doc);
   renderCharts(); renderLayout(); renderScreenReader(doc); renderFindings(); updateMetrics();
   setScanStatus("done",`검사 완료 · 차트 ${charts.length}개`);
 }catch(err){
   addRuntime("warn","실행 검사","테스트 창 접근 실패",String(err),"팝업 창이 같은 출처인지, 페이지 스크립트 오류가 없는지 확인하세요.",["all"],"window");
   renderFindings(); setScanStatus("error","실행 검사 실패");
 }
}

function discoverCharts(doc,win){
 const set=new Set();
 doc.querySelectorAll('[data-chart-keyboard="true"],.detail-chart[tabindex],.chart-box[tabindex],#trend-chart[tabindex],[aria-keyshortcuts]').forEach(el=>{
   if(el.offsetWidth>0&&el.offsetHeight>0)set.add(el)
 });
 if(win.echarts&&typeof win.echarts.getInstanceByDom==="function"){
   doc.querySelectorAll("div").forEach(el=>{
     try{if(win.echarts.getInstanceByDom(el)&&el.offsetWidth>0&&el.offsetHeight>0)set.add(el)}catch(e){}
   });
 }
 return [...set];
}

async function testChart(el,doc,win,index){
 const name=accName(el)||el.id||`차트 ${index+1}`, tests=[];
 const push=(key,status,label,detail)=>tests.push({key,status,label,detail});
 let instance=null; try{instance=win.echarts&&win.echarts.getInstanceByDom?win.echarts.getInstanceByDom(el):null}catch(e){}
 push("engine",instance?"pass":"warn","ECharts 실행",instance?"실행 인스턴스 확인":"인스턴스 직접 확인 안 됨");
 push("tab",el.tabIndex>=0?"pass":"fail","Tab 접근",`tabIndex=${el.tabIndex}`);
 push("role",el.getAttribute("role")?"pass":"warn","role",el.getAttribute("role")||"없음");
 push("name",(el.getAttribute("aria-label")||el.getAttribute("aria-labelledby"))?"pass":"fail","접근 가능한 이름",accName(el)||"없음");
 push("keys",el.getAttribute("aria-keyshortcuts")?"pass":"warn","aria-keyshortcuts",el.getAttribute("aria-keyshortcuts")||"없음");

 let focusOK=false;
 try{el.focus({preventScroll:true});focusOK=doc.activeElement===el}catch(e){}
 push("focus",focusOK?"pass":"fail","실제 포커스",focusOK?"activeElement 일치":"포커스 이동 실패");

 let keyStates=[];
 for(const key of ["ArrowRight","ArrowLeft","ArrowDown","ArrowUp","Enter"," ","Escape"]){
   const ev=new win.KeyboardEvent("keydown",{key,bubbles:true,cancelable:true});
   const ret=el.dispatchEvent(ev);
   keyStates.push(`${key===" "?"Space":key}:${(!ret||ev.defaultPrevented)?"처리":"미확인"}`);
   await delay(20);
 }
 const handled=keyStates.filter(x=>x.endsWith("처리")).length;
 push("keyboard",handled>=6?"pass":handled>=3?"warn":"fail","키 이벤트 처리",keyStates.join(" · "));

 const section=el.closest(".spec-section,.detail-section,.card,section,main")||el.parentElement;
 const table=section&&section.querySelector("table");
 push("table",table?"pass":"warn","대체 데이터 표",table?"같은 화면 영역에서 table 발견":"같은 화면 영역에서 table 미발견");

 const legends=section?[...section.querySelectorAll('button[aria-pressed],.ts-html-legend-item[aria-pressed]')].filter(isVisible):[];
 let toggled=0;
 for(const b of legends.slice(0,5)){
   const before=b.getAttribute("aria-pressed");
   try{b.click();await delay(25);const after=b.getAttribute("aria-pressed");if(before!==after)toggled++;b.click();await delay(25)}catch(e){}
 }
 push("legend",legends.length?(toggled?"pass":"warn"):"warn","범례 상태 변경",legends.length?`범례 ${legends.length}개 · 상태 변경 확인 ${toggled}개`:"범례 토글 버튼 미발견");

 let focusVisual="확인필요", focusStatus="warn";
 try{
   el.focus({preventScroll:true}); const cs=win.getComputedStyle(el);
   if((cs.outlineStyle&&cs.outlineStyle!=="none"&&parseFloat(cs.outlineWidth)>0)||cs.boxShadow!=="none"){focusStatus="pass";focusVisual="outline/box-shadow 표시 단서 확인"}
 }catch(e){}
 push("focusVisual",focusStatus,"포커스 표시",focusVisual);

 tests.forEach(t=>addRuntime(t.status,"실행 차트",`${short(name)} · ${t.label}`,t.detail,suggestionFor(t.key),["blind","motor","all"],"#"+(el.id||`chart-${index+1}`)));
 const status=tests.some(t=>t.status==="fail")?"fail":tests.some(t=>t.status==="warn")?"warn":"pass";
 return {name:short(name),id:el.id||"",status,tests};
}

function scanLayout(doc,win){
 const out=[], vw=win.innerWidth, vh=win.innerHeight;
 const body=doc.body, html=doc.documentElement;
 const scrollW=Math.max(body?.scrollWidth||0,html?.scrollWidth||0);
 out.push({
   status:scrollW>vw+3?"warn":"pass",
   title:"페이지 가로 오버플로",
   detail:scrollW>vw+3?`viewport ${vw}px / 문서폭 ${scrollW}px — 가로 스크롤 가능성`:`문서폭 ${scrollW}px / viewport ${vw}px`,
   suggestion:scrollW>vw+3?"고정 폭, min-width, 긴 텍스트/차트 컨테이너를 확인하세요.":"현재 viewport에서 페이지 전체 가로 오버플로는 없습니다.",
   modes:["lowvision","motor","all"],selector:"document"
 });
 const focusables=[...doc.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(isVisible);
 const off=focusables.filter(el=>{
   const r=el.getBoundingClientRect(); return r.right<0||r.left>vw||r.bottom<0||r.top>Math.max(vh,doc.documentElement.scrollHeight);
 });
 out.push({
   status:off.length?"warn":"pass",
   title:"포커스 가능 요소 화면 이탈",
   detail:off.length?`${off.length}개 요소가 화면/문서 범위 밖에 위치할 가능성`:"명확한 화면 이탈 포커스 요소 없음",
   suggestion:off.length?`예: ${off.slice(0,3).map(sel).join(", ")}`:"현재 상태를 유지하세요.",
   modes:["motor","blind","all"],selector:off[0]?sel(off[0]):"focusable"
 });
 const clipped=focusables.filter(el=>{
   const p=el.parentElement;if(!p)return false;
   const ps=win.getComputedStyle(p),r=el.getBoundingClientRect(),pr=p.getBoundingClientRect();
   return /(hidden|clip)/.test(ps.overflow+ps.overflowX+ps.overflowY) && (r.right>pr.right+2||r.bottom>pr.bottom+2||r.left<pr.left-2||r.top<pr.top-2);
 });
 out.push({
   status:clipped.length?"warn":"pass",
   title:"포커스 요소 잘림",
   detail:clipped.length?`${clipped.length}개 포커스 가능 요소가 overflow 영역에서 잘릴 가능성`:"명확한 포커스 요소 잘림 없음",
   suggestion:clipped.length?`예: ${clipped.slice(0,3).map(sel).join(", ")}`:"현재 상태를 유지하세요.",
   modes:["lowvision","motor","all"],selector:clipped[0]?sel(clipped[0]):"focusable"
 });
 const small=focusables.filter(el=>{
   const r=el.getBoundingClientRect(); return r.width>0&&r.height>0&&(r.width<24||r.height<24);
 });
 out.push({
   status:small.length?"warn":"pass",
   title:"작은 조작 영역",
   detail:small.length?`${small.length}개 조작 요소가 24px보다 작은 축을 가짐`:"매우 작은 조작 영역이 자동 탐지되지 않음",
   suggestion:small.length?`모바일/운동장애 사용자를 위해 클릭 영역을 확인하세요. 예: ${small.slice(0,3).map(sel).join(", ")}`:"현재 상태를 유지하세요.",
   modes:["motor","all"],selector:small[0]?sel(small[0]):"controls"
 });
 const dialogs=[...doc.querySelectorAll('[role="dialog"],dialog')].filter(isVisible);
 out.push({
   status:dialogs.length&&dialogs.some(d=>!d.getAttribute("aria-label")&&!d.getAttribute("aria-labelledby"))?"warn":"pass",
   title:"열린 모달 제목 연결",
   detail:dialogs.length?`열린 대화상자 ${dialogs.length}개`:"현재 열린 대화상자 없음",
   suggestion:"대화상자에는 제목 연결과 초점 진입/복귀, 배경 조작 차단을 확인하세요.",
   modes:["blind","motor","all"],selector:dialogs[0]?sel(dialogs[0]):"dialog"
 });
 const styled=[...doc.querySelectorAll("body *")].filter(isVisible).slice(0,1200);
 const transparentText=styled.filter(el=>{
   try{
     const cs=win.getComputedStyle(el);
     const c=cs.color.replace(/\\s/g,"");
     return (c==="rgba(0,0,0,0)"||c==="transparent") && (el.textContent||"").trim().length>0;
   }catch(e){return false}
 });
 out.push({
   status:transparentText.length?"warn":"pass",
   title:"텍스트 가시성",
   detail:transparentText.length?`${transparentText.length}개 요소에서 투명 텍스트 가능성`:"투명 텍스트가 자동 탐지되지 않음",
   suggestion:transparentText.length?`다크/고대비 모드에서 텍스트가 배경과 섞이지 않는지 확인하세요. 예: ${transparentText.slice(0,3).map(sel).join(", ")}`:"현재 상태를 유지하세요.",
   modes:["lowvision","all"],selector:transparentText[0]?sel(transparentText[0]):"text"
 });
 const focusCandidates=[...doc.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(isVisible).slice(0,200);
 let weakFocus=0;
 focusCandidates.forEach(el=>{
   try{
     const cs=win.getComputedStyle(el);
     const none=(cs.outlineStyle==="none"||parseFloat(cs.outlineWidth)===0) && (cs.boxShadow==="none");
     if(none) weakFocus++;
   }catch(e){}
 });
 out.push({
   status:weakFocus?"warn":"pass",
   title:"포커스 시각 표시 단서",
   detail:weakFocus?`${weakFocus}개 포커스 요소에서 기본 outline/box-shadow 단서 미확인`:"포커스 표시 스타일 단서 확인",
   suggestion:weakFocus?"다크/고대비 모드에서도 포커스 링이 배경과 충분히 구분되는지 직접 확인하세요.":"다크·고대비 모드에서도 동일하게 확인하세요.",
   modes:["lowvision","motor","all"],selector:"focusable"
 });
 return out;
}

function testRuntimeSemantics(doc){
 const pressed=[...doc.querySelectorAll('button[aria-pressed]')].filter(isVisible);
 addRuntime(pressed.length?"pass":"warn","상태 전달","현재 화면 aria-pressed 버튼",`${pressed.length}개 발견`,"범례 상태와 aria-pressed 값이 함께 바뀌는지 확인하세요.",["blind","all"],"button[aria-pressed]");
 const live=[...doc.querySelectorAll('[aria-live]')].filter(isVisible);
 addRuntime(live.length?"pass":"warn","동적 알림","현재 화면 aria-live",`${live.length}개 발견`,"실제 NVDA/센스리더에서 데이터 이동 시 읽기 문구와 빈도를 확인하세요.",["blind","all"],"[aria-live]");

 // 청각장애: 실행 화면의 멀티미디어/소리 전달 검사
 const media=[...doc.querySelectorAll("video,audio")].filter(isVisible);
 if(media.length===0){
   addRuntime("pass","청각장애","현재 화면 멀티미디어","표시 중인 video/audio 요소 없음","현재 화면에서 자동 탐지되는 음성·영상 콘텐츠는 없습니다.",["hearing","all"],"video,audio");
 }else{
   media.forEach(m=>{
     const isVideo=m.tagName==="VIDEO";
     const tracks=[...m.querySelectorAll('track[kind="captions"],track[kind="subtitles"]')];
     if(isVideo){
       addRuntime(tracks.length?"pass":"warn","청각장애","실행 영상 자막",tracks.length?`자막/subtitles track ${tracks.length}개`:"자막 track 미발견",tracks.length?"자막 동기화와 내용 완전성을 수동 확인하세요.":"자막/수어/대본 등 동등한 대체수단을 제공하세요.",["hearing","all"],sel(m));
     }else{
       addRuntime("warn","청각장애","실행 음성 콘텐츠 대본 확인","audio 요소가 표시 중입니다.","동일 정보를 제공하는 텍스트 대본 또는 시각적 대체가 있는지 확인하세요.",["hearing","all"],sel(m));
     }
     if(m.autoplay){
       addRuntime(m.controls?"warn":"fail","청각장애","자동재생 미디어 제어",`autoplay=${m.autoplay} / controls=${m.controls}`,"사용자가 즉시 정지·음소거할 수 있어야 합니다.",["hearing","all"],sel(m));
     }
   });
 }
}

function renderCharts(){
 const root=$("#chartResults");
 if(!chartReports.length){root.className="empty";root.textContent="현재 화면에서 실행 차트를 찾지 못했습니다. 테스트 창에서 그래프 카드를 클릭해 상세 화면으로 이동한 뒤 다시 검사하세요.";return}
 root.className="";
 root.innerHTML=chartReports.map((r,i)=>`<article class="chart-card"><div class="chart-head"><div><h3>${esc(r.name)}</h3><div class="meta">${esc(r.id||`chart-${i+1}`)}</div></div><span class="badge ${r.status}">${lab(r.status)}</span></div><div class="check-grid">${r.tests.map(t=>`<div class="check ${t.status}"><strong>${lab(t.status)} · ${esc(t.label)}</strong><span>${esc(t.detail)}</span></div>`).join("")}</div></article>`).join("");
}
function renderLayout(){
 const root=$("#layoutResults");root.className="layout-grid";
 root.innerHTML=layoutReports.map(r=>`<div class="layout-item"><span class="badge ${r.status}">${lab(r.status)}</span><strong>${esc(r.title)}</strong><span>${esc(r.detail)}</span></div>`).join("");
}
function renderFindings(){
 const sev=$("#severityFilter").value,q=$("#searchFilter").value.trim().toLowerCase();
 const list=findings.filter(f=>(sev==="all"||f.severity===sev)).filter(f=>mode==="all"||f.modes.includes(mode)||f.modes.includes("all")).filter(f=>!q||`${f.category} ${f.title} ${f.detail} ${f.selector}`.toLowerCase().includes(q));
 const root=$("#allResults");
 if(!list.length){root.className="empty";root.textContent="조건에 맞는 결과가 없습니다.";return}
 root.className="result-list";
 root.innerHTML=list.map(f=>`<article class="result"><span class="badge ${f.severity}">${lab(f.severity)}</span><h3>${esc(f.title)}</h3><code>${esc(f.category)}${f.selector?" · "+esc(f.selector):""}</code><p>${esc(f.detail)}</p><p><b>확인/개선:</b> ${esc(f.suggestion)}</p></article>`).join("");
}
function renderScreenReader(doc){
 const els=[...doc.querySelectorAll('h1,h2,h3,h4,h5,h6,a,button,input,select,textarea,img,[role],[aria-label],[aria-live]')].filter(isVisible).slice(0,120);
 const root=$("#srView");
 if(!els.length){root.className="empty";root.textContent="표시할 요소가 없습니다.";return}
 root.className="";
 root.innerHTML=els.map((el,i)=>{
   const spoken=screenReaderText(el);
   return `<div class="sr-item">
     <div class="sr-copy"><b>${esc(role(el))}</b> · ${esc(accName(el)||"(이름 없음)")}<br><code>${esc(sel(el))}${state(el)?" · "+esc(state(el)):""}</code></div>
     <button type="button" class="sr-read" data-speak-index="${i}" aria-label="${esc(accName(el)||role(el))} 읽어보기">🔊 읽기</button>
   </div>`;
 }).join("")+`<div class="simulation-note">※ 이 음성은 브라우저 SpeechSynthesis로 만든 <b>예상 읽기 시뮬레이션</b>입니다. 실제 센스리더·NVDA·VoiceOver는 브라우저 접근성 트리를 자체 방식으로 해석하므로 최종 확인은 실제 스크린리더로 해야 합니다.</div>`;
 root.querySelectorAll("[data-speak-index]").forEach(btn=>{
   btn.addEventListener("click",()=>{
     const el=els[Number(btn.dataset.speakIndex)];
     if(el)speakText(screenReaderText(el));
   });
 });
}
function updateCurrentPage(){
 if(!testWin||testWin.closed)return;
 try{
   const d=testWin.document, title=d.title||"(제목 없음)";
   const heading=d.querySelector("h1,h2")?.textContent?.trim();
   $("#currentPageLabel").textContent="현재 화면: "+short(heading||title);
   setWindowState(true,"테스트 창 연결됨",`직접 키보드 조작 후 검사하세요. · ${short(title)}`);
 }catch(e){}
}
function setTargetView(v){
 if(!testWin||testWin.closed){alert("테스트 창을 먼저 여세요.");return}
 try{
   const d=testWin.document;
   let style=d.getElementById("__a11yWorkbenchView");
   if(!style){style=d.createElement("style");style.id="__a11yWorkbenchView";d.head.appendChild(style)}
   if(v==="normal")style.textContent="";
   if(v==="zoom200")style.textContent="html{zoom:2}";
   if(v==="zoom400")style.textContent="html{zoom:4}";
   if(v==="gray")style.textContent="html{filter:grayscale(1)}";
   if(v==="dark")style.textContent=`
     html{color-scheme:dark;background:#111827!important}
     body{background:#111827!important;color:#f9fafb!important}
     body *:not(img):not(video):not(canvas):not(svg){border-color:#667085!important}
     body a{color:#93c5fd!important}
     body button,body input,body select,body textarea{
       background:#1f2937!important;color:#f9fafb!important;border-color:#94a3b8!important
     }
     body [class*="card"],body [class*="panel"],body [class*="box"],body section{
       background-color:#111827!important;color:#f9fafb!important
     }
   `;
   if(v==="contrast")style.textContent=`
     html,body{background:#000!important;color:#fff!important}
     body *{text-shadow:none!important;box-shadow:none!important}
     body a{color:#00ffff!important;text-decoration:underline!important}
     body button,body input,body select,body textarea{
       background:#000!important;color:#fff!important;border:2px solid #fff!important
     }
     body *:focus{outline:4px solid #ffff00!important;outline-offset:3px!important}
     body [aria-pressed="true"],body [aria-selected="true"]{
       outline:3px solid #00ffff!important
     }
     svg text{fill:#fff!important}
   `;
   testWin.focus();
 }catch(e){alert("보기 모드를 적용할 수 없습니다.");}
}
function setWindowState(open,title,detail){
 $("#windowDot").className="status-dot "+(open?"open":"closed");$("#windowStatus").textContent=title;$("#windowDetail").textContent=detail;
}
function setScanStatus(c,t){const s=$("#scanStatus");s.className="pill "+c;s.textContent=t}
function updateMetrics(){$("#failCount").textContent=findings.filter(f=>f.severity==="fail").length;$("#warnCount").textContent=findings.filter(f=>f.severity==="warn").length;$("#passCount").textContent=findings.filter(f=>f.severity==="pass").length}
function addRuntime(severity,category,title,detail,suggestion,modes=["all"],selector=""){findings.push({severity,category,title,detail,suggestion,modes,selector,source:"runtime"})}
function getManual(){return Object.fromEntries($$("[data-manual]").map(x=>[x.dataset.manual,x.checked]))}
function suggestionFor(k){return({engine:"실행 차트 인스턴스가 생성되었는지 확인하세요.",tab:"차트 탐색이 필요하면 tabindex=\"0\"을 제공하세요.",role:"차트 영역의 의미에 맞는 role을 제공하세요.",name:"차트 제목과 탐색법을 aria-label 또는 aria-labelledby로 연결하세요.",keys:"지원 키를 aria-keyshortcuts로 명시하는 것을 권장합니다.",focus:"키보드 초점이 실제 차트 컨테이너로 이동해야 합니다.",keyboard:"Arrow/Enter/Space/Escape의 실제 동작을 별도 테스트 창에서 확인하세요.",table:"차트 원자료를 접근 가능한 표 또는 텍스트로 제공하세요.",legend:"범례는 button을 사용하고 aria-pressed 상태를 실제 표시/숨김과 동기화하세요.",focusVisual:"포커스 링이 배경과 충분히 구분되는지 육안 확인하세요."})[k]||"수동 테스트로 확인하세요."}
function role(el){if(el.getAttribute("role"))return el.getAttribute("role");if(/^H[1-6]$/.test(el.tagName))return"heading level "+el.tagName.slice(1);return({A:"link",BUTTON:"button",INPUT:"input",SELECT:"combobox",TEXTAREA:"textbox",IMG:"img"})[el.tagName]||el.tagName.toLowerCase()}
function accName(el){const ids=el.getAttribute("aria-labelledby");return el.getAttribute("aria-label")||(ids?ids.split(/\s+/).map(id=>el.ownerDocument.getElementById(id)?.textContent||"").join(" ").trim():"")||el.getAttribute("alt")||el.getAttribute("title")||(el.textContent||"").trim()}
function state(el){return["aria-pressed","aria-expanded","aria-selected","aria-checked","aria-disabled"].filter(a=>el.hasAttribute(a)).map(a=>`${a}=${el.getAttribute(a)}`).join(", ")}
function isVisible(el){try{const w=el.ownerDocument.defaultView,cs=w.getComputedStyle(el),r=el.getBoundingClientRect();return cs.display!=="none"&&cs.visibility!=="hidden"&&r.width>0&&r.height>0}catch(e){return false}}
function sel(el){if(!el||!el.tagName)return"document";if(el.id)return"#"+el.id;const c=typeof el.className==="string"?el.className.trim().split(/\s+/).filter(Boolean).slice(0,2):[];return el.tagName.toLowerCase()+(c.length?"."+c.join("."):"")}
function lab(s){return s==="fail"?"부적합":s==="warn"?"확인필요":"적합"}
function short(s){s=String(s||"");return s.length>70?s.slice(0,70)+"…":s}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function delay(ms){return new Promise(r=>setTimeout(r,ms))}
function download(name,data,type){const b=new Blob([data],{type}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function csv(rows){const cols=["severity","category","title","selector","detail","suggestion"],q=v=>`"${String(v??"").replace(/"/g,'""')}"`;return"\uFEFF"+[cols.join(","),...rows.map(r=>cols.map(c=>q(r[c])).join(","))].join("\n")}


function attachTargetFocusReader(){
 if(!testWin||testWin.closed)return;
 try{
   if(targetFocusHandler) testWin.document.removeEventListener("focusin",targetFocusHandler,true);
   targetFocusHandler=e=>{
     if(!autoRead)return;
     const el=e.target;
     if(el&&el.nodeType===1)speakText(screenReaderText(el));
   };
   testWin.document.addEventListener("focusin",targetFocusHandler,true);
 }catch(e){}
}

function readCurrentTargetFocus(){
 if(!testWin||testWin.closed){updateTtsStatus("테스트 창이 닫혀 있습니다.",false);return}
 try{
   const el=testWin.document.activeElement;
   if(!el||el===testWin.document.body||el===testWin.document.documentElement){
     updateTtsStatus("현재 읽을 포커스 요소가 없습니다.",false);return;
   }
   speakText(screenReaderText(el));
 }catch(e){updateTtsStatus("현재 포커스를 읽을 수 없습니다.",false)}
}

function screenReaderText(el){
 if(!el)return "";
 const r=role(el);
 const n=accName(el)||"이름 없음";
 const parts=[];
 if(/^heading level /.test(r)){
   parts.push(n, r.replace("heading level ","제목 수준 "));
 }else if(r==="button"){
   parts.push("버튼",n);
 }else if(r==="link"){
   parts.push("링크",n);
 }else if(r==="textbox"||r==="input"){
   parts.push("입력란",n);
 }else if(r==="combobox"){
   parts.push("콤보상자",n);
 }else if(r==="img"){
   parts.push("이미지",n);
 }else if(r==="dialog"){
   parts.push("대화상자",n);
 }else if(r==="group"){
   parts.push("그룹",n);
 }else{
   parts.push(r,n);
 }
 if(el.hasAttribute("aria-pressed")){
   parts.push(el.getAttribute("aria-pressed")==="true"?"선택됨":"선택 안 됨");
 }
 if(el.hasAttribute("aria-expanded")){
   parts.push(el.getAttribute("aria-expanded")==="true"?"펼쳐짐":"접힘");
 }
 if(el.hasAttribute("aria-selected")){
   parts.push(el.getAttribute("aria-selected")==="true"?"선택됨":"선택 안 됨");
 }
 if(el.hasAttribute("aria-checked")){
   const v=el.getAttribute("aria-checked");
   parts.push(v==="true"?"체크됨":v==="mixed"?"일부 선택":"체크 안 됨");
 }
 if(el.disabled||el.getAttribute("aria-disabled")==="true")parts.push("사용할 수 없음");
 const shortcuts=el.getAttribute("aria-keyshortcuts");
 if(shortcuts)parts.push(`단축키 ${shortcuts.replaceAll("ArrowLeft","왼쪽 방향키").replaceAll("ArrowRight","오른쪽 방향키").replaceAll("ArrowUp","위 방향키").replaceAll("ArrowDown","아래 방향키").replaceAll("Escape","이스케이프").replaceAll("Enter","엔터").replaceAll("Space","스페이스")}`);
 return parts.filter(Boolean).join(", ");
}

function speakText(text){
 if(!text)return;
 if(!("speechSynthesis" in window)){updateTtsStatus("이 브라우저는 음성합성을 지원하지 않습니다.",false);return}
 window.speechSynthesis.cancel();
 const u=new SpeechSynthesisUtterance(text);
 u.lang="ko-KR";
 u.rate=speechRate;
 const voices=window.speechSynthesis.getVoices();
 const ko=voices.find(v=>/^ko(-|_)/i.test(v.lang))||voices.find(v=>v.lang==="ko-KR");
 if(ko)u.voice=ko;
 u.onstart=()=>updateTtsStatus("읽는 중: "+short(text),true);
 u.onend=()=>updateTtsStatus(autoRead?"자동 읽기 대기":"음성 읽기 완료",false);
 u.onerror=()=>updateTtsStatus("음성 읽기 오류",false);
 window.speechSynthesis.speak(u);
}

function stopSpeech(){
 if("speechSynthesis" in window)window.speechSynthesis.cancel();
 updateTtsStatus(autoRead?"자동 읽기 대기":"읽기 정지",false);
}

function updateTtsStatus(text,speaking){
 const el=$("#ttsStatus");
 if(!el)return;
 el.classList.toggle("speaking",!!speaking);
 el.querySelector("span:last-child").textContent=text;
}

setInterval(()=>{
 if(testWin&&testWin.closed){
   $("#scanWindow").disabled=true;$("#focusWindow").disabled=true;$("#readCurrentFocus").disabled=true;$("#toggleAutoRead").disabled=true;stopSpeech();setWindowState(false,"테스트 창이 닫혔습니다.","다시 별도 테스트 창을 열어주세요.");
 }
},1000);
