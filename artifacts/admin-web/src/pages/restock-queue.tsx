import { useGetRestockQueue, getGetRestockQueueQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Loader2, Eye, PackageX, RefreshCw } from "lucide-react";
import { formatVND } from "@/lib/utils";

function formatWaitTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "vừa xong";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} giây`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} phút`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} giờ`;
  const days = Math.floor(hr / 24);
  return `${days} ngày`;
}

function urgencyClass(iso: string): string {
  const minutes = (Date.now() - new Date(iso).getTime()) / 60000;
  if (minutes >= 60 * 24) return "text-red-500 font-semibold";
  if (minutes >= 60) return "text-orange-500 font-medium";
  return "text-yellow-500";
}

export default function RestockQueue() {
  const { data, isLoading, refetch, isFetching } = useGetRestockQueue({
    query: { refetchInterval: 30_000, queryKey: getGetRestockQueueQueryKey() },
  });

  const orders = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Đơn chờ nhập hàng</h1>
          <p className="text-muted-foreground mt-1">
            Đơn đã thanh toán nhưng chưa giao được vì hết kho. Sắp xếp theo thời gian chờ lâu nhất.
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="btn-refresh-queue">
          {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Làm mới
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <PackageX className="h-10 w-10 mb-3 opacity-50" />
              <p>Không có đơn nào đang chờ nhập hàng.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã đơn</TableHead>
                  <TableHead>Khách hàng</TableHead>
                  <TableHead>Sản phẩm cần</TableHead>
                  <TableHead>Tổng tiền</TableHead>
                  <TableHead>Số lần thử</TableHead>
                  <TableHead>Thời gian chờ</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => {
                  const fullName = o.customer ? [o.customer.firstName, o.customer.lastName].filter(Boolean).join(" ") : "";
                  const customerLabel = fullName
                    || (o.customer?.username ? "@" + o.customer.username : null)
                    || (o.customer?.chatId ? "TG " + o.customer.chatId : "—");
                  return (
                    <TableRow key={o.id} data-testid={`row-restock-${o.id}`}>
                      <TableCell className="font-mono text-xs">{o.orderCode}</TableCell>
                      <TableCell>
                        {o.customer ? (
                          <Link href={`/customers/${o.customer.id}`} className="hover:underline">
                            {customerLabel}
                          </Link>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          {o.items.map((it) => (
                            <span key={it.id} className="text-sm">
                              {it.productName ?? `#${it.productId}`} <span className="text-muted-foreground">×{it.quantity}</span>
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>{formatVND(o.totalAmount)}</TableCell>
                      <TableCell>{o.retryCount}</TableCell>
                      <TableCell>
                        <span className={urgencyClass(o.createdAt)} data-testid={`text-wait-${o.id}`}>
                          {formatWaitTime(o.createdAt)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/orders/${o.id}`}>
                          <Button variant="ghost" size="sm">
                            <Eye className="h-4 w-4 mr-1" /> Xem
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
