import { useGetOrder, getGetOrderQueryKey } from "@workspace/api-client-react";
import { formatVND, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, Package, User, CreditCard, Receipt, RefreshCw } from "lucide-react";
import { Link } from "wouter";

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-emerald-500/10 text-emerald-500",
  delivered: "bg-emerald-500/10 text-emerald-500",
  pending: "bg-yellow-500/10 text-yellow-500",
  cancelled: "bg-destructive/10 text-destructive",
  expired: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<string, string> = {
  paid: "Đã thanh toán",
  delivered: "Đã giao hàng",
  pending: "Chờ thanh toán",
  cancelled: "Đã hủy",
  expired: "Hết hạn",
};

const RETRY_ACTION_LABELS: Record<string, string> = {
  delivery_failed: "Giao thất bại",
  retry_delivery_sent: "Thử lại thủ công – thành công",
  restock_retry_triggered: "Kích hoạt thử lại do nhập hàng",
  restock_retry_delivered: "Thử lại sau nhập hàng – thành công",
  restock_retry_failed: "Thử lại sau nhập hàng – thất bại",
  scheduled_retry_delivered: "Thử lại tự động – thành công",
  scheduled_retry_failed: "Thử lại tự động – thất bại",
  scheduled_retry_exception: "Thử lại tự động – lỗi hệ thống",
};

const RETRY_ACTION_COLORS: Record<string, string> = {
  delivery_failed: "bg-destructive/10 text-destructive",
  retry_delivery_sent: "bg-emerald-500/10 text-emerald-500",
  restock_retry_triggered: "bg-blue-500/10 text-blue-500",
  restock_retry_delivered: "bg-emerald-500/10 text-emerald-500",
  restock_retry_failed: "bg-destructive/10 text-destructive",
  scheduled_retry_delivered: "bg-emerald-500/10 text-emerald-500",
  scheduled_retry_failed: "bg-yellow-500/10 text-yellow-500",
  scheduled_retry_exception: "bg-destructive/10 text-destructive",
};

const TX_TYPE_LABELS: Record<string, string> = {
  deposit: "Nạp tiền",
  purchase: "Mua hàng",
  refund: "Hoàn tiền",
  manual_credit: "Cộng thủ công",
  payment: "Thanh toán",
};

const TX_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-500",
  confirmed: "bg-blue-500/10 text-blue-500",
  completed: "bg-emerald-500/10 text-emerald-500",
  delivered: "bg-emerald-500/10 text-emerald-500",
  failed: "bg-destructive/10 text-destructive",
};

const TX_STATUS_LABELS: Record<string, string> = {
  pending: "Đang xử lý",
  confirmed: "Đã xác nhận",
  completed: "Hoàn thành",
  delivered: "Đã giao",
  failed: "Thất bại",
};

export default function OrderDetails({ params }: { params: { id: string } }) {
  const orderId = parseInt(params.id);
  
  const { data: order, isLoading } = useGetOrder(orderId, {
    query: { enabled: !!orderId, queryKey: getGetOrderQueryKey(orderId) }
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!order) return <div className="text-center py-10">Không tìm thấy đơn hàng</div>;

  const statusColor = STATUS_COLORS[order.status] ?? "bg-muted text-muted-foreground";
  const statusLabel = STATUS_LABELS[order.status] ?? order.status;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/orders">
          <Button variant="ghost" size="icon" data-testid="btn-back-orders">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-mono">{order.orderCode}</h1>
          <p className="text-muted-foreground mt-1">Ngày tạo: {formatDate(order.createdAt)}</p>
        </div>
        <span className={`ml-auto inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${statusColor}`}>
          {statusLabel}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-3">
            <User className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Thông tin khách hàng</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <span className="text-muted-foreground">ID:</span>
              <span className="col-span-2 font-mono">{order.customerId}</span>
              
              <span className="text-muted-foreground">Tên:</span>
              <span className="col-span-2">{order.customer?.firstName} {order.customer?.lastName}</span>
              
              <span className="text-muted-foreground">Username:</span>
              <span className="col-span-2">{order.customer?.username ? `@${order.customer.username}` : 'N/A'}</span>

              <span className="text-muted-foreground">Chat ID:</span>
              <span className="col-span-2 font-mono">{order.customer?.chatId || 'N/A'}</span>
            </div>
            <div className="pt-2">
              <Link href={`/customers/${order.customerId}`}>
                <Button variant="outline" size="sm" className="w-full">Xem hồ sơ khách hàng</Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-3">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Thông tin thanh toán</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <span className="text-muted-foreground">Tổng tiền:</span>
              <span className="col-span-2 font-bold text-primary text-base">{formatVND(order.totalAmount)}</span>
              
              <span className="text-muted-foreground">Tham chiếu:</span>
              <span className="col-span-2 font-mono text-xs break-all">{order.paymentReference || "N/A"}</span>
              
              <span className="text-muted-foreground">Thanh toán lúc:</span>
              <span className="col-span-2">{order.paidAt ? formatDate(order.paidAt) : "Chưa thanh toán"}</span>

              <span className="text-muted-foreground">Giao hàng lúc:</span>
              <span className="col-span-2">{order.deliveredAt ? formatDate(order.deliveredAt) : "Chưa giao"}</span>

              {order.notes && (
                <>
                  <span className="text-muted-foreground">Ghi chú:</span>
                  <span className="col-span-2 text-xs">{order.notes}</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-3">
          <Package className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Sản phẩm đã mua</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sản phẩm</TableHead>
                <TableHead className="text-right">Đơn giá</TableHead>
                <TableHead className="text-right">Số lượng</TableHead>
                <TableHead className="text-right">Thành tiền</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items?.map((item) => (
                <TableRow key={item.id} data-testid={`row-item-${item.id}`}>
                  <TableCell className="font-medium">{item.productName}</TableCell>
                  <TableCell className="text-right">{formatVND(item.unitPrice)}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right font-bold text-primary">{formatVND(item.totalPrice)}</TableCell>
                </TableRow>
              ))}
              {(!order.items || order.items.length === 0) && (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    Không có sản phẩm nào.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {(order.retryCount > 0 || (order.retryLogs && order.retryLogs.length > 0)) && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-3">
            <RefreshCw className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Lịch sử thử lại giao hàng</CardTitle>
            <span className="ml-auto inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold bg-yellow-500/10 text-yellow-500">
              {order.retryCount} lần thử lại
            </span>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hành động</TableHead>
                  <TableHead>Mức độ</TableHead>
                  <TableHead>Nội dung</TableHead>
                  <TableHead className="text-right">Thời gian</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.retryLogs?.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${RETRY_ACTION_COLORS[log.action] ?? "bg-muted text-muted-foreground"}`}>
                        {RETRY_ACTION_LABELS[log.action] ?? log.action}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs font-mono ${log.level === "error" ? "text-destructive" : log.level === "warn" ? "text-yellow-500" : "text-muted-foreground"}`}>
                        {log.level}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs max-w-xs truncate text-muted-foreground">{log.content || "—"}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{formatDate(log.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {order.transaction && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-3">
            <Receipt className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Giao dịch liên kết</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start justify-between gap-6">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm flex-1">
                <div>
                  <p className="text-muted-foreground">Mã giao dịch</p>
                  <p className="font-mono font-medium">{order.transaction.transactionCode}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Loại</p>
                  <p>{TX_TYPE_LABELS[order.transaction.type] ?? order.transaction.type}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Số tiền</p>
                  <p className={`font-bold ${order.transaction.amount.startsWith('-') ? 'text-destructive' : 'text-emerald-500'}`}>
                    {order.transaction.amount.startsWith('-') ? '' : '+'}{formatVND(order.transaction.amount)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Trạng thái</p>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${TX_STATUS_COLORS[order.transaction.status] ?? "bg-muted text-muted-foreground"}`}>
                    {TX_STATUS_LABELS[order.transaction.status] ?? order.transaction.status}
                  </span>
                </div>
                <div>
                  <p className="text-muted-foreground">Nhà cung cấp</p>
                  <p>{order.transaction.provider || '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Thời gian</p>
                  <p>{formatDate(order.transaction.createdAt)}</p>
                </div>
              </div>
              <Link href={`/transactions/${order.transaction.id}`}>
                <Button variant="outline" size="sm" data-testid="btn-view-transaction">
                  Xem chi tiết GD
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
