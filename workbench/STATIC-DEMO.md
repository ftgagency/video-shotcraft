# ShotCraft Workbench — BẢN WEB TĨNH

Bản web từ Motion Workbench, phục vụ tại `/video-shotcraft/` trên GitHub Pages. Không triển khai VPS, backend render hay API trả phí.

## BUILD TẠI MÁY

```bash
cd workbench
npm ci
npm run build:demo
npm run test:browser-join
```

`build:demo` tạo `workbench/dist/` với base path `/video-shotcraft/`. API render Remotion của chế độ dev không được đưa vào bản tĩnh.

## GHÉP VIDEO VÀ XUẤT MP4

Trong tab **Media**, nhập video trên thiết bị, rồi đưa các clip lần lượt lên timeline. Bấm **Join · MP4**, kiểm tra danh sách clip, rồi **Create MP4** để tải kết quả về.

Công cụ ghép các clip video đang hiển thị theo vị trí timeline, áp dụng trim đầu và thời lượng, fit contain/cover, opacity, scale, vị trí và mức âm thanh gốc. Khoảng trống được loại bỏ. Clip chồng nhau hoặc tốc độ khác 1× sẽ được báo lỗi thay vì xuất sai.

Đây là phần **ghép video**, không phải bộ render toàn bộ composition: tiêu đề, ảnh, hiệu ứng, animation và các track âm thanh riêng không được đưa vào MP4. Hộp thoại có cảnh báo khi các lớp khác tồn tại.

MP4 dùng H.264 và AAC. Video encoding cần trình duyệt hỗ trợ WebCodecs H.264; nếu trình duyệt thiếu AAC encoder, app tự nạp AAC encoder dự phòng chạy trên thiết bị. Nên dùng bản Chrome, Edge hoặc Safari mới. Nếu âm thanh một clip không giải mã được, app báo rõ sau khi xuất.

## LƯU TRỮ VÀ GIỚI HẠN

Video local lưu trong IndexedDB của trình duyệt hiện tại và không tải lên máy chủ. Xóa dữ liệu website sẽ xóa các video đó. Dự án tự lưu trong localStorage và hỗ trợ nhập/xuất JSON; JSON chỉ chứa tham chiếu media, không chứa file video nên không tự chuyển được video sang thiết bị khác.

Quá trình xuất dùng CPU/GPU và RAM của thiết bị. Video dài hoặc độ phân giải cao có thể chậm hoặc hết bộ nhớ, đặc biệt trên điện thoại. Giữ tab mở trong lúc xuất.

## TRIỂN KHAI GITHUB PAGES

Workflow **Deploy static workbench demo** chạy khi `workbench/` thay đổi trên nhánh `main`, build rồi gửi `workbench/dist/` lên GitHub Pages. Source của Pages là **GitHub Actions**. Gallery upstream được giữ riêng, không thay thế Workbench ở fork này.

## THƯ VIỆN VÀ GIẤY PHÉP

Giữ giấy phép và ghi nhận tác giả hiện có. Browser export dùng [Mediabunny](https://github.com/Vanilagy/mediabunny) và [AAC encoder extension](https://mediabunny.dev/guide/extensions/aac-encoder), bản 1.65.2, MPL-2.0. AAC fallback chứa FFmpeg AAC encoder build LGPL-2.1-or-later không bật GPL/nonfree; nguồn, build instructions và thông báo giấy phép được phân phối trong `public/third-party/` và trên website tại `third-party/NOTICE.txt`.
