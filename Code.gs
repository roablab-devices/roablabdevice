/**
 * ======================================================================================
 * ROAB LAB - SMART LAB ASSET MANAGER (GOOGLE APPS SCRIPT BACKEND)
 * Hỗ trợ:
 * 1. Quản Trị Viên (Thêm, Bớt/Xóa thiết bị, Sửa thông số & tài liệu, Log chỉnh sửa)
 * 2. Kiểm Định (QA Audit đối soát ảnh song song & phê duyệt/báo vi phạm)
 * 3. Sinh Viên (Zero-Password Whitelist, Chụp ảnh trải phẳng linh kiện nén Drive)
 * ======================================================================================
 */

const CONFIG = {
  FOLDER_ID: "1TBtzA8MVXcOU_eIVXQvy8Rg0wC0apoJv",
  TELEGRAM_BOT_TOKEN: "YOUR_TELEGRAM_BOT_TOKEN_HERE",
  TELEGRAM_CHAT_ID: "-1001234567890",
  SHEET_DEVICES: "Devices",
  SHEET_USERS: "Users",
  SHEET_LOGS: "Logs"
};

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Only application-generated formulas may use setFormula; all other cells are text.
function sheetText(value) {
  const text = String(value == null ? "" : value);
  return /^[\s\u0000-\u001f]*[=+@-]/.test(text) || text.startsWith("'") ? "'" + text : text;
}

function setText(range, value) {
  range.setValue(sheetText(value));
}

function appendTextRow(sheet, values) {
  sheet.appendRow(values.map(sheetText));
}

function setTextMatrix(sheet, startRow, startCol, matrix) {
  const range = sheet.getRange(startRow, startCol, matrix.length, matrix[0].length);
  if (range && typeof range.setValues === 'function') {
    range.setValues(matrix.map(row => row.map(sheetText)));
  } else {
    matrix.forEach((row, ri) => {
      row.forEach((val, ci) => {
        setText(sheet.getRange(startRow + ri, startCol + ci), val);
      });
    });
  }
}

function formatDriveImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  const match = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return 'https://drive.google.com/thumbnail?id=' + match[1] + '&sz=w1200';
  }
  return trimmed;
}

function uploadDeviceFiles(payload) {
  const specs = [['golden_upload', 'golden_image', true], ['document_upload', 'pinout_link', false]];
  const pending = [];
  for (const [key, field, imageOnly] of specs) {
    const upload = payload[key];
    if (!upload) continue;
    let uploadType = String(upload.type || '').toLowerCase().trim();
    if (uploadType === 'image/jpg' || uploadType === 'image/pjpeg') uploadType = 'image/jpeg';
    upload.type = uploadType;
    const allowed = imageOnly ? ['image/jpeg', 'image/png', 'image/webp'] : ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(upload.type) || typeof upload.base64 !== 'string') {
      throw new Error('File không hợp lệ. Chỉ nhận JPG, PNG, WebP hoặc PDF, tối đa 5 MB/file.');
    }
    const cleanBase64 = upload.base64.replace(/\s+/g, '');
    if (cleanBase64.length > 6990508 || !/^[A-Za-z0-9+/]*={0,2}$/.test(cleanBase64)) {
      throw new Error('File không hợp lệ. Chỉ nhận JPG, PNG, WebP hoặc PDF, tối đa 5 MB/file.');
    }
    const bytes = Utilities.base64Decode(cleanBase64);
    if (!bytes || !bytes.length || bytes.length > 5 * 1024 * 1024) {
      throw new Error('Nội dung file không đúng định dạng hoặc vượt 5 MB.');
    }
    const byteAt = index => (bytes[index] & 255);
    const checkSig = (offset, sig) => {
      if (bytes.length < offset + sig.length) return false;
      for (let i = 0; i < sig.length; i++) {
        if (byteAt(offset + i) !== sig[i]) return false;
      }
      return true;
    };
    const valid = upload.type === 'image/jpeg' ? checkSig(0, [255, 216, 255]) :
      upload.type === 'image/png' ? checkSig(0, [137, 80, 78, 71, 13, 10, 26, 10]) :
      upload.type === 'image/webp' ? (checkSig(0, [82, 73, 70, 70]) && checkSig(8, [87, 69, 66, 80])) :
      checkSig(0, [37, 80, 68, 70, 45]);
    if (!valid) throw new Error('Nội dung file không đúng định dạng hoặc vượt 5 MB.');
    const ext = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'}[upload.type];
    pending.push({field, type:upload.type, bytes, ext});
  }
  if (!pending.length) return;
  let folder;
  try {
    if (CONFIG.FOLDER_ID && CONFIG.FOLDER_ID !== 'YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE') {
      folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
    }
  } catch (folderErr) {
    Logger.log("Không thể truy cập FOLDER_ID, fallback về Root: " + folderErr.toString());
  }
  if (!folder) folder = DriveApp.getRootFolder();
  const created = [];
  try {
    for (const entry of pending) {
      const name = String(payload.device_id).replace(/[^a-zA-Z0-9_-]/g, '_') + '_' + entry.field + '_' + Utilities.getUuid() + '.' + entry.ext;
      const file = folder.createFile(Utilities.newBlob(entry.bytes, entry.type, name));
      created.push(file);
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (sharingErr) {
        Logger.log("Không thể setSharing ANYONE_WITH_LINK: " + sharingErr.toString());
      }
      payload[entry.field] = entry.field === 'golden_image' ?
        'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1200' :
        'https://drive.google.com/file/d/' + file.getId() + '/view';
    }
  } catch (error) {
    created.forEach(file => { try { file.setTrashed(true); } catch (_) {} });
    throw error;
  }
}

// Inventory v2. This source is embedded in Code.gs for one-file Apps Script deployment.
const INVENTORY_DEVICE_HEADERS = ['usage_mode', 'tracking_mode', 'total_quantity', 'unavailable_quantity', 'service_status', 'open_hour', 'close_hour', 'max_minutes', 'buffer_minutes'];
const INVENTORY_TABLES = {
  Loans: ['loan_id', 'device_id', 'user_id', 'user_name', 'quantity', 'purpose', 'note', 'created_at', 'request_id', 'request_hash'],
  Returns: ['return_id', 'loan_id', 'device_id', 'user_id', 'user_name', 'quantity', 'condition', 'note', 'created_at', 'audit_status', 'audited_by', 'audit_note', 'audited_at', 'repaired_by', 'repaired_at', 'request_id', 'request_hash'],
  Bookings: ['booking_id', 'device_id', 'user_id', 'user_name', 'quantity', 'start_at', 'end_at', 'purpose', 'note', 'status', 'created_at', 'updated_at', 'reviewed_by', 'review_note', 'actual_start', 'actual_end', 'end_condition', 'request_id', 'kind', 'request_hash', 'transition_request_id', 'transition_hash']
};

function inventoryKey(value) { return String(value || '').trim().toLowerCase(); }
function inventoryText(value, max) {
  const text = String(value == null ? '' : value).trim();
  if (text.length > (max || 2000)) throw new Error('Nội dung quá dài.');
  return text;
}
function inventoryInt(value, min, max) {
  if (value === '' || value == null || typeof value === 'boolean' || !/^\d+$/.test(String(value))) throw new Error('Số lượng/thời lượng phải là số nguyên hợp lệ.');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error('Số lượng/thời lượng nằm ngoài giới hạn cho phép.');
  return number;
}
function inventoryNow() { return new Date().toISOString(); }
function inventoryId(prefix) { return prefix + '-' + Utilities.getUuid(); }
function inventoryDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|\+07:00)$/.test(text)) throw new Error('Thời gian phải kèm múi giờ Việt Nam hoặc UTC.');
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) throw new Error('Ngày giờ không hợp lệ.');
  const localPart = text.replace(/(?:Z|\+07:00)$/, '').slice(0, 16);
  const offset = text.endsWith('Z') ? 0 : 7 * 3600000;
  if (new Date(date.getTime() + offset).toISOString().slice(0, 16) !== localPart) throw new Error('Ngày giờ không tồn tại.');
  return date.toISOString();
}
function inventoryConfig(row) {
  const config = {
    usage_mode: String(row[13] || 'portable'), tracking_mode: String(row[14] || 'individual'),
    total_quantity: row[15] === '' || row[15] == null ? 1 : inventoryInt(row[15], 1, 100000),
    unavailable_quantity: row[16] === '' || row[16] == null ? 0 : inventoryInt(row[16], 0, 100000),
    service_status: String(row[17] || 'ready'), open_hour: String(row[18] || '08:00'), close_hour: String(row[19] || '18:00'),
    max_minutes: row[20] === '' || row[20] == null ? 240 : inventoryInt(row[20], 15, 1440),
    buffer_minutes: row[21] === '' || row[21] == null ? 0 : inventoryInt(row[21], 0, 120)
  };
  if (!['portable', 'lab'].includes(config.usage_mode) || !['individual', 'quantity'].includes(config.tracking_mode) || !['ready', 'maintenance', 'locked'].includes(config.service_status)) throw new Error('Cấu hình thiết bị không hợp lệ.');
  if (config.tracking_mode === 'individual' && config.total_quantity !== 1) throw new Error('Thiết bị có mã riêng phải có số lượng bằng 1.');
  if (config.unavailable_quantity > config.total_quantity) throw new Error('Số lượng bảo trì vượt tổng số lượng.');
  if (![config.open_hour, config.close_hour].every(v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) || config.open_hour >= config.close_hour) throw new Error('Giờ mở cửa phải trước giờ đóng cửa trong cùng ngày.');
  return config;
}
function inventorySchemaReady(ss) {
  const sheet = ss.getSheetByName(CONFIG.SHEET_DEVICES);
  if (!sheet) return false;
  const headers = sheet.getDataRange().getValues()[0] || [];
  return INVENTORY_DEVICE_HEADERS.every((h, i) => headers[13 + i] === h) && Object.keys(INVENTORY_TABLES).every(name => {
    const table = ss.getSheetByName(name);
    const head = table && table.getDataRange().getValues()[0];
    return head && INVENTORY_TABLES[name].every((h, i) => head[i] === h);
  });
}
function upgradeInventorySchema() {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return inventoryUpgrade(SpreadsheetApp.getActiveSpreadsheet()); }
  finally { SpreadsheetApp.flush(); lock.releaseLock(); }
}
function inventoryUpgrade(ss) {
  const sheet = ss.getSheetByName(CONFIG.SHEET_DEVICES);
  if (!sheet) throw new Error('Chạy initialSetup hoặc tạo sheet Devices trước.');
  const rows = sheet.getDataRange().getValues();
  // Preflight every header before writing. Never repurpose existing custom columns.
  INVENTORY_DEVICE_HEADERS.forEach((header, i) => {
    if (rows[0][13 + i] && rows[0][13 + i] !== header) throw new Error('Cột ' + (14 + i) + ' của Devices đang có dữ liệu khác. Sao lưu và chuyển cột đó trước khi nâng cấp.');
  });
  Object.keys(INVENTORY_TABLES).forEach(name => {
    const table = ss.getSheetByName(name);
    if (table && table.getLastRow()) {
      const head = table.getDataRange().getValues()[0];
      if (!INVENTORY_TABLES[name].every((h, i) => head[i] === h)) throw new Error('Sheet ' + name + ' đã tồn tại với cấu trúc khác.');
    }
  });
  rows.slice(1).filter(row => row[0]).forEach(inventoryConfig);
  setTextMatrix(sheet, 1, 14, [INVENTORY_DEVICE_HEADERS]);
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const config = inventoryConfig(rows[i]);
    setTextMatrix(sheet, i + 1, 14, [INVENTORY_DEVICE_HEADERS.map(h => config[h])]);
  }
  Object.keys(INVENTORY_TABLES).forEach(name => {
    let table = ss.getSheetByName(name);
    if (!table) table = ss.insertSheet(name);
    if (!table.getLastRow()) appendTextRow(table, INVENTORY_TABLES[name]);
    if (table.setFrozenRows) table.setFrozenRows(1);
  });
  return {success: true, message: 'Đã nâng cấp số lượng và lịch sử dụng. Dữ liệu mượn cũ được giữ nguyên.'};
}
function inventoryRows(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  const headers = INVENTORY_TABLES[name];
  return sheet.getDataRange().getValues().slice(1).map((row, index) => {
    const record = {_row: index + 2};
    headers.forEach((key, col) => record[key] = row[col] instanceof Date ? row[col].toISOString() : row[col] == null ? '' : String(row[col]));
    return record;
  }).filter(record => record[headers[0]]);
}
function inventoryAppend(ss, table, record) {
  appendTextRow(ss.getSheetByName(table), INVENTORY_TABLES[table].map(key => record[key] == null ? '' : record[key]));
}
function inventoryUpdate(ss, table, record) {
  setTextMatrix(ss.getSheetByName(table), record._row, 1, [INVENTORY_TABLES[table].map(key => record[key] == null ? '' : record[key])]);
}
function inventoryUser(ss, id) {
  const sheet = ss.getSheetByName(CONFIG.SHEET_USERS);
  const users = sheet ? sheet.getDataRange().getValues().slice(1).filter(row => inventoryKey(row[0]) === inventoryKey(id) && inventoryKey(id)) : [];
  if (users.length !== 1) throw new Error('Mã người dùng chưa được cấp phép hoặc bị trùng.');
  return {user_id: String(users[0][0]).trim(), full_name: String(users[0][2] || ''), role: String(users[0][4] || 'STUDENT').toUpperCase()};
}
function inventoryStaff(ss, token, roles) {
  const raw = token && CacheService.getScriptCache().get('session_' + String(token).slice(0, 180));
  if (!raw) throw new Error('Phiên cán bộ đã hết hạn. Vui lòng đăng nhập lại.');
  const session = JSON.parse(raw);
  const user = inventoryUser(ss, session.user_id);
  const version = CacheService.getScriptCache().get('auth_version_' + inventoryKey(user.user_id)) || '0';
  if (session.version !== version || session.credential !== inventoryCredential(ss, user.user_id) || !roles.includes(user.role)) throw new Error('Phiên đăng nhập đã thay đổi hoặc tài khoản không có quyền. Vui lòng đăng nhập lại.');
  return user;
}
function inventoryCredential(ss, id) {
  const row = ss.getSheetByName(CONFIG.SHEET_USERS).getDataRange().getValues().slice(1).find(row => inventoryKey(row[0]) === inventoryKey(id));
  if (!row) throw new Error('Không tìm thấy tài khoản.');
  return inventoryHash(String(row[1] || ''));
}
function inventoryHash(text) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8).map(byte => ('0' + (byte & 255).toString(16)).slice(-2)).join(''); }
function inventoryRequestHash(payload, user) {
  return inventoryHash(JSON.stringify([payload.action, inventoryKey(user.user_id), inventoryKey(payload.device_id), String(payload.quantity || ''), String(payload.loan_id || ''), String(payload.booking_id || ''), String(payload.transition || ''), inventoryText(payload.purpose,500), inventoryText(payload.note), String(payload.condition || ''), payload.start_at ? inventoryDate(payload.start_at) : '', payload.end_at ? inventoryDate(payload.end_at) : '']));
}
function inventorySession(user) {
  const cache = CacheService.getScriptCache();
  const token = Utilities.getUuid() + Utilities.getUuid();
  cache.put('session_' + token, JSON.stringify({user_id: user.user_id, credential: inventoryCredential(SpreadsheetApp.getActiveSpreadsheet(), user.user_id), version: cache.get('auth_version_' + inventoryKey(user.user_id)) || '0'}), 21600);
  return token;
}
function inventoryDevice(ss, id) {
  const rows = ss.getSheetByName(CONFIG.SHEET_DEVICES).getDataRange().getValues();
  const matches = rows.map((row, index) => ({row, index})).slice(1).filter(entry => inventoryKey(entry.row[0]) === inventoryKey(id) && inventoryKey(id));
  if (matches.length !== 1) throw new Error('Không tìm thấy mã thiết bị duy nhất.');
  return {row: matches[0].row, index: matches[0].index + 1, config: inventoryConfig(matches[0].row), device_id: String(matches[0].row[0])};
}
function inventoryState(ss) { return {loans: inventoryRows(ss, 'Loans'), returns: inventoryRows(ss, 'Returns'), bookings: inventoryRows(ss, 'Bookings')}; }
function inventoryLoanOutstanding(loan, returns) {
  const returned = returns.filter(r => r.loan_id === loan.loan_id).reduce((sum, r) => sum + inventoryInt(r.quantity, 1, 100000), 0);
  const out = inventoryInt(loan.quantity, 1, 100000) - returned;
  if (out < 0) throw new Error('Dữ liệu trả vượt số đã mượn: ' + loan.loan_id);
  return out;
}
function inventorySummary(device, state) {
  const c = device.config;
  const loans = state.loans.filter(l => inventoryKey(l.device_id) === inventoryKey(device.device_id));
  const returns = state.returns.filter(r => inventoryKey(r.device_id) === inventoryKey(device.device_id));
  const borrowed = loans.reduce((sum, l) => sum + inventoryLoanOutstanding(l, state.returns), 0);
  const pending = returns.filter(r => r.audit_status === 'pending').reduce((sum, r) => sum + inventoryInt(r.quantity, 1, 100000), 0);
  const faulty = returns.filter(r => r.audit_status === 'rejected').reduce((sum, r) => sum + inventoryInt(r.quantity, 1, 100000), 0);
  const available = c.total_quantity - c.unavailable_quantity - borrowed - pending - faulty;
  if (available < 0) throw new Error('Tồn kho âm. Kiểm tra dữ liệu thiết bị ' + device.device_id);
  return {total: c.total_quantity, borrowed, pending, faulty, maintenance: c.unavailable_quantity, available: c.service_status === 'ready' ? available : 0};
}
// Half-open intervals: an end at 10:00 permits another start at 10:00.
// Sweep line counts peak concurrent units, not the sum of all intersecting bookings.
function inventoryPeak(bookings, device, start, end, excludeId, now) {
  const a = new Date(start).getTime(), b = new Date(end).getTime();
  const events = [];
  bookings.filter(r => r.device_id === device.device_id && r.booking_id !== excludeId && ['approved', 'active'].includes(r.status)).forEach(r => {
    const s = new Date(r.start_at).getTime();
    let e = new Date(r.end_at).getTime() + device.config.buffer_minutes * 60000;
    if (r.status === 'active' && e <= now) e = Infinity; // An overdue actual session has not released its units.
    if (s < b && e > a) {
      const q = inventoryInt(r.quantity, 1, 100000);
      events.push([Math.max(a, s), q], [Math.min(b, e), -q]);
    }
  });
  events.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let current = 0, peak = 0;
  events.forEach(event => { current += event[1]; peak = Math.max(peak, current); });
  return peak;
}
function inventoryBookingRange(payload, device) {
  const start = inventoryDate(payload.start_at), end = inventoryDate(payload.end_at);
  const s = new Date(start).getTime(), e = new Date(end).getTime();
  if (s <= Date.now() || e <= s || s > Date.now() + 366 * 86400000) throw new Error('Chọn lịch tương lai trong vòng 1 năm, giờ kết thúc sau giờ bắt đầu.');
  const localStart = new Date(s + 7 * 3600000).toISOString();
  const localEnd = new Date(e + 7 * 3600000).toISOString();
  if (localStart.slice(0, 10) !== localEnd.slice(0, 10) || localStart.slice(11, 16) < device.config.open_hour || localEnd.slice(11, 16) > device.config.close_hour || (e - s) > device.config.max_minutes * 60000) throw new Error('Lịch vượt giờ mở cửa, qua ngày hoặc quá thời lượng tối đa.');
  return {start, end};
}
function inventoryCheckCapacity(device, state, quantity, start, end, excludeId) {
  if (device.config.service_status !== 'ready') throw new Error('Thiết bị đang bảo trì hoặc bị khóa.');
  const faultHold = state.bookings.filter(r => r.device_id === device.device_id && r.status === 'fault_hold').reduce((sum, r) => sum + inventoryInt(r.quantity, 1, 100000), 0);
  const capacity = device.config.total_quantity - device.config.unavailable_quantity - faultHold;
  const peak = inventoryPeak(state.bookings, device, start, new Date(new Date(end).getTime() + device.config.buffer_minutes * 60000).toISOString(), excludeId, Date.now());
  if (quantity + peak > capacity) throw new Error('Không đủ số lượng trong toàn bộ khung giờ. Còn tối đa ' + Math.max(0, capacity - peak) + '.');
}
function inventoryRequestId(payload) {
  const id = String(payload.request_id || '');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(id)) throw new Error('Thiếu mã yêu cầu. Tải lại trang rồi thử lại.');
  return id;
}
function inventoryPublic(record) { const copy = Object.assign({}, record); ['_row','request_id','request_hash','transition_request_id','transition_hash'].forEach(key => delete copy[key]); return copy; }
function inventoryValidateDeviceChange(ss, payload, oldRow) {
  const base = oldRow || [];
  const draft = base.slice();
  INVENTORY_DEVICE_HEADERS.forEach((h, i) => { if (payload[h] != null) draft[13 + i] = payload[h]; });
  const config = inventoryConfig(draft);
  if (!oldRow) return config;
  const old = inventoryConfig(oldRow);
  const state = inventoryState(ss);
  const id = String(oldRow[0]);
  const history = state.loans.some(r => r.device_id === id) || state.bookings.some(r => r.device_id === id);
  const legacyBusy = String(oldRow[8] || 'Trong kho') !== 'Trong kho' || String(oldRow[9] || '').trim();
  if ((old.usage_mode !== config.usage_mode || old.tracking_mode !== config.tracking_mode) && (legacyBusy || history)) throw new Error('Chỉ đổi cách quản lý khi thiết bị chưa có phiếu số lượng/lịch và đã hoàn trả, kiểm định xong. Tạo mã mới nếu cần đổi sau khi có lịch sử.');
  const device = {config, device_id: id};
  if (config.usage_mode === 'portable' && config.tracking_mode === 'quantity') inventorySummary(device, state);
  if (config.usage_mode === 'lab') {
    const holds = state.bookings.filter(r => r.device_id === id && r.status === 'fault_hold').reduce((sum, r) => sum + Number(r.quantity), 0);
    const capacity = config.total_quantity - config.unavailable_quantity - holds;
    const future = state.bookings.filter(r => r.device_id === id && ['approved', 'active'].includes(r.status) && (r.status === 'active' || new Date(r.end_at).getTime() > Date.now()));
    const latest = Math.max(Date.now() + 1000, ...future.map(r => new Date(r.end_at).getTime() + config.buffer_minutes * 60000));
    if (capacity < 0 || inventoryPeak(state.bookings, device, inventoryNow(), new Date(latest).toISOString(), '', Date.now()) > capacity) throw new Error('Số lượng mới không đủ cho các lịch đã duyệt/đang dùng và số bị cách ly.');
    future.forEach(r => {
      const start = new Date(new Date(r.start_at).getTime() + 7 * 3600000).toISOString();
      const end = new Date(new Date(r.end_at).getTime() + 7 * 3600000).toISOString();
      if (start.slice(11, 16) < config.open_hour || end.slice(11, 16) > config.close_hour || new Date(r.end_at) - new Date(r.start_at) > config.max_minutes * 60000) throw new Error('Giờ/thời lượng mới không phù hợp lịch đã duyệt. Hủy hoặc xử lý lịch đó trước.');
    });
  }
  return config;
}
function inventoryHandle(ss, payload, staff) {
  const action = payload.action;
  if (action === 'admin_upgrade_schema') return inventoryUpgrade(ss);
  if (!inventorySchemaReady(ss)) throw new Error('Cần nâng cấp dữ liệu số lượng và lịch trước khi sử dụng.');
  const state = inventoryState(ss);
  const user = staff || inventoryUser(ss, payload.user_id);
  if (action === 'inventory_borrow') {
    const device = inventoryDevice(ss, payload.device_id);
    if (device.config.usage_mode !== 'portable' || device.config.tracking_mode !== 'quantity') throw new Error('Thiết bị này không dùng phiếu mượn số lượng.');
    const requestId = inventoryRequestId(payload);
    const requestHash = inventoryRequestHash(payload, user);
    const duplicate = state.loans.find(r => r.request_id === requestId);
    if (duplicate) {
      if (duplicate.request_hash !== requestHash) throw new Error('Mã yêu cầu đã dùng cho phiếu khác.');
      return {success: true, message: 'Phiếu mượn đã được ghi nhận.', loan_id: duplicate.loan_id};
    }
    const quantity = inventoryInt(payload.quantity, 1, device.config.total_quantity);
    const purpose = inventoryText(payload.purpose, 500);
    if (!purpose) throw new Error('Nhập mục đích sử dụng.');
    if (quantity > inventorySummary(device, state).available) throw new Error('Không đủ số lượng có thể mượn. Hãy tải lại dữ liệu.');
    const loan = {loan_id: inventoryId('LN'), device_id: device.device_id, user_id: user.user_id, user_name: user.full_name, quantity, purpose, note: inventoryText(payload.note), created_at: inventoryNow(), request_id: requestId, request_hash: requestHash};
    inventoryAppend(ss, 'Loans', loan);
    return {success: true, message: 'Đã ghi nhận mượn ' + quantity + ' thiết bị.', loan_id: loan.loan_id};
  }
  if (action === 'inventory_return') {
    const loan = state.loans.find(r => r.loan_id === payload.loan_id);
    if (!loan || inventoryKey(loan.user_id) !== inventoryKey(user.user_id)) throw new Error('Chỉ người đứng tên phiếu mượn mới được trả.');
    const requestId = inventoryRequestId(payload);
    const requestHash = inventoryRequestHash(payload, user);
    const duplicate = state.returns.find(r => r.request_id === requestId);
    if (duplicate) {
      if (duplicate.request_hash !== requestHash) throw new Error('Mã yêu cầu đã dùng cho phiếu khác.');
      return {success: true, message: 'Phiếu trả đã được ghi nhận.', return_id: duplicate.return_id};
    }
    const quantity = inventoryInt(payload.quantity, 1, inventoryLoanOutstanding(loan, state.returns));
    if (!['good', 'missing', 'faulty'].includes(payload.condition)) throw new Error('Chọn tình trạng hoàn trả.');
    if (payload.condition !== 'good' && !inventoryText(payload.note)) throw new Error('Ghi rõ tình trạng thiếu/hỏng.');
    const record = {return_id: inventoryId('RT'), loan_id: loan.loan_id, device_id: loan.device_id, user_id: user.user_id, user_name: user.full_name, quantity, condition: payload.condition, note: inventoryText(payload.note), created_at: inventoryNow(), audit_status: 'pending', request_id: requestId, request_hash: requestHash};
    inventoryAppend(ss, 'Returns', record);
    return {success: true, message: 'Đã trả ' + quantity + ' thiết bị, đang chờ kiểm định.', return_id: record.return_id};
  }
  if (action === 'inventory_audit_return' || action === 'inventory_repair_return') {
    const record = state.returns.find(r => r.return_id === payload.return_id);
    if (!record) throw new Error('Không tìm thấy phiếu trả.');
    if (action === 'inventory_audit_return') {
      if (record.audit_status !== 'pending' || !['approved', 'rejected'].includes(payload.decision)) throw new Error('Phiếu đã kiểm định hoặc kết luận không hợp lệ.');
      record.audit_status = payload.decision;
      record.audited_by = user.full_name;
      record.audit_note = inventoryText(payload.note);
      record.audited_at = inventoryNow();
    } else {
      if (record.audit_status !== 'rejected' || !inventoryText(payload.note)) throw new Error('Chỉ xác nhận sửa xong phiếu bị cách ly, cần ghi chú sửa chữa.');
      record.audit_status = 'repaired'; record.repaired_by = user.full_name; record.repaired_at = inventoryNow();
      record.audit_note += '\nSửa chữa: ' + inventoryText(payload.note);
    }
    inventoryUpdate(ss, 'Returns', record);
    return {success: true, message: 'Đã cập nhật kiểm định/sửa chữa số lượng.'};
  }
  if (action === 'booking_create' || action === 'booking_block') {
    const device = inventoryDevice(ss, payload.device_id);
    if (device.config.usage_mode !== 'lab') throw new Error('Thiết bị này không đăng ký lịch tại lab.');
    const requestId = inventoryRequestId(payload);
    const requestHash = inventoryRequestHash(payload, user);
    const duplicate = state.bookings.find(r => r.request_id === requestId);
    const kind = action === 'booking_block' ? 'block' : 'use';
    if (duplicate) {
      if (duplicate.request_hash !== requestHash) throw new Error('Mã yêu cầu đã dùng cho lịch khác.');
      return {success: true, message: 'Lịch đã được ghi nhận.', booking_id: duplicate.booking_id};
    }
    const range = inventoryBookingRange(payload, device);
    const quantity = inventoryInt(payload.quantity, 1, device.config.total_quantity);
    const purpose = inventoryText(payload.purpose, 500);
    if (!purpose) throw new Error('Nhập mục đích sử dụng hoặc lý do chặn lịch.');
    inventoryCheckCapacity(device, state, quantity, range.start, range.end);
    const record = {booking_id: inventoryId('BK'), device_id: device.device_id, user_id: user.user_id, user_name: user.full_name, quantity, start_at: range.start, end_at: range.end, purpose, note: inventoryText(payload.note), status: kind === 'block' ? 'approved' : 'pending', created_at: inventoryNow(), updated_at: inventoryNow(), reviewed_by: kind === 'block' ? user.full_name : '', request_id: requestId, request_hash: requestHash, kind};
    inventoryAppend(ss, 'Bookings', record);
    return {success: true, message: kind === 'block' ? 'Đã chặn lịch.' : 'Đã gửi lịch, chờ cán bộ duyệt.', booking_id: record.booking_id};
  }
  if (action === 'booking_update') {
    const record = state.bookings.find(r => r.booking_id === payload.booking_id);
    if (!record) throw new Error('Không tìm thấy lịch sử dụng.');
    const device = inventoryDevice(ss, record.device_id);
    const transition = payload.transition;
    if (!staff && inventoryKey(record.user_id) !== inventoryKey(user.user_id)) throw new Error('Bạn không đứng tên lịch này.');
    const transitionId = payload.request_id ? inventoryRequestId(payload) : '';
    const transitionHash = transitionId ? inventoryRequestHash(payload, user) : '';
    if (transitionId && record.transition_request_id === transitionId) {
      if (record.transition_hash !== transitionHash) throw new Error('Mã yêu cầu đã dùng cho thao tác lịch khác.');
      return {success: true, message: 'Thao tác lịch đã được ghi nhận.'};
    }
    const now = Date.now();
    if (transition === 'approve') {
      if (!staff || record.status !== 'pending' || new Date(record.start_at).getTime() <= now) throw new Error('Chỉ cán bộ được duyệt lịch tương lai đang chờ.');
      inventoryCheckCapacity(device, state, Number(record.quantity), record.start_at, record.end_at, record.booking_id);
      record.status = 'approved'; record.reviewed_by = user.full_name; record.review_note = inventoryText(payload.note);
    } else if (transition === 'reject') {
      if (!staff || record.status !== 'pending') throw new Error('Chỉ cán bộ được từ chối lịch chờ duyệt.');
      record.status = 'rejected'; record.reviewed_by = user.full_name; record.review_note = inventoryText(payload.note);
    } else if (transition === 'cancel') {
      if (!['pending', 'approved'].includes(record.status)) throw new Error('Chỉ hủy lịch chưa bắt đầu.');
      record.status = 'cancelled'; record.review_note = inventoryText(payload.note);
    } else if (transition === 'no_show') {
      if (!staff || record.kind === 'block' || record.status !== 'approved' || now < new Date(record.end_at).getTime()) throw new Error('Chỉ cán bộ đánh dấu không đến sau giờ kết thúc.');
      record.status = 'no_show'; record.reviewed_by = user.full_name;
    } else if (transition === 'start') {
      if (record.kind === 'block' || record.status !== 'approved' || now < new Date(record.start_at).getTime() || now >= new Date(record.end_at).getTime()) throw new Error('Chỉ bắt đầu lịch đã duyệt trong khung giờ đăng ký.');
      inventoryCheckCapacity(device, state, Number(record.quantity), new Date(now).toISOString(), record.end_at, record.booking_id);
      record.status = 'active'; record.actual_start = inventoryNow();
    } else if (transition === 'finish') {
      if (record.status !== 'active' || !['good', 'faulty'].includes(payload.condition)) throw new Error('Chọn tình trạng kết thúc cho buổi đang sử dụng.');
      if (payload.condition === 'faulty' && !inventoryText(payload.note)) throw new Error('Ghi rõ sự cố khi kết thúc.');
      record.status = 'completed'; record.actual_end = inventoryNow(); record.end_condition = payload.condition;
      record.note += (payload.note ? '\nKết thúc: ' + inventoryText(payload.note) : '');
      // Put a fault hold on the same booking row: capacity is never released before the fault is recorded.
      if (payload.condition === 'faulty') record.status = 'fault_hold';
    } else if (transition === 'repair') {
      if (!staff || record.status !== 'fault_hold' || !inventoryText(payload.note)) throw new Error('Cán bộ cần ghi chú xác nhận sửa chữa.');
      record.status = 'completed'; record.review_note += '\nSửa chữa: ' + inventoryText(payload.note); record.reviewed_by = user.full_name;
    } else throw new Error('Thao tác lịch không hợp lệ.');
    record.updated_at = inventoryNow();
    record.transition_request_id = transitionId; record.transition_hash = transitionHash;
    inventoryUpdate(ss, 'Bookings', record);
    return {success: true, message: 'Đã cập nhật lịch sử dụng.'};
  }
  throw new Error('Thao tác số lượng/lịch không hợp lệ.');
}


/**
 * ======================================================================================
 * 1. doGet(e): Trả về Devices, Whitelist, Hàng đợi Kiểm định QA và Nhật ký Chỉnh sửa Admin
 * ======================================================================================
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. Lấy danh sách Devices
    const devSheet = ss.getSheetByName(CONFIG.SHEET_DEVICES);
    if (!devSheet) return createJsonResponse({ success: false, message: "Sheet Devices không tồn tại!" });
    
    const devValues = devSheet.getDataRange().getValues();
    const schemaReady = inventorySchemaReady(ss);
    const inventory = inventoryState(ss);
    
    // 2. Lấy Logs và phân loại (Giao dịch sinh viên & Nhật ký chỉnh sửa của Admin)
    const logSheet = ss.getSheetByName(CONFIG.SHEET_LOGS);
    const logsByDevice = {};
    const auditQueue = [];
    const editLogs = [];
    
    if (logSheet && logSheet.getLastRow() > 1) {
      const logValues = logSheet.getDataRange().getValues();
      for (let i = logValues.length - 1; i >= 1; i--) {
        const row = logValues[i];
        const rawDeviceIds = String(row[4] || "");
        const deviceIds = rawDeviceIds.split(",").map(s => s.trim());
        const actionType = String(row[3] || "");
        
        const logItem = {
          timestamp: row[0] instanceof Date ? Utilities.formatDate(row[0], "GMT+7", "yyyy-MM-dd HH:mm:ss") : String(row[0]),
          tx_id: String(row[1] || ""),
          user_name: String(row[2] || ""),
          action: actionType,
          device_ids: rawDeviceIds,
          project_tag: String(row[5] || ""),
          checked_accessories: String(row[6] || ""),
          return_condition: String(row[7] || ""),
          note: String(row[8] || ""),
          photo_url: String(row[9] || ""),
          audit_status: String(row[11] || "Chờ kiểm định"),
          audited_by: String(row[12] || ""),
          audit_note: String(row[13] || "")
        };
        
        // Nếu là log thao tác của Admin
        if (actionType.indexOf("[Admin]") !== -1) {
          if (editLogs.length < 50) editLogs.push(logItem);
        } else {
          // Chỉ giao dịch "Trả về kho" mới đưa vào hàng đợi kiểm định (QA Audit)
          if (actionType === "Trả về kho" && auditQueue.length < 50) auditQueue.push(logItem);
          
          deviceIds.forEach(id => {
            if (!id) return;
            if (!logsByDevice[id]) logsByDevice[id] = [];
            if (logsByDevice[id].length < 3) logsByDevice[id].push(logItem);
          });
        }
      }
    }
    
    const devices = [];
    for (let i = 1; i < devValues.length; i++) {
      const row = devValues[i];
      const deviceId = String(row[0] || "").trim();
      if (!deviceId) continue;
      
      const deviceConfig = inventoryConfig(row);
      let stock = null;
      if (deviceConfig.usage_mode === 'portable' && deviceConfig.tracking_mode === 'quantity') stock = inventorySummary({config: deviceConfig, device_id: deviceId}, inventory);
      if (deviceConfig.usage_mode === 'lab') {
        const faulty = inventory.bookings.filter(r => r.device_id === deviceId && r.status === 'fault_hold').reduce((sum, r) => sum + Number(r.quantity), 0);
        const busy = inventoryPeak(inventory.bookings, {config: deviceConfig, device_id: deviceId}, inventoryNow(), new Date(Date.now() + 1000).toISOString(), '', Date.now());
        stock = {total: deviceConfig.total_quantity, borrowed: busy, pending: 0, faulty, maintenance: deviceConfig.unavailable_quantity, available: deviceConfig.service_status === 'ready' ? Math.max(0, deviceConfig.total_quantity - deviceConfig.unavailable_quantity - faulty - busy) : 0};
      }
      devices.push({
        ...deviceConfig,
        stock,
        device_id: deviceId,
        name: String(row[1] || ""),
        category: String(row[2] || "Khác"),
        location: String(row[3] || ""),
        accessories: String(row[4] || ""),
        golden_image: String(row[5] || ""),
        specs_note: String(row[6] || ""),
        pinout_link: String(row[7] || ""),
        status: String(row[8] || "Trong kho"),
        holder_id: String(row[9] || ""),
        holder_name: String(row[10] || ""),
        project_tag: String(row[11] || ""),
        updated_at: row[12] instanceof Date ? Utilities.formatDate(row[12], "GMT+7", "yyyy-MM-dd HH:mm:ss") : String(row[12] || ""),
        recent_logs: logsByDevice[deviceId] || []
      });
    }

    // 3. Lấy Whitelist Sinh viên (Bảo mật: Không bao gồm mã PIN)
    const userSheet = ss.getSheetByName(CONFIG.SHEET_USERS);
    const whitelist = [];
    if (userSheet && userSheet.getLastRow() > 1) {
      const userValues = userSheet.getDataRange().getValues();
      for (let i = 1; i < userValues.length; i++) {
        const uId = String(userValues[i][0] || "").trim();
        if (!uId) continue;
        whitelist.push({
          user_id: uId,
          full_name: String(userValues[i][2] || ""),
          phone: String(userValues[i][3] || ""),
          // Users column F: Khóa (e.g. K68, K69). Keep A-E unchanged.
          cohort: String(userValues[i][5] || "").trim(),
          role: String(userValues[i][4] || "STUDENT").toUpperCase()
        });
      }
    }
    
    return createJsonResponse({
      success: true,
      timestamp: Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss"),
      devices: devices,
      whitelist: whitelist,
      audit_queue: auditQueue,
      edit_logs: editLogs,
      schema_version: schemaReady ? 2 : 1,
      loans: inventory.loans.map(loan => Object.assign(inventoryPublic(loan), {outstanding: inventoryLoanOutstanding(loan, inventory.returns)})),
      quantity_returns: inventory.returns.map(inventoryPublic),
      bookings: inventory.bookings.map(inventoryPublic)
    });
    
  } catch (error) {
    return createJsonResponse({ success: false, message: "Lỗi doGet: " + error.toString() });
  }
}

/**
 * ======================================================================================
 * 2. doPost(e): Xử lý Login, Thêm/Sửa/Xóa Thiết bị, Kiểm định ảnh, Giao dịch
 * ======================================================================================
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return createJsonResponse({ success: false, message: "Hệ thống bận, vui lòng thử lại sau vài giây." });
  }
  
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ success: false, message: "Dữ liệu yêu cầu rỗng." });
    }
    
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Staff roles come from a server-issued session and the current Users sheet.
    const staffActions = ['admin_save_device', 'admin_delete_device', 'audit_transaction', 'admin_unlock', 'admin_upgrade_schema', 'inventory_audit_return', 'inventory_repair_return', 'booking_block'];
    let staff = null;
    if (staffActions.includes(action) || (action === 'booking_update' && ['approve', 'reject', 'no_show', 'repair'].includes(payload.transition)) || (action === 'booking_update' && payload.staff_session)) {
      const roles = ['admin_delete_device', 'admin_upgrade_schema'].includes(action) ? ['ADMIN'] : ['ADMIN', 'INSPECTOR'];
      staff = inventoryStaff(ss, payload.staff_session, roles);
      payload.admin_name = staff.full_name;
      payload.inspector_name = staff.full_name;
    }
    if (action === 'admin_logout') {
      if (payload.staff_session) CacheService.getScriptCache().remove('session_' + String(payload.staff_session).slice(0, 180));
      return createJsonResponse({success: true});
    }
    if (action === 'admin_upgrade_schema' || action.startsWith('inventory_') || action.startsWith('booking_')) {
      return createJsonResponse(inventoryHandle(ss, payload, staff));
    }

    if (action === "admin_change_password") {
      const sheet = ss.getSheetByName(CONFIG.SHEET_USERS);
      if (!sheet) return createJsonResponse({ success: false, message: "Sheet Users không tồn tại!" });
      const adminId = String(payload.admin_id || "").trim().toLowerCase();
      const adminPin = String(payload.admin_pin || "").trim();
      const targetId = String(payload.target_id || "").trim().toLowerCase();
      const newPin = typeof payload.new_pin === "string" ? payload.new_pin : "";
      if (!adminId || !adminPin || !targetId || newPin.length < 8 || newPin.length > 128 || newPin !== newPin.trim() || /[\r\n\u0000]/.test(newPin)) {
        return createJsonResponse({ success: false, message: "Nhập đủ thông tin. Mật khẩu mới cần 8–128 ký tự, không có khoảng trắng ở đầu/cuối." });
      }
      const cache = CacheService.getScriptCache();
      const key = "password_change_attempts_" + encodeURIComponent(adminId).slice(0, 180);
      const attempts = Number(cache.get(key) || 0);
      if (attempts >= 5) return createJsonResponse({ success: false, message: "Đã thử quá nhiều lần. Vui lòng thử lại sau 15 phút." });
      const rows = sheet.getDataRange().getValues();
      const admins = rows.slice(1).filter(row => String(row[0] || "").trim().toLowerCase() === adminId);
      if (admins.length !== 1 || String(admins[0][4] || "").toUpperCase() !== "ADMIN" || String(admins[0][1] || "").trim() !== adminPin) {
        cache.put(key, String(attempts + 1), 900);
        return createJsonResponse({ success: false, message: "Không xác nhận được tài khoản Admin hoặc mật khẩu hiện tại." });
      }
      const targets = [];
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0] || "").trim().toLowerCase() === targetId) targets.push(i + 1);
      }
      if (targets.length !== 1) return createJsonResponse({ success: false, message: "Không tìm thấy tài khoản duy nhất cần đổi mật khẩu." });
      setText(sheet.getRange(targets[0], 2), newPin);
      cache.put('auth_version_' + targetId, Utilities.getUuid(), 21600);
      cache.remove(key);
      return createJsonResponse({ success: true, message: "Đã đổi mật khẩu tài khoản. Lần đăng nhập tiếp theo cần dùng mật khẩu mới." });
    }

    // -------------------------------------------------------------
    // LUỒNG 1: ĐĂNG NHẬP QUẢN TRỊ VIÊN (ADMIN & KIỂM ĐỊNH VIÊN INSPECTOR)
    // -------------------------------------------------------------
    if (action === "admin_login") {
      const userSheet = ss.getSheetByName(CONFIG.SHEET_USERS);
      if (!userSheet) return createJsonResponse({ success: false, message: "Sheet Users không tồn tại!" });
      
      const inputId = String(payload.user_id || "").trim();
      const inputPin = String(payload.pin || "").trim();
      if (!inputId || !inputPin || inputId.length > 100 || inputPin.length > 128) throw new Error('Nhập tài khoản và mật khẩu hợp lệ.');
      const loginCache = CacheService.getScriptCache();
      const loginKey = 'staff_login_attempts_' + encodeURIComponent(inputId.toLowerCase());
      const loginAttempts = Number(loginCache.get(loginKey) || 0);
      if (loginAttempts >= 5) throw new Error('Đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.');
      const userRows = userSheet.getDataRange().getValues();
      
      let matchedStaff = null;
      for (let i = 1; i < userRows.length; i++) {
        const rowId = String(userRows[i][0] || "").trim();
        const rowPin = String(userRows[i][1] || "").trim();
        const rowRole = String(userRows[i][4] || "STUDENT").toUpperCase();
        
        if ((rowRole === "ADMIN" || rowRole === "INSPECTOR") && rowId.toLowerCase() === inputId.toLowerCase() && rowPin === inputPin) {
          matchedStaff = {
            user_id: rowId,
            full_name: String(userRows[i][2] || "Quản trị viên Lab"),
            phone: String(userRows[i][3] || ""),
            role: rowRole
          };
          break;
        }
      }
      
      if (matchedStaff) {
        loginCache.remove(loginKey);
        return createJsonResponse({ success: true, user: matchedStaff, staff_session: inventorySession(matchedStaff), message: `Chào mừng ${matchedStaff.full_name} (${matchedStaff.role})!` });
      } else {
        loginCache.put(loginKey, String(loginAttempts + 1), 900);
        return createJsonResponse({ success: false, message: "Sai tài khoản Quản trị/Kiểm định hoặc mã PIN!" });
      }
    }

    // -------------------------------------------------------------
    // LUỒNG 2: THÊM MỚI HOẶC CHỈNH SỬA THIẾT BỊ (KÈM GHI NHẬN EDIT LOG)
    // -------------------------------------------------------------
    if (action === "admin_save_device") {
      const devSheet = ss.getSheetByName(CONFIG.SHEET_DEVICES);
      if (!devSheet) return createJsonResponse({ success: false, message: "Sheet Devices không tồn tại!" });
      
      const devId = String(payload.device_id || "").trim();
      const adminName = String(payload.admin_name || "Admin Lab").trim();
      if (!devId) return createJsonResponse({ success: false, message: "Mã thiết bị không được để trống!" });
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(devId)) throw new Error('Mã thiết bị chỉ gồm chữ không dấu, số, dấu gạch ngang/gạch dưới (tối đa 80 ký tự).');
      if (payload.golden_image) {
        payload.golden_image = formatDriveImageUrl(payload.golden_image);
      }
      
      const devValues = devSheet.getDataRange().getValues();
      const nowStr = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
      
      let foundRow = -1;
      for (let r = 1; r < devValues.length; r++) {
        if (String(devValues[r][0] || "").trim().toLowerCase() === devId.toLowerCase()) {
          foundRow = r + 1;
          break;
        }
      }

      const logSheet = ss.getSheetByName(CONFIG.SHEET_LOGS);
      const duplicateIds = devValues.slice(1).filter(row => inventoryKey(row[0]) === inventoryKey(devId));
      if (duplicateIds.length > 1) throw new Error('Mã thiết bị đang bị trùng trong Sheets.');
      const hasConfig = INVENTORY_DEVICE_HEADERS.some(h => payload[h] != null);
      if (hasConfig && !inventorySchemaReady(ss)) throw new Error('Nâng cấp dữ liệu số lượng/lịch trước khi lưu cấu hình mới.');
      const savedConfig = inventoryValidateDeviceChange(ss, payload, foundRow > 0 ? devValues[foundRow - 1] : null);
      uploadDeviceFiles(payload);
      if (payload.golden_image) payload.golden_image = formatDriveImageUrl(payload.golden_image);

      if (foundRow > 0) {
        // CẬP NHẬT THIẾT BỊ HIỆN CÓ (Gộp thành 1 lệnh ghi mảng để tăng tốc)
        const rowUpdates = [[
          payload.name || "",
          payload.category || "Khác",
          payload.location || "",
          payload.accessories || "",
          payload.golden_image || "",
          payload.specs_note || "",
          payload.pinout_link || ""
        ]];
        setTextMatrix(devSheet, foundRow, 2, rowUpdates);
        setText(devSheet.getRange(foundRow, 13), nowStr);
        if (hasConfig) setTextMatrix(devSheet, foundRow, 14, [INVENTORY_DEVICE_HEADERS.map(h => savedConfig[h])]);

        // Ghi log chỉnh sửa
        if (logSheet) {
          appendTextRow(logSheet, [
            nowStr,
            "ADMIN-" + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd-HHmmss"),
            adminName,
            "[Admin] Sửa thiết bị",
            devId,
            "",
            payload.accessories || "",
            "",
            `Cập nhật thông số/tài liệu cho: ${payload.name}`,
            payload.golden_image || "",
            "",
            "Đã ghi nhận",
            adminName,
            "Sửa thiết bị"
          ]);
        }

        return createJsonResponse({ success: true, message: `Đã cập nhật thông số & tài liệu cho [${devId}] thành công!` });
      } else {
        // THÊM THIẾT BỊ MỚI
        appendTextRow(devSheet, [
          devId,
          payload.name || "",
          payload.category || "Khác",
          payload.location || "Chưa xác định",
          payload.accessories || "",
          payload.golden_image || "",
          payload.specs_note || "",
          payload.pinout_link || "",
          "Trong kho",
          "",
          "",
          "",
          nowStr,
          ...(hasConfig ? INVENTORY_DEVICE_HEADERS.map(h => savedConfig[h]) : [])
        ]);

        // Ghi log thêm mới
        if (logSheet) {
          appendTextRow(logSheet, [
            nowStr,
            "ADMIN-" + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd-HHmmss"),
            adminName,
            "[Admin] Thêm thiết bị mới",
            devId,
            "",
            payload.accessories || "",
            "",
            `Thêm mới thiết bị: ${payload.name} (${payload.category})`,
            payload.golden_image || "",
            "",
            "Đã ghi nhận",
            adminName,
            "Thêm thiết bị mới"
          ]);
        }

        return createJsonResponse({ success: true, message: `Đã thêm thiết bị mới [${devId}] vào hệ thống!` });
      }
    }

    // -------------------------------------------------------------
    // LUỒNG 3: BỚT / XÓA THIẾT BỊ KHỎI KHO (KÈM GHI NHẬN EDIT LOG)
    // -------------------------------------------------------------
    if (action === "admin_delete_device") {
      const devSheet = ss.getSheetByName(CONFIG.SHEET_DEVICES);
      if (!devSheet) return createJsonResponse({ success: false, message: "Sheet Devices không tồn tại!" });
      
      const targetId = String(payload.device_id || "").trim();
      const adminName = String(payload.admin_name || "Admin Lab").trim();
      const devValues = devSheet.getDataRange().getValues();
      const nowStr = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
      
      let deletedRow = -1;
      let deletedName = "";
      for (let r = 1; r < devValues.length; r++) {
        if (String(devValues[r][0] || "").trim().toLowerCase() === targetId.toLowerCase()) {
          deletedRow = r + 1;
          deletedName = String(devValues[r][1] || "");
          break;
        }
      }

      if (deletedRow > 0) {
        const row = devValues[deletedRow - 1];
        const state = inventoryState(ss);
        if (String(row[8] || 'Trong kho') !== 'Trong kho' || String(row[9] || '').trim() || state.loans.some(r => r.device_id === row[0]) || state.bookings.some(r => r.device_id === row[0])) throw new Error('Thiết bị đang được giữ/chờ kiểm định hoặc đã có lịch sử số lượng/lịch. Hãy khóa sử dụng thay vì xóa.');
        devSheet.deleteRow(deletedRow);

        // Ghi log xóa
        const logSheet = ss.getSheetByName(CONFIG.SHEET_LOGS);
        if (logSheet) {
          appendTextRow(logSheet, [
            nowStr,
            "ADMIN-" + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd-HHmmss"),
            adminName,
            "[Admin] Xóa thiết bị",
            targetId,
            "",
            "",
            "",
            `Đã xóa thiết bị: ${deletedName} khỏi danh mục kho`,
            "",
            "",
            "Đã ghi nhận",
            adminName,
            "Xóa thiết bị"
          ]);
        }

        return createJsonResponse({ success: true, message: `Đã xóa thiết bị [${targetId}] thành công!` });
      } else {
        return createJsonResponse({ success: false, message: `Không tìm thấy thiết bị [${targetId}]!` });
      }
    }

    // -------------------------------------------------------------
    // LUỒNG 4: KIỂM ĐỊNH VIÊN (QA) PHÊ DUYỆT / BÁO CẢNH BÁO ẢNH BÀN GIAO
    // -------------------------------------------------------------
    if (action === "audit_transaction") {
      const logSheet = ss.getSheetByName(CONFIG.SHEET_LOGS);
      if (!logSheet) return createJsonResponse({ success: false, message: "Sheet Logs không tồn tại!" });
      
      const targetTxId = String(payload.tx_id || "").trim();
      const auditStatus = String(payload.audit_status || "Đã duyệt hợp lệ").trim();
      const inspectorName = String(payload.inspector_name || "Kiểm định viên").trim();
      const auditNote = String(payload.audit_note || "").trim();
      const logValues = logSheet.getDataRange().getValues();
      if (!["Đã duyệt hợp lệ", "Báo vi phạm"].includes(auditStatus)) {
        return createJsonResponse({ success: false, message: "Kết luận kiểm định không hợp lệ." });
      }
      
      let updated = false;
      let targetRowData = null;
      for (let r = 1; r < logValues.length; r++) {
        if (String(logValues[r][1] || "").trim() === targetTxId) {
          if (String(logValues[r][11] || "Chờ kiểm định") !== "Chờ kiểm định") {
            return createJsonResponse({ success: false, message: "Giao dịch này đã được kiểm định. Hãy tải lại dữ liệu." });
          }
          // Only the latest return may release a device from the inspection queue.
          if (String(logValues[r][3]) === "Trả về kho") {
            const devSheet = ss.getSheetByName(CONFIG.SHEET_DEVICES);
            if (!devSheet) return createJsonResponse({ success: false, message: "Sheet Devices không tồn tại!" });
            const values = devSheet.getDataRange().getValues();
            const ids = String(logValues[r][4] || "").split(",").map(id => id.trim().toLowerCase()).filter(Boolean);
            if (!ids.length || new Set(ids).size !== ids.length) return createJsonResponse({ success: false, message: "Danh sách thiết bị của giao dịch không hợp lệ." });
            const rowsToUpdate = [];
            for (const id of ids) {
              const matches = values.map((row, index) => ({row, index})).slice(1).filter(entry => String(entry.row[0] || "").trim().toLowerCase() === id);
              const stale = logValues.slice(r + 1).some(row =>
                ["Mượn mới", "Trả về kho", "Nhận bàn giao tay đôi"].includes(String(row[3])) &&
                String(row[4] || "").split(",").some(value => value.trim().toLowerCase() === id));
              if (matches.length !== 1 || stale || matches[0].row[8] !== "Chờ kiểm định" || String(matches[0].row[9] || "").trim()) {
                return createJsonResponse({ success: false, message: "Thiết bị không còn chờ kiểm định cho giao dịch này. Hãy tải lại dữ liệu." });
              }
              rowsToUpdate.push(matches[0].index + 1);
            }
            for (const row of rowsToUpdate) {
              setText(devSheet.getRange(row, 9), auditStatus === "Đã duyệt hợp lệ" ? "Trong kho" : "Báo lỗi/Khóa");
              setText(devSheet.getRange(row, 13), Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss"));
            }
          }
          const rowIndex = r + 1;
          setText(logSheet.getRange(rowIndex, 12), auditStatus);
          setText(logSheet.getRange(rowIndex, 13), inspectorName);
          setText(logSheet.getRange(rowIndex, 14), auditNote);
          updated = true;
          targetRowData = logValues[r];
          break;
        }
      }

      if (updated) {
        // Bắn thông báo Telegram kết quả kiểm định
        try {
          if (CONFIG.TELEGRAM_BOT_TOKEN && CONFIG.TELEGRAM_BOT_TOKEN !== "YOUR_TELEGRAM_BOT_TOKEN_HERE") {
            const isApproved = auditStatus.includes("hợp lệ");
            const icon = isApproved ? "✅" : "🚨 CẢNH BÁO VI PHẠM";
            let msg = `<b>${icon} KẾT QUẢ KIỂM ĐỊNH BÀN GIAO THIẾT BỊ</b>\n\n`;
            msg += `• <b>Mã GD:</b> <code>${targetTxId}</code>\n`;
            msg += `• <b>Người kiểm định:</b> <b>${inspectorName}</b>\n`;
            msg += `• <b>Kết luận:</b> <b>${auditStatus.toUpperCase()}</b>\n`;
            if (targetRowData) {
              msg += `• <b>Người mượn/trả:</b> ${targetRowData[2]}\n`;
              msg += `• <b>Thiết bị:</b> <code>${targetRowData[4]}</code>\n`;
            }
            if (auditNote) {
              msg += `• <b>Chi tiết đánh giá:</b> <i>${auditNote}</i>\n`;
            }
            sendTextMessageFallback(msg);
          }
        } catch (tErr) {}

        return createJsonResponse({ success: true, message: `Giao dịch [${targetTxId}] đã được ghi nhận: ${auditStatus}!` });
      } else {
        return createJsonResponse({ success: false, message: `Không tìm thấy mã giao dịch [${targetTxId}]!` });
      }
    }

    // -------------------------------------------------------------
    // LUỒNG 5: ADMIN MỞ KHÓA THIẾT BỊ BÁO HỎNG (action = "admin_unlock")
    // -------------------------------------------------------------
    if (action === "admin_unlock") {
      const devSheet = ss.getSheetByName(CONFIG.SHEET_DEVICES);
      if (!devSheet) return createJsonResponse({ success: false, message: "Sheet Devices không tồn tại!" });
      
      const targetId = String(payload.device_id || "").trim().toLowerCase();
      const adminName = String(payload.admin_name || "Admin Lab").trim();
      const devRange = devSheet.getDataRange();
      const devValues = devRange.getValues();
      const nowStr = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
      
      let unlocked = false;
      for (let r = 1; r < devValues.length; r++) {
        if (String(devValues[r][0] || "").trim().toLowerCase() === targetId) {
          if (String(devValues[r][8] || "").trim() !== "Báo lỗi/Khóa" || String(devValues[r][9] || "").trim()) {
            return createJsonResponse({ success: false, message: "Chỉ được mở khóa thiết bị báo hỏng và không có người giữ." });
          }
          const rowIndex = r + 1;
          setText(devSheet.getRange(rowIndex, 9), "Trong kho");
          setText(devSheet.getRange(rowIndex, 10), "");
          setText(devSheet.getRange(rowIndex, 11), "");
          setText(devSheet.getRange(rowIndex, 12), "");
          setText(devSheet.getRange(rowIndex, 13), nowStr);
          unlocked = true;
          break;
        }
      }
      
      if (unlocked) {
        // Ghi log mở khóa
        const logSheet = ss.getSheetByName(CONFIG.SHEET_LOGS);
        if (logSheet) {
          appendTextRow(logSheet, [
            nowStr,
            "ADMIN-" + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd-HHmmss"),
            adminName,
            "[Admin] Mở khóa thiết bị",
            payload.device_id,
            "",
            "",
            "",
            `Đã kiểm tra và mở khóa thiết bị đưa về TRONG KHO`,
            "",
            "",
            "Đã ghi nhận",
            adminName,
            "Mở khóa"
          ]);
        }
        return createJsonResponse({ success: true, message: `Đã mở khóa thiết bị [${payload.device_id}] về TRONG KHO thành công!` });
      } else {
        return createJsonResponse({ success: false, message: `Không tìm thấy thiết bị [${payload.device_id}]!` });
      }
    }

    // -------------------------------------------------------------
    // LUỒNG 6: GIAO DỊCH BÀN GIAO (Mượn mới, Trả về kho, Nhận tay đôi)
    // -------------------------------------------------------------
    if (action === "transaction") {
      const txType = payload.tx_type;
      let userId = String(payload.user_id || "").trim();
      let userName = String(payload.user_name || "").trim();
      const deviceIds = Array.isArray(payload.device_ids) ? payload.device_ids : [];
      const projectTag = String(payload.project_tag || "").trim();
      const checkedAccessories = String(payload.checked_accessories || "").trim();
      const returnCondition = String(payload.return_condition || "Hoạt động tốt - Đủ đồ").trim();
      const note = String(payload.note || "").trim();
      const photoBase64 = payload.photo_base64;
      
      if (!userId || deviceIds.length === 0) {
        return createJsonResponse({ success: false, message: "Thiếu thông tin người dùng hoặc danh sách thiết bị!" });
      }
      const borrower = inventoryUser(ss, userId);
      userId = borrower.user_id;
      userName = borrower.full_name;

      // Validate the whole batch under the script lock, before upload/log/write.
      if (txType !== "Mượn mới" && txType !== "Trả về kho") {
        return createJsonResponse({ success: false, message: "Thao tác không hợp lệ. Bàn giao tay đôi tạm ngừng: người giữ cần trả về kho trước khi người nhận mượn lại." });
      }
      if (txType === "Trả về kho" && !["Hoạt động tốt - Đủ đồ", "Thiếu phụ kiện", "Báo lỗi/Hỏng"].includes(returnCondition)) {
        return createJsonResponse({ success: false, message: "Tình trạng hoàn trả không hợp lệ." });
      }
      const devSheet = ss.getSheetByName(CONFIG.SHEET_DEVICES);
      const logSheet = ss.getSheetByName(CONFIG.SHEET_LOGS);
      if (!devSheet || !logSheet) return createJsonResponse({ success: false, message: "Thiếu Sheet Devices hoặc Logs." });
      const devValues = devSheet.getDataRange().getValues();
      const seen = new Set();
      for (const id of deviceIds) {
        if (typeof id !== "string" || !id.trim() || seen.has(id.trim().toLowerCase())) {
          return createJsonResponse({ success: false, message: "Danh sách thiết bị không hợp lệ hoặc trùng mã." });
        }
        const key = id.trim().toLowerCase();
        seen.add(key);
        const matches = devValues.slice(1).filter(row => String(row[0] || "").trim().toLowerCase() === key);
        if (matches.length !== 1) return createJsonResponse({ success: false, message: `Không tìm thấy mã thiết bị duy nhất: ${id}.` });
        const status = String(matches[0][8] || "").trim();
        const holder = String(matches[0][9] || "").trim();
        const config = inventoryConfig(matches[0]);
        if (config.usage_mode !== 'portable' || config.tracking_mode !== 'individual') throw new Error('Thiết bị này cần dùng phiếu số lượng hoặc đăng ký lịch.');
        if (txType === 'Mượn mới' && (config.service_status !== 'ready' || config.unavailable_quantity > 0)) throw new Error('Thiết bị đang bảo trì hoặc bị khóa.');
        if (txType === "Mượn mới" && (status !== "Trong kho" || holder)) {
          return createJsonResponse({ success: false, message: `Thiết bị ${id} không sẵn sàng cho mượn. Hãy tải lại dữ liệu.` });
        }
        if (txType === "Trả về kho" && (status !== "Đang mượn" || inventoryKey(holder) !== inventoryKey(userId))) {
          return createJsonResponse({ success: false, message: `Chỉ người đang giữ thiết bị ${id} mới được trả về kho.` });
        }
      }
      
      const now = new Date();
      const timestampStr = Utilities.formatDate(now, "GMT+7", "yyyy-MM-dd HH:mm:ss");
      const txId = "TX-" + Utilities.formatDate(now, "GMT+7", "yyyyMMdd-HHmmss") + "-" + Math.floor(100 + Math.random() * 900);
      
      let directPhotoUrl = "";
      if (photoBase64 && photoBase64.indexOf("base64,") !== -1) {
        try {
          const base64Data = photoBase64.split("base64,")[1];
          const decodedBytes = Utilities.base64Decode(base64Data);
          const fileName = `${txId}_${deviceIds.join("_")}.jpg`;
          const blob = Utilities.newBlob(decodedBytes, "image/jpeg", fileName);
          
          let folder;
          try {
            if (CONFIG.FOLDER_ID && CONFIG.FOLDER_ID !== "YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE") {
              folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
            }
          } catch (folderErr) {
            Logger.log("Không thể truy cập FOLDER_ID, fallback về Root: " + folderErr.toString());
          }
          if (!folder) folder = DriveApp.getRootFolder();
          
          const file = folder.createFile(blob);
          try {
            file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          } catch (sharingErr) {
            Logger.log("Không thể setSharing ANYONE_WITH_LINK: " + sharingErr.toString());
          }
          directPhotoUrl = `https://drive.google.com/thumbnail?id=${file.getId()}&sz=w1200`;
        } catch (uploadErr) {
          Logger.log("Lỗi upload Drive: " + uploadErr.toString());
          directPhotoUrl = "LỖI_UPLOAD: " + uploadErr.message;
        }
      }
      
      const nextLogRow = logSheet.getLastRow() + 1;
      const formulaPreview = directPhotoUrl.startsWith("http") ? `=IMAGE(J${nextLogRow})` : "";
      
      const isReturn = txType === "Trả về kho";
      appendTextRow(logSheet, [
        timestampStr,
        txId,
        `${userName} (${userId})`,
        txType,
        deviceIds.join(", "),
        projectTag,
        checkedAccessories,
        returnCondition,
        note,
        directPhotoUrl,
        "",
        isReturn ? "Chờ kiểm định" : "Không cần duyệt",
        isReturn ? "" : "Hệ thống",
        ""
      ]);
      if (formulaPreview) logSheet.getRange(nextLogRow, 11).setFormula(formulaPreview);
      
      deviceIds.forEach(targetId => {
        const cleanTargetId = String(targetId).trim().toLowerCase();
        
        for (let r = 1; r < devValues.length; r++) {
          const currentId = String(devValues[r][0] || "").trim().toLowerCase();
          if (currentId === cleanTargetId) {
            const rowIndex = r + 1;
            
            let newStatus = "";
            let newHolderId = "";
            let newHolderName = "";
            let newProjectTag = "";
            
            if (txType === "Mượn mới" || txType === "Nhận bàn giao tay đôi") {
              newStatus = "Đang mượn";
              newHolderId = userId;
              newHolderName = userName;
              newProjectTag = projectTag || devValues[r][11];
            } else if (txType === "Trả về kho") {
              newStatus = "Chờ kiểm định";
              newHolderId = "";
              newHolderName = "";
              newProjectTag = "";
            }
            
            setText(devSheet.getRange(rowIndex, 9), newStatus);
            setText(devSheet.getRange(rowIndex, 10), newHolderId);
            setText(devSheet.getRange(rowIndex, 11), newHolderName);
            setText(devSheet.getRange(rowIndex, 12), newProjectTag);
            setText(devSheet.getRange(rowIndex, 13), timestampStr);
            break;
          }
        }
      });
      
      // Bắn thông báo Telegram
      try {
        if (CONFIG.TELEGRAM_BOT_TOKEN && CONFIG.TELEGRAM_BOT_TOKEN !== "YOUR_TELEGRAM_BOT_TOKEN_HERE") {
          sendTelegramNotification({
            txId: txId,
            txType: txType,
            userId: userId,
            userName: userName,
            deviceIds: deviceIds.join(", "),
            projectTag: projectTag,
            checkedAccessories: checkedAccessories,
            returnCondition: returnCondition,
            note: note,
            timestampStr: timestampStr,
            photoUrl: directPhotoUrl
          });
        }
      } catch (teleErr) {
        Logger.log("Telegram notification error: " + teleErr.toString());
      }
      
      return createJsonResponse({
        success: true,
        tx_id: txId,
        photo_url: directPhotoUrl,
        message: `Giao dịch [${txType}] cho ${deviceIds.join(", ")} thành công!`
      });
    }
    
    return createJsonResponse({ success: false, message: `Hành động '${action}' không được hỗ trợ!` });
    
  } catch (error) {
    return createJsonResponse({ success: false, message: "Lỗi doPost: " + error.toString() });
  } finally {
    try {
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
  }
}

function sendTelegramNotification(data) {
  const icon = data.txType === "Mượn mới" ? "📤" : (data.txType === "Trả về kho" ? "📥" : "🤝");
  
  let caption = `<b>${icon} THÔNG BÁO BÀN GIAO THIẾT BỊ LAB</b>\n\n`;
  caption += `• <b>Mã GD:</b> <code>${data.txId}</code>\n`;
  caption += `• <b>Thao tác:</b> <b>${data.txType.toUpperCase()}</b>\n`;
  caption += `• <b>Người thực hiện:</b> ${data.userName} (<code>${data.userId}</code>)\n`;
  caption += `• <b>Thiết bị:</b> <code>${data.deviceIds}</code>\n`;
  
  if (data.projectTag) caption += `• <b>Mục đích/Đề tài:</b> 🏷️ <i>${data.projectTag}</i>\n`;
  if (data.checkedAccessories) caption += `• <b>Phụ kiện đã tích:</b> ✅ ${data.checkedAccessories}\n`;
  
  if (data.txType === "Trả về kho" && data.returnCondition) {
    const condIcon = data.returnCondition.includes("Tốt") ? "🟢" : (data.returnCondition.includes("Thiếu") ? "🟡" : "🔴 CẢNH BÁO");
    caption += `• <b>Tình trạng trả:</b> ${condIcon} <b>${data.returnCondition}</b>\n`;
  }
  
  if (data.note) caption += `• <b>Ghi chú:</b> 💬 <i>${data.note}</i>\n`;
  caption += `• <b>Thời gian:</b> 🕒 ${data.timestampStr}\n`;
  
  if (data.photoUrl && data.photoUrl.startsWith("http")) {
    const photoApiUrl = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendPhoto`;
    const photoPayload = {
      chat_id: CONFIG.TELEGRAM_CHAT_ID,
      photo: data.photoUrl,
      caption: caption,
      parse_mode: "HTML"
    };
    
    const response = UrlFetchApp.fetch(photoApiUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(photoPayload),
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      caption += `\n🔗 <a href="${data.photoUrl}">👉 Bấm vào đây để xem ảnh bàn giao</a>`;
      sendTextMessageFallback(caption);
    }
  } else {
    sendTextMessageFallback(caption);
  }
}

function sendTextMessageFallback(text) {
  const msgUrl = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
  UrlFetchApp.fetch(msgUrl, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      chat_id: CONFIG.TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: "HTML",
      disable_web_page_preview: false
    }),
    muteHttpExceptions: true
  });
}

/**
 * ======================================================================================
 * 3. initialSetup(): Khởi tạo sheet trống, không tạo tài khoản/thiết bị mẫu
 * ======================================================================================
 */
function initialSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Tạo hoặc cấu hình Sheet Devices
  let devSheet = ss.getSheetByName(CONFIG.SHEET_DEVICES);
  if (!devSheet) {
    devSheet = ss.insertSheet(CONFIG.SHEET_DEVICES);
  }
  if (devSheet.getLastRow() === 0) {
    const devHeaders = [
      "Mã thiết bị", "Tên thiết bị", "Danh mục", "Vị trí", "Phụ kiện đi kèm",
      "Ảnh chuẩn bàn giao", "Cảnh báo nguồn & Lưu ý", "Link tài liệu / Pinout",
      "Trạng thái", "MSSV giữ", "Họ tên người giữ", "Dự án / Mục đích", "Cập nhật lúc"
    ];
    appendTextRow(devSheet, devHeaders);
    devSheet.getRange(1, 1, 1, devHeaders.length).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
    devSheet.setFrozenRows(1);
    
  }
  
  // 2. Tạo hoặc cấu hình Sheet Users
  let userSheet = ss.getSheetByName(CONFIG.SHEET_USERS);
  if (!userSheet) {
    userSheet = ss.insertSheet(CONFIG.SHEET_USERS);
  }
  if (userSheet.getLastRow() === 0) {
    const userHeaders = ["MSSV / Mã nhân sự", "Mã PIN", "Họ và tên", "Số điện thoại", "Vai trò (ADMIN/INSPECTOR/STUDENT)", "Khóa"];
    appendTextRow(userSheet, userHeaders);
    userSheet.getRange(1, 1, 1, userHeaders.length).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
    userSheet.setFrozenRows(1);
    
  }
  
  // 3. Tạo hoặc cấu hình Sheet Logs
  let logSheet = ss.getSheetByName(CONFIG.SHEET_LOGS);
  if (!logSheet) {
    logSheet = ss.insertSheet(CONFIG.SHEET_LOGS);
  }
  if (logSheet.getLastRow() === 0) {
    const logHeaders = [
      "Thời gian", "Mã giao dịch", "Người thực hiện", "Hành động", "Danh sách thiết bị",
      "Dự án / Mục đích", "Phụ kiện kiểm tra", "Tình trạng", "Ghi chú sinh viên",
      "Link ảnh Drive", "Xem trước ảnh", "Trạng thái kiểm định", "Người kiểm định", "Ghi chú QA"
    ];
    appendTextRow(logSheet, logHeaders);
    logSheet.getRange(1, 1, 1, logHeaders.length).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
    logSheet.setFrozenRows(1);
  }
  
  inventoryUpgrade(ss);
  Logger.log("Đã khởi tạo sheet trống. Tạo tài khoản thật trong Users trước khi sử dụng.");
}
