# MSAS V6 — Bàn giao hệ thống (2026-11-19)

**Nhánh:** `feat/v6-realtime-structure-tv-chart` (tách từ `main` @ `3e218ab`). **Chưa commit / chưa push / chưa merge** — chủ dự án tự review và commit.
**Trạng thái:** Engine V6 hoàn tất và đã kiểm chứng bằng test thực thi. UI mới đã viết xong nhưng **chưa chạy trên trình duyệt** vì còn thiếu 2 bước cài đặt (mục 6).

Tài liệu này thay thế `MSAS_FULL_HANDOVER_2026-11-19.md` (bản đó ghi PR #2 "chưa merge" — thực tế PR #2 **đã merge vào main** và làm hỏng main: 7/8 test Node fail).

---

## 1. Hạn chế của lần làm trước (PR #2) — đã xác minh

| # | Hạn chế | Bằng chứng | Hậu quả |
|---|---|---|---|
| 1 | Merge vào `main` khi chưa chạy test | `main @3e218ab`: 7/8 test Node FAIL, `qa_gate.py` crash (`stdout` None) | main không phát hành được |
| 2 | **Lookahead / repaint**: `confirmed = path` tính trên toàn bộ dữ liệu, pivot sau thay pivot trước | `Full vs prefix mismatch BTCUSD@44`; XAU40 dùng SL-17 ở bar 15 (SL-17 chỉ biết ở bar 18) | Replay hiển thị thông tin tương lai |
| 3 | Chỉ ẩn tín hiệu ở UI, engine vẫn phát C/B/internal như tín hiệu chính | không có trường `primary` | Export/JSON vẫn nhiễu |
| 4 | Không sửa `advanced_engine.js` | MH/ML vẫn chờ cặp đỉnh–đáy | độ trễ Major vẫn còn |
| 5 | Zoom/pan tự viết, trục giá tính 80 nến cuối bất kể vùng đang xem | `rangeFor(index)` | kéo về quá khứ thì nến ra khỏi khung |
| 6 | Không có test hiệu năng; replay tính lại toàn bộ prefix mỗi nến (O(n²)) | `getAnalysis(i)` | chậm với dữ liệu dài |
| 7 | Lỗi có sẵn từ bản gốc, chưa ai phát hiện: gán MH/ML bằng một mức mà Close đã vượt qua | BTC bar 28: Close 73865.2 phá SH-16, cùng bar gán MH = SH-22 (73845.8) → bar 29 báo "continuation" lần 2 | thông báo lặp |

## 2. Những gì V6 làm (map với 15 yêu cầu)

| Yêu cầu | Cách giải quyết | Trạng thái |
|---|---|---|
| 1–2 Không hiện giá MH/ML/iSH/iSL trên bảng | Bảng chỉ còn Main/Internal trend + phase; giá chỉ có trên chart (price line) | Code xong, test node PASS; browser **chưa chạy** |
| 3 Thông báo gọn | Engine gắn `primary:true` chỉ cho `major_established` / `major_continuation` / `major_reversal` (S+); feed = 1 thẻ chính + tối đa 5 dòng, khử trùng lặp, không in giá | Engine PASS; UI chưa chạy browser |
| 4 40 nến cố định, nến 41 đẩy nến 1 ra | Follow-live: vùng logic `[t-39, t]` | Smoke test viết sẵn (đòi đúng 40 nến), **chưa chạy** |
| 5–6 Zoom/pan/tương tác kiểu TradingView | Dùng **TradingView Lightweight Charts 4.2.3** (thư viện mã nguồn mở của TradingView): wheel zoom theo con trỏ, kéo, kinetic scroll, crosshair + nhãn giá/thời gian, kéo trục giá, pinch, legend OHLC, nút "Go to live" / double-click | **Chưa chạy** (thiếu file thư viện) |
| 7, 10, 14 SH không phải chờ SL | SH/SL 3 nến được công nhận ngay khi nến phải đóng (`i+1`) | PASS (`test_v6_rules.js` T01–T03) |
| 8, 11 Inside Bar + nến thoát | Nến con trong biên mẹ bị loại vĩnh viễn; nến mẹ bị nến con chạm bằng đỉnh/đáy → công nhận ngay tại nến thoát (`rule:'inside_compressed'`); nến thoát cả 2 phía → không tạo pivot | PASS (T05, T06, T06b, T08) |
| 9, 14 SH/SL nhanh → MH/ML nhanh | MH/ML cập nhật độc lập ngay khi pivot được nhận | PASS; xem bảng độ trễ mục 3 |
| 12 Nến phá MH là MH ngay | Sự kiện phá được phát **ngay tại nến đóng cửa phá**; nến phá được hiển thị là **MH? tạm thời** (`provisionalHigh`, nét đứt) đến khi có SH 3 nến thật (thường chỉ 1 nến sau). Không giả làm pivot đã xác nhận để tránh vẽ sai. | PASS (T09, T12) |
| 13 Lưu dạng string, truy xuất liên tục, loại bỏ dữ liệu cũ | `frame.active = {SH,SL,MH,ML,iSH,iSL}` là id string (`SH-27`); mức cũ rời khỏi `active` nhưng còn trong audit append-only (`pivots`, `roleChanges`) | PASS (`test_v6_causal_stream.js`) |
| 15 Sau khi phá đáy, SL thành ML | Xu hướng giảm: Close dưới ML → SL mới thấp hơn được gán ML ngay khi nhận diện | PASS (XAU40 bar 13, 18) |
| MSS/CISD chỉ theo MH/ML | S+ chỉ khi Close vượt MH/ML đang hoạt động (tolerance 0); C/B giữ trong audit với `primary:false`, chỉ hiện trên chart khi bật lớp "Diagnostics" | PASS (T11, T19) |

## 3. Độ trễ Major — trước và sau (cùng dữ liệu, chạy engine thật)

| Dataset | Mốc | Bản gốc (`f0bcda7`) | V6 |
|---|---|---|---|
| XAU40 | Khởi tạo Major | bar 10 | bar 9 |
| XAU40 | Cặp SH-9/SL-12 | bar 15 | bar 13 |
| XAU40 | Cặp SH-14/SL-17 | bar 19 | bar 18 |
| XAU48 | MH = SH-34 | bar 40 | **bar 35** |
| XAU48 | ML = SL-37 | bar 40 | bar 38 |
| BTC | continuation lặp | 28 + 31 (lặp) | chỉ 28 |

Mốc giá do người dùng duyệt **giữ nguyên**: XAU40@24 DOWN MH 4001.50 / ML 3991.10; XAU48@40 và @47 UP MH 3396.648 / ML 3373.545.
Thông báo chính sau V6: XAU48 còn **2** (established 27, reversal S+ 30); BTC còn 4; XAU40 còn 7.

## 4. Kiến trúc và dòng dữ liệu

```
CSV/JSON → app/importer.py (chuẩn hóa, không bịa dữ liệu)
        → AdvancedStructureEngine.createStream().push(bar)   // mỗi nến ĐÃ ĐÓNG, O(1) khấu hao
              ├─ lớp local: 3 nến + Inside Bar (gộp cụm), pivot bất biến
              ├─ path xen kẽ nhân quả (thay pivot cùng loại cực trị hơn → sự kiện 'replace')
              ├─ Major: phá bằng Close → sự kiện; MH/ML độc lập; PX tạm thời
              └─ Internal
        → frames[t] + events (primary true/false) + pivots + roleChanges (append-only)
        → studio.js (Lightweight Charts) chỉ đọc dữ liệu ≤ t
        → scripts/export_structure.js → audits/*.json (analysis_version market_structure_advanced_v2_0)
```

Frame contract (UI phụ thuộc chính xác):
```
{ at,
  external:{trend, phase, majorHigh, majorLow, breakAt, breakLevel, provisionalHigh, provisionalLow},
  internal:{trend, phase, internalHigh, internalLow, protectedHigh, protectedLow, confirmed},
  active:{SH, SL, MH, ML, iSH, iSL},   // id string hoặc null
  lastPrimary }
Level = {id, index, type, price, confirmedAt}
event = {id, at, kind, layer, title, detail, severity, source, refs, data, primary}
pivot = {id, type, index, price, recognizedAt, status, rule}
```

Chính sách Major (tolerance 0, Close nghiêm ngặt; chi tiết: `docs/advanced/MAJOR_PIVOT_SELECTION.md` mục V6):
- Close vượt mức Major đang hoạt động được xét **trước** → S+ (đảo chiều) hoặc continuation tại chính nến đó.
- Phía cực trị (MH khi tăng / ML khi giảm): chờ, hiển thị PX; pivot vượt mức gãy được gán ngay khi nhận diện.
- Phía điều chỉnh: TĂNG → ML = SL thấp nhất **sau** MH; GIẢM → MH = SH thấp hơn gần nhất **trước** ML mới. (Bất đối xứng — xem mục 7.)
- Một pivot đã bị Close vượt qua không bao giờ được gán MH/ML.
- Râu vượt (không có Close) không bao giờ thăng cấp.

Hiệu năng: 25.000 nến `replayAll` ≈ 0,85 s, heap ≈ 57 MB (`tests/test_v6_perf.js`, ngân sách < 3 s).

## 5. Kết quả kiểm chứng (chạy thật trên máy này, 2026-11-19)

| Cổng | Kết quả |
|---|---|
| `python scripts/qa_gate.py --stress --require-node` | **19 PASS, 1 FAIL** — FAIL duy nhất: `test_ui_theme_i18n.js` "vendored Lightweight Charts missing" |
| `python -m pytest -q tests` | **31 passed** |
| Stress QA | PASS — 360 case, 181.841 assertion, policyGaps 0 |
| Prefix invariance | PASS — 3.492 prefix trên mọi dataset trong `samples/` và `fixtures/` |
| Test UI (bỏ riêng 2 assertion file thư viện, bản nháp) | PASS (theme, EN/VI, feed chỉ primary, không giá trong bảng) |
| Browser smoke desktop/mobile, standalone dist, Docker | **CHƯA CHẠY** |

Các mốc thời gian test được dời (chỉ dời **sớm hơn**, có chú thích `// V6 user amendment 2026-11-19`): XAU40 SH-14/SL-17 19→18; XAU48 SL-37 40→38; SL-38 nguồn PPT: chờ vô hạn → bar 39.

## 6. Việc bạn cần làm để hoàn tất (bị chặn bởi lớp quyền, tôi không vượt qua)

Agent con bị từ chối copy file từ thư mục `dist` của gói npm và chạy `pip install`. Chạy từ thư mục repo:

```bash
cp "C:/HT/data/temp/msas_v6/npm/package/dist/lightweight-charts.standalone.production.js" static/vendor/lightweight-charts-4.2.3.standalone.production.js
pip install -r requirements-qa.txt && python -m playwright install chromium
python scripts/qa_gate.py --stress --require-node          # kỳ vọng 20/20 PASS
python scripts/qa_gate.py --browser --require-node
python scripts/build_standalone.py && python scripts/build_standalone.py   # so byte 2 lần
docker compose up --build -d                                # rồi kiểm /api/health
```

Sau đó xem ảnh chụp (desktop 1280 / mobile 390), commit trên nhánh, mở PR vào `main`, chờ CI xanh rồi mới merge.

## 7. Câu hỏi mở cần chủ dự án quyết (đánh dấu PROVISIONAL)

1. **Nến mẹ có nến con nằm hẳn bên trong** (không chạm đỉnh/đáy): hiện được công nhận SH/SL ở `m+1` (nhanh). QA cố vấn đọc slide Inside Bar cho rằng phải chờ nến thoát biên. Chọn: nhanh hơn hay đúng slide?
2. **Ghép cặp bất đối xứng:** TĂNG lấy ML *sau* MH, GIẢM lấy MH *trước* ML. Slide nâng cao (S11/S13/S14) ghép pivot *trước* cho cả hai chiều; nhưng nếu làm đối xứng thì XAU48 bị đảo chiều sai ở bar 37 (ML = SL-31 3384.648 bị Close 3382.348 phá), trái với nhãn bạn đã duyệt. Cần thêm ví dụ có nhãn để thống nhất.
3. **Đảo chiều S+:** giữ MH = cao nhất của {MH cũ, các SH sau nó}; slide nói giữ nguyên MH cũ.
4. Khi nhiều ứng viên Major bằng giá nhau; cấu trúc Internal nhiều cấp; ranh giới sóng CISD.
5. Khoảng cách thân nến: Lightweight Charts 4.2.3 không cho chỉnh tỷ lệ thân/khoảng; hiện dùng mặc định của thư viện.

## 8. Nợ kỹ thuật

- `static/advanced_engine.js` còn ~400 dòng hàm V5 không còn được gọi (API công khai đi qua V6). Xóa trong lần dọn dẹp riêng, sau khi browser gate xanh.
- Nhảy/kéo thanh timeline vẫn `setData` O(n) mỗi khung hình (đã gộp bằng requestAnimationFrame).
- Chưa có dữ liệu thị trường có nhãn độc lập: mọi PASS chứng minh tính nhân quả và nhất quán, **không** chứng minh độ đúng giao dịch.

## 9. Ai làm gì trong phase này

| Phần | Executor |
|---|---|
| Chẩn đoán, quyết định kiến trúc/chính sách, kiểm chứng lại mọi cổng, file này | Claude (phiên chính) |
| Viết lại engine (2 vòng), test V6, stress, audit, tài liệu quy tắc | Codex (gpt-5.6, effort high) |
| Chart/UI Lightweight Charts, i18n, smoke test | Claude Sonnet |
| QA cố vấn đối chiếu PPT; review UI độc lập | Claude Sonnet (chỉ đọc) |
| Local model | Không dùng được: khởi động gateway bị auto-mode classifier từ chối |
