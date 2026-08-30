# Web quét CCCD + GPLX → Google Sheets

Luồng nghiệp vụ:

1. Quét QR CCCD và lưu hồ sơ tạm trong `localStorage` của điện thoại.
2. Quét QR GPLX và ghép vào cùng hồ sơ tạm.
3. Người dùng kiểm tra/sửa đủ 16 trường.
4. Chỉ khi bấm **Xác nhận và lưu Google Sheets**, web mới gửi một dòng.

## 1. Chạy thử trên máy tính

Không mở trực tiếp bằng cách nhấp `index.html`. Tại thư mục dự án chạy:

```bash
python -m http.server 5500
```

Sau đó mở `http://localhost:5500`. Camera điện thoại chỉ hoạt động khi web chạy bằng HTTPS.

## 2. Tạo Google Sheet

1. Tạo một Google Sheet trống.
2. Chọn **Extensions → Apps Script**.
3. Xóa code mặc định, dán toàn bộ file `google-apps-script/Code.gs`.
4. Chọn **Deploy → New deployment → Web app**.
5. Execute as: **Me**.
6. Who has access: **Anyone**.
7. Bấm Deploy và sao chép URL kết thúc bằng `/exec`.
8. Mở `config.js`, dán URL vào `GOOGLE_SCRIPT_URL`.

Google Apps Script tự tạo sheet `DATA` và đúng thứ tự cột. Mọi giá trị đều được ghi dạng văn bản nên số CCCD/GPLX hoặc mã có số 0 đầu không bị Excel/Sheets làm mất.

## 3. Đưa lên GitHub Pages

1. Tạo repository mới trên GitHub.
2. Upload toàn bộ file/thư mục của dự án lên repository.
3. Vào **Settings → Pages**.
4. Source chọn **Deploy from a branch**.
5. Branch chọn **main**, thư mục **/(root)**, bấm Save.
6. Sau vài phút GitHub cung cấp URL HTTPS. Mở URL đó trên Safari iOS hoặc Chrome Android.

## Các chỗ sẽ chỉnh tiếp

- `parseCccd(raw)`: tách QR CCCD.
- `parseGplx(raw)`: tách QR GPLX. Cần một chuỗi QR GPLX thực tế đã che thông tin nhạy cảm để chốt đúng vị trí trường.
- Mapping địa chỉ → `MaDVHC_TT`, `MaDVHC_CT`: cần bảng danh mục đơn vị hành chính đang dùng trong SQL Server.
- `HEADERS` trong `Code.gs`: thứ tự cột Google Sheet.

## Lưu ý dữ liệu

- Hồ sơ nháp nằm trên chính điện thoại cho đến khi xác nhận.
- Không lưu hình ảnh CCCD/GPLX.
- Xóa hồ sơ tạm sau khi gửi thành công.
- Khi dùng thật nên giới hạn người sử dụng và bổ sung cơ chế xác thực thay vì để Web App công khai hoàn toàn.
