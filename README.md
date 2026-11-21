# ROAB LAB — Mượn thiết bị, quản lý số lượng và lịch dùng tại lab

Website Vue trong `index.html`, backend Google Apps Script trong `Code.gs`, dữ liệu trong Google Sheets. Không cần chuyển nền tảng hoặc cài thêm thư viện để vận hành.

## Chức năng

Mỗi loại/mã thiết bị có hai cấu hình độc lập:

| Cách sử dụng | Cách quản lý | Áp dụng |
| --- | --- | --- |
| Mượn mang đi | Từng chiếc có mã riêng | Kit, cảm biến, thiết bị cần truy vết từng chiếc; giữ luồng mượn–trả và ảnh kiểm định hiện có |
| Mượn mang đi | Số lượng chung | Động cơ, module cùng model; nhiều người mượn cùng lúc và trả từng phần |
| Đăng ký tại lab | Từng chiếc có mã riêng | Robot, máy cố định; một lịch đã duyệt tại mỗi thời điểm |
| Đăng ký tại lab | Số lượng chung | Nhiều bộ thí nghiệm giống nhau; lịch đăng ký có số lượng |

Hai model khác nhau phải có hai mã danh mục. Thiết bị theo từng chiếc có tổng bằng 1; nếu có ba robot cần theo dõi riêng thì tạo ba mã. Bản này không gộp nhiều số serial trong cùng một dòng danh mục.

## Cập nhật hệ thống đang dùng

1. Tạo bản sao Google Spreadsheet hiện tại và lưu phiên bản Apps Script đang chạy để có điểm khôi phục.
2. Mở **Extensions → Apps Script** từ Spreadsheet đúng của lab. Thay nội dung `Code.gs` bằng file trong gói này. Giữ cấu hình Drive/Telegram thực tế của lab trong môi trường của bạn; không đưa thông tin bí mật vào Git.
3. Chạy hàm **`upgradeInventorySchema`** từ trình soạn thảo Apps Script. Hàm này bổ sung cấu trúc, giữ nguyên dữ liệu cũ. Có thể chạy lại. Nếu thấy báo xung đột cột, xử lý cột riêng đang chiếm N–V trước; không đổi tên hoặc xóa dữ liệu một cách tùy ý.
4. Cập nhật **deployment Web App hiện có** sang phiên bản Apps Script mới để giữ URL `/exec`. Theo [hướng dẫn quản lý deployment của Google](https://developers.google.com/apps-script/concepts/deployments), việc lưu mã chưa tự cập nhật phiên bản Web App đang phát hành.
5. Phát hành `index.html` mới tới website ROAB LAB hiện có. Nếu tạo deployment mới làm thay đổi URL, cấu hình lại URL trong trang và kiểm tra đúng Spreadsheet.
6. Đăng xuất rồi đăng nhập lại tài khoản cán bộ. Trang mới dùng phiên cán bộ do backend cấp; tên/vai trò cũ lưu trong trình duyệt không cấp quyền ghi dữ liệu.
7. Mở **Sửa thiết bị → Cách sử dụng & số lượng** để cấu hình từng thiết bị. Dữ liệu cũ mặc định **Mượn mang đi / Từng chiếc / Tổng 1**.

Ngoài cách chạy hàm trực tiếp ở bước 3, sau khi Web App đã cập nhật backend, Admin có thể bấm **Nâng cấp dữ liệu** trong website. Inspector không được nâng cấp schema.

Với Spreadsheet mới hoàn toàn, chạy **`initialSetup`**. Hàm chỉ tạo sheet trống, không thêm tài khoản, mật khẩu hoặc thiết bị mẫu. Tạo tài khoản thật trong `Users`: A mã người dùng, B mật khẩu cán bộ, C họ tên, D điện thoại, E vai trò `ADMIN`/`INSPECTOR`/`STUDENT`, F khóa. Không xóa tài khoản vẫn còn phiếu mượn chưa hoàn trả.

## Mượn và trả theo số lượng

1. Nhập MSSV đã được cấp phép như luồng hiện tại.
2. Tìm động cơ/module, bấm **Mượn số lượng**, nhập số lượng và mục đích.
3. Vào **Lịch sử dụng & phiếu mượn → Phiếu mượn số lượng** để xem từng phiếu. Có bộ lọc theo người dùng và thiết bị.
4. Bấm **Trả thiết bị** ở đúng phiếu. Có thể trả 1 chiếc trước và trả phần còn lại vào lần khác. Số đã trả không còn tính vào số người đó đang giữ, nhưng chưa được cho mượn lại khi chưa kiểm định.
5. Cán bộ vào **Kiểm định số lượng**: đạt thì nhập lại kho, không đạt thì cách ly. Khi sửa xong, ghi chú rồi xác nhận nhập lại kho.

Ví dụ tổng 20, đang mượn 7, chờ kiểm định 2, cách ly 1, bảo trì riêng 0 thì còn cho mượn 10. Công thức:

`Có thể mượn = Tổng − Còn giữ theo các phiếu − Chờ kiểm định − Cách ly − Bảo trì riêng`

Các số đang mượn/chờ kiểm định/cách ly được tính từ phiếu, không sửa bằng một ô đếm thủ công. Nếu hoàn trả có cả đồ tốt và hỏng, lập các lần trả riêng theo tình trạng. Kiểm định/sửa chữa áp dụng cho toàn bộ số lượng của một lần trả.

## Đăng ký robot và thiết bị cố định

1. Bấm **Xem lịch / Đăng ký** trên thiết bị hoặc vào **Lịch sử dụng**, chọn thiết bị.
2. Xem lịch tuần. Chọn giờ bắt đầu, kết thúc, số lượng, mục đích và nhóm sử dụng. Ngày giờ nhập luôn được hiểu theo Việt Nam, kể cả máy tính đặt múi giờ khác.
3. Lịch mới có trạng thái **Chờ duyệt**, chưa giữ chỗ. Cán bộ chọn lịch và bấm **Duyệt lịch**. Máy chủ kiểm tra sức chứa lần nữa trong cùng khóa ghi.
4. Khi đến lab, chủ lịch hoặc cán bộ bấm **Bắt đầu sử dụng** trong khung giờ đã duyệt. Cuối buổi bấm **Kết thúc sử dụng**, khai báo tình trạng.
5. Cán bộ có thể từ chối, hủy, đánh dấu không đến sau giờ kết thúc hoặc chặn một phần/toàn bộ số lượng cho lớp học và bảo trì theo lịch.

Luồng: **Chờ duyệt → Đã duyệt → Đang sử dụng → Hoàn thành**. Nhánh khác gồm **Từ chối**, **Đã hủy**, **Không đến**, **Báo lỗi · Đang cách ly**.

Quy tắc vận hành:

- Mỗi lịch trong một ngày, trong giờ mở cửa, không quá thời lượng tối đa; đăng ký trước tối đa 1 năm. Khung giờ kết thúc là đầu mở: 09–10 giờ và 10–11 giờ có thể nối tiếp nếu thời gian nghỉ là 0.
- Sức chứa tính theo lượng dùng đồng thời cao nhất trong toàn bộ khoảng chọn, không cộng nhầm các lịch chỉ nối tiếp nhau. Thời gian nghỉ sau buổi được tính khi kiểm tra trùng.
- Buổi đang dùng quá giờ chưa kết thúc tiếp tục giữ số lượng; không tự đánh dấu đã bàn giao. Cán bộ cần kiểm tra thực tế, kết thúc hoặc xử lý sự cố trước khi cho nhóm sau bắt đầu.
- Kết thúc báo hỏng sẽ cách ly toàn bộ số lượng trong buổi đó. Cán bộ xác nhận sửa xong mới giải phóng số lượng. Lịch tương lai có thể cần hủy và đặt lại nếu sự cố làm thiếu sức chứa.
- **Bảo trì toàn bộ / Khóa sử dụng** ngăn lịch mới và bắt đầu sử dụng. Số bảo trì riêng giảm sức chứa. Các lịch đã duyệt vẫn hiển thị để cán bộ chủ động xử lý.
- Danh sách **Cần xử lý** đưa cả lịch chờ duyệt, đang dùng, quá giờ và cách ly ngoài tuần đang xem lên để tránh bỏ sót.

## Dữ liệu và tương thích

Giữ nguyên cột A–M của `Devices`, `Users` và `Logs`. Thêm vào `Devices`:

| Cột | Tên | Mặc định |
| --- | --- | --- |
| N | `usage_mode` | `portable` (`lab` cho lịch tại lab) |
| O | `tracking_mode` | `individual` (`quantity` cho kho chung) |
| P | `total_quantity` | 1 |
| Q | `unavailable_quantity` | 0, bảo trì riêng |
| R | `service_status` | `ready`; tùy chọn `maintenance`, `locked` |
| S | `open_hour` | 08:00 |
| T | `close_hour` | 18:00 |
| U | `max_minutes` | 240 |
| V | `buffer_minutes` | 0 |

Các sheet mới do hàm nâng cấp tạo đúng tiêu đề:

- **Loans**: một dòng mỗi phiếu mượn số lượng; số còn giữ bằng số mượn trừ tổng các phiếu trả của chính phiếu đó.
- **Returns**: một dòng mỗi lần trả, cùng kết luận kiểm định và thông tin sửa chữa.
- **Bookings**: lịch dự kiến, trạng thái, người duyệt, thời điểm sử dụng thực tế và kết luận kết thúc.

API GET bổ sung `schema_version`, `loans`, `quantity_returns`, `bookings`, cấu hình thiết bị và `stock`. API không trả token hoặc dấu kiểm tra nội dung yêu cầu. Các thao tác mới dùng `inventory_borrow`, `inventory_return`, `inventory_audit_return`, `inventory_repair_return`, `booking_create`, `booking_block`, `booking_update`, `admin_upgrade_schema`.

Không đổi cách quản lý của thiết bị đang mượn/chờ kiểm định hoặc đã có lịch sử phiếu số lượng/lịch. Tạo mã mới nếu cần chuyển mô hình sau khi đã phát sinh lịch sử. Không xóa loại thiết bị có lịch sử mới; dùng khóa sử dụng để ngừng tiếp nhận. Backend từ chối giảm số lượng làm âm kho hoặc không đủ cho lịch đã duyệt.

Các thao tác ghi dùng [Script Lock](https://developers.google.com/apps-script/reference/lock/lock-service) của cùng dự án Apps Script. Không dùng hai dự án Apps Script độc lập để ghi cùng Spreadsheet, và không sửa số liệu phiếu trực tiếp trong Sheets khi hệ thống đang hoạt động.

Phiếu mới có mã yêu cầu và dấu kiểm tra nội dung để gửi lại an toàn khi mất phản hồi. Trình duyệt giữ cùng mã khi gửi lại; không đóng phiếu rồi tạo phiếu mới nếu chưa kiểm tra kết quả. Bản này vẫn giữ cơ chế sinh viên nhập MSSV theo whitelist của hệ thống cũ: đây không phải xác thực danh tính bằng mật khẩu hay SSO. Cán bộ dùng token trong `sessionStorage`, không lưu mật khẩu trong trình duyệt; quyền được kiểm tra lại từ `Users`. [Cache của Apps Script có thể hết trước thời hạn](https://developers.google.com/apps-script/reference/cache/cache), khi đó cần đăng nhập lại.

## Kiểm tra mã nguồn

Chạy trong thư mục dự án với Node.js 18 trở lên:

```powershell
rtk node tests/backend-security.cjs
rtk node tests/inventory-booking.cjs
rtk node tests/frontend-live.cjs
rtk node tests/frontend-resources.cjs
rtk node tests/frontend-template.cjs
rtk git diff --check
```

Bốn lệnh đầu dùng môi trường giả lập, không gửi phiếu tới lab thật. Lệnh template tải đúng bản Vue CDN mà website đang khai báo để biên dịch toàn bộ mẫu; không chụp ảnh hoặc kiểm tra hiển thị trên trình duyệt.

Trước khi nhận vận hành, kiểm tra trên bản sao Spreadsheet và Web App thật: hai người mượn số lượng, trả từng phần và kiểm định; hai lịch tranh số lượng cuối; duyệt bằng Admin/Inspector; buổi quá giờ; báo hỏng và sửa; hoạt động trên điện thoại; người không có phiên cán bộ không được duyệt. Chỉ sau đó mới chuyển sang dữ liệu vận hành.

Giới hạn đã xác nhận trong lần triển khai mã nguồn này: kiểm tra tự động chạy cục bộ; chưa cập nhật Apps Script/Sheets/website đang phát hành và chưa xác nhận giao diện trên trình duyệt thực tế vì browser access host không khả dụng. Chưa có thông báo nhắc lịch tự động hoặc lịch lặp.

## Đóng gói

```powershell
rtk python scripts/package-release.py
```

Tạo `dist/roab-lab-inventory-v2.zip` kèm bản kê SHA-256; chỉ gồm mã ROAB LAB, hướng dẫn và kiểm tra liên quan, không gom các dự án khác trong workspace.
