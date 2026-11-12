# ShotCraft Workbench — BẢN WEB TĨNH

Bản web từ Motion Workbench, phục vụ tại `/video-shotcraft/` trên GitHub Pages. Không triển khai VPS, backend render hay API trả phí.

## BUILD TẠI MÁY

```bash
cd workbench
npm ci
npm run build:demo
npm run test:browser-export
```

`build:demo` tạo `workbench/dist/` với base path `/video-shotcraft/`. API render Remotion của chế độ dev không được đưa vào bản tĩnh.

## DỰNG TIMELINE VÀ XUẤT MP4

Trong tab **Media**, nhập video hoặc audio trên thiết bị; tệp được lưu vào IndexedDB của trình duyệt. Kéo clip lên timeline hoặc dùng nút thêm tại playhead. Dùng các lớp video, audio, chữ/tiêu đề, phụ đề, ảnh trong project và các layer khác; chỉnh vị trí, thời lượng, trim, tốc độ, âm lượng, opacity, scale và offset trên Inspector/timeline. Bấm **Export · MP4** để xem phần tóm tắt, rồi **Create MP4**.

Renderer giữ vị trí thời gian tuyệt đối (khoảng trống và clip chồng nhau), thứ tự layer, trim, tốc độ và audio timeline. MP4 gồm H.264 video và AAC stereo audio; âm thanh gốc của clip video và audio track riêng được trộn theo thời điểm/âm lượng. Nền và các card browser-render hỗ trợ gồm `video-clip`, `image-clip`, `audio-clip`, `text-basic`, `inkpress-title-card`, `inkpress-caption`, `inkpress-flash-cut`, `bg-paper`, `bg-paper-glow`, `bg-white` và `bg-ink`.

Thư viện Motion còn nhiều animation/demo React phức tạp chưa có renderer Canvas tương ứng. Nếu có layer như vậy đang hiển thị, preflight sẽ nêu card ID và khóa export cho đến khi ẩn/xóa layer; app không âm thầm xuất thiếu. Ảnh local chưa có bước import riêng (image card hiện dùng asset của project/public); không hỗ trợ chroma key, keyframe đầy đủ, effect chain tổng quát hay codec tùy chọn. Demo mặc định đã đổi sang các card browser-export hỗ trợ; nút **Reset demo** thay thế project hiện tại.

Quá trình encoding dùng `VideoEncoder` WebCodecs cho H.264; AAC dùng encoder trình duyệt hoặc fallback WebAssembly trên chính thiết bị. E2E đã kiểm thử bằng Chromium desktop 156 với H.264/AAC và WAV input. Yêu cầu trình duyệt có profile H.264 WebCodecs tương thích và Web Audio; các phiên bản Safari, Edge, Firefox và thiết bị di động chưa được kiểm thử trong E2E. Nếu thiết bị không hỗ trợ cấu hình đó, app báo lỗi thay vì tạo MP4 giả.

## LƯU TRỮ VÀ GIỚI HẠN

Video và audio local lưu trong IndexedDB của trình duyệt hiện tại; không tải lên server. Xóa dữ liệu website sẽ xóa media. Dự án tự lưu trong localStorage và hỗ trợ nhập/xuất JSON; JSON chỉ chứa tham chiếu media, không gói file. Vì output được tạo trong RAM và Canvas, clip dài, 4K hoặc nhiều layer có thể chậm hay hết bộ nhớ; giữ tab mở và dùng footage ngắn/độ phân giải thấp hơn khi cần.

Tệp media được xử lý cục bộ trong tab; xuất MP4 không gọi backend, VPS hoặc dịch vụ render trả phí. Browser export không ghi project edits ngược vào source media.

## TRIỂN KHAI GITHUB PAGES

Workflow **Deploy static workbench demo** chạy khi `workbench/` thay đổi trên nhánh `main`, build rồi gửi `workbench/dist/` lên GitHub Pages. Source của Pages là **GitHub Actions**. Gallery upstream được giữ riêng, không thay thế Workbench ở fork này.

## THƯ VIỆN VÀ GIẤY PHÉP

Giữ giấy phép và ghi nhận tác giả hiện có. Browser export dùng [Mediabunny](https://github.com/Vanilagy/mediabunny) và [AAC encoder extension](https://mediabunny.dev/guide/extensions/aac-encoder), bản 1.65.2, MPL-2.0. AAC fallback chứa FFmpeg AAC encoder build LGPL-2.1-or-later không bật GPL/nonfree; nguồn, build instructions và thông báo giấy phép được phân phối trong `public/third-party/` và trên website tại `third-party/NOTICE.txt`.
