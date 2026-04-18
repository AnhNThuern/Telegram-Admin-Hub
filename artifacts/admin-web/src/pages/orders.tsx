import { useListOrders, useTriggerRetrySweep, useGetRetrySweepStatus, ApiError, getGetRetrySweepStatusQueryKey } from "@workspace/api-client-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatVND, formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Eye, RefreshCw, Tag } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

const STATUS_LABELS: Record<string, string> = {
  paid: "Đã thanh toán",
  pending: "Chờ thanh toán",
  cancelled: "Đã hủy",
  expired: "Hết hạn",
  needs_manual_action: "Cần xử lý",
  confirmed_not_delivered: "Chờ giao",
  retry_exhausted: "Hết lượt thử",
};

const STATUS_STYLES: Record<string, string> = {
  paid: "bg-emerald-500/10 text-emerald-500",
  pending: "bg-yellow-500/10 text-yellow-500",
  cancelled: "bg-destructive/10 text-destructive",
  expired: "bg-destructive/10 text-destructive",
  needs_manual_action: "bg-orange-500/10 text-orange-500",
  confirmed_not_delivered: "bg-blue-500/10 text-blue-400",
  retry_exhausted: "bg-red-700/20 text-red-400",
};

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "Chưa có lần quét nào";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "vừa xong";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} giây trước`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} phút trước`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} giờ trước`;
  const days = Math.floor(hr / 24);
  return `${days} ngày trước`;
}

export default function Orders() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("all");
  const [hasRetries, setHasRetries] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: sweepStatus } = useGetRetrySweepStatus({
    query: { refetchInterval: 60_000, queryKey: getGetRetrySweepStatusQueryKey() },
  });

  const { data: orderList, isLoading } = useListOrders({
    page,
    limit: 10,
    status: status !== "all" ? status : undefined,
    hasRetries: hasRetries ? true : undefined,
  });

  const { mutate: triggerSweep, isPending: sweepPending } = useTriggerRetrySweep({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getGetRetrySweepStatusQueryKey() });
        if (result.alreadyRunning) {
          toast({
            title: "Quét đang chạy",
            description: "Lần quét trước vẫn đang chạy, hãy thử lại sau.",
            variant: "destructive",
          });
          return;
        }
        if (result.swept === 0) {
          toast({
            title: "Quét hoàn tất",
            description: "Không có đơn hàng bị kẹt nào để thử lại.",
          });
        } else {
          const summaryParts: string[] = [`Đã quét ${result.swept} đơn hàng.`];
          if (result.delivered > 0) summaryParts.push(`✅ Giao thành công: ${result.delivered}`);
          if (result.failed > 0) summaryParts.push(`❌ Thất bại: ${result.failed}`);
          if (result.errored > 0) summaryParts.push(`⚠️ Lỗi: ${result.errored}`);
          if (result.exhausted > 0) summaryParts.push(`🚫 Hết lượt: ${result.exhausted}`);

          const renderOrderLinks = (label: string, orders: { id: number; orderCode: string }[], testid: string) => (
            <div className="mt-1" data-testid={testid}>
              <span>{label} </span>
              {orders.map((o, idx) => (
                <span key={o.id}>
                  <Link
                    href={`/orders/${o.id}`}
                    className="font-mono underline underline-offset-2 hover:text-foreground"
                    data-testid={`link-failed-order-${o.id}`}
                  >
                    {o.orderCode}
                  </Link>
                  {idx < orders.length - 1 ? ", " : ""}
                </span>
              ))}
            </div>
          );

          toast({
            title: "Quét hoàn tất",
            description: (
              <div className="space-y-1">
                <div>{summaryParts.join(" ")}</div>
                {result.failedOrders.length > 0 && renderOrderLinks("Đơn thất bại:", result.failedOrders, "failed-orders-list")}
                {result.erroredOrders.length > 0 && renderOrderLinks("Đơn lỗi:", result.erroredOrders, "errored-orders-list")}
              </div>
            ),
          });
        }
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 409) {
          toast({
            title: "Quét đang chạy",
            description: "Lần quét trước vẫn đang chạy, hãy thử lại sau.",
            variant: "destructive",
          });
          return;
        }
        toast({
          title: "Lỗi",
          description: "Không thể kích hoạt quét. Vui lòng thử lại.",
          variant: "destructive",
        });
      },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Đơn hàng</h1>
          <p className="text-muted-foreground mt-1">Quản lý tất cả đơn hàng từ Telegram.</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button
            onClick={() => triggerSweep()}
            disabled={sweepPending}
            data-testid="btn-retry-sweep"
          >
            {sweepPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Thử lại ngay
          </Button>
          <p className="text-xs text-muted-foreground" data-testid="text-last-sweep">
            Lần quét cuối: <span className="font-medium">{formatRelativeTime(sweepStatus?.lastSweepAt)}</span>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Tất cả trạng thái" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả trạng thái</SelectItem>
            <SelectItem value="pending">Chờ thanh toán</SelectItem>
            <SelectItem value="paid">Đã thanh toán</SelectItem>
            <SelectItem value="needs_manual_action">Cần xử lý</SelectItem>
            <SelectItem value="confirmed_not_delivered">Chờ giao</SelectItem>
            <SelectItem value="retry_exhausted">Hết lượt thử</SelectItem>
            <SelectItem value="cancelled">Đã hủy</SelectItem>
            <SelectItem value="expired">Hết hạn</SelectItem>
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant={hasRetries ? "default" : "outline"}
          size="sm"
          onClick={() => { setHasRetries((v) => !v); setPage(1); }}
          data-testid="btn-filter-has-retries"
          title="Chỉ hiện đơn đã thử lại"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          {hasRetries ? "Đang lọc: Đã thử lại" : "Chỉ đơn đã thử lại"}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã ĐH</TableHead>
                  <TableHead>Khách hàng (ID)</TableHead>
                  <TableHead>Tổng tiền</TableHead>
                  <TableHead>Giảm giá</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Lần thử</TableHead>
                  <TableHead>Thời gian tạo</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderList?.data?.map((order) => (
                  <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
                    <TableCell className="font-mono font-medium">{order.orderCode}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{order.customerId}</TableCell>
                    <TableCell className="font-bold text-primary">{formatVND(order.totalAmount)}</TableCell>
                    <TableCell>
                      {parseFloat(order.discountAmount ?? "0") > 0 ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-500"
                          data-testid={`badge-discount-${order.id}`}
                          title={order.promotionCode ? `Mã: ${order.promotionCode}` : "Đã áp dụng giảm giá"}
                        >
                          <Tag className="h-3 w-3" />
                          −{formatVND(order.discountAmount ?? "0")}
                          {order.promotionCode && (
                            <span className="ml-1 font-mono text-[10px] uppercase opacity-80">{order.promotionCode}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[order.status as string] ?? "bg-muted/50 text-muted-foreground"}`}>
                        {STATUS_LABELS[order.status as string] ?? order.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {(order.retryCount ?? 0) > 0 ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-xs font-semibold ${
                            (order.retryCount ?? 0) >= 8
                              ? "bg-orange-500/15 text-orange-400"
                              : "bg-yellow-500/15 text-yellow-500"
                          }`}
                          data-testid={`badge-retry-${order.id}`}
                          title={`${order.retryCount} lần thử lại`}
                        >
                          <RefreshCw className="h-3 w-3" />
                          {order.retryCount}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(order.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/orders/${order.id}`}>
                        <Button variant="ghost" size="icon" title="Xem chi tiết" data-testid={`btn-view-order-${order.id}`}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {orderList?.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      Không tìm thấy đơn hàng nào.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      
      <div className="flex justify-between items-center mt-4">
        <Button 
          variant="outline" 
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page === 1}
        >
          Trang trước
        </Button>
        <span className="text-sm text-muted-foreground">Trang {page}</span>
        <Button 
          variant="outline" 
          onClick={() => setPage(p => p + 1)}
          disabled={!orderList || orderList.data.length < 10}
        >
          Trang sau
        </Button>
      </div>
    </div>
  );
}
