import { db, i18nStringsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type Lang = "vi" | "en";

// In-memory cache to avoid repeated DB hits per message
let cache: Map<string, { vi: string; en: string }> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

async function loadCache(): Promise<Map<string, { vi: string; en: string }>> {
  const now = Date.now();
  if (cache && now - cacheLoadedAt < CACHE_TTL_MS) return cache;
  const rows = await db.select().from(i18nStringsTable);
  const m = new Map<string, { vi: string; en: string }>();
  for (const r of rows) {
    m.set(r.key, { vi: r.vi, en: r.en });
  }
  cache = m;
  cacheLoadedAt = now;
  return m;
}

export function invalidateI18nCache(): void {
  cache = null;
}

/**
 * Look up a translation key and return the text in the specified language.
 * Falls back to the key name if not found.
 */
export async function t(key: string, lang: Lang = "vi"): Promise<string> {
  const m = await loadCache();
  const entry = m.get(key);
  if (!entry) return key;
  return lang === "en" ? (entry.en || entry.vi || key) : (entry.vi || key);
}

/**
 * Look up multiple keys at once. Returns a Record<key, string>.
 */
export async function tMany(keys: string[], lang: Lang = "vi"): Promise<Record<string, string>> {
  const m = await loadCache();
  const result: Record<string, string> = {};
  for (const key of keys) {
    const entry = m.get(key);
    if (!entry) { result[key] = key; continue; }
    result[key] = lang === "en" ? (entry.en || entry.vi || key) : (entry.vi || key);
  }
  return result;
}

// ─── Default seed strings ───────────────────────────────────────────────────
// These are inserted on first run or when missing.
export const DEFAULT_STRINGS: Array<{ key: string; vi: string; en: string }> = [
  // ── Main menu / reply keyboard ──
  { key: "btn.buy", vi: "🛒 Mua hàng", en: "🛒 Shop" },
  { key: "btn.products", vi: "📋 Sản phẩm", en: "📋 Products" },
  { key: "btn.account", vi: "👤 Tài khoản", en: "👤 Account" },
  { key: "btn.topup", vi: "💰 Nạp ví", en: "💰 Top Up" },
  { key: "btn.voucher", vi: "🎟️ Voucher", en: "🎟️ Voucher" },
  { key: "btn.warranty", vi: "🛡️ Bảo hành", en: "🛡️ Warranty" },
  { key: "btn.support", vi: "💬 Hỗ trợ", en: "💬 Support" },
  { key: "btn.info", vi: "ℹ️ Thông tin", en: "ℹ️ Info" },

  // ── Inline keyboard buttons ──
  { key: "btn.browse_products", vi: "🛍️ Xem sản phẩm", en: "🛍️ Browse Products" },
  { key: "btn.my_orders", vi: "📦 Đơn hàng của tôi", en: "📦 My Orders" },
  { key: "btn.wallet_history", vi: "💳 Lịch sử ví", en: "💳 Wallet History" },
  { key: "btn.home", vi: "🏠 Trang chủ", en: "🏠 Home" },
  { key: "btn.back", vi: "⬅️ Quay lại", en: "⬅️ Back" },
  { key: "btn.check_again", vi: "🔄 Kiểm tra lại", en: "🔄 Check Again" },
  { key: "btn.view_other", vi: "🛒 Xem sản phẩm khác", en: "🛒 Browse Other Products" },
  { key: "btn.enter_qty", vi: "✏️ Nhập số lượng", en: "✏️ Enter Quantity" },
  { key: "btn.skip", vi: "⏭️ Bỏ qua", en: "⏭️ Skip" },
  { key: "btn.reuse", vi: "🔁 Dùng lại", en: "🔁 Reuse" },
  { key: "btn.buy_now", vi: "🛒 Mua ngay", en: "🛒 Buy Now" },
  { key: "btn.pay_wallet", vi: "💰 Trả bằng số dư", en: "💰 Pay with Balance" },
  { key: "btn.pay_bank", vi: "🏦 Chuyển khoản ngân hàng", en: "🏦 Bank Transfer" },
  { key: "btn.settings", vi: "⚙️ Cài đặt", en: "⚙️ Settings" },
  { key: "btn.language", vi: "🌐 Ngôn ngữ / Language", en: "🌐 Language / Ngôn ngữ" },

  // ── Language selection ──
  { key: "lang.prompt", vi: "🌐 Chào mừng! Vui lòng chọn ngôn ngữ:\n\nWelcome! Please choose your language:", en: "🌐 Welcome! Please choose your language:\n\nChào mừng! Vui lòng chọn ngôn ngữ:" },
  { key: "lang.vi", vi: "🇻🇳 Tiếng Việt", en: "🇻🇳 Tiếng Việt" },
  { key: "lang.en", vi: "🇬🇧 English", en: "🇬🇧 English" },
  { key: "lang.selected_vi", vi: "✅ Đã chuyển sang Tiếng Việt!", en: "✅ Switched to Vietnamese!" },
  { key: "lang.selected_en", vi: "✅ Switched to English!", en: "✅ Switched to English!" },

  // ── Welcome / home ──
  { key: "welcome.default", vi: "👋 Chào mừng <b>{name}</b> đến với {shop}!\n\nChọn tùy chọn bên dưới:", en: "👋 Welcome <b>{name}</b> to {shop}!\n\nChoose an option below:" },
  { key: "welcome.keyboard_ready", vi: "⌨️ Menu nhanh đã sẵn sàng — bấm nút bên dưới bất cứ lúc nào.", en: "⌨️ Quick menu is ready — press a button below anytime." },

  // ── Account ──
  { key: "account.title", vi: "👤 <b>TÀI KHOẢN CỦA BẠN</b>", en: "👤 <b>YOUR ACCOUNT</b>" },
  { key: "account.id", vi: "🆔 ID:", en: "🆔 ID:" },
  { key: "account.name", vi: "📛 Tên:", en: "📛 Name:" },
  { key: "account.username", vi: "💬 Username:", en: "💬 Username:" },
  { key: "account.no_username", vi: "(chưa có)", en: "(none)" },
  { key: "account.balance", vi: "💰 <b>Số dư ví:</b>", en: "💰 <b>Wallet Balance:</b>" },
  { key: "account.total_orders", vi: "📦 <b>Tổng đơn hàng:</b>", en: "📦 <b>Total Orders:</b>" },
  { key: "account.total_spent", vi: "💳 <b>Tổng chi tiêu:</b>", en: "💳 <b>Total Spent:</b>" },
  { key: "account.topup_cmd", vi: "<i>Nạp ví:</i> <code>/naptien [số tiền]</code>", en: "<i>Top up:</i> <code>/naptien [amount]</code>" },
  { key: "account.history_cmd", vi: "<i>Lịch sử ví:</i> <code>/lichsu</code>", en: "<i>Wallet history:</i> <code>/lichsu</code>" },

  // ── Topup ──
  { key: "topup.title", vi: "💰 <b>NẠP TIỀN VÀO VÍ</b>", en: "💰 <b>TOP UP WALLET</b>" },
  { key: "topup.instruction", vi: "Sử dụng lệnh: <code>/naptien [số tiền]</code>\nVí dụ: <code>/naptien 100000</code>", en: "Use command: <code>/naptien [amount]</code>\nExample: <code>/naptien 100000</code>" },
  { key: "topup.minimum", vi: "Số tiền nạp tối thiểu: <b>10.000đ</b>", en: "Minimum top-up: <b>10,000₫</b>" },
  { key: "topup.qr_note", vi: "Bot sẽ gửi mã QR để bạn quét và chuyển khoản.", en: "The bot will send a QR code for you to scan and transfer." },
  { key: "topup.invalid_amount", vi: "❌ Số tiền không hợp lệ. Vui lòng nhập số tiền dương.", en: "❌ Invalid amount. Please enter a positive number." },
  { key: "topup.min_error", vi: "❌ Số tiền nạp tối thiểu là 10.000đ.", en: "❌ Minimum top-up amount is 10,000₫." },
  { key: "topup.choose_amount", vi: "💳 <b>Nạp tiền vào tài khoản</b>\n\nChọn số tiền muốn nạp bên dưới hoặc gõ <code>/naptien [số tiền]</code>", en: "💳 <b>Top Up Account</b>\n\nChoose an amount below or type <code>/naptien [amount]</code>" },
  { key: "topup.bank_info", vi: "🏦 <b>THÔNG TIN CHUYỂN KHOẢN NẠP VÍ</b>", en: "🏦 <b>BANK TRANSFER DETAILS</b>" },
  { key: "topup.amount_label", vi: "Số tiền:", en: "Amount:" },
  { key: "topup.content_label", vi: "Nội dung CK:", en: "Transfer note:" },
  { key: "topup.content_warning", vi: "⚠️ <b>Vui lòng chuyển khoản đúng số tiền và ghi đúng nội dung để hệ thống tự động xác nhận!</b>", en: "⚠️ <b>Please transfer the exact amount with the correct note for automatic confirmation!</b>" },

  // ── Vouchers / promotions ──
  { key: "voucher.title", vi: "🎟️ <b>VOUCHER HIỆN CÓ</b>", en: "🎟️ <b>AVAILABLE VOUCHERS</b>" },
  { key: "voucher.none", vi: "<i>Hiện chưa có mã giảm giá nào đang hoạt động.</i>", en: "<i>No active vouchers available.</i>" },
  { key: "voucher.enter_hint", vi: "<i>Nhập mã khi đặt hàng để áp dụng.</i>", en: "<i>Enter a code at checkout to apply.</i>" },
  { key: "voucher.prompt", vi: "🎟️ <b>Nhập mã giảm giá (hoặc bỏ qua)</b>\n\nGõ mã giảm giá vào ô chat, hoặc bấm \"Bỏ qua\" để tiếp tục.", en: "🎟️ <b>Enter promo code (or skip)</b>\n\nType your promo code in the chat, or press \"Skip\" to continue." },
  { key: "voucher.last_used", vi: "Lần trước bạn đã dùng mã:", en: "You last used code:" },
  { key: "voucher.applied", vi: "✅ Đã áp dụng mã <b>{code}</b> — giảm <b>{amount}đ</b>", en: "✅ Code <b>{code}</b> applied — discount <b>{amount}₫</b>" },
  { key: "voucher.empty", vi: "Mã giảm giá trống.", en: "Promo code is empty." },
  { key: "voucher.not_found", vi: "Mã giảm giá không tồn tại.", en: "Promo code not found." },
  { key: "voucher.paused", vi: "Mã giảm giá đã bị tạm dừng.", en: "Promo code is currently paused." },
  { key: "voucher.not_started", vi: "Mã giảm giá chưa đến thời gian áp dụng.", en: "Promo code is not yet active." },
  { key: "voucher.expired", vi: "Mã giảm giá đã hết hạn.", en: "Promo code has expired." },
  { key: "voucher.max_uses", vi: "Mã giảm giá đã hết lượt sử dụng.", en: "Promo code has reached its usage limit." },
  { key: "voucher.invalid_value", vi: "Mã giảm giá chưa được cấu hình giá trị hợp lệ.", en: "Promo code has no valid discount value configured." },
  { key: "voucher.unsupported_type", vi: "Loại khuyến mãi này chưa hỗ trợ nhập mã. Vui lòng dùng mã giảm giá theo % hoặc số tiền cố định.", en: "This promotion type does not support manual codes. Please use a % or fixed-amount code." },
  { key: "voucher.no_discount", vi: "Mã giảm giá không tạo ra khoản giảm hợp lệ.", en: "Promo code does not produce a valid discount." },
  { key: "voucher.session_expired", vi: "⏱️ Phiên nhập mã đã hết hạn. Vui lòng thử mua lại.", en: "⏱️ Promo entry session expired. Please try again." },

  // ── Categories / Products ──
  { key: "cat.title", vi: "📂 <b>Danh mục sản phẩm:</b>", en: "📂 <b>Product Categories:</b>" },
  { key: "cat.none", vi: "❌ Hiện chưa có danh mục nào. Vui lòng quay lại sau.", en: "❌ No categories available. Please check back later." },
  { key: "prod.title", vi: "🛍️ <b>Danh sách sản phẩm:</b>", en: "🛍️ <b>Products:</b>" },
  { key: "prod.none", vi: "❌ Danh mục này chưa có sản phẩm.", en: "❌ No products in this category." },
  { key: "prod.not_found", vi: "❌ Sản phẩm không tồn tại.", en: "❌ Product not found." },
  { key: "prod.in_stock", vi: "✅ Còn hàng", en: "✅ In Stock" },
  { key: "prod.out_of_stock", vi: "❌ (Hết hàng)", en: "❌ (Out of Stock)" }, // parentheses distinguish it from the prod.none error style
  { key: "btn.browse_other", vi: "🛍️ Mua hàng khác", en: "🛍️ Browse Other Products" },
  { key: "prod.price_label", vi: "💰 Giá:", en: "💰 Price:" },
  { key: "prod.price", vi: "💰 Giá:", en: "💰 Price:" },
  { key: "prod.stock_label", vi: "📊 Tồn kho:", en: "📊 Stock:" },
  { key: "prod.stock", vi: "📊 Tồn kho:", en: "📊 Stock:" },
  { key: "prod.qty_label", vi: "🔢 Số lượng:", en: "🔢 Quantity:" },
  { key: "prod.qty_range", vi: "🔢 Số lượng:", en: "🔢 Quantity:" },
  { key: "prod.max_qty", vi: "Tối đa", en: "Max" },
  { key: "prod.enter_qty", vi: "✏️ Nhập số lượng", en: "✏️ Enter Quantity" },
  { key: "prod.stock_request", vi: "🔔 Yêu cầu hàng mới", en: "🔔 Request Stock" },
  { key: "prod.notify_request", vi: "🔔 Bạn muốn được thông báo khi sản phẩm <b>{name}</b> có hàng trở lại?", en: "🔔 Would you like to be notified when <b>{name}</b> is back in stock?" },
  { key: "prod.notify_registered", vi: "✅ Đã đăng ký nhận thông báo cho sản phẩm <b>{name}</b>!", en: "✅ You'll be notified when <b>{name}</b> is back in stock!" },
  { key: "prod.notify_already", vi: "ℹ️ Bạn đã đăng ký thông báo cho sản phẩm này rồi.", en: "ℹ️ You're already registered for notifications on this product." },
  { key: "prod.notify_btn", vi: "🔔 Thông báo khi có hàng", en: "🔔 Notify Me" },
  { key: "prod.notify_cancel_btn", vi: "❌ Hủy thông báo", en: "❌ Cancel Notification" },

  // ── Quantity ──
  { key: "qty.prompt", vi: "✏️ <b>Nhập số lượng muốn mua cho {name}</b>\n\nGõ một số từ <b>{min}</b> đến <b>{max}</b> vào ô chat.", en: "✏️ <b>Enter quantity for {name}</b>\n\nType a number from <b>{min}</b> to <b>{max}</b> in the chat." },
  { key: "qty.stock_info", vi: "Hiện còn <b>{n}</b> sản phẩm trong kho.", en: "Currently <b>{n}</b> in stock." },
  { key: "qty.invalid", vi: "❌ Số lượng không hợp lệ. Vui lòng nhập số từ {min} đến {max}.", en: "❌ Invalid quantity. Please enter a number from {min} to {max}." },
  { key: "qty.not_enough", vi: "❌ Không đủ hàng. Chỉ còn {n} sản phẩm.", en: "❌ Not enough stock. Only {n} available." },
  { key: "qty.session_expired", vi: "❌ Phiên nhập số lượng đã hết hạn. Vui lòng thử lại.", en: "❌ Quantity entry session expired. Please try again." },

  // ── Order / Checkout ──
  { key: "order.created", vi: "✅ <b>Đơn hàng #{code} đã tạo!</b>\n\nBạn muốn thanh toán bằng cách nào?", en: "✅ <b>Order #{code} created!</b>\n\nHow would you like to pay?" },
  { key: "order.bank_info_title", vi: "🏦 <b>Thông tin thanh toán:</b>", en: "🏦 <b>Payment Details:</b>" },
  { key: "order.bank_name", vi: "🏦 Ngân hàng:", en: "🏦 Bank:" },
  { key: "order.account_number", vi: "💳 Số tài khoản:", en: "💳 Account Number:" },
  { key: "order.account_holder", vi: "👤 Chủ TK:", en: "👤 Account Holder:" },
  { key: "order.amount", vi: "💰 Số tiền:", en: "💰 Amount:" },
  { key: "order.transfer_note", vi: "📝 Nội dung CK:", en: "📝 Transfer Note:" },
  { key: "order.transfer_warning", vi: "⚠️ <b>Vui lòng chuyển khoản đúng nội dung để đơn hàng được xử lý tự động.</b>", en: "⚠️ <b>Please use the exact transfer note for automatic order processing.</b>" },
  { key: "order.subtotal", vi: "🛒 Tạm tính:", en: "🛒 Subtotal:" },
  { key: "order.discount_label", vi: "🎟️ Mã giảm giá:", en: "🎟️ Promo Code:" },
  { key: "order.discount_amount", vi: "💸 Giảm giá:", en: "💸 Discount:" },
  { key: "order.total_paid", vi: "✅ Đã thanh toán:", en: "✅ Total Paid:" },
  { key: "order.no_payment_config", vi: "❌ Cửa hàng chưa cấu hình thanh toán. Vui lòng liên hệ admin.", en: "❌ The shop has not configured payment. Please contact admin." },
  { key: "order.wallet_paid", vi: "✅ Thanh toán bằng ví thành công! Đang xử lý đơn hàng của bạn...", en: "✅ Wallet payment successful! Processing your order..." },
  { key: "order.insufficient_balance", vi: "❌ Số dư ví không đủ. Số dư hiện tại: <b>{balance}đ</b>.", en: "❌ Insufficient wallet balance. Current balance: <b>{balance}₫</b>." },
  { key: "order.expired", vi: "❌ Đơn hàng không còn tồn tại hoặc đã hết hạn.", en: "❌ Order no longer exists or has expired." },
  { key: "order.already_paid", vi: "ℹ️ Đơn hàng này đã được thanh toán.", en: "ℹ️ This order has already been paid." },

  // ── Delivery / Receipt ──
  { key: "delivery.success", vi: "🎉 <b>Đơn hàng {code} đã giao thành công!</b>", en: "🎉 <b>Order {code} delivered successfully!</b>" },
  { key: "delivery.product_info", vi: "📦 <b>Thông tin sản phẩm:</b>", en: "📦 <b>Product Information:</b>" },
  { key: "delivery.thank_you", vi: "✅ <b>Cảm ơn bạn đã mua hàng!</b> 💚", en: "✅ <b>Thank you for your purchase!</b> 💚" },
  { key: "delivery.thank_you_retry", vi: "✅ Cảm ơn bạn đã kiên nhẫn chờ đợi! Xin lỗi vì sự chậm trễ.", en: "✅ Thank you for your patience! Sorry for the delay." },
  { key: "delivery.failed_title", vi: "⚠️ <b>Có lỗi xảy ra khi giao hàng</b>", en: "⚠️ <b>Delivery error occurred</b>" },
  { key: "delivery.failed_body", vi: "Đơn hàng #{code} không thể giao tự động. Chúng tôi đang xử lý và sẽ liên hệ bạn sớm nhất.", en: "Order #{code} could not be delivered automatically. We are processing it and will contact you soon." },
  { key: "delivery.restock_fulfilled", vi: "🎉 <b>Tin vui!</b> Đơn hàng <code>{code}</code> trước đây đang chờ nhập kho đã được giao tự động sau khi shop nhập thêm hàng. Vui lòng kiểm tra tin nhắn giao hàng phía trên. Cảm ơn bạn đã kiên nhẫn chờ đợi! 💚", en: "🎉 <b>Great news!</b> Your order <code>{code}</code> which was previously waiting for restock has now been delivered automatically. Please check the delivery message above. Thank you for your patience! 💚" },

  // ── Orders list ──
  { key: "orders.title", vi: "📦 <b>ĐƠN HÀNG CỦA BẠN</b>", en: "📦 <b>YOUR ORDERS</b>" },
  { key: "orders.none", vi: "Bạn chưa có đơn hàng nào.", en: "You have no orders yet." },
  { key: "orders.status.pending", vi: "🕐 Chờ thanh toán", en: "🕐 Awaiting payment" },
  { key: "orders.status.paid", vi: "✅ Đã thanh toán", en: "✅ Paid" },
  { key: "orders.status.delivered", vi: "📦 Đã giao", en: "📦 Delivered" },
  { key: "orders.status.cancelled", vi: "❌ Đã huỷ", en: "❌ Cancelled" },
  { key: "orders.status.needs_manual", vi: "⚠️ Chờ xử lý", en: "⚠️ Pending review" },
  { key: "orders.amount_label", vi: "Số tiền:", en: "Amount:" },

  // ── Wallet history ──
  { key: "wallet.title", vi: "💳 <b>Lịch sử ví</b>", en: "💳 <b>Wallet History</b>" },
  { key: "wallet.balance", vi: "👛 Số dư hiện tại:", en: "👛 Current Balance:" },
  { key: "wallet.none", vi: "Chưa có giao dịch ví nào.\nDùng /naptien để nạp tiền vào ví.", en: "No wallet transactions yet.\nUse /naptien to top up your wallet." },
  { key: "wallet.recent", vi: "giao dịch gần nhất:", en: "recent transactions:" },
  { key: "wallet.topup", vi: "⬆️ Nạp tiền", en: "⬆️ Top Up" },
  { key: "wallet.payment", vi: "⬇️ Thanh toán", en: "⬇️ Payment" },
  { key: "wallet.balance_after", vi: "Số dư sau:", en: "Balance after:" },

  // ── Warranty ──
  { key: "warranty.title", vi: "🛡️ <b>BẢO HÀNH</b>", en: "🛡️ <b>WARRANTY</b>" },
  { key: "warranty.default", vi: "Nhập <b>mã giao dịch</b> của đơn bạn đã mua để được hỗ trợ.\n<i>Ví dụ:</i> <code>FT26044904376607</code>\n\n• Nếu cần huỷ: gõ <code>/cancel</code>", en: "Enter your <b>transaction ID</b> from your purchase to get support.\n<i>Example:</i> <code>FT26044904376607</code>\n\n• To cancel: type <code>/cancel</code>" },

  // ── Support ──
  { key: "support.title", vi: "💬 <b>HỖ TRỢ KHÁCH HÀNG</b>", en: "💬 <b>CUSTOMER SUPPORT</b>" },
  { key: "support.default", vi: "📞 Liên hệ Admin: <i>(chưa cấu hình)</i>\n\n⏰ <b>Thời gian hỗ trợ:</b>\n8:00 - 23:00 hàng ngày\n\n📝 <b>Lưu ý:</b>\n• Gửi mã giao dịch khi cần hỗ trợ\n• Mô tả rõ vấn đề gặp phải\n• Chờ phản hồi trong 5-10 phút\n\nCảm ơn bạn đã tin tưởng shop!", en: "📞 Contact Admin: <i>(not configured)</i>\n\n⏰ <b>Support Hours:</b>\n8:00 AM - 11:00 PM daily\n\n📝 <b>Note:</b>\n• Send your transaction ID when requesting support\n• Describe your issue clearly\n• Wait 5-10 minutes for a response\n\nThank you for trusting us!" },

  // ── Info ──
  { key: "info.title", vi: "ℹ️ <b>VỀ CỬA HÀNG</b>", en: "ℹ️ <b>ABOUT US</b>" },
  { key: "info.default", vi: "🤖 <b>Giới thiệu:</b>\nBot bán hàng tự động hoạt động 24/7, giao hàng tức thì.\n\n✅ <b>Cam kết:</b>\n• Giao hàng tự động ngay lập tức\n• Sản phẩm chất lượng, giá tốt\n• Bảo hành theo từng sản phẩm\n• Hỗ trợ nhanh chóng\n\n💳 <b>Thanh toán:</b>\nChuyển khoản ngân hàng (QR)", en: "🤖 <b>About:</b>\nAutomated 24/7 shop bot with instant delivery.\n\n✅ <b>Commitments:</b>\n• Instant automatic delivery\n• Quality products at good prices\n• Product warranty included\n• Fast support\n\n💳 <b>Payment:</b>\nBank transfer (QR code)" },

  // ── Restock notifications (broadcast) ──
  { key: "restock.notify_title", vi: "🔔 <b>Sản phẩm vừa có hàng!</b>", en: "🔔 <b>Product Back in Stock!</b>" },
  { key: "restock.notify_body", vi: "📦 <b>{name}</b>\n💰 Giá: <b>{price}đ</b>\n\nBấm nút bên dưới để mua ngay!", en: "📦 <b>{name}</b>\n💰 Price: <b>{price}₫</b>\n\nPress the button below to buy now!" },

  // ── Errors / generic ──
  { key: "error.generic", vi: "❌ Đã xảy ra lỗi. Vui lòng thử lại sau.", en: "❌ An error occurred. Please try again later." },
  { key: "error.payment_not_configured", vi: "❌ Cửa hàng chưa cấu hình thanh toán.", en: "❌ Payment is not configured for this shop." },

  // ── Buttons (additional) ──
  { key: "btn.continue_shopping", vi: "🛍️ Tiếp tục mua hàng", en: "🛍️ Continue Shopping" },
  { key: "btn.cancel_order", vi: "❌ Hủy đơn hàng", en: "❌ Cancel Order" },
  { key: "btn.enter_promo", vi: "🎟️ Nhập mã giảm giá", en: "🎟️ Enter Promo Code" },
  { key: "btn.place_order", vi: "✅ Đặt hàng", en: "✅ Place Order" },
  { key: "btn.clear_promo", vi: "❌ Bỏ mã: {code}", en: "❌ Remove Code: {code}" },

  // ── Order / checkout (additional) ──
  { key: "order.invalid_qty", vi: "❌ Số lượng không hợp lệ. Mua từ {min} đến {max}.", en: "❌ Invalid quantity. Orders must be from {min} to {max}." },
  { key: "order.not_found", vi: "❌ Không tìm thấy đơn hàng.", en: "❌ Order not found." },
  { key: "order.bank_invalid", vi: "❌ Đơn hàng không còn hợp lệ để thanh toán.", en: "❌ Order is no longer valid for payment." },
  { key: "order.bank_config_error", vi: "❌ Không thể tạo thông tin thanh toán. Vui lòng liên hệ admin.", en: "❌ Cannot generate payment details. Please contact admin." },
  { key: "order.contact_admin", vi: "✅ Đơn hàng <b>{code}</b> đã tạo! Vui lòng liên hệ admin để thanh toán.", en: "✅ Order <b>{code}</b> created! Please contact admin to complete payment." },
  { key: "order.cancel_success", vi: "✅ Đơn hàng <b>#{code}</b> đã được hủy thành công.\n\nTồn kho đã được hoàn trả. Bạn có thể đặt hàng lại bất cứ lúc nào.", en: "✅ Order <b>#{code}</b> successfully cancelled.\n\nStock has been restored. You can place a new order anytime." },
  { key: "order.cancel_cannot", vi: "❌ Đơn hàng <b>#{code}</b> không thể hủy vì {status}.", en: "❌ Order <b>#{code}</b> cannot be cancelled: {status}." },
  { key: "order.no_pending_cancel", vi: "ℹ️ Bạn không có đơn hàng nào đang chờ thanh toán để hủy.", en: "ℹ️ You have no pending orders to cancel." },
  { key: "order.product_line", vi: "📦 Sản phẩm: {product} x{qty}", en: "📦 Product: {product} x{qty}" },
  { key: "order.total_line", vi: "💰 Tổng tiền: <b>{amount}đ</b>", en: "💰 Total: <b>{amount}₫</b>" },
  { key: "order.wallet_balance_line", vi: "👛 Số dư ví: <b>{balance}đ</b>", en: "👛 Wallet Balance: <b>{balance}₫</b>" },
  { key: "order.payment_choice", vi: "Bạn muốn thanh toán bằng cách nào?", en: "How would you like to pay?" },
  { key: "order.subtotal_line", vi: "🧾 Tạm tính: <s>{amount}đ</s>", en: "🧾 Subtotal: <s>{amount}₫</s>" },
  { key: "order.promo_line", vi: "🎟️ Mã giảm giá: <code>{code}</code> (−{amount}đ)", en: "🎟️ Promo Code: <code>{code}</code> (−{amount}₫)" },
  { key: "order.bank_transfer_title", vi: "🏦 <b>Thanh toán chuyển khoản cho đơn {code}</b>", en: "🏦 <b>Bank Transfer for Order {code}</b>" },
  { key: "order.bank_scan_hint", vi: "📱 <i>Quét mã QR bên trên hoặc chuyển khoản theo thông tin trên.</i>", en: "📱 <i>Scan the QR code above or transfer using the details above.</i>" },
  { key: "order.low_balance_hint", vi: "💡 <i>Số dư ví {balance}đ chưa đủ để thanh toán. Nạp thêm bằng /naptien để thanh toán nhanh hơn.</i>", en: "💡 <i>Wallet balance {balance}₫ is not enough. Top up via /naptien for faster checkout.</i>" },
  { key: "order.status.paid_label", vi: "đã thanh toán", en: "already paid" },
  { key: "order.status.delivered_label", vi: "đã giao", en: "already delivered" },
  { key: "order.status.cancelled_label", vi: "đã bị hủy trước đó", en: "already cancelled" },
  { key: "order.status.failed_label", vi: "đã thất bại", en: "failed" },

  // ── Products (additional) ──
  { key: "prod.out_of_stock_req", vi: "❌ <b>{name}</b> hiện đã hết hàng.\n\nBạn có thể yêu cầu shop nhập thêm hàng.", en: "❌ <b>{name}</b> is currently out of stock.\n\nYou can request the shop to restock." },
  { key: "prod.not_enough_qty", vi: "❌ Không đủ hàng. Chỉ còn <b>{n}</b> sản phẩm. Vui lòng chọn số lượng phù hợp.", en: "❌ Not enough stock. Only <b>{n}</b> available. Please choose a smaller quantity." },
  { key: "prod.out_of_stock_race", vi: "❌ <b>{name}</b> đã hết hàng vào lúc xác nhận đơn. Vui lòng thử lại.", en: "❌ <b>{name}</b> sold out just before your order was confirmed. Please try again." },
  { key: "prod.not_enough_reuse", vi: "❌ Sản phẩm không còn đủ hàng. Vui lòng chọn lại.", en: "❌ Product no longer has enough stock. Please try again." },

  // ── Stock requests ──
  { key: "stock_req.duplicate", vi: "🔔 <b>Yêu cầu đã được ghi nhận trước đó</b>\n\nBạn đã gửi yêu cầu cho sản phẩm {icon} <b>{name}</b> rồi.\n\nChúng tôi sẽ thông báo ngay khi có hàng. Hãy quay lại kiểm tra sau nhé! 🙏", en: "🔔 <b>Request already registered</b>\n\nYou already submitted a request for {icon} <b>{name}</b>.\n\nWe'll notify you as soon as it's back in stock. Check back later! 🙏" },
  { key: "stock_req.confirmed", vi: "✅ <b>Đã ghi nhận yêu cầu của bạn!</b>\n\n{icon} <b>{name}</b> hiện đang hết hàng.\n\nChúng tôi đã nhận được yêu cầu và sẽ bổ sung sớm nhất có thể. Hãy quay lại kiểm tra sau nhé! 🙏", en: "✅ <b>Request received!</b>\n\n{icon} <b>{name}</b> is currently out of stock.\n\nWe've noted your request and will restock as soon as possible. Check back later! 🙏" },
  { key: "stock_req.daily_limit", vi: "⚠️ <b>Bạn đã dùng hết {limit} lượt yêu cầu hàng trong ngày hôm nay.</b>\n\nVui lòng quay lại vào ngày mai hoặc chọn sản phẩm khác.", en: "⚠️ <b>You've used all {limit} stock requests for today.</b>\n\nPlease come back tomorrow or browse other products." },

  // ── Quantity (additional) ──
  { key: "qty.stock_hint", vi: "\nHiện còn {n} trong kho.", en: "\n{n} currently in stock." },
  { key: "qty.invalid_typed", vi: "❌ Số lượng không hợp lệ. Vui lòng nhập một số từ <b>{min}</b> đến <b>{max}</b>.", en: "❌ Invalid quantity. Please enter a number from <b>{min}</b> to <b>{max}</b>." },
  { key: "qty.over_stock", vi: "❌ Chỉ còn <b>{n}</b> sản phẩm trong kho. Vui lòng nhập từ <b>{min}</b> đến <b>{n}</b>.", en: "❌ Only <b>{n}</b> in stock. Please enter a number from <b>{min}</b> to <b>{n}</b>." },

  // ── Wallet (additional) ──
  { key: "wallet.out_of_stock", vi: "❌ Sản phẩm đã hết hàng. Đơn hàng đã bị hủy và bạn không bị tính phí.", en: "❌ Product is out of stock. The order has been cancelled and you have not been charged." },
  { key: "wallet.insufficient", vi: "❌ Số dư ví không đủ. Vui lòng nạp thêm hoặc chuyển khoản ngân hàng.", en: "❌ Insufficient wallet balance. Please top up or pay by bank transfer." },
  { key: "wallet.order_invalid", vi: "❌ Đơn hàng không còn hợp lệ để thanh toán bằng ví.", en: "❌ Order is no longer valid for wallet payment." },
  { key: "wallet.recent_n", vi: "{n} giao dịch gần nhất:", en: "{n} recent transactions:" },
  { key: "wallet.balance_after_line", vi: "   👛 Số dư sau: <b>{amount}đ</b>", en: "   👛 Balance after: <b>{amount}₫</b>" },

  // ── Top-up (additional) ──
  { key: "topup.choose_balance_msg", vi: "💳 <b>Nạp tiền vào tài khoản</b>\n\n👛 Số dư hiện tại: <b>{balance}đ</b>\n\nChọn số tiền muốn nạp bên dưới hoặc gõ <code>/naptien [số tiền]</code> để nhập số tiền tuỳ chọn.\nVí dụ: <code>/naptien 100000</code>", en: "💳 <b>Top Up Account</b>\n\n👛 Current Balance: <b>{balance}₫</b>\n\nChoose an amount below or type <code>/naptien [amount]</code> for a custom amount.\nExample: <code>/naptien 100000</code>" },
  { key: "topup.invalid_example", vi: "❌ Số tiền không hợp lệ. Vui lòng nhập số tiền dương.\nVí dụ: <code>/naptien 100000</code>", en: "❌ Invalid amount. Please enter a positive number.\nExample: <code>/naptien 100000</code>" },
  { key: "topup.no_config", vi: "❌ Không thể tạo yêu cầu nạp tiền. Vui lòng liên hệ admin.", en: "❌ Cannot create top-up request. Please contact admin." },
  { key: "topup.caption", vi: "💳 <b>Nạp tiền {amount}đ</b>\n\n🏦 Ngân hàng: <b>{bank}</b>\n💳 Số tài khoản: <code>{account}</code>\n👤 Chủ tài khoản: <b>{holder}</b>\n💰 Số tiền: <b>{amount}đ</b>\n📝 Nội dung CK: <code>{ref}</code>\n\n⚠️ <i>Vui lòng chuyển khoản đúng nội dung để hệ thống tự động cộng tiền vào tài khoản.</i>", en: "💳 <b>Top Up {amount}₫</b>\n\n🏦 Bank: <b>{bank}</b>\n💳 Account Number: <code>{account}</code>\n👤 Account Holder: <b>{holder}</b>\n💰 Amount: <b>{amount}₫</b>\n📝 Transfer Note: <code>{ref}</code>\n\n⚠️ <i>Please use the exact transfer note for automatic balance credit.</i>" },

  // ── Orders list (additional) ──
  { key: "orders.recent_title", vi: "📦 <b>Đơn hàng gần đây:</b>", en: "📦 <b>Recent Orders:</b>" },
  { key: "orders.status.failed_label", vi: "❌ Lỗi", en: "❌ Failed" },
  { key: "orders.status.needs_manual_label", vi: "⚠️ Cần xử lý", en: "⚠️ Needs review" },
  { key: "orders.amount_suffix", vi: "đ", en: "₫" },

  // ── Delivery (additional) ──
  { key: "delivery.product_line", vi: "📦 {name} x{qty}", en: "📦 {name} x{qty}" },
  { key: "delivery.subtotal_line", vi: "🧾 Tạm tính: <s>{amount}đ</s>", en: "🧾 Subtotal: <s>{amount}₫</s>" },
  { key: "delivery.promo_line", vi: "🎟️ Mã giảm giá: <code>{code}</code> (−{amount}đ)", en: "🎟️ Promo Code: <code>{code}</code> (−{amount}₫)" },
  { key: "delivery.discount_line", vi: "🎟️ Giảm giá: −{amount}đ", en: "🎟️ Discount: −{amount}₫" },
  { key: "delivery.paid_wallet", vi: "💰 Đã thanh toán: <b>{amount}đ</b> (ví)", en: "💰 Paid: <b>{amount}₫</b> (wallet)" },

  // ── Promo code entry ──
  { key: "promo.entry_prompt", vi: "🎟️ <b>Nhập mã giảm giá của bạn</b>\n<i>Gõ mã vào ô chat bên dưới. Nhấn \"Bỏ qua\" nếu không có mã.</i>", en: "🎟️ <b>Enter your promo code</b>\n<i>Type your code below. Press \"Skip\" if you don't have one.</i>" },
  { key: "promo.invalid_retry", vi: "❌ {error}\n\n<i>Hãy thử mã khác hoặc bấm \"Bỏ qua\" bên dưới.</i>", en: "❌ {error}\n\n<i>Try another code or press \"Skip\" below.</i>" },
  { key: "promo.reuse_invalid", vi: "❌ Mã <code>{code}</code> không còn dùng được: {error}", en: "❌ Code <code>{code}</code> is no longer valid: {error}" },
  { key: "promo.reuse_oos", vi: "❌ Sản phẩm không còn đủ hàng. Vui lòng chọn lại.", en: "❌ Product no longer has enough stock. Please try again." },
  { key: "promo.not_found", vi: "Mã giảm giá không tồn tại.", en: "Promo code not found." },

  // ── Session / misc ──
  { key: "qty.session_expired_short", vi: "⏰ Phiên đã hết hạn. Vui lòng chọn lại sản phẩm.", en: "⏰ Session expired. Please select the product again." },
  { key: "qty.session_expired_qty", vi: "⏰ Phiên nhập số lượng đã hết hạn. Vui lòng chọn lại sản phẩm.", en: "⏰ Quantity entry session expired. Please select the product again." },
];

/**
 * Ensure all default strings are present in the DB. Runs at server startup.
 * Only inserts rows that don't exist — existing customisations are preserved.
 */
export async function seedDefaultStrings(): Promise<void> {
  if (DEFAULT_STRINGS.length === 0) return;
  await db
    .insert(i18nStringsTable)
    .values(DEFAULT_STRINGS.map(s => ({ key: s.key, vi: s.vi, en: s.en })))
    .onConflictDoNothing();
  invalidateI18nCache();
}
