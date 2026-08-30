import jsQR from "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm";
import { GOOGLE_SCRIPT_URL } from "./config.js";

const FIELDS=["HoVaTen","NgaySinh","GioiTinh","SoCMT","NgayCapCMT","NoiCapCMT","MaDVHC_TT","ChiTiet_TT","MaDVHC_CT","ChiTiet_CT","SoGPLXDaCo","HangGPLXDaCo","NgayTTGPLXDaCo","NgayCapGPLXDaCo","DVCapGPLXDaCo","GhiChu"];
const emptyRecord=()=>Object.fromEntries(FIELDS.map(x=>[x,""]));
let draft=JSON.parse(localStorage.getItem("hoso-nhap")||"null")||{record:emptyRecord(),cccdScanned:false,gplxScanned:false};
let scanType="cccd",scanStream=null,scanLoopId=null,flashOn=false,scanLocked=false,nativeDetector=null,lastScanAt=0,scanFrameNo=0;
try{if("BarcodeDetector" in window)nativeDetector=new BarcodeDetector({formats:["qr_code"]})}catch{}
const scanCanvas=document.createElement("canvas"),scanCtx=scanCanvas.getContext("2d",{willReadFrequently:true});
const dvhcPromise=fetch("./dvhc.json",{cache:"force-cache"}).then(r=>r.ok?r.json():[]).then(rows=>rows.map(x=>({...x,p:x.a.split("|")}))).catch(()=>[]);
const DVQL_BY_ISSUER={"an giang":"91","ba ria - vung tau":"79","bac giang":"24","bac kan":"19","bac lieu":"96","bac ninh":"24","ben tre":"86","binh dinh":"52","binh duong":"79","binh phuoc":"75","binh thuan":"68","ca mau":"96","can tho":"92","cao bang":"04","da nang":"48","dak lak":"66","dak nong":"68","dien bien":"11","dong nai":"75","dong thap":"82","gia lai":"52","ha giang":"08","ha nam":"37","ha noi":"01","ha tinh":"42","hai duong":"31","hai phong":"31","hau giang":"92","ho chi minh":"79","hoa binh":"25","hue":"46","hung yen":"33","khanh hoa":"56","kien giang":"91","kon tum":"51","lai chau":"12","lam dong":"68","lang son":"20","lao cai":"15","long an":"80","nam dinh":"37","nghe an":"40","ninh binh":"37","ninh thuan":"56","phu tho":"25","phu yen":"66","quang binh":"44","quang nam":"48","quang ngai":"51","quang ninh":"22","quang tri":"44","soc trang":"92","son la":"14","tay ninh":"80","thai binh":"33","thai nguyen":"19","thanh hoa":"38","thua thien hue":"46","tien giang":"82","tra vinh":"86","tuyen quang":"08","vinh long":"86","vinh phuc":"25","yen bai":"15"};
let addressWarning="";
const form=document.querySelector("#recordForm"),video=document.querySelector("#camera"),panel=document.querySelector("#cameraPanel");
const $=s=>document.querySelector(s);
const formatDate=v=>/^\d{8}$/.test(v)?`${v.slice(0,2)}/${v.slice(2,4)}/${v.slice(4)}`:v;
const onlyDigits=v=>(v||"").replace(/\D/g,"");
function toYmd(value){
  const v=onlyDigits(value);if(!/^\d{8}$/.test(v))return"";
  const currentYear=new Date().getFullYear();
  const yyyy=Number(v.slice(0,4)),mmY=Number(v.slice(4,6)),ddY=Number(v.slice(6,8));
  if(yyyy>=1900&&yyyy<=currentYear+20&&mmY>=1&&mmY<=12&&ddY>=1&&ddY<=31)return v;
  const dd=Number(v.slice(0,2)),mm=Number(v.slice(2,4)),year=Number(v.slice(4));
  return year>=1900&&year<=currentYear+20&&mm>=1&&mm<=12&&dd>=1&&dd<=31?`${v.slice(4)}${v.slice(2,4)}${v.slice(0,2)}`:"";
}
function saveDraft(){localStorage.setItem("hoso-nhap",JSON.stringify(draft));render()}
function render(){FIELDS.forEach(k=>form.elements[k].value=draft.record[k]||"");$("#cccdState").textContent=draft.cccdScanned?"Đã lưu tạm":"Chưa quét";$("#gplxState").textContent=draft.gplxScanned?"Đã lưu tạm":"Không bắt buộc";$("#draftStatus").textContent=draft.cccdScanned||draft.gplxScanned?"Đang giữ 1 hồ sơ tạm":"Chưa có hồ sơ tạm";$("#scanCccd").classList.toggle("done",draft.cccdScanned);$("#scanGplx").classList.toggle("done",draft.gplxScanned);$("#saveSheet").disabled=!draft.cccdScanned}
function normalizeAddressPart(value){
  return (value||"").trim().toLowerCase().replace(/đ/g,"d").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/^(xa|phuong|thi tran|huyen|quan|thi xa|thanh pho|tinh|tp|q|h|tx|tt|p|x|t)\.?\s+/,"").replace(/\s+/g," ").trim();
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
    return{detail:rawParts.slice(0,rawParts.length-bestLength).join(", "),code:codes.length===1?codes[0]:""};
  }
  const labelIndex=rawParts.findIndex(x=>/^(xã|phường|thị trấn)\s+/i.test(x));
  addressWarning="Không tìm thấy địa chỉ trong danh mục ĐVHC.";
  return{detail:labelIndex>=0?rawParts.slice(0,labelIndex).join(", "):address,code:""};
}
async function parseCccd(raw){
  const p=raw.split("|").map(x=>x.trim());
  if(p.length<6)throw Error("QR CCCD không đúng cấu trúc");
  const address=await resolveAddress(p[5]);
  return{SoCMT:p[0],HoVaTen:p[2],NgaySinh:formatDate(p[3]),GioiTinh:p[4],ChiTiet_TT:address.detail,MaDVHC_TT:address.code,ChiTiet_CT:address.detail,MaDVHC_CT:address.code,NgayCapCMT:formatDate(p[6]||""),NoiCapCMT:"Cục Cảnh sát QLHC về TTXH"};
}
function parseGplx(raw){
  const cleanRaw=raw.replace(/https?:\/\/\S+/gi,"").trim().replace(/[;\s]+$/,"");
  const p=cleanRaw.split(/[|;]/).map(x=>x.trim()).filter(Boolean);
  if(cleanRaw.includes(";")&&p.length>=6&&/^\d{10,12}$/.test(onlyDigits(p[0]))&&/^\d{8}$/.test(onlyDigits(p[2]))){
    const hangs=[...new Set([...p[3].matchAll(/(?:^|[^A-Z0-9])(A1|A2|A3|A4|A|B1|B2|B|C1|C|D1|D2|D|BE|CE|DE|FB2|FC|FD|FE)(?=$|[^A-Z0-9])/gi)].map(x=>x[1].toUpperCase()))];
    const count=Math.max(1,hangs.length),repeat=value=>Array(count).fill(value).join("|");
    const issuer=p[6]||"",issuerCode=DVQL_BY_ISSUER[normalizeAddressPart(issuer)]||issuer;
    return{SoGPLXDaCo:onlyDigits(p[0]),HangGPLXDaCo:hangs.join("|"),NgayTTGPLXDaCo:"",NgayCapGPLXDaCo:repeat(toYmd(p[4])),DVCapGPLXDaCo:repeat(issuerCode)};
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
  const hangs=pipeValues(draft.record.HangGPLXDaCo),hasGplx=draft.gplxScanned||pipeValues(draft.record.SoGPLXDaCo).length||hangs.length;
  if(!hasGplx)return"";
  if(!hangs.length)return"GPLX đã có nhưng chưa xác định được hạng.";
  const dates=pipeValues(draft.record.NgayTTGPLXDaCo);
  if(dates.length!==hangs.length||dates.some(x=>!isValidYmd(x)))return`Ngày trúng tuyển phải có ${hangs.length} giá trị dạng yyyyMMdd, ngăn bằng dấu |.`;
  return"";
}
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
  scanType=type;flashOn=false;scanLocked=false;
  const target=document.querySelector(".target");target.style.borderColor="";target.style.boxShadow="";$("#qrDetectedNotice")?.remove();
  $("#toggleFlash").textContent="Bật đèn";$("#cameraTitle").textContent="Quét QR "+type.toUpperCase();panel.classList.remove("hidden");document.body.style.overflow="hidden";
  try{
    scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}}});
    video.srcObject=scanStream;await video.play();
    const track=scanStream.getVideoTracks()[0],caps=track.getCapabilities?.()||{},advanced=[];
    if(caps.focusMode?.includes?.("continuous"))advanced.push({focusMode:"continuous"});
    if(caps.zoom){const zoom=caps.zoom.min+(caps.zoom.max-caps.zoom.min)*0.3;advanced.push({zoom})}
    if(advanced.length)track.applyConstraints({advanced}).catch(()=>{});
    $("#toggleFlash").style.display=caps.torch?"block":"none";
    lastScanAt=0;scanFrameNo=0;scanLoop();
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
      const vw=video.videoWidth,vh=video.videoHeight,useFull=(scanFrameNo++%4===0);
      const side=Math.min(vw,vh)*0.82,sx=useFull?0:(vw-side)/2,sy=useFull?0:(vh-side)/2,sw=useFull?vw:side,sh=useFull?vh:side;
      const max=useFull?1280:1100,scale=Math.min(1,max/sw);
      scanCanvas.width=Math.round(sw*scale);scanCanvas.height=Math.round(sh*scale);
      scanCtx.drawImage(video,sx,sy,sw,sh,0,0,scanCanvas.width,scanCanvas.height);
      const image=scanCtx.getImageData(0,0,scanCanvas.width,scanCanvas.height),result=jsQR(image.data,image.width,image.height,{inversionAttempts:"attemptBoth"});
      if(result?.data){const loc=result.location,s=1/scale;markQrDetected(result.data,[loc.topLeftCorner,loc.topRightCorner,loc.bottomRightCorner,loc.bottomLeftCorner].map(p=>({x:p.x*s+sx,y:p.y*s+sy})));return}
    }
  }catch{}
  scanLoopId=requestAnimationFrame(scanLoop);
}
function closeCamera(){if(scanLoopId)cancelAnimationFrame(scanLoopId);scanLoopId=null;scanStream?.getTracks().forEach(t=>t.stop());scanStream=null;video.srcObject=null;$("#qrOutlineCanvas")?.remove();flashOn=false;scanLocked=false;panel.classList.add("hidden");document.body.style.overflow=""}
function show(text,kind=""){$("#message").textContent=text;$("#message").className=kind}
$("#scanCccd").onclick=()=>openCamera("cccd");$("#scanGplx").onclick=()=>openCamera("gplx");$("#review").onclick=()=>$("#reviewPanel").scrollIntoView({behavior:"smooth"});$("#closeCamera").onclick=closeCamera;
$("#toggleFlash").onclick=async()=>{const track=scanStream?.getVideoTracks?.()[0];if(!track)return;try{flashOn=!flashOn;await track.applyConstraints({advanced:[{torch:flashOn}]});$("#toggleFlash").textContent=flashOn?"Tắt đèn":"Bật đèn"}catch{show("Điện thoại không hỗ trợ bật đèn từ trình duyệt.","error")}};
$("#imageInput").onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const bitmap=await createImageBitmap(file);if(nativeDetector){const found=await nativeDetector.detect(bitmap).catch(()=>[]);if(found?.[0]?.rawValue){finish(found[0].rawValue);e.target.value="";return}}const max=2200,scale=Math.min(1,max/bitmap.width);scanCanvas.width=Math.round(bitmap.width*scale);scanCanvas.height=Math.round(bitmap.height*scale);scanCtx.drawImage(bitmap,0,0,scanCanvas.width,scanCanvas.height);let image=scanCtx.getImageData(0,0,scanCanvas.width,scanCanvas.height),r=jsQR(image.data,image.width,image.height,{inversionAttempts:"attemptBoth"});if(!r?.data){for(let i=0;i<image.data.length;i+=4){const y=.299*image.data[i]+.587*image.data[i+1]+.114*image.data[i+2],v=y<145?0:255;image.data[i]=image.data[i+1]=image.data[i+2]=v}r=jsQR(image.data,image.width,image.height,{inversionAttempts:"attemptBoth"})}if(!r?.data)throw Error();finish(r.data)}catch{show("Không tìm thấy QR. Hãy chụp thẳng, đủ sáng và để QR chiếm ít nhất 1/3 ảnh.","error")}e.target.value=""};
form.oninput=e=>{if(e.target.name){draft.record[e.target.name]=e.target.value;saveDraft()}};
$("#clearDraft").onclick=()=>{if(confirm("Xóa toàn bộ hồ sơ đang giữ tạm?")){draft={record:emptyRecord(),cccdScanned:false,gplxScanned:false};localStorage.removeItem("hoso-nhap");render()}};
$("#saveSheet").onclick=async()=>{if(!GOOGLE_SCRIPT_URL)return show("Chưa cấu hình GOOGLE_SCRIPT_URL trong config.js.","error");const validationError=validateRecord();if(validationError)return show(validationError,"error");$("#saveSheet").disabled=true;show("Đang ghi Google Sheets...");const payload={...draft.record,NoiCapCMT:"00",ClientRecordId:crypto.randomUUID(),CreatedAt:new Date().toISOString()};try{await fetch(GOOGLE_SCRIPT_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain"},body:JSON.stringify(payload)});localStorage.removeItem("hoso-nhap");draft={record:emptyRecord(),cccdScanned:false,gplxScanned:false};render();show("Đã gửi bản ghi. Kiểm tra Google Sheets để xác nhận.","ok")}catch{show("Không gửi được. Hồ sơ tạm vẫn được giữ lại.","error");$("#saveSheet").disabled=false}};
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
    $("#addressTestResult").textContent=`ChiTiet_TT / ChiTiet_CT: ${result.detail||"(trống)"}\nMaDVHC_TT / MaDVHC_CT: ${result.code||"(chưa xác định)"}${addressWarning?`\nCảnh báo: ${addressWarning}`:""}`;
  };
}
installAddressTester();
