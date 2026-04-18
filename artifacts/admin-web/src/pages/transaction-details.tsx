import { useGetTransaction, getGetTransactionQueryKey } from "@workspace/api-client-react";
import { formatVND, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

const TYPE_LABELS: Record<string, string> = {
  deposit: "Nạp tiền",
  purchase: "Mua hàng",
  refund: "Hoàn tiền",
  manual_credit: "Cộng thủ công",
  payment: "Thanh toán",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Đang xử lý",
  confirmed: "Đã xác nhận",
  completed: "Hoàn thành",
  failed: "Thất bại",
  delivered: "Đã giao",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-500",
  confirmed: "bg-blue-500/10 text-blue-500",
  completed: "bg-emerald-500/10 text-emerald-500",
  delivered: "bg-emerald-500/10 text-emerald-500",
  failed: "bg-destructive/10 text-destructive",
};

export default function TransactionDetails({ params }: { params: { id: string } }) {
  const transactionId = parseInt(params.id);

  const { data: tx, isLoading } = useGetTransaction(transactionId, {
    query: { enabled: !!transactionId, queryKey: getGetTransactionQueryKey(transactionId) }
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!tx) return <div className="text-center py-10 text-muted-foreground">Không tìm thấy giao dịch</div>;

  const statusColor = STATUS_COLORS[tx.status] ?? "bg-muted text-muted-foreground";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/transactions">
          <Button variant="ghost" size="icon" data-testid="btn-back-transactions">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-mono">{tx.transactionCode}</h1>
          <p className="text-muted-foreground mt-1">Chi tiết giao dịch</p>
        </div>
        <span className={`ml-auto inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${statusColor}`}>
          {STATUS_LABELS[tx.status] ?? tx.status}
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Thông tin giao dịch</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Loại</p>
                <p className="font-medium">{TYPE_LABELS[tx.type] ?? tx.type}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Số tiền</p>
                <p className={`font-bold text-lg ${tx.amount.startsWith('-') ? 'text-destructive' : 'text-emerald-500'}`}>
                  {tx.amount.startsWith('-') ? '' : '+'}{formatVND(tx.amount)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Nhà cung cấp</p>
                <p className="font-medium">{tx.provider ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Mã đơn hàng</p>
                <p className="font-mono text-xs">{tx.orderId ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Mã tham chiếu</p>
                <p className="font-mono text-xs break-all">{tx.paymentReference ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Khách hàng ID</p>
                <p className="font-mono">{tx.customerId ?? "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Thời gian</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground">Tạo lúc</p>
                <p className="font-medium">{formatDate(tx.createdAt)}</p>
              </div>
              {tx.confirmedAt && (
                <div>
                  <p className="text-muted-foreground">Xác nhận lúc</p>
                  <p className="font-medium">{formatDate(tx.confirmedAt)}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {tx.rawPayload && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dữ liệu thô từ SePay</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs font-mono bg-muted/30 rounded-md p-4 overflow-x-auto whitespace-pre-wrap break-all">
              {typeof tx.rawPayload === "string"
                ? (() => { try { return JSON.stringify(JSON.parse(tx.rawPayload), null, 2); } catch { return tx.rawPayload; } })()
                : JSON.stringify(tx.rawPayload, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
