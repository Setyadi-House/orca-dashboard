'use strict';

const GROUPS = {
  broad: {label:'Broad US equity', color:getComputedStyle(document.documentElement).getPropertyValue('--broad').trim()},
  sector:{label:'US sectors / REIT', color:getComputedStyle(document.documentElement).getPropertyValue('--sector').trim()},
  intl:  {label:'International equity', color:getComputedStyle(document.documentElement).getPropertyValue('--intl').trim()},
  fixed: {label:'Fixed income / credit', color:getComputedStyle(document.documentElement).getPropertyValue('--fixed').trim()},
  commodity:{label:'Commodities', color:getComputedStyle(document.documentElement).getPropertyValue('--commodity').trim()},
  currency:{label:'Currency', color:getComputedStyle(document.documentElement).getPropertyValue('--currency').trim()}
};
const GROUP_KEY = Object.fromEntries(Object.entries(GROUPS).map(([key,value])=>[value.label,key]));
const REGIME_COLORS={Normal:'#e7eee3',Rally:'#cfe4d3',Caution:'#f6e7bf',Crisis:'#efd2cd',Euphoria:'#f1d6c6',Unavailable:'#f5f0e8'};
const REGIME_TEXT={
  Normal:'No broad ORCA risk override. Let security selection, valuation, and catalyst quality drive the book.',
  Rally:'Rally conditions are unusually constructive while crash risk remains contained.',
  Caution:'The market may still rise, but diversification is weakening and marginal risk should be reduced.',
  Crisis:'The crash threshold is crossed. Capital preservation dominates adding broad equity beta.',
  Euphoria:'Rally confidence is extreme. The paper treats this as overextension rather than a stronger buy signal.'
};

let DATA=null;
let ASSETS=[];
let MARKET_HISTORY=[];
let controlsBound=false;
const state={
  estimator:'composite', threshold:.50, edgeMode:'absolute', outcomeYears:5,
  outcomeDisplay:'level', outcomeIndex:'spy', outcomeMode:'research', selected:null,
  assetSelected:'SPY', sort:'links', query:''
};

const $=id=>document.getElementById(id);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const finite=x=>x!=null&&Number.isFinite(Number(x));
const fmt=(x,d=1)=>finite(x)?Number(x).toFixed(d):'—';
const signedNum=(v,d=2,suffix='')=>finite(v)?`${Number(v)>=0?'+':''}${Number(v).toFixed(d)}${suffix}`:'—';
const fmtPctPoints=(x,d=1)=>finite(x)?`${Number(x)>=0?'+':''}${Number(x).toFixed(d)}%`:'—';
const pct=(x,d=1,signed=false)=>finite(x)?`${signed&&Number(x)>=0?'+':''}${(Number(x)*100).toFixed(d)}%`:'—';

function estimatorTag(){
  return state.estimator==='composite'?'Composite · all estimators':state.estimator==='ewm'?'EWM · 30D half-life':state.estimator==='60d'?'Rolling · 60D':'Rolling · 120D';
}
function currentEstimator(){return DATA.estimators[state.estimator]||DATA.estimators.composite;}
function buildMatrix(){return currentEstimator().matrix;}
function graphStats(){return displayView().graph;}

async function loadData(){
  try{
    const res=await fetch(`data/dashboard.json?v=${Date.now()}`,{cache:'no-store'});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    DATA=await res.json();
    ASSETS=DATA.universe.map(a=>({t:a.ticker,n:a.name,g:GROUP_KEY[a.group]||'broad',role:a.role,group:a.group}));
    MARKET_HISTORY=DATA.history.map(h=>({
      d:new Date(`${h.date}T00:00:00Z`),
      spy:h.SPY,qqq:h.QQQ,iwm:h.IWM,
      calc:h.calc,
      rally:h.rally_rank,crash:h.crash_rank,
      regime:h.regime||'Unavailable',exposure:h.exposure,effectiveRank:h.effective_rank
    }));
    renderHeader();
    renderLegend();
    wire();
    renderAll();
  }catch(err){
    console.error(err);
    $('engineStatusBadge').textContent='Data load failed';
    $('engineStatusBadge').className='status-badge data-error';
    $('dataModeBadge').textContent='Error';
    $('dataModeBadge').className='mock-badge data-error';
    $('dataNotice').innerHTML=`<strong>Data error:</strong> ${esc(err.message)}. The dashboard was not rendered because the data bundle could not be loaded.`;
    $('navStatus').textContent='● data unavailable';
    $('navStatus').style.color='var(--red)';
  }
}

function renderHeader(){
  const live=DATA.meta.data_mode==='live',latest=DATA.meta.latest_market_date;
  $('engineStatusBadge').textContent=live?'Published output snapshot':'Demo snapshot';
  $('engineStatusBadge').className=`status-badge ${live?'data-live':'data-demo'}`;
  $('dataModeBadge').textContent=live?'Live EODHD-derived data':'Deterministic demo data';
  $('dataModeBadge').className=`mock-badge ${live?'data-live':'data-demo'}`;
  $('dataNotice').innerHTML=live
    ? `<strong>Published snapshot:</strong> all displayed values are derived from EODHD data through <strong>${esc(latest)}</strong>. Percentile ranks are relative risk context—not literal event probabilities or a standalone trading instruction. Hover over, or click, any <strong>ⓘ</strong> icon for a plain-language explanation.`
    : `<strong>Demo status:</strong> the page is using deterministic sample data, not a live signal. Percentile ranks are relative risk context—not literal event probabilities. Hover over, or click, any <strong>ⓘ</strong> icon for a plain-language explanation.`;
  $('asOfText').textContent=`Market data through ${latest} · generated ${new Date(DATA.meta.generated_at_utc).toLocaleString('en-GB',{timeZone:'Asia/Jakarta',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})} WIB`;
  $('navStatus').textContent=`● ${live?'published':'demo'} output snapshot`;
  $('navStatus').style.color='var(--green)';
  $('estimatorSelect').value=state.estimator;
}

function renderKpis(){applyPanel('renderKpis');bindInfoTriggers();}

function renderDecision(){applyPanel('renderDecision');bindInfoTriggers();}

function indexLabel(){return state.outcomeIndex==='qqq'?'QQQ · Nasdaq 100':state.outcomeIndex==='iwm'?'IWM · Russell 2000':'SPY · S&P 500'}
function indexKey(){return state.outcomeIndex;}
function rollingDrawdown(arr,i,key){return arr[i]?.calc?.[key]?.dd??null;}

function forwardReturn(arr,i,key){return arr[i]?.calc?.[key]?.f10??null;}

function forwardMaxDrawdown(arr,i,key){return arr[i]?.calc?.[key]?.mdd10??null;}

function rollingYearReturn(arr,i,key){return arr[i]?.calc?.[key]?.yoy??null;}

function regimeSegments(data){const seg=[];let start=0;if(!data.length)return seg;for(let i=1;i<=data.length;i++){if(i===data.length||data[i].regime!==data[start].regime){seg.push({start,end:i-1,regime:data[start].regime});start=i}}return seg}
function stepPath(data,x,y,key){if(!data.length)return '';let p=`M ${x(0)} ${y(Number(data[0][key]||0))}`;for(let i=1;i<data.length;i++)p+=` L ${x(i)} ${y(Number(data[i-1][key]||0))} L ${x(i)} ${y(Number(data[i][key]||0))}`;return p}

function showOutcomeSnapshot(d,globalIndex){
  const key=indexKey(),dd=rollingDrawdown(MARKET_HISTORY,globalIndex,key,20),yoy=rollingYearReturn(MARKET_HISTORY,globalIndex,key),f10=forwardReturn(MARKET_HISTORY,globalIndex,key,10),mdd=forwardMaxDrawdown(MARKET_HISTORY,globalIndex,key,10),research=state.outcomeMode==='research';
  $('outcomeSnapshot').innerHTML=`<div><div class="eyebrow">Selected date</div><h3>${esc(d.regime)}</h3><div class="outcome-date">${d.d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'})} · ${indexLabel()}</div></div><div class="outcome-readout">${esc(REGIME_TEXT[d.regime]||'Regime unavailable.')}</div><div class="outcome-stat-grid"><div class="outcome-stat"><span>Index · start = 100</span><strong>${fmt(d[key],2)}</strong></div><div class="outcome-stat"><span>Rolling 1Y return</span><strong style="color:${yoy==null?'var(--muted)':yoy<0?'var(--red)':'var(--green)'}">${yoy==null?'—':signedNum(yoy*100,1,'%')}</strong></div><div class="outcome-stat"><span>20D drawdown</span><strong style="color:${dd<0?'var(--red)':'var(--green)'}">${dd==null?'—':signedNum(dd*100,1,'%')}</strong></div><div class="outcome-stat"><span>Rally rank</span><strong>${fmt(d.rally,0)}th</strong></div><div class="outcome-stat"><span>Crash rank</span><strong>${fmt(d.crash,0)}th</strong></div><div class="outcome-stat"><span>Effective bets</span><strong>${fmt(d.effectiveRank,1)}</strong></div><div class="outcome-stat"><span>Equity exposure</span><strong>${fmt(d.exposure,1)}×</strong></div></div><div class="outcome-research">${research?(f10==null?'Research outcome is unavailable near the end of the sample. Move the cursor to an earlier date.':`<strong>Research-only future outcome</strong><br>Next 10D return: <span class="${f10>=0?'pos':'neg'}">${signedNum(f10*100,1,'%')}</span><br>Next 10D maximum drawdown: <span class="neg">${signedNum(mdd*100,1,'%')}</span>`):'<strong>Live view:</strong> future return and drawdown are intentionally hidden because they were not known on this date.'}</div>`;
}

function renderOutcomeMonitor(){
  const svg=$('marketOutcomeChart'),shell=$('outcomeChartShell'),key=indexKey(),n=Math.min(MARKET_HISTORY.length,state.outcomeYears*252),offset=MARKET_HISTORY.length-n,data=MARKET_HISTORY.slice(-n),W=Math.max(760,shell.clientWidth-16||980),H=525;
  if(data.length<3){svg.innerHTML='<text x="50" y="80">Insufficient history.</text>';return;}
  const p={l:54,r:62,t:25,b:25},plotW=W-p.l-p.r,priceTop=25,priceH=245,signalTop=302,signalH=120,expTop=454,expH=42,x=i=>p.l+plotW*i/(data.length-1);
  const base=Number(data.find(d=>finite(d[key]))?.[key]||1),levelSeries=data.map(d=>finite(d[key])?Number(d[key])/base*100:null),yoySeries=data.map((d,i)=>{const g=offset+i;const y=rollingYearReturn(MARKET_HISTORY,g,key);return y==null?null:y*100}),topSeries=state.outcomeDisplay==='yoy'?yoySeries:levelSeries,valid=topSeries.filter(finite).map(Number);
  let minP=Math.min(...valid),maxP=Math.max(...valid),yPrice;
  if(state.outcomeDisplay==='yoy'){minP=Math.min(Math.floor((minP-4)/10)*10,-10);maxP=Math.max(Math.ceil((maxP+4)/10)*10,10);yPrice=v=>priceTop+priceH*(1-(v-minP)/(maxP-minP));}
  else{const pad=(maxP-minP)*.10||2;minP-=pad;maxP+=pad;yPrice=v=>priceTop+priceH*(1-(v-minP)/(maxP-minP));}
  const ySig=v=>signalTop+signalH*(1-v/100),yExp=v=>expTop+expH*(1-v/1.5),pathFrom=(vals,yFn)=>{let pth='',open=false;vals.forEach((v,i)=>{if(!finite(v)){open=false;return}pth+=`${open?' L':' M'} ${x(i).toFixed(1)} ${yFn(Number(v)).toFixed(1)}`;open=true});return pth};
  let html=`<rect x="${p.l}" y="${priceTop}" width="${plotW}" height="${expTop+expH-priceTop}" fill="#fffdf8"/>`;
  regimeSegments(data).forEach(s=>{const x0=x(s.start),x1=x(Math.min(data.length-1,s.end+1));html+=`<rect x="${x0}" y="${priceTop}" width="${Math.max(1,x1-x0)}" height="${expTop+expH-priceTop}" fill="${REGIME_COLORS[s.regime]||REGIME_COLORS.Unavailable}" opacity=".55"/>`;});
  for(let k=0;k<=4;k++){const v=minP+(maxP-minP)*k/4,yy=yPrice(v);html+=`<line x1="${p.l}" y1="${yy}" x2="${p.l+plotW}" y2="${yy}" stroke="#e1d7c9"/><text x="${p.l-7}" y="${yy+3}" text-anchor="end" font-size="8" fill="#817362">${state.outcomeDisplay==='yoy'?v.toFixed(0)+'%':v.toFixed(0)}</text>`;}
  if(state.outcomeDisplay==='yoy'&&minP<0&&maxP>0)html+=`<line x1="${p.l}" y1="${yPrice(0)}" x2="${p.l+plotW}" y2="${yPrice(0)}" stroke="#625342" stroke-width="1.25" stroke-dasharray="4 4"/><text x="${p.l+plotW-3}" y="${yPrice(0)-4}" text-anchor="end" font-size="7.5" fill="#625342">0%</text>`;
  [0,20,40,60,80,100].forEach(v=>{const yy=ySig(v);html+=`<line x1="${p.l}" y1="${yy}" x2="${p.l+plotW}" y2="${yy}" stroke="#e4dace"/><text x="${p.l-7}" y="${yy+3}" text-anchor="end" font-size="8" fill="#817362">${v}</text>`;});
  [0,.5,1,1.5].forEach(v=>{const yy=yExp(v);html+=`<text x="${p.l+plotW+7}" y="${yy+3}" font-size="8" fill="#817362">${v.toFixed(1)}×</text>`;});
  html+=`<rect x="${p.l}" y="${priceTop}" width="${plotW}" height="${priceH}" fill="none" stroke="#cfc1ae"/><rect x="${p.l}" y="${signalTop}" width="${plotW}" height="${signalH}" fill="none" stroke="#cfc1ae"/><rect x="${p.l}" y="${expTop}" width="${plotW}" height="${expH}" fill="none" stroke="#cfc1ae"/>`;
  const rallyPath=data.map((d,i)=>`${i?'L':'M'} ${x(i).toFixed(1)} ${ySig(Number(d.rally)).toFixed(1)}`).join(' '),crashPath=data.map((d,i)=>`${i?'L':'M'} ${x(i).toFixed(1)} ${ySig(Number(d.crash)).toFixed(1)}`).join(' ');
  html+=`<path d="${pathFrom(topSeries,yPrice)}" fill="none" stroke="#47372a" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round"/><path d="${rallyPath}" fill="none" stroke="#48795b" stroke-width="1.75"/><path d="${crashPath}" fill="none" stroke="#a84234" stroke-width="1.75"/><line x1="${p.l}" y1="${ySig(60)}" x2="${p.l+plotW}" y2="${ySig(60)}" stroke="#a84234" stroke-dasharray="5 4"/><line x1="${p.l}" y1="${ySig(90)}" x2="${p.l+plotW}" y2="${ySig(90)}" stroke="#b57c1f" stroke-dasharray="5 4"/><path d="${stepPath(data,x,yExp,'exposure')}" fill="none" stroke="#79678f" stroke-width="2.2"/>`;
  const topTitle=state.outcomeDisplay==='yoy'?`${indexLabel()} · rolling 252-trading-day return`:`${indexLabel()} · rebased to 100 at range start`;
  html+=`<text x="${p.l}" y="15" font-size="9" font-weight="850" fill="#625342">${topTitle}</text><text x="${p.l}" y="${signalTop-9}" font-size="8" font-weight="850" fill="#625342">Rally rank (green) · Crash rank (red)</text><text x="${p.l}" y="${expTop-8}" font-size="8" font-weight="850" fill="#625342">Recommended equity exposure</text>`;
  const ticks=state.outcomeYears>=10?10:state.outcomeYears>=5?8:6;for(let k=0;k<=ticks;k++){const i=Math.round((data.length-1)*k/ticks),d=data[i].d;html+=`<text x="${x(i)}" y="${H-7}" text-anchor="middle" font-size="8" fill="#817362">${d.toLocaleDateString('en-US',{month:state.outcomeYears<=3?'short':undefined,year:'2-digit',timeZone:'UTC'})}</text>`;}
  html+=`<line id="outcomeCross" x1="0" x2="0" y1="${priceTop}" y2="${expTop+expH}" stroke="#6d5a45" stroke-dasharray="3 4" opacity="0"/><g id="outcomeDots"></g><rect class="outcome-hit" x="${p.l}" y="${priceTop}" width="${plotW}" height="${expTop+expH-priceTop}" fill="transparent"/>`;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.innerHTML=html;
  $('outcomeIndexLegend').innerHTML=`<i class="line-sample" style="background:#4a3929"></i>${state.outcomeDisplay==='yoy'?'Selected index · rolling 1Y return':'Selected index · rebased to 100'}`;
  $('outcomeMetricNote').innerHTML=state.outcomeDisplay==='yoy'?'<strong>Rolling 1Y return:</strong> a 252-trading-day return. It improves long-window comparability but can be distorted by base effects after a crash or rebound.':'<strong>Index level:</strong> rebased to 100 at the beginning of the selected window, making cumulative wealth and drawdowns easy to see.';
  const hit=svg.querySelector('.outcome-hit'),cross=svg.querySelector('#outcomeCross'),dots=svg.querySelector('#outcomeDots'),tip=$('marketOutcomeTooltip');
  function update(i,ev){const d=data[i],globalIndex=offset+i,topVal=topSeries[i],yoy=rollingYearReturn(MARKET_HISTORY,globalIndex,key);cross.setAttribute('x1',x(i));cross.setAttribute('x2',x(i));cross.setAttribute('opacity','1');dots.innerHTML=`${finite(topVal)?`<circle cx="${x(i)}" cy="${yPrice(Number(topVal))}" r="3.8" fill="#47372a" stroke="#fff" stroke-width="1.5"/>`:''}<circle cx="${x(i)}" cy="${ySig(Number(d.rally))}" r="3.3" fill="#48795b" stroke="#fff"/><circle cx="${x(i)}" cy="${ySig(Number(d.crash))}" r="3.3" fill="#a84234" stroke="#fff"/>`;showOutcomeSnapshot(d,globalIndex);if(ev){const topLine=state.outcomeDisplay==='yoy'?`Rolling 1Y: ${yoy==null?'—':signedNum(yoy*100,1,'%')}`:`Rebased index: ${fmt(topVal,1)}`;tip.innerHTML=`<strong>${d.d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'})}</strong><br>${esc(d.regime)}<br>${indexLabel()}: ${fmt(d[key],2)}<br>${topLine}<br>Rally / Crash: ${fmt(d.rally,0)} / ${fmt(d.crash,0)}<br>Exposure: ${fmt(d.exposure,1)}×`;tip.style.display='block';const r=shell.getBoundingClientRect();tip.style.left=`${Math.min(shell.clientWidth-230,Math.max(8,ev.clientX-r.left+14))}px`;tip.style.top=`${Math.min(shell.clientHeight-130,Math.max(8,ev.clientY-r.top+14))}px`;}}
  hit.onmousemove=ev=>{const r=svg.getBoundingClientRect(),mx=(ev.clientX-r.left)*W/r.width,i=clamp(Math.round((mx-p.l)/plotW*(data.length-1)),0,data.length-1);update(i,ev)};
  hit.onmouseleave=()=>{cross.setAttribute('opacity','0');dots.innerHTML='';tip.style.display='none';showOutcomeSnapshot(data.at(-1),MARKET_HISTORY.length-1)};
  showOutcomeSnapshot(data.at(-1),MARKET_HISTORY.length-1);renderRegimeStats();
}

function renderRegimeStats(){const body=$('regimeStatsBody');if(state.outcomeMode==='live'){body.innerHTML='<tr><td colspan="6" style="text-align:center;padding:18px"><strong>Live view hides forward outcomes.</strong><br>Switch to Research view for historical outcomes.</td></tr>';return;}body.innerHTML=DATA.performance[state.outcomeIndex+':'+state.outcomeYears];}

function getInfo(key){return displayView().infos[key];}

function infoHtml(def){return `<div class="help-eyebrow">Plain-language explanation</div><h4 id="infoModalTitle">${esc(def.title)}</h4><div class="help-tech">${esc(def.technical||'')}</div><div class="help-section"><strong>What it measures</strong>${esc(def.measure||'')}</div><div class="help-section"><strong>Current reading</strong>${esc(def.current||'')}</div><div class="help-section"><strong>Compared with history</strong>${esc(def.history||'')}</div><div class="help-section"><strong>Current effect</strong>${esc(def.effect||'')}</div><div class="help-section"><strong>Portfolio meaning</strong>${esc(def.portfolio||'')}</div><div class="help-section"><strong>Simple example</strong>${esc(def.example||'')}</div>`}
function positionInfoPopover(ev){const pop=$('helpPopover');if(!pop.classList.contains('show'))return;const pad=12,w=pop.offsetWidth||350,h=pop.offsetHeight||300;let left=ev.clientX+15,top=ev.clientY+15;if(left+w>innerWidth-pad)left=ev.clientX-w-15;if(top+h>innerHeight-pad)top=ev.clientY-h-15;pop.style.left=`${Math.max(pad,left)}px`;pop.style.top=`${Math.max(pad,top)}px`}
function showInfoPopover(ev,key){const def=getInfo(key),pop=$('helpPopover');if(!def)return;pop.innerHTML=infoHtml(def);pop.classList.add('show');positionInfoPopover(ev)}
function hideInfoPopover(){$('helpPopover').classList.remove('show')}
function openInfoModal(key){const def=getInfo(key);if(!def)return;$('infoModalContent').innerHTML=infoHtml(def);$('infoModal').classList.add('open');$('infoModal').setAttribute('aria-hidden','false');hideInfoPopover()}
function closeInfoModal(){$('infoModal').classList.remove('open');$('infoModal').setAttribute('aria-hidden','true')}
function bindInfoTriggers(){
  document.querySelectorAll('[data-info]').forEach(el=>{
    if(el.dataset.bound)return;el.dataset.bound='1';const key=el.dataset.info;
    el.addEventListener('mouseenter',ev=>showInfoPopover(ev,key));el.addEventListener('mousemove',positionInfoPopover);el.addEventListener('mouseleave',hideInfoPopover);el.addEventListener('focus',ev=>showInfoPopover(ev,key));el.addEventListener('blur',hideInfoPopover);el.addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();openInfoModal(key)});
  });
}

function renderMetrics(){applyPanel('renderMetrics');bindInfoTriggers();}

function renderAdvancedMetrics(){applyPanel('renderAdvancedMetrics');bindInfoTriggers();}

function groupCenters(W,H){return{broad:[W*.47,H*.39],sector:[W*.45,H*.48],intl:[W*.22,H*.44],fixed:[W*.77,H*.45],commodity:[W*.56,H*.78],currency:[W*.83,H*.18]}}
function seeded(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296}}
function renderNetwork(){
  const matrix=buildMatrix(),stats=graphStats(matrix),svg=$('networkSvg'),wrap=$('networkWrap'),W=Math.max(720,wrap.clientWidth||900),H=520,centers=groupCenters(W,H),rng=seeded(823),positions=ASSETS.map(a=>({x:centers[a.g][0]+(rng()-.5)*150,y:centers[a.g][1]+(rng()-.5)*130,vx:0,vy:0})),edges=displayView().edges;
  for(let step=0;step<120;step++){
    for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++){let dx=positions[j].x-positions[i].x,dy=positions[j].y-positions[i].y,d2=dx*dx+dy*dy+20,d=Math.sqrt(d2),f=1000/d2;positions[i].vx-=f*dx/d;positions[i].vy-=f*dy/d;positions[j].vx+=f*dx/d;positions[j].vy+=f*dy/d;}
    edges.forEach(e=>{const a=positions[e.i],b=positions[e.j],dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)+.01,target=65+55*(1-Math.abs(e.v)),f=(d-target)*.0028*Math.abs(e.v);a.vx+=f*dx/d;a.vy+=f*dy/d;b.vx-=f*dx/d;b.vy-=f*dy/d;});
    positions.forEach((p,i)=>{const c=centers[ASSETS[i].g];p.vx+=(c[0]-p.x)*.0009;p.vy+=(c[1]-p.y)*.0009;p.vx*=.82;p.vy*=.82;p.x=clamp(p.x+p.vx,38,W-38);p.y=clamp(p.y+p.vy,35,H-35);});
  }
  let out='<defs><filter id="nodeShadow"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity=".18"/></filter></defs>';
  edges.forEach(e=>{const a=positions[e.i],b=positions[e.j],abs=Math.abs(e.v),selected=state.selected==null||state.selected===e.i||state.selected===e.j,opacity=selected?(.12+.48*(abs-state.threshold)/(1-state.threshold)):.025;out+=`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${e.v>=0?'#a55e3d':'#557b8b'}" stroke-width="${(.7+3.3*(abs-state.threshold)/(1-state.threshold)).toFixed(2)}" stroke-opacity="${clamp(opacity,.02,.72)}"/>`;});
  positions.forEach((p,i)=>{const a=ASSETS[i],r=7+11*stats.central[i],selected=state.selected==null||state.selected===i,opacity=selected?1:.28;out+=`<g class="net-node" data-i="${i}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})" style="cursor:pointer;opacity:${opacity}"><circle r="${(r+3).toFixed(1)}" fill="#fffaf1" stroke="${GROUPS[a.g].color}" stroke-opacity=".34"/><circle r="${r.toFixed(1)}" fill="${GROUPS[a.g].color}" stroke="#fffaf1" stroke-width="2" filter="url(#nodeShadow)"/><text y="${(r+12).toFixed(1)}" text-anchor="middle" font-size="${r>14?10:9}" font-weight="900" fill="#47392d" stroke="#fffaf2" stroke-width="3" paint-order="stroke">${a.t}</text></g>`;});
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.innerHTML=out;$('edgeCountPill').textContent=`${edges.length} edges · ${estimatorTag()}`;
  const tip=$('networkTooltip');svg.querySelectorAll('.net-node').forEach(el=>{el.addEventListener('mouseenter',()=>{const i=+el.dataset.i,a=ASSETS[i],s=stats.strongest[i];tip.innerHTML=`<strong>${a.t} · ${esc(a.n)}</strong><br>${GROUPS[a.g].label}<br>Avg |corr|: ${stats.avg[i].toFixed(2)}<br>Strong links: ${stats.counts[i]} / 23<br>Strongest link: ${ASSETS[s.j].t} (${signedNum(s.v,2)})`;tip.style.display='block';});el.addEventListener('mousemove',ev=>{const r=wrap.getBoundingClientRect();tip.style.left=`${ev.clientX-r.left+13}px`;tip.style.top=`${ev.clientY-r.top+13}px`;});el.addEventListener('mouseleave',()=>tip.style.display='none');el.addEventListener('click',ev=>{ev.stopPropagation();state.selected=state.selected===+el.dataset.i?null:+el.dataset.i;renderNetwork();});});
  svg.onclick=()=>{if(state.selected!==null){state.selected=null;renderNetwork();}};
}
function renderLegend(){$('groupLegend').innerHTML=Object.values(GROUPS).map(g=>`<span><i class="legend-dot" style="background:${g.color}"></i>${g.label}</span>`).join('')+`<span><i class="line-sample" style="height:2px;background:#a55e3d"></i>Positive correlation</span><span><i class="line-sample" style="height:2px;background:#557b8b"></i>Negative correlation</span>`}
function mix(a,b,t){return Math.round(a+(b-a)*t)}
function corrColor(v){const neg=[73,111,130],zero=[249,244,235],pos=[159,63,49],t=Math.min(1,Math.abs(v)),c=v<0?neg:pos;return `rgb(${mix(zero[0],c[0],t)},${mix(zero[1],c[1],t)},${mix(zero[2],c[2],t)})`}
function renderHeatmap(){
  const canvas=$('heatmapCanvas'),shell=$('heatmapShell'),tip=$('heatmapTooltip'),matrix=buildMatrix(),cell=28,left=92,top=92,size=left+cell*ASSETS.length+18,dpr=Math.max(1,window.devicePixelRatio||1);
  canvas.width=size*dpr;canvas.height=size*dpr;canvas.style.width=`${size}px`;canvas.style.height=`${size}px`;const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,size,size);ctx.fillStyle='#fffdf8';ctx.fillRect(0,0,size,size);ctx.font='800 9px Inter, Arial';ctx.textAlign='right';ctx.textBaseline='middle';ASSETS.forEach((a,i)=>{ctx.fillStyle='#574b3f';ctx.fillText(a.t,left-9,top+i*cell+cell/2)});ctx.textAlign='left';ASSETS.forEach((a,i)=>{ctx.save();ctx.translate(left+i*cell+cell/2,top-9);ctx.rotate(-Math.PI/2);ctx.fillStyle='#574b3f';ctx.fillText(a.t,0,0);ctx.restore();});
  for(let i=0;i<ASSETS.length;i++)for(let j=0;j<ASSETS.length;j++){const v=Number(matrix[i][j]);ctx.fillStyle=corrColor(v);ctx.fillRect(left+j*cell,top+i*cell,cell-1,cell-1);if(i===j){ctx.strokeStyle='#6e5b43';ctx.lineWidth=1;ctx.strokeRect(left+j*cell+.5,top+i*cell+.5,cell-2,cell-2);}}
  let lastG=ASSETS[0].g;for(let i=1;i<ASSETS.length;i++)if(ASSETS[i].g!==lastG){ctx.strokeStyle='#8b7861';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(left,top+i*cell);ctx.lineTo(left+cell*ASSETS.length,top+i*cell);ctx.moveTo(left+i*cell,top);ctx.lineTo(left+i*cell,top+cell*ASSETS.length);ctx.stroke();lastG=ASSETS[i].g;}ctx.strokeStyle='#c8b8a2';ctx.lineWidth=1;ctx.strokeRect(left,top,cell*ASSETS.length,cell*ASSETS.length);
  const labelTooltip=(a,axis)=>`<strong>${a.t} — ${esc(a.n)}</strong><br>${GROUPS[a.g].label}<br><span style="color:#d4c4ae">${axis} label in the correlation heatmap</span>`;
  canvas.onmousemove=ev=>{const r=canvas.getBoundingClientRect(),x=(ev.clientX-r.left)*size/r.width,y=(ev.clientY-r.top)*size/r.height,j=Math.floor((x-left)/cell),i=Math.floor((y-top)/cell);let html='',cursor='default';if(i>=0&&j>=0&&i<ASSETS.length&&j<ASSETS.length){html=`<strong>${ASSETS[i].t} × ${ASSETS[j].t}</strong><br>${esc(ASSETS[i].n)}<br>${esc(ASSETS[j].n)}<br>Signed correlation: ${fmt(matrix[i][j],3)}`;cursor='crosshair';}else if(y>=top&&y<top+cell*ASSETS.length&&x>=8&&x<left-6){const row=Math.floor((y-top)/cell);if(row>=0&&row<ASSETS.length){html=labelTooltip(ASSETS[row],'Row');cursor='help';}}else if(x>=left&&x<left+cell*ASSETS.length&&y>=8&&y<top-6){const col=Math.floor((x-left)/cell);if(col>=0&&col<ASSETS.length){html=labelTooltip(ASSETS[col],'Column');cursor='help';}}canvas.style.cursor=cursor;if(html){tip.innerHTML=html;tip.style.display='block';const sr=shell.getBoundingClientRect();tip.style.left=`${ev.clientX-sr.left+14+shell.scrollLeft}px`;tip.style.top=`${ev.clientY-sr.top+14+shell.scrollTop}px`;}else tip.style.display='none';};canvas.onmouseleave=()=>{tip.style.display='none';canvas.style.cursor='default';};
  const {pos,neg,div}=displayView().pairs,box=(title,arr,kind)=>`<div class="pair-box"><div class="pair-label">${title}</div>${arr.map(p=>`<div class="pair-value">${ASSETS[p.i].t} / ${ASSETS[p.j].t} <span style="color:${p.v>=0?'var(--red)':'var(--blue)'}">${signedNum(p.v,2)}</span></div><div class="pair-meta">${kind}</div>`).join('')}</div>`;$('pairGrid').innerHTML=box('Strongest positive links',pos,'Potential concentration / contagion')+box('Strongest negative links',neg,'Potential offset—validate stability')+box('Most independent pairs',div,'Low current co-movement');
}

function assetRows(){return displayView().assets.map(x=>({...x}));}

function renderAssetDetail(row){if(!row)return;const relation=row.best.v>=0?'moves together with':'moves opposite to';$('assetDetailPanel').innerHTML=`<div><div class="asset-detail-title">${row.t} · ${esc(row.n)}</div><div class="asset-detail-meta">${GROUPS[row.g].label} · ${esc(row.role)}</div></div><div class="asset-detail-copy"><strong>Plain reading:</strong> ${esc(row.meaning)}<br><strong>Network evidence:</strong> ${row.count} of 23 strong links, average relationship ${row.avg.toFixed(2)}, and it ${relation} ${ASSETS[row.best.j].t} most strongly (${signedNum(row.best.v,2)}).</div><div class="asset-detail-action">Portfolio check: compare this position with your other holdings before treating it as a separate source of diversification.</div>`;}
function renderAssets(){
  let rows=assetRows().filter(x=>(x.t+' '+x.n+' '+GROUPS[x.g].label+' '+x.role+' '+x.meaning).toLowerCase().includes(state.query.toLowerCase()));rows.sort((a,b)=>state.sort==='ticker'?a.t.localeCompare(b.t):state.sort==='ret5'?b.r5-a.r5:state.sort==='avgcorr'?b.avg-a.avg:state.sort==='change'?b.delta-a.delta:b.count-a.count);
  $('assetBody').innerHTML=rows.map(x=>{const relation=x.best.v>=0?'moves together':'moves opposite';return `<tr class="asset-row ${state.assetSelected===x.t?'selected':''}" data-ticker="${x.t}"><td class="ticker">${x.t}</td><td>${esc(x.n)}</td><td><span class="group-chip"><i style="background:${GROUPS[x.g].color}"></i>${GROUPS[x.g].label}</span></td><td class="${x.r1>0?'pos':x.r1<0?'neg':'flat'}">${fmtPctPoints(x.r1)}</td><td class="${x.r5>0?'pos':x.r5<0?'neg':'flat'}">${fmtPctPoints(x.r5)}</td><td>${x.avg.toFixed(2)} <span class="relationship-label ${x.level[1]}">${x.level[0]}</span></td><td><div class="links-cell"><div class="mini-bar"><span style="width:${x.count/23*100}%"></span></div><strong>${x.count} / 23</strong></div></td><td>${ASSETS[x.best.j].t} <strong class="${x.best.v>=0?'pos':'neg'}">${signedNum(x.best.v,2)}</strong><span class="link-phrase">${relation}</span></td><td class="${x.spyCorr>=0?'pos':'neg'}">${signedNum(x.spyCorr,2)}</td><td class="${x.delta>=0?'neg':'pos'}">${signedNum(x.delta,2)}</td><td><span class="role-chip">${esc(x.role)}</span><div class="portfolio-meaning">${esc(x.meaning)}</div></td></tr>`;}).join('');
  document.querySelectorAll('.asset-row').forEach(tr=>tr.onclick=()=>{state.assetSelected=tr.dataset.ticker;renderAssets();});renderAssetDetail(assetRows().find(x=>x.t===state.assetSelected)||rows[0]);bindInfoTriggers();
}



function renderDrivers(){applyPanel('renderDrivers');bindInfoTriggers();}

function renderAudit(){
  const q=DATA.quality,a=DATA.audit,live=DATA.meta.data_mode==='live';
  $('auditCoverage').textContent=`${DATA.meta.universe_count} / 24`;$('auditCoverageMeta').textContent='Exact paper universe';
  $('auditLatestDate').textContent=DATA.meta.latest_market_date;$('auditLatestMeta').textContent=`${Math.max(0,Math.floor((Date.now()-Date.parse(DATA.meta.latest_market_date+'T00:00:00Z'))/86400000))} calendar day${q.latest_age_calendar_days===1?'':'s'} old`;
  $('auditRows').textContent=Number(q.common_rows).toLocaleString();$('auditRowsMeta').textContent=`${q.common_start} to ${q.common_end}`;
  $('auditModel').textContent=live?'Live':'Demo';$('auditModelMeta').textContent=DATA.meta.model_version;
  $('auditPill').textContent=`${a.paper_ambiguities.length} paper questions unresolved`;
  $('auditFlagList').innerHTML=a.paper_ambiguities.map((text,i)=>`<div class="flag"><div class="flag-icon">${i+1}</div><div><div class="flag-title">Research governance item ${i+1}</div><div class="flag-copy">${esc(text)}</div></div></div>`).join('');
}

function renderAll(){renderHeader();renderKpis();renderDecision();renderOutcomeMonitor();renderMetrics();renderAdvancedMetrics();renderNetwork();renderHeatmap();renderAssets();renderDrivers();renderAudit();bindInfoTriggers()}
function wire(){if(controlsBound)return;controlsBound=true;
  $('estimatorSelect').onchange=e=>{state.estimator=e.target.value;renderAll();};
  document.querySelectorAll('#thresholdSegment .seg-btn').forEach(b=>b.onclick=()=>{state.threshold=+b.dataset.v;document.querySelectorAll('#thresholdSegment .seg-btn').forEach(x=>x.classList.toggle('active',x===b));renderMetrics();renderAdvancedMetrics();renderNetwork();renderHeatmap();renderAssets();});
  document.querySelectorAll('#edgeMode .seg-btn').forEach(b=>b.onclick=()=>{state.edgeMode=b.dataset.v;document.querySelectorAll('#edgeMode .seg-btn').forEach(x=>x.classList.toggle('active',x===b));renderNetwork();renderAssets();});
  document.querySelectorAll('#outcomeRange .seg-btn').forEach(b=>b.onclick=()=>{state.outcomeYears=+b.dataset.v;document.querySelectorAll('#outcomeRange .seg-btn').forEach(x=>x.classList.toggle('active',x===b));renderOutcomeMonitor();});
  document.querySelectorAll('#outcomeDisplay .seg-btn').forEach(b=>b.onclick=()=>{state.outcomeDisplay=b.dataset.v;document.querySelectorAll('#outcomeDisplay .seg-btn').forEach(x=>x.classList.toggle('active',x===b));renderOutcomeMonitor();});
  document.querySelectorAll('#outcomeMode .seg-btn').forEach(b=>b.onclick=()=>{state.outcomeMode=b.dataset.v;document.querySelectorAll('#outcomeMode .seg-btn').forEach(x=>x.classList.toggle('active',x===b));renderOutcomeMonitor();});
  $('outcomeIndex').onchange=e=>{state.outcomeIndex=e.target.value;renderOutcomeMonitor();};$('assetSearch').oninput=e=>{state.query=e.target.value;renderAssets();};$('assetSort').onchange=e=>{state.sort=e.target.value;renderAssets();};$('printBtn').onclick=()=>window.print();$('infoClose').onclick=closeInfoModal;$('infoModal').onclick=e=>{if(e.target.id==='infoModal')closeInfoModal();};document.addEventListener('keydown',e=>{if(e.key==='Escape')closeInfoModal();});let timer;window.addEventListener('resize',()=>{clearTimeout(timer);timer=setTimeout(()=>{renderNetwork();renderHeatmap();renderOutcomeMonitor();},180);});bindInfoTriggers();
}


function displayView(){const v=DATA.variants[state.estimator+':'+state.threshold+':'+state.edgeMode];if(!v)throw new Error('Unsupported display combination');return v;}
function applyPanel(name){for(const [id,props] of Object.entries(displayView().panels[name])){const node=id.startsWith('.')?document.querySelector(id):$(id);for(const key of ['innerHTML','textContent','className'])if(props[key])node[key]=props[key];}}

document.addEventListener('DOMContentLoaded',loadData);
