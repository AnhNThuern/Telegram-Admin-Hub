import { useGetOrder, getGetOrderQueryKey } from "@workspace/api-client-react";
import { formatVND, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, Package, User, CreditCard } from "lucide-react";
import { Link } from "wouter";

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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/orders">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Chi tiết đơn hàng {order.orderCode}</h1>
          <p className="text-muted-foreground mt-1">Ngày tạo: {formatDate(order.createdAt)}</p>
        </div>
        <div className="ml-auto">
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${
            order.status === 'paid' ? "bg-emerald-500/10 text-emerald-500" : 
            order.status === 'pending' ? "bg-yellow-500/10 text-yellow-500" : 
            "bg-destructive/10 text-destructive"
          }`}>
            {order.status === 'paid' ? "Đã thanh toán" : order.status === 'pending' ? "Chờ thanh toán" : order.status === 'cancelled' ? "Đã hủy" : "Hết hạn"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <User className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Thông tin khách hàng</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <span className="text-muted-foreground">ID Khách hàng:</span>
              <span className="col-span-2 font-mono">{order.customerId}</span>
              
              <span className="text-muted-foreground">Tên:</span>
              <span className="col-span-2">{order.customer?.firstName} {order.customer?.lastName}</span>
              
              <span className="text-muted-foreground">Username:</span>
              <span className="col-span-2">{order.customer?.username ? `@${order.customer.username}` : 'N/A'}</span>
            </div>
            <div className="pt-2">
              <Link href={`/customers/${order.customerId}`}>
                <Button variant="outline" size="sm" className="w-full">Xem hồ sơ khách hàng</Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Thông tin thanh toán</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <span className="text-muted-foreground">Tổng tiền:</span>
              <span className="col-span-2 font-bold text-primary">{formatVND(order.totalAmount)}</span>
              
              <span className="text-muted-foreground">Tham chiếu:</span>
              <span className="col-span-2 font-mono">{order.paymentReference || "N/A"}</span>
              
              <span className="text-muted-foreground">Ngày thanh toán:</span>
              <span className="col-span-2">{order.paidAt ? formatDate(order.paidAt) : "Chưa thanh toán"}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <Package className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Sản phẩm đã mua</CardTitle>
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
                <TableRow key={item.id}>
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
    </div>
  );
}
