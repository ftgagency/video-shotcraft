# ShotCraft Workbench — bản demo tĩnh

Đây là bản build web tĩnh từ workbench gốc, phục vụ tại `/<tên-repository>/` trên GitHub Pages (repo fork `video-shotcraft` dùng `/video-shotcraft/`). Build dùng `workbench/dist/` làm thư mục đầu ra.

## Build tại máy

```bash
cd workbench
npm ci
npm run build:demo
```

Lệnh `build:demo` tạo bản sản xuất với base path `/video-shotcraft/`, bỏ API render khỏi Vite build và tắt nút xuất MP4. Mở thử sau khi build bằng `npm run preview`.

## GitHub Pages

Fork dùng workflow **Deploy static workbench demo**: chạy tự động khi có thay đổi trong `workbench/` trên `main`, hoặc chạy thủ công từ tab Actions. Workflow build thư mục `workbench/dist/` và gửi lên GitHub Pages. Trong **Settings → Pages**, đặt source thành **GitHub Actions**. Workflow gallery hiện có của upstream được giữ cho kho gốc; ở fork nó không được phép thay thế bản workbench bằng gallery.

## Phạm vi và lưu trữ

- Có thể thử preview trực tiếp, timeline nhiều track, kéo thả/thay đổi clip và thuộc tính, undo/redo, nhập/xuất project JSON.
- Các thay đổi tự lưu vào `localStorage` của trình duyệt trên thiết bị hiện tại. Tải JSON để sao lưu hoặc chuyển dự án sang trình duyệt khác.
- Đây là prototype giao diện/chỉnh sửa phía trình duyệt: không tải video lên dịch vụ, không gọi API render hay API trả phí và **không xuất MP4**. Render MP4 cần backend mà bản demo miễn phí này không triển khai.
- Project JSON chỉ lưu dữ liệu dự án; tệp video cá nhân không được nhúng vào JSON hoặc lưu lên máy chủ.

Dự án giữ giấy phép và ghi nhận tác giả hiện có trong kho.
