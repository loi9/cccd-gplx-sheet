import jsQR from "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm";
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";
import { GOOGLE_SCRIPT_URL } from "../config.js";
import { SALES_LIST } from "../sales.js?v=13";

const FIELDS=["HoVaTen","NgaySinh","GioiTinh","SoCMT","NgayCapCMT","NoiCapCMT","MaDVHC_TT","ChiTiet_TT","MaDVHC_CT","ChiTiet_CT","SoGPLXDaCo","HangGPLXDaCo","NgayTTGPLXDaCo","NgayCapGPLXDaCo","DVCapGPLXDaCo","GhiChu","MaKhoaHoc","DiaChiGoc","DiaChiMoi","Sales"];
const emptyRecord=()=>Object.fromEntries(FIELDS.map(x=>[x,""]));
let draft=JSON.parse(localStorage.getItem("hoso-nhap")||"null")||{record:emptyRecord(),cccdScanned:false,gplxScanned:false};
draft.record={...emptyRecord(),...(draft.record||{})};draft.course=draft.course||{hang:"",khoa:""};draft.photos=draft.photos||{};
let scanType="cccd",cameraMode="qr",photoSlot="",photoSide="front",scanStream=null,scanLoopId=null,flashOn=false,scanLocked=false,nativeDetector=null,lastScanAt=0,scanFrameNo=0,cameraCaps={},zoomSteps=[],zoomIndex=0,zxingStatus="đang tải";
let lastFinderEyes=[],finderStableFrames=0;
let qrPreviewUrl="",currentQrSource=null,cropZoom=1,cropPanX=0,cropPanY=0,cropPointer=null;
try{if("BarcodeDetector" in window)nativeDetector=new BarcodeDetector({formats:["qr_code"]})}catch{}
const scanCanvas=document.createElement("canvas"),scanCtx=scanCanvas.getContext("2d",{willReadFrequently:true}),finderCanvas=document.createElement("canvas"),finderCtx=finderCanvas.getContext("2d",{willReadFrequently:true});
const dvhcPromise=fetch("../dvhc.json?v=14",{cache:"no-cache"}).then(r=>r.ok?r.json():[]).then(rows=>rows.map(x=>({...x,p:x.a.split("|")}))).catch(()=>[]);
const DVQL_BY_ISSUER={"an giang":"91","ba ria - vung tau":"79","bac giang":"24","bac kan":"19","bac lieu":"96","bac ninh":"24","ben tre":"86","binh dinh":"52","binh duong":"79","binh phuoc":"75","binh thuan":"68","ca mau":"96","can tho":"92","cao bang":"04","da nang":"48","dak lak":"66","dak nong":"68","dien bien":"11","dong nai":"75","dong thap":"82","gia lai":"52","ha giang":"08","ha nam":"37","ha noi":"01","ha tinh":"42","hai duong":"31","hai phong":"31","hau giang":"92","ho chi minh":"79","hoa binh":"25","hue":"46","hung yen":"33","khanh hoa":"56","kien giang":"91","kon tum":"51","lai chau":"12","lam dong":"68","lang son":"20","lao cai":"15","long an":"80","nam dinh":"37","nghe an":"40","ninh binh":"37","ninh thuan":"56","phu tho":"25","phu yen":"66","quang binh":"44","quang nam":"48","quang ngai":"51","quang ninh":"22","quang tri":"44","soc trang":"92","son la":"14","tay ninh":"80","thai binh":"33","thai nguyen":"19","thanh hoa":"38","thua thien hue":"46","tien giang":"82","tra vinh":"86","tuyen quang":"08","vinh long":"86","vinh phuc":"25","yen bai":"15"};
let addressWarning="";
const form=document.querySelector("#recordForm"),video=document.querySelector("#camera"),panel=document.querySelector("#cameraPanel");
const $=s=>document.querySelector(s);
function fillSalesList(names){const list=$("#salesList");list.innerHTML="";[...new Set(names.map(x=>String(x).trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"vi")).forEach(name=>{const option=document.createElement("option");option.value=name;list.appendChild(option)})}
async function loadSalesList(){let names=SALES_LIST;try{if(GOOGLE_SCRIPT_URL){const url=new URL(GOOGLE_SCRIPT_URL);url.searchParams.set("action","sales");const response=await fetch(url,{cache:"no-store"}),data=await response.json();if(Array.isArray(data.sales))names=data.sales}}catch{}fillSalesList(names)}
loadSalesList();
const formatDate=v=>/^\d{8}$/.test(v)?`${v.slice(0,2)}/${v.slice(2,4)}/${v.slice(4)}`:v;
const onlyDigits=v=>(v||"").replace(/\D/g,"");
const ZXING_OPTIONS={formats:["QRCode"],tryHarder:true,tryRotate:true,tryInvert:true,tryDownscale:true,tryDenoise:true,maxNumberOfSymbols:1};
const zxingReaderPromise=import("https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.2/dist/es/reader/index.js").then(async reader=>{if(reader.prepareZXingModule)await reader.prepareZXingModule({fireImmediately:true});zxingStatus="sẵn sàng";updateCameraDiagnostic();return reader}).catch(e=>{zxingStatus=`lỗi: ${e?.message||"không tải được"}`;updateCameraDiagnostic();return null});
async function decodeWithZxing(image){try{const reader=await zxingReaderPromise;if(!reader)return null;return(await reader.readBarcodes(image,ZXING_OPTIONS)).find(x=>x.isValid&&x.text)||null}catch{return null}}
function updateCameraDiagnostic(extra=""){const track=scanStream?.getVideoTracks?.()[0],settings=track?.getSettings?.()||{},resolution=settings.width&&settings.height?`${settings.width}×${settings.height}`:"chưa rõ",focus=settings.focusMode||cameraCaps.focusMode?.join?.("/")||"không rõ";if(cameraMode==="qr"&&$("#cameraHint"))$("#cameraHint").textContent=`Camera ${resolution} • nét ${focus} • ZXing ${zxingStatus}${extra?` • ${extra}`:""}`}
function findQrEyes(image){
  const {data,width:w,height:h}=image,hist=new Uint32Array(256),gray=new Uint8Array(w*h);for(let i=0,j=0;i<data.length;i+=4,j++){const v=Math.round(.299*data[i]+.587*data[i+1]+.114*data[i+2]);gray[j]=v;hist[v]++}let total=w*h,sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let sumB=0,wB=0,max=0,threshold=128;for(let i=0;i<256;i++){wB+=hist[i];if(!wB)continue;const wF=total-wB;if(!wF)break;sumB+=i*hist[i];const mB=sumB/wB,mF=(sum-sumB)/wF,between=wB*wF*(mB-mF)**2;if(between>max){max=between;threshold=i}}const dark=(x,y)=>x>=0&&x<w&&y>=0&&y<h&&gray[y*w+x]<=threshold,ratio=r=>{const t=r.reduce((a,b)=>a+b,0),m=t/7;if(m<1)return false;return Math.abs(r[0]-m)<m*.85&&Math.abs(r[1]-m)<m*.85&&Math.abs(r[2]-3*m)<3*m*.55&&Math.abs(r[3]-m)<m*.85&&Math.abs(r[4]-m)<m*.85};
  function vertical(x,y,module){let c=1,yy=y-1;while(yy>=0&&dark(x,yy)&&c<module*6){c++;yy--}let wu=0;while(yy>=0&&!dark(x,yy)&&wu<module*4){wu++;yy--}let bu=0;while(yy>=0&&dark(x,yy)&&bu<module*4){bu++;yy--}yy=y+1;while(yy<h&&dark(x,yy)&&c<module*6){c++;yy++}let wd=0;while(yy<h&&!dark(x,yy)&&wd<module*4){wd++;yy++}let bd=0;while(yy<h&&dark(x,yy)&&bd<module*4){bd++;yy++}return ratio([bu,wu,c,wd,bd])}
  const clusters=[];for(let y=2;y<h-2;y+=3){let runs=[],color=dark(0,y),start=0;for(let x=1;x<=w;x++){const next=x<w?dark(x,y):!color;if(x<w&&next===color)continue;runs.push({color,len:x-start,start});if(runs.length>5)runs.shift();if(runs.length===5&&runs[0].color&&!runs[1].color&&runs[2].color&&!runs[3].color&&runs[4].color){const lens=runs.map(r=>r.len);if(ratio(lens)){const module=lens.reduce((a,b)=>a+b,0)/7,cx=runs[2].start+runs[2].len/2;if(vertical(Math.round(cx),y,module)){let q=clusters.find(p=>Math.hypot(p.x-cx,p.y-y)<Math.max(8,module*3));if(q){q.x=(q.x*q.hits+cx)/(q.hits+1);q.y=(q.y*q.hits+y)/(q.hits+1);q.module=(q.module*q.hits+module)/(q.hits+1);q.hits++}else clusters.push({x:cx,y,module,hits:1})}}}color=next;start=x}}
  const points=clusters.filter(x=>x.hits>=2).sort((a,b)=>b.hits-a.hits).slice(0,12);let best=null;for(let a=0;a<points.length;a++)for(let b=a+1;b<points.length;b++)for(let c=b+1;c<points.length;c++){const p=[points[a],points[b],points[c]],sizes=p.map(x=>x.module);if(Math.max(...sizes)/Math.min(...sizes)>2)continue;const d=[(p[0].x-p[1].x)**2+(p[0].y-p[1].y)**2,(p[0].x-p[2].x)**2+(p[0].y-p[2].y)**2,(p[1].x-p[2].x)**2+(p[1].y-p[2].y)**2].sort((x,y)=>x-y),err=Math.abs(d[2]-d[0]-d[1])/d[2];if(err>.32)continue;const score=p.reduce((s,x)=>s+x.hits,0)-err*10;if(!best||score>best.score)best={score,points:p}}return best?.points||[]
}
function showFinderDots(points,imageScale){let layer=$("#finderDots");if(!points.length){layer?.remove();return}if(!layer){layer=document.createElement("div");layer.id="finderDots";Object.assign(layer.style,{position:"absolute",inset:"0",pointerEvents:"none",zIndex:"19"});video.parentElement.appendChild(layer)}layer.innerHTML="";const box=video.getBoundingClientRect(),displayScale=Math.max(box.width/video.videoWidth,box.height/video.videoHeight),ox=(box.width-video.videoWidth*displayScale)/2,oy=(box.height-video.videoHeight*displayScale)/2;points.forEach((p,i)=>{const dot=document.createElement("i"),x=(p.x/imageScale)*displayScale+ox,y=(p.y/imageScale)*displayScale+oy;dot.textContent=String(i+1);Object.assign(dot.style,{position:"absolute",left:`${x}px`,top:`${y}px`,width:"22px",height:"22px",transform:"translate(-50%,-50%)",borderRadius:"50%",display:"grid",placeItems:"center",background:"#ffd43b",border:"3px solid #111",color:"#111",fontSize:"10px",fontStyle:"normal",fontWeight:"900",boxShadow:"0 0 14px #ffd43b"});layer.appendChild(dot)})}
function stabilizeFinderEyes(points){
  if(points.length!==3){lastFinderEyes=[];finderStableFrames=0;return false}
  if(lastFinderEyes.length!==3){lastFinderEyes=points.map(p=>({...p}));finderStableFrames=1;return false}
  const unused=[...lastFinderEyes],matched=points.every(p=>{let best=-1,distance=Infinity;unused.forEach((q,i)=>{const d=Math.hypot(p.x-q.x,p.y-q.y);if(d<distance){distance=d;best=i}});if(best<0||distance>42)return false;unused.splice(best,1);return true});
  finderStableFrames=matched?finderStableFrames+1:1;lastFinderEyes=points.map(p=>({...p}));return finderStableFrames>=3
}
function resetFinderState(){lastFinderEyes=[];finderStableFrames=0;showFinderDots([],1)}
function applyCropTransform(){const img=$("#qrImagePreview");img.style.transform=`translate3d(${cropPanX}px,${cropPanY}px,0) scale(${cropZoom})`;$("#cropZoom").value=String(cropZoom)}
function resetCropTransform(){cropZoom=1;cropPanX=0;cropPanY=0;applyCropTransform()}
function clearQrImagePreview(){if(qrPreviewUrl)URL.revokeObjectURL(qrPreviewUrl);qrPreviewUrl="";currentQrSource?.close?.();currentQrSource=null;cropPointer=null;$("#qrImagePreview")?.classList.add("hidden");$("#qrImagePreview")?.removeAttribute("src");$("#qrImagePreview")?.style.removeProperty("transform");$("#qrImageOverlay")?.classList.add("hidden");const overlay=$("#qrImageOverlay");if(overlay)overlay.getContext("2d").clearRect(0,0,overlay.width,overlay.height);$("#imageProcessing")?.classList.add("hidden");$("#cropControls")?.classList.add("hidden");$(".camera-box")?.classList.remove("crop-mode");video.classList.remove("hidden")}
async function showQrImagePreview(file){clearQrImagePreview();scanLocked=true;qrPreviewUrl=URL.createObjectURL(file);const img=$("#qrImagePreview");img.src=qrPreviewUrl;await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error("không hiển thị được ảnh vừa chọn"))});video.classList.add("hidden");img.classList.remove("hidden");$(".target").classList.remove("hidden","photo-target");$(".target").classList.add("crop-target");$(".target span").textContent="KÉO QR VÀO TRONG KHUNG";$(".scan-line").classList.add("hidden");$("#cropControls").classList.remove("hidden");$(".camera-box").classList.add("crop-mode");resetCropTransform();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))}
function drawPreviewEyes(points,imageScale,imageWidth,imageHeight){
  const overlay=$("#qrImageOverlay"),box=overlay.parentElement.getBoundingClientRect(),dpr=devicePixelRatio||1;overlay.width=Math.round(box.width*dpr);overlay.height=Math.round(box.height*dpr);overlay.classList.remove("hidden");const ctx=overlay.getContext("2d");ctx.scale(dpr,dpr);ctx.clearRect(0,0,box.width,box.height);const fit=Math.min(box.width/imageWidth,box.height/imageHeight),ox=(box.width-imageWidth*fit)/2,oy=(box.height-imageHeight*fit)/2;
  points.forEach((p,i)=>{const x=(p.x/imageScale)*fit+ox,y=(p.y/imageScale)*fit+oy;ctx.beginPath();ctx.arc(x,y,12,0,Math.PI*2);ctx.fillStyle="#ffd43b";ctx.shadowColor="#ffd43b";ctx.shadowBlur=12;ctx.fill();ctx.shadowBlur=0;ctx.lineWidth=3;ctx.strokeStyle="#111";ctx.stroke();ctx.fillStyle="#111";ctx.font="900 11px sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(String(i+1),x,y)})
}
function toYmd(value){
  const v=onlyDigits(value);if(!/^\d{8}$/.test(v))return"";
  const currentYear=new Date().getFullYear();
  const yyyy=Number(v.slice(0,4)),mmY=Number(v.slice(4,6)),ddY=Number(v.slice(6,8));
  if(yyyy>=1900&&yyyy<=currentYear+20&&mmY>=1&&mmY<=12&&ddY>=1&&ddY<=31)return v;
  const dd=Number(v.slice(0,2)),mm=Number(v.slice(2,4)),year=Number(v.slice(4));
  return year>=1900&&year<=currentYear+20&&mm>=1&&mm<=12&&dd>=1&&dd<=31?`${v.slice(4)}${v.slice(2,4)}${v.slice(0,2)}`:"";
}
function saveDraft(){localStorage.setItem("hoso-nhap",JSON.stringify(draft));render()}
function render(){FIELDS.forEach(k=>{if(form.elements[k])form.elements[k].value=draft.record[k]||""});$("#hangHoc").value=draft.course.hang||"";$("#khoaHoc").value=draft.course.khoa||"";$("#cccdState").textContent=draft.cccdScanned?"Đã lưu tạm":"Chưa quét";$("#gplxState").textContent=draft.gplxScanned?"Đã lưu tạm":"Không bắt buộc";$("#draftStatus").textContent=draft.cccdScanned||draft.gplxScanned?"Đang giữ 1 hồ sơ tạm":"Chưa có hồ sơ tạm";$("#scanCccd").classList.toggle("done",draft.cccdScanned);$("#scanGplx").classList.toggle("done",draft.gplxScanned);$("#saveSheet").disabled=!draft.cccdScanned;$("#addressConversion").textContent=`ĐVHC cũ: ${draft.record.DiaChiGoc||"chưa quét"} → ĐVHC mới: ${draft.record.DiaChiMoi||"chưa xác định"}`;document.querySelectorAll("[data-photo-slot]").forEach(button=>{const state=draft.photos[button.dataset.photoSlot]||{};button.classList.toggle("has-photo",!!(state.front||state.back));button.querySelector("small").textContent=state.front?(state.back?"✓ Đủ 2 mặt · chụp lại":"✓ Đã có trước · chụp mặt sau"):"Chụp mặt trước"});renderPhotoPreviews()}
function normalizeAddressPart(value){
  return (value||"").trim().toLowerCase().replace(/đ/g,"d").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/^(?:(?:thanh pho|thi xa|thi tran|phuong|quan|huyen|tinh|xa)\s+|(?:tp|tx|tt|p|q|h|t|x)\.\s*|(?:tp|tx|tt|p|q|h|t|x)\s+)/,"")
    .replace(/[.;]+$/,"").replace(/\s+/g," ").trim();
}
async function resolveAddress(address){
  const rawParts=(address||"").split(",").map(x=>x.trim()).filter(Boolean);
  const parts=rawParts.map(normalizeAddressPart),rows=await dvhcPromise;
  let bestLength=0,best=[];
  for(const row of rows){
    const len=row.p.length;if(len>parts.length||len<2||len<bestLength)continue;
    let matches=true;
    for(let i=1;i<=len;i++)if(parts[parts.length-i]!==row.p[len-i]){matches=false;break}
    if(!matches)continue;
    if(len>bestLength){bestLength=len;best=[row]}else best.push(row);
  }
  if(bestLength){
    const codes=[...new Set(best.map(x=>x.c))];
    addressWarning=codes.length===1?"":`Địa chỉ trùng ${codes.length} mã ĐVHC, cần chọn thủ công.`;
    const selected=codes.length===1?best.find(x=>x.c===codes[0]):null;
    return{detail:rawParts.slice(0,rawParts.length-bestLength).join(", "),code:codes.length===1?codes[0]:"",newAddress:selected?.n||""};
  }
  const labelIndex=rawParts.findIndex(x=>/^(xã|phường|thị trấn)\s+/i.test(x));
  addressWarning="Không tìm thấy địa chỉ trong danh mục ĐVHC.";
  return{detail:labelIndex>=0?rawParts.slice(0,labelIndex).join(", "):address,code:"",newAddress:""};
}
async function parseCccd(raw){
  const p=raw.split("|").map(x=>x.trim());
  if(p.length<6)throw Error("QR CCCD không đúng cấu trúc");
  const address=await resolveAddress(p[5]);
  const newFull=[address.detail,address.newAddress].filter(Boolean).join(", ");
  return{SoCMT:p[0],HoVaTen:p[2],NgaySinh:formatDate(p[3]),GioiTinh:p[4],ChiTiet_TT:address.detail,MaDVHC_TT:address.code,ChiTiet_CT:address.detail,MaDVHC_CT:address.code,NgayCapCMT:formatDate(p[6]||""),NoiCapCMT:"Cục Cảnh sát QLHC về TTXH",DiaChiGoc:p[5],DiaChiMoi:newFull};
}
function parseGplx(raw){
  const cleanRaw=raw.replace(/https?:\/\/\S+/gi,"").trim().replace(/[;\s]+$/,"");
  const p=cleanRaw.split(/[|;]/).map(x=>x.trim()).filter(Boolean);
  if(cleanRaw.includes(";")&&p.length>=6&&/^\d{10,12}$/.test(onlyDigits(p[0]))&&/^\d{8}$/.test(onlyDigits(p[2]))){
    const hangs=[...new Set([...p[3].matchAll(/(?:^|[^A-Z0-9])(A1|A2|A3|A4|A|B1|B2|B|C1|C|D1|D2|D|BE|CE|DE|FB2|FC|FD|FE)(?=$|[^A-Z0-9])/gi)].map(x=>x[1].toUpperCase()))];
    const count=Math.max(1,hangs.length),repeat=value=>Array(count).fill(value).join("|");
    const issuer=p[6]||"",issuerCode=DVQL_BY_ISSUER[normalizeAddressPart(issuer)]||issuer;
    return{SoGPLXDaCo:repeat(onlyDigits(p[0])),HangGPLXDaCo:hangs.join("|"),NgayTTGPLXDaCo:"",NgayCapGPLXDaCo:repeat(toYmd(p[4])),DVCapGPLXDaCo:repeat(issuerCode)};
  }
  const birthYmd=toYmd(draft.record.NgaySinh);
  const issueDates=p.map(onlyDigits).filter(x=>/^\d{8}$/.test(x)).map(toYmd).filter(x=>x&&x!==birthYmd);
  const hangs=[...new Set([...cleanRaw.matchAll(/(?:^|[^A-Z0-9])(A1|A2|A3|A4|A|B1|B2|B|C1|C|D1|D2|D|BE|CE|DE|FB2|FC|FD|FE)(?=$|[^A-Z0-9])/gi)].map(x=>x[1].toUpperCase()))];
  const candidates=p.map(onlyDigits).filter(x=>x.length>=10&&x.length<=12&&!/^\d{8}$/.test(x)&&x!==onlyDigits(draft.record.SoCMT));
  return{SoGPLXDaCo:candidates.join("|"),HangGPLXDaCo:hangs.join("|"),NgayTTGPLXDaCo:"",NgayCapGPLXDaCo:issueDates[0]||"",DVCapGPLXDaCo:""};
}
function appendPipe(oldValue,newValue){return newValue?(oldValue?oldValue+"|"+newValue:newValue):oldValue}
const pipeValues=value=>(value||"").split("|").map(x=>x.trim()).filter(Boolean);
function isValidYmd(value){if(!/^\d{8}$/.test(value))return false;const y=+value.slice(0,4),m=+value.slice(4,6),d=+value.slice(6,8),date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d}
function validateRecord(){
  if(!draft.cccdScanned)return"Phải quét CCCD trước khi lưu.";
  if(!draft.record.Sales.trim())return"Phải chọn hoặc nhập Sales trước khi lưu.";
  if(!draft.course.hang||!draft.course.khoa)return"Phải chọn Hạng học và nhập Khóa trước khi lưu.";
  const hangs=pipeValues(draft.record.HangGPLXDaCo),hasGplx=draft.gplxScanned||pipeValues(draft.record.SoGPLXDaCo).length||hangs.length;
  if(!hasGplx)return"";
  if(!hangs.length)return"GPLX đã có nhưng chưa xác định được hạng.";
  const dates=pipeValues(draft.record.NgayTTGPLXDaCo);
  if(dates.length!==hangs.length||dates.some(x=>!isValidYmd(x)))return`Ngày trúng tuyển phải có ${hangs.length} giá trị dạng yyyyMMdd, ngăn bằng dấu |.`;
  return"";
}
const photoDbPromise=new Promise((resolve,reject)=>{const request=indexedDB.open("hoso-anh",1);request.onupgradeneeded=()=>request.result.createObjectStore("photos");request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
async function photoDbAction(mode,action){const db=await photoDbPromise;return new Promise((resolve,reject)=>{const tx=db.transaction("photos",mode),store=tx.objectStore("photos"),request=action(store);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
const putPhoto=(key,blob)=>photoDbAction("readwrite",store=>store.put(blob,key));
const getPhoto=key=>photoDbAction("readonly",store=>store.get(key));
const clearPhotos=()=>photoDbAction("readwrite",store=>store.clear());
const photoLabel={cccd:"CCCD",gplx1:"GPLX 1",gplx2:"GPLX 2",gplx3:"GPLX 3"};
async function renderPhotoPreviews(){
  for(const button of document.querySelectorAll("[data-photo-slot]"))for(const img of button.querySelectorAll("img[data-side]")){const exists=draft.photos[button.dataset.photoSlot]?.[img.dataset.side];img.classList.toggle("visible",!!exists);if(!exists){if(img.dataset.objectUrl)URL.revokeObjectURL(img.dataset.objectUrl);img.removeAttribute("src");delete img.dataset.objectUrl;continue}if(img.dataset.objectUrl)continue;const blob=await getPhoto(`${button.dataset.photoSlot}_${img.dataset.side}`).catch(()=>null);if(blob){const url=URL.createObjectURL(blob);img.src=url;img.dataset.objectUrl=url}}
}
async function openPhotoCamera(slot){
  cameraMode="photo";photoSlot=slot;const state=draft.photos[slot]||{};photoSide=state.next||(state.front&&!state.back?"back":"front");flashOn=false;scanLocked=true;
  const target=$(".target");target.classList.remove("crop-target");target.classList.add("photo-target");target.style.borderColor="";target.style.boxShadow="";target.querySelector("span").textContent=`KHỚP ${photoLabel[slot]} VÀO KHUNG`;
  $(".scan-line").classList.add("photo-hidden");$("#qrCameraActions").classList.add("hidden");$("#photoCameraActions").classList.remove("hidden");
  $("#cameraTitle").textContent=`${photoLabel[slot]} — mặt ${photoSide==="front"?"trước":"sau"}`;$("#cameraHint").textContent="Giữ thẻ thẳng, đủ sáng và khớp bốn cạnh vào khung.";$("#capturePhoto").textContent=`Chụp mặt ${photoSide==="front"?"trước":"sau"}`;panel.classList.remove("hidden");document.body.style.overflow="hidden";
  try{scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}}});video.srcObject=scanStream;await video.play();const track=scanStream.getVideoTracks()[0],caps=track.getCapabilities?.()||{},advanced=[];if(caps.focusMode?.includes?.("continuous"))advanced.push({focusMode:"continuous"});if(advanced.length)track.applyConstraints({advanced}).catch(()=>{})}catch{show("Không mở được camera chụp ảnh.","error");closeCamera()}
}
async function captureCurrentPhoto(){
  if(cameraMode!=="photo"||video.readyState<2)return;
  const vw=video.videoWidth,vh=video.videoHeight,ratio=1.586;let sw=vw,sh=sw/ratio;if(sh>vh){sh=vh;sw=sh*ratio}const sx=(vw-sw)/2,sy=(vh-sh)/2,out=document.createElement("canvas");out.width=1600;out.height=Math.round(1600/ratio);out.getContext("2d").drawImage(video,sx,sy,sw,sh,0,0,out.width,out.height);
  const blob=await new Promise(resolve=>out.toBlob(resolve,"image/jpeg",.82));if(!blob)return show("Không tạo được ảnh.","error");await putPhoto(`${photoSlot}_${photoSide}`,blob);const preview=document.querySelector(`[data-photo-slot="${photoSlot}"] img[data-side="${photoSide}"]`);if(preview?.dataset.objectUrl){URL.revokeObjectURL(preview.dataset.objectUrl);delete preview.dataset.objectUrl}draft.photos[photoSlot]={...(draft.photos[photoSlot]||{}),[photoSide]:true,next:photoSide==="front"?"back":"front"};saveDraft();closeCamera();show(`Đã chụp ${photoLabel[photoSlot]} mặt ${photoSide==="front"?"trước":"sau"}.`,"ok")
}
function safeFilePart(value){return normalizeAddressPart(value).replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"")||"hoc_vien"}
async function buildPhotoZip(){
  const zip=new JSZip();let count=0;
  for(const slot of Object.keys(photoLabel))for(const side of ["front","back"]){if(!draft.photos[slot]?.[side])continue;const blob=await getPhoto(`${slot}_${side}`);if(blob){zip.file(`${slot}_${side==="front"?"mat_truoc":"mat_sau"}.jpg`,blob);count++}}
  if(!count)return null;return{blob:await zip.generateAsync({type:"blob",compression:"DEFLATE",compressionOptions:{level:6}}),name:`${safeFilePart(draft.record.HoVaTen)}_${safeFilePart(draft.record.MaKhoaHoc)}.zip`}
}
function triggerZipDownload(archive){if(!archive)return false;const url=URL.createObjectURL(archive.blob),a=document.createElement("a");a.href=url;a.download=archive.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);return true}
async function downloadPhotoZip(){return triggerZipDownload(await buildPhotoZip())}
async function finish(raw){
  try{
    navigator.vibrate?.(120);
    if(scanType==="cccd"){addressWarning="";Object.assign(draft.record,await parseCccd(raw))}
    else{
      draft.gplxRawList=draft.gplxRawList||[];
      if(!draft.gplxRawList.includes(raw)){
        const parsed=parseGplx(raw);
        ["SoGPLXDaCo","HangGPLXDaCo","NgayTTGPLXDaCo","NgayCapGPLXDaCo","DVCapGPLXDaCo"].forEach(k=>draft.record[k]=appendPipe(draft.record[k],parsed[k]));
        draft.gplxRawList.push(raw);
      }
    }
    draft[scanType==="cccd"?"cccdScanned":"gplxScanned"]=true;saveDraft();closeCamera();
    show(addressWarning?"Đã quét CCCD. "+addressWarning:"Đã quét và lưu tạm "+scanType.toUpperCase(),addressWarning?"error":"ok");
  }catch(e){scanLocked=false;show(e.message,"error")}
}
function drawQrOutline(points){
  if(!points?.length)return;
  let canvas=$("#qrOutlineCanvas");
  if(!canvas){canvas=document.createElement("canvas");canvas.id="qrOutlineCanvas";Object.assign(canvas.style,{position:"absolute",inset:"0",width:"100%",height:"100%",pointerEvents:"none",zIndex:"20"});video.parentElement.appendChild(canvas)}
  const box=video.getBoundingClientRect(),dpr=devicePixelRatio||1;
  canvas.width=Math.round(box.width*dpr);canvas.height=Math.round(box.height*dpr);
  const ctx=canvas.getContext("2d");ctx.scale(dpr,dpr);
  const scale=Math.max(box.width/video.videoWidth,box.height/video.videoHeight),ox=(box.width-video.videoWidth*scale)/2,oy=(box.height-video.videoHeight*scale)/2;
  const mapped=points.map(p=>({x:p.x*scale+ox,y:p.y*scale+oy}));
  ctx.strokeStyle="#2dff9b";ctx.lineWidth=5;ctx.lineJoin="round";ctx.shadowColor="#2dff9b";ctx.shadowBlur=12;
  ctx.beginPath();ctx.moveTo(mapped[0].x,mapped[0].y);mapped.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.closePath();ctx.stroke();
}
function markQrDetected(raw,points){
  if(scanLocked)return;
  scanLocked=true;
  if(scanLoopId)cancelAnimationFrame(scanLoopId);
  drawQrOutline(points);
  navigator.vibrate?.([70,40,120]);
  const target=document.querySelector(".target");
  target.style.borderColor="#2dff9b";
  target.style.boxShadow="0 0 0 999px #0007,0 0 24px #2dff9b";
  const notice=document.createElement("strong");
  notice.id="qrDetectedNotice";
  notice.textContent="✓ ĐÃ NHẬN QR";
  Object.assign(notice.style,{position:"absolute",left:"50%",top:"50%",transform:"translate(-50%,-50%)",background:"#087b5d",color:"#fff",padding:"10px 16px",borderRadius:"999px",fontSize:"13px",whiteSpace:"nowrap",boxShadow:"0 5px 20px #0008"});
  target.appendChild(notice);
  setTimeout(()=>finish(raw),650);
}
async function openCamera(type){
  cameraMode="qr";scanType=type;flashOn=false;scanLocked=false;resetFinderState();clearQrImagePreview();
  const target=document.querySelector(".target");target.classList.remove("photo-target","crop-target","hidden");target.style.borderColor="";target.style.boxShadow="";target.querySelector("span").textContent="ĐẶT TOÀN BỘ MÃ QR VÀO KHUNG";$("#qrDetectedNotice")?.remove();
  $(".scan-line").classList.remove("photo-hidden");$("#qrCameraActions").classList.remove("hidden");$("#photoCameraActions").classList.add("hidden");$("#cameraHint").textContent="Giữ cách QR khoảng 15–25 cm và chờ camera lấy nét.";
  $("#toggleFlash").textContent="Bật đèn";$("#cameraTitle").textContent="Quét QR "+type.toUpperCase();panel.classList.remove("hidden");document.body.style.overflow="hidden";
  try{
    scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:2560},height:{ideal:1440}}});
    video.srcObject=scanStream;await video.play();
    const track=scanStream.getVideoTracks()[0],caps=track.getCapabilities?.()||{},advanced=[];cameraCaps=caps;
    if(caps.focusMode?.includes?.("continuous"))advanced.push({focusMode:"continuous"});
    if(advanced.length)track.applyConstraints({advanced}).catch(()=>{});
    $("#toggleFlash").style.display=caps.torch?"block":"none";zoomSteps=caps.zoom?[caps.zoom.min,caps.zoom.min+(caps.zoom.max-caps.zoom.min)*.3,caps.zoom.min+(caps.zoom.max-caps.zoom.min)*.6]:[];zoomIndex=0;$("#cycleZoom").style.display=zoomSteps.length?"block":"none";$("#cycleZoom").textContent=zoomSteps.length?`Zoom ${zoomSteps[0].toFixed(1)}×`:"Zoom";
    updateCameraDiagnostic("đưa QR vào giữa khung");lastScanAt=0;scanFrameNo=0;scanLoop();
  }catch{show("Không mở được camera. Hãy cấp quyền hoặc chọn ảnh.","error");closeCamera()}
}
async function scanLoop(time=0){
  if(!scanStream||scanLocked)return;
  if(video.readyState<2||time-lastScanAt<80){scanLoopId=requestAnimationFrame(scanLoop);return}
  lastScanAt=time;
  try{
    if(nativeDetector){
      const found=await nativeDetector.detect(video);
      if(found?.length){const code=found[0];markQrDetected(code.rawValue,code.cornerPoints);return}
    }
    {
      const vw=video.videoWidth,vh=video.videoHeight,frameNo=scanFrameNo++,useFull=(frameNo%3===0);
      const side=Math.min(vw,vh)*0.82,sx=useFull?0:(vw-side)/2,sy=useFull?0:(vh-side)/2,sw=useFull?vw:side,sh=useFull?vh:side;
      const max=useFull?1800:1300,scale=Math.min(1,max/sw);
      scanCanvas.width=Math.round(sw*scale);scanCanvas.height=Math.round(sh*scale);
      scanCtx.drawImage(video,sx,sy,sw,sh,0,0,scanCanvas.width,scanCanvas.height);
      const image=scanCtx.getImageData(0,0,scanCanvas.width,scanCanvas.height),result=jsQR(image.data,image.width,image.height,{inversionAttempts:"attemptBoth"});
      if(result?.data){const loc=result.location,s=1/scale;markQrDetected(result.data,[loc.topLeftCorner,loc.topRightCorner,loc.bottomRightCorner,loc.bottomLeftCorner].map(p=>({x:p.x*s+sx,y:p.y*s+sy})));return}
      if(useFull){updateCameraDiagnostic("đang giải mã trực tiếp, không đoán vị trí");const zxing=await decodeWithZxing(image);if(zxing){const s=1/scale,pos=zxing.position,points=pos?[pos.topLeft,pos.topRight,pos.bottomRight,pos.bottomLeft].map(p=>({x:p.x*s+sx,y:p.y*s+sy})):null;markQrDetected(zxing.text,points);return}}
    }
  }catch{}
  scanLoopId=requestAnimationFrame(scanLoop);
}
function closeCamera(){if(scanLoopId)cancelAnimationFrame(scanLoopId);scanLoopId=null;scanStream?.getTracks().forEach(t=>t.stop());scanStream=null;video.srcObject=null;$("#qrOutlineCanvas")?.remove();resetFinderState();clearQrImagePreview();$(".target").classList.remove("hidden","crop-target");$(".scan-line").classList.remove("hidden");flashOn=false;scanLocked=false;panel.classList.add("hidden");document.body.style.overflow=""}
function show(text,kind=""){$("#message").textContent=text;$("#message").className=kind}
$("#scanCccd").onclick=()=>openCamera("cccd");$("#scanGplx").onclick=()=>openCamera("gplx");$("#review").onclick=()=>$("#reviewPanel").scrollIntoView({behavior:"smooth"});$("#closeCamera").onclick=closeCamera;
$("#capturePhoto").onclick=captureCurrentPhoto;document.querySelectorAll("[data-photo-slot]").forEach(button=>button.onclick=()=>openPhotoCamera(button.dataset.photoSlot));
$("#downloadZipOnly").onclick=async()=>{try{show("Đang nén ảnh...");const downloaded=await downloadPhotoZip();show(downloaded?"Đã tải ZIP ảnh về máy.":"Chưa có ảnh để tải.",downloaded?"ok":"error")}catch(e){show(`Không tạo được ZIP ảnh: ${e.message||e}`,"error")}};
$("#toggleFlash").onclick=async()=>{const track=scanStream?.getVideoTracks?.()[0];if(!track)return;try{flashOn=!flashOn;await track.applyConstraints({advanced:[{torch:flashOn}]});$("#toggleFlash").textContent=flashOn?"Tắt đèn":"Bật đèn"}catch{show("Điện thoại không hỗ trợ bật đèn từ trình duyệt.","error")}};
$("#cycleZoom").onclick=async()=>{const track=scanStream?.getVideoTracks?.()[0];if(!track||!zoomSteps.length)return;zoomIndex=(zoomIndex+1)%zoomSteps.length;const zoom=zoomSteps[zoomIndex];try{await track.applyConstraints({advanced:[{zoom}]});$("#cycleZoom").textContent=`Zoom ${zoom.toFixed(1)}×`;updateCameraDiagnostic(`zoom ${zoom.toFixed(1)}×`)}catch{show("iPhone không cho web điều chỉnh zoom.","error")}};
async function loadImageSource(file){
  if("createImageBitmap" in window)try{return await createImageBitmap(file,{imageOrientation:"from-image"})}catch{}
  return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{URL.revokeObjectURL(url);resolve(img)};img.onerror=()=>{URL.revokeObjectURL(url);reject(Error("Điện thoại không mở được tệp ảnh"))};img.src=url})
}
async function processSelectedQrImage(e){
  const input=e.target,file=input.files?.[0];if(!file)return;
  try{
    currentQrSource=await loadImageSource(file);const width=currentQrSource.width||currentQrSource.naturalWidth,height=currentQrSource.height||currentQrSource.naturalHeight;if(!width||!height)throw Error("không đọc được kích thước ảnh");await showQrImagePreview(file);currentQrSource=await loadImageSource(file);$("#cameraHint").textContent="Kéo ảnh và chỉnh Phóng ảnh để toàn bộ QR nằm gọn trong khung vàng, chừa một ít viền trắng.";show("Ảnh đã sẵn sàng. Hãy căn QR rồi bấm Đọc QR trong khung.");
  }catch(error){$("#imageProcessing").classList.add("hidden");const message=`Không xử lý được ảnh: ${error?.message||error}`;$("#cameraHint").textContent=message;show(message,"error")}finally{input.value=""}
}
async function decodeImageDataVariants(canvas){
  if(nativeDetector){const found=await nativeDetector.detect(canvas).catch(()=>[]);if(found?.[0]?.rawValue)return found[0].rawValue}
  const original=canvas.getContext("2d",{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height),tryImage=async image=>{const z=await decodeWithZxing(image);if(z?.text)return z.text;return jsQR(image.data,image.width,image.height,{inversionAttempts:"attemptBoth"})?.data||""};let raw=await tryImage(original);if(raw)return raw;
  for(const threshold of [105,130,155,180]){const data=new Uint8ClampedArray(original.data);for(let i=0;i<data.length;i+=4){const y=.299*data[i]+.587*data[i+1]+.114*data[i+2],v=y<threshold?0:255;data[i]=data[i+1]=data[i+2]=v}raw=await tryImage(new ImageData(data,original.width,original.height));if(raw)return raw}return""
}
async function decodeQrCrop(){
  if(!currentQrSource)return show("Hãy chọn hoặc chụp ảnh trước.","error");const button=$("#decodeCrop");button.disabled=true;$("#imageProcessing").classList.remove("hidden");$("#cameraHint").textContent="Đang cắt đúng vùng trong khung và thử nhiều chế độ ảnh...";await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  try{const box=$(".camera-box").getBoundingClientRect(),target=$(".target").getBoundingClientRect(),width=currentQrSource.width||currentQrSource.naturalWidth,height=currentQrSource.height||currentQrSource.naturalHeight,fit=Math.min(box.width/width,box.height/height),factor=fit*cropZoom,cx=box.left+box.width/2+cropPanX,cy=box.top+box.height/2+cropPanY;let sx=width/2+(target.left-cx)/factor,sy=height/2+(target.top-cy)/factor,sw=target.width/factor,sh=target.height/factor;sx=Math.max(0,sx);sy=Math.max(0,sy);sw=Math.min(width-sx,sw);sh=Math.min(height-sy,sh);if(sw<40||sh<40)throw Error("vùng cắt nằm ngoài ảnh");
    const size=1400,base=document.createElement("canvas");base.width=size;base.height=size;base.getContext("2d").drawImage(currentQrSource,sx,sy,sw,sh,0,0,size,size);let raw="";
    for(const angle of [0,90,180,270]){const test=document.createElement("canvas");test.width=size;test.height=size;const ctx=test.getContext("2d");ctx.translate(size/2,size/2);ctx.rotate(angle*Math.PI/180);ctx.drawImage(base,-size/2,-size/2);$("#cameraHint").textContent=`Đang thử vùng QR xoay ${angle}°...`;await new Promise(resolve=>requestAnimationFrame(resolve));raw=await decodeImageDataVariants(test);if(raw)break}
    if(raw){$("#cameraHint").textContent="✓ Đã đọc được QR trong vùng đã chọn.";await finish(raw);return}$("#cameraHint").textContent="Không đọc được QR trong khung. Hãy phóng lớn hơn, để đủ cả QR và một ít viền trắng rồi thử lại.";show("Không đọc được vùng đã chọn. Ảnh vẫn được giữ để căn lại.","error")
  }catch(error){const message=`Không đọc được vùng QR: ${error?.message||error}`;$("#cameraHint").textContent=message;show(message,"error")}finally{$("#imageProcessing").classList.add("hidden");button.disabled=false}
}
$("#imageInput").onchange=processSelectedQrImage;
$("#cameraImageInput").onchange=processSelectedQrImage;
$("#decodeCrop").onclick=decodeQrCrop;$("#resetCrop").onclick=resetCropTransform;$("#cropZoom").oninput=e=>{cropZoom=Number(e.target.value);applyCropTransform()};
const cropBox=$(".camera-box");cropBox.addEventListener("pointerdown",e=>{if(!currentQrSource)return;cropPointer={id:e.pointerId,x:e.clientX,y:e.clientY,startX:cropPanX,startY:cropPanY};cropBox.setPointerCapture(e.pointerId)});cropBox.addEventListener("pointermove",e=>{if(!cropPointer||e.pointerId!==cropPointer.id)return;cropPanX=cropPointer.startX+e.clientX-cropPointer.x;cropPanY=cropPointer.startY+e.clientY-cropPointer.y;applyCropTransform()});const endCropPointer=e=>{if(cropPointer?.id===e.pointerId)cropPointer=null};cropBox.addEventListener("pointerup",endCropPointer);cropBox.addEventListener("pointercancel",endCropPointer);
form.oninput=e=>{if(e.target.name){draft.record[e.target.name]=e.target.value;saveDraft()}};
function updateCourse(){draft.course={hang:$("#hangHoc").value.trim().toUpperCase(),khoa:$("#khoaHoc").value.trim().toUpperCase()};draft.record.MaKhoaHoc=[draft.course.hang,draft.course.khoa].filter(Boolean).join("-");saveDraft()}
$("#hangHoc").onchange=updateCourse;$("#khoaHoc").oninput=updateCourse;
$("#clearDraft").onclick=async()=>{if(confirm("Xóa toàn bộ hồ sơ và ảnh đang giữ tạm?")){await clearPhotos().catch(()=>{});draft={record:emptyRecord(),cccdScanned:false,gplxScanned:false,course:{hang:"",khoa:""},photos:{}};localStorage.removeItem("hoso-nhap");render()}};
$("#saveSheet").onclick=async()=>{if(!GOOGLE_SCRIPT_URL)return show("Chưa cấu hình GOOGLE_SCRIPT_URL trong config.js.","error");const validationError=validateRecord();if(validationError)return show(validationError,"error");$("#saveSheet").disabled=true;show("Đang chuẩn bị ZIP ảnh...");const payload={...draft.record,NoiCapCMT:"00",ClientRecordId:crypto.randomUUID(),CreatedAt:new Date().toISOString()};let archive=null;try{archive=await buildPhotoZip()}catch(e){show(`Không tạo được ZIP ảnh: ${e.message||e}. Hồ sơ chưa gửi.`,"error");$("#saveSheet").disabled=false;return}show("Đang ghi Google Sheets...");try{await fetch(GOOGLE_SCRIPT_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain"},body:JSON.stringify(payload)})}catch(e){const downloaded=triggerZipDownload(archive);show(`${downloaded?"ZIP ảnh đã được tải. ":""}Google Sheets chưa lưu được: ${e.message||e}. Hồ sơ tạm vẫn được giữ.`,"error");$("#saveSheet").disabled=false;return}const downloaded=triggerZipDownload(archive);await clearPhotos().catch(()=>{});localStorage.removeItem("hoso-nhap");draft={record:emptyRecord(),cccdScanned:false,gplxScanned:false,course:{hang:"",khoa:""},photos:{}};render();show(downloaded?"Đã gửi Google Sheets và tải ZIP ảnh.":"Đã gửi Google Sheets không kèm ảnh.","ok")};
render();

function installAddressTester(){
  if($("#addressTester"))return;
  const box=document.createElement("section");box.id="addressTester";
  box.style.cssText="margin:18px 0;padding:16px;border:1px solid #cbd5e1;border-radius:14px;background:#f8fafc";
  box.innerHTML=`<h3 style="margin:0 0 8px">Thử tách địa chỉ (không lưu)</h3><p style="margin:0 0 10px;color:#475569">Dán nguyên địa chỉ CCCD để kiểm tra trước khi quét thật.</p><textarea id="addressTestInput" rows="3" placeholder="Ví dụ: 123 đường A, khu phố 2, phường..., thành phố..., tỉnh..." style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #94a3b8;border-radius:8px"></textarea><button type="button" id="runAddressTest" style="margin-top:10px">Kiểm tra tách địa chỉ</button><pre id="addressTestResult" style="white-space:pre-wrap;margin:10px 0 0"></pre>`;
  form.parentElement.appendChild(box);
  $("#runAddressTest").onclick=async()=>{
    const value=$("#addressTestInput").value.trim();if(!value)return;
    addressWarning="";const result=await resolveAddress(value);
    $("#addressTestResult").textContent=`ChiTiet_TT / ChiTiet_CT: ${result.detail||"(trống)"}\nĐVHC mới: ${result.newAddress||"(chưa xác định)"}\nMaDVHC_TT / MaDVHC_CT: ${result.code||"(chưa xác định)"}${addressWarning?`\nCảnh báo: ${addressWarning}`:""}`;
  };
}
installAddressTester();
