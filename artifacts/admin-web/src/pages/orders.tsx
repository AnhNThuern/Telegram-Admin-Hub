import { useListOrders } from "@workspace/api-client-react";
import { useState } from "react";
import { formatVND, formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Eye } from "lucide-react";
import { Link } from "wouter";

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

export default function Orders() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("all");
  
  const { data: orderList, isLoading } = useListOrders({
    page,
    limit: 10,
    status: status !== "all" ? status : undefined,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Đơn hàng</h1>
          <p className="text-muted-foreground mt-1">Quản lý tất cả đơn hàng từ Telegram.</p>
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
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[order.status as string] ?? "bg-muted/50 text-muted-foreground"}`}>
                        {STATUS_LABELS[order.status as string] ?? order.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-center text-sm text-muted-foreground">
                      {(order.retryCount ?? 0) > 0 ? (
                        <span className={`font-mono ${(order.retryCount ?? 0) >= 8 ? "text-orange-400" : ""}`}>
                          {order.retryCount}
                        </span>
                      ) : "—"}
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
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
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
