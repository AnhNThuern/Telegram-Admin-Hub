import { useListTransactions } from "@workspace/api-client-react";
import { Link } from "wouter";
import { useState } from "react";
import { formatVND, formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

export default function Transactions() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  
  const { data: transactionList, isLoading } = useListTransactions({
    page,
    limit: 10,
    search: search || undefined,
    type: type !== "all" ? type : undefined,
    status: status !== "all" ? status : undefined,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Giao dịch</h1>
          <p className="text-muted-foreground mt-1">Lịch sử thanh toán và nạp tiền.</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Input 
          placeholder="Tìm kiếm mã GD..." 
          className="max-w-xs" 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-search-transactions"
        />
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Loại giao dịch" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả loại</SelectItem>
            <SelectItem value="deposit">Nạp tiền</SelectItem>
            <SelectItem value="purchase">Mua hàng</SelectItem>
            <SelectItem value="refund">Hoàn tiền</SelectItem>
            <SelectItem value="manual_credit">Cộng thủ công</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Trạng thái" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả trạng thái</SelectItem>
            <SelectItem value="pending">Đang xử lý</SelectItem>
            <SelectItem value="completed">Hoàn thành</SelectItem>
            <SelectItem value="failed">Thất bại</SelectItem>
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
                  <TableHead>Mã GD</TableHead>
                  <TableHead>Khách hàng (ID)</TableHead>
                  <TableHead>Loại GD</TableHead>
                  <TableHead>Số tiền</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Thời gian</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactionList?.data?.map((tx) => (
                  <TableRow key={tx.id} data-testid={`row-tx-${tx.id}`}>
                    <TableCell className="font-mono font-medium">
                      <Link href={`/transactions/${tx.id}`} className="hover:text-primary transition-colors" data-testid={`link-tx-${tx.id}`}>
                        {tx.transactionCode}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{tx.customerId || "N/A"}</TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {tx.type === 'deposit' ? 'Nạp tiền' : 
                         tx.type === 'purchase' ? 'Mua hàng' : 
                         tx.type === 'refund' ? 'Hoàn tiền' : 
                         tx.type === 'manual_credit' ? 'Cộng tiền' : tx.type}
                      </span>
                    </TableCell>
                    <TableCell className={`font-bold ${tx.amount.startsWith('-') ? 'text-destructive' : 'text-emerald-500'}`}>
                      {tx.amount.startsWith('-') ? '' : '+'}{formatVND(tx.amount)}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                        tx.status === 'completed' ? "bg-emerald-500/10 text-emerald-500" : 
                        tx.status === 'pending' ? "bg-yellow-500/10 text-yellow-500" : 
                        "bg-destructive/10 text-destructive"
                      }`}>
                        {tx.status === 'completed' ? "Hoàn thành" : tx.status === 'pending' ? "Đang xử lý" : "Thất bại"}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(tx.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {transactionList?.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      Không tìm thấy giao dịch nào.
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
          disabled={!transactionList || transactionList.data.length < 10}
        >
          Trang sau
        </Button>
      </div>
    </div>
  );
}
