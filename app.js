import QrScanner from "https://cdn.jsdelivr.net/npm/qr-scanner@1.4.2/qr-scanner.min.js";
import { GOOGLE_SCRIPT_URL } from "./config.js";

const FIELDS=["HoVaTen","NgaySinh","GioiTinh","SoCMT","NgayCapCMT","NoiCapCMT","MaDVHC_TT","ChiTiet_TT","MaDVHC_CT","ChiTiet_CT","SoGPLXDaCo","HangGPLXDaCo","NgayTTGPLXDaCo","NgayCapGPLXDaCo","DVCapGPLXDaCo","GhiChu"];
const emptyRecord=()=>Object.fromEntries(FIELDS.map(x=>[x,""]));
let draft=JSON.parse(localStorage.getItem("hoso-nhap")||"null")||{record:emptyRecord(),cccdScanned:false,gplxScanned:false};
let scanType="cccd",scanner=null;
const form=document.querySelector("#recordForm"),video=document.querySelector("#camera"),panel=document.querySelector("#cameraPanel");
const $=s=>document.querySelector(s);
const formatDate=v=>/^\d{8}$/.test(v)?`${v.slice(0,2)}/${v.slice(2,4)}/${v.slice(4)}`:v;
const onlyDigits=v=>(v||"").replace(/\D/g,"");
function saveDraft(){localStorage.setItem("hoso-nhap",JSON.stringify(draft));render()}
function render(){FIELDS.forEach(k=>form.elements[k].value=draft.record[k]||"");$("#cccdState").textContent=draft.cccdScanned?"Đã lưu tạm":"Chưa quét";$("#gplxState").textContent=draft.gplxScanned?"Đã lưu tạm":"Chưa quét";$("#draftStatus").textContent=draft.cccdScanned||draft.gplxScanned?"Đang giữ 1 hồ sơ tạm":"Chưa có hồ sơ tạm";$("#scanCccd").classList.toggle("done",draft.cccdScanned);$("#scanGplx").classList.toggle("done",draft.gplxScanned);$("#saveSheet").disabled=!(draft.cccdScanned&&draft.gplxScanned)}
function parseCccd(raw){const p=raw.split("|").map(x=>x.trim());if(p.length<6)throw Error("QR CCCD không đúng cấu trúc");return{SoCMT:p[0],HoVaTen:p[2],NgaySinh:formatDate(p[3]),GioiTinh:p[4],ChiTiet_TT:p[5],ChiTiet_CT:p[5],NgayCapCMT:formatDate(p[6]||""),NoiCapCMT:"Cục Cảnh sát QLHC về TTXH"}}
function parseGplx(raw){const p=raw.split("|").map(x=>x.trim()),dates=p.filter(x=>/^\d{8}$/.test(onlyDigits(x))).map(x=>formatDate(onlyDigits(x)));const hang=(raw.match(/\b(A1|A2|A3|A4|B1|B2|C1|C|D1|D2|D|BE|CE|DE|FB2|FC|FD|FE)\b/i)||[])[0]||"";const numbers=p.map(onlyDigits).filter(x=>x.length>=10&&x.length<=12);return{SoGPLXDaCo:numbers[0]||p[0]||"",HangGPLXDaCo:hang.toUpperCase(),NgayTTGPLXDaCo:dates[0]||"",NgayCapGPLXDaCo:dates[1]||dates[0]||"",DVCapGPLXDaCo:"",GhiChu:"QR GPLX: "+raw}}
function finish(raw){try{Object.assign(draft.record,scanType==="cccd"?parseCccd(raw):parseGplx(raw));draft[scanType==="cccd"?"cccdScanned":"gplxScanned"]=true;saveDraft();closeCamera();show("Đã quét và lưu tạm "+scanType.toUpperCase(),"ok")}catch(e){show(e.message,"error")}}
async function openCamera(type){scanType=type;$("#cameraTitle").textContent="Quét QR "+type.toUpperCase();panel.classList.remove("hidden");scanner=new QrScanner(video,r=>finish(r.data),{preferredCamera:"environment",highlightScanRegion:false,maxScansPerSecond:12,returnDetailedScanResult:true});try{await scanner.start()}catch{show("Không mở được camera. Hãy cấp quyền hoặc chọn ảnh.","error")}}
function closeCamera(){scanner?.stop();scanner?.destroy();scanner=null;panel.classList.add("hidden")}
function show(text,kind=""){$("#message").textContent=text;$("#message").className=kind}
$("#scanCccd").onclick=()=>openCamera("cccd");$("#scanGplx").onclick=()=>openCamera("gplx");$("#review").onclick=()=>$("#reviewPanel").scrollIntoView({behavior:"smooth"});$("#closeCamera").onclick=closeCamera;
$("#imageInput").onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const r=await QrScanner.scanImage(file,{returnDetailedScanResult:true});finish(r.data)}catch{show("Không tìm thấy mã QR rõ nét trong ảnh.","error")}e.target.value=""};
form.oninput=e=>{if(e.target.name){draft.record[e.target.name]=e.target.value;saveDraft()}};
$("#clearDraft").onclick=()=>{if(confirm("Xóa toàn bộ hồ sơ đang giữ tạm?")){draft={record:emptyRecord(),cccdScanned:false,gplxScanned:false};localStorage.removeItem("hoso-nhap");render()}};
$("#saveSheet").onclick=async()=>{if(!GOOGLE_SCRIPT_URL)return show("Chưa cấu hình GOOGLE_SCRIPT_URL trong config.js.","error");$("#saveSheet").disabled=true;show("Đang ghi Google Sheets...");const payload={...draft.record,ClientRecordId:crypto.randomUUID(),CreatedAt:new Date().toISOString()};try{await fetch(GOOGLE_SCRIPT_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain"},body:JSON.stringify(payload)});localStorage.removeItem("hoso-nhap");draft={record:emptyRecord(),cccdScanned:false,gplxScanned:false};render();show("Đã gửi bản ghi. Kiểm tra Google Sheets để xác nhận.","ok")}catch{show("Không gửi được. Hồ sơ tạm vẫn được giữ lại.","error");$("#saveSheet").disabled=false}};
render();
