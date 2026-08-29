import QrScanner from "https://cdn.jsdelivr.net/npm/qr-scanner@1.4.2/qr-scanner.min.js";
import { GOOGLE_SCRIPT_URL } from "./config.js";

const FIELDS=["HoVaTen","NgaySinh","GioiTinh","SoCMT","NgayCapCMT","NoiCapCMT","MaDVHC_TT","ChiTiet_TT","MaDVHC_CT","ChiTiet_CT","SoGPLXDaCo","HangGPLXDaCo","NgayTTGPLXDaCo","NgayCapGPLXDaCo","DVCapGPLXDaCo","GhiChu"];
const emptyRecord=()=>Object.fromEntries(FIELDS.map(x=>[x,""]));
let draft=JSON.parse(localStorage.getItem("hoso-nhap")||"null")||{record:emptyRecord(),cccdScanned:false,gplxScanned:false};
let scanType="cccd",scanner=null,flashOn=false,scanLocked=false;
const form=document.querySelector("#recordForm"),video=document.querySelector("#camera"),panel=document.querySelector("#cameraPanel");
const $=s=>document.querySelector(s);
const formatDate=v=>/^\d{8}$/.test(v)?`${v.slice(0,2)}/${v.slice(2,4)}/${v.slice(4)}`:v;
const onlyDigits=v=>(v||"").replace(/\D/g,"");
function saveDraft(){localStorage.setItem("hoso-nhap",JSON.stringify(draft));render()}
function render(){FIELDS.forEach(k=>form.elements[k].value=draft.record[k]||"");$("#cccdState").textContent=draft.cccdScanned?"Đã lưu tạm":"Chưa quét";$("#gplxState").textContent=draft.gplxScanned?"Đã lưu tạm":"Chưa quét";$("#draftStatus").textContent=draft.cccdScanned||draft.gplxScanned?"Đang giữ 1 hồ sơ tạm":"Chưa có hồ sơ tạm";$("#scanCccd").classList.toggle("done",draft.cccdScanned);$("#scanGplx").classList.toggle("done",draft.gplxScanned);$("#saveSheet").disabled=!(draft.cccdScanned&&draft.gplxScanned)}
function splitAddress(address){
  const value=(address||"").trim().replace(/\s+/g," ");
  const match=value.match(/(?:^|,\s*)(Xã|Phường|Thị trấn)\s+/i);
  if(!match)return{detail:value,administrative:""};
  const start=match.index+(match[0].startsWith(",")?2:0);
  return{detail:value.slice(0,match.index).replace(/,\s*$/,"").trim(),administrative:value.slice(start).trim()};
}
// Sau này thay hàm này bằng bảng chuyển địa chỉ sau sáp nhập và mã ĐVHC SQL Server.
function mapAdministrativeCode(administrativeText){return administrativeText}
function parseCccd(raw){
  const p=raw.split("|").map(x=>x.trim());
  if(p.length<6)throw Error("QR CCCD không đúng cấu trúc");
  const address=splitAddress(p[5]);
  return{SoCMT:p[0],HoVaTen:p[2],NgaySinh:formatDate(p[3]),GioiTinh:p[4],ChiTiet_TT:address.detail,MaDVHC_TT:mapAdministrativeCode(address.administrative),ChiTiet_CT:address.detail,MaDVHC_CT:mapAdministrativeCode(address.administrative),NgayCapCMT:formatDate(p[6]||""),NoiCapCMT:"Cục Cảnh sát QLHC về TTXH"};
}
function parseGplx(raw){
  const p=raw.split(/[|;]/).map(x=>x.trim()).filter(Boolean);
  const dates=p.map(onlyDigits).filter(x=>/^\d{8}$/.test(x)).map(formatDate);
  const hang=(raw.match(/(?:^|[|;,\s])(A1|A2|A3|A4|B1|B2|B|C1|C|D1|D2|D|BE|CE|DE|FB2|FC|FD|FE)(?=$|[|;,\s])/i)||[])[1]||"";
  const candidates=p.map(onlyDigits).filter(x=>x.length>=10&&x.length<=12&&!/^\d{8}$/.test(x)&&x!==onlyDigits(draft.record.SoCMT));
  return{SoGPLXDaCo:candidates[0]||"",HangGPLXDaCo:hang.toUpperCase(),NgayTTGPLXDaCo:dates[0]||"",NgayCapGPLXDaCo:dates[1]||dates[0]||"",DVCapGPLXDaCo:""};
}
function finish(raw){try{navigator.vibrate?.(120);Object.assign(draft.record,scanType==="cccd"?parseCccd(raw):parseGplx(raw));draft[scanType==="cccd"?"cccdScanned":"gplxScanned"]=true;saveDraft();closeCamera();show("Đã quét và lưu tạm "+scanType.toUpperCase(),"ok")}catch(e){scanLocked=false;show(e.message,"error")}}
function markQrDetected(result){
  if(scanLocked)return;
  scanLocked=true;
  scanner?.pause();
  navigator.vibrate?.([70,40,120]);
  const target=document.querySelector(".target");
  target.style.borderColor="#2dff9b";
  target.style.boxShadow="0 0 0 999px #0007,0 0 24px #2dff9b";
  const notice=document.createElement("strong");
  notice.id="qrDetectedNotice";
  notice.textContent="✓ ĐÃ NHẬN QR";
  Object.assign(notice.style,{position:"absolute",left:"50%",top:"50%",transform:"translate(-50%,-50%)",background:"#087b5d",color:"#fff",padding:"10px 16px",borderRadius:"999px",fontSize:"13px",whiteSpace:"nowrap",boxShadow:"0 5px 20px #0008"});
  target.appendChild(notice);
  setTimeout(()=>finish(result.data),650);
}
async function openCamera(type){
  scanType=type;flashOn=false;scanLocked=false;
  const target=document.querySelector(".target");target.style.borderColor="";target.style.boxShadow="";$("#qrDetectedNotice")?.remove();
  $("#toggleFlash").textContent="Bật đèn";$("#cameraTitle").textContent="Quét QR "+type.toUpperCase();panel.classList.remove("hidden");document.body.style.overflow="hidden";
  scanner=new QrScanner(video,r=>markQrDetected(r),{
    preferredCamera:"environment",maxScansPerSecond:15,returnDetailedScanResult:true,onDecodeError:()=>{},
    highlightScanRegion:true,highlightCodeOutline:true,
    calculateScanRegion:v=>{
      const size=Math.round(Math.min(v.videoWidth,v.videoHeight)*0.82);
      return{x:Math.round((v.videoWidth-size)/2),y:Math.round((v.videoHeight-size)/2),width:size,height:size,downScaledWidth:600,downScaledHeight:600};
    }
  });
  scanner.setInversionMode("both");
  try{
    await scanner.start();
    const track=video.srcObject?.getVideoTracks?.()[0];
    track?.applyConstraints?.({width:{ideal:1920},height:{ideal:1080},advanced:[{focusMode:"continuous"}]}).catch(()=>{});
    const hasFlash=await scanner.hasFlash();$("#toggleFlash").style.display=hasFlash?"block":"none";
  }catch{show("Không mở được camera. Hãy cấp quyền hoặc chọn ảnh.","error");closeCamera()}
}
function closeCamera(){scanner?.stop();scanner?.destroy();scanner=null;flashOn=false;scanLocked=false;panel.classList.add("hidden");document.body.style.overflow=""}
function show(text,kind=""){$("#message").textContent=text;$("#message").className=kind}
$("#scanCccd").onclick=()=>openCamera("cccd");$("#scanGplx").onclick=()=>openCamera("gplx");$("#review").onclick=()=>$("#reviewPanel").scrollIntoView({behavior:"smooth"});$("#closeCamera").onclick=closeCamera;
$("#toggleFlash").onclick=async()=>{if(!scanner)return;try{flashOn=!flashOn;flashOn?await scanner.turnFlashOn():await scanner.turnFlashOff();$("#toggleFlash").textContent=flashOn?"Tắt đèn":"Bật đèn"}catch{show("Điện thoại không hỗ trợ bật đèn từ trình duyệt.","error")}};
$("#imageInput").onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const r=await QrScanner.scanImage(file,{returnDetailedScanResult:true});finish(r.data)}catch{show("Không tìm thấy mã QR rõ nét trong ảnh.","error")}e.target.value=""};
form.oninput=e=>{if(e.target.name){draft.record[e.target.name]=e.target.value;saveDraft()}};
$("#clearDraft").onclick=()=>{if(confirm("Xóa toàn bộ hồ sơ đang giữ tạm?")){draft={record:emptyRecord(),cccdScanned:false,gplxScanned:false};localStorage.removeItem("hoso-nhap");render()}};
$("#saveSheet").onclick=async()=>{if(!GOOGLE_SCRIPT_URL)return show("Chưa cấu hình GOOGLE_SCRIPT_URL trong config.js.","error");$("#saveSheet").disabled=true;show("Đang ghi Google Sheets...");const payload={...draft.record,ClientRecordId:crypto.randomUUID(),CreatedAt:new Date().toISOString()};try{await fetch(GOOGLE_SCRIPT_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain"},body:JSON.stringify(payload)});localStorage.removeItem("hoso-nhap");draft={record:emptyRecord(),cccdScanned:false,gplxScanned:false};render();show("Đã gửi bản ghi. Kiểm tra Google Sheets để xác nhận.","ok")}catch{show("Không gửi được. Hồ sơ tạm vẫn được giữ lại.","error");$("#saveSheet").disabled=false}};
render();
